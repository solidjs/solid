//! The narrow mode-dispatch trait for the shared traversal layer.
//!
//! Babel's `transformNode`/`transformFragmentChildren` are one implementation
//! whose only per-mode variation is *how* an element lowers and *how* a
//! dynamic child thunk is wrapped (`createTemplate`'s `wrap`). [`ModeLower`]
//! captures exactly those seams — extending the proven [`ConditionBuilder`]
//! pattern — so `lower_fragment` (and the component-children pipeline) can be
//! generic while emission stays per-mode.

use crate::error::Result;
use crate::shared::ast_builder::AstBuilder;
use oxc_ast::ast::{Expression, JSXElement, JSXFragment};
use oxc_span::Span;

use crate::shared::ast::arrow_return_expression;
use crate::shared::condition::{
    ConditionBuilder, is_condition_shape, transform_condition_inline, zero_arg_call_thunk,
};

pub(crate) trait ModeLower<'a>: ConditionBuilder<'a> {
    /// Whether `wrapConditionals` is enabled for this generate.
    fn wrap_conditionals_enabled(&self) -> bool;

    /// Lowers a JSX element in fragment-child (root) position to a single
    /// expression: the dom generate returns the template IIFE, ssr a
    /// hydration-keyed `_$ssr` node, universal a setup IIFE.
    fn lower_child_element(&mut self, element: &JSXElement<'a>) -> Result<Expression<'a>>;

    /// Babel's `createTemplate(wrap: true)` for a dynamic child thunk:
    /// `memo(thunk)` in the client generates; ssr wraps the accessor body
    /// with `_$escape` first.
    fn memo_wrap_dynamic_child(&mut self, span: Span, thunk: Expression<'a>) -> Expression<'a>;

    /// Span stamped on a multi-child fragment array (the dom generate keeps
    /// the first child's span; ssr and universal use the fragment's own).
    fn fragment_array_span(&self, fragment: &JSXFragment<'a>) -> Span {
        fragment.span
    }
}

/// Babel's dynamic-child thunk in `transformNode`: conditionals collapse
/// their memos inline first (`transformCondition(..., true)`), bare zero-arg
/// calls unwrap to their callee, everything else gets a plain arrow. The
/// caller has already applied the `is_dynamic` gate.
pub(crate) fn dynamic_child_thunk<'a, C: ModeLower<'a>>(
    ctx: &mut C,
    span: Span,
    value: Expression<'a>,
) -> Expression<'a> {
    let allocator = ctx.condition_allocator();
    if ctx.wrap_conditionals_enabled() && is_condition_shape(&value) {
        let inlined = transform_condition_inline(ctx, span, value);
        return arrow_return_expression(allocator, span, inlined);
    }
    if let Some(thunk) = zero_arg_call_thunk(&value, allocator) {
        return thunk;
    }
    arrow_return_expression(allocator, span, value)
}

/// Shorthand for an [`AstBuilder`] over the mode's allocator.
pub(crate) fn mode_ast<'a, C: ModeLower<'a>>(ctx: &C) -> AstBuilder<'a> {
    AstBuilder::new(ctx.condition_allocator())
}
