use crate::error::Result;
use oxc_allocator::{Allocator, CloneIn};
use oxc_ast::ast::{
    AssignmentOperator, AssignmentTarget, Expression, JSXElement, JSXExpression, Statement,
};

use crate::dom::attrs::CloseTagContext;
use crate::dom::template::DomTemplateState;
use crate::shared::ast_builder::AstBuilder;
use crate::shared::bindings::BindingTable;
use crate::shared::component::lower_component_with_setup;
use crate::shared::utils::{
    StaticValue, element_name, is_component_name, is_void_element, static_jsx_expression,
};

pub(crate) struct AstDomTransform<'a, 'source> {
    pub(crate) allocator: &'a Allocator,
    pub(crate) source: &'source str,
    pub(crate) module_name: &'source str,
    pub(crate) hydratable: bool,
    pub(crate) dev: bool,
    pub(crate) context_to_custom_elements: bool,
    pub(crate) delegate_events: bool,
    pub(crate) delegated_events: std::vec::Vec<String>,
    pub(crate) omit_quotes: bool,
    pub(crate) omit_attribute_spacing: bool,
    pub(crate) inline_styles: bool,
    /// The reactive wrapper import name (`effect` by default); `None`
    /// disables effect wrapping (Babel's falsy `effectWrapper`).
    pub(crate) effect_wrapper: Option<String>,
    pub(crate) wrap_conditionals: bool,
    /// The memo wrapper import name (`memo` by default); `None` disables
    /// memo wrapping (Babel's falsy `memoWrapper`).
    pub(crate) memo_wrapper: Option<String>,
    /// The patch-mode driver import name (`patchDriver` by default); `None`
    /// disables patch-mode compilation (Babel's falsy `patchDriver`).
    pub(crate) patch_driver: Option<String>,
    /// Row proof of the most recently lowered template root (DESIGN-PATCH-
    /// CHANNEL §3c): set when the root emitted only inert DOM wiring and its
    /// dynamics all landed in one patchDriver body. Consumed by
    /// `wrap_pure_row` when the enclosing expression is a single-param
    /// function whose body IS that root.
    pub(crate) last_row_proof: Option<PureRowProof>,
    /// Pre-walk function shapes (see JsxTransform::enter_function_shape):
    /// whether each live function's block body was ORIGINALLY a lone
    /// `return` — after lowering, inlined setup statements make that
    /// unknowable, and user statements at build time must deny the stamp.
    pub(crate) function_shape_stack: std::vec::Vec<bool>,
    /// The most recently exited function's shape, read by `wrap_pure_row`.
    pub(crate) last_function_single_return: bool,
    pub(crate) static_marker: String,
    pub(crate) omit_nested_closing_tags: bool,
    pub(crate) omit_last_closing_tag: bool,
    /// Babel's `validate` (default on): warn when a template's markup would
    /// be restructured by the browser's HTML parser.
    pub(crate) validate: bool,
    pub(crate) built_ins: std::vec::Vec<String>,
    /// Where the reactive wrapper helpers (`memo`, `effect`) import from.
    /// Babel resolves them against the top-level module — in dynamic
    /// (universal + dom renderer) mode that's the base universal module, not
    /// the dom renderer's module.
    pub(crate) wrapper_module_name: Option<String>,
    /// Dynamic mode: the tags this renderer owns. Native elements outside the
    /// list are left as raw JSX for the driving universal transform to lower
    /// (Babel dispatches per element through `transformElement`). `None`
    /// (plain dom mode) claims every native tag.
    pub(crate) renderer_elements: Option<std::vec::Vec<String>>,
    pub(crate) template_state: DomTemplateState,
    pub(crate) error: Option<String>,
    pub(crate) bindings: BindingTable,
    pub(crate) pending_this_capture: Option<String>,
    pub(crate) current_this_capture: Option<String>,
    pub(crate) function_parent_stack: std::vec::Vec<crate::shared::transform::FunctionParentKind>,
    pub(crate) next_function_class_method: bool,
    pub(crate) lowered_function_bodies: std::collections::HashSet<usize>,
    pub(crate) statement_depth: usize,
    pub(crate) skip_xmlns_attribute: bool,
    /// After a hydration `getNextMarker` destructure, positional child walks
    /// in the same parent chain from the marker's end node — the SSR'd DOM
    /// holds arbitrary content between `<!$>` and `<!/>`, so root-relative
    /// `firstChild.nextSibling…` paths would land inside the marker region.
    /// `(end node identifier, template index of the end node)`.
    pub(crate) hydration_walk_anchor: Option<(String, usize)>,
    /// Babel's `tempPath`: the last declared positional walk variable of the
    /// current parent and its template index. Dev-mode validated walks
    /// (`getFirstChild`/`getNextSibling`) chain from it by name — the plain
    /// member walks re-derive from the root instead (equalized by traversal).
    pub(crate) last_child_walk: Option<(String, usize)>,
    /// Whether the current template root saw a delegated event handler or a
    /// spread (which may carry one); consumed at the root to emit a single
    /// `runHydrationEvents()` after setup.
    pub(crate) has_hydratable_event: bool,
    pub(crate) element_index: usize,
    pub(crate) this_index: usize,
    pub(crate) ref_index: usize,
    pub(crate) condition_index: usize,
    /// Span of the JSX root currently being lowered via the visitor entry.
    /// Babel keeps a raw `this` in the tag callee of the root element of each
    /// `transformJSX` call; only descendants use the `_self$` capture.
    pub(crate) jsx_root_span: Option<oxc_span::Span>,
}

