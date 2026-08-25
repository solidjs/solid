use oxc_allocator::Allocator;
use oxc_ast::ast::{Expression, JSXChild, JSXElement, JSXFragment};
use oxc_span::{GetSpan, Span};

use crate::dom::element::AstDomTransform;
use crate::shared::condition::{
    ConditionBuilder, is_condition_shape, memo_wrap_thunk, transform_condition, zero_arg_call_thunk,
};
use crate::shared::mode_lower::ModeLower;

impl<'a> ConditionBuilder<'a> for AstDomTransform<'a, '_> {
    fn condition_allocator(&self) -> &'a Allocator {
        self.allocator
    }

    fn memo_wrapper_enabled(&self) -> bool {
        self.memo_wrapper.is_some()
    }

    fn register_memo(&mut self) -> String {
        self.template_state.uses_memo = true;
        self.memo_wrapper_local()
    }

    fn next_condition_id(&mut self) -> String {
        AstDomTransform::next_condition_id(self)
    }

    fn classify(&self) -> crate::shared::classify::Classify<'_> {
        AstDomTransform::classify(self)
    }
}

impl<'a> crate::shared::component_children::ComponentChildLower<'a> for AstDomTransform<'a, '_> {
    fn lower_child_element_with_setup(
        &mut self,
        element: &JSXElement<'a>,
    ) -> crate::error::Result<(Expression<'a>, std::vec::Vec<oxc_ast::ast::Statement<'a>>)> {
        self.lower_element_with_setup(element)
    }
}

impl<'a> ModeLower<'a> for AstDomTransform<'a, '_> {
    fn wrap_conditionals_enabled(&self) -> bool {
        self.wrap_conditionals
    }

    fn lower_child_element(
        &mut self,
        element: &JSXElement<'a>,
    ) -> crate::error::Result<Expression<'a>> {
        self.lower_element(element)
    }

    fn memo_wrap_dynamic_child(&mut self, span: Span, thunk: Expression<'a>) -> Expression<'a> {
        memo_wrap_thunk(self, span, thunk)
    }

    fn fragment_array_span(&self, fragment: &JSXFragment<'a>) -> Span {
        fragment
            .children
            .first()
            .map_or_else(|| Span::new(0, 0), JSXChild::span)
    }
}

impl<'a> AstDomTransform<'a, '_> {
    /// Mirror of Babel's `transformNode` for a dynamic native child
    /// expression (`insert()` value). The caller has already applied the
    /// deep-dynamic gate on the original (pre-lowered) expression.
    pub(crate) fn dom_child_expression(
        &mut self,
        span: Span,
        value: Expression<'a>,
    ) -> Expression<'a> {
        if self.wrap_conditionals && is_condition_shape(&value) {
            return transform_condition(self, span, value, false)
                .into_expression(self.allocator, span);
        }
        if let Some(callee) = zero_arg_call_thunk(&value, self.allocator) {
            return callee;
        }
        self.arrow_return_expression(span, value)
    }
}
