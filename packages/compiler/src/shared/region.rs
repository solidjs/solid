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

/// Static key text of one member step (the key side of `step_object`).
fn step_key_text(expr: &Expression<'_>) -> Option<String> {
    match expr {
        Expression::StaticMemberExpression(member) if !member.optional => {
            Some(member.property.name.to_string())
        }
        Expression::ComputedMemberExpression(member) if !member.optional => {
            match &member.expression {
                Expression::StringLiteral(lit) if !lit.value.contains('.') => {
                    Some(lit.value.to_string())
                }
                Expression::NumericLiteral(lit)
                    if lit.value.fract() == 0.0 && lit.value.abs() <= 9_007_199_254_740_991.0 =>
                {
                    #[allow(clippy::cast_possible_truncation)]
                    Some((lit.value as i64).to_string())
                }
                _ => None,
            }
        }
        _ => None,
    }
}

/// Chain key segments when `expr` is a static-key member chain rooted at
/// the subject (["a"], ["a","0","b"]), else None.
pub(crate) fn chain_segments(expr: &Expression<'_>, subject: &str) -> Option<Vec<String>> {
    let mut segs: Vec<String> = Vec::new();
    let mut cur = expr;
    loop {
        match step_object(cur) {
            Some(object) => {
                segs.push(step_key_text(cur)?);
                cur = object;
            }
            None => {
                return match cur {
                    Expression::Identifier(ident) if ident.name == subject && !segs.is_empty() => {
                        segs.reverse();
                        Some(segs)
                    }
                    _ => None,
                };
            }
        }
    }
}

/// Chain depth when `expr` is a static-key member chain rooted at the
/// subject (`subject.a` → 1, `subject.a[0].b` → 3), else None.
pub(crate) fn chain_depth(expr: &Expression<'_>, subject: &str) -> Option<usize> {
    chain_segments(expr, subject).map(|segs| segs.len())
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
    /// Unique INTERMEDIATE prefixes of every eligible chain, shortest first
    /// — each becomes a `_w$n = _d$(parent, key)` local in the envelope
    /// (pending-aware step resolution; the deep flag rides their presence).
    pub(crate) deep_prefixes: Vec<Vec<String>>,
}

/// Collect every subject-rooted static chain in an eligible expression
/// (whole chains consumed — no descent into their members).
fn collect_chains(expr: &Expression<'_>, subject: &str, out: &mut Vec<Vec<String>>) {
    if matches!(
        expr,
        Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_)
    ) {
        if let Some(chain) = chain_segments(expr, subject) {
            out.push(chain);
            return;
        }
    }
    match expr {
        Expression::StaticMemberExpression(member) => collect_chains(&member.object, subject, out),
        Expression::ComputedMemberExpression(member) => {
            collect_chains(&member.object, subject, out);
            collect_chains(&member.expression, subject, out);
        }
        Expression::ConditionalExpression(cond) => {
            collect_chains(&cond.test, subject, out);
            collect_chains(&cond.consequent, subject, out);
            collect_chains(&cond.alternate, subject, out);
        }
        Expression::BinaryExpression(binary) => {
            collect_chains(&binary.left, subject, out);
            collect_chains(&binary.right, subject, out);
        }
        Expression::LogicalExpression(logical) => {
            collect_chains(&logical.left, subject, out);
            collect_chains(&logical.right, subject, out);
        }
        Expression::UnaryExpression(unary) => collect_chains(&unary.argument, subject, out),
        Expression::TemplateLiteral(template) => {
            for expression in &template.expressions {
                collect_chains(expression, subject, out);
            }
        }
        Expression::ParenthesizedExpression(paren) => {
            collect_chains(&paren.expression, subject, out);
        }
        _ => {}
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
    // Unique intermediate prefixes of eligible chains (shortest first) —
    // mirrors the Babel plugin's ordering byte-for-byte.
    let mut chains: Vec<Vec<String>> = Vec::new();
    for (value, ok) in values.iter().zip(eligible.iter()) {
        if *ok {
            collect_chains(value, &subject, &mut chains);
        }
    }
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut deep_prefixes: Vec<Vec<String>> = Vec::new();
    for chain in &chains {
        for len in 1..chain.len() {
            let prefix = chain[..len].to_vec();
            let key = prefix.join("\u{0}");
            if seen.insert(key) {
                deep_prefixes.push(prefix);
            }
        }
    }
    deep_prefixes.sort_by_key(Vec::len);
    Some(RegionScope {
        subject,
        eligible,
        deep_prefixes,
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

/// SAFE-RESIDUAL grammar: a residual may have its direct depth-1 subject
/// reads rewritten onto the raw parameter ONLY when the expression cannot
/// introduce scope (no functions/classes), cannot mutate (no assignments/
/// updates), and cannot change receivers (no calls). Mirrors the Babel
/// plugin's isSafeResidual.
pub(crate) fn is_safe_residual(expr: &Expression<'_>) -> bool {
    use oxc_ast_visit::{Visit, walk};

    struct Safety {
        safe: bool,
    }
    impl<'a> Visit<'a> for Safety {
        fn visit_expression(&mut self, expr: &Expression<'a>) {
            if !self.safe {
                return;
            }
            match expr {
                Expression::CallExpression(_)
                | Expression::NewExpression(_)
                | Expression::TaggedTemplateExpression(_)
                | Expression::AssignmentExpression(_)
                | Expression::UpdateExpression(_)
                | Expression::FunctionExpression(_)
                | Expression::ArrowFunctionExpression(_)
                | Expression::ClassExpression(_)
                | Expression::YieldExpression(_)
                | Expression::AwaitExpression(_) => {
                    self.safe = false;
                }
                _ => walk::walk_expression(self, expr),
            }
        }
    }
    let mut safety = Safety { safe: true };
    safety.visit_expression(expr);
    safety.safe
}

fn is_valid_ident(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

/// Clone an ELIGIBLE expression rewriting every subject-rooted chain onto
/// the envelope's raw views: depth-1 chains read the raw parameter; deeper
/// chains read their final key off the PREFIX LOCAL (`_w$n`). Mirrors the
/// Babel plugin's substituteChains — eligible grammar is CLOSED, so the
/// walk covers exactly the composition set.
pub(crate) fn substitute_chains<'a>(
    allocator: &'a Allocator,
    ast: &crate::shared::ast_builder::AstBuilder<'a>,
    expr: &Expression<'a>,
    subject: &str,
    raw: &str,
    prefix_var: &dyn Fn(&str) -> String,
) -> Expression<'a> {
    let mut clone = expr.clone_in(allocator);
    rewrite_chains(allocator, ast, &mut clone, subject, raw, prefix_var);
    clone
}

fn chain_replacement<'a>(
    ast: &crate::shared::ast_builder::AstBuilder<'a>,
    span: oxc_span::Span,
    chain: &[String],
    raw: &str,
    prefix_var: &dyn Fn(&str) -> String,
) -> Expression<'a> {
    let base_name = if chain.len() == 1 {
        raw.to_string()
    } else {
        prefix_var(&chain[..chain.len() - 1].join("\u{0}"))
    };
    let base = ast.expression_identifier(span, ast.ident(&base_name));
    let last = &chain[chain.len() - 1];
    if is_valid_ident(last) {
        Expression::StaticMemberExpression(ast.alloc_static_member_expression(
            span,
            base,
            ast.identifier_name(span, ast.ident(last)),
            false,
        ))
    } else if last.chars().all(|c| c.is_ascii_digit()) {
        Expression::ComputedMemberExpression(ast.alloc_computed_member_expression(
            span,
            base,
            ast.expression_numeric_literal(
                span,
                last.parse::<f64>().unwrap_or(0.0),
                None,
                oxc_ast::ast::NumberBase::Decimal,
            ),
            false,
        ))
    } else {
        Expression::ComputedMemberExpression(ast.alloc_computed_member_expression(
            span,
            base,
            ast.expression_string_literal(span, ast.str(last), None),
            false,
        ))
    }
}