/// See `AstDomTransform::last_row_proof`.
pub(crate) struct PureRowProof {
    pub(crate) root_span: oxc_span::Span,
    /// The patch subject when the root had dynamics (must equal the row
    /// param); `None` for fully static roots.
    pub(crate) subject: Option<String>,
}

pub(crate) struct DomTransformConfig {
    pub(crate) hydratable: bool,
    pub(crate) dev: bool,
    pub(crate) context_to_custom_elements: bool,
    pub(crate) delegate_events: bool,
    pub(crate) delegated_events: std::vec::Vec<String>,
    pub(crate) omit_quotes: bool,
    pub(crate) omit_attribute_spacing: bool,
    pub(crate) inline_styles: bool,
    pub(crate) effect_wrapper: Option<String>,
    pub(crate) wrap_conditionals: bool,
    pub(crate) memo_wrapper: Option<String>,
    pub(crate) patch_driver: Option<String>,
    pub(crate) static_marker: String,
    pub(crate) omit_nested_closing_tags: bool,
    pub(crate) omit_last_closing_tag: bool,
    pub(crate) validate: bool,
    pub(crate) built_ins: std::vec::Vec<String>,
    pub(crate) wrapper_module_name: Option<String>,
    pub(crate) renderer_elements: Option<std::vec::Vec<String>>,
}

impl<'a, 'source> AstDomTransform<'a, 'source> {
    /// Local for the configured effect wrapper (Babel's `_$${name}` hint).
    pub(crate) fn effect_wrapper_local(&self) -> String {
        format!("_${}", self.effect_wrapper.as_deref().unwrap_or("effect"))
    }

    /// Local for the configured memo wrapper.
    pub(crate) fn memo_wrapper_local(&self) -> String {
        format!("_${}", self.memo_wrapper.as_deref().unwrap_or("memo"))
    }

