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
fn is_eligible_expr(node: &Expression<'_>, subject: &str) -> bool {
    match node {
        Expression::Identifier(ident) => ident.name == subject || ident.name == "undefined",
        Expression::StaticMemberExpression(member) => {
            !member.optional && is_eligible_expr(&member.object, subject)
        }
        Expression::ComputedMemberExpression(member) => {
            if member.optional {
                return false;
            }
            if !matches!(
                member.expression,
                Expression::StringLiteral(_) | Expression::NumericLiteral(_)
            ) {
                return false;
            }
            is_eligible_expr(&member.object, subject)
        }
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::BigIntLiteral(_) => true,
        Expression::ConditionalExpression(cond) => {
            is_eligible_expr(&cond.test, subject)
                && is_eligible_expr(&cond.consequent, subject)
                && is_eligible_expr(&cond.alternate, subject)
        }
        Expression::BinaryExpression(binary) => {
            if matches!(
                binary.operator,
                BinaryOperator::In | BinaryOperator::Instanceof
            ) {
                return false;
            }
            is_eligible_expr(&binary.left, subject) && is_eligible_expr(&binary.right, subject)
        }
        Expression::LogicalExpression(logical) => {
            is_eligible_expr(&logical.left, subject) && is_eligible_expr(&logical.right, subject)
        }
        Expression::UnaryExpression(unary) => {
            if matches!(unary.operator, UnaryOperator::Delete) {
                return false;
            }
            is_eligible_expr(&unary.argument, subject)
        }
        Expression::TemplateLiteral(template) => template
            .expressions
            .iter()
            .all(|expression| is_eligible_expr(expression, subject)),
        Expression::ParenthesizedExpression(paren) => is_eligible_expr(&paren.expression, subject),
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
        Expression::TemplateLiteral(template) => {
            template.expressions.iter().find_map(find_subject)
        }
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
        if !is_eligible_expr(value, &subject) {
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
