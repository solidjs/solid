use crate::dom::attrs::CloseTagContext;
use crate::dom::element::{AstDomTransform, jsx_expression_to_expression};
use crate::dom::static_template::lower_static_native_template;
use crate::dom::template::InsertMarker;
use crate::error::{Error, Result};
use crate::shared::classify::check_length;
use crate::shared::utils::{
    child_slot_allocates_ids, element_name, escape_html_text, escape_html_text_expression,
    is_component_name, static_jsx_expression, trim_jsx_text,
};
use oxc_allocator::CloneIn;
use oxc_ast::ast::Expression;
use oxc_ast::ast::{
    JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXChild, JSXElement, JSXExpression,
    Statement,
};

impl<'a> AstDomTransform<'a, '_> {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn lower_dom_children(
        &mut self,
        element: &JSXElement<'a>,
        tag_name: &str,
        element_id: &str,
        close_context: CloseTagContext,
        template: &mut crate::dom::template::TemplateHtml,
        declarations: &mut std::vec::Vec<Statement<'a>>,
        operations: &mut std::vec::Vec<Statement<'a>>,
        dynamics: &mut std::vec::Vec<crate::dom::dynamics::DynamicSlot<'a>>,
    ) -> Result<()> {
        // Walk anchors are per-parent: this element's positional walks start
        // from its own reference, not an outer marker.
        let saved_anchor = self.hydration_walk_anchor.take();
        let saved_walk = self.last_child_walk.take();
        let result = self.lower_dom_children_inner(
            element,
            tag_name,
            element_id,
            close_context,
            template,
            declarations,
            operations,
            dynamics,
        );
        self.hydration_walk_anchor = saved_anchor;
        self.last_child_walk = saved_walk;
        result
    }

    #[allow(clippy::too_many_arguments)]
    fn lower_dom_children_inner(
        &mut self,
        element: &JSXElement<'a>,
        tag_name: &str,
        element_id: &str,
        close_context: CloseTagContext,
        template: &mut crate::dom::template::TemplateHtml,
        declarations: &mut std::vec::Vec<Statement<'a>>,
        operations: &mut std::vec::Vec<Statement<'a>>,
        dynamics: &mut std::vec::Vec<crate::dom::dynamics::DynamicSlot<'a>>,
    ) -> Result<()> {
        let child_to_be_closed = self.child_close_context(tag_name, close_context);
        let last_element = self.find_last_element(&element.children);
        // Mirror of the Babel generate: when a parent hosts multiple dynamic
        // slots, each slot needs its own truthy insertion marker — the marker
        // doubles as the runtime's $$SLOT ownership tag, and shared or null
        // markers let one slot's cleanup destroy a node that migrated to its
        // neighbor (solidjs/solid#2830). Slots ride an immediately following
        // static sibling when one exists, otherwise get a dedicated `<!>`.
        let per_slot = !self.hydratable && self.dynamic_slot_count(&element.children) > 1;
        // Hydratable `<html>` children resolve by tag with `getNextMatch`
        // (chained from the previous match) — browsers normalize the document
        // shell, so positional walks are unreliable there.
        let html_tag_walk = self.hydratable && tag_name == "html";
        let mut previous_html_child: Option<String> = None;
        let mut index = 0;
        let mut child_node_index = 0;
        // Mirrors Babel's `filterChildren`: `detectExpressions` receives the
        // filtered list, so previous-sibling checks index into it.
        let filtered: std::vec::Vec<&JSXChild<'a>> = element
            .children
            .iter()
            .filter(|child| match child {
                JSXChild::Text(text) => !trim_jsx_text(&text.value).is_empty(),
                JSXChild::ExpressionContainer(container) => {
                    !matches!(container.expression, JSXExpression::EmptyExpression(_))
                }
                _ => true,
            })
            .collect();
        let filtered_index = |child: &JSXChild<'a>| {
            filtered
                .iter()
                .position(|candidate| std::ptr::eq(*candidate, child))
        };
        // Adjacent text and static-expression children merge into a single
        // template text node (Babel merges `text: true` results); only the
        // run's first child claims a node position and a walk id.
        let mut in_text_run = false;

        while index < element.children.len() {
            let child = &element.children[index];
            match child {
                JSXChild::Text(text) => {
                    let text = trim_jsx_text(&text.value);
                    if !text.is_empty() {
                        template.push_both(&escape_html_text(&text));
                        if !in_text_run {
                            // Babel allocates a positional id for text nodes
                            // whenever a sibling makes ids necessary
                            // (`detectExpressions`), even if nothing ends up
                            // referencing it. Nodes without ids don't consume
                            // a walk position (Babel's `i` counts ids only).
                            if filtered_index(child).is_some_and(|position| {
                                self.detect_expressions(&filtered, position)
                            }) {
                                let name = self.next_element_id();
                                let lookup = self.child_walk_expression(
                                    element.span,
                                    element_id,
                                    child_node_index,
                                );
                                declarations.push(self.variable_statement(
                                    element.span,
                                    &name,
                                    lookup,
                                ));
                                self.last_child_walk = Some((name, child_node_index));
                                child_node_index += 1;
                            }
                            in_text_run = true;
                        }
                    }
                }
                JSXChild::Element(child) => {
                    in_text_run = false;
                    // Dynamic mode: a native element of another renderer can't
                    // nest directly under a dom element (Babel throws in
                    // `transformChildren`; renderer boundaries need a
                    // component).
                    if self.is_foreign_element(child) {
                        let child_tag = element_name(&child.opening_element.name)?;
                        return Err(Error::from_reason(format!(
                            "<{child_tag}> is not supported in <{tag_name}>.\n      Wrap the usage with a component that would render this element, eg. Canvas"
                        )));
                    }
                    if is_component_name(&child.opening_element.name) {
                        self.template_state.uses_insert = true;
                        let lowered = self.lower_element(child)?;
                        let marker = self.dynamic_slot_marker(
                            &element.children,
                            index,
                            index + 1,
                            per_slot,
                            element.span,
                            element_id,
                            &mut child_node_index,
                            template,
                            declarations,
                        );
                        operations.push(self.insert_statement(
                            element.span,
                            element_id,
                            lowered,
                            marker,
                        ));
                    } else if let Some(static_template) = lower_static_native_template(
                        self,
                        child,
                        CloseTagContext {
                            last_element: Some(index) == last_element,
                            to_be_closed: child_to_be_closed.clone(),
                        },
                    )? {
                        template.append(static_template);
                        // A fully static element still receives a positional
                        // id in Babel when `detectExpressions` fires for its
                        // position; the walk is emitted even though unused.
                        // In dev hydratable mode the walk validates the tag
                        // (`getFirstChild`/`getNextSibling`).
                        if filtered_index(&element.children[index])
                            .is_some_and(|position| self.detect_expressions(&filtered, position))
                        {
                            let child_tag = element_name(&child.opening_element.name)?;
                            let name = self.next_element_id();
                            let lookup = self.child_element_expression(
                                child.span,
                                element_id,
                                child_node_index,
                                &child_tag,
                            );
                            declarations.push(self.variable_statement(element.span, &name, lookup));
                            self.last_child_walk = Some((name, child_node_index));
                            child_node_index += 1;
                        }
                    } else {
                        let lookup_override = if html_tag_walk {
                            Some(self.next_match_expression(
                                child,
                                element_id,
                                previous_html_child.as_deref(),
                            )?)
                        } else {
                            None
                        };
                        let child_id = self.lower_dynamic_native_child(
                            child,
                            CloseTagContext {
                                last_element: Some(index) == last_element,
                                to_be_closed: child_to_be_closed.clone(),
                            },
                            element_id,
                            child_node_index,
                            lookup_override,
                            template,
                            declarations,
                            operations,
                            dynamics,
                        )?;
                        self.last_child_walk = Some((child_id.clone(), child_node_index));
                        previous_html_child = Some(child_id);
                        child_node_index += 1;
                    }
                }
                JSXChild::ExpressionContainer(container) => {
                    if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                        index += 1;
                        continue;
                    }
                    if let Some(value) = self.static_jsx_expression_value(&container.expression) {
                        template.push_both(&escape_html_text_expression(&value));
                        if !in_text_run {
                            if filtered_index(child).is_some_and(|position| {
                                self.detect_expressions(&filtered, position)
                            }) {
                                let name = self.next_element_id();
                                let lookup = self.child_walk_expression(
                                    element.span,
                                    element_id,
                                    child_node_index,
                                );
                                declarations.push(self.variable_statement(
                                    element.span,
                                    &name,
                                    lookup,
                                ));
                                self.last_child_walk = Some((name, child_node_index));
                                child_node_index += 1;
                            }
                            in_text_run = true;
                        }
                        index += 1;
                        continue;
                    }
                    in_text_run = false;

                    let run_end = dynamic_run_end(&element.children, index);
                    // Single-slot parents keep the previous marker strategy
                    // untouched: one shared placeholder when boxed by text,
                    // the leading static content otherwise. Hydratable slots
                    // always use `<!$><!/>` marker pairs instead.
                    let shared_marker_name = if !self.hydratable
                        && !per_slot
                        && has_previous_static_text(&element.children[..index])
                        && has_next_static_text(&element.children[run_end..])
                    {
                        template.push_both("<!>");
                        let marker_name = self.next_element_id();
                        let lookup =
                            self.child_walk_expression(element.span, element_id, child_node_index);
                        declarations.push(self.variable_statement(
                            element.span,
                            &marker_name,
                            lookup,
                        ));
                        self.last_child_walk = Some((marker_name.clone(), child_node_index));
                        child_node_index += 1;
                        Some(marker_name)
                    } else {
                        None
                    };

                    for (run_offset, dynamic_child) in
                        element.children[index..run_end].iter().enumerate()
                    {
                        let run_index = index + run_offset;
                        let JSXChild::ExpressionContainer(container) = dynamic_child else {
                            return Err(Error::from_reason(
                                "Dynamic child run included a non-expression child",
                            ));
                        };
                        self.template_state.uses_insert = true;
                        // Babel's `transformNode` gates wrapping on
                        // `isDynamic(expr, { checkMember: true })` of the
                        // original (pre-lowered) expression — tags don't
                        // count in native child position, marker comments and
                        // namespace-import members short-circuit inside the
                        // shared predicate, and a non-dynamic hole inserts
                        // its expression untouched.
                        let dynamic = self.classify().is_dynamic_child_slot(dynamic_child);
                        // JSX inside the hole stays raw for the deferred pass
                        // (Babel wraps the untransformed expression and its
                        // outer traversal lowers the JSX later).
                        let value =
                            jsx_expression_to_expression(&container.expression, self.allocator);
                        let value = if dynamic {
                            self.dom_child_expression(container.span, value)
                        } else {
                            value
                        };
                        // Mirror of the ssr generate's `scope()` wrap: deferred
                        // holes that can allocate hydration ids get their own
                        // owner scope. Both flags come from shared predicates
                        // so the generates can't desync.
                        let value = if dynamic
                            && self.hydratable
                            && child_slot_allocates_ids(dynamic_child)
                        {
                            self.scope_child_expression(container.span, value)
                        } else {
                            value
                        };
                        let marker = if let Some(name) = shared_marker_name.as_ref() {
                            Some(InsertMarker {
                                marker: self.identifier_expression(element.span, name),
                                initial: None,
                            })
                        } else {
                            self.dynamic_slot_marker(
                                &element.children,
                                run_index,
                                run_end,
                                per_slot,
                                element.span,
                                element_id,
                                &mut child_node_index,
                                template,
                                declarations,
                            )
                        };
                        operations.push(self.insert_statement(
                            element.span,
                            element_id,
                            value,
                            marker,
                        ));
                    }
                    index = run_end;
                    continue;
                }
                JSXChild::Spread(spread) => {
                    in_text_run = false;
                    self.template_state.uses_insert = true;
                    let value = spread_child_expression(self, spread.span, &spread.expression);
                    // Spread children always allocate ids; scope keyed off the
                    // same shared dynamic predicate as the ssr generate.
                    let value = if self.hydratable && self.classify().is_dynamic_child_slot(child) {
                        self.scope_child_expression(spread.span, value)
                    } else {
                        value
                    };
                    let marker = self.dynamic_slot_marker(
                        &element.children,
                        index,
                        index + 1,
                        per_slot,
                        element.span,
                        element_id,
                        &mut child_node_index,
                        template,
                        declarations,
                    );
                    operations.push(self.insert_statement(element.span, element_id, value, marker));
                }
                _ => {
                    return Err(Error::from_reason(
                        "Fragments and spread children are not implemented in the AST-native milestone yet",
                    ));
                }
            }
            index += 1;
        }

        Ok(())
    }

    /// Mirror of the Babel generate's `findLastElement`: the last retained
    /// child that ends the parent's template content. In hydratable mode any
    /// retained child counts (dynamic slots append `<!$><!/>` markers, so an
    /// element followed by one is not last); otherwise only template-inlined
    /// children (text, static expressions, native elements) count — except in
    /// per-slot mode (two or more dynamic slots, CSR), where a trailing
    /// dynamic slot appends a dedicated `<!>` placeholder after any preceding
    /// element's markup, so nothing before it may omit its closing tag.
    pub(crate) fn find_last_element(&self, children: &[JSXChild<'a>]) -> Option<usize> {
        let per_slot_markers = !self.hydratable && self.dynamic_slot_count(children) > 1;
        for (index, child) in children.iter().enumerate().rev() {
            let retained = match child {
                JSXChild::Text(text) => !trim_jsx_text(&text.value).is_empty(),
                JSXChild::ExpressionContainer(container) => {
                    !matches!(container.expression, JSXExpression::EmptyExpression(_))
                }
                _ => true,
            };
            if !retained {
                continue;
            }
            let qualifies = self.hydratable
                || match child {
                    JSXChild::Text(_) => true,
                    JSXChild::ExpressionContainer(container) => self
                        .static_jsx_expression_value(&container.expression)
                        .is_some(),
                    JSXChild::Element(child) => !is_component_name(&child.opening_element.name),
                    _ => false,
                };
            if qualifies {
                return Some(index);
            }
            if per_slot_markers {
                return None;
            }
        }
        None
    }

    /// Mirror of Babel's `detectExpressions`: whether the child at `index` of
    /// the filtered child list needs a positional id — true when the previous
    /// sibling is dynamic (its walk anchors this one) or anything at or after
    /// this position compiles to expressions (dynamic holes, components,
    /// custom-element context, spreads/dynamic attributes, or such content
    /// nested inside a native element).
    pub(crate) fn detect_expressions(&self, children: &[&JSXChild<'a>], index: usize) -> bool {
        if index > 0 {
            match children[index - 1] {
                JSXChild::ExpressionContainer(container)
                    if !matches!(container.expression, JSXExpression::EmptyExpression(_))
                        && self
                            .static_jsx_expression_value(&container.expression)
                            .is_none() =>
                {
                    return true;
                }
                JSXChild::Element(element) if is_component_name(&element.opening_element.name) => {
                    return true;
                }
                _ => {}
            }
        }
        for child in &children[index..] {
            match child {
                JSXChild::ExpressionContainer(container)
                    if !matches!(container.expression, JSXExpression::EmptyExpression(_))
                        && self
                            .static_jsx_expression_value(&container.expression)
                            .is_none() =>
                {
                    return true;
                }
                JSXChild::Element(element) => {
                    if is_component_name(&element.opening_element.name) {
                        return true;
                    }
                    let tag_name = element_name(&element.opening_element.name).unwrap_or_default();
                    if self.context_to_custom_elements
                        && (tag_name == "slot"
                            || tag_name.contains('-')
                            || element.opening_element.attributes.iter().any(|attr| {
                                matches!(
                                    attr,
                                    JSXAttributeItem::Attribute(attr)
                                        if matches!(&attr.name, JSXAttributeName::Identifier(name) if name.name == "is")
                                )
                            }))
                    {
                        return true;
                    }
                    // claim targets (a[href] / form[action]) need an element
                    // reference even when fully static — the emitted
                    // claimElement call walks to them
                    if crate::dom::element::element_is_claim_target(element) {
                        return true;
                    }
                    let has_expression_attr =
                        element
                            .opening_element
                            .attributes
                            .iter()
                            .any(|attr| match attr {
                                JSXAttributeItem::SpreadAttribute(_) => true,
                                JSXAttributeItem::Attribute(attr) => {
                                    let named_dynamic = match &attr.name {
                                        JSXAttributeName::Identifier(name) => matches!(
                                            name.name.as_str(),
                                            "textContent" | "innerHTML" | "innerText"
                                        ),
                                        JSXAttributeName::NamespacedName(namespaced) => {
                                            namespaced.namespace.name == "prop"
                                        }
                                    };
                                    named_dynamic
                                        || matches!(
                                            &attr.value,
                                            Some(JSXAttributeValue::ExpressionContainer(container))
                                                if !matches!(
                                                    container.expression,
                                                    JSXExpression::StringLiteral(_)
                                                        | JSXExpression::NumericLiteral(_)
                                                )
                                        )
                                }
                            });
                    if has_expression_attr {
                        return true;
                    }
                    let nested: std::vec::Vec<&JSXChild<'a>> = element
                        .children
                        .iter()
                        .filter(|child| match child {
                            JSXChild::Text(text) => !trim_jsx_text(&text.value).is_empty(),
                            JSXChild::ExpressionContainer(container) => {
                                !matches!(container.expression, JSXExpression::EmptyExpression(_))
                            }
                            _ => true,
                        })
                        .collect();
                    if !nested.is_empty() && self.detect_expressions(&nested, 0) {
                        return true;
                    }
                }
                _ => {}
            }
        }
        false
    }

    /// Number of children that compile to `insert()` calls: dynamic expression
    /// containers, components, and spread children. Static expressions and
    /// text inline into the template; native elements walk.
    fn dynamic_slot_count(&self, children: &[JSXChild<'a>]) -> usize {
        children
            .iter()
            .filter(|child| match child {
                JSXChild::ExpressionContainer(container) => {
                    !matches!(container.expression, JSXExpression::EmptyExpression(_))
                        && self
                            .static_jsx_expression_value(&container.expression)
                            .is_none()
                }
                JSXChild::Element(child) => is_component_name(&child.opening_element.name),
                JSXChild::Spread(_) => true,
                _ => false,
            })
            .count()
    }

    /// Marker for one slot of a multi-slot parent (solidjs/solid#2830): the
    /// immediately following template node when one exists — unless the slot
    /// is boxed by text, where a placeholder comment is structurally required
    /// to keep the surrounding template text nodes from merging — otherwise a
    /// dedicated `<!>` placeholder appended at the slot's template position.
    #[allow(clippy::too_many_arguments)]
    fn dynamic_slot_marker(
        &mut self,
        children: &[JSXChild<'a>],
        index: usize,
        following_start: usize,
        per_slot: bool,
        span: oxc_span::Span,
        element_id: &str,
        child_node_index: &mut usize,
        template: &mut crate::dom::template::TemplateHtml,
        declarations: &mut std::vec::Vec<Statement<'a>>,
    ) -> Option<InsertMarker<'a>> {
        if self.hydratable {
            return self.hydration_slot_marker(
                children,
                span,
                element_id,
                child_node_index,
                template,
                declarations,
            );
        }
        if per_slot {
            return Some(InsertMarker {
                marker: self.per_slot_marker(
                    children,
                    index,
                    span,
                    element_id,
                    child_node_index,
                    template,
                    declarations,
                ),
                initial: None,
            });
        }
        // Boxed by text — Babel's `wrappedByText` arm of the marker decision:
        // a dedicated placeholder is structurally required, because the
        // preceding and following template texts would otherwise merge into a
        // single node during HTML parsing, leaving the following-sibling walk
        // pointing past the slot (solidjs/solid#3004: a component between two
        // static texts was inserted after the trailing text).
        if self.slot_boxed_by_text(children, index) {
            return Some(InsertMarker {
                marker: self.dedicated_slot_placeholder(
                    span,
                    element_id,
                    child_node_index,
                    template,
                    declarations,
                ),
                initial: None,
            });
        }
        if has_following_static_content(&children[following_start..]) {
            return Some(InsertMarker {
                marker: self.child_walk_expression(span, element_id, *child_node_index),
                initial: None,
            });
        }
        // Babel: `multi ? insert(el, expr, nextChild || null) : insert(el,
        // expr)` — the null marker rides on `checkLength`, not on template
        // position.
        if check_length(children) {
            return Some(InsertMarker {
                marker: self.ast().expression_null_literal(span),
                initial: None,
            });
        }
        None
    }

    #[allow(clippy::too_many_arguments)]
    fn hydration_slot_marker(
        &mut self,
        children: &[JSXChild<'a>],
        span: oxc_span::Span,
        element_id: &str,
        child_node_index: &mut usize,
        template: &mut crate::dom::template::TemplateHtml,
        declarations: &mut std::vec::Vec<Statement<'a>>,
    ) -> Option<InsertMarker<'a>> {
        // Babel: `markers = config.hydratable && multi` — a lone meaningful
        // child inserts without markers (`checkLength`), anything else gets a
        // `<!$><!/>` pair.
        if !check_length(children) {
            return None;
        }

        template.push_both("<!$><!/>");
        // Babel's `createPlaceholder` declares a positional walk var for the
        // `<!$>` start placeholder, then chains `getNextMarker` off it.
        let start_name = self.next_element_id();
        let start_lookup = self.child_walk_expression(span, element_id, *child_node_index);
        declarations.push(self.variable_statement(span, &start_name, start_lookup));
        let start_marker = self.identifier_expression(span, &start_name);
        let marker_name = self.next_element_id();
        let current_name = self.next_element_id();
        self.template_state.uses_get_next_marker = true;
        let marker_lookup =
            self.static_member_expression_from_expression(span, start_marker, "nextSibling");
        let init = self.call_identifier(span, "_$getNextMarker", vec![marker_lookup]);
        declarations.push(self.array_destructure_statement(
            span,
            &[&marker_name, &current_name],
            init,
        ));
        // At hydration time the SSR'd DOM holds arbitrary content between the
        // `<!$>`/`<!/>` pair; later positional walks in this parent must chain
        // from the end marker node `getNextMarker` located, not from the root.
        self.hydration_walk_anchor = Some((marker_name.clone(), *child_node_index + 1));
        self.last_child_walk = Some((marker_name.clone(), *child_node_index + 1));
        *child_node_index += 2;
        Some(InsertMarker {
            marker: self.identifier_expression(span, &marker_name),
            initial: Some(self.identifier_expression(span, &current_name)),
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn per_slot_marker(
        &mut self,
        children: &[JSXChild<'a>],
        index: usize,
        span: oxc_span::Span,
        element_id: &str,
        child_node_index: &mut usize,
        template: &mut crate::dom::template::TemplateHtml,
        declarations: &mut std::vec::Vec<Statement<'a>>,
    ) -> Expression<'a> {
        if !self.slot_boxed_by_text(children, index)
            && self.next_child_is_template_node(children, index)
        {
            return self.child_walk_expression(span, element_id, *child_node_index);
        }
        self.dedicated_slot_placeholder(span, element_id, child_node_index, template, declarations)
    }

    /// Emit a dedicated `<!>` placeholder at the slot's template position and
    /// declare a positional walk var referencing it.
    fn dedicated_slot_placeholder(
        &mut self,
        span: oxc_span::Span,
        element_id: &str,
        child_node_index: &mut usize,
        template: &mut crate::dom::template::TemplateHtml,
        declarations: &mut std::vec::Vec<Statement<'a>>,
    ) -> Expression<'a> {
        template.push_both("<!>");
        let marker_name = self.next_element_id();
        let lookup = self.child_walk_expression(span, element_id, *child_node_index);
        declarations.push(self.variable_statement(span, &marker_name, lookup));
        self.last_child_walk = Some((marker_name.clone(), *child_node_index));
        *child_node_index += 1;
        self.identifier_expression(span, &marker_name)
    }

    /// Nearest template-contributing sibling on both sides is text (mirrors
    /// the Babel generate's `wrappedByText`): dynamic slots and components are
    /// transparent to the walk; a native element or slot-free boundary stops it.
    fn slot_boxed_by_text(&self, children: &[JSXChild<'a>], index: usize) -> bool {
        self.nearest_template_sibling_is_text(children[..index].iter().rev())
            && self.nearest_template_sibling_is_text(children[index + 1..].iter())
    }

    fn nearest_template_sibling_is_text<'b>(
        &self,
        children: impl Iterator<Item = &'b JSXChild<'a>>,
    ) -> bool
    where
        'a: 'b,
    {
        for child in children {
            match child {
                JSXChild::Text(text) if !trim_jsx_text(&text.value).is_empty() => {
                    return true;
                }
                JSXChild::ExpressionContainer(container) => {
                    if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                        continue;
                    }
                    if self
                        .static_jsx_expression_value(&container.expression)
                        .is_some()
                    {
                        return true;
                    }
                }
                JSXChild::Element(child) if !is_component_name(&child.opening_element.name) => {
                    return false;
                }
                JSXChild::Element(_) => {}
                _ => {}
            }
        }
        false
    }

    /// Whether the immediately following retained child contributes a template
    /// node (non-empty text, static expression, or native element) that can
    /// serve as this slot's marker.
    fn next_child_is_template_node(&self, children: &[JSXChild<'a>], index: usize) -> bool {
        for child in &children[index + 1..] {
            return match child {
                JSXChild::Text(text) => {
                    if trim_jsx_text(&text.value).is_empty() {
                        continue;
                    }
                    true
                }
                JSXChild::ExpressionContainer(container) => {
                    if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                        continue;
                    }
                    self.static_jsx_expression_value(&container.expression)
                        .is_some()
                }
                JSXChild::Element(child) => !is_component_name(&child.opening_element.name),
                _ => false,
            };
        }
        false
    }

    /// `getNextMatch(<previous>.nextSibling | <parent>.firstChild, "<tag>")`
    /// lookup for a direct child of a hydratable `<html>` element.
    fn next_match_expression(
        &mut self,
        child: &JSXElement<'a>,
        parent_id: &str,
        previous_child: Option<&str>,
    ) -> Result<Expression<'a>> {
        let tag_name = element_name(&child.opening_element.name)?;
        self.template_state.uses_get_next_match = true;
        let base = match previous_child {
            Some(previous) => self.static_member_expression(child.span, previous, "nextSibling"),
            None => self.static_member_expression(child.span, parent_id, "firstChild"),
        };
        let tag = self
            .ast()
            .expression_string_literal(child.span, self.ast().str(&tag_name), None);
        Ok(self.call_identifier(child.span, "_$getNextMatch", vec![base, tag]))
    }

    #[allow(clippy::too_many_arguments)]
    fn lower_dynamic_native_child(
        &mut self,
        child: &JSXElement<'a>,
        close_context: CloseTagContext,
        parent_id: &str,
        child_node_index: usize,
        lookup_override: Option<Expression<'a>>,
        parent_template: &mut crate::dom::template::TemplateHtml,
        declarations: &mut std::vec::Vec<Statement<'a>>,
        operations: &mut std::vec::Vec<Statement<'a>>,
        dynamics: &mut std::vec::Vec<crate::dom::dynamics::DynamicSlot<'a>>,
    ) -> Result<String> {
        let tag_name = element_name(&child.opening_element.name)?;
        let mut child_template = crate::dom::template::TemplateHtml::open_tag(&tag_name);
        let child_id = self.next_element_id();
        let mut child_declarations = std::vec::Vec::new();
        let mut child_operations = std::vec::Vec::new();

        let attrs_lowering = self.lower_template_attributes(
            &child.opening_element.attributes,
            &tag_name,
            &child_id,
            !child.children.is_empty(),
            &mut child_template.html,
            &mut child_declarations,
            &mut child_operations,
            dynamics,
        )?;

        // Babel's textarea `value` fold replaces the element's children.
        let child: &JSXElement<'a> = match attrs_lowering.children_replacement {
            Some(replacement) => {
                let mut clone = child.clone_in(self.allocator);
                clone.children.clear();
                clone.children.push(replacement);
                self.allocator.alloc(clone)
            }
            None => child,
        };

        child_template.push_both(">");
        if attrs_lowering.needs_text_placeholder {
            child_template.html.push(' ');
        } else {
            self.lower_dom_children(
                child,
                &tag_name,
                &child_id,
                close_context.clone(),
                &mut child_template,
                &mut child_declarations,
                &mut child_operations,
                dynamics,
            )?;
        }
        if self.should_close_tag(&tag_name, close_context) {
            child_template.html.push_str(&format!("</{tag_name}>"));
        }
        if !crate::shared::utils::is_void_element(&tag_name) {
            child_template.closed.push_str(&format!("</{tag_name}>"));
        }

        parent_template.append(child_template);
        let child_lookup = match lookup_override {
            Some(lookup) => lookup,
            None => {
                self.child_element_expression(child.span, parent_id, child_node_index, &tag_name)
            }
        };
        declarations.push(self.variable_statement(child.span, &child_id, child_lookup));
        declarations.extend(child_declarations);
        operations.extend(child_operations);
        Ok(child_id)
    }

    /// Wraps an insert accessor in `_$scope(...)`. The child lowering
    /// simplifies `{sig()}` to the bare getter `sig`; rewrap it as
    /// `() => sig()` so tagging the scope doesn't mutate the user's function.
    fn scope_child_expression(
        &mut self,
        span: oxc_span::Span,
        value: Expression<'a>,
    ) -> Expression<'a> {
        self.template_state.uses_scope = true;
        let already_function = match &value {
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
            Expression::CallExpression(call) => matches!(
                call.callee,
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            ),
            _ => false,
        };
        let value = if already_function {
            value
        } else {
            let call = self
                .ast()
                .expression_call(span, value, None, self.ast().vec(), false);
            self.arrow_return_expression(span, call)
        };
        self.call_identifier(span, "_$scope", vec![value])
    }

    fn child_element_expression(
        &mut self,
        span: oxc_span::Span,
        parent: &str,
        index: usize,
        tag_name: &str,
    ) -> Expression<'a> {
        if !self.hydratable || !self.dev {
            return self.child_walk_expression(span, parent, index);
        }

        let tag = self
            .ast()
            .expression_string_literal(span, self.ast().str(tag_name), None);

        if index == 0 {
            self.template_state.uses_get_first_child = true;
            return self.call_identifier(
                span,
                "_$getFirstChild",
                vec![self.identifier_expression(span, parent), tag],
            );
        }

        self.template_state.uses_get_next_sibling = true;
        // Babel chains from `tempPath` — the previous walked sibling's
        // variable — rather than re-deriving a root-relative path.
        let previous = match &self.last_child_walk {
            Some((name, walk_index)) if *walk_index == index - 1 => {
                self.identifier_expression(span, name)
            }
            _ => self.child_walk_expression(span, parent, index - 1),
        };
        self.call_identifier(span, "_$getNextSibling", vec![previous, tag])
    }
}

