use crate::error::{Error, Result};
use oxc_allocator::{Allocator, CloneIn, Vec as ArenaVec};
use oxc_ast::ast::{
    Argument, Expression, JSXAttributeItem, JSXAttributeValue, JSXChild, JSXElement, JSXExpression,
    JSXFragment, ObjectPropertyKind, Program, Statement,
};
use oxc_ast_visit::VisitMut;
use oxc_span::{GetSpan, SPAN, Span};

use crate::dom::element::jsx_expression_to_expression;
use crate::shared::array::expression_to_array_element;
use crate::shared::ast::{
    arrow_iife, arrow_return_expression, expression_to_argument, function_body_statements,
    import_named, object_getter_property, object_property, variable_statement,
    zero_arg_iife_statements,
};
use crate::shared::ast_builder::AstBuilder;
use crate::shared::attr_plan::{AttrPlan, AttrPlanner, PlanValue};
use crate::shared::bindings::BindingTable;
use crate::shared::classify::{Classify, jsx_text_is_filtered, significant_children};
use crate::shared::component_callee::{ComponentCalleeContext, component_callee_expression};
use crate::shared::component_props::{
    ComponentPropContext, component_property, component_props_expression,
    component_spread_expression, flush_component_props,
};
use crate::shared::condition::{
    ConditionBuilder, is_condition_shape, transform_condition, transform_condition_inline,
    zero_arg_call_thunk,
};
use crate::shared::constants::{
    DomPropertyState, child_properties, dom_with_state, reserved_namespace,
};
use crate::shared::utils::{
    child_slot_allocates_ids, decode_html_entities, element_name, escape_html_attribute,
    escape_html_text_expression, expression_can_return_hydratable_child, format_number,
    is_component_name, is_void_element, normalize_static_attribute_value, trim_jsx_text,
};

use super::template::SsrTemplate;

pub(crate) struct AstSsrTransform<'a, 'source> {
    pub(crate) allocator: &'a Allocator,
    source: &'source str,
    module_name: &'source str,
    pub(crate) built_ins: std::vec::Vec<String>,
    built_in_imports: std::vec::Vec<String>,
    hydratable: bool,
    server_components: bool,
    wrap_conditionals: bool,
    /// The memo wrapper import name; `None` disables memo wrapping.
    memo_wrapper: Option<String>,
    static_marker: String,
    uses_ssr: bool,
    uses_ssr_hydration_key: bool,
    uses_ssr_select_values: bool,
    uses_escape: bool,
    uses_ssr_element: bool,
    uses_merge_props: bool,
    uses_scope: bool,
    uses_memo: bool,
    uses_ssr_attribute: bool,
    uses_ssr_style: bool,
    uses_ssr_style_property: bool,
    uses_ssr_class_name: bool,
    uses_ssr_group: bool,
    uses_apply_ref: bool,
    uses_ssr_claim: bool,
    pub(crate) pending_this_capture: Option<String>,
    pub(crate) current_this_capture: Option<String>,
    pub(crate) function_parent_stack: std::vec::Vec<crate::shared::transform::FunctionParentKind>,
    pub(crate) next_function_class_method: bool,
    pub(crate) lowered_function_bodies: std::collections::HashSet<usize>,
    this_index: usize,
    value_index: usize,
    ref_index: usize,
    group_index: usize,
    condition_index: usize,
    /// Last used 0-based `_tmpl$` index (collision skips advance it past the
    /// registry length).
    template_index: usize,
    statement_depth: usize,
    /// Hoisted multi-part templates, deduped by content (Babel's program
    /// `templates` scope data): (parts, local name).
    templates: std::vec::Vec<(std::vec::Vec<String>, String)>,
    /// Bare `var` names hoisted to program top for expression-position
    /// temp assignments (Babel's `path.scope.push`).
    hoisted_var_names: std::vec::Vec<String>,
    /// Declaration statements to insert before the statement currently being
    /// processed (Babel's `getStatementParent().insertBefore`).
    pending_statements: std::vec::Vec<Statement<'a>>,
    /// Spans of JSX elements sitting in statement position (`return <jsx/>`,
    /// `const x = <jsx/>`) for the statement currently being processed.
    statement_jsx_spans: std::vec::Vec<Span>,
    /// Scope stack for bare `var` hoisting, mirroring Babel's `Scope.push`
    /// targeting rules: the nearest block parent normally, the function
    /// parent from switch statements, and the scope *outside* the enclosing
    /// function from parameter positions (`getPatternParent`). Falls back to
    /// program top (`hoisted_var_names`) when nothing matches.
    var_scope_stack: std::vec::Vec<VarScope>,
    /// Native elements marked pass-through by `escapeExpression` (Babel's
    /// `wontEscape`), identified by span.
    wont_escape_spans: std::vec::Vec<Span>,
    /// Span of the JSX root currently being lowered via the visitor entry.
    /// Babel keeps a raw `this` in the tag callee of the root element of each
    /// `transformJSX` call; only descendants use the `_self$` capture.
    pub(crate) jsx_root_span: Option<Span>,
    /// True while the deferred-JSX pass re-walks lowered output. Nested
    /// `process_statements` runs (getter bodies) must not flush a `this`
    /// capture pending from the outer statement into their own body.
    deferring: bool,
    /// Node addresses of anonymous function expressions currently being
    /// visited as IIFE callees (`(() => ...)()`): Babel's `scope.push` adds
    /// hoisted `var` uids to these as parameters instead of forcing a block
    /// body.
    pub(crate) iife_callee_addrs: std::vec::Vec<usize>,
    pub(crate) bindings: BindingTable,
    pub(crate) error: Option<String>,
}

/// The Babel scope shapes `Scope.push` distinguishes when placing hoisted
/// `var` declarations.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum VarScopeKind {
    /// A function or block-bodied arrow body — `ensureBlock` + unshift.
    FunctionBody,
    /// An expression-bodied arrow: eligible for the anonymous-IIFE parameter
    /// fast path, otherwise blockified.
    ArrowExpression,
    /// A plain `BlockStatement` (if/loop/catch bodies, naked blocks).
    Block,
    /// A `class { static { ... } }` block.
    StaticBlock,
    /// A switch statement — never targeted directly; pushes route to the
    /// function parent.
    Switch,
    /// Formal parameters — transparent; `getPatternParent` resolves outside
    /// the enclosing function.
    Params,
    /// A manual collection frame (component prop values, class-field arrows)
    /// that intercepts pushes for local placement.
    Collector,
}

struct VarScope {
    kind: VarScopeKind,
    names: std::vec::Vec<String>,
}

/// A `textContent`/`innerHTML` attribute redirected into the element's
/// children (Babel's ChildProperties handling in the SSR generate).
struct AttrChildren<'a> {
    span: Span,
    value: Expression<'a>,
    /// `innerHTML` renders raw; `textContent` escapes like a text child.
    do_not_escape: bool,
    /// `textContent` groups with attribute closures; `innerHTML` stays
    /// opaque (Babel's `_groupableTextContent`).
    groupable: bool,
    /// The source attribute carried the `/*@static*/` marker.
    marker_static: bool,
    /// Only the `children` attribute redirect may allocate hydration ids —
    /// it is a real insert on the client. innerHTML/textContent/innerText
    /// are opaque prop writes there, so their holes never take the
    /// `_$scope` id reservation (solidjs/solid#3015).
    can_allocate_ids: bool,
}

impl<'a, 'source> AstSsrTransform<'a, 'source> {
    /// Local for the configured memo wrapper (Babel's `_$${name}` hint).
    pub(crate) fn memo_wrapper_local(&self) -> String {
        format!("_${}", self.memo_wrapper.as_deref().unwrap_or("memo"))
    }

