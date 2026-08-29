//! Patch-mode eligibility analysis (Babel's `shared/patch.ts`, DESIGN-PATCH-
//! CHANNEL PR-C/§3c).
//!
//! A template scope qualifies for patch mode when EVERY dynamic binding's
//! value is a pure expression over member reads of ONE stable subject
//! identifier (Tier 1: bare member chains; Tier 2: ternary/binary/logical/
//! template-literal/unary compositions of Tier-1 reads and literals).
//! Anything else — calls, assignments, functions, foreign identifiers —
//! disqualifies the scope (all-or-nothing per template scope, matching the
//! Babel plugin).

use oxc_allocator::{Allocator, CloneIn};
use oxc_ast::ast::{BinaryOperator, Expression, UnaryOperator};
use oxc_ast_visit::{VisitMut, walk_mut};

/// Node types allowed inside an eligible binding expression (Tier 1+2).
/// `as_member_base` marks the root position of a member chain: the bare
/// subject identifier is ONLY eligible there (re-audit 7) — a standalone
/// `{subject}` read has no key envelope for the static manifest, so those
/// scopes keep classic effects. Mirrors the Babel plugin exactly.
fn is_eligible_expr(node: &Expression<'_>, subject: &str, as_member_base: bool) -> bool {
    match node {
        Expression::Identifier(ident) => {
            (as_member_base && ident.name == subject) || ident.name == "undefined"
        }
        Expression::StaticMemberExpression(member) => {
            !member.optional && is_eligible_expr(&member.object, subject, true)
        }
        Expression::ComputedMemberExpression(member) => {
            if member.optional {
                return false;
            }
            // Literal keys only — and no "." inside string keys, which would
            // collide with the manifest's path separator (re-audit 7).
            match &member.expression {
                Expression::StringLiteral(lit) => {
                    if lit.value.contains('.') {
                        return false;
                    }
                }
                Expression::NumericLiteral(_) => {}
                _ => return false,
            }
            is_eligible_expr(&member.object, subject, true)
        }
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::BigIntLiteral(_) => true,
        Expression::ConditionalExpression(cond) => {
            is_eligible_expr(&cond.test, subject, false)
                && is_eligible_expr(&cond.consequent, subject, false)
                && is_eligible_expr(&cond.alternate, subject, false)
        }
        Expression::BinaryExpression(binary) => {
            if matches!(
                binary.operator,
                BinaryOperator::In | BinaryOperator::Instanceof
            ) {
                return false;
            }
            is_eligible_expr(&binary.left, subject, false)
                && is_eligible_expr(&binary.right, subject, false)
        }
        Expression::LogicalExpression(logical) => {
            is_eligible_expr(&logical.left, subject, false)
                && is_eligible_expr(&logical.right, subject, false)
        }
        Expression::UnaryExpression(unary) => {
            if matches!(unary.operator, UnaryOperator::Delete) {
                return false;
            }
            is_eligible_expr(&unary.argument, subject, false)
        }
        Expression::TemplateLiteral(template) => template
            .expressions
            .iter()
            .all(|expression| is_eligible_expr(expression, subject, false)),
        Expression::ParenthesizedExpression(paren) => {
            is_eligible_expr(&paren.expression, subject, false)
        }
        _ => false,
    }
}

/// Find the single subject: the root identifier of the FIRST member chain
/// encountered. Every other read must root at the same name.
fn find_subject(node: &Expression<'_>) -> Option<String> {
    match node {
        Expression::StaticMemberExpression(member) => find_subject(&member.object),
        Expression::ComputedMemberExpression(member) => find_subject(&member.object),
        Expression::Identifier(ident) => {
            if ident.name == "undefined" {
                None
            } else {
                Some(ident.name.to_string())
            }
        }
        Expression::ConditionalExpression(cond) => find_subject(&cond.test)
            .or_else(|| find_subject(&cond.consequent))
            .or_else(|| find_subject(&cond.alternate)),
        Expression::BinaryExpression(binary) => {
            find_subject(&binary.left).or_else(|| find_subject(&binary.right))
        }
        Expression::LogicalExpression(logical) => {
            find_subject(&logical.left).or_else(|| find_subject(&logical.right))
        }
        Expression::UnaryExpression(unary) => find_subject(&unary.argument),
        Expression::TemplateLiteral(template) => template.expressions.iter().find_map(find_subject),
        Expression::ParenthesizedExpression(paren) => find_subject(&paren.expression),
        _ => None,
    }
}