fn spread_child_expression<'a>(
    ctx: &AstDomTransform<'a, '_>,
    span: oxc_span::Span,
    expression: &Expression<'a>,
) -> Expression<'a> {
    // Babel's `JSXSpreadChild` branch of `transformNode`: dynamic spreads
    // insert behind an explicit thunk; static ones insert raw.
    let cloned = expression.clone_in(ctx.allocator);
    if ctx.classify().is_dynamic(None, expression, false) {
        ctx.arrow_return_expression(span, cloned)
    } else {
        cloned
    }
}

fn has_following_static_content(children: &[JSXChild<'_>]) -> bool {
    children.iter().any(|child| match child {
        JSXChild::Text(text) => !trim_jsx_text(&text.value).is_empty(),
        JSXChild::ExpressionContainer(container) => {
            !matches!(container.expression, JSXExpression::EmptyExpression(_))
                && static_jsx_expression(&container.expression, None).is_some()
        }
        JSXChild::Element(child) => !is_component_name(&child.opening_element.name),
        _ => false,
    })
}

fn has_previous_static_text(children: &[JSXChild<'_>]) -> bool {
    children.iter().rev().any(|child| match child {
        JSXChild::Text(text) => !trim_jsx_text(&text.value).is_empty(),
        JSXChild::ExpressionContainer(container) => {
            static_jsx_expression(&container.expression, None).is_some()
        }
        _ => false,
    })
}

fn has_next_static_text(children: &[JSXChild<'_>]) -> bool {
    children.iter().any(|child| match child {
        JSXChild::Text(text) => !trim_jsx_text(&text.value).is_empty(),
        JSXChild::ExpressionContainer(container) => {
            static_jsx_expression(&container.expression, None).is_some()
        }
        _ => false,
    })
}

fn dynamic_run_end(children: &[JSXChild<'_>], start: usize) -> usize {
    let mut index = start;
    while index < children.len() {
        let JSXChild::ExpressionContainer(container) = &children[index] else {
            break;
        };
        if matches!(container.expression, JSXExpression::EmptyExpression(_))
            || static_jsx_expression(&container.expression, None).is_some()
        {
            break;
        }
        index += 1;
    }
    index
}
