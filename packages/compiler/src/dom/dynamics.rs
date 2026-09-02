use oxc_allocator::CloneIn;
use oxc_ast::ast::{BinaryOperator, Expression, LogicalOperator, Statement, UnaryOperator};
use oxc_span::Span;

use crate::dom::element::AstDomTransform;
use crate::dom::set_attr::SetAttrOptions;
use crate::shared::constants::{DomPropertyState, dom_with_state};
use crate::shared::utils::get_numbered_id;

/// One deferred dynamic attribute binding, mirroring Babel's
/// `results.dynamics` entries. Collected across a whole template root and
/// wrapped into a single effect by `wrap_dynamics_statement`.
pub(crate) struct DynamicSlot<'a> {
    pub(crate) span: Span,
    pub(crate) elem: String,
    pub(crate) key: String,
    pub(crate) value: Expression<'a>,
    pub(crate) tag_name: String,
    pub(crate) style_property: bool,
    pub(crate) class_property: bool,
}

impl<'a> AstDomTransform<'a, '_> {
    /// Port of Babel's `wrapDynamics` (dom/template.ts): one dynamic binding
    /// gets its own effect; multiple bindings share a single keyed effect
    /// with a previous-values object.
    pub(crate) fn wrap_dynamics_statement(
        &mut self,
        mut dynamics: std::vec::Vec<DynamicSlot<'a>>,
    ) -> Option<Statement<'a>> {
        if dynamics.is_empty() {
            return None;
        }
        self.template_state.uses_effect = true;

        if dynamics.len() == 1 {
            let slot = dynamics.pop().expect("single dynamic slot exists");
            let span = slot.span;
            let use_prev = slot.key == "class" || slot.key == "style";

            let value = if slot.class_property
                && !matches!(
                    slot.value,
                    Expression::BooleanLiteral(_) | Expression::UnaryExpression(_)
                ) {
                self.double_negation(span, slot.value)
            } else {
                slot.value
            };

            let getter = wrap_for_effect(self, span, value);
            let elem = self.identifier_expression(span, &slot.elem);
            let value_ident = self.identifier_expression(span, "_v$");
            let prev_id = use_prev.then(|| self.identifier_expression(span, "_$p"));
            let set_attr = self.set_attr_expression(
                span,
                elem,
                &slot.key,
                value_ident,
                SetAttrOptions {
                    dynamic: true,
                    prev_id,
                    tag_name: slot.tag_name,
                    style_property: slot.style_property,
                    class_property: slot.class_property,
                },
            );
            let statement = self.ast().statement_expression(span, set_attr);
            let params = if use_prev {
                vec!["_v$", "_$p"]
            } else {
                vec!["_v$"]
            };
            let setter = self.arrow_with_statements(span, params, self.ast().vec1(statement));
            let effect_local = self.effect_wrapper_local();
            return Some(self.ast().statement_expression(
                span,
                self.call_identifier(span, &effect_local, vec![getter, setter]),
            ));
        }

        let span = dynamics
            .first()
            .map_or_else(Span::default, |slot| slot.span);
        let mut value_props = self.ast().vec();
        let mut statements = self.ast().vec();
        let mut param_names = std::vec::Vec::new();

        for (index, slot) in dynamics.into_iter().enumerate() {
            let prop_name = get_numbered_id(index);
            let slot_span = slot.span;

            let value = if slot.class_property
                && !matches!(
                    slot.value,
                    Expression::BooleanLiteral(_) | Expression::UnaryExpression(_)
                ) {
                self.double_negation(slot_span, slot.value)
            } else {
                slot.value
            };
            value_props.push(self.object_property(slot_span, &prop_name, value));

            let elem = self.identifier_expression(slot_span, &slot.elem);
            let prop_ident = self.identifier_expression(slot_span, &prop_name);
            let stateful = dom_with_state(&slot.tag_name, slot.key.trim_start_matches("prop:"))
                == Some(DomPropertyState::Stateful);

            if slot.key == "class" || slot.key == "style" || stateful {
                let prev_member = self.optional_prev_member(slot_span, &prop_name);
                let set_attr = self.set_attr_expression(
                    slot_span,
                    elem,
                    &slot.key,
                    prop_ident,
                    SetAttrOptions {
                        dynamic: true,
                        prev_id: Some(prev_member),
                        tag_name: slot.tag_name,
                        style_property: false,
                        class_property: false,
                    },
                );
                statements.push(self.ast().statement_expression(slot_span, set_attr));
            } else {
                let changed = if slot.key == "textContent" {
                    // `!_p$ || <v> !== _p$.<v>`
                    let not_prev = self.ast().expression_unary(
                        slot_span,
                        UnaryOperator::LogicalNot,
                        self.identifier_expression(slot_span, "_p$"),
                    );
                    let member = Expression::StaticMemberExpression(
                        self.ast().alloc_static_member_expression(
                            slot_span,
                            self.identifier_expression(slot_span, "_p$"),
                            self.ast()
                                .identifier_name(slot_span, self.ast().ident(&prop_name)),
                            false,
                        ),
                    );
                    let compare = self.ast().expression_binary(
                        slot_span,
                        prop_ident.clone_in(self.allocator),
                        BinaryOperator::StrictInequality,
                        member,
                    );
                    self.ast()
                        .expression_logical(slot_span, not_prev, LogicalOperator::Or, compare)
                } else {
                    self.ast().expression_binary(
                        slot_span,
                        prop_ident.clone_in(self.allocator),
                        BinaryOperator::StrictInequality,
                        self.optional_prev_member(slot_span, &prop_name),
                    )
                };
                let set_attr = self.set_attr_expression(
                    slot_span,
                    elem,
                    &slot.key,
                    prop_ident,
                    SetAttrOptions {
                        dynamic: true,
                        prev_id: None,
                        tag_name: slot.tag_name,
                        style_property: slot.style_property,
                        class_property: slot.class_property,
                    },
                );
                statements.push(self.ast().statement_expression(
                    slot_span,
                    self.ast().expression_logical(
                        slot_span,
                        changed,
                        LogicalOperator::And,
                        set_attr,
                    ),
                ));
            }
            param_names.push(prop_name);
        }

        let values_object = self.ast().expression_object(span, value_props);
        let getter = self.arrow_with_return(span, std::vec::Vec::new(), values_object);
        let setter = self.arrow_with_destructured_params(span, &param_names, "_p$", statements);
        let effect_local = self.effect_wrapper_local();
        Some(self.ast().statement_expression(
            span,
            self.call_identifier(span, &effect_local, vec![getter, setter]),
        ))
    }

    /// `_p$?.<name>`
    fn optional_prev_member(&self, span: Span, name: &str) -> Expression<'a> {
        let member = self.ast().alloc_static_member_expression(
            span,
            self.identifier_expression(span, "_p$"),
            self.ast().identifier_name(span, self.ast().ident(name)),
            true,
        );
        self.ast().expression_chain(
            span,
            oxc_ast::ast::ChainElement::StaticMemberExpression(member),
        )
    }

    /// `({ a, b }, _p$) => { ... }`
    fn arrow_with_destructured_params(
        &self,
        span: Span,
        names: &[String],
        prev_name: &str,
        statements: oxc_allocator::Vec<'a, Statement<'a>>,
    ) -> Expression<'a> {
        let properties = self.ast().vec_from_iter(names.iter().map(|name| {
            self.ast().binding_property(
                span,
                self.ast()
                    .property_key_static_identifier(span, self.ast().ident(name)),
                self.ast()
                    .binding_pattern_binding_identifier(span, self.ast().ident(name)),
                true,
                false,
            )
        }));
        let object_pattern = self
            .ast()
            .binding_pattern_object_pattern(span, properties, None);
        let first = self.ast().formal_parameter(
            span,
            self.ast().vec(),
            object_pattern,
            None,
            None,
            false,
            None,
            false,
            false,
        );
        let second = self.ast().formal_parameter(
            span,
            self.ast().vec(),
            self.ast()
                .binding_pattern_binding_identifier(span, self.ast().ident(prev_name)),
            None,
            None,
            false,
            None,
            false,
            false,
        );
        let mut params = self.ast().vec();
        params.push(first);
        params.push(second);
        let params = self.ast().formal_parameters(
            span,
            oxc_ast::ast::FormalParameterKind::ArrowFormalParameters,
            params,
            None,
        );
        let body = self.ast().function_body(span, self.ast().vec(), statements);
        self.ast()
            .expression_arrow_function(span, false, false, None, params, None, body)
    }
}

/// Babel's `wrapForEffect`: a zero-argument IIFE unwraps to its callee;
/// anything else becomes `() => value`. The wrapper is a concise arrow —
/// deferred JSX inside stays in expression position, so the outer traversal
/// lowers it to an IIFE instead of inlining statements into the getter.
fn wrap_for_effect<'a>(
    ctx: &AstDomTransform<'a, '_>,
    span: Span,
    value: Expression<'a>,
) -> Expression<'a> {
    match &value {
        Expression::CallExpression(call)
            if call.arguments.is_empty()
                && matches!(
                    call.callee,
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                ) =>
        {
            call.callee.clone_in(ctx.allocator)
        }
        _ => crate::shared::ast::concise_arrow_thunk(ctx.allocator, span, value),
    }
}