    /// The shared classification authority over this transform's bindings,
    /// source, and configured static marker.
    pub(crate) fn classify(&self) -> Classify<'_> {
        Classify::new(&self.bindings, self.source, &self.static_marker)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        allocator: &'a Allocator,
        source: &'source str,
        module_name: &'source str,
        hydratable: bool,
        server_components: bool,
        wrap_conditionals: bool,
        memo_wrapper: Option<String>,
        static_marker: String,
        built_ins: std::vec::Vec<String>,
    ) -> Self {
        Self {
            allocator,
            source,
            module_name,
            built_ins,
            built_in_imports: std::vec::Vec::new(),
            hydratable,
            server_components,
            wrap_conditionals,
            memo_wrapper,
            static_marker,
            uses_ssr: false,
            uses_ssr_hydration_key: false,
            uses_ssr_select_values: false,
            uses_escape: false,
            uses_ssr_element: false,
            uses_merge_props: false,
            uses_scope: false,
            uses_memo: false,
            uses_ssr_attribute: false,
            uses_ssr_style: false,
            uses_ssr_style_property: false,
            uses_ssr_class_name: false,
            uses_ssr_group: false,
            uses_apply_ref: false,
            uses_ssr_claim: false,
            pending_this_capture: None,
            current_this_capture: None,
            function_parent_stack: std::vec::Vec::new(),
            next_function_class_method: false,
            lowered_function_bodies: std::collections::HashSet::new(),
            this_index: 0,
            value_index: 0,
            ref_index: 0,
            group_index: 0,
            condition_index: 0,
            template_index: 0,
            statement_depth: 0,
            templates: std::vec::Vec::new(),
            hoisted_var_names: std::vec::Vec::new(),
            pending_statements: std::vec::Vec::new(),
            statement_jsx_spans: std::vec::Vec::new(),
            var_scope_stack: std::vec::Vec::new(),
            wont_escape_spans: std::vec::Vec::new(),
            jsx_root_span: None,
            deferring: false,
            iife_callee_addrs: std::vec::Vec::new(),
            bindings: BindingTable::default(),
            error: None,
        }
    }

    pub(crate) fn push_var_scope(&mut self, kind: VarScopeKind) {
        self.var_scope_stack.push(VarScope {
            kind,
            names: std::vec::Vec::new(),
        });
    }

    pub(crate) fn pop_var_scope(&mut self) -> std::vec::Vec<String> {
        self.var_scope_stack
            .pop()
            .map(|scope| scope.names)
            .unwrap_or_default()
    }

    /// Babel's `Scope.push` targeting: pattern scopes (parameter positions)
    /// resolve outside the enclosing function, switch statements target the
    /// function parent, everything else lands in the innermost block-like
    /// scope. Program top is the final fallback.
    fn push_scope_var(&mut self, name: String) {
        let mut index = self.var_scope_stack.len();
        while index > 0 {
            index -= 1;
            match self.var_scope_stack[index].kind {
                // `getPatternParent` skips both the pattern and the function
                // it belongs to; the function's body frame isn't on the stack
                // while its parameters are being visited, so simply continue.
                VarScopeKind::Params => continue,
                // `if (path.isSwitchStatement()) path = (getFunctionParent()
                // || getProgramParent()).path`.
                VarScopeKind::Switch => {
                    while index > 0 {
                        index -= 1;
                        if matches!(
                            self.var_scope_stack[index].kind,
                            VarScopeKind::FunctionBody
                                | VarScopeKind::ArrowExpression
                                | VarScopeKind::Collector
                        ) {
                            self.var_scope_stack[index].names.push(name);
                            return;
                        }
                    }
                    self.hoisted_var_names.push(name);
                    return;
                }
                _ => {
                    self.var_scope_stack[index].names.push(name);
                    return;
                }
            }
        }
        self.hoisted_var_names.push(name);
    }

    /// One combined `var a, b;` statement (Babel's `Scope.push` caches a
    /// single declaration per block and appends declarators to it).
    fn bare_var_declaration(&self, vars: &[String]) -> Option<Statement<'a>> {
        if vars.is_empty() {
            return None;
        }
        let declarators = self.ast().vec_from_iter(vars.iter().map(|name| {
            self.ast().variable_declarator(
                SPAN,
                oxc_ast::ast::VariableDeclarationKind::Var,
                self.ast()
                    .binding_pattern_binding_identifier(SPAN, self.ast().ident(name)),
                None,
                None,
                false,
            )
        }));
        Some(Statement::VariableDeclaration(
            self.ast().alloc_variable_declaration(
                SPAN,
                oxc_ast::ast::VariableDeclarationKind::Var,
                declarators,
                false,
            ),
        ))
    }

    /// Pops the current var scope and unshifts its combined declaration into
    /// the statement list.
    pub(crate) fn attach_var_scope_to_statements(
        &mut self,
        statements: &mut ArenaVec<'a, Statement<'a>>,
    ) {
        let vars = self.pop_var_scope();
        if let Some(declaration) = self.bare_var_declaration(&vars) {
            let mut body = self.ast().vec1(declaration);
            body.extend(statements.drain(..));
            statements.extend(body);
        }
    }

    /// Loops are block parents in Babel's scope model: `Scope.push` on a loop
    /// runs `ensureBlock` and unshifts the `var` declaration into the body,
    /// so a single-statement body gets blockified.
    pub(crate) fn attach_var_scope_to_loop_body(&mut self, body: &mut Statement<'a>) {
        let vars = self.pop_var_scope();
        let Some(declaration) = self.bare_var_declaration(&vars) else {
            return;
        };
        if let Statement::BlockStatement(block) = body {
            let mut statements = self.ast().vec1(declaration);
            statements.extend(block.body.drain(..));
            block.body = statements;
            return;
        }
        let span = body.span();
        let original = std::mem::replace(body, self.ast().statement_empty(span));
        let mut statements = self.ast().vec1(declaration);
        statements.push(original);
        *body = Statement::BlockStatement(self.ast().alloc_block_statement(span, statements));
    }

    /// Attaches collected bare `var` declarations to an arrow function,
    /// converting an expression body into a block (Babel's `scope.push` +
    /// `ensureBlock`).
    pub(crate) fn attach_scope_vars_to_arrow(
        &mut self,
        arrow: &mut oxc_ast::ast::ArrowFunctionExpression<'a>,
        vars: std::vec::Vec<String>,
    ) {
        if vars.is_empty() {
            return;
        }
        // Babel's `Scope.push` fast path: an anonymous function expression
        // that is the callee of its own call (`(() => ...)()`) receives the
        // hoisted uid as a parameter; everything else gets `ensureBlock` plus
        // a `var` declaration unshifted into the body.
        if self
            .iife_callee_addrs
            .contains(&(std::ptr::from_ref(&*arrow) as usize))
        {
            let span = arrow.span;
            for name in &vars {
                arrow.params.items.push(
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
                    ),
                );
            }
            return;
        }
        let Some(declaration) = self.bare_var_declaration(&vars) else {
            return;
        };
        let mut statements = self.ast().vec1(declaration);
        if arrow.is_expression() {
            let expression = arrow
                .get_expression_mut()
                .expect("expression arrow has an expression body");
            let span = expression.span();
            let placeholder = self.ast().expression_null_literal(span);
            let value = std::mem::replace(expression, placeholder);
            statements.push(self.ast().statement_return(span, Some(value)));
            arrow.body = self
                .ast()
                .arrow_function_body_block(self.ast().function_body(
                    span,
                    self.ast().vec(),
                    statements,
                ));
        } else {
            let body = arrow
                .get_function_body_mut()
                .expect("block arrow has a function body");
            statements.extend(body.statements.drain(..));
            body.statements.extend(statements);
        }
    }

    /// The shared attribute preprocessing context (Babel's `willBeSSR`
    /// branches enabled).
    fn attr_planner(&self) -> AttrPlanner<'a, '_> {
        AttrPlanner {
            allocator: self.allocator,
            source: self.source,
            static_marker: &self.static_marker,
            bindings: &self.bindings,
            // SSR has no template-inlined styles pass; the flag only gates
            // dom-generate preprocessing that `is_ssr` skips entirely.
            inline_styles: true,
            skip_xmlns_attribute: false,
            is_ssr: true,
        }
    }

    pub(crate) fn prepend_helpers(&mut self, program: &mut Program<'a>) {
        if !self.uses_ssr
            && !self.uses_ssr_hydration_key
            && !self.uses_ssr_select_values
            && !self.uses_escape
            && !self.uses_ssr_element
            && !self.uses_merge_props
            && !self.uses_scope
            && !self.uses_memo
            && !self.uses_apply_ref
            && self.templates.is_empty()
            && self.hoisted_var_names.is_empty()
            && self.built_in_imports.is_empty()
        {
            return;
        }
        let mut statements = std::vec::Vec::new();
        if self.uses_memo {
            let name = self.memo_wrapper.as_deref().unwrap_or("memo").to_string();
            statements.push(self.import_named(&name, &format!("_${name}")));
        }
        if self.uses_scope {
            statements.push(self.import_named("scope", "_$scope"));
        }
        if self.uses_escape {
            statements.push(self.import_named("escape", "_$escape"));
        }
        if self.uses_ssr {
            statements.push(self.import_named("ssr", "_$ssr"));
        }
        if self.uses_ssr_hydration_key {
            statements.push(self.import_named("ssrHydrationKey", "_$ssrHydrationKey"));
        }
        if self.uses_ssr_select_values {
            statements.push(self.import_named("ssrSelectValues", "_$ssrSelectValues"));
        }
        if self.uses_ssr_attribute {
            statements.push(self.import_named("ssrAttribute", "_$ssrAttribute"));
        }
        if self.uses_ssr_class_name {
            statements.push(self.import_named("ssrClassName", "_$ssrClassName"));
        }
        if self.uses_ssr_style {
            statements.push(self.import_named("ssrStyle", "_$ssrStyle"));
        }
        if self.uses_ssr_style_property {
            statements.push(self.import_named("ssrStyleProperty", "_$ssrStyleProperty"));
        }
        if self.uses_ssr_group {
            statements.push(self.import_named("ssrGroup", "_$ssrGroup"));
        }
        if self.uses_ssr_element {
            statements.push(self.import_named("ssrElement", "_$ssrElement"));
        }
        if self.uses_merge_props {
            statements.push(self.import_named("mergeProps", "_$mergeProps"));
        }
        if self.uses_apply_ref {
            statements.push(self.import_named("applyRef", "_$applyRef"));
        }
        if self.uses_ssr_claim {
            statements.push(self.import_named("ssrClaim", "_$ssrClaim"));
            statements.push(self.import_named("sharedConfig", "_$sharedConfig"));
        }
        for built_in in &self.built_in_imports {
            statements.push(self.import_named(built_in, &format!("_${built_in}")));
        }
        // Bare `var _v$N;` hoists for expression-position temp assignments,
        // then the deduped template declarations — matching Babel's
        // program-top layout (one combined `var _ref$, _v$…;` declaration,
        // then `var _tmpl$ = …`).
        let hoisted = std::mem::take(&mut self.hoisted_var_names);
        if let Some(declaration) = self.bare_var_declaration(&hoisted) {
            statements.push(declaration);
        }
        for (parts, name) in std::mem::take(&mut self.templates) {
            // Single-part templates register as plain strings, multi-part as
            // arrays (Babel's `createTemplate` for SSR).
            let init = if parts.len() == 1 {
                self.ast()
                    .expression_string_literal(SPAN, self.ast().str(&parts[0]), None)
            } else {
                self.template_array_expression(SPAN, &parts)
            };
            statements.push(variable_statement(
                self.allocator,
                SPAN,
                oxc_ast::ast::VariableDeclarationKind::Var,
                &name,
                init,
            ));
        }
        if self.uses_ssr_select_values {
            // `_$ssrSelectValues();` — arms the runtime's select-value
            // resolution pass (only modules that bind a select value, or
            // spread onto a select, opt the app in). Matches the Babel
            // plugin's post-template statement position.
            let callee = self
                .ast()
                .expression_identifier(SPAN, self.ast().ident("_$ssrSelectValues"));
            let call = self
                .ast()
                .expression_call(SPAN, callee, None, self.ast().vec(), false);
            statements.push(self.ast().statement_expression(SPAN, call));
        }
        statements.extend(program.body.drain(..));
        let mut body = ArenaVec::new_in(&self.allocator);
        body.extend(statements);
        program.body = body;
    }

    fn template_array_expression(&self, span: Span, parts: &[String]) -> Expression<'a> {
        self.ast().expression_array(
            span,
            self.ast().vec_from_iter(parts.iter().map(|part| {
                oxc_ast::ast::ArrayExpressionElement::StringLiteral(
                    self.ast()
                        .alloc_string_literal(span, self.ast().str(part), None),
                )
            })),
        )
    }

    /// Registers a multi-part template in the program-level table, deduping
    /// by content, and returns the `_tmpl$N` local (Babel's `templates`
    /// program-scope data).
    fn register_template(&mut self, parts: &[String]) -> String {
        if let Some((_, name)) = self
            .templates
            .iter()
            .find(|(existing, _)| existing == parts)
        {
            return name.clone();
        }
        let name =
            crate::shared::utils::next_unique_template_id(&mut self.template_index, &self.bindings);
        self.templates.push((parts.to_vec(), name.clone()));
        name
    }

    /// Babel's `getStaticExpression` (`path.evaluate()`): resolves constant
    /// string/number bindings collected while walking statements.
    fn static_jsx_expression_value(&self, expression: &JSXExpression<'_>) -> Option<String> {
        crate::shared::utils::static_jsx_expression(expression, Some(&self.bindings))
            .map(crate::shared::utils::StaticValue::into_template_value)
    }

    fn next_value_id(&mut self) -> String {
        crate::shared::utils::next_unique_local("_v", &mut self.value_index, &self.bindings)
    }

    fn next_ref_id(&mut self) -> String {
        crate::shared::utils::next_unique_local("_ref", &mut self.ref_index, &self.bindings)
    }

    fn next_group_id(&mut self) -> String {
        crate::shared::utils::next_unique_local("_g", &mut self.group_index, &self.bindings)
    }

    /// Babel's `hoistExpression`: every dynamic hole gets a `_v$N` temp for
    /// call-site IC stability. `group` marks it groupable; `post` routes it
    /// to the post bucket (stateful attrs evaluate last, never group).
    fn hoist_expression(
        &mut self,
        template: &mut SsrTemplate<'a>,
        span: Span,
        value: Expression<'a>,
        group: bool,
        post: bool,
    ) -> Expression<'a> {
        let name = self.next_value_id();
        if post {
            template.post_declarations.push((name.clone(), value));
        } else {
            template.declarations.push(Some((name.clone(), value)));
            if group {
                template.groupable.push(name.clone());
            }
        }
        self.ast()
            .expression_identifier(span, self.ast().ident(&name))
    }

    pub(crate) fn lower_element(&mut self, element: &JSXElement<'a>) -> Result<Expression<'a>> {
        self.lower_element_impl(element, true)
    }

    fn lower_element_impl(
        &mut self,
        element: &JSXElement<'a>,
        top_level: bool,
    ) -> Result<Expression<'a>> {
        if is_component_name(&element.opening_element.name) {
            return self.lower_component(element);
        }
        if element
            .opening_element
            .attributes
            .iter()
            .any(|attr| matches!(attr, JSXAttributeItem::SpreadAttribute(_)))
        {
            return self.lower_spread_element(element, top_level);
        }
        let mut template = self.ssr_template(element, top_level)?;
        // Grouping runs once at the top-level element so contiguous closures
        // across nested elements can collapse into a single grouped function.
        if top_level {
            self.group_attribute_closures(&mut template);
        }
        self.finalize_template(element, template)
    }

    /// Emits the `ssr(...)` call for a lowered template root and flushes its
    /// hoisted declarations — before the enclosing statement when the JSX
    /// sits in statement position, or as program-hoisted bare vars plus a
    /// comma sequence otherwise (Babel's `createTemplate` for SSR).
    fn finalize_template(
        &mut self,
        element: &JSXElement<'a>,
        template: SsrTemplate<'a>,
    ) -> Result<Expression<'a>> {
        let span = element.span;
        let wont_escape = self.wont_escape_spans.contains(&element.span);
        let template_local = self.register_template(&template.parts);
        // A pass-through element (already inside `_$escape`) with a static
        // template needs no `ssr()` wrapper — the raw HTML template reference
        // suffices (Babel returns the `_tmpl$` id directly).
        if wont_escape && template.parts.len() == 1 {
            return Ok(self
                .ast()
                .expression_identifier(span, self.ast().ident(&template_local)));
        }
        self.uses_ssr = true;
        let ssr_call = self.ssr_call(span, &template_local, template.parts.len(), template.values);
        let declarations: std::vec::Vec<(String, Expression<'a>)> = template
            .declarations
            .into_iter()
            .flatten()
            .chain(template.post_declarations)
            .collect();
        if declarations.is_empty() {
            return Ok(ssr_call);
        }

        if self.statement_jsx_spans.contains(&element.span) {
            // Statement position: one combined `var _v$ = init1, _v$2 = …;`
            // declaration before the parent statement (Babel's
            // `insertBefore` in `ssr/template.ts`).
            let declarators =
                self.ast()
                    .vec_from_iter(declarations.into_iter().map(|(name, init)| {
                        self.ast().variable_declarator(
                            span,
                            oxc_ast::ast::VariableDeclarationKind::Var,
                            self.ast()
                                .binding_pattern_binding_identifier(span, self.ast().ident(&name)),
                            None,
                            Some(init),
                            false,
                        )
                    }));
            self.pending_statements.push(Statement::VariableDeclaration(
                self.ast().alloc_variable_declaration(
                    span,
                    oxc_ast::ast::VariableDeclarationKind::Var,
                    declarators,
                    false,
                ),
            ));
            return Ok(ssr_call);
        }

        // Expression position: hoist bare `var` declarations to the scope
        // Babel's `Scope.push` would target and assign inline so side effects
        // fire only when the surrounding control flow selects this branch.
        let mut expressions = self.ast().vec();
        for (name, init) in declarations {
            self.push_scope_var(name.clone());
            let target = oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(
                self.ast()
                    .alloc_identifier_reference(span, self.ast().ident(&name)),
            );
            expressions.push(self.ast().expression_assignment(
                span,
                oxc_ast::ast::AssignmentOperator::Assign,
                target,
                init,
            ));
        }
        expressions.push(ssr_call);
        Ok(self.ast().expression_sequence(span, expressions))
    }

    /// Babel's `groupAttributeClosures`: coalesce contiguous runs of >=2
    /// groupable template values into `_$ssrGroup(() => [...bodies], N)`,
    /// repeated N times in the value list.
    fn group_attribute_closures(&mut self, template: &mut SsrTemplate<'a>) {
        if template.groupable.len() < 2 {
            return;
        }
        struct GroupRun {
            start: usize,
            end: usize,
            ids: std::vec::Vec<String>,
        }
        let is_groupable = |value: &Expression<'a>, groupable: &[String]| -> Option<String> {
            if let Expression::Identifier(identifier) = value
                && groupable
                    .iter()
                    .any(|name| name == identifier.name.as_str())
            {
                return Some(identifier.name.to_string());
            }
            None
        };
        let mut runs: std::vec::Vec<GroupRun> = std::vec::Vec::new();
        let mut run_start: Option<usize> = None;
        let mut run_ids: std::vec::Vec<String> = std::vec::Vec::new();
        for index in 0..=template.values.len() {
            let id = template
                .values
                .get(index)
                .and_then(|value| is_groupable(value, &template.groupable));
            match id {
                Some(id) => {
                    if run_start.is_none() {
                        run_start = Some(index);
                        run_ids = std::vec::Vec::new();
                    }
                    run_ids.push(id);
                }
                None => {
                    if let Some(start) = run_start.take() {
                        if run_ids.len() >= 2 {
                            runs.push(GroupRun {
                                start,
                                end: index,
                                ids: std::mem::take(&mut run_ids),
                            });
                        } else {
                            run_ids.clear();
                        }
                    }
                }
            }
        }
        if runs.is_empty() {
            return;
        }

        // Reverse so splices for earlier runs don't shift later indices.
        for run in runs.into_iter().rev() {
            let mut bodies = self.ast().vec();
            let mut first_slot: Option<usize> = None;
            for (position, id) in run.ids.iter().enumerate() {
                let Some(slot) = template.declarations.iter().position(|declaration| {
                    declaration.as_ref().is_some_and(|(name, _)| name == id)
                }) else {
                    continue;
                };
                let (_, init) = template.declarations[slot]
                    .take()
                    .expect("declaration slot exists after position check");
                // Arrow with a single-return body inlines its body; anything
                // else (identifiers, escape calls, …) drops in as-is — the
                // runtime's type dispatch handles both fn and value slots.
                let body = self.unwrap_expression_arrow(init);
                bodies.push(expression_to_array_element(body));
                if position == 0 {
                    first_slot = Some(slot);
                }
            }
            let Some(first_slot) = first_slot else {
                continue;
            };
            let group_id = self.next_group_id();
            self.uses_ssr_group = true;
            let count = bodies.len();
            let body_array = self.ast().expression_array(SPAN, bodies);
            let group_arrow = arrow_return_expression(self.allocator, SPAN, body_array);
            let group_init = self.call_expression(
                SPAN,
                self.ast()
                    .expression_identifier(SPAN, self.ast().ident("_$ssrGroup")),
                vec![
                    group_arrow,
                    self.ast().expression_numeric_literal(
                        SPAN,
                        count as f64,
                        None,
                        oxc_ast::ast::NumberBase::Decimal,
                    ),
                ],
            );
            template.declarations[first_slot] = Some((group_id.clone(), group_init));

            let replacements: std::vec::Vec<Expression<'a>> = (0..run.ids.len())
                .map(|_| {
                    self.ast()
                        .expression_identifier(SPAN, self.ast().ident(&group_id))
                })
                .collect();
            template.values.splice(run.start..run.end, replacements);
        }
    }

    fn lower_component(&mut self, element: &JSXElement<'a>) -> Result<Expression<'a>> {
        let root_tag = self.jsx_root_span == Some(element.span);
        let component = component_callee_expression(self, &element.opening_element.name, root_tag)?;
        let mut prop_objects = std::vec::Vec::new();
        let mut running_props = std::vec::Vec::new();
        let mut force_merge_props = false;
        // Ref-protocol `var _ref$ = call();` statements — Babel pushes these
        // to `exprs` and wraps the component call in an IIFE at the end.
        let mut component_setup = std::vec::Vec::new();

        for attr in &element.opening_element.attributes {
            let attr = match attr {
                JSXAttributeItem::Attribute(attr) => attr,
                JSXAttributeItem::SpreadAttribute(spread) => {
                    flush_component_props(
                        self,
                        &mut running_props,
                        &mut prop_objects,
                        element.span,
                    );
                    let spread = component_spread_expression(self, &spread.argument, spread.span);
                    force_merge_props = force_merge_props || spread.force_merge;
                    prop_objects.push(spread.value);
                    continue;
                }
            };
            // Namespaced attributes pass through as literal `ns:name` prop
            // keys (Babel's `convertJSXIdentifier` string form).
            let name = match &attr.name {
                oxc_ast::ast::JSXAttributeName::Identifier(name) => name.name.to_string(),
                oxc_ast::ast::JSXAttributeName::NamespacedName(name) => {
                    format!("{}:{}", name.namespace.name, name.name.name)
                }
            };
            // The component ref protocol only applies to expression-container
            // values (Babel's `isJSXExpressionContainer` gate).
            if name == "ref"
                && let Some(JSXAttributeValue::ExpressionContainer(container)) = &attr.value
                && container.expression.as_expression().is_some()
            {
                let value = self.transform_component_expression(&container.expression);
                if let Some(prop) = crate::shared::refs::component_ref_property(
                    self,
                    attr.span,
                    value,
                    &mut component_setup,
                ) {
                    running_props.push(prop);
                }
                continue;
            }
            let (value, needs_getter, setup) = match &attr.value {
                None => (
                    self.ast().expression_boolean_literal(attr.span, true),
                    false,
                    std::vec::Vec::new(),
                ),
                Some(JSXAttributeValue::StringLiteral(value)) => {
                    let value = decode_html_entities(&value.value);
                    (
                        self.ast().expression_string_literal(
                            attr.span,
                            self.ast().str(&value),
                            None,
                        ),
                        false,
                        std::vec::Vec::new(),
                    )
                }
                Some(JSXAttributeValue::ExpressionContainer(container)) => {
                    let needs_getter = self.component_prop_requires_getter(&name, container);
                    if needs_getter {
                        // Babel leaves the raw expression in the generated
                        // getter and transforms it there on re-traversal: a
                        // root JSX value behaves like `return <jsx/>` (its
                        // `var _v$ = init;` declarations become getter setup
                        // statements) and nested JSX hoists bare vars to the
                        // getter scope.
                        let root_jsx_span = match &container.expression {
                            JSXExpression::JSXElement(element) => Some(element.span),
                            _ => None,
                        };
                        if let Some(span) = root_jsx_span {
                            self.statement_jsx_spans.push(span);
                        }
                        self.push_var_scope(VarScopeKind::Collector);
                        let pending_before = self.pending_statements.len();
                        let mut value = self.transform_component_expression(&container.expression);
                        // Condition memo parity with the dom generate: the
                        // server sync memo allocates an owner id just like the
                        // client's, so skipping the wrap here drifts every
                        // hydration id the prop's branch content allocates
                        // (#2959, component flavor — mirrors Babel
                        // shared/component.ts).
                        if self.wrap_conditionals && is_condition_shape(&value) {
                            let span = value.span();
                            value = transform_condition_inline(self, span, value);
                        }
                        let bare_vars = self.pop_var_scope();
                        let mut setup: std::vec::Vec<Statement<'a>> =
                            self.bare_var_declaration(&bare_vars).into_iter().collect();
                        setup.extend(self.pending_statements.split_off(pending_before));
                        if root_jsx_span.is_some() {
                            self.statement_jsx_spans.pop();
                        }
                        (value, true, setup)
                    } else {
                        (
                            self.transform_component_expression(&container.expression),
                            false,
                            std::vec::Vec::new(),
                        )
                    }
                }
                Some(JSXAttributeValue::Element(_) | JSXAttributeValue::Fragment(_)) => {
                    return Err(Error::from_reason(
                        "SSR component JSX attribute values are not implemented in the AST-native milestone yet",
                    ));
                }
            };
            if needs_getter {
                // Babel inlines a zero-arg arrow IIFE value's body straight
                // into the getter (`when={(() => {...})()}` →
                // `get when() {...}`).
                match zero_arg_iife_statements(self.allocator, attr.span, value) {
                    Ok(statements) => {
                        let mut all = self.ast().vec();
                        all.extend(setup);
                        all.extend(statements);
                        running_props.push(
                            crate::shared::ast::object_getter_property_with_statements(
                                self.allocator,
                                attr.span,
                                &name,
                                all,
                            ),
                        );
                    }
                    Err(value) if !setup.is_empty() => {
                        running_props.push(crate::shared::ast::object_getter_property_with_setup(
                            self.allocator,
                            attr.span,
                            &name,
                            setup,
                            value,
                        ));
                    }
                    Err(value) => {
                        running_props.push(component_property(self, attr.span, &name, value, true));
                    }
                }
            } else {
                running_props.push(component_property(
                    self,
                    attr.span,
                    &name,
                    value,
                    needs_getter,
                ));
            }
        }

        if let Some((children, dynamic)) = self.component_children_expression(&element.children)? {
            if dynamic {
                // Babel's getter-body inlining for dynamic children: unwrap a
                // `memo(fn)` call to `fn.body`, a plain function to its body,
                // otherwise `return value`.
                let statements =
                    component_children_getter_statements(self.allocator, element.span, children);
                running_props.push(crate::shared::ast::object_getter_property_with_statements(
                    self.allocator,
                    element.span,
                    "children",
                    statements,
                ));
            } else {
                running_props.push(object_property(
                    self.allocator,
                    element.span,
                    "children",
                    children,
                ));
            }
        }

        flush_component_props(self, &mut running_props, &mut prop_objects, element.span);
        let props = component_props_expression(self, element.span, prop_objects, force_merge_props);
        let call = self.call_expression(element.span, component, vec![props]);
        if component_setup.is_empty() {
            return Ok(call);
        }
        // Babel: `exprs.length > 1` → `(() => { var _ref$ = …; return Comp(props); })()`.
        let mut statements = self.ast().vec();
        statements.extend(component_setup);
        statements.push(self.ast().statement_return(element.span, Some(call)));
        let iife = arrow_iife(self.allocator, element.span, statements);
        Ok(self.call_expression(element.span, iife, std::vec::Vec::new()))
    }

    /// Babel's `transformComponentChildren` (SSR): returns the transformed
    /// children value plus whether it is dynamic (getter-hosted).
    fn component_children_expression(
        &mut self,
        children: &[JSXChild<'a>],
    ) -> Result<Option<(Expression<'a>, bool)>> {
        // `filterChildren`: drop empty expression containers and JSXText whose
        // raw starts with a newline and contains only whitespace.
        let filtered: std::vec::Vec<&JSXChild<'a>> = children
            .iter()
            .filter(|child| match child {
                JSXChild::ExpressionContainer(container) => {
                    !matches!(container.expression, JSXExpression::EmptyExpression(_))
                }
                JSXChild::Text(text) => !jsx_text_is_filtered(&text.value),
                _ => true,
            })
            .collect();
        if filtered.is_empty() {
            return Ok(None);
        }
        // Babel passes `filteredChildren.length > 1` as the per-child
        // createTemplate `wrap` flag — whitespace-only text children that
        // survive `filterChildren` still count toward it.
        let wrap = filtered.len() > 1;

        struct ChildValue<'a> {
            value: Expression<'a>,
            dynamic: bool,
            /// Source node was a container/spread/text (Babel keeps those
            /// as-is when single; elements/fragments force a thunk).
            expression_source: bool,
        }
        let mut values: std::vec::Vec<ChildValue<'a>> = std::vec::Vec::new();
        for child in &filtered {
            match child {
                JSXChild::Text(text) => {
                    let span = text.span;
                    let value = decode_html_entities(&trim_jsx_text(&text.value));
                    if !value.is_empty() {
                        values.push(ChildValue {
                            value: self.ast().expression_string_literal(
                                span,
                                self.ast().str(&value),
                                None,
                            ),
                            dynamic: false,
                            expression_source: true,
                        });
                    }
                }
                JSXChild::Element(element) => values.push(ChildValue {
                    value: self.lower_element(element)?,
                    dynamic: false,
                    expression_source: false,
                }),
                JSXChild::Fragment(fragment) => values.push(ChildValue {
                    value: self.lower_fragment(fragment)?,
                    dynamic: false,
                    expression_source: false,
                }),
                JSXChild::ExpressionContainer(container) => {
                    let dynamic = container.expression.as_expression().is_some_and(|raw| {
                        self.classify()
                            .is_dynamic(Some(container.span.start), raw, true)
                    });
                    if !dynamic {
                        values.push(ChildValue {
                            value: self.transform_component_expression(&container.expression),
                            dynamic: false,
                            expression_source: true,
                        });
                        continue;
                    }
                    let expression =
                        jsx_expression_to_expression(&container.expression, self.allocator);
                    // Component children never use the zero-arg call unwrap
                    // (Babel's `!info.componentChild` gate); conditionals
                    // inline their memos (`transformCondition(..., true)`).
                    let inner = if self.wrap_conditionals && is_condition_shape(&expression) {
                        transform_condition_inline(self, container.span, expression)
                    } else {
                        expression
                    };
                    // memoWrapper: false + multiple children: Babel's
                    // `transformComponentChildren` strips the thunk down to
                    // its body before createTemplate sees it.
                    let value = if wrap && self.memo_wrapper.is_none() {
                        inner
                    } else {
                        let thunk = self.arrow_return_expression(container.span, inner);
                        if wrap {
                            self.memo_wrap_fragment_child(container.span, thunk)
                        } else {
                            thunk
                        }
                    };
                    values.push(ChildValue {
                        value,
                        dynamic: true,
                        expression_source: true,
                    });
                }
                JSXChild::Spread(spread) => {
                    let expression = spread.expression.clone_in(self.allocator);
                    let dynamic = self.classify().is_dynamic(None, &expression, false);
                    if !dynamic {
                        values.push(ChildValue {
                            value: expression,
                            dynamic: false,
                            expression_source: true,
                        });
                        continue;
                    }
                    let value = if wrap && self.memo_wrapper.is_none() {
                        expression
                    } else {
                        let thunk = self.arrow_return_expression(spread.span, expression);
                        if wrap {
                            self.memo_wrap_fragment_child(spread.span, thunk)
                        } else {
                            thunk
                        }
                    };
                    values.push(ChildValue {
                        value,
                        dynamic: true,
                        expression_source: true,
                    });
                }
            }
        }

        Ok(match values.len() {
            0 => None,
            1 => {
                let child = values.pop().expect("component child exists");
                if child.expression_source {
                    Some((child.value, child.dynamic))
                } else {
                    // Elements/fragments force a thunk (Babel's single-child
                    // branch in `transformComponentChildren`): a zero-arg
                    // IIFE unwraps to its callee, anything else — including
                    // `memo(...)` calls from fragment children — arrow-wraps
                    // so the getter returns it as-is instead of unwrapping
                    // the memo.
                    let span = child.value.span();
                    let (value, setup) =
                        crate::shared::ast::split_zero_arg_iife(self.allocator, child.value);
                    let mut statements = self.ast().vec();
                    statements.extend(setup);
                    statements.push(self.ast().statement_return(span, Some(value)));
                    Some((arrow_iife(self.allocator, span, statements), true))
                }
            }
            _ => {
                let span = children
                    .first()
                    .map_or_else(|| Span::new(0, 0), |child| child.span());
                let elements = values
                    .into_iter()
                    .map(|child| expression_to_array_element(child.value));
                Some((
                    self.ast()
                        .expression_array(span, self.ast().vec_from_iter(elements)),
                    true,
                ))
            }
        })
    }

    fn transform_component_expression(&mut self, expression: &JSXExpression<'a>) -> Expression<'a> {
        // JSX inside the value stays raw: Babel builds prop getters around
        // the untransformed expression and its outer traversal lowers the
        // JSX later, hoisting temp vars into the enclosing closure. `this`
        // was already rewritten by the root-level `transformThis` pass.
        jsx_expression_to_expression(expression, self.allocator)
    }

    fn component_prop_requires_getter(
        &self,
        name: &str,
        container: &oxc_ast::ast::JSXExpressionContainer<'_>,
    ) -> bool {
        if name == "ref" {
            return false;
        }
        // Babel gates component-prop getters on
        // `isDynamic(value, { checkMember: true, checkTags: true })` —
        // marker comments and namespace-import members short-circuit inside
        // the shared predicate.
        container.expression.as_expression().is_some_and(|expr| {
            self.classify()
                .is_dynamic(Some(container.span.start), expr, true)
        })
    }

    fn lower_spread_element(
        &mut self,
        element: &JSXElement<'a>,
        top_level: bool,
    ) -> Result<Expression<'a>> {
        self.uses_ssr_element = true;
        let tag_name = element_name(&element.opening_element.name)?;
        if tag_name == "select" {
            // A spread on a select can carry `value` — arm conservatively.
            self.uses_ssr_select_values = true;
        }
        let do_not_escape = tag_name == "script" || tag_name == "style";
        let props = self.spread_props(
            &element.opening_element.attributes,
            !element.children.is_empty(),
        )?;
        let children = self.spread_children_expression(&tag_name, element, do_not_escape)?;
        let args = self.ast().vec_from_array([
            Argument::StringLiteral(self.ast().alloc_string_literal(
                element.span,
                self.ast().str(&tag_name),
                None,
            )),
            expression_to_argument(props),
            expression_to_argument(children),
            Argument::BooleanLiteral(
                self.ast()
                    .alloc_boolean_literal(element.span, top_level && self.hydratable),
            ),
        ]);
        Ok(self.ast().expression_call(
            element.span,
            self.ast()
                .expression_identifier(element.span, self.ast().ident("_$ssrElement")),
            None,
            args,
            false,
        ))
    }

    fn spread_props(
        &mut self,
        attributes: &[JSXAttributeItem<'a>],
        has_children: bool,
    ) -> Result<Expression<'a>> {
        // A lone spread attribute passes its argument straight through.
        if attributes.len() == 1
            && let JSXAttributeItem::SpreadAttribute(spread) = &attributes[0]
        {
            return Ok(spread.argument.clone_in(self.allocator));
        }
        let mut prop_objects = std::vec::Vec::new();
        let mut running_props = std::vec::Vec::new();
        let mut dynamic_spread = false;
        for attr in attributes {
            match attr {
                JSXAttributeItem::SpreadAttribute(spread) => {
                    flush_component_props(self, &mut running_props, &mut prop_objects, spread.span);
                    let mut argument = spread.argument.clone_in(self.allocator);
                    // Dynamic spreads defer behind a thunk and force the
                    // mergeProps wrap (Babel's `dynamicSpread`).
                    if self.classify().is_dynamic(None, &argument, false) {
                        dynamic_spread = true;
                        argument = self.inline_call_expression(argument);
                    }
                    prop_objects.push(argument);
                }
                JSXAttributeItem::Attribute(attr) => {
                    if let Some(property) = self.spread_prop_property(attr, has_children)? {
                        running_props.push(property);
                    }
                }
            }
        }
        // Babel pushes the running object even when empty if no props exist.
        if !running_props.is_empty() || prop_objects.is_empty() {
            flush_component_props(self, &mut running_props, &mut prop_objects, Span::new(0, 0));
            if prop_objects.is_empty() {
                prop_objects.push(
                    self.ast()
                        .expression_object(Span::new(0, 0), self.ast().vec()),
                );
            }
        }
        Ok(if prop_objects.len() > 1 || dynamic_spread {
            self.uses_merge_props = true;
            let merged = self.call_expression(
                Span::new(0, 0),
                self.ast()
                    .expression_identifier(Span::new(0, 0), self.ast().ident("_$mergeProps")),
                prop_objects,
            );
            // Defer the merge behind a thunk when hydratable: `mergeProps`
            // with a function source creates a memo, which consumes a
            // hydration child id. Evaluated in argument position it would
            // run before `ssrElement` allocates the element's own id,
            // while the client claims the element (getNextElement) before
            // applying the spread — shifting the element's id by one and
            // leaving it unclaimed. `ssrElement` resolves function props
            // after allocating the hydration key, matching the client.
            if self.hydratable {
                self.arrow_return_expression(Span::new(0, 0), merged)
            } else {
                merged
            }
        } else {
            prop_objects
                .pop()
                .expect("single SSR spread prop object exists")
        })
    }

    fn spread_prop_property(
        &mut self,
        attr: &oxc_ast::ast::JSXAttribute<'a>,
        has_children: bool,
    ) -> Result<Option<ObjectPropertyKind<'a>>> {
        let name = match &attr.name {
            oxc_ast::ast::JSXAttributeName::Identifier(name) => name.name.to_string(),
            oxc_ast::ast::JSXAttributeName::NamespacedName(name) => {
                format!("{}:{}", name.namespace.name, name.name.name)
            }
        };
        if has_children && name == "children" {
            return Ok(None);
        }
        if name == "ref" || name.starts_with("prop:") || name.starts_with("on") {
            return Ok(None);
        }
        match &attr.value {
            None => Ok(Some(self.object_property(
                attr.span,
                &name,
                self.ast().expression_boolean_literal(attr.span, true),
            ))),
            Some(JSXAttributeValue::StringLiteral(value)) => {
                let value = decode_html_entities(&value.value);
                Ok(Some(
                    self.object_property(
                        attr.span,
                        &name,
                        self.ast().expression_string_literal(
                            attr.span,
                            self.ast().str(&value),
                            None,
                        ),
                    ),
                ))
            }
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                let Some(expression) = container.expression.as_expression() else {
                    return Ok(None);
                };
                let value = expression.clone_in(self.allocator);
                // Dynamic values become getters (Babel's objectMethod) unless
                // marked static.
                if self
                    .classify()
                    .is_dynamic(Some(container.span.start), expression, true)
                {
                    Ok(Some(self.object_getter_property(attr.span, &name, value)))
                } else {
                    Ok(Some(self.object_property(attr.span, &name, value)))
                }
            }
            Some(JSXAttributeValue::Element(_) | JSXAttributeValue::Fragment(_)) => {
                Err(Error::from_reason(
                    "SSR JSX attribute values are not implemented in the AST-native milestone yet",
                ))
            }
        }
    }

    /// Babel's `createElement` children reduce: spread elements collect their
    /// children into an array (thunked when hydratable), with static text
    /// inlined as strings and dynamic holes escaped/scoped/marker-boxed.
    fn spread_children_expression(
        &mut self,
        tag_name: &str,
        element: &JSXElement<'a>,
        do_not_escape: bool,
    ) -> Result<Expression<'a>> {
        let children = &element.children;
        let significant = significant_children(children);
        let markers = self.hydratable && significant > 1;
        let mut nodes: std::vec::Vec<Expression<'a>> = std::vec::Vec::new();
        for child in children {
            match child {
                JSXChild::Text(text) => {
                    let span = text.span;
                    let text = decode_html_entities(&trim_jsx_text(&text.value));
                    if !text.is_empty() {
                        nodes.push(self.ast().expression_string_literal(
                            span,
                            self.ast().str(&text),
                            None,
                        ));
                    }
                }
                JSXChild::Fragment(_) => {
                    return Err(Error::from_reason(format!(
                        "Fragments can only be used top level in JSX. Not used under a <{tag_name}>."
                    )));
                }
                JSXChild::Element(child_element)
                    if is_component_name(&child_element.opening_element.name) =>
                {
                    let value = self.lower_component(child_element)?;
                    let value = if do_not_escape {
                        value
                    } else {
                        self.escape_expression_recursive(value, false, false)
                    };
                    if markers {
                        nodes.push(self.marker_string(child_element.span, "<!--$-->"));
                        nodes.push(value);
                        nodes.push(self.marker_string(child_element.span, "<!--/-->"));
                    } else {
                        nodes.push(value);
                    }
                }
                JSXChild::Element(child_element) => {
                    // Nested natives render their own template/ssrElement —
                    // no escaping or markers (Babel: `child.exprs` is empty
                    // for templates, `spreadElement` skips both).
                    nodes.push(self.lower_element_impl(child_element, false)?);
                }
                JSXChild::ExpressionContainer(container) => {
                    if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                        continue;
                    }
                    if let Some(value) = self.static_jsx_expression_value(&container.expression) {
                        // Static text results register as single-string
                        // templates rendered via `_$ssr(_tmpl$)`.
                        let text = if do_not_escape {
                            value
                        } else {
                            escape_html_text_expression(&value)
                        };
                        if text.is_empty() {
                            continue;
                        }
                        let local = self.register_template(std::slice::from_ref(&text));
                        self.uses_ssr = true;
                        nodes.push(self.ssr_call(container.span, &local, 1, std::vec::Vec::new()));
                        continue;
                    }
                    let expression =
                        jsx_expression_to_expression(&container.expression, self.allocator);
                    let dynamic =
                        self.classify()
                            .is_dynamic(Some(container.span.start), &expression, false);
                    let allocates = self.hydratable && child_slot_allocates_ids(child);
                    let value = self.dynamic_child_value(container.span, expression, dynamic);
                    let value = if do_not_escape {
                        value
                    } else {
                        self.escape_expression_recursive(value, false, false)
                    };
                    let value = if allocates && dynamic {
                        self.scope_expression(container.span, value)
                    } else {
                        value
                    };
                    if markers {
                        nodes.push(self.marker_string(container.span, "<!--$-->"));
                        nodes.push(value);
                        nodes.push(self.marker_string(container.span, "<!--/-->"));
                    } else {
                        nodes.push(value);
                    }
                }
                JSXChild::Spread(spread) => {
                    let expression = spread.expression.clone_in(self.allocator);
                    let dynamic = self.classify().is_dynamic(None, &expression, false);
                    let allocates = self.hydratable && child_slot_allocates_ids(child);
                    let value = if dynamic {
                        self.arrow_return_expression(spread.span, expression)
                    } else {
                        expression
                    };
                    let value = if do_not_escape {
                        value
                    } else {
                        self.escape_expression_recursive(value, false, false)
                    };
                    let value = if allocates && dynamic {
                        self.scope_expression(spread.span, value)
                    } else {
                        value
                    };
                    if markers {
                        nodes.push(self.marker_string(spread.span, "<!--$-->"));
                        nodes.push(value);
                        nodes.push(self.marker_string(spread.span, "<!--/-->"));
                    } else {
                        nodes.push(value);
                    }
                }
            }
        }
        Ok(match nodes.len() {
            0 => self
                .ast()
                .expression_identifier(Span::new(0, 0), self.ast().ident("undefined")),
            _ => {
                let value = if nodes.len() == 1 {
                    nodes.pop().expect("length checked")
                } else {
                    self.ast().expression_array(
                        element.span,
                        self.ast().vec_from_iter(
                            nodes
                                .into_iter()
                                .map(crate::shared::array::expression_to_array_element),
                        ),
                    )
                };
                if self.hydratable {
                    self.arrow_return_expression(element.span, value)
                } else {
                    value
                }
            }
        })
    }

    fn marker_string(&self, span: Span, marker: &str) -> Expression<'a> {
        self.ast()
            .expression_string_literal(span, self.ast().str(marker), None)
    }

    pub(crate) fn lower_fragment(&mut self, fragment: &JSXFragment<'a>) -> Result<Expression<'a>> {
        crate::shared::fragment::lower_fragment(self, fragment)
    }

    /// Babel's `createTemplate` wrap for dynamic fragment children:
    /// `_$memo(<escape-wrapped accessor>)` (the accessor body is escaped so
    /// hostile strings can't concatenate raw into the SSR output). Nested JSX
    /// stays raw — the deferred pass lowers it inside the generated accessor
    /// and hoists its temp vars there, matching Babel's re-traversal order.
    fn memo_wrap_fragment_child(&mut self, span: Span, value: Expression<'a>) -> Expression<'a> {
        if self.memo_wrapper.is_none() {
            return value;
        }
        let wrapped = self.wrap_fragment_child_with_escape(span, value);
        self.uses_memo = true;
        let local = self.memo_wrapper_local();
        self.helper_call(span, &local, vec![wrapped])
    }

    fn ssr_template(
        &mut self,
        element: &JSXElement<'a>,
        top_level: bool,
    ) -> Result<SsrTemplate<'a>> {
        let tag_name = element_name(&element.opening_element.name)?;
        // A `<select value=…>` opts this module into the runtime's SSR
        // select-value resolution pass (see prepend_helpers).
        if tag_name == "select"
            && element.opening_element.attributes.iter().any(|a| {
                matches!(a, JSXAttributeItem::Attribute(attr)
                    if matches!(&attr.name, oxc_ast::ast::JSXAttributeName::Identifier(id) if id.name == "value"))
            })
        {
            self.uses_ssr_select_values = true;
        }
        // Babel: `<script>`/`<style>` contents render raw (`path.doNotEscape`).
        let mut child_do_not_escape = tag_name == "script" || tag_name == "style";
        let mut template = SsrTemplate::new(format!("<{tag_name}"));
        if top_level && self.hydratable {
            let key_call = self.ssr_hydration_key_call(element.span);
            let hole = self.hoist_expression(&mut template, element.span, key_call, false, false);
            template.push_expr(hole);
        }
        let outcome = self
            .attr_planner()
            .plan_attributes(&element.opening_element.attributes, &tag_name)?;
        let has_children = !element.children.is_empty() || outcome.children_replacement.is_some();
        let mut attr_children: Option<AttrChildren<'a>> = None;
        // Server-components behavior claims: ref/on* positions collected
        // across the element's attributes (Babel's `claims`).
        let mut claims: std::vec::Vec<(String, Expression<'a>)> = std::vec::Vec::new();
        for plan in outcome.plans {
            self.append_planned_attribute(
                &tag_name,
                plan,
                &mut template,
                has_children,
                &mut attr_children,
                &mut child_do_not_escape,
                &mut claims,
            )?;
        }
        if !claims.is_empty() {
            let hole = self.ssr_claim_hole(element.span, claims, &mut template);
            template.push_expr(hole);
        }
        template.current_mut().push('>');
        if !is_void_element(&tag_name) {
            self.append_children(
                &tag_name,
                element,
                outcome.children_replacement.as_ref(),
                attr_children,
                &mut template,
                child_do_not_escape,
            )?;
            template.current_mut().push_str(&format!("</{tag_name}>"));
        }
        Ok(template)
    }

    /// One planned attribute, following Babel's SSR `transformAttributes`:
    /// refs hoist `_ref$N` declarations, `prop:`/`on*` drop, child properties
    /// redirect into children, class/style get their SSR serializers, and
    /// everything else routes through `setAttr` or an inline quoted hole.
    #[allow(clippy::too_many_arguments)]
    fn append_planned_attribute(
        &mut self,
        tag_name: &str,
        plan: AttrPlan<'a>,
        template: &mut SsrTemplate<'a>,
        has_children: bool,
        attr_children: &mut Option<AttrChildren<'a>>,
        child_do_not_escape: &mut bool,
        claims: &mut std::vec::Vec<(String, Expression<'a>)>,
    ) -> Result<()> {
        let key = plan.key;
        let span = plan.span;
        let reserved = key
            .split_once(':')
            .is_some_and(|(prefix, _)| reserved_namespace(prefix));

        // Babel wraps reserved/child-property literal values into expression
        // containers so they take the dynamic branch; a missing value becomes
        // an empty container that drops out entirely.
        let expression = match plan.value {
            PlanValue::None => {
                if reserved || child_properties(&key) {
                    return Ok(());
                }
                if key == "$ServerOnly" {
                    return Ok(());
                }
                template.current_mut().push_str(&format!(" {key}"));
                return Ok(());
            }
            PlanValue::Literal(text) => {
                if reserved || child_properties(&key) {
                    self.ast()
                        .expression_string_literal(span, self.ast().str(&text), None)
                } else {
                    if key == "$ServerOnly" {
                        return Ok(());
                    }
                    let text = normalize_static_attribute_value(&key, &text);
                    append_ssr_static_attribute(template.current_mut(), &key, &text);
                    return Ok(());
                }
            }
            PlanValue::Expr(expression) => expression,
        };

        let is_literal_container = matches!(
            expression,
            Expression::StringLiteral(_)
                | Expression::NumericLiteral(_)
                | Expression::BooleanLiteral(_)
        );

        if !reserved && !child_properties(&key) && is_literal_container {
            // Babel's static branch for literal expression containers.
            if key == "$ServerOnly" {
                return Ok(());
            }
            match expression {
                // `attr={true}` serializes bare, `attr={false}` is omitted.
                Expression::BooleanLiteral(literal) => {
                    if literal.value {
                        template.current_mut().push_str(&format!(" {key}"));
                    }
                }
                Expression::StringLiteral(literal) => {
                    let text = normalize_static_attribute_value(&key, &literal.value);
                    append_ssr_static_attribute(template.current_mut(), &key, &text);
                }
                Expression::NumericLiteral(literal) => {
                    let text = format_number(literal.value);
                    append_ssr_static_attribute(template.current_mut(), &key, &text);
                }
                _ => unreachable!("static branch only sees literals"),
            }
            return Ok(());
        }

        // Babel's dynamic branch.
        if key == "ref" {
            if self.server_components {
                claims.push(("ref".to_string(), expression));
                return Ok(());
            }
            // `var _ref$N = <expr>;` keeps the evaluation without emitting
            // anything into the HTML. JSX inside stays raw for the deferred
            // pass.
            let value = expression;
            let name = self.next_ref_id();
            template.declarations.push(Some((name, value)));
            return Ok(());
        }
        if key.starts_with("prop:") {
            return Ok(());
        }
        if let Some(rest) = key.strip_prefix("on") {
            // Capture-phase variants can't ride delegation; they drop as
            // before. `on:x` keeps the raw name, `onXxx` lowercases — the
            // same event-name derivation as the client runtime.
            if self.server_components && !key.starts_with("oncapture:") {
                let pos = if let Some(raw) = rest.strip_prefix(':') {
                    raw.to_string()
                } else {
                    rest.to_lowercase()
                };
                if !pos.is_empty() {
                    claims.push((pos, expression));
                }
            }
            return Ok(());
        }
        if child_properties(&key) {
            if key == "children" && is_void_element(tag_name) {
                return Ok(());
            }
            if key == "innerHTML" {
                *child_do_not_escape = true;
            }
            let children = self.attr_children_value(&key, span, expression, plan.marker_static);
            // Babel only redirects when the element has no real children.
            if !has_children {
                *attr_children = children;
            }
            return Ok(());
        }

        let is_dynamic_value =
            !plan.marker_static && self.classify().is_dynamic(None, &expression, true);
        let is_boolean = matches!(expression, Expression::BooleanLiteral(_));
        let mut do_escape = !is_boolean;
        let mut value = expression;
        if key == "style" {
            match &value {
                Expression::ObjectExpression(object)
                    if !object
                        .properties
                        .iter()
                        .any(|p| matches!(p, ObjectPropertyKind::SpreadProperty(_))) =>
                {
                    if object.properties.is_empty() {
                        return Ok(());
                    }
                    value = self.ssr_style_property_chain(span, value);
                }
                _ => {
                    self.uses_ssr_style = true;
                    value = self.helper_call(span, "_$ssrStyle", vec![value]);
                }
            }
            do_escape = false;
        }
        if key == "class" {
            value = self.ssr_class_value(span, value);
            do_escape = false;
        }
        if do_escape {
            value = self.escape_expression_recursive(value, true, false);
        }

        if !(do_escape || is_boolean) || is_literal_expression(&value) {
            if is_boolean {
                if matches!(&value, Expression::BooleanLiteral(literal) if literal.value) {
                    template.current_mut().push_str(&format!(" {key}"));
                }
                return Ok(());
            }
            template.current_mut().push_str(&format!(" {key}=\""));
            let hole = if is_dynamic_value {
                let thunk = self.inline_call_expression(value);
                self.hoist_expression(template, span, thunk, true, false)
            } else {
                value
            };
            template.push_expr(hole);
            template.current_mut().push('"');
            return Ok(());
        }
        self.set_attr(tag_name, span, template, &key, value, is_dynamic_value);
        Ok(())
    }

    /// Babel's SSR `setAttr`: `_$ssrAttribute(name, value)`, hoisted behind an
    /// arrow (and groupable) when dynamic, with stateful DOM properties routed
    /// to the post bucket so they evaluate after everything else.
    fn set_attr(
        &mut self,
        tag_name: &str,
        span: Span,
        template: &mut SsrTemplate<'a>,
        key: &str,
        value: Expression<'a>,
        is_dynamic: bool,
    ) {
        let name = match key.split_once(':') {
            Some((prefix, rest)) if !rest.is_empty() && reserved_namespace(prefix) => rest,
            _ => key,
        };
        self.uses_ssr_attribute = true;
        let name_literal = self
            .ast()
            .expression_string_literal(span, self.ast().str(name), None);
        let attr = self.helper_call(span, "_$ssrAttribute", vec![name_literal, value]);
        if is_dynamic {
            let arrow = self.arrow_return_expression(span, attr);
            let post = matches!(
                dom_with_state(tag_name, name),
                Some(DomPropertyState::Stateful)
            );
            let hole = self.hoist_expression(template, span, arrow, true, post);
            template.push_expr(hole);
        } else {
            template.push_expr(attr);
        }
    }

    /// Babel's SSR style-object serialization: a spread-free object compiles
    /// to a `+`-chain of `_$ssrStyleProperty(...)` calls (computed keys wrap
    /// in `_$escape(key, true)`), values escape as attribute literals.
    fn ssr_style_property_chain(&mut self, span: Span, value: Expression<'a>) -> Expression<'a> {
        let Expression::ObjectExpression(object) = value else {
            unreachable!("style chain only sees spread-free objects");
        };
        let object = object.unbox();
        let mut parts: std::vec::Vec<Expression<'a>> = std::vec::Vec::new();
        for (index, property) in object.properties.into_iter().enumerate() {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            let property = property.unbox();
            if property.method || property.kind != oxc_ast::ast::PropertyKind::Init {
                continue;
            }
            self.uses_ssr_style_property = true;
            let value_escaped = self.escape_expression_recursive(property.value, true, true);
            let part = if property.computed {
                // Computed keys are user-controlled at runtime; wrap with
                // `_$escape(..., true)` so ssrStyleProperty can stay a pure
                // string concat helper (literal-key path is already safe).
                let key = property
                    .key
                    .as_expression()
                    .expect("computed keys are expressions")
                    .clone_in(self.allocator);
                self.uses_escape = true;
                let escaped_key = self.helper_call(
                    span,
                    "_$escape",
                    vec![key, self.ast().expression_boolean_literal(span, true)],
                );
                let prefix = self.ast().expression_binary(
                    span,
                    escaped_key,
                    oxc_ast::ast::BinaryOperator::Addition,
                    self.ast()
                        .expression_string_literal(span, self.ast().str(":"), None),
                );
                self.helper_call(span, "_$ssrStyleProperty", vec![prefix, value_escaped])
            } else {
                let key =
                    crate::shared::attr_plan::static_style_key(&property.key).unwrap_or_default();
                let prefix = format!("{}{}:", if index > 0 { ";" } else { "" }, key);
                let prefix =
                    self.ast()
                        .expression_string_literal(span, self.ast().str(&prefix), None);
                self.helper_call(span, "_$ssrStyleProperty", vec![prefix, value_escaped])
            };
            parts.push(part);
        }
        let mut iter = parts.into_iter();
        let mut result = iter.next().expect("non-empty style object");
        for part in iter {
            result = self.ast().expression_binary(
                span,
                result,
                oxc_ast::ast::BinaryOperator::Addition,
                part,
            );
        }
        result
    }

    /// Babel's SSR class handling: spread-free objects fold through
    /// `transformClasslistObject` into a literal / single value / template
    /// literal; anything else wraps in `_$ssrClassName(...)`.
    fn ssr_class_value(&mut self, span: Span, value: Expression<'a>) -> Expression<'a> {
        let is_plain_object = matches!(
            &value,
            Expression::ObjectExpression(object)
                if !object
                    .properties
                    .iter()
                    .any(|p| matches!(p, ObjectPropertyKind::SpreadProperty(_)))
        );
        if is_plain_object {
            let Expression::ObjectExpression(object) = &value else {
                unreachable!()
            };
            let mut values = std::vec::Vec::new();
            let mut quasis = vec![String::new()];
            self.transform_classlist_object(object, &mut values, &mut quasis);
            if values.is_empty() {
                return self.ast().expression_string_literal(
                    span,
                    self.ast().str(&quasis[0]),
                    None,
                );
            }
            if values.len() == 1 && quasis[0].is_empty() && quasis[1].is_empty() {
                return values.pop().expect("length checked");
            }
            return self.template_literal_from_parts(span, quasis, values);
        }
        self.uses_ssr_class_name = true;
        self.helper_call(span, "_$ssrClassName", vec![value])
    }

    /// Port of Babel's `transformClasslistObject`: static truthy keys join the
    /// quasis, computed keys escape at runtime, everything else becomes a
    /// `cond ? "key" : ""` value slot.
    fn transform_classlist_object(
        &mut self,
        object: &oxc_ast::ast::ObjectExpression<'a>,
        values: &mut std::vec::Vec<Expression<'a>>,
        quasis: &mut std::vec::Vec<String>,
    ) {
        let total = object.properties.len();
        for (index, property) in object.properties.iter().enumerate() {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            if property.method || property.kind != oxc_ast::ast::PropertyKind::Init {
                continue;
            }
            let is_last = index == total - 1;
            let span = property.span;
            let static_key = if property.computed {
                None
            } else {
                match &property.key {
                    oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => {
                        Some(identifier.name.to_string())
                    }
                    oxc_ast::ast::PropertyKey::StringLiteral(value) => {
                        Some(escape_html_text_expression(&value.value))
                    }
                    oxc_ast::ast::PropertyKey::NumericLiteral(value) => {
                        Some(format_number(value.value))
                    }
                    _ => continue,
                }
            };
            if let Expression::BooleanLiteral(literal) = &property.value {
                if !literal.value {
                    continue;
                }
                match static_key {
                    Some(key) => {
                        let last = quasis.last_mut().expect("quasis is non-empty");
                        if index > 0 {
                            last.push(' ');
                        }
                        last.push_str(&key);
                        if !is_last {
                            last.push(' ');
                        }
                    }
                    None => {
                        values.push(self.escaped_classlist_key(span, property));
                        quasis.push(if is_last {
                            String::new()
                        } else {
                            " ".to_string()
                        });
                    }
                }
                continue;
            }
            let key_expression = match static_key {
                Some(key) => self
                    .ast()
                    .expression_string_literal(span, self.ast().str(&key), None),
                None => self.escaped_classlist_key(span, property),
            };
            values.push(
                self.ast().expression_conditional(
                    span,
                    property.value.clone_in(self.allocator),
                    key_expression,
                    self.ast()
                        .expression_string_literal(span, self.ast().str(""), None),
                ),
            );
            quasis.push(if is_last {
                String::new()
            } else {
                " ".to_string()
            });
        }
    }

    fn escaped_classlist_key(
        &mut self,
        span: Span,
        property: &oxc_ast::ast::ObjectProperty<'a>,
    ) -> Expression<'a> {
        self.uses_escape = true;
        let key = property
            .key
            .as_expression()
            .expect("computed keys are expressions")
            .clone_in(self.allocator);
        self.helper_call(
            span,
            "_$escape",
            vec![key, self.ast().expression_boolean_literal(span, true)],
        )
    }

    fn template_literal_from_parts(
        &self,
        span: Span,
        quasis: std::vec::Vec<String>,
        values: std::vec::Vec<Expression<'a>>,
    ) -> Expression<'a> {
        let quasi_count = quasis.len();
        let elements =
            self.ast()
                .vec_from_iter(quasis.into_iter().enumerate().map(|(index, raw)| {
                    let atom = self.ast().str(&raw);
                    self.ast().template_element_with_lone_surrogates(
                        SPAN,
                        oxc_ast::ast::TemplateElementValue {
                            raw: atom,
                            cooked: Some(atom),
                        },
                        index == quasi_count - 1,
                        true,
                    )
                }));
        let expressions = self.ast().vec_from_iter(values);
        self.ast()
            .expression_template_literal(span, elements, expressions)
    }

    /// Builds the redirected child value for `textContent`/`innerHTML`
    /// (Babel: `children = value`, with the hydratable `textContent || " "`
    /// guard).
    fn attr_children_value(
        &mut self,
        key: &str,
        span: Span,
        value: Expression<'a>,
        marker_static: bool,
    ) -> Option<AttrChildren<'a>> {
        let mut value = if self.hydratable && key == "textContent" {
            self.ast().expression_logical(
                span,
                value,
                oxc_ast::ast::LogicalOperator::Or,
                self.ast()
                    .expression_string_literal(span, self.ast().str(" "), None),
            )
        } else {
            value
        };
        // Babel re-evaluates the (possibly guarded) child statically during
        // `transformChildren`; the fold keeps literal text inline.
        self.attr_planner().fold_confident(&mut value);
        Some(AttrChildren {
            span,
            value,
            do_not_escape: key == "innerHTML",
            groupable: key == "textContent",
            marker_static,
            can_allocate_ids: key == "children",
        })
    }

    /// Babel's `transformChildren` for template elements: static text inlines,
    /// nested native elements merge their templates, and everything else
    /// becomes a hoisted `_v$N` hole, boxed by `<!--$-->`/`<!--/-->` markers
    /// when hydratable with multiple significant children.
    fn append_children(
        &mut self,
        tag_name: &str,
        element: &JSXElement<'a>,
        children_replacement: Option<&JSXChild<'a>>,
        attr_children: Option<AttrChildren<'a>>,
        template: &mut SsrTemplate<'a>,
        do_not_escape: bool,
    ) -> Result<()> {
        let children: &[JSXChild<'a>] = if let Some(replacement) = children_replacement {
            std::slice::from_ref(replacement)
        } else {
            &element.children
        };
        let pseudo_child = if children.is_empty() {
            attr_children
        } else {
            None
        };
        let significant = significant_children(children) + usize::from(pseudo_child.is_some());
        let markers = self.hydratable && significant > 1;

        for child in children {
            match child {
                JSXChild::Fragment(_) => {
                    return Err(Error::from_reason(format!(
                        "Fragments can only be used top level in JSX. Not used under a <{tag_name}>."
                    )));
                }
                JSXChild::Text(text) => {
                    // Babel inlines `trimWhitespace(raw)` without escaping —
                    // source entities pass through as written.
                    let text = trim_jsx_text(&text.value);
                    if !text.is_empty() {
                        template.current_mut().push_str(&text);
                    }
                }
                JSXChild::Element(child_element)
                    if is_component_name(&child_element.opening_element.name) =>
                {
                    let value = self.lower_component(child_element)?;
                    let value = if do_not_escape {
                        value
                    } else {
                        self.escape_expression_recursive(value, false, false)
                    };
                    self.append_child_hole(template, child_element.span, value, markers, false);
                }
                JSXChild::Element(child_element) => {
                    if child_element
                        .opening_element
                        .attributes
                        .iter()
                        .any(|attr| matches!(attr, JSXAttributeItem::SpreadAttribute(_)))
                    {
                        // Spread elements render through `ssrElement`; the
                        // hole hoists but never escapes or marker-boxes.
                        let value = self.lower_spread_element(child_element, false)?;
                        let hole = self.hoist_expression(
                            template,
                            child_element.span,
                            value,
                            false,
                            false,
                        );
                        template.push_expr(hole);
                    } else {
                        let child_template = self.ssr_template(child_element, false)?;
                        template.append_template(child_template);
                    }
                }
                JSXChild::ExpressionContainer(container) => {
                    if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                        continue;
                    }
                    if let Some(value) = self.static_jsx_expression_value(&container.expression) {
                        if do_not_escape {
                            template.current_mut().push_str(&value);
                        } else {
                            template
                                .current_mut()
                                .push_str(&escape_html_text_expression(&value));
                        }
                        continue;
                    }
                    let expression =
                        jsx_expression_to_expression(&container.expression, self.allocator);
                    let dynamic =
                        self.classify()
                            .is_dynamic(Some(container.span.start), &expression, false);
                    let allocates = self.hydratable && child_slot_allocates_ids(child);
                    let value = self.dynamic_child_value(container.span, expression, dynamic);
                    let value = if do_not_escape {
                        value
                    } else {
                        self.escape_expression_recursive(value, false, false)
                    };
                    let value = if allocates && dynamic {
                        self.scope_expression(container.span, value)
                    } else {
                        value
                    };
                    self.append_child_hole(template, container.span, value, markers, false);
                }
                JSXChild::Spread(spread) => {
                    let expression = spread.expression.clone_in(self.allocator);
                    let dynamic = self.classify().is_dynamic(None, &expression, false);
                    let allocates = self.hydratable && child_slot_allocates_ids(child);
                    let value = if dynamic {
                        self.arrow_return_expression(spread.span, expression)
                    } else {
                        expression
                    };
                    let value = if do_not_escape {
                        value
                    } else {
                        self.escape_expression_recursive(value, false, false)
                    };
                    let value = if allocates && dynamic {
                        self.scope_expression(spread.span, value)
                    } else {
                        value
                    };
                    self.append_child_hole(template, spread.span, value, markers, false);
                }
            }
        }

        if let Some(children) = pseudo_child {
            self.append_pseudo_child(children, template, markers, do_not_escape)?;
        }
        Ok(())
    }

    /// The `textContent`/`innerHTML` redirect travels through the same child
    /// pipeline as a synthesized expression container (Babel pushes it into
    /// `path.node.children`).
    fn append_pseudo_child(
        &mut self,
        children: AttrChildren<'a>,
        template: &mut SsrTemplate<'a>,
        markers: bool,
        element_do_not_escape: bool,
    ) -> Result<()> {
        let AttrChildren {
            span,
            value,
            do_not_escape,
            groupable,
            marker_static,
            can_allocate_ids,
        } = children;
        let do_not_escape = do_not_escape || element_do_not_escape;
        // Literal after folding — Babel's `getStaticExpression` text path.
        match &value {
            Expression::StringLiteral(literal) => {
                if do_not_escape {
                    let text = literal.value.to_string();
                    template.current_mut().push_str(&text);
                } else {
                    template
                        .current_mut()
                        .push_str(&escape_html_text_expression(&literal.value));
                }
                return Ok(());
            }
            Expression::NumericLiteral(literal) => {
                template
                    .current_mut()
                    .push_str(&format_number(literal.value));
                return Ok(());
            }
            _ => {}
        }
        let dynamic = !marker_static && self.classify().is_dynamic(None, &value, false);
        // Only the `children` attribute redirect may take the `_$scope` id
        // reservation — it is a real insert on the client and scopes there
        // too. innerHTML/textContent/innerText values are opaque content (an
        // HTML/text string) the client applies as plain prop effects with no
        // owner; a scope here would reserve a hydration child id the client
        // never allocates, shifting every keyed sibling after it (#3015).
        let allocates =
            self.hydratable && can_allocate_ids && expression_can_return_hydratable_child(&value);
        let value = self.dynamic_child_value(span, value, dynamic);
        let value = if do_not_escape {
            value
        } else {
            self.escape_expression_recursive(value, false, false)
        };
        let value = if allocates && dynamic {
            self.scope_expression(span, value)
        } else {
            value
        };
        self.append_child_hole(template, span, value, markers, groupable);
        Ok(())
    }

    /// Babel's dynamic-child wrap: conditionals route through
    /// `transformCondition` (hoisted memos become an IIFE), everything else
    /// gets a plain thunk. Non-dynamic values pass through untouched.
    fn dynamic_child_value(
        &mut self,
        span: Span,
        expression: Expression<'a>,
        dynamic: bool,
    ) -> Expression<'a> {
        if !dynamic {
            return expression;
        }
        if self.wrap_conditionals && is_condition_shape(&expression) {
            let transformed = transform_condition(self, span, expression, false);
            return transformed.into_expression(self.allocator, span);
        }
        self.arrow_return_expression(span, expression)
    }

    /// Hoists a child expression into a `_v$N` hole, boxing it with
    /// hydration markers when requested.
    fn append_child_hole(
        &mut self,
        template: &mut SsrTemplate<'a>,
        span: Span,
        value: Expression<'a>,
        markers: bool,
        group: bool,
    ) {
        let hole = self.hoist_expression(template, span, value, group, false);
        if markers {
            template.current_mut().push_str("<!--$-->");
            template.push_expr(hole);
            template.current_mut().push_str("<!--/-->");
        } else {
            template.push_expr(hole);
        }
    }

    fn ast(&self) -> AstBuilder<'a> {
        AstBuilder::new(self.allocator)
    }

    /// `_$ssr(_tmpl$N, ...values)` — values only attach for multi-part
    /// templates (Babel's `createTemplate` for SSR).
    fn ssr_call(
        &self,
        span: Span,
        template_local: &str,
        part_count: usize,
        values: std::vec::Vec<Expression<'a>>,
    ) -> Expression<'a> {
        let template_arg = Argument::Identifier(
            self.ast()
                .alloc_identifier_reference(span, self.ast().ident(template_local)),
        );
        let args = if part_count > 1 {
            self.ast().vec_from_iter(
                std::iter::once(template_arg).chain(values.into_iter().map(expression_to_argument)),
            )
        } else {
            self.ast().vec1(template_arg)
        };
        self.ast().expression_call(
            span,
            self.ast()
                .expression_identifier(span, self.ast().ident("_$ssr")),
            None,
            args,
            false,
        )
    }

    /// One guarded whole-attribute behavior-claim hole per element (Babel's
    /// `claims` emission): duplicate positions merge into arrays (multiple
    /// refs), and the expressions only evaluate when the render context's
    /// claims flag is set —
    /// `_$sharedConfig.context && _$sharedConfig.context.claims
    ///    ? _$ssrClaim({...}) : ""`.
    fn ssr_claim_hole(
        &mut self,
        span: Span,
        claims: std::vec::Vec<(String, Expression<'a>)>,
        template: &mut SsrTemplate<'a>,
    ) -> Expression<'a> {
        self.uses_ssr_claim = true;
        let mut by_pos: std::vec::Vec<(String, std::vec::Vec<Expression<'a>>)> =
            std::vec::Vec::new();
        for (pos, expr) in claims {
            if let Some(entry) = by_pos.iter_mut().find(|(name, _)| *name == pos) {
                entry.1.push(expr);
            } else {
                by_pos.push((pos, vec![expr]));
            }
        }
        let mut properties = self.ast().vec();
        for (pos, mut exprs) in by_pos {
            let value = if exprs.len() == 1 {
                exprs.pop().expect("single claim expression exists")
            } else {
                let elements = self.ast().vec_from_iter(
                    exprs
                        .into_iter()
                        .map(oxc_ast::ast::ArrayExpressionElement::from),
                );
                self.ast().expression_array(span, elements)
            };
            properties.push(self.object_property(span, &pos, value));
        }
        let map = self.ast().expression_object(span, properties);
        let context_read = |transform: &Self| -> Expression<'a> {
            Expression::StaticMemberExpression(
                transform.ast().alloc_static_member_expression(
                    span,
                    transform
                        .ast()
                        .expression_identifier(span, transform.ast().ident("_$sharedConfig")),
                    transform
                        .ast()
                        .identifier_name(span, transform.ast().ident("context")),
                    false,
                ),
            )
        };
        let claims_read =
            Expression::StaticMemberExpression(self.ast().alloc_static_member_expression(
                span,
                context_read(self),
                self.ast().identifier_name(span, self.ast().ident("claims")),
                false,
            ));
        let test = self.ast().expression_logical(
            span,
            context_read(self),
            oxc_ast::ast::LogicalOperator::And,
            claims_read,
        );
        let call = self.call_expression(
            span,
            self.ast()
                .expression_identifier(span, self.ast().ident("_$ssrClaim")),
            vec![map],
        );
        let empty = self
            .ast()
            .expression_string_literal(span, self.ast().str(""), None);
        let guarded = self.ast().expression_conditional(span, test, call, empty);
        self.hoist_expression(template, span, guarded, false, false)
    }

    fn ssr_hydration_key_call(&mut self, span: Span) -> Expression<'a> {
        self.uses_ssr_hydration_key = true;
        self.ast().expression_call(
            span,
            self.ast()
                .expression_identifier(span, self.ast().ident("_$ssrHydrationKey")),
            None,
            self.ast().vec(),
            false,
        )
    }

    fn scope_expression(&mut self, span: Span, value: Expression<'a>) -> Expression<'a> {
        self.uses_scope = true;
        self.ast().expression_call(
            span,
            self.ast()
                .expression_identifier(span, self.ast().ident("_$scope")),
            None,
            self.ast().vec1(expression_to_argument(value)),
            false,
        )
    }

    fn escape_expression(&mut self, span: Span, value: Expression<'a>) -> Expression<'a> {
        self.uses_escape = true;
        self.ast().expression_call(
            span,
            self.ast()
                .expression_identifier(span, self.ast().ident("_$escape")),
            None,
            self.ast().vec1(expression_to_argument(value)),
            false,
        )
    }

    fn escape_attribute_expression(&mut self, span: Span, value: Expression<'a>) -> Expression<'a> {
        self.uses_escape = true;
        self.ast().expression_call(
            span,
            self.ast()
                .expression_identifier(span, self.ast().ident("_$escape")),
            None,
            self.ast().vec_from_array([
                expression_to_argument(value),
                Argument::BooleanLiteral(self.ast().alloc_boolean_literal(span, true)),
            ]),
            false,
        )
    }

    /// Recursive port of Babel's SSR `escapeExpression`: literals pass (or
    /// escape statically with `escape_literals`), functions/templates/
    /// conditionals recurse into their result positions, native JSX marks
    /// pass-through (`wontEscape`), everything else wraps in `_$escape(...)`.
    fn escape_expression_recursive(
        &mut self,
        mut value: Expression<'a>,
        attr: bool,
        escape_literals: bool,
    ) -> Expression<'a> {
        self.escape_expression_in_place(&mut value, attr, escape_literals);
        value
    }

    fn escape_expression_in_place(
        &mut self,
        value: &mut Expression<'a>,
        attr: bool,
        escape_literals: bool,
    ) {
        let escape_static = |text: &str| -> String {
            if attr {
                escape_html_attribute(text)
            } else {
                escape_html_text_expression(text)
            }
        };
        match value {
            Expression::StringLiteral(literal) => {
                if escape_literals {
                    let escaped = escape_static(&literal.value);
                    *value = self.ast().expression_string_literal(
                        literal.span,
                        self.ast().str(&escaped),
                        None,
                    );
                }
            }
            Expression::NumericLiteral(_) => {}
            Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
                if escape_literals {
                    let escaped = escape_static(&template.quasis[0].value.raw);
                    *value = self.ast().expression_string_literal(
                        template.span,
                        self.ast().str(&escaped),
                        None,
                    );
                }
            }
            Expression::ArrowFunctionExpression(arrow) => {
                if let Some(expression) = arrow.get_expression_mut() {
                    self.escape_expression_in_place(expression, attr, escape_literals);
                } else if let Some(body) = arrow.get_function_body_mut() {
                    self.escape_body_returns(&mut body.statements, false, attr, escape_literals);
                }
            }
            Expression::FunctionExpression(function) => {
                if let Some(body) = function.body.as_mut() {
                    self.escape_body_returns(&mut body.statements, false, attr, escape_literals);
                }
            }
            Expression::TemplateLiteral(template) => {
                // Interpolations are escaped recursively. The static quasis
                // are not — `url("${x}")` would otherwise leave a raw `"`
                // inside style="..." / attr="...". Escape those parts at
                // compile time when this expression is landing in an attribute.
                if attr {
                    self.escape_template_quasis_for_attr(template);
                }
                for expression in template.expressions.iter_mut() {
                    self.escape_expression_in_place(expression, attr, escape_literals);
                }
            }
            Expression::UnaryExpression(_) => {}
            Expression::BinaryExpression(binary) => {
                self.escape_expression_in_place(&mut binary.left, attr, escape_literals);
                self.escape_expression_in_place(&mut binary.right, attr, escape_literals);
            }
            Expression::ConditionalExpression(conditional) => {
                self.escape_expression_in_place(&mut conditional.consequent, attr, escape_literals);
                self.escape_expression_in_place(&mut conditional.alternate, attr, escape_literals);
            }
            // `&&` keeps the cheaper short-circuit path; `||`/`??` escape the
            // selected result as a whole (default wrap below).
            Expression::LogicalExpression(logical)
                if logical.operator == oxc_ast::ast::LogicalOperator::And =>
            {
                self.escape_expression_in_place(&mut logical.right, attr, escape_literals);
            }
            Expression::CallExpression(call)
                if matches!(
                    call.callee,
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                ) =>
            {
                match &mut call.callee {
                    Expression::ArrowFunctionExpression(arrow) => {
                        if let Some(expression) = arrow.get_expression_mut() {
                            self.escape_expression_in_place(expression, attr, escape_literals);
                        } else if let Some(body) = arrow.get_function_body_mut() {
                            self.escape_body_returns(
                                &mut body.statements,
                                false,
                                attr,
                                escape_literals,
                            );
                        }
                    }
                    Expression::FunctionExpression(function) => {
                        if let Some(body) = function.body.as_mut() {
                            self.escape_body_returns(
                                &mut body.statements,
                                false,
                                attr,
                                escape_literals,
                            );
                        }
                    }
                    _ => unreachable!("guarded by matches!"),
                }
            }
            Expression::JSXElement(element)
                if !is_component_name(&element.opening_element.name) =>
            {
                // The element compiles to a safe SSR node; the wrap would be
                // a runtime no-op (Babel's `wontEscape`).
                self.wont_escape_spans.push(element.span);
            }
            Expression::JSXFragment(fragment) if fragment_will_self_escape(fragment) => {}
            _ => {
                let span = value.span();
                let placeholder = self.ast().expression_null_literal(span);
                let inner = std::mem::replace(value, placeholder);
                *value = if attr {
                    self.escape_attribute_expression(span, inner)
                } else {
                    self.escape_expression(span, inner)
                };
            }
        }
    }

    /// Escape static template-literal quasis in attribute position so
    /// `url("${x}")` cannot leave a raw `"` inside style="..." / attr="...".
    fn escape_template_quasis_for_attr(&self, template: &mut oxc_ast::ast::TemplateLiteral<'a>) {
        let specs: std::vec::Vec<Option<(String, String)>> = template
            .quasis
            .iter()
            .map(|quasi| {
                let src = quasi
                    .value
                    .cooked
                    .as_deref()
                    .unwrap_or(quasi.value.raw.as_str());
                let escaped = escape_html_attribute(src);
                if escaped == src {
                    None
                } else {
                    let raw = escaped
                        .replace('\\', "\\\\")
                        .replace('`', "\\`")
                        .replace("${", "\\${");
                    Some((escaped, raw))
                }
            })
            .collect();
        for (quasi, spec) in template.quasis.iter_mut().zip(specs) {
            let Some((cooked, raw)) = spec else {
                continue;
            };
            let cooked_atom = self.ast().str(&cooked);
            let raw_atom = self.ast().str(&raw);
            quasi.value.cooked = Some(cooked_atom);
            quasi.value.raw = raw_atom;
        }
    }

    /// Escapes the result positions of a function body: `return` arguments,
    /// or the single expression statement of an expression-bodied arrow.
    fn escape_body_returns(
        &mut self,
        statements: &mut ArenaVec<'a, Statement<'a>>,
        expression_body: bool,
        attr: bool,
        escape_literals: bool,
    ) {
        for statement in statements.iter_mut() {
            match statement {
                Statement::ReturnStatement(ret) => {
                    if let Some(argument) = ret.argument.as_mut() {
                        self.escape_expression_in_place(argument, attr, escape_literals);
                    }
                }
                Statement::ExpressionStatement(statement) if expression_body => {
                    self.escape_expression_in_place(
                        &mut statement.expression,
                        attr,
                        escape_literals,
                    );
                }
                _ => {}
            }
        }
    }

    /// Babel's `inlineCallExpression`: zero-arg calls with simple callees
    /// unwrap to the callee, everything else wraps in a fresh thunk.
    fn inline_call_expression(&self, value: Expression<'a>) -> Expression<'a> {
        if let Some(thunk) = zero_arg_call_thunk(&value, self.allocator) {
            return thunk;
        }
        let span = value.span();
        self.arrow_return_expression(span, value)
    }

    /// An arrow with a single-return (or expression) body exposes that body
    /// expression; anything else stays whole. Used for `ssrGroup` bodies and
    /// the fragment escape wrap.
    fn unwrap_expression_arrow(&self, init: Expression<'a>) -> Expression<'a> {
        let Expression::ArrowFunctionExpression(arrow) = init else {
            return init;
        };
        let mut arrow = arrow.unbox();
        if arrow.params.items.is_empty() {
            if arrow.is_expression() {
                return arrow.body.into_expression();
            }
            let body = arrow
                .get_function_body_mut()
                .expect("block arrow has a function body");
            if body.statements.len() == 1 {
                let statement = body.statements.pop().expect("length checked");
                match statement {
                    Statement::ReturnStatement(ret) if ret.argument.is_some() => {
                        return ret.unbox().argument.expect("checked in guard");
                    }
                    other => body.statements.push(other),
                }
            }
        }
        Expression::ArrowFunctionExpression(self.ast().alloc(arrow))
    }

    /// Babel's `wrapFragmentChildWithEscape`: rewrites an accessor arrow so
    /// its returned value passes through `_$escape`, or wraps opaque values
    /// in `() => _$escape(value())`.
    fn wrap_fragment_child_with_escape(
        &mut self,
        span: Span,
        value: Expression<'a>,
    ) -> Expression<'a> {
        let unwrappable = matches!(
            &value,
            Expression::ArrowFunctionExpression(arrow)
                if arrow.params.items.is_empty()
                    && (arrow.is_expression()
                        || arrow.get_function_body().is_some_and(|body| {
                            body.statements.len() == 1
                                && matches!(
                                    body.statements.first(),
                                    Some(Statement::ReturnStatement(_))
                                )
                        }))
        );
        if unwrappable {
            let body = self.unwrap_expression_arrow(value);
            let escaped = self.escape_expression(span, body);
            self.arrow_return_expression(span, escaped)
        } else {
            let call = self.call_expression(span, value, std::vec::Vec::new());
            let escaped = self.escape_expression(span, call);
            self.arrow_return_expression(span, escaped)
        }
    }

    fn helper_call(
        &self,
        span: Span,
        name: &str,
        args: std::vec::Vec<Expression<'a>>,
    ) -> Expression<'a> {
        self.call_expression(
            span,
            self.ast()
                .expression_identifier(span, self.ast().ident(name)),
            args,
        )
    }

    fn call_expression(
        &self,
        span: Span,
        callee: Expression<'a>,
        args: std::vec::Vec<Expression<'a>>,
    ) -> Expression<'a> {
        self.ast().expression_call(
            span,
            callee,
            None,
            self.ast()
                .vec_from_iter(args.into_iter().map(expression_to_argument)),
            false,
        )
    }

    fn object_property(
        &self,
        span: Span,
        name: &str,
        value: Expression<'a>,
    ) -> ObjectPropertyKind<'a> {
        object_property(self.allocator, span, name, value)
    }

    fn object_getter_property(
        &self,
        span: Span,
        name: &str,
        value: Expression<'a>,
    ) -> ObjectPropertyKind<'a> {
        object_getter_property(self.allocator, span, name, value)
    }

    pub(crate) fn capture_this_expression(&mut self, span: Span) -> Expression<'a> {
        let name = if let Some(name) = &self.pending_this_capture {
            let name = name.clone();
            self.current_this_capture = Some(name.clone());
            name
        } else {
            let name = crate::shared::utils::next_unique_local(
                "_self",
                &mut self.this_index,
                &self.bindings,
            );
            self.pending_this_capture = Some(name.clone());
            self.current_this_capture = Some(name.clone());
            name
        };
        self.ast()
            .expression_identifier(span, self.ast().ident(&name))
    }

    pub(crate) fn take_this_capture_statement(&mut self, span: Span) -> Option<Statement<'a>> {
        let name = self.pending_this_capture.take()?;
        Some(self.const_statement(span, &name, self.ast().expression_this(span)))
    }

    pub(crate) fn clear_this_capture_context(&mut self) {
        self.current_this_capture = None;
    }

    fn const_statement(&self, span: Span, name: &str, init: Expression<'a>) -> Statement<'a> {
        variable_statement(
            self.allocator,
            span,
            oxc_ast::ast::VariableDeclarationKind::Const,
            name,
            init,
        )
    }

    fn import_named(&self, imported: &str, local: &str) -> Statement<'a> {
        import_named(self.allocator, self.module_name, imported, local)
    }
}

