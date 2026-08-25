use crate::error::Result;
use oxc_allocator::CloneIn;
use oxc_ast::ast::{Expression, FormalParameterKind, JSXAttributeItem, Statement};
use oxc_span::Span;

use crate::dom::dynamics::DynamicSlot;
use crate::dom::element::AstDomTransform;
use crate::dom::set_attr::SetAttrOptions;
use crate::shared::attr_plan::{AttrPlan, AttrPlanOutcome, AttrPlanner, ConfidentValue, PlanValue};
use crate::shared::bindings::push_unique;
use crate::shared::constants::{
    ALWAYS_CLOSE_ELEMENTS, BLOCK_ELEMENTS, child_properties, inline_elements,
};
use crate::shared::refs::{callable_test, ref_assignment_fallback};
use crate::shared::utils::{
    format_attribute_value_with_quotes, format_number, is_void_element,
    normalize_static_attribute_value,
};

#[derive(Clone, Default)]
pub(crate) struct CloseTagContext {
    pub(crate) last_element: bool,
    pub(crate) to_be_closed: Option<std::vec::Vec<String>>,
}

impl CloseTagContext {
    pub(crate) fn root() -> Self {
        Self {
            last_element: true,
            to_be_closed: None,
        }
    }
}

/// What one planned attribute contributes, decided by the pure classifier so
/// the static-template fast path and the full emission agree exactly.
enum PlanDisposition {
    /// No output at all (`attr={false}`, empty `prop:`, hydratable-only
    /// directives, ...).
    Skip,
    /// Inline on the template: bare attribute (`None`) or `key=value`.
    Inline(Option<String>),
    /// Requires runtime statements (setters, refs, events, or dynamics).
    Runtime,
}

/// Outcome of lowering an element's attributes.
pub(crate) struct AttrsLowering<'a> {
    /// Dynamic `textContent` needs the single-space placeholder child
    /// appended to the template.
    pub(crate) needs_text_placeholder: bool,
    /// Babel's textarea `value` fold replaced the element's children with
    /// this single synthesized child.
    pub(crate) children_replacement: Option<oxc_ast::ast::JSXChild<'a>>,
}

