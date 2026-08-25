use crate::error::Result;
use oxc_allocator::Vec as ArenaVec;
use oxc_ast::ast::{
    ArrayExpressionElement, Expression, ObjectPropertyKind, Program, Statement,
    TemplateElementValue, VariableDeclarationKind,
};
use oxc_span::Span;
use oxc_syntax::number::NumberBase;

use crate::dom::element::AstDomTransform;
use crate::shared::ast::{
    arrow_iife, arrow_return_expression, expression_to_argument, import_named,
    object_getter_property, object_property, variable_statement,
};
use crate::shared::ast_builder::AstBuilder;
pub(crate) struct DomTemplateState {
    pub(crate) templates: std::vec::Vec<DomTemplate>,
    pub(crate) uses_template: bool,
    pub(crate) uses_get_next_element: bool,
    pub(crate) uses_get_next_marker: bool,
    pub(crate) uses_get_next_match: bool,
    pub(crate) uses_get_first_child: bool,
    pub(crate) uses_get_next_sibling: bool,
    pub(crate) uses_get_owner: bool,
    pub(crate) uses_insert: bool,
    pub(crate) uses_scope: bool,
    pub(crate) uses_memo: bool,
    pub(crate) uses_create_component: bool,
    pub(crate) uses_spread: bool,
    pub(crate) uses_merge_props: bool,
    pub(crate) uses_apply_ref: bool,
    pub(crate) uses_ref: bool,
    pub(crate) uses_style: bool,
    pub(crate) uses_set_style_property: bool,
    pub(crate) uses_class_name: bool,
    pub(crate) uses_effect: bool,
    pub(crate) uses_patch_driver: bool,
    pub(crate) uses_row_proof: bool,
    pub(crate) uses_set_attribute: bool,
    pub(crate) uses_set_attribute_ns: bool,
    pub(crate) uses_claim_element: bool,
    pub(crate) uses_set_property: bool,
    pub(crate) uses_add_event_listener: bool,
    pub(crate) uses_delegate_events: bool,
    pub(crate) uses_run_hydration_events: bool,
    pub(crate) delegated_events: std::vec::Vec<String>,
    pub(crate) built_in_imports: std::vec::Vec<String>,
    /// Last used 0-based `_tmpl$` index (collision skips advance it past the
    /// registry length).
    pub(crate) template_index: usize,
}

pub(crate) struct DomTemplate {
    pub(crate) html: String,
    /// Babel's `templateWithClosingTags`: the same markup without attributes
    /// and with every non-void tag closed — the `validate` input.
    pub(crate) closed_html: String,
    /// `template()` second argument: 1 = importNode cloning, 2 = XML-wrapped.
    pub(crate) flag: Option<u8>,
    /// Generated `_tmpl$N` local (collision-checked against source names).
    pub(crate) name: String,
}

/// A template under construction: the emitted markup (`html`, with omitted
/// closing tags and attributes) alongside Babel's `templateWithClosingTags`
/// variant (`closed`, attribute-free and always closed) used by `validate`.
pub(crate) struct TemplateHtml {
    pub(crate) html: String,
    pub(crate) closed: String,
}

impl TemplateHtml {
    pub(crate) fn open_tag(tag_name: &str) -> Self {
        Self {
            html: format!("<{tag_name}"),
            closed: format!("<{tag_name}"),
        }
    }

    pub(crate) fn push_both(&mut self, text: &str) {
        self.html.push_str(text);
        self.closed.push_str(text);
    }

    pub(crate) fn append(&mut self, other: TemplateHtml) {
        self.html.push_str(&other.html);
        self.closed.push_str(&other.closed);
    }
}

pub(crate) struct InsertMarker<'a> {
    pub(crate) marker: Expression<'a>,
    pub(crate) initial: Option<Expression<'a>>,
}

