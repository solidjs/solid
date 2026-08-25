use oxc_allocator::{Allocator, CloneIn};
use oxc_ast::ast::{Expression, ObjectPropertyKind};
use oxc_span::Span;

use crate::dom::element::AstDomTransform;
use crate::shared::ast_builder::AstBuilder;

pub(crate) trait ComponentPropContext<'a>:
    crate::shared::condition::ConditionBuilder<'a>
{
    fn allocator(&self) -> &'a Allocator;
    fn ast(&self) -> AstBuilder<'a>;
    fn mark_merge_props(&mut self);
    fn call_identifier(
        &self,
        span: Span,
        callee: &str,
        args: std::vec::Vec<Expression<'a>>,
    ) -> Expression<'a>;
    fn arrow_return_expression(&self, span: Span, value: Expression<'a>) -> Expression<'a>;
    fn object_property(
        &self,
        span: Span,
        name: &str,
        value: Expression<'a>,
    ) -> ObjectPropertyKind<'a>;
    fn object_getter_property(
        &self,
        span: Span,
        name: &str,
        value: Expression<'a>,
    ) -> ObjectPropertyKind<'a>;
}

impl<'a> ComponentPropContext<'a> for AstDomTransform<'a, '_> {
    fn allocator(&self) -> &'a Allocator {
        self.allocator
    }

    fn ast(&self) -> AstBuilder<'a> {
        self.ast()
    }

    fn mark_merge_props(&mut self) {
        self.template_state.uses_merge_props = true;
    }

    fn call_identifier(
        &self,
        span: Span,
        callee: &str,
        args: std::vec::Vec<Expression<'a>>,
    ) -> Expression<'a> {
        self.call_identifier(span, callee, args)
    }

    fn arrow_return_expression(&self, span: Span, value: Expression<'a>) -> Expression<'a> {
        self.arrow_return_expression(span, value)
    }

    fn object_property(
        &self,
        span: Span,
        name: &str,
        value: Expression<'a>,
    ) -> ObjectPropertyKind<'a> {
        self.object_property(span, name, value)
    }

    fn object_getter_property(
        &self,
        span: Span,
        name: &str,
        value: Expression<'a>,
    ) -> ObjectPropertyKind<'a> {
        self.object_getter_property(span, name, value)
    }
}

pub(crate) struct ComponentSpread<'a> {
    pub(crate) value: Expression<'a>,
    pub(crate) force_merge: bool,
}

pub(crate) fn flush_component_props<'a, C: ComponentPropContext<'a>>(
    ctx: &C,
    running_props: &mut std::vec::Vec<ObjectPropertyKind<'a>>,
    prop_objects: &mut std::vec::Vec<Expression<'a>>,
    span: Span,
) {
    if running_props.is_empty() {
        return;
    }
    let props = std::mem::take(running_props);
    prop_objects.push(
        ctx.ast()
            .expression_object(span, ctx.ast().vec_from_iter(props)),
    );
}

pub(crate) fn component_props_expression<'a>(
    ctx: &mut impl ComponentPropContext<'a>,
    span: Span,
    mut prop_objects: std::vec::Vec<Expression<'a>>,
    force_merge_props: bool,
) -> Expression<'a> {
    match prop_objects.len() {
        0 => ctx.ast().expression_object(span, ctx.ast().vec()),
        1 if !force_merge_props => prop_objects.pop().expect("single props object exists"),
        _ => {
            ctx.mark_merge_props();
            ctx.call_identifier(span, "_$mergeProps", prop_objects)
        }
    }
}

/// Babel's component spread handling: a dynamic spread argument
/// (`isDynamic(..., { checkMember: true })`) defers behind a thunk — a bare
/// zero-arg call unwraps to its callee — and forces the `mergeProps` wrap;
/// static spreads pass through untouched.
pub(crate) fn component_spread_expression<'a>(
    ctx: &impl ComponentPropContext<'a>,
    expression: &Expression<'a>,
    span: Span,
) -> ComponentSpread<'a> {
    let cloned = expression.clone_in(ctx.allocator());
    if !ctx.classify().is_dynamic(None, expression, false) {
        return ComponentSpread {
            value: cloned,
            force_merge: false,
        };
    }
    let value = crate::shared::condition::zero_arg_call_thunk(&cloned, ctx.allocator())
        .unwrap_or_else(|| ctx.arrow_return_expression(span, cloned));
    ComponentSpread {
        value,
        force_merge: true,
    }
}

pub(crate) fn component_property<'a>(
    ctx: &impl ComponentPropContext<'a>,
    span: Span,
    name: &str,
    value: Expression<'a>,
    needs_getter: bool,
) -> ObjectPropertyKind<'a> {
    if needs_getter {
        ctx.object_getter_property(span, name, value)
    } else {
        ctx.object_property(span, name, value)
    }
}
