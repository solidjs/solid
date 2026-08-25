use oxc_allocator::CloneIn;
use oxc_ast::ast::{
    AssignmentOperator, AssignmentTarget, Expression, LogicalOperator, UnaryOperator,
};
use oxc_span::Span;

use crate::dom::element::AstDomTransform;
use crate::shared::constants::{child_properties, dom_with_state, namespaces};

/// Options mirroring Babel's `setAttr(path, elem, name, value, options)`.
#[derive(Default)]
pub(crate) struct SetAttrOptions<'a> {
    pub(crate) dynamic: bool,
    pub(crate) prev_id: Option<Expression<'a>>,
    pub(crate) tag_name: String,
    pub(crate) style_property: bool,
    pub(crate) class_property: bool,
}

impl<'a> AstDomTransform<'a, '_> {
    /// Faithful port of Babel's `setAttr` (dom/element.ts): the single point
    /// that decides how one attribute write compiles (helper call, property
    /// assignment, classList toggle, ...), shared between static expressions
    /// and effect-wrapped dynamics.
    pub(crate) fn set_attr_expression(
        &mut self,
        span: Span,
        elem: Expression<'a>,
        name: &str,
        value: Expression<'a>,
        options: SetAttrOptions<'a>,
    ) -> Expression<'a> {
        let mut name = name.to_string();
        let mut namespace = None;
        let split = name
            .split_once(':')
            .map(|(prefix, rest)| (prefix.to_string(), rest.to_string()));
        if let Some((prefix, rest)) = split {
            // Only `prop:` is a reserved namespace on this branch; the
            // `style:`/`class:` prefixes below are the synthetic markers from
            // the object splitters, gated by the explicit flags.
            if prefix == "prop" && !rest.is_empty() {
                namespace = Some("prop");
                name = rest;
            } else if !rest.is_empty()
                && ((options.style_property && prefix == "style")
                    || (options.class_property && prefix == "class"))
            {
                name = rest;
            }
        }

        if options.style_property {
            self.template_state.uses_set_style_property = true;
            // Babel unwraps `ident = value` assignments to the assigned value.
            let value = match value {
                Expression::AssignmentExpression(assignment)
                    if matches!(
                        assignment.left,
                        AssignmentTarget::AssignmentTargetIdentifier(_)
                    ) =>
                {
                    assignment.right.clone_in(self.allocator)
                }
                value => value,
            };
            return self.call_identifier(
                span,
                "_$setStyleProperty",
                vec![
                    elem,
                    self.ast()
                        .expression_string_literal(span, self.ast().str(&name), None),
                    value,
                ],
            );
        }

        if options.class_property {
            let value = if options.dynamic {
                value
            } else {
                self.double_negation(span, value)
            };
            let toggle = self.static_member_expression_from_expression(
                span,
                self.static_member_expression_from_expression(span, elem, "classList"),
                "toggle",
            );
            return self.call_expression(
                span,
                toggle,
                vec![
                    self.ast()
                        .expression_string_literal(span, self.ast().str(&name), None),
                    value,
                ],
            );
        }

        if name == "style" {
            self.template_state.uses_style = true;
            let mut args = vec![elem, value];
            if let Some(prev) = options.prev_id {
                args.push(prev);
            }
            return self.call_identifier(span, "_$style", args);
        }

        if name == "class" {
            self.template_state.uses_class_name = true;
            let mut args = vec![elem, value];
            if let Some(prev) = options.prev_id {
                args.push(prev);
            }
            return self.call_identifier(span, "_$className", args);
        }

        if options.dynamic && name == "textContent" {
            if self.hydratable {
                self.template_state.uses_set_property = true;
                return self.call_identifier(
                    span,
                    "_$setProperty",
                    vec![
                        elem,
                        self.ast()
                            .expression_string_literal(span, self.ast().str("data"), None),
                        value,
                    ],
                );
            }
            return self.member_assignment(span, elem, "data", value);
        }

        let is_child_prop = child_properties(&name);
        let is_locked = dom_with_state(&options.tag_name, &name).is_some();

        if is_child_prop || namespace == Some("prop") || is_locked {
            if self.hydratable && namespace != Some("prop") && !is_locked {
                self.template_state.uses_set_property = true;
                return self.call_identifier(
                    span,
                    "_$setProperty",
                    vec![
                        elem,
                        self.ast()
                            .expression_string_literal(span, self.ast().str(&name), None),
                        value,
                    ],
                );
            }

            // handle select/options... mirrors Babel's queueMicrotask race
            // workaround for `<select value>`.
            if name == "value" && options.tag_name == "select" {
                let assignment = self.member_assignment_expression(
                    span,
                    elem.clone_in(self.allocator),
                    &name,
                    value.clone_in(self.allocator),
                );
                let queued = self.call_expression(
                    span,
                    self.identifier_expression(span, "queueMicrotask"),
                    vec![self.arrow_return_expression(
                        span,
                        self.member_assignment_expression(span, elem, &name, value),
                    )],
                );
                return self.ast().expression_logical(
                    span,
                    queued,
                    LogicalOperator::Or,
                    assignment,
                );
            }
            if (name == "value" || name == "defaultValue")
                && (options.tag_name == "input" || options.tag_name == "textarea")
                && !matches!(
                    value,
                    Expression::StringLiteral(_) | Expression::NumericLiteral(_)
                )
            {
                // prevents undefined on input/textarea.value, fallback to ""
                let value = self.ast().expression_logical(
                    span,
                    value,
                    LogicalOperator::Coalesce,
                    self.ast()
                        .expression_string_literal(span, self.ast().str(""), None),
                );
                return self.member_assignment_expression(span, elem, &name, value);
            }
            return self.member_assignment_expression(span, elem, &name, value);
        }

        if let Some(ns) = name
            .split_once(':')
            .and_then(|(prefix, _)| namespaces(prefix))
        {
            self.template_state.uses_set_attribute_ns = true;
            return self.call_identifier(
                span,
                "_$setAttributeNS",
                vec![
                    elem,
                    self.ast()
                        .expression_string_literal(span, self.ast().str(ns), None),
                    self.ast()
                        .expression_string_literal(span, self.ast().str(&name), None),
                    value,
                ],
            );
        }

        self.template_state.uses_set_attribute = true;
        self.call_identifier(
            span,
            "_$setAttribute",
            vec![
                elem,
                self.ast()
                    .expression_string_literal(span, self.ast().str(&name), None),
                value,
            ],
        )
    }

    pub(crate) fn double_negation(&self, span: Span, value: Expression<'a>) -> Expression<'a> {
        self.ast().expression_unary(
            span,
            UnaryOperator::LogicalNot,
            self.ast()
                .expression_unary(span, UnaryOperator::LogicalNot, value),
        )
    }

    fn member_assignment(
        &self,
        span: Span,
        object: Expression<'a>,
        property: &str,
        value: Expression<'a>,
    ) -> Expression<'a> {
        self.member_assignment_expression(span, object, property, value)
    }

    /// `<object>.<property> = <value>`
    pub(crate) fn member_assignment_expression(
        &self,
        span: Span,
        object: Expression<'a>,
        property: &str,
        value: Expression<'a>,
    ) -> Expression<'a> {
        let target =
            AssignmentTarget::StaticMemberExpression(self.ast().alloc_static_member_expression(
                span,
                object,
                self.ast().identifier_name(span, self.ast().ident(property)),
                false,
            ));
        self.ast()
            .expression_assignment(span, AssignmentOperator::Assign, target, value)
    }
}