    pub(crate) fn new(
        allocator: &'a Allocator,
        source: &'source str,
        module_name: &'source str,
        config: DomTransformConfig,
    ) -> Self {
        Self {
            allocator,
            source,
            module_name,
            hydratable: config.hydratable,
            dev: config.dev,
            context_to_custom_elements: config.context_to_custom_elements,
            delegate_events: config.delegate_events,
            delegated_events: config.delegated_events,
            omit_quotes: config.omit_quotes,
            omit_attribute_spacing: config.omit_attribute_spacing,
            inline_styles: config.inline_styles,
            effect_wrapper: config.effect_wrapper,
            wrap_conditionals: config.wrap_conditionals,
            memo_wrapper: config.memo_wrapper,
            patch_driver: config.patch_driver,
            last_row_proof: None,
            function_shape_stack: std::vec::Vec::new(),
            last_function_single_return: false,
            static_marker: config.static_marker,
            omit_nested_closing_tags: config.omit_nested_closing_tags,
            omit_last_closing_tag: config.omit_last_closing_tag,
            validate: config.validate,
            built_ins: config.built_ins,
            wrapper_module_name: config.wrapper_module_name,
            renderer_elements: config.renderer_elements,
            template_state: DomTemplateState::new(),
            error: None,
            bindings: BindingTable::default(),
            pending_this_capture: None,
            current_this_capture: None,
            function_parent_stack: std::vec::Vec::new(),
            next_function_class_method: false,
            lowered_function_bodies: std::collections::HashSet::new(),
            statement_depth: 0,
            skip_xmlns_attribute: false,
            hydration_walk_anchor: None,
            last_child_walk: None,
            has_hydratable_event: false,
            element_index: 0,
            this_index: 0,
            ref_index: 0,
            condition_index: 0,
            jsx_root_span: None,
        }
    }

    /// Whether a native element belongs to a different renderer in dynamic
    /// mode: the dom transform leaves it as raw JSX for the universal
    /// transform to lower.
    pub(crate) fn is_foreign_element(&self, element: &JSXElement<'a>) -> bool {
        let Some(elements) = &self.renderer_elements else {
            return false;
        };
        if is_component_name(&element.opening_element.name) {
            return false;
        }
        match element_name(&element.opening_element.name) {
            Ok(tag_name) => !elements.iter().any(|name| name == &tag_name),
            Err(_) => false,
        }
    }

    pub(crate) fn lower_element(&mut self, element: &JSXElement<'a>) -> Result<Expression<'a>> {
        let (result, setup) = self.lower_element_with_setup(element)?;
        if setup.is_empty() {
            return Ok(result);
        }

        let mut statements = self.ast().vec();
        statements.extend(setup);
        statements.push(self.ast().statement_return(element.span, Some(result)));
        let arrow = self.arrow_iife(element.span, statements);
        Ok(self.call_expression(element.span, arrow, std::vec::Vec::new()))
    }

    pub(crate) fn lower_element_with_setup(
        &mut self,
        element: &JSXElement<'a>,
    ) -> Result<(Expression<'a>, std::vec::Vec<Statement<'a>>)> {
        // Dynamic mode: another renderer's element stays raw JSX; the driving
        // universal transform lowers it after this subtree returns.
        if self.is_foreign_element(element) {
            return Ok((
                Expression::JSXElement(oxc_allocator::Box::new_in(
                    oxc_allocator::CloneIn::clone_in(element, self.allocator),
                    &self.allocator,
                )),
                std::vec::Vec::new(),
            ));
        }
        if is_component_name(&element.opening_element.name) {
            return lower_component_with_setup(self, element);
        }

        let tag_name = element_name(&element.opening_element.name)?;

        // Each native template root replays hydratable events independently
        // (Babel transforms component children with `topLevel: true`).
        let saved_hydratable_event = self.has_hydratable_event;
        self.has_hydratable_event = false;

        // Without spreads, a native `children` attribute participates in
        // child insertion rather than attribute handling: when the element
        // has no real children, the value becomes its child expression
        // (statics then template-inline; dynamics `insert()`). Existing JSX
        // children win and the attribute is dropped. With a spread, Babel
        // leaves `children` in the merged props so source-order precedence
        // is preserved by `spread()`.
        let has_spread = element
            .opening_element
            .attributes
            .iter()
            .any(|attr| matches!(attr, oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)));
        let element: &JSXElement<'a> =
            if !is_void_element(&tag_name) && !has_spread && element.children.is_empty() {
                if let Some(child) = children_attribute_child(self.allocator, element) {
                    let mut clone = element.clone_in(self.allocator);
                    clone.children.push(child);
                    self.allocator.alloc(clone)
                } else {
                    element
                }
            } else {
                element
            };

        // XML partial handling (Babel parity): template-root SVG/MathML
        // elements other than <svg>/<math> themselves get wrapped in their
        // owner tag and flagged, and the `xmlns` attribute (only needed to
        // detect the namespace) is dropped from the template.
        let wrapper_tag = self.xml_wrapper_tag(element, &tag_name);
        let skip_xmlns = wrapper_tag.is_some() || tag_name == "svg" || tag_name == "math";

        let mut template = crate::dom::template::TemplateHtml::open_tag(&tag_name);
        let mut declarations = std::vec::Vec::new();
        let mut operations = std::vec::Vec::new();
        let mut dynamics = std::vec::Vec::new();
        let element_id = self.next_element_id();

        let saved_skip_xmlns = self.skip_xmlns_attribute;
        self.skip_xmlns_attribute = skip_xmlns;
        // Attributes only land in the emitted markup — Babel leaves
        // `templateWithClosingTags` attribute-free (solidjs/solid#2338).
        let attribute_result = self.lower_template_attributes(
            &element.opening_element.attributes,
            &tag_name,
            &element_id,
            !element.children.is_empty(),
            &mut template.html,
            &mut declarations,
            &mut operations,
            &mut dynamics,
        );
        self.skip_xmlns_attribute = saved_skip_xmlns;
        let attrs_lowering = attribute_result?;
        let needs_text_placeholder = attrs_lowering.needs_text_placeholder;

        // Babel's textarea `value` fold replaces the element's children
        // (`path.node.children = [child]`).
        let element: &JSXElement<'a> = match attrs_lowering.children_replacement {
            Some(child) => {
                let mut clone = element.clone_in(self.allocator);
                clone.children.clear();
                clone.children.push(child);
                self.allocator.alloc(clone)
            }
            None => element,
        };

