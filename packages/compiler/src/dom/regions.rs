//! Region emission — the ENVELOPE CONTRACT (Babel's `wrapRegion`, compiler
//! audit 2026-09-02): one `_$region(subject, compute, commit, deep?)` call
//! per template scope.
//!
//! COMPUTE `(_t$, _u$, _d$)` — every binding's expression evaluates here,
//! in SOURCE ORDER, into the envelope `_t$`: eligible chains ride the raw
//! views (`_u$` depth-1; `_w$n` prefix locals resolved through the pending-
//! aware step helper `_d$` for deeper steps); SAFE residuals get direct
//! depth-1 subject reads rewritten; everything else stays UNSUBSTITUTED
//! (per-key tracked through the closed-over proxy), including `prop:` sinks.
//!
//! COMMIT `(_t$, _p$, _f$)` — compares + writes only; `_f$` forces the
//! first run; baselines advance AFTER each write.

use oxc_allocator::CloneIn;
use oxc_ast::ast::{BinaryOperator, Expression, LogicalOperator, Statement};
use oxc_span::Span;

use crate::dom::dynamics::DynamicSlot;
use crate::dom::element::AstDomTransform;
use crate::dom::set_attr::SetAttrOptions;
use crate::shared::constants::{DomPropertyState, dom_with_state};
use crate::shared::region::{
    analyze_region_scope, is_safe_residual, substitute_chains, substitute_residual_subject,
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

        let mut compute_statements = self.ast().vec();
        let mut commit_statements = self.ast().vec();

        // Shared prefix locals for deep chains (shortest first, parents
        // resolve before children): const _w$n = _d$(<parent>, "<key>").
        let mut prefix_names: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        for (i, prefix) in scope.deep_prefixes.iter().enumerate() {
            let parent_name = if prefix.len() == 1 {
                "_u$".to_string()
            } else {
                prefix_names[&prefix[..prefix.len() - 1].join("\u{0}")].clone()
            };
            let var_name = format!("_w${i}");
            prefix_names.insert(prefix.join("\u{0}"), var_name.clone());
            let call = self.call_identifier(
                span,
                "_d$",
                vec![
                    self.identifier_expression(span, &parent_name),
                    self.ast().expression_string_literal(
                        span,
                        self.ast().str(&prefix[prefix.len() - 1]),
                        None,
                    ),
                ],
            );
            compute_statements.push(crate::shared::ast::variable_statement(
                self.allocator,
                span,
                oxc_ast::ast::VariableDeclarationKind::Const,
                &var_name,
                call,
            ));
        }
        let prefix_lookup = |key: &str| prefix_names[key].clone();

        for (index, slot) in dynamics.iter().enumerate() {
            let slot_span = slot.span;
            let prop_name = get_numbered_id(index);

            let mut value = if scope.eligible[index] && !slot.key.starts_with("prop:") {
                substitute_chains(
                    self.allocator,
                    &self.ast(),
                    &slot.value,
                    &scope.subject,
                    "_u$",
                    &prefix_lookup,
                )
            } else if !slot.key.starts_with("prop:") && is_safe_residual(&slot.value) {
                substitute_residual_subject(self.allocator, &slot.value, &scope.subject, "_u$")
            } else {
                // Opaque (or prop: sink): tracked through the closed-over
                // proxy — raw backing identity must never leak.
                slot.value.clone_in(self.allocator)
            };

            if slot.class_property
                && !matches!(
                    value,
                    Expression::BooleanLiteral(_) | Expression::UnaryExpression(_)
                )
            {
                value = self.double_negation(slot_span, value);
            }

            compute_statements.push(self.ast().statement_expression(
                slot_span,
                self.ast().expression_assignment(
                    slot_span,
                    oxc_ast::ast::AssignmentOperator::Assign,
                    self.member_assignment_target(slot_span, "_t$", &prop_name),
                    value,
                ),
            ));

            let value_name = format!("_v${index}");
            commit_statements.push(crate::shared::ast::variable_statement(
                self.allocator,
                slot_span,
                oxc_ast::ast::VariableDeclarationKind::Let,
                &value_name,
                self.static_member(slot_span, "_t$", &prop_name),
            ));

            let changed = self.ast().expression_logical(
                slot_span,
                self.identifier_expression(slot_span, "_f$"),
                LogicalOperator::Or,
                self.ast().expression_binary(
                    slot_span,
                    self.identifier_expression(slot_span, &value_name),
                    BinaryOperator::StrictInequality,
                    self.static_member(slot_span, "_p$", &prop_name),
                ),
            );
            let elem = self.identifier_expression(slot_span, &slot.elem);
            let stateful = dom_with_state(&slot.tag_name, slot.key.trim_start_matches("prop:"))
                == Some(DomPropertyState::Stateful);

            if slot.key == "class" || slot.key == "style" || stateful {
                // Stateful writes consume the previous VALUE — write first,
                // advance the baseline after (a throwing setter must not
                // poison it).
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
                        self.member_assignment_target(slot_span, "_p$", &prop_name),
                        self.identifier_expression(slot_span, &value_name),
                    ),
                ));
                let block = self.ast().statement_block(slot_span, block_statements);
                commit_statements.push(self.ast().statement_if(slot_span, changed, block, None));
            } else {
                let set_attr = self.set_attr_expression(
                    slot_span,
                    elem,
                    &slot.key,
                    self.identifier_expression(slot_span, &value_name),
                    SetAttrOptions {
                        dynamic: true,
                        prev_id: None,
                        tag_name: slot.tag_name.clone(),
                        style_property: slot.style_property,
                        class_property: slot.class_property,
                    },
                );
                let advance = self.ast().expression_assignment(
                    slot_span,
                    oxc_ast::ast::AssignmentOperator::Assign,
                    self.member_assignment_target(slot_span, "_p$", &prop_name),
                    self.identifier_expression(slot_span, &value_name),
                );
                let mut seq = self.ast().vec();
                seq.push(set_attr);
                seq.push(advance);
                commit_statements.push(self.ast().statement_expression(
                    slot_span,
                    self.ast().expression_logical(
                        slot_span,
                        changed,
                        LogicalOperator::And,
                        self.ast().expression_sequence(slot_span, seq),
                    ),
                ));
            }
        }

        let compute_arg =
            self.arrow_with_statements(span, vec!["_t$", "_u$", "_d$"], compute_statements);
        let commit_arg =
            self.arrow_with_statements(span, vec!["_t$", "_p$", "_f$"], commit_statements);

        let mut args = vec![
            self.identifier_expression(span, &scope.subject),
            compute_arg,
            commit_arg,
        ];
        if !scope.deep_prefixes.is_empty() {
            // DEEP flag: eligible chains below the subject's own keys —
            // writes bubble to the region root (see region()/bumpDeep).
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

    /// `<object>.<name>` as an expression.
    fn static_member(&self, span: Span, object: &str, name: &str) -> Expression<'a> {
        Expression::StaticMemberExpression(self.ast().alloc_static_member_expression(
            span,
            self.identifier_expression(span, object),
            self.ast().identifier_name(span, self.ast().ident(name)),
            false,
        ))
    }

    /// `<object>.<name>` as an assignment target.
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
