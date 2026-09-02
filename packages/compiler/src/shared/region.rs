//! Region eligibility analysis (Babel's `shared/region.ts`, DESIGN-REGIONS
//! §9-10). A template scope compiles to ONE `_$region(subject, tracked,
//! body, deep?)` call when at least one dynamic binding's value is a pure
//! expression over STATIC-KEY member chains of one constant subject
//! identifier. Bindings that don't qualify become TRACKED RESIDUALS in the
//! region's compute; direct depth-1 subject reads inside residuals ride the
//! raw parameter (`_u$`). Chains deeper than the subject's own keys set the
//! DEEP flag — the runtime bubbles writes to flagged region roots, so no
//! witness subscriptions are emitted.

use oxc_allocator::{Allocator, CloneIn};
use oxc_ast::ast::{BinaryOperator, Expression, UnaryOperator};

/// One static member step: object side when the key is an identifier /
/// non-dotted string / safe-integer numeric literal, else None.
fn step_object<'e, 'a>(expr: &'e Expression<'a>) -> Option<&'e Expression<'a>> {
    match expr {
        Expression::StaticMemberExpression(member) if !member.optional => Some(&member.object),
        Expression::ComputedMemberExpression(member) if !member.optional => {
            match &member.expression {
                Expression::StringLiteral(lit) if !lit.value.contains('.') => {
                    Some(&member.object)
                }
                Expression::NumericLiteral(lit)
                    if lit.value.fract() == 0.0 && lit.value.abs() <= 9_007_199_254_740_991.0 =>
                {
                    Some(&member.object)
                }
                _ => None,
            }
        }
        _ => None,
    }
}

/// Chain depth when `expr` is a static-key member chain rooted at the
/// subject (`subject.a` → 1, `subject.a[0].b` → 3), else None.
pub(crate) fn chain_depth(expr: &Expression<'_>, subject: &str) -> Option<usize> {
    let mut depth = 0usize;
    let mut cur = expr;
    loop {
        match step_object(cur) {
            Some(object) => {
                depth += 1;
                cur = object;
            }
            None => {
                return match cur {
                    Expression::Identifier(ident) if ident.name == subject && depth > 0 => {
                        Some(depth)
                    }
                    _ => None,
                };
            }
        }
    }
}