fn rewrite_chains<'a>(
    allocator: &'a Allocator,
    ast: &crate::shared::ast_builder::AstBuilder<'a>,
    expr: &mut Expression<'a>,
    subject: &str,
    raw: &str,
    prefix_var: &dyn Fn(&str) -> String,
) {
    if matches!(
        expr,
        Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_)
    ) {
        if let Some(chain) = chain_segments(expr, subject) {
            let span = oxc_span::GetSpan::span(&*expr);
            *expr = chain_replacement(ast, span, &chain, raw, prefix_var);
            return;
        }
    }
    match expr {
        Expression::StaticMemberExpression(member) => {
            rewrite_chains(allocator, ast, &mut member.object, subject, raw, prefix_var);
        }
        Expression::ComputedMemberExpression(member) => {
            rewrite_chains(allocator, ast, &mut member.object, subject, raw, prefix_var);
            rewrite_chains(allocator, ast, &mut member.expression, subject, raw, prefix_var);
        }
        Expression::ConditionalExpression(cond) => {
            rewrite_chains(allocator, ast, &mut cond.test, subject, raw, prefix_var);
            rewrite_chains(allocator, ast, &mut cond.consequent, subject, raw, prefix_var);
            rewrite_chains(allocator, ast, &mut cond.alternate, subject, raw, prefix_var);
        }
        Expression::BinaryExpression(binary) => {
            rewrite_chains(allocator, ast, &mut binary.left, subject, raw, prefix_var);
            rewrite_chains(allocator, ast, &mut binary.right, subject, raw, prefix_var);
        }
        Expression::LogicalExpression(logical) => {
            rewrite_chains(allocator, ast, &mut logical.left, subject, raw, prefix_var);
            rewrite_chains(allocator, ast, &mut logical.right, subject, raw, prefix_var);
        }
        Expression::UnaryExpression(unary) => {
            rewrite_chains(allocator, ast, &mut unary.argument, subject, raw, prefix_var);
        }
        Expression::TemplateLiteral(template) => {
            for expression in template.expressions.iter_mut() {
                rewrite_chains(allocator, ast, expression, subject, raw, prefix_var);
            }
        }
        Expression::ParenthesizedExpression(paren) => {
            rewrite_chains(allocator, ast, &mut paren.expression, subject, raw, prefix_var);
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