impl<'a> AstDomTransform<'a, '_> {
    /// The shared attribute preprocessing context for this transform's
    /// current state (the dom generate is never SSR).
    pub(crate) fn attr_planner(&self) -> AttrPlanner<'a, '_> {
        AttrPlanner {
            allocator: self.allocator,
            source: self.source,
            static_marker: &self.static_marker,
            bindings: &self.bindings,
            inline_styles: self.inline_styles,
            skip_xmlns_attribute: self.skip_xmlns_attribute,
            is_ssr: false,
        }
    }

    pub(crate) fn plan_attributes(
        &self,
        attributes: &[JSXAttributeItem<'a>],
        tag_name: &str,
    ) -> Result<AttrPlanOutcome<'a>> {
        self.attr_planner().plan_attributes(attributes, tag_name)
    }

    pub(crate) fn evaluate_confident(&self, expression: &Expression<'a>) -> Option<ConfidentValue> {
        self.attr_planner().evaluate_confident(expression)
    }

    /// Lowers an element's attributes, mirroring Babel's
    /// `transformAttributes`: preprocessing passes, then a single emission
    /// loop that routes each attribute to the template, static setters,
    /// unshifted refs/events, or the deferred dynamics batch.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn lower_template_attributes(
        &mut self,
        attributes: &[JSXAttributeItem<'a>],
        tag_name: &str,
        element_id: &str,
        has_children: bool,
        template: &mut String,
        declarations: &mut std::vec::Vec<Statement<'a>>,
        operations: &mut std::vec::Vec<Statement<'a>>,
        dynamics: &mut std::vec::Vec<DynamicSlot<'a>>,
    ) -> Result<AttrsLowering<'a>> {
        // Claim contract: a[href] / form[action] elements are claimed at
        // creation so registered consumers (e.g. a router's link-state layer)
        // see them. Babel pushes the claim ahead of the attribute
        // expressions (refs/events still unshift in front of it).
        let claim_target = crate::dom::element::is_claim_target(tag_name, attributes);

        if attributes
            .iter()
            .any(|attr| matches!(attr, JSXAttributeItem::SpreadAttribute(_)))
        {
            // Babel filters `ref` attributes out of the spread props and
            // processes them as regular (unshifted) attributes.
            let mut front_groups: std::vec::Vec<std::vec::Vec<Statement<'a>>> =
                std::vec::Vec::new();
            for attr in attributes {
                let JSXAttributeItem::Attribute(attr) = attr else {
                    continue;
                };
                let oxc_ast::ast::JSXAttributeName::Identifier(name) = &attr.name else {
                    continue;
                };
                if name.name != "ref" {
                    continue;
                }
                if let Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) =
                    &attr.value
                    && let Some(expression) = container.expression.as_expression()
                {
                    let value = expression.clone_in(self.allocator);
                    front_groups.push(self.dom_ref_statements(attr.span, element_id, value));
                }
            }
            for group in front_groups.into_iter().rev() {
                operations.extend(group);
            }
            if claim_target {
                operations.push(self.claim_element_statement(element_id));
            }
            operations.push(self.spread_attribute_statement(
                attributes,
                tag_name,
                element_id,
                has_children,
            )?);
            return Ok(AttrsLowering {
                needs_text_placeholder: false,
                children_replacement: None,
            });
        }

        let AttrPlanOutcome {
            plans,
            children_replacement,
        } = self.plan_attributes(attributes, tag_name)?;
        let mut exprs: std::vec::Vec<Statement<'a>> = std::vec::Vec::new();
        if claim_target {
            exprs.push(self.claim_element_statement(element_id));
        }
        let mut front_groups: std::vec::Vec<std::vec::Vec<Statement<'a>>> = std::vec::Vec::new();
        let mut needs_placeholder = false;

        for plan in plans {
            match self.classify_plan(&plan) {
                PlanDisposition::Skip => {}
                PlanDisposition::Inline(value) => match value {
                    None => append_bare_attribute(template, &plan.key, self.omit_attribute_spacing),
                    Some(value) => self.append_static_attribute_value(template, &plan.key, &value),
                },
                PlanDisposition::Runtime => {
                    self.lower_runtime_attribute(
                        plan,
                        tag_name,
                        element_id,
                        declarations,
                        &mut exprs,
                        &mut front_groups,
                        dynamics,
                        &mut needs_placeholder,
                    )?;
                }
            }
        }

        // Babel unshifts each ref/event group as encountered, so the last
        // group ends up first; groups keep their internal order.
        for group in front_groups {
            exprs.splice(0..0, group);
        }
        operations.extend(exprs);
        Ok(AttrsLowering {
            needs_text_placeholder: needs_placeholder,
            children_replacement,
        })
    }

    /// Pure classification of one planned attribute, mirroring Babel's
    /// static-vs-expression branch in the attribute loop.
    fn classify_plan(&self, plan: &AttrPlan<'a>) -> PlanDisposition {
        if self.hydratable && plan.key == "$ServerOnly" {
            return PlanDisposition::Skip;
        }
        // Native `children` is never a template attribute or a property write.
        // Without a spread it was promoted to a child; with a spread it lives
        // in the merged props. Either way this planned attribute is a no-op.
        if plan.key == "children" {
            return PlanDisposition::Skip;
        }
        let reserved = plan.style_property || plan.class_property || plan.key.starts_with("prop:");
        match &plan.value {
            PlanValue::None => {
                if reserved {
                    // Babel wraps valueless namespaced attributes into empty
                    // expression containers, which are then skipped.
                    PlanDisposition::Skip
                } else {
                    PlanDisposition::Inline(None)
                }
            }
            PlanValue::Literal(value) => {
                if reserved || child_properties(&plan.key) {
                    PlanDisposition::Runtime
                } else {
                    PlanDisposition::Inline(Some(value.clone()))
                }
            }
            PlanValue::Expr(expression) => {
                if reserved {
                    return PlanDisposition::Runtime;
                }
                match expression {
                    Expression::BooleanLiteral(literal) => {
                        // `<el attr={true}/>` becomes `<el attr/>`;
                        // `<el attr={false}/>` becomes `<el/>`.
                        if literal.value {
                            PlanDisposition::Inline(None)
                        } else {
                            PlanDisposition::Skip
                        }
                    }
                    Expression::StringLiteral(literal) => {
                        if child_properties(&plan.key) {
                            PlanDisposition::Runtime
                        } else {
                            PlanDisposition::Inline(Some(literal.value.to_string()))
                        }
                    }
                    Expression::NumericLiteral(literal) => {
                        if child_properties(&plan.key) {
                            PlanDisposition::Runtime
                        } else {
                            PlanDisposition::Inline(Some(format_number(literal.value)))
                        }
                    }
                    _ => PlanDisposition::Runtime,
                }
            }
        }
    }

    /// The expression branch of Babel's attribute loop: refs and events
    /// unshift, dynamics defer into the shared batch, everything else emits
    /// a static `setAttr` statement.
    #[allow(clippy::too_many_arguments)]
    fn lower_runtime_attribute(
        &mut self,
        plan: AttrPlan<'a>,
        tag_name: &str,
        element_id: &str,
        declarations: &mut std::vec::Vec<Statement<'a>>,
        exprs: &mut std::vec::Vec<Statement<'a>>,
        front_groups: &mut std::vec::Vec<std::vec::Vec<Statement<'a>>>,
        dynamics: &mut std::vec::Vec<DynamicSlot<'a>>,
        needs_placeholder: &mut bool,
    ) -> Result<()> {
        let span = plan.span;
        let raw = match plan.value {
            PlanValue::Expr(expression) => expression,
            PlanValue::Literal(value) => {
                self.ast()
                    .expression_string_literal(span, self.ast().str(&value), None)
            }
            PlanValue::None => return Ok(()),
        };

        // `children` is never a property write (see `classify_plan`).
        if plan.key == "children" {
            return Ok(());
        }

        if plan.key == "ref" {
            front_groups.push(self.dom_ref_statements(span, element_id, raw));
            return Ok(());
        }

        if plan.key.starts_with("on") {
            front_groups.push(self.dom_event_statements(span, element_id, &plan.key, raw));
            return Ok(());
        }

        let dynamic = self.effect_wrapper.is_some()
            && !plan.marker_static
            && (self.classify().is_dynamic(None, &raw, false)
                || ((plan.key == "class" || plan.key == "style")
                    && self.evaluate_confident(&raw).is_none()));

        // Babel stores the raw expression — JSX inside an attribute value
        // (static or dynamic) is only transformed by the outer traversal
        // after the root's own template registers (see `lower_deferred_jsx`),
        // which also keeps `wrapForEffect` from unwrapping the lowered IIFE.
        let value = raw;

        if dynamic {
            let elem = if plan.key == "textContent" {
                // Dynamic textContent targets a dedicated text node: the
                // template gets a single-space placeholder child and updates
                // write to its `data`.
                let text_id = self.next_element_id();
                let first_child = self.static_member_expression(span, element_id, "firstChild");
                declarations.push(self.variable_statement(span, &text_id, first_child));
                *needs_placeholder = true;
                text_id
            } else {
                element_id.to_string()
            };
            dynamics.push(DynamicSlot {
                span,
                elem,
                key: plan.key,
                value,
                tag_name: tag_name.to_string(),
                style_property: plan.style_property,
                class_property: plan.class_property,
            });
            return Ok(());
        }

        let elem = self.identifier_expression(span, element_id);
        let set_attr = self.set_attr_expression(
            span,
            elem,
            &plan.key,
            value,
            SetAttrOptions {
                dynamic: false,
                prev_id: None,
                tag_name: tag_name.to_string(),
                style_property: plan.style_property,
                class_property: plan.class_property,
            },
        );
        exprs.push(self.ast().statement_expression(span, set_attr));
        Ok(())
    }

    /// Port of Babel's `key === "ref"` branch: emitted as a flat group of
    /// statements unshifted ahead of the element's other expressions.
    fn dom_ref_statements(
        &mut self,
        span: Span,
        element_id: &str,
        mut value: Expression<'a>,
    ) -> std::vec::Vec<Statement<'a>> {
        // Normalize expressions for non-null and type-as.
        loop {
            match value {
                Expression::TSNonNullExpression(inner) => {
                    value = inner.clone_in(self.allocator).unbox().expression;
                }
                Expression::TSAsExpression(inner) => {
                    value = inner.clone_in(self.allocator).unbox().expression;
                }
                _ => break,
            }
        }

        let is_constant = matches!(
            &value,
            Expression::Identifier(identifier)
                if self.bindings.is_const(identifier.name.as_str())
        );
        let is_lval = matches!(
            &value,
            Expression::Identifier(_)
                | Expression::StaticMemberExpression(_)
                | Expression::ComputedMemberExpression(_)
        );

        if is_constant
            || matches!(
                value,
                Expression::ArrowFunctionExpression(_)
                    | Expression::FunctionExpression(_)
                    | Expression::ArrayExpression(_)
            )
        {
            self.template_state.uses_ref = true;
            let getter = self.arrow_with_return(span, std::vec::Vec::new(), value);
            let call = self.call_identifier(
                span,
                "_$ref",
                vec![getter, self.identifier_expression(span, element_id)],
            );
            return vec![self.ast().statement_expression(span, call)];
        }

        let ref_id = self.next_ref_id();
        let declaration = self.variable_statement(span, &ref_id, value.clone_in(self.allocator));
        let callable = callable_test(
            self.allocator,
            span,
            self.identifier_expression(span, &ref_id),
        );
        self.template_state.uses_ref = true;
        let ref_call = {
            let getter = self.arrow_with_return(
                span,
                std::vec::Vec::new(),
                self.identifier_expression(span, &ref_id),
            );
            self.call_identifier(
                span,
                "_$ref",
                vec![getter, self.identifier_expression(span, element_id)],
            )
        };

        let statement = if is_lval {
            let fallback = ref_assignment_fallback(
                self,
                span,
                &value,
                self.identifier_expression(span, element_id),
            )
            .expect("lvalue refs always have an assignment fallback");
            self.ast().statement_expression(
                span,
                self.ast()
                    .expression_conditional(span, callable, ref_call, fallback),
            )
        } else {
            self.ast().statement_expression(
                span,
                self.ast().expression_logical(
                    span,
                    callable,
                    oxc_ast::ast::LogicalOperator::And,
                    ref_call,
                ),
            )
        };
        vec![declaration, statement]
    }

    /// Event attributes as a statement group (delegated handlers with data
    /// produce two assignments).
    fn dom_event_statements(
        &mut self,
        span: Span,
        element_id: &str,
        key: &str,
        value: Expression<'a>,
    ) -> std::vec::Vec<Statement<'a>> {
        self.event_statements(span, element_id, key, value)
    }

    pub(crate) fn arrow_with_return(
        &self,
        span: Span,
        param_names: std::vec::Vec<&str>,
        value: Expression<'a>,
    ) -> Expression<'a> {
        let statements = self
            .ast()
            .vec1(self.ast().statement_return(span, Some(value)));
        self.arrow_with_statements(span, param_names, statements)
    }

    pub(crate) fn arrow_with_statements(
        &self,
        span: Span,
        param_names: std::vec::Vec<&str>,
        statements: oxc_allocator::Vec<'a, Statement<'a>>,
    ) -> Expression<'a> {
        let params = self
            .ast()
            .vec_from_iter(param_names.into_iter().map(|name| {
                self.ast().formal_parameter(
                    span,
                    self.ast().vec(),
                    self.ast()
                        .binding_pattern_binding_identifier(span, self.ast().ident(name)),
                    None,
                    None,
                    false,
                    None,
                    false,
                    false,
                )
            }));
        let params = self.ast().formal_parameters(
            span,
            FormalParameterKind::ArrowFormalParameters,
            params,
            None,
        );
        let body = self.ast().function_body(span, self.ast().vec(), statements);
        self.ast()
            .expression_arrow_function(span, false, false, None, params, None, body)
    }

    pub(crate) fn should_close_tag(&self, tag_name: &str, context: CloseTagContext) -> bool {
        if is_void_element(tag_name) {
            return false;
        }
        !context.last_element
            || !self.omit_last_closing_tag
            || context.to_be_closed.as_ref().is_some_and(|to_be_closed| {
                !self.omit_nested_closing_tags
                    || to_be_closed.iter().any(|candidate| candidate == tag_name)
            })
    }

    pub(crate) fn append_static_attribute_value(
        &self,
        template: &mut String,
        name: &str,
        value: &str,
    ) {
        append_static_attribute_value(
            template,
            name,
            value,
            self.omit_quotes,
            self.omit_attribute_spacing,
        );
    }

    pub(crate) fn child_close_context(
        &self,
        tag_name: &str,
        context: CloseTagContext,
    ) -> Option<std::vec::Vec<String>> {
        if !self.should_close_tag(tag_name, context.clone()) {
            return context.to_be_closed;
        }

        let mut to_be_closed = context.to_be_closed.unwrap_or_else(|| {
            ALWAYS_CLOSE_ELEMENTS
                .iter()
                .map(|name| (*name).to_string())
                .collect()
        });
        push_unique(&mut to_be_closed, tag_name);
        if inline_elements(tag_name) {
            for element in BLOCK_ELEMENTS {
                push_unique(&mut to_be_closed, element);
            }
        }
        Some(to_be_closed)
    }

    /// Static-template fast path: appends the element's attributes to the
    /// template when every planned attribute inlines statically, mirroring
    /// the classification used by the full emission. Returns the planning
    /// outcome's children replacement (textarea `value` fold) on success.
    pub(crate) fn try_append_planned_static_attributes(
        &self,
        attributes: &[JSXAttributeItem<'a>],
        tag_name: &str,
        template: &mut String,
    ) -> Result<Option<Option<oxc_ast::ast::JSXChild<'a>>>> {
        if attributes
            .iter()
            .any(|attr| matches!(attr, JSXAttributeItem::SpreadAttribute(_)))
        {
            return Ok(None);
        }
        let AttrPlanOutcome {
            plans,
            children_replacement,
        } = self.plan_attributes(attributes, tag_name)?;
        let mut pending: std::vec::Vec<(String, Option<String>)> = std::vec::Vec::new();
        for plan in &plans {
            match self.classify_plan(plan) {
                PlanDisposition::Skip => {}
                PlanDisposition::Inline(value) => pending.push((plan.key.clone(), value)),
                PlanDisposition::Runtime => return Ok(None),
            }
        }
        for (key, value) in pending {
            match value {
                None => append_bare_attribute(template, &key, self.omit_attribute_spacing),
                Some(value) => self.append_static_attribute_value(template, &key, &value),
            }
        }
        Ok(Some(children_replacement))
    }
}

fn attribute_prefix(template: &str, omit_attribute_spacing: bool) -> &'static str {
    // The Babel plugin skips the separating space after a quoted value when
    // `omitAttributeSpacing` is on; a template ending in `"` is exactly that.
    if omit_attribute_spacing && template.ends_with('"') {
        ""
    } else {
        " "
    }
}

fn append_bare_attribute(template: &mut String, name: &str, omit_attribute_spacing: bool) {
    let prefix = attribute_prefix(template, omit_attribute_spacing);
    template.push_str(&format!("{prefix}{name}"));
}

fn append_static_attribute_value(
    template: &mut String,
    name: &str,
    value: &str,
    omit_quotes: bool,
    omit_attribute_spacing: bool,
) {
    let value = normalize_static_attribute_value(name, value);
    // An empty value (after class/style normalization) serializes as a bare
    // attribute, matching the Babel plugin.
    if value.is_empty() {
        append_bare_attribute(template, name, omit_attribute_spacing);
        return;
    }
    let prefix = attribute_prefix(template, omit_attribute_spacing);
    template.push_str(&format!(
        "{prefix}{name}={}",
        format_attribute_value_with_quotes(&value, omit_quotes)
    ));
}