        // Babel pushes the custom-element owner-context assignment right
        // after the attribute expressions, before child inserts.
        let needs_custom_element_context =
            self.should_capture_custom_element_context(element, &tag_name);
        if needs_custom_element_context {
            let statement = self.custom_element_context_statement(element.span, &element_id);
            operations.push(statement);
        }

        template.push_both(">");
        if !is_void_element(&tag_name) {
            if needs_text_placeholder && element.children.is_empty() {
                // Dynamic `textContent` adds a single space text node the effect
                // writes into — but only when the element has no children of its
                // own (Babel's `!hasChildren` gate; with children the `firstChild`
                // declaration still emits and the children compile normally).
                // Attribute-driven, so like attributes it stays out of `closed`.
                template.html.push(' ');
            } else {
                self.lower_dom_children(
                    element,
                    &tag_name,
                    &element_id,
                    CloseTagContext::root(),
                    &mut template,
                    &mut declarations,
                    &mut operations,
                    &mut dynamics,
                )?;
            }
        }
        // All dynamic attribute bindings collected across this template root
        // batch into one patch body (eligible scopes — Babel's wrapPatchMode)
        // or one effect, appended after the other expressions.
        let is_root = self.jsx_root_span == Some(element.span);
        let had_dynamics = !dynamics.is_empty();
        // Row-proof inertness is judged BEFORE the dynamics statement joins
        // the operations (Babel checks result.exprs, which never carries it).
        let ops_inert =
            is_root && self.patch_driver.is_some() && operations_are_row_inert(&operations);
        let patched_subject = if self.patch_driver.is_some() {
            match self.wrap_patch_mode_statement(&dynamics) {
                Some((statement, subject)) => {
                    operations.push(statement);
                    Some(subject)
                }
                None => None,
            }
        } else {
            None
        };
        // Row proof (§3c): a template root qualifies when every operation is
        // inert DOM wiring (member-target assignments, addEventListener,
        // runHydrationEvents) and dynamics either don't exist or all landed
        // in ONE patchDriver body. Recorded for `wrap_pure_row`, which stamps
        // the enclosing single-param function.
        if is_root && self.patch_driver.is_some() {
            let pure = ops_inert && (!had_dynamics || patched_subject.is_some());
            self.last_row_proof = pure.then(|| PureRowProof {
                root_span: element.span,
                subject: patched_subject.clone(),
            });
        }
        if patched_subject.is_none() {
            if let Some(statement) = self.wrap_dynamics_statement(dynamics) {
                operations.push(statement);
            }
        }
        if self.should_close_tag(&tag_name, CloseTagContext::root()) {
            template.html.push_str(&format!("</{tag_name}>"));
        }
        if !crate::shared::utils::is_void_element(&tag_name) {
            template.closed.push_str(&format!("</{tag_name}>"));
        }
        if let Some(wrapper) = wrapper_tag {
            template.html = format!("<{wrapper}>{}</{wrapper}>", template.html);
            template.closed = format!("<{wrapper}>{}</{wrapper}>", template.closed);
        }