/// Babel's getter-body extraction for dynamic component children:
/// `memo(fn)`-style calls unwrap to `fn`'s body, plain functions to their
/// body, anything else becomes `return value;`.
fn component_children_getter_statements<'a>(
    allocator: &'a Allocator,
    span: Span,
    value: Expression<'a>,
) -> ArenaVec<'a, Statement<'a>> {
    let ast = AstBuilder::new(allocator);
    match value {
        Expression::CallExpression(call)
            if matches!(
                call.arguments.first(),
                Some(Argument::ArrowFunctionExpression(_) | Argument::FunctionExpression(_))
            ) =>
        {
            let first = call
                .unbox()
                .arguments
                .into_iter()
                .next()
                .expect("first argument checked above");
            match first {
                Argument::ArrowFunctionExpression(arrow) => {
                    let arrow = arrow.unbox();
                    crate::shared::ast::arrow_body_statements(allocator, span, arrow.body)
                }
                Argument::FunctionExpression(function) => match function.unbox().body {
                    Some(body) => function_body_statements(allocator, span, false, body),
                    None => ast.vec(),
                },
                _ => unreachable!("argument shape checked above"),
            }
        }
        Expression::ArrowFunctionExpression(arrow) => {
            let arrow = arrow.unbox();
            crate::shared::ast::arrow_body_statements(allocator, span, arrow.body)
        }
        Expression::FunctionExpression(function) => match function.unbox().body {
            Some(body) => function_body_statements(allocator, span, false, body),
            None => ast.vec(),
        },
        other => ast.vec1(ast.statement_return(span, Some(other))),
    }
}