/// Eligible expression: literals, and compositions of static-key member
/// chains of the subject (ternary/binary/logical/template/unary/paren).
pub(crate) fn is_eligible_expr(expr: &Expression<'_>, subject: &str) -> bool {
    match expr {
        Expression::Identifier(ident) => ident.name == "undefined",
        Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_) => {
            chain_depth(expr, subject).is_some()
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

/// Root identifier of the first static-key member chain found (mirrors the
/// Babel plugin: member chains walk to their root; compositions recurse).
pub(crate) fn find_subject_candidate(expr: &Expression<'_>) -> Option<String> {
    match expr {
        Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_) => {
            let mut cur = expr;
            loop {
                match cur {
                    Expression::StaticMemberExpression(member) => cur = &member.object,
                    Expression::ComputedMemberExpression(member) => cur = &member.object,
                    Expression::Identifier(ident) if ident.name != "undefined" => {
                        return Some(ident.name.to_string());
                    }
                    _ => return None,
                }
            }
        }
        Expression::ConditionalExpression(cond) => find_subject_candidate(&cond.test)
            .or_else(|| find_subject_candidate(&cond.consequent))
            .or_else(|| find_subject_candidate(&cond.alternate)),
        Expression::BinaryExpression(binary) => find_subject_candidate(&binary.left)
            .or_else(|| find_subject_candidate(&binary.right)),
        Expression::LogicalExpression(logical) => find_subject_candidate(&logical.left)
            .or_else(|| find_subject_candidate(&logical.right)),
        Expression::UnaryExpression(unary) => find_subject_candidate(&unary.argument),
        Expression::TemplateLiteral(template) => {
            template.expressions.iter().find_map(find_subject_candidate)
        }
        Expression::ParenthesizedExpression(paren) => find_subject_candidate(&paren.expression),
        _ => None,
    }
}

pub(crate) struct RegionScope {
    pub(crate) subject: String,
    /// Parallel to the dynamics array: true = rides raw, false = residual.
    pub(crate) eligible: Vec<bool>,
    /// Any eligible chain runs below the subject's own keys → the emitted
    /// region call carries the DEEP flag (writes bubble; see the runtime).
    pub(crate) deep: bool,
}

/// True when the expression contains any subject-rooted chain of depth ≥ 2.
fn has_deep_chain(expr: &Expression<'_>, subject: &str) -> bool {
    if let Some(depth) = chain_depth(expr, subject) {
        return depth >= 2;
    }
    match expr {
        Expression::ConditionalExpression(cond) => {
            has_deep_chain(&cond.test, subject)
                || has_deep_chain(&cond.consequent, subject)
                || has_deep_chain(&cond.alternate, subject)
        }
        Expression::BinaryExpression(binary) => {
            has_deep_chain(&binary.left, subject) || has_deep_chain(&binary.right, subject)
        }
        Expression::LogicalExpression(logical) => {
            has_deep_chain(&logical.left, subject) || has_deep_chain(&logical.right, subject)
        }
        Expression::UnaryExpression(unary) => has_deep_chain(&unary.argument, subject),
        Expression::TemplateLiteral(template) => template
            .expressions
            .iter()
            .any(|expression| has_deep_chain(expression, subject)),
        Expression::ParenthesizedExpression(paren) => has_deep_chain(&paren.expression, subject),
        _ => false,
    }
}

/// Analyze a scope's dynamics: pick the first candidate subject whose
/// binding is eligible with it, classify every binding against it. The
/// caller supplies constancy (`is_reassigned`) — reassignable subjects keep
/// classic semantics (the fallback re-reads the reference per run).
pub(crate) fn analyze_region_scope(
    values: &[&Expression<'_>],
    is_constant_binding: impl Fn(&str) -> bool,
) -> Option<RegionScope> {
    if values.is_empty() {
        return None;
    }
    let mut subject: Option<String> = None;
    for value in values {
        if let Some(candidate) = find_subject_candidate(value) {
            if is_eligible_expr(value, &candidate) {
                subject = Some(candidate);
                break;
            }
        }
    }
    let subject = subject?;
    // Subject must be a KNOWN, constant binding (Babel: scope.getBinding()
    // exists and .constant) — synthetic aliases (this-transform locals) are
    // unregistered in both compilers' scope trackers and DECLINE; the
    // classic fallback re-reads reassignable references per run.
    if !is_constant_binding(&subject) {
        return None;
    }
    let eligible: Vec<bool> = values
        .iter()
        .map(|value| is_eligible_expr(value, &subject))
        .collect();
    if !eligible.iter().any(|e| *e) {
        return None;
    }
    let deep = values
        .iter()
        .zip(eligible.iter())
        .any(|(value, ok)| *ok && has_deep_chain(value, &subject));
    Some(RegionScope {
        subject,
        eligible,
        deep,
    })
}

/// Clone `expr` substituting every subject read with `replacement` (`_n$`).
/// Safe because eligibility rejected functions/shadowing constructs, and
/// non-computed member PROPERTY positions are `IdentifierName` nodes — a
/// different type from the `IdentifierReference`s this rewrites.
pub(crate) fn substitute_subject<'a>(
    allocator: &'a Allocator,
    expr: &Expression<'a>,
    subject: &str,
    replacement: &str,
) -> Expression<'a> {
    let mut clone = expr.clone_in(allocator);
    rewrite_all(allocator, &mut clone, subject, replacement);
    clone
}