        let template_flag = if wrapper_tag.is_some() {
            Some(2)
        } else if self.template_subtree_is_import_node(element) {
            Some(1)
        } else {
            None
        };
        // Babel's `skipTemplate`: `$ServerOnly` elements and document shells
        // (`html`/`head`/`body`) never render client-side markup — the element
        // is only recovered from the hydration walk.
        let skip_template = self.hydratable
            && (has_attribute_named(element, "$ServerOnly")
                || matches!(tag_name.as_str(), "html" | "head" | "body"));
        let template_id = if skip_template {
            None
        } else {
            Some(self.template_id_with_options(template, template_flag))
        };
        let has_hydratable_event = self.has_hydratable_event;
        self.has_hydratable_event = saved_hydratable_event;

        if declarations.is_empty() && operations.is_empty() && !has_hydratable_event {
            Ok((
                self.template_call(element.span, template_id.as_deref()),
                std::vec::Vec::new(),
            ))
        } else {
            let init = self.template_call(element.span, template_id.as_deref());
            let mut setup = std::vec::Vec::new();
            setup.push(self.variable_statement(element.span, &element_id, init));
            // Babel hoists all positional walk declarations ahead of the
            // effectful statements (attribute setters, inserts), so walks are
            // resolved before inserts mutate sibling positions.
            setup.extend(declarations);
            setup.extend(operations);
            if has_hydratable_event {
                self.template_state.uses_run_hydration_events = true;
                setup.push(self.ast().statement_expression(
                    element.span,
                    self.call_identifier(
                        element.span,
                        "_$runHydrationEvents",
                        std::vec::Vec::new(),
                    ),
                ));
            }
            Ok((self.identifier_expression(element.span, &element_id), setup))
        }
    }

    fn template_call(&mut self, span: oxc_span::Span, template_id: Option<&str>) -> Expression<'a> {
        if self.hydratable {
            self.template_state.uses_get_next_element = true;
            let args = match template_id {
                Some(template_id) => vec![self.identifier_expression(span, template_id)],
                None => std::vec::Vec::new(),
            };
            self.call_identifier(span, "_$getNextElement", args)
        } else {
            let template_id = template_id.expect("non-hydratable templates are always registered");
            self.call_identifier(span, template_id, std::vec::Vec::new())
        }
    }

    fn should_capture_custom_element_context(
        &self,
        element: &JSXElement<'a>,
        tag_name: &str,
    ) -> bool {
        self.context_to_custom_elements
            && (tag_name == "slot" || self.has_custom_element_marker(element, tag_name))
    }

    fn has_custom_element_marker(&self, element: &JSXElement<'a>, tag_name: &str) -> bool {
        tag_name.contains('-') || has_attribute_named(element, "is")
    }

    /// Owner tag (`svg` / `math`) for a template-root XML partial, detected
    /// by element name or an explicit `xmlns` attribute, mirroring the Babel
    /// plugin's top-level XML handling.
    fn xml_wrapper_tag(&self, element: &JSXElement<'a>, tag_name: &str) -> Option<&'static str> {
        if tag_name == "svg" || tag_name == "math" {
            return None;
        }
        let xmlns = xmlns_attribute_value(element);
        if crate::shared::constants::svg_elements(tag_name)
            || xmlns.as_deref() == Some("http://www.w3.org/2000/svg")
        {
            return Some("svg");
        }
        if crate::shared::constants::mathml_elements(tag_name)
            || xmlns.as_deref() == Some("http://www.w3.org/1998/Math/MathML")
        {
            return Some("math");
        }
        None
    }

    /// Whether any native element in the template's subtree requires
    /// `importNode` cloning (custom elements, `is` attributes, or lazy-loading
    /// img/iframe). Component subtrees produce their own templates and are
    /// not descended into.
    fn template_subtree_is_import_node(&self, element: &JSXElement<'a>) -> bool {
        if is_component_name(&element.opening_element.name) {
            return false;
        }
        let Ok(tag_name) = element_name(&element.opening_element.name) else {
            return false;
        };
        if self.has_custom_element_marker(element, &tag_name)
            || ((tag_name == "img" || tag_name == "iframe")
                && has_attribute_named(element, "loading"))
        {
            return true;
        }
        element.children.iter().any(|child| {
            matches!(
                child,
                oxc_ast::ast::JSXChild::Element(child)
                    if self.template_subtree_is_import_node(child)
            )
        })
    }

    fn custom_element_context_statement(
        &mut self,
        span: oxc_span::Span,
        element_id: &str,
    ) -> Statement<'a> {
        self.template_state.uses_get_owner = true;
        let target = AssignmentTarget::StaticMemberExpression(
            self.ast().alloc_static_member_expression(
                span,
                self.identifier_expression(span, element_id),
                self.ast()
                    .identifier_name(span, self.ast().ident("_$owner")),
                false,
            ),
        );
        let value = self.call_identifier(span, "_$getOwner", std::vec::Vec::new());
        self.ast().statement_expression(
            span,
            self.ast()
                .expression_assignment(span, AssignmentOperator::Assign, target, value),
        )
    }
}