impl<'a> crate::shared::refs::RefPropertyContext<'a> for AstSsrTransform<'a, '_> {
    fn allocator(&self) -> &'a Allocator {
        self.allocator
    }

    fn is_const_ref_binding(&self, name: &str) -> bool {
        self.bindings.is_const(name)
    }

    fn next_ref_id(&mut self) -> String {
        AstSsrTransform::next_ref_id(self)
    }

    fn mark_uses_apply_ref(&mut self) {
        self.uses_apply_ref = true;
    }
}

impl<'a> ComponentPropContext<'a> for AstSsrTransform<'a, '_> {
    fn allocator(&self) -> &'a Allocator {
        self.allocator
    }

    fn ast(&self) -> AstBuilder<'a> {
        self.ast()
    }

    fn mark_merge_props(&mut self) {
        self.uses_merge_props = true;
    }

    fn call_identifier(
        &self,
        span: Span,
        callee: &str,
        args: std::vec::Vec<Expression<'a>>,
    ) -> Expression<'a> {
        self.call_expression(
            span,
            self.ast()
                .expression_identifier(span, self.ast().ident(callee)),
            args,
        )
    }

    fn arrow_return_expression(&self, span: Span, value: Expression<'a>) -> Expression<'a> {
        arrow_return_expression(self.allocator, span, value)
    }

    fn object_property(
        &self,
        span: Span,
        name: &str,
        value: Expression<'a>,
    ) -> ObjectPropertyKind<'a> {
        self.object_property(span, name, value)
    }

    fn object_getter_property(
        &self,
        span: Span,
        name: &str,
        value: Expression<'a>,
    ) -> ObjectPropertyKind<'a> {
        self.object_getter_property(span, name, value)
    }
}