fn rewrite_all<'a>(
    allocator: &'a Allocator,
    expr: &mut Expression<'a>,
    subject: &str,
    replacement: &str,
) {
    match expr {
        Expression::Identifier(ident) => {
            if ident.name == subject {
                ident.name = oxc_str::Ident::from_str_in(replacement, &allocator);
            }
        }
        Expression::StaticMemberExpression(member) => {
            rewrite_all(allocator, &mut member.object, subject, replacement);
        }
        Expression::ComputedMemberExpression(member) => {
            rewrite_all(allocator, &mut member.object, subject, replacement);
            rewrite_all(allocator, &mut member.expression, subject, replacement);
        }
        Expression::ConditionalExpression(cond) => {
            rewrite_all(allocator, &mut cond.test, subject, replacement);
            rewrite_all(allocator, &mut cond.consequent, subject, replacement);
            rewrite_all(allocator, &mut cond.alternate, subject, replacement);
        }
        Expression::BinaryExpression(binary) => {
            rewrite_all(allocator, &mut binary.left, subject, replacement);
            rewrite_all(allocator, &mut binary.right, subject, replacement);
        }
        Expression::LogicalExpression(logical) => {
            rewrite_all(allocator, &mut logical.left, subject, replacement);
            rewrite_all(allocator, &mut logical.right, subject, replacement);
        }
        Expression::UnaryExpression(unary) => {
            rewrite_all(allocator, &mut unary.argument, subject, replacement);
        }
        Expression::TemplateLiteral(template) => {
            for expression in template.expressions.iter_mut() {
                rewrite_all(allocator, expression, subject, replacement);
            }
        }
        Expression::ParenthesizedExpression(paren) => {
            rewrite_all(allocator, &mut paren.expression, subject, replacement);
        }
        _ => {}
    }
}

/// Clone a RESIDUAL expression substituting DIRECT depth-1 subject reads
/// (`subject.key` not further membered) with reads off the raw parameter
/// (`_u$`) — the region compute subscribes the deep witness, so a tracked
/// per-key read would only duplicate the wake. Deeper chains keep the proxy
/// read; the classic fallback passes the PROXY as this parameter, so the
/// same emitted code stays per-key tracked there. Residuals are arbitrary
/// expressions, so this walks generically via `VisitMut`, tracking whether
/// the current member expression is itself the OBJECT of an enclosing one.
pub(crate) fn substitute_residual_subject<'a>(
    allocator: &'a Allocator,
    expr: &Expression<'a>,
    subject: &str,
    replacement: &str,
) -> Expression<'a> {
    use oxc_ast_visit::{VisitMut, walk_mut};

    struct ResidualSub<'s, 'a> {
        allocator: &'a Allocator,
        subject: &'s str,
        replacement: &'s str,
        in_member_object: bool,
    }

    impl<'a> ResidualSub<'_, 'a> {
        fn rewrite_object(&mut self, object: &mut Expression<'a>, parent_is_member_object: bool) {
            if let Expression::Identifier(ident) = object {
                if ident.name == self.subject && !parent_is_member_object {
                    ident.name = oxc_str::Ident::from_str_in(self.replacement, &self.allocator);
                }
                return;
            }
            let saved = self.in_member_object;
            self.in_member_object = true;
            self.visit_expression(object);
            self.in_member_object = saved;
        }
    }

    impl<'a> VisitMut<'a> for ResidualSub<'_, 'a> {
        fn visit_expression(&mut self, expr: &mut Expression<'a>) {
            let is_member_object = std::mem::replace(&mut self.in_member_object, false);
            match expr {
                Expression::StaticMemberExpression(member) => {
                    self.rewrite_object(&mut member.object, is_member_object);
                }
                Expression::ComputedMemberExpression(member) => {
                    self.rewrite_object(&mut member.object, is_member_object);
                    self.visit_expression(&mut member.expression);
                }
                _ => walk_mut::walk_expression(self, expr),
            }
        }
    }

    let mut clone = expr.clone_in(allocator);
    let mut sub = ResidualSub {
        allocator,
        subject,
        replacement,
        in_member_object: false,
    };
    sub.visit_expression(&mut clone);
    clone
}