/// Whether an element participates in the element-claim contract:
/// `a[href]` and `form[action]` (attribute present in any form, or a spread
/// that may carry it). Compiled output claims these at creation via
/// `claimElement` so consumers (e.g. a router's link-state layer) can track
/// them without per-element components or observers. Dormant at runtime
/// until a consumer registers.
pub(crate) fn is_claim_target(
    tag_name: &str,
    attributes: &[oxc_ast::ast::JSXAttributeItem<'_>],
) -> bool {
    let attribute_name = match tag_name {
        "a" => "href",
        "form" => "action",
        _ => return false,
    };
    attributes.iter().any(|attr| match attr {
        oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_) => true,
        oxc_ast::ast::JSXAttributeItem::Attribute(attribute) => matches!(
            &attribute.name,
            oxc_ast::ast::JSXAttributeName::Identifier(name) if name.name == attribute_name
        ),
    })
}

/// `is_claim_target` for a whole element node.
pub(crate) fn element_is_claim_target(element: &JSXElement<'_>) -> bool {
    let Ok(tag_name) = element_name(&element.opening_element.name) else {
        return false;
    };
    is_claim_target(&tag_name, &element.opening_element.attributes)
}

fn has_attribute_named(element: &JSXElement<'_>, attribute_name: &str) -> bool {
    element.opening_element.attributes.iter().any(|attr| {
        matches!(
            attr,
            oxc_ast::ast::JSXAttributeItem::Attribute(attribute)
                if matches!(
                    &attribute.name,
                    oxc_ast::ast::JSXAttributeName::Identifier(name)
                        if name.name == attribute_name
                )
        )
    })
}