impl<'a> ComponentCalleeContext<'a> for AstSsrTransform<'a, '_> {
    fn ast(&self) -> AstBuilder<'a> {
        self.ast()
    }

    fn is_built_in(&self, name: &str) -> bool {
        self.built_ins.iter().any(|built_in| built_in == name)
    }

    fn register_built_in(&mut self, name: &str) {
        if !self
            .built_in_imports
            .iter()
            .any(|built_in| built_in == name)
        {
            self.built_in_imports.push(name.to_string());
        }
    }

    fn is_builtin_shadowed(&self, span: Span) -> bool {
        self.bindings.is_builtin_shadowed(span)
    }

    fn capture_this_callee(&mut self, span: Span) -> Result<Expression<'a>> {
        Ok(self.capture_this_expression(span))
    }
}

impl<'a> AstSsrTransform<'a, '_> {
    pub(crate) fn process_statements(&mut self, statements: &mut ArenaVec<'a, Statement<'a>>) {
        self.statement_depth += 1;
        self.bindings
            .enter_scope(crate::shared::bindings::BindingScopeKind::Block);
        let mut body = ArenaVec::new_in(&self.allocator);
        for mut statement in statements.drain(..) {
            if self.error.is_some() {
                body.push(statement);
                continue;
            }
            self.bindings.collect(&statement);
            // JSX roots sitting directly in `return <jsx/>` / `var x = <jsx/>`
            // emit their hoisted declarations as `var` statements before the
            // parent statement (Babel's `isReturnArg || isVarInit`).
            let recorded = record_statement_jsx_spans(&statement, &mut self.statement_jsx_spans);
            self.visit_statement(&mut statement);
            self.statement_jsx_spans
                .truncate(self.statement_jsx_spans.len() - recorded);
            // Babel replaces a JSX root in place and immediately re-enters the
            // replacement, so raw JSX left inside the statement itself (spread
            // getters on an `ssrElement` call) lowers now; JSX deferred into
            // the hoisted closures below waits for the container-end pass.
            if self.jsx_root_span.is_none() {
                let was_deferring = self.deferring;
                self.deferring = true;
                crate::shared::transform::lower_deferred_jsx_statements(
                    self,
                    std::slice::from_mut(&mut statement),
                );
                self.deferring = was_deferring;
            }
            // While a JSX root is mid-lowering, function bodies visited inside
            // it recurse here; the capture belongs to the statement containing
            // the root (Babel's `getStatementParent().insertBefore`), so leave
            // it pending for the outer level. The same applies while the
            // deferred pass re-enters getter bodies.
            if self.jsx_root_span.is_none()
                && !self.deferring
                && matches!(
                    self.function_parent_stack.last(),
                    Some(crate::shared::transform::FunctionParentKind::ClassMethod)
                )
                && let Some(capture) = self.take_this_capture_statement(statement.span())
            {
                body.push(capture);
                self.clear_this_capture_context();
            }
            for pending in self.pending_statements.drain(..) {
                body.push(pending);
            }
            body.push(statement);
        }
        // Hoisted closures joined Babel's container-level queue when they were
        // inserted, so JSX deferred into them lowers only after every
        // statement in this body has processed its own roots.
        if self.jsx_root_span.is_none() {
            let was_deferring = self.deferring;
            self.deferring = true;
            crate::shared::transform::lower_deferred_jsx_statements(self, &mut body);
            self.deferring = was_deferring;
        }
        self.bindings.exit_scope();
        *statements = body;
        self.statement_depth -= 1;
    }

    pub(crate) fn lower_class_field_value(
        &mut self,
        span: Span,
        value: Expression<'a>,
    ) -> Expression<'a> {
        if let Expression::ArrowFunctionExpression(mut arrow) = value {
            if arrow.is_expression() {
                let placeholder = self.ast().expression_null_literal(span);
                let mut expression = std::mem::replace(
                    arrow
                        .get_expression_mut()
                        .expect("expression arrow has an expression body"),
                    placeholder,
                );
                // The arrow is the JSX root's function parent — keep it on
                // the stack so the root-completion wrap doesn't fire and
                // the capture lands at the top of the arrow body instead.
                // Its var scope collects the expression-position `_v$`
                // hoists (Babel's `scope.push` targets the arrow).
                self.function_parent_stack
                    .push(crate::shared::transform::FunctionParentKind::Arrow);
                self.push_var_scope(VarScopeKind::Collector);
                self.visit_expression(&mut expression);
                let vars = self.pop_var_scope();
                self.function_parent_stack.pop();
                let mut statements = self.ast().vec();
                if let Some(capture) = self.take_this_capture_statement(span) {
                    statements.push(capture);
                    self.clear_this_capture_context();
                }
                statements.extend(self.bare_var_declaration(&vars));
                statements.push(self.ast().statement_return(span, Some(expression)));
                arrow.body = self
                    .ast()
                    .arrow_function_body_block(self.ast().function_body(
                        span,
                        self.ast().vec(),
                        statements,
                    ));
                return Expression::ArrowFunctionExpression(arrow);
            }
            return Expression::ArrowFunctionExpression(arrow);
        }

        let mut value = value;
        self.visit_expression(&mut value);
        if let Some(capture) = self.take_this_capture_statement(span) {
            let mut statements = self.ast().vec();
            statements.push(capture);
            statements.push(self.ast().statement_return(span, Some(value)));
            let arrow = self.arrow_iife(span, statements);
            self.clear_this_capture_context();
            self.call_expression(span, arrow, std::vec::Vec::new())
        } else {
            value
        }
    }

    fn arrow_iife(&self, span: Span, statements: ArenaVec<'a, Statement<'a>>) -> Expression<'a> {
        arrow_iife(self.allocator, span, statements)
    }
}