impl DomTemplateState {
    pub(crate) fn new() -> Self {
        Self {
            templates: std::vec::Vec::new(),
            uses_template: false,
            uses_get_next_element: false,
            uses_get_next_marker: false,
            uses_get_next_match: false,
            uses_get_first_child: false,
            uses_get_next_sibling: false,
            uses_get_owner: false,
            uses_insert: false,
            uses_scope: false,
            uses_memo: false,
            uses_create_component: false,
            uses_spread: false,
            uses_merge_props: false,
            uses_apply_ref: false,
            uses_ref: false,
            uses_style: false,
            uses_set_style_property: false,
            uses_class_name: false,
            uses_effect: false,
            uses_patch_driver: false,
            uses_row_proof: false,
            uses_set_attribute: false,
            uses_set_attribute_ns: false,
            uses_claim_element: false,
            uses_set_property: false,
            uses_add_event_listener: false,
            uses_delegate_events: false,
            uses_run_hydration_events: false,
            delegated_events: std::vec::Vec::new(),
            built_in_imports: std::vec::Vec::new(),
            template_index: 0,
        }
    }
}

impl<'a> AstDomTransform<'a, '_> {
    pub(crate) fn prepend_helpers(&mut self, program: &mut Program<'a>) -> Result<()> {
        let mut statements = std::vec::Vec::new();
        if self.template_state.uses_template {
            statements.push(self.import_named("template", "_$template"));
        }
        if self.template_state.uses_get_next_element {
            statements.push(self.import_named("getNextElement", "_$getNextElement"));
        }
        if self.template_state.uses_get_next_marker {
            statements.push(self.import_named("getNextMarker", "_$getNextMarker"));
        }
        if self.template_state.uses_get_next_match {
            statements.push(self.import_named("getNextMatch", "_$getNextMatch"));
        }
        if self.template_state.uses_get_first_child {
            statements.push(self.import_named("getFirstChild", "_$getFirstChild"));
        }
        if self.template_state.uses_get_next_sibling {
            statements.push(self.import_named("getNextSibling", "_$getNextSibling"));
        }
        if self.template_state.uses_get_owner {
            statements.push(self.import_named("getOwner", "_$getOwner"));
        }
        if self.template_state.uses_insert {
            statements.push(self.import_named("insert", "_$insert"));
        }
        if self.template_state.uses_scope {
            statements.push(self.import_named("scope", "_$scope"));
        }
        if self.template_state.uses_memo {
            let name = self.memo_wrapper.as_deref().unwrap_or("memo").to_string();
            statements.push(self.import_wrapper_helper(&name, &format!("_${name}")));
        }
        if self.template_state.uses_patch_driver {
            let name = self
                .patch_driver
                .as_deref()
                .unwrap_or("patchDriver")
                .to_string();
            // Wrapper-class import (Babel's `registerImportMethod(path, name,
            // undefined)`): resolves against the top-level module — in
            // dynamic mode the base universal module, not the dom renderer's.
            statements.push(self.import_wrapper_helper(&name, &format!("_${name}")));
        }
        if self.template_state.uses_row_proof {
            statements.push(self.import_named("rowProof", "_$rowProof"));
        }
        if self.template_state.uses_create_component {
            statements.push(self.import_wrapper_helper("createComponent", "_$createComponent"));
        }
        if self.template_state.uses_spread {
            statements.push(self.import_named("spread", "_$spread"));
        }
        if self.template_state.uses_merge_props {
            statements.push(self.import_wrapper_helper("mergeProps", "_$mergeProps"));
        }
        if self.template_state.uses_apply_ref {
            statements.push(self.import_wrapper_helper("applyRef", "_$applyRef"));
        }
        if self.template_state.uses_ref {
            statements.push(self.import_named("ref", "_$ref"));
        }
        if self.template_state.uses_style {
            statements.push(self.import_named("style", "_$style"));
        }
        if self.template_state.uses_set_style_property {
            statements.push(self.import_named("setStyleProperty", "_$setStyleProperty"));
        }
        if self.template_state.uses_class_name {
            statements.push(self.import_named("className", "_$className"));
        }
        if self.template_state.uses_effect {
            let name = self
                .effect_wrapper
                .as_deref()
                .unwrap_or("effect")
                .to_string();
            statements.push(self.import_wrapper_helper(&name, &format!("_${name}")));
        }
        if self.template_state.uses_set_attribute {
            statements.push(self.import_named("setAttribute", "_$setAttribute"));
        }
        if self.template_state.uses_set_attribute_ns {
            statements.push(self.import_named("setAttributeNS", "_$setAttributeNS"));
        }
        if self.template_state.uses_claim_element {
            statements.push(self.import_named("claimElement", "_$claimElement"));
        }
        if self.template_state.uses_set_property {
            // Babel registers `setProperty` without a renderer config, so it
            // resolves against the top-level module like the wrappers.
            statements.push(self.import_wrapper_helper("setProperty", "_$setProperty"));
        }
        if self.template_state.uses_add_event_listener {
            statements.push(self.import_named("addEvent", "_$addEvent"));
        }
        if self.template_state.uses_delegate_events {
            statements.push(self.import_named("delegateEvents", "_$delegateEvents"));
        }
        if self.template_state.uses_run_hydration_events {
            statements.push(self.import_named("runHydrationEvents", "_$runHydrationEvents"));
        }
        for built_in in &self.template_state.built_in_imports {
            // Babel's `registerImportMethod(path, name)` resolves built-ins
            // against the top-level module, not the renderer config.
            statements.push(self.import_wrapper_helper(built_in, &format!("_${built_in}")));
        }
        // Babel's postprocess `validate` pass: warn (stderr, like
        // `console.warn`) when a browser would re-parse a template's markup
        // differently. Only DOM templates carry the closing-tags variant —
        // Babel skips SSR templates for the same reason (theirs are AST
        // nodes, not strings).
        if self.validate {
            for template in &self.template_state.templates {
                if let Some(result) =
                    crate::shared::validate::is_invalid_markup(&template.closed_html)
                {
                    eprintln!(
                        "\nThe HTML provided is malformed and will yield unexpected output when evaluated by a browser.\n"
                    );
                    eprintln!("User HTML:\n {}", result.html);
                    eprintln!("Browser HTML:\n {}", result.browser);
                    eprintln!("Original HTML:\n {}", template.closed_html);
                }
            }
        }
        for template in &self.template_state.templates {
            statements.push(self.template_declaration(template));
        }

        statements.extend(program.body.drain(..));
        if self.template_state.uses_delegate_events {
            statements.push(self.delegate_events_statement());
        }
        let mut body = ArenaVec::new_in(&self.allocator);
        body.extend(statements);
        program.body = body;
        Ok(())
    }

    pub(crate) fn template_id_with_options(
        &mut self,
        template: TemplateHtml,
        flag: Option<u8>,
    ) -> String {
        self.template_state.uses_template = true;
        // Templates dedupe on markup alone (the first registration's flag
        // wins), matching the Babel plugin's template registry.
        if let Some(existing) = self
            .template_state
            .templates
            .iter()
            .find(|candidate| candidate.html == template.html)
        {
            existing.name.clone()
        } else {
            let name = crate::shared::utils::next_unique_template_id(
                &mut self.template_state.template_index,
                &self.bindings,
            );
            self.template_state.templates.push(DomTemplate {
                html: template.html,
                closed_html: template.closed,
                flag,
                name: name.clone(),
            });
            name
        }
    }

    pub(crate) fn ast(&self) -> AstBuilder<'a> {
        AstBuilder::new(self.allocator)
    }

    pub(crate) fn insert_statement(
        &self,
        span: Span,
        parent: &str,
        value: Expression<'a>,
        marker: Option<InsertMarker<'a>>,
    ) -> Statement<'a> {
        let mut args = vec![self.identifier_expression(span, parent), value];
        if let Some(marker) = marker {
            args.push(marker.marker);
            if let Some(initial) = marker.initial {
                args.push(initial);
            }
        }
        self.ast()
            .statement_expression(span, self.call_identifier(span, "_$insert", args))
    }

    pub(crate) fn object_property(
        &self,
        span: Span,
        name: &str,
        value: Expression<'a>,
    ) -> ObjectPropertyKind<'a> {
        object_property(self.allocator, span, name, value)
    }

    pub(crate) fn object_getter_property(
        &self,
        span: Span,
        name: &str,
        value: Expression<'a>,
    ) -> ObjectPropertyKind<'a> {
        object_getter_property(self.allocator, span, name, value)
    }

    pub(crate) fn call_identifier(
        &self,
        span: Span,
        callee: &str,
        args: std::vec::Vec<Expression<'a>>,
    ) -> Expression<'a> {
        self.call_expression(span, self.identifier_expression(span, callee), args)
    }

    /// `_$claimElement(_el$)` — the element-claim contract statement emitted
    /// for `a[href]` / `form[action]` at element creation.
    pub(crate) fn claim_element_statement(&mut self, element_id: &str) -> Statement<'a> {
        self.template_state.uses_claim_element = true;
        let span = oxc_span::SPAN;
        let call = self.call_identifier(
            span,
            "_$claimElement",
            vec![self.identifier_expression(span, element_id)],
        );
        self.ast().statement_expression(span, call)
    }

    pub(crate) fn call_expression(
        &self,
        span: Span,
        callee: Expression<'a>,
        args: std::vec::Vec<Expression<'a>>,
    ) -> Expression<'a> {
        let args = self
            .ast()
            .vec_from_iter(args.into_iter().map(expression_to_argument));
        self.ast().expression_call(span, callee, None, args, false)
    }

    pub(crate) fn identifier_expression(&self, span: Span, name: &str) -> Expression<'a> {
        self.ast()
            .expression_identifier(span, self.ast().ident(name))
    }

    pub(crate) fn static_member_expression(
        &self,
        span: Span,
        object: &str,
        property: &str,
    ) -> Expression<'a> {
        Expression::StaticMemberExpression(self.ast().alloc_static_member_expression(
            span,
            self.identifier_expression(span, object),
            self.ast().identifier_name(span, self.ast().ident(property)),
            false,
        ))
    }

    pub(crate) fn static_member_expression_from_expression(
        &self,
        span: Span,
        object: Expression<'a>,
        property: &str,
    ) -> Expression<'a> {
        Expression::StaticMemberExpression(self.ast().alloc_static_member_expression(
            span,
            object,
            self.ast().identifier_name(span, self.ast().ident(property)),
            false,
        ))
    }

    pub(crate) fn child_node_expression(
        &self,
        span: Span,
        parent: &str,
        index: usize,
    ) -> Expression<'a> {
        let mut expression = self.static_member_expression(span, parent, "firstChild");
        for _ in 0..index {
            expression =
                self.static_member_expression_from_expression(span, expression, "nextSibling");
        }
        expression
    }

    /// Positional child lookup following Babel's `tempPath` accumulation:
    /// chains `.nextSibling` hops off the most recently declared walk
    /// variable when one precedes this position (essential when that walk is
    /// a dev-hydration call like `getFirstChild` that a root-relative path
    /// can't express), then off the hydration marker anchor, and only falls
    /// back to a root-relative `firstChild.nextSibling…` walk at the start
    /// of a parent.
    pub(crate) fn child_walk_expression(
        &self,
        span: Span,
        parent: &str,
        index: usize,
    ) -> Expression<'a> {
        let chain_base = match &self.last_child_walk {
            Some((name, walk_index)) if *walk_index < index => Some((name, *walk_index)),
            _ => match &self.hydration_walk_anchor {
                Some((anchor, anchor_index)) if *anchor_index < index => {
                    Some((anchor, *anchor_index))
                }
                _ => None,
            },
        };
        if let Some((name, base_index)) = chain_base {
            let mut expression = self.identifier_expression(span, name);
            for _ in base_index..index {
                expression =
                    self.static_member_expression_from_expression(span, expression, "nextSibling");
            }
            return expression;
        }
        self.child_node_expression(span, parent, index)
    }

    pub(crate) fn variable_statement(
        &self,
        span: Span,
        name: &str,
        init: Expression<'a>,
    ) -> Statement<'a> {
        self.variable_statement_with_kind(span, VariableDeclarationKind::Var, name, init)
    }

    pub(crate) fn const_statement(
        &self,
        span: Span,
        name: &str,
        init: Expression<'a>,
    ) -> Statement<'a> {
        self.variable_statement_with_kind(span, VariableDeclarationKind::Const, name, init)
    }

    fn variable_statement_with_kind(
        &self,
        span: Span,
        kind: VariableDeclarationKind,
        name: &str,
        init: Expression<'a>,
    ) -> Statement<'a> {
        variable_statement(self.allocator, span, kind, name, init)
    }

    pub(crate) fn array_destructure_statement(
        &self,
        span: Span,
        names: &[&str],
        init: Expression<'a>,
    ) -> Statement<'a> {
        let elements = self.ast().vec_from_iter(names.iter().map(|name| {
            Some(
                self.ast()
                    .binding_pattern_binding_identifier(span, self.ast().ident(name)),
            )
        }));
        let declarator = self.ast().variable_declarator(
            span,
            VariableDeclarationKind::Var,
            self.ast()
                .binding_pattern_array_pattern(span, elements, None),
            None,
            Some(init),
            false,
        );
        Statement::VariableDeclaration(self.ast().alloc_variable_declaration(
            span,
            VariableDeclarationKind::Var,
            self.ast().vec1(declarator),
            false,
        ))
    }

    pub(crate) fn arrow_iife(
        &self,
        span: Span,
        statements: ArenaVec<'a, Statement<'a>>,
    ) -> Expression<'a> {
        arrow_iife(self.allocator, span, statements)
    }

    pub(crate) fn arrow_return_expression(
        &self,
        span: Span,
        value: Expression<'a>,
    ) -> Expression<'a> {
        arrow_return_expression(self.allocator, span, value)
    }

    fn import_named(&self, imported: &str, local: &str) -> Statement<'a> {
        import_named(self.allocator, self.module_name, imported, local)
    }

    /// `memo`/`effect` import from the wrapper module when configured (Babel
    /// resolves the reactive wrappers against the top-level module).
    fn import_wrapper_helper(&self, imported: &str, local: &str) -> Statement<'a> {
        let module = self
            .wrapper_module_name
            .as_deref()
            .unwrap_or(self.module_name);
        import_named(self.allocator, module, imported, local)
    }

    fn template_declaration(&self, template: &DomTemplate) -> Statement<'a> {
        let span = Span::new(0, 0);
        let template_literal = self.template_literal_expression(span, &template.html);
        let mut args = vec![template_literal];
        if let Some(flag) = template.flag {
            args.push(self.ast().expression_numeric_literal(
                span,
                f64::from(flag),
                None,
                NumberBase::Decimal,
            ));
        }
        let mut init = self.call_identifier(span, "_$template", args);
        if let Expression::CallExpression(call) = &mut init {
            call.pure = true;
        }
        self.variable_statement(span, &template.name, init)
    }

    fn template_literal_expression(&self, span: Span, value: &str) -> Expression<'a> {
        // `TemplateElementValue::raw` is lexical source text. Newer Oxc
        // codegen emits it verbatim, so escape template delimiters while
        // retaining the original cooked HTML value.
        let raw = value
            .replace('\\', "\\\\")
            .replace('`', "\\`")
            .replace("${", "\\${");
        let element = self.ast().template_element_with_lone_surrogates(
            span,
            TemplateElementValue {
                raw: self.ast().str(&raw),
                cooked: Some(self.ast().str(value)),
            },
            true,
            true,
        );
        self.ast()
            .expression_template_literal(span, self.ast().vec1(element), self.ast().vec())
    }

    fn delegate_events_statement(&self) -> Statement<'a> {
        let span = Span::new(0, 0);
        let events = self
            .ast()
            .vec_from_iter(self.template_state.delegated_events.iter().map(|event| {
                ArrayExpressionElement::StringLiteral(self.ast().alloc_string_literal(
                    span,
                    self.ast().str(event),
                    None,
                ))
            }));
        let events = self.ast().expression_array(span, events);
        self.ast().statement_expression(
            span,
            self.call_identifier(span, "_$delegateEvents", vec![events]),
        )
    }
}