/// Analyze a template scope's dynamic binding values. Returns the subject
/// when EVERY value is an eligible pure expression over it, else None.
pub(crate) fn analyze_patch_eligibility(values: &[&Expression<'_>]) -> Option<String> {
    if values.is_empty() {
        return None;
    }
    let mut subject: Option<String> = None;
    for value in values {
        let found = find_subject(value)?; // static-only binding: no dispatch source
        match &subject {
            None => subject = Some(found),
            Some(existing) if *existing != found => return None, // multi-subject: bail
            _ => {}
        }
    }
    let subject = subject?;
    for value in values {
        if !is_eligible_expr(value, &subject, false) {
            return None;
        }
    }
    Some(subject)
}

/// Clone `expr` substituting the subject identifier with `replacement`. Safe
/// because eligibility rejected functions/shadowing constructs, and member
/// PROPERTY positions are `IdentifierName` nodes (a different type from the
/// `IdentifierReference`s this rewrites).
pub(crate) fn substitute_subject<'a>(
    allocator: &'a Allocator,
    expr: &Expression<'a>,
    subject: &str,
    replacement: &str,
) -> Expression<'a> {
    struct Substituter<'s, 'a> {
        allocator: &'a Allocator,
        subject: &'s str,
        replacement: &'s str,
    }
    impl<'a> VisitMut<'a> for Substituter<'_, 'a> {
        fn visit_identifier_reference(
            &mut self,
            ident: &mut oxc_ast::ast::IdentifierReference<'a>,
        ) {
            if ident.name == self.subject {
                ident.name = oxc_str::Ident::from_str_in(self.replacement, &self.allocator);
            }
        }
    }
    let mut clone = expr.clone_in(allocator);
    let mut substituter = Substituter {
        allocator,
        subject,
        replacement,
    };
    walk_mut::walk_expression(&mut substituter, &mut clone);
    clone
}

/// Collect the STATIC read manifest (re-audit 7, P1-1): every member path
/// rooted at the subject, dot-joined. Order mirrors the Babel plugin
/// byte-for-byte: dynamics order, chains consumed whole at first
/// encounter, first occurrence kept.
pub(crate) fn collect_subject_paths(values: &[&Expression<'_>], subject: &str) -> Vec<String> {
    fn chain_of(node: &Expression<'_>, subject: &str) -> Option<String> {
        let mut segs: Vec<String> = Vec::new();
        let mut cur = node;
        loop {
            match cur {
                Expression::StaticMemberExpression(member) => {
                    segs.push(member.property.name.to_string());
                    cur = &member.object;
                }
                Expression::ComputedMemberExpression(member) => {
                    match &member.expression {
                        Expression::StringLiteral(lit) => segs.push(lit.value.to_string()),
                        Expression::NumericLiteral(lit) => {
                            // Match JS String(n) for the literal keys the
                            // grammar admits (integer/decimal indices).
                            #[allow(clippy::cast_possible_truncation)]
                            let text = if lit.value.fract() == 0.0 && lit.value.abs() < 1e15 {
                                (lit.value as i64).to_string()
                            } else {
                                lit.value.to_string()
                            };
                            segs.push(text);
                        }
                        _ => return None,
                    }
                    cur = &member.object;
                }
                Expression::Identifier(ident) => {
                    if ident.name == subject {
                        segs.reverse();
                        return Some(segs.join("."));
                    }
                    return None;
                }
                _ => return None,
            }
        }
    }
    fn walk(node: &Expression<'_>, subject: &str, paths: &mut Vec<String>) {
        if matches!(
            node,
            Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_)
        ) {
            if let Some(chain) = chain_of(node, subject) {
                if !paths.contains(&chain) {
                    paths.push(chain);
                }
                return; // the whole chain is consumed
            }
        }
        match node {
            Expression::StaticMemberExpression(member) => walk(&member.object, subject, paths),
            Expression::ComputedMemberExpression(member) => walk(&member.object, subject, paths),
            Expression::ConditionalExpression(cond) => {
                walk(&cond.test, subject, paths);
                walk(&cond.consequent, subject, paths);
                walk(&cond.alternate, subject, paths);
            }
            Expression::BinaryExpression(binary) => {
                walk(&binary.left, subject, paths);
                walk(&binary.right, subject, paths);
            }
            Expression::LogicalExpression(logical) => {
                walk(&logical.left, subject, paths);
                walk(&logical.right, subject, paths);
            }
            Expression::UnaryExpression(unary) => walk(&unary.argument, subject, paths),
            Expression::TemplateLiteral(template) => {
                for expression in &template.expressions {
                    walk(expression, subject, paths);
                }
            }
            Expression::ParenthesizedExpression(paren) => walk(&paren.expression, subject, paths),
            _ => {}
        }
    }
    let mut paths: Vec<String> = Vec::new();
    for value in values {
        walk(value, subject, &mut paths);
    }
    paths
}