impl<'a> ConditionBuilder<'a> for AstSsrTransform<'a, '_> {
    fn condition_allocator(&self) -> &'a Allocator {
        self.allocator
    }

    fn memo_wrapper_enabled(&self) -> bool {
        self.memo_wrapper.is_some()
    }

    fn register_memo(&mut self) -> String {
        self.uses_memo = true;
        self.memo_wrapper_local()
    }

    fn next_condition_id(&mut self) -> String {
        crate::shared::utils::next_unique_local("_c", &mut self.condition_index, &self.bindings)
    }

    fn classify(&self) -> Classify<'_> {
        AstSsrTransform::classify(self)
    }
}

impl<'a> crate::shared::mode_lower::ModeLower<'a> for AstSsrTransform<'a, '_> {
    fn wrap_conditionals_enabled(&self) -> bool {
        self.wrap_conditionals
    }

    /// Fragment children are top-level roots: native elements get hydration
    /// keys and their own attribute grouping.
    fn lower_child_element(&mut self, element: &JSXElement<'a>) -> Result<Expression<'a>> {
        self.lower_element_impl(element, true)
    }

    fn memo_wrap_dynamic_child(&mut self, span: Span, thunk: Expression<'a>) -> Expression<'a> {
        self.memo_wrap_fragment_child(span, thunk)
    }
}

/// Serializes a static SSR attribute value: empty values become bare
/// attributes; everything else is quoted with attribute-position escaping,
/// mirroring the Babel plugin's SSR serializer.
fn append_ssr_static_attribute(template: &mut String, name: &str, value: &str) {
    if value.is_empty() {
        template.push_str(&format!(" {name}"));
    } else {
        template.push_str(&format!(" {}=\"{}\"", name, escape_html_attribute(value)));
    }
}

/// Babel `t.isLiteral` over the shapes the SSR attribute inline branch can
/// see after escaping/serialization.
fn is_literal_expression(value: &Expression<'_>) -> bool {
    matches!(
        value,
        Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::TemplateLiteral(_)
    )
}

/// Port of Babel's `fragmentWillSelfEscape`: predicts whether a fragment
/// compiles to a single runtime value for which an outer `_$escape(...)`
/// wrap is a guaranteed no-op (memo accessor or `_$ssr` node).
fn fragment_will_self_escape(fragment: &JSXFragment<'_>) -> bool {
    let mut only: Option<&JSXChild<'_>> = None;
    for child in &fragment.children {
        match child {
            JSXChild::Text(text) => {
                if trim_jsx_text(&text.value).is_empty() {
                    continue;
                }
                return false;
            }
            JSXChild::ExpressionContainer(container)
                if matches!(container.expression, JSXExpression::EmptyExpression(_)) =>
            {
                continue;
            }
            JSXChild::Element(_) | JSXChild::ExpressionContainer(_) => {
                if only.is_some() {
                    return false;
                }
                only = Some(child);
            }
            _ => return false,
        }
    }
    match only {
        Some(JSXChild::ExpressionContainer(container)) => {
            matches!(
                &container.expression,
                JSXExpression::CallExpression(_)
                    | JSXExpression::TaggedTemplateExpression(_)
                    | JSXExpression::StaticMemberExpression(_)
                    | JSXExpression::ComputedMemberExpression(_)
                    | JSXExpression::PrivateFieldExpression(_)
                    | JSXExpression::ChainExpression(_)
            ) || matches!(
                &container.expression,
                JSXExpression::BinaryExpression(binary)
                    if binary.operator == oxc_ast::ast::BinaryOperator::In
            )
        }
        Some(JSXChild::Element(element)) => !is_component_name(&element.opening_element.name),
        _ => false,
    }
}

/// Records the spans of JSX elements in statement position — direct `return`
/// arguments and variable-declarator inits, unwrapping parentheses.
fn record_statement_jsx_spans(statement: &Statement<'_>, spans: &mut std::vec::Vec<Span>) -> usize {
    fn jsx_span(expression: &Expression<'_>) -> Option<Span> {
        match expression {
            Expression::ParenthesizedExpression(inner) => jsx_span(&inner.expression),
            Expression::JSXElement(element) => Some(element.span),
            _ => None,
        }
    }
    let mut count = 0;
    match statement {
        Statement::ReturnStatement(ret) => {
            if let Some(span) = ret.argument.as_ref().and_then(jsx_span) {
                spans.push(span);
                count += 1;
            }
        }
        Statement::VariableDeclaration(declaration) => {
            for declarator in &declaration.declarations {
                if let Some(span) = declarator.init.as_ref().and_then(jsx_span) {
                    spans.push(span);
                    count += 1;
                }
            }
        }
        Statement::ExportDeclaration(export) => {
            if let oxc_ast::ast::Declaration::VariableDeclaration(declaration) = &export.declaration
            {
                for declarator in &declaration.declarations {
                    if let Some(span) = declarator.init.as_ref().and_then(jsx_span) {
                        spans.push(span);
                        count += 1;
                    }
                }
            }
        }
        _ => {}
    }
    count
}
