//! Region emission (Babel's `wrapRegion` in dom/template.ts, DESIGN-REGIONS
//! §9-10): one `_$region(subject, tracked, body, deep?)` call per template
//! scope — eligible bindings read the commit-time RAW (`_n$`) against scalar
//! baselines (`_p$`), tracked residuals evaluate in the compute (`_t$`,
//! direct depth-1 subject reads rewritten onto `_u$`), and deep chains set
//! the flag argument (writes bubble; no witness subscriptions). The runtime
//! combinator owns admission, demotion, and the classic fallback, which
//! reruns the SAME body with the proxy as `_n$`.

use oxc_ast::ast::{BinaryOperator, Expression, LogicalOperator, Statement};
use oxc_span::Span;

use crate::dom::dynamics::DynamicSlot;
use crate::dom::element::AstDomTransform;
use crate::dom::set_attr::SetAttrOptions;
use crate::shared::constants::{DomPropertyState, dom_with_state};
use crate::shared::region::{
    analyze_region_scope, substitute_residual_subject, substitute_subject,
};
use crate::shared::utils::get_numbered_id;

impl<'a> AstDomTransform<'a, '_> {
    /// Try region emission for a template scope's dynamics. Returns None
    /// when the scope has no eligible subject — the caller falls through to
    /// the classic grouped effect.
    pub(crate) fn wrap_region_statement(
        &mut self,
        dynamics: &std::vec::Vec<DynamicSlot<'a>>,
    ) -> Option<Statement<'a>> {
        if dynamics.is_empty() {
            return None;
        }
        let values: std::vec::Vec<&Expression<'_>> =
            dynamics.iter().map(|slot| &slot.value).collect();
        let bindings = &self.bindings;
        let scope = analyze_region_scope(&values, |name| {
            bindings.has_binding(name) && !bindings.is_reassigned(name)
        })?;

        self.template_state.uses_region = true;
        let span = dynamics
            .first()
            .map_or_else(Span::default, |slot| slot.span);

        let mut tracked_assigns = self.ast().vec();
        let mut body_statements = self.ast().vec();
        let mut residuals = 0usize;

        for (index, slot) in dynamics.iter().enumerate() {
            let slot_span = slot.span;
            let prop_name = get_numbered_id(index);
            let value_name = format!("_v${index}");

            let mut value = if scope.eligible[index] {
                substitute_subject(self.allocator, &slot.value, &scope.subject, "_n$")
            } else {
                let residual = substitute_residual_subject(
                    self.allocator,
                    &slot.value,
                    &scope.subject,
                    "_u$",
                );
                let slot_name = format!("r{residuals}");
                residuals += 1;
                tracked_assigns.push(self.ast().statement_expression(
                    slot_span,
                    self.ast().expression_assignment(
                        slot_span,
                        oxc_ast::ast::AssignmentOperator::Assign,
                        self.tracked_member_target(slot_span, &slot_name),
                        residual,
                    ),
                ));
                self.static_member(slot_span, "_t$", &slot_name)
            };

            if slot.class_property
                && !matches!(
                    value,
                    Expression::BooleanLiteral(_) | Expression::UnaryExpression(_)
                )
            {
                value = self.double_negation(slot_span, value);
            }

            body_statements.push(crate::shared::ast::variable_statement(
                self.allocator,
                slot_span,
                oxc_ast::ast::VariableDeclarationKind::Let,
                &value_name,
                value,
            ));

            let value_ident = self.identifier_expression(slot_span, &value_name);
            let prev_member = self.static_member(slot_span, "_p$", &prop_name);
            let elem = self.identifier_expression(slot_span, &slot.elem);
            let stateful = dom_with_state(&slot.tag_name, slot.key.trim_start_matches("prop:"))
                == Some(DomPropertyState::Stateful);
            let changed = self.ast().expression_binary(
                slot_span,
                value_ident,
                BinaryOperator::StrictInequality,
                prev_member,
            );

            if slot.key == "class" || slot.key == "style" || stateful {
                // Stateful writes consume the previous VALUE — advance the
                // baseline in a block after the write.
                let set_attr = self.set_attr_expression(
                    slot_span,
                    elem,
                    &slot.key,
                    self.identifier_expression(slot_span, &value_name),
                    SetAttrOptions {
                        dynamic: true,
                        prev_id: Some(self.static_member(slot_span, "_p$", &prop_name)),
                        tag_name: slot.tag_name.clone(),
                        style_property: false,
                        class_property: false,
                    },
                );
                let mut block_statements = self.ast().vec();
                block_statements.push(self.ast().statement_expression(slot_span, set_attr));
                block_statements.push(self.ast().statement_expression(
                    slot_span,
                    self.ast().expression_assignment(
                        slot_span,
                        oxc_ast::ast::AssignmentOperator::Assign,
                        self.prev_member_target(slot_span, &prop_name),
                        self.identifier_expression(slot_span, &value_name),
                    ),
                ));
                let block = self.ast().statement_block(slot_span, block_statements);
                body_statements.push(self.ast().statement_if(slot_span, changed, block, None));
            } else {
                let advancing_value = self.ast().expression_assignment(
                    slot_span,
                    oxc_ast::ast::AssignmentOperator::Assign,
                    self.prev_member_target(slot_span, &prop_name),
                    self.identifier_expression(slot_span, &value_name),
                );
                let set_attr = self.set_attr_expression(
                    slot_span,
                    elem,
                    &slot.key,
                    advancing_value,
                    SetAttrOptions {
                        dynamic: true,
                        prev_id: None,
                        tag_name: slot.tag_name.clone(),
                        style_property: slot.style_property,
                        class_property: slot.class_property,
                    },
                );
                body_statements.push(self.ast().statement_expression(
                    slot_span,
                    self.ast().expression_logical(
                        slot_span,
                        changed,
                        LogicalOperator::And,
                        set_attr,
                    ),
                ));
            }
        }

        let tracked_arg = if tracked_assigns.is_empty() {
            self.ast().expression_null_literal(span)
        } else {
            self.arrow_with_statements(span, vec!["_t$", "_u$"], tracked_assigns)
        };
        let body_arg = self.arrow_with_statements(span, vec!["_n$", "_t$", "_p$"], body_statements);

        let mut args = vec![
            self.identifier_expression(span, &scope.subject),
            tracked_arg,
            body_arg,
        ];
        if scope.deep {
            // DEEP flag: eligible chains below the subject's own keys — the
            // runtime flags the record as a deep-region root; writes bubble.
            args.push(self.ast().expression_numeric_literal(
                span,
                1.0,
                None,
                oxc_ast::ast::NumberBase::Decimal,
            ));
        }
        let region_local = "_$region".to_string();
        Some(
            self.ast()
                .statement_expression(span, self.call_identifier(span, &region_local, args)),
        )
    }

    /// `_p$.<name>` as an expression.
    fn static_member(&self, span: Span, object: &str, name: &str) -> Expression<'a> {
        Expression::StaticMemberExpression(self.ast().alloc_static_member_expression(
            span,
            self.identifier_expression(span, object),
            self.ast().identifier_name(span, self.ast().ident(name)),
            false,
        ))
    }

    /// `_p$.<name>` as an assignment target.
    fn prev_member_target(
        &self,
        span: Span,
        name: &str,
    ) -> oxc_ast::ast::AssignmentTarget<'a> {
        self.member_assignment_target(span, "_p$", name)
    }

    /// `_t$.<name>` as an assignment target.
    fn tracked_member_target(
        &self,
        span: Span,
        name: &str,
    ) -> oxc_ast::ast::AssignmentTarget<'a> {
        self.member_assignment_target(span, "_t$", name)
    }

    fn member_assignment_target(
        &self,
        span: Span,
        object: &str,
        name: &str,
    ) -> oxc_ast::ast::AssignmentTarget<'a> {
        oxc_ast::ast::AssignmentTarget::StaticMemberExpression(
            self.ast().alloc_static_member_expression(
                span,
                self.identifier_expression(span, object),
                self.ast().identifier_name(span, self.ast().ident(name)),
                false,
            ),
        )
    }
}
