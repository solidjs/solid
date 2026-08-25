use oxc_allocator::CloneIn;
use oxc_ast::ast::{AssignmentOperator, AssignmentTarget, Expression, Statement};
use oxc_span::Span;

use crate::dom::element::AstDomTransform;
use crate::shared::constants::delegated_events;

impl<'a> AstDomTransform<'a, '_> {
    /// Port of Babel's `key.startsWith("on")` attribute branch: returns the
    /// flat statement group that gets unshifted ahead of the element's other
    /// expressions.
    pub(crate) fn event_statements(
        &mut self,
        span: Span,
        element_id: &str,
        name: &str,
        handler: Expression<'a>,
    ) -> std::vec::Vec<Statement<'a>> {
        let event_name = to_event_name(name);

        if self.should_delegate_event(&event_name) {
            self.register_delegated_event(&event_name);
            // Delegated events on SSR'd markup may have fired before
            // hydration; the template root replays them once via
            // `runHydrationEvents()` (Babel's `hasHydratableEvent`).
            if self.hydratable {
                self.has_hydratable_event = true;
            }

            if let Expression::ArrayExpression(array) = &handler {
                let bound = array
                    .elements
                    .first()
                    .and_then(|element| element.as_expression())
                    .map(|expression| expression.clone_in(self.allocator));
                let data = array
                    .elements
                    .get(1)
                    .and_then(|element| element.as_expression())
                    .map(|expression| expression.clone_in(self.allocator));
                if let Some(bound) = bound {
                    let mut statements = vec![self.delegated_assignment_statement(
                        span,
                        element_id,
                        &format!("$${event_name}"),
                        bound,
                    )];
                    if let Some(data) = data {
                        statements.push(self.delegated_assignment_statement(
                            span,
                            element_id,
                            &format!("$${event_name}Data"),
                            data,
                        ));
                    }
                    return statements;
                }
            }

            if self.is_resolvable_handler(&handler) {
                return vec![self.delegated_assignment_statement(
                    span,
                    element_id,
                    &format!("$${event_name}"),
                    handler,
                )];
            }

            return vec![self.add_event_helper_statement(
                span,
                element_id,
                &event_name,
                handler,
                true,
            )];
        }

        if let Expression::ArrayExpression(array) = &handler {
            let bound = array
                .elements
                .first()
                .and_then(|element| element.as_expression())
                .map(|expression| expression.clone_in(self.allocator));
            let data = array
                .elements
                .get(1)
                .and_then(|element| element.as_expression())
                .map(|expression| expression.clone_in(self.allocator));
            if let Some(bound) = bound {
                let listener = match data {
                    Some(data) => self.event_handler_with_data(span, bound, data),
                    None => bound,
                };
                return vec![self.add_event_listener_statement(
                    span,
                    element_id,
                    &event_name,
                    listener,
                )];
            }
        }

        if self.is_resolvable_handler(&handler) {
            return vec![self.add_event_listener_statement(span, element_id, &event_name, handler)];
        }

        vec![self.add_event_helper_statement(span, element_id, &event_name, handler, false)]
    }

    fn should_delegate_event(&self, event_name: &str) -> bool {
        self.delegate_events
            && (delegated_events(event_name)
                || self
                    .delegated_events
                    .iter()
                    .any(|delegated| delegated == event_name))
    }

    fn register_delegated_event(&mut self, event_name: &str) {
        self.template_state.uses_delegate_events = true;
        if !self
            .template_state
            .delegated_events
            .iter()
            .any(|event| event == event_name)
        {
            self.template_state
                .delegated_events
                .push(event_name.to_string());
        }
    }

    /// `<element_id>.<property> = <handler>;`
    fn delegated_assignment_statement(
        &self,
        span: Span,
        element_id: &str,
        property: &str,
        handler: Expression<'a>,
    ) -> Statement<'a> {
        let target = self.static_member_assignment_target(span, element_id, property);
        self.ast().statement_expression(
            span,
            self.ast()
                .expression_assignment(span, AssignmentOperator::Assign, target, handler),
        )
    }

    /// `<element_id>.addEventListener("<event>", <handler>);`
    fn add_event_listener_statement(
        &self,
        span: Span,
        element_id: &str,
        event_name: &str,
        handler: Expression<'a>,
    ) -> Statement<'a> {
        let callee = self.static_member_expression(span, element_id, "addEventListener");
        let event_name_expression =
            self.ast()
                .expression_string_literal(span, self.ast().str(event_name), None);
        self.ast().statement_expression(
            span,
            self.call_expression(span, callee, vec![event_name_expression, handler]),
        )
    }

    fn add_event_helper_statement(
        &mut self,
        span: Span,
        element_id: &str,
        event_name: &str,
        handler: Expression<'a>,
        delegated: bool,
    ) -> Statement<'a> {
        self.template_state.uses_add_event_listener = true;
        let mut args = vec![
            self.identifier_expression(span, element_id),
            self.ast()
                .expression_string_literal(span, self.ast().str(event_name), None),
            handler,
        ];
        if delegated {
            args.push(self.ast().expression_boolean_literal(span, true));
        }
        self.ast()
            .statement_expression(span, self.call_identifier(span, "_$addEvent", args))
    }

    /// Approximation of Babel's `detectResolvableEventHandler`: the handler
    /// is a function expression, or an identifier whose binding is known to
    /// hold a function (function declaration or function-valued variable).
    fn is_resolvable_handler(&self, handler: &Expression<'_>) -> bool {
        match handler {
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
            Expression::Identifier(identifier) => {
                self.bindings.is_function(identifier.name.as_str())
            }
            _ => false,
        }
    }

    /// `e => <handler>(<data>, e)`
    fn event_handler_with_data(
        &self,
        span: Span,
        handler: Expression<'a>,
        data: Expression<'a>,
    ) -> Expression<'a> {
        let event_name = "e";
        let event_param = self.ast().formal_parameter(
            span,
            self.ast().vec(),
            self.ast()
                .binding_pattern_binding_identifier(span, self.ast().ident(event_name)),
            None,
            None,
            false,
            None,
            false,
            false,
        );
        let params = self.ast().formal_parameters(
            span,
            oxc_ast::ast::FormalParameterKind::ArrowFormalParameters,
            self.ast().vec1(event_param),
            None,
        );
        let call = self.call_expression(
            span,
            handler,
            vec![data, self.identifier_expression(span, event_name)],
        );
        let body = self.ast().function_body(
            span,
            self.ast().vec(),
            self.ast()
                .vec1(self.ast().statement_return(span, Some(call))),
        );
        self.ast()
            .expression_arrow_function(span, false, false, None, params, None, body)
    }

    fn static_member_assignment_target(
        &self,
        span: Span,
        object: &str,
        property: &str,
    ) -> AssignmentTarget<'a> {
        AssignmentTarget::StaticMemberExpression(self.ast().alloc_static_member_expression(
            span,
            self.identifier_expression(span, object),
            self.ast().identifier_name(span, self.ast().ident(property)),
            false,
        ))
    }
}

fn to_event_name(name: &str) -> String {
    name[2..].to_ascii_lowercase()
}