/// Static string value of an element's `xmlns` attribute, if present.
fn xmlns_attribute_value(element: &JSXElement<'_>) -> Option<String> {
    element.opening_element.attributes.iter().find_map(|attr| {
        let oxc_ast::ast::JSXAttributeItem::Attribute(attr) = attr else {
            return None;
        };
        let oxc_ast::ast::JSXAttributeName::Identifier(name) = &attr.name else {
            return None;
        };
        if name.name != "xmlns" {
            return None;
        }
        match &attr.value {
            Some(oxc_ast::ast::JSXAttributeValue::StringLiteral(value)) => {
                Some(value.value.to_string())
            }
            Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) => {
                match &container.expression {
                    JSXExpression::StringLiteral(value) => Some(value.value.to_string()),
                    _ => None,
                }
            }
            _ => None,
        }
    })
}

/// Matches the Babel plugin's `children`-attribute capture: the last
/// `children` attribute becomes element children (template-inline or
/// insert), never a property write. String attributes are wrapped as
/// expression containers so the child pass can fold them like `{ "hello" }`.
pub(crate) fn children_attribute_child<'a>(
    allocator: &'a Allocator,
    element: &JSXElement<'a>,
) -> Option<oxc_ast::ast::JSXChild<'a>> {
    element
        .opening_element
        .attributes
        .iter()
        .rev()
        .find_map(|attr| children_attribute_child_from_item(allocator, attr))
}

pub(crate) fn children_attribute_child_from_item<'a>(
    allocator: &'a Allocator,
    attr: &oxc_ast::ast::JSXAttributeItem<'a>,
) -> Option<oxc_ast::ast::JSXChild<'a>> {
    let oxc_ast::ast::JSXAttributeItem::Attribute(attr) = attr else {
        return None;
    };
    let oxc_ast::ast::JSXAttributeName::Identifier(name) = &attr.name else {
        return None;
    };
    if name.name != "children" {
        return None;
    }
    let ast = AstBuilder::new(allocator);
    match &attr.value {
        Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) => {
            if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                return None;
            }
            Some(ast.jsx_child_expression_container(
                container.span,
                container.expression.clone_in(allocator),
            ))
        }
        Some(oxc_ast::ast::JSXAttributeValue::StringLiteral(value)) => {
            Some(ast.jsx_child_expression_container(
                value.span,
                JSXExpression::from(ast.expression_string_literal(
                    value.span,
                    ast.str(&value.value),
                    None,
                )),
            ))
        }
        _ => None,
    }
}

pub(crate) fn jsx_expression_to_expression<'a>(
    expression: &JSXExpression<'a>,
    allocator: &'a Allocator,
) -> Expression<'a> {
    expression.clone_in(allocator).into_expression()
}

impl<'a> AstDomTransform<'a, '_> {
    /// Clones an attribute's expression value and lowers any JSX nested
    /// inside it (`innerHTML={cond ? <Comp/> : <Other/>}`) — Babel's generic
    /// traversal transforms nested JSX everywhere, so ours must too.
    pub(crate) fn attribute_value_expression(
        &mut self,
        container: &oxc_ast::ast::JSXExpressionContainer<'a>,
    ) -> Expression<'a> {
        // JSX inside stays raw for the deferred pass (Babel's outer
        // traversal lowers it after the root completes).
        jsx_expression_to_expression(&container.expression, self.allocator)
    }
}

impl AstDomTransform<'_, '_> {
    pub(crate) fn static_jsx_expression_value(
        &self,
        expression: &JSXExpression<'_>,
    ) -> Option<String> {
        static_jsx_expression(expression, Some(&self.bindings))
            .map(StaticValue::into_template_value)
    }

    /// The shared classification authority over this transform's bindings,
    /// source, and configured static marker.
    pub(crate) fn classify(&self) -> crate::shared::classify::Classify<'_> {
        crate::shared::classify::Classify::new(&self.bindings, self.source, &self.static_marker)
    }
}

impl<'a> AstDomTransform<'a, '_> {
    /// Row-proof stamping (§3c): when the just-lowered template root proved
    /// pure and this expression is a single-plain-param function whose body
    /// IS that root — an expression-bodied arrow, or a block that was
    /// ORIGINALLY a lone `return` (pre-walk shape capture; after lowering
    /// the inlined setup statements are indistinguishable from user code) —
    /// wrap it with the runtime's `rowProof` marker. The stamp travels with
    /// the function object, so the patch-mode list driver can engage
    /// without any runtime probe.
    pub(crate) fn wrap_pure_row_expression(&mut self, expression: &mut Expression<'a>) {
        use oxc_span::GetSpan;
        if self.patch_driver.is_none() {
            return;
        }
        let Some(proof) = &self.last_row_proof else {
            return;
        };
        // A block body qualifies only when the ORIGINAL body was a lone
        // return whose (lowered) argument is the proven root.
        let block_return_matches = |body: &oxc_ast::ast::FunctionBody<'a>| -> bool {
            if !self.last_function_single_return {
                return false;
            }
            match body.statements.last() {
                Some(Statement::ReturnStatement(ret)) => ret
                    .argument
                    .as_ref()
                    .is_some_and(|argument| argument.span() == proof.root_span),
                _ => false,
            }
        };
        let (params, body_matches) = match &*expression {
            Expression::ArrowFunctionExpression(arrow) if !arrow.r#async => (
                &arrow.params,
                if arrow.is_expression() {
                    arrow
                        .get_expression()
                        .is_some_and(|body| body.span() == proof.root_span)
                } else {
                    arrow.get_function_body().is_some_and(&block_return_matches)
                },
            ),
            Expression::FunctionExpression(function)
                if !function.r#async && !function.generator =>
            {
                (
                    &function.params,
                    function.body.as_deref().is_some_and(&block_return_matches),
                )
            }
            _ => return,
        };
        if !body_matches {
            return;
        }
        if params.items.len() != 1 || params.rest.is_some() {
            return;
        }
        let oxc_ast::ast::BindingPattern::BindingIdentifier(param) = &params.items[0].pattern
        else {
            return;
        };
        if let Some(subject) = &proof.subject
            && *subject != param.name.as_str()
        {
            return;
        }
        self.last_row_proof = None;
        self.template_state.uses_row_proof = true;
        let span = expression.span();
        let placeholder = self.ast().expression_null_literal(span);
        let function_expr = std::mem::replace(expression, placeholder);
        *expression = self.call_identifier(span, "_$rowProof", vec![function_expr]);
    }
}

/// Row-proof inertness (§3c): every operation a pure row template may carry
/// is inert DOM wiring — assignments whose target is a member chain rooted
/// at an identifier (`_el$.$$click = fn`, `_el$.textContent = v`,
/// `_el$.style.cssText = "…"`), `addEventListener` calls on such a chain,
/// and the hydration-events flush. Anything else (insert holes, components,
/// refs, spreads, effects, memos — all call or conditional shapes) fails the
/// walk. Handler/attribute VALUE expressions stay arbitrary user code:
/// stamped rows only ever build for real mounts, so evaluation timing is
/// identical to the classic path (ruled non-responsibility; the runtime
/// dev-asserts ownership).
fn operations_are_row_inert(operations: &[Statement<'_>]) -> bool {
    fn is_identifier_rooted_member(expr: &Expression<'_>) -> bool {
        match expr {
            Expression::Identifier(_) => true,
            Expression::StaticMemberExpression(member) => {
                !member.optional && is_identifier_rooted_member(&member.object)
            }
            _ => false,
        }
    }
    operations.iter().all(|statement| {
        let Statement::ExpressionStatement(expression_statement) = statement else {
            return false;
        };
        match &expression_statement.expression {
            Expression::AssignmentExpression(assignment) => {
                if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign {
                    return false;
                }
                match &assignment.left {
                    oxc_ast::ast::AssignmentTarget::StaticMemberExpression(member) => {
                        !member.optional && is_identifier_rooted_member(&member.object)
                    }
                    _ => false,
                }
            }
            Expression::CallExpression(call) => match &call.callee {
                Expression::StaticMemberExpression(member) => {
                    member.property.name == "addEventListener"
                        && is_identifier_rooted_member(&member.object)
                }
                Expression::Identifier(ident) => ident.name == "_$runHydrationEvents",
                _ => false,
            },
            _ => false,
        }
    })
}
