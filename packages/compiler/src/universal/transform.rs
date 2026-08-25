use crate::error::{Error, Result};
use oxc_allocator::{Allocator, CloneIn, Vec as ArenaVec};
use oxc_ast::ast::{
    Argument, Expression, JSXAttributeItem, JSXAttributeValue, JSXChild, JSXElement, JSXExpression,
    JSXFragment, ObjectPropertyKind, Program, Statement,
};
use oxc_ast_visit::VisitMut;
use oxc_span::{GetSpan, Span};

use crate::dom::element::{AstDomTransform, DomTransformConfig, jsx_expression_to_expression};
use crate::shared::ast::{arrow_return_expression, expression_to_argument, object_method_property};
use crate::shared::ast_builder::AstBuilder;
use crate::shared::bindings::BindingTable;
use crate::shared::classify::Classify;
use crate::shared::component_props::ComponentPropContext;
use crate::shared::condition::{
    ConditionBuilder, is_condition_shape, memo_wrap_thunk, transform_condition,
    transform_condition_inline, zero_arg_call_thunk,
};
use crate::shared::refs::{assignment_fallback, callable_test};
use crate::shared::utils::{
    element_name, escape_html_text_expression, get_numbered_id, is_component_name,
    static_jsx_expression, trim_jsx_text,
};

pub(crate) struct AstUniversalTransform<'a, 'source> {
    pub(crate) allocator: &'a Allocator,
    source: &'source str,
    pub(super) module_name: &'source str,
    pub(crate) built_ins: std::vec::Vec<String>,
    pub(crate) built_in_imports: std::vec::Vec<String>,
    pub(super) element_index: usize,
    /// The reactive wrapper import name; `None` disables effect wrapping.
    effect_wrapper: Option<String>,
    wrap_conditionals: bool,
    /// The memo wrapper import name; `None` disables memo wrapping.
    memo_wrapper: Option<String>,
    uses_create_element: bool,
    uses_create_component: bool,
    uses_merge_props: bool,
    uses_spread: bool,
    uses_create_text_node: bool,
    uses_insert: bool,
    uses_insert_node: bool,
    uses_set_prop: bool,
    uses_memo: bool,
    uses_effect: bool,
    uses_ref: bool,
    uses_apply_ref: bool,
    ref_index: usize,
    condition_index: usize,
    pub(crate) bindings: BindingTable,
    pub(crate) pending_this_capture: Option<String>,
    pub(crate) current_this_capture: Option<String>,
    pub(crate) function_parent_stack: std::vec::Vec<crate::shared::transform::FunctionParentKind>,
    pub(crate) next_function_class_method: bool,
    pub(crate) lowered_function_bodies: std::collections::HashSet<usize>,
    this_index: usize,
    statement_depth: usize,
    pub(crate) dynamic_dom: Option<AstDomTransform<'a, 'source>>,
    dynamic_dom_elements: std::vec::Vec<String>,
    static_marker: String,
    /// Span of the JSX root currently being lowered via the visitor entry.
    /// Babel keeps a raw `this` in the tag callee of the root element of each
    /// `transformJSX` call; only descendants use the `_self$` capture.
    pub(crate) jsx_root_span: Option<Span>,
    pub(crate) error: Option<String>,
}

pub(crate) struct UniversalWrapperConfig {
    pub(crate) effect_wrapper: Option<String>,
    pub(crate) wrap_conditionals: bool,
    pub(crate) memo_wrapper: Option<String>,
}

pub(crate) struct DynamicDomConfig<'source> {
    pub(crate) module_name: &'source str,
    pub(crate) elements: std::vec::Vec<String>,
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
}

/// One dynamic attribute slot, batched into a single wrapper effect per
/// template root (Babel's `wrapDynamics`).
struct DynamicSlot<'a> {
    elem: String,
    key: String,
    value: Expression<'a>,
    span: Span,
}

/// The flattened lowering of a native universal element: Babel merges child
/// declarations/exprs/dynamics into the parent so a whole template becomes one
/// statement block wrapped by at most one effect.
struct NativeResult<'a> {
    id: String,
    declarations: std::vec::Vec<Statement<'a>>,
    exprs: std::vec::Vec<Statement<'a>>,
    dynamics: std::vec::Vec<DynamicSlot<'a>>,
}

enum ChildPlan<'a> {
    Text { value: String, id: Option<String> },
    Native(NativeResult<'a>),
    Value { span: Span, value: Expression<'a> },
}

impl<'a, 'source> AstUniversalTransform<'a, 'source> {
    pub(crate) fn new(
        allocator: &'a Allocator,
        source: &'source str,
        module_name: &'source str,
        built_ins: std::vec::Vec<String>,
        static_marker: String,
        wrappers: UniversalWrapperConfig,
    ) -> Self {
        Self {
            allocator,
            source,
            module_name,
            built_ins,
            built_in_imports: std::vec::Vec::new(),
            element_index: 0,
            effect_wrapper: wrappers.effect_wrapper,
            wrap_conditionals: wrappers.wrap_conditionals,
            memo_wrapper: wrappers.memo_wrapper,
            uses_create_element: false,
            uses_create_component: false,
            uses_merge_props: false,
            uses_spread: false,
            uses_create_text_node: false,
            uses_insert: false,
            uses_insert_node: false,
            uses_set_prop: false,
            uses_memo: false,
            uses_effect: false,
            uses_ref: false,
            uses_apply_ref: false,
            ref_index: 0,
            condition_index: 0,
            bindings: BindingTable::default(),
            pending_this_capture: None,
            current_this_capture: None,
            function_parent_stack: std::vec::Vec::new(),
            next_function_class_method: false,
            lowered_function_bodies: std::collections::HashSet::new(),
            this_index: 0,
            statement_depth: 0,
            dynamic_dom: None,
            dynamic_dom_elements: std::vec::Vec::new(),
            static_marker,
            jsx_root_span: None,
            error: None,
        }
    }

    pub(crate) fn new_dynamic(
        allocator: &'a Allocator,
        source: &'source str,
        module_name: &'source str,
        built_ins: std::vec::Vec<String>,
        dom: DynamicDomConfig<'source>,
    ) -> Self {
        let wrappers = UniversalWrapperConfig {
            effect_wrapper: dom.effect_wrapper.clone(),
            wrap_conditionals: dom.wrap_conditionals,
            memo_wrapper: dom.memo_wrapper.clone(),
        };
        let mut transform = Self::new(
            allocator,
            source,
            module_name,
            built_ins.clone(),
            dom.static_marker.clone(),
            wrappers,
        );
        transform.dynamic_dom = Some(AstDomTransform::new(
            allocator,
            source,
            dom.module_name,
            DomTransformConfig {
                hydratable: dom.hydratable,
                dev: dom.dev,
                context_to_custom_elements: dom.context_to_custom_elements,
                delegate_events: dom.delegate_events,
                delegated_events: dom.delegated_events,
                omit_quotes: dom.omit_quotes,
                omit_attribute_spacing: dom.omit_attribute_spacing,
                inline_styles: dom.inline_styles,
                effect_wrapper: dom.effect_wrapper,
                wrap_conditionals: dom.wrap_conditionals,
                memo_wrapper: dom.memo_wrapper,
                patch_driver: dom.patch_driver,
                static_marker: dom.static_marker,
                omit_nested_closing_tags: dom.omit_nested_closing_tags,
                omit_last_closing_tag: dom.omit_last_closing_tag,
                validate: dom.validate,
                built_ins,
                // Babel resolves `memo`/`effect` against the top-level module
                // even inside the dom renderer's subtree.
                wrapper_module_name: Some(module_name.to_string()),
                renderer_elements: Some(dom.elements.clone()),
            },
        ));
        transform.dynamic_dom_elements = dom.elements;
        transform
    }

    pub(crate) fn prepend_helpers(&mut self, program: &mut Program<'a>) {
        let mut statements = std::vec::Vec::new();
        if self.uses_create_text_node {
            statements
                .push(self.import_named("createTextNode", &self.helper_local("_$createTextNode")));
        }
        if let Some(dom) = &mut self.dynamic_dom {
            // Wrapper helpers (`createComponent`, `mergeProps`, `applyRef`)
            // resolve against the top-level module in Babel regardless of
            // which transform requested them, sharing a single import — route
            // them through the dom transform's emission.
            dom.template_state.uses_create_component |= self.uses_create_component;
            dom.template_state.uses_merge_props |= self.uses_merge_props;
            dom.template_state.uses_apply_ref |= self.uses_apply_ref;
            self.uses_create_component = false;
            self.uses_merge_props = false;
            self.uses_apply_ref = false;
            // Built-ins also resolve against the top-level module (Babel's
            // `registerImportMethod` without a renderer config), so a single
            // deduplicated import serves both transforms.
            for built_in in self.built_in_imports.drain(..) {
                if !dom
                    .template_state
                    .built_in_imports
                    .iter()
                    .any(|existing| existing == &built_in)
                {
                    dom.template_state.built_in_imports.push(built_in);
                }
            }
            if let Err(error) = dom.prepend_helpers(program) {
                self.error = Some(error.to_string());
                return;
            }
        }
        if self.uses_memo {
            let name = self.memo_wrapper.as_deref().unwrap_or("memo").to_string();
            statements.push(self.import_named(&name, &format!("_${name}")));
        }
        if self.uses_effect {
            let name = self
                .effect_wrapper
                .as_deref()
                .unwrap_or("effect")
                .to_string();
            statements.push(self.import_named(&name, &format!("_${name}")));
        }
        if self.uses_create_component {
            statements.push(
                self.import_named("createComponent", &self.helper_local("_$createComponent")),
            );
        }
        if self.uses_merge_props {
            statements.push(self.import_named("mergeProps", &self.helper_local("_$mergeProps")));
        }
        if self.uses_spread {
            statements.push(self.import_named("spread", &self.helper_local("_$spread")));
        }
        if self.uses_insert {
            statements.push(self.import_named("insert", &self.helper_local("_$insert")));
        }
        if self.uses_insert_node {
            statements.push(self.import_named("insertNode", &self.helper_local("_$insertNode")));
        }
        if self.uses_set_prop {
            statements.push(self.import_named("setProp", &self.helper_local("_$setProp")));
        }
        if self.uses_ref {
            statements.push(self.import_named("ref", &self.helper_local("_$ref")));
        }
        if self.uses_apply_ref {
            statements.push(self.import_named("applyRef", &self.helper_local("_$applyRef")));
        }
        if self.uses_create_element {
            statements
                .push(self.import_named("createElement", &self.helper_local("_$createElement")));
        }
        for built_in in &self.built_in_imports {
            statements.push(self.import_named(built_in, &format!("_${built_in}")));
        }
        statements.extend(program.body.drain(..));
        let mut body = ArenaVec::new_in(&self.allocator);
        body.extend(statements);
        program.body = body;
    }

    fn helper_local(&self, local: &str) -> String {
        // Wrapper helpers resolve against the top-level module in both
        // transforms (single shared import), so they keep their plain local
        // even in dynamic mode; renderer-specific helpers get a `2` suffix to
        // avoid colliding with the dom renderer's locals.
        let shared_wrappers = [
            self.memo_wrapper_local(),
            self.effect_wrapper_local(),
            "_$createComponent".to_string(),
            "_$mergeProps".to_string(),
            "_$applyRef".to_string(),
        ];
        if self.dynamic_dom.is_some() && !shared_wrappers.iter().any(|wrapper| wrapper == local) {
            format!("{local}2")
        } else {
            local.to_string()
        }
    }

    /// Local for the configured effect wrapper (Babel's `_$${name}` hint).
    fn effect_wrapper_local(&self) -> String {
        format!("_${}", self.effect_wrapper.as_deref().unwrap_or("effect"))
    }

    /// Local for the configured memo wrapper.
    fn memo_wrapper_local(&self) -> String {
        format!("_${}", self.memo_wrapper.as_deref().unwrap_or("memo"))
    }

    fn register_effect(&mut self) -> String {
        if let Some(dom) = &mut self.dynamic_dom {
            dom.template_state.uses_effect = true;
        } else {
            self.uses_effect = true;
        }
        self.effect_wrapper_local()
    }

    /// The shared classification authority over this transform's bindings,
    /// source, and configured static marker.
    pub(crate) fn classify(&self) -> Classify<'_> {
        Classify::new(&self.bindings, self.source, &self.static_marker)
    }

    /// Shared attribute evaluation context (used here for Babel's
    /// `evaluateAndInline` fold over static attribute values).
    fn attr_planner(&self) -> crate::shared::attr_plan::AttrPlanner<'a, '_> {
        crate::shared::attr_plan::AttrPlanner {
            allocator: self.allocator,
            source: self.source,
            static_marker: &self.static_marker,
            bindings: &self.bindings,
            inline_styles: false,
            skip_xmlns_attribute: false,
            is_ssr: false,
        }
    }

    /// Lowers raw JSX the dom transform left behind (other renderers'
    /// elements, deferred dynamic attribute values) through this transform's
    /// dispatcher, without re-running the full statement machinery on
    /// already-lowered output.
    pub(crate) fn lower_foreign_jsx_statements(&mut self, statements: &mut [Statement<'a>]) {
        crate::shared::transform::lower_deferred_jsx_statements(self, statements);
    }

    pub(crate) fn lower_element(
        &mut self,
        element: &JSXElement<'a>,
    ) -> Result<(Expression<'a>, std::vec::Vec<Statement<'a>>)> {
        if is_component_name(&element.opening_element.name) {
            return self.lower_component(element);
        }
        let tag_name = element_name(&element.opening_element.name)?;
        if self
            .dynamic_dom_elements
            .iter()
            .any(|name| name == &tag_name)
        {
            let Some(dom) = &mut self.dynamic_dom else {
                unreachable!("dynamic DOM elements require a DOM transform");
            };
            // Leftover raw JSX in the dom output (foreign renderer elements,
            // deferred dynamic attribute values) lowers in the statement-level
            // deferred pass, matching Babel's outer-traversal ordering.
            // Root tracking mirrors lower_jsx_element so row proofs (§3c)
            // record for dom template roots in dynamic mode too.
            let is_dom_root = dom.jsx_root_span.is_none();
            if is_dom_root {
                dom.jsx_root_span = Some(element.span);
            }
            let result = dom.lower_element_with_setup(element);
            if is_dom_root {
                dom.jsx_root_span = None;
            }
            return result;
        }
        let result = self.lower_native_element(element)?;
        // Babel's `createTemplate`: a bare element (single declaration, no
        // exprs/dynamics) inlines as its `createElement(...)` expression.
        if result.exprs.is_empty() && result.dynamics.is_empty() && result.declarations.len() == 1 {
            let mut declarations = result.declarations;
            if let Some(Statement::VariableDeclaration(mut declaration)) = declarations.pop()
                && let Some(init) = declaration.declarations[0].init.take()
            {
                return Ok((init, std::vec::Vec::new()));
            }
            unreachable!("single native declaration is always `var _el$ = createElement(...)`");
        }
        let mut setup = result.declarations;
        setup.extend(result.exprs);
        if let Some(statement) = self.wrap_dynamics(result.dynamics) {
            setup.push(statement);
        }
        Ok((self.identifier_expression(element.span, &result.id), setup))
    }

    fn lower_native_element(&mut self, element: &JSXElement<'a>) -> Result<NativeResult<'a>> {
        let span = element.span;
        let tag_name = element_name(&element.opening_element.name)?;
        let element_id = self.next_element_id();
        self.uses_create_element = true;
        let has_spread = element
            .opening_element
            .attributes
            .iter()
            .any(|attr| matches!(attr, JSXAttributeItem::SpreadAttribute(_)));
        let has_children = !element.children.is_empty();

        let mut init_props = std::vec::Vec::new();
        let mut ref_exprs = std::vec::Vec::new();
        let mut attr_exprs = std::vec::Vec::new();
        let mut dynamics = std::vec::Vec::new();
        let mut children_attr: Option<oxc_ast::ast::JSXExpressionContainer<'a>> = None;

        if has_spread {
            self.process_universal_spreads(
                element,
                &element_id,
                has_children,
                &mut ref_exprs,
                &mut attr_exprs,
                &mut dynamics,
                &mut children_attr,
            )?;
        } else {
            for attr in &element.opening_element.attributes {
                let JSXAttributeItem::Attribute(attr) = attr else {
                    unreachable!("spread handled above");
                };
                self.lower_universal_attribute(
                    attr,
                    &element_id,
                    false,
                    has_children,
                    &mut init_props,
                    &mut ref_exprs,
                    &mut attr_exprs,
                    &mut dynamics,
                    &mut children_attr,
                )?;
            }
        }

        let mut declarations = std::vec::Vec::new();
        let mut create_element_args = vec![self.string_arg(span, &tag_name)];
        if !init_props.is_empty() {
            create_element_args.push(expression_to_argument(
                self.ast()
                    .expression_object(span, self.ast().vec_from_iter(init_props)),
            ));
        }
        declarations.push(self.variable_statement(
            span,
            &element_id,
            self.call_identifier(
                span,
                &self.helper_local("_$createElement"),
                create_element_args,
            ),
        ));

        let mut appends = std::vec::Vec::new();
        let mut child_exprs = std::vec::Vec::new();
        self.lower_universal_children(
            element,
            if has_children {
                None
            } else {
                children_attr.as_ref()
            },
            &element_id,
            &mut declarations,
            &mut appends,
            &mut child_exprs,
            &mut dynamics,
        )?;

        // Babel's exprs order: insertNode appends first (unshifted last), then
        // ref protocol statements, then setProp/spread exprs, then the
        // per-child insert()/nested exprs in child order.
        let mut exprs = appends;
        exprs.extend(ref_exprs);
        exprs.extend(attr_exprs);
        exprs.extend(child_exprs);
        Ok(NativeResult {
            id: element_id,
            declarations,
            exprs,
            dynamics,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn lower_universal_attribute(
        &mut self,
        attr: &oxc_ast::ast::JSXAttribute<'a>,
        element_id: &str,
        has_spread: bool,
        has_children: bool,
        init_props: &mut std::vec::Vec<ObjectPropertyKind<'a>>,
        ref_exprs: &mut std::vec::Vec<Statement<'a>>,
        attr_exprs: &mut std::vec::Vec<Statement<'a>>,
        dynamics: &mut std::vec::Vec<DynamicSlot<'a>>,
        children_attr: &mut Option<oxc_ast::ast::JSXExpressionContainer<'a>>,
    ) -> Result<()> {
        let key = match &attr.name {
            oxc_ast::ast::JSXAttributeName::Identifier(name) => name.name.to_string(),
            oxc_ast::ast::JSXAttributeName::NamespacedName(name) => {
                format!("{}:{}", name.namespace.name, name.name.name)
            }
        };
        match &attr.value {
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                if key == "ref" {
                    let value = jsx_expression_to_expression(&container.expression, self.allocator);
                    let statements = self.universal_ref_statements(attr.span, element_id, value);
                    // Babel `unshift`s each ref's statement group, so
                    // multiple refs emit in reverse source order.
                    ref_exprs.splice(0..0, statements);
                    return Ok(());
                }
                if key == "children" {
                    let cloned: &oxc_ast::ast::JSXExpressionContainer<'a> = container;
                    *children_attr = Some(cloned.clone_in(self.allocator));
                    return Ok(());
                }
                let mut value = jsx_expression_to_expression(&container.expression, self.allocator);
                // Babel's `evaluateAndInline` folds confident values to
                // literals before the dynamic check.
                self.attr_planner().fold_confident(&mut value);
                let dynamic = self.effect_wrapper.is_some()
                    && self
                        .classify()
                        .is_dynamic(Some(container.span.start), &value, false);
                if dynamic {
                    // Babel stores the raw expression in the dynamics list —
                    // JSX inside it lowers in the deferred pass after the
                    // root completes, which also keeps `wrapForEffect` from
                    // unwrapping the lowered IIFE.
                    dynamics.push(DynamicSlot {
                        elem: element_id.to_string(),
                        key,
                        value,
                        span: attr.span,
                    });
                } else {
                    self.visit_expression(&mut value);
                    self.add_static_attr(
                        attr.span, element_id, &key, value, has_spread, init_props, attr_exprs,
                    );
                }
            }
            Some(JSXAttributeValue::StringLiteral(value)) => {
                if key == "children" {
                    if !has_children {
                        *children_attr = Some(self.ast().jsx_expression_container(
                            value.span,
                            JSXExpression::from(self.ast().expression_string_literal(
                                value.span,
                                self.ast().str(&value.value),
                                None,
                            )),
                        ));
                    }
                    return Ok(());
                }
                // Babel passes the raw attribute source string through.
                let value = self.ast().expression_string_literal(
                    value.span,
                    self.ast().str(&value.value),
                    None,
                );
                self.add_static_attr(
                    attr.span, element_id, &key, value, has_spread, init_props, attr_exprs,
                );
            }
            None => {
                let value = self.ast().expression_boolean_literal(attr.span, true);
                self.add_static_attr(
                    attr.span, element_id, &key, value, has_spread, init_props, attr_exprs,
                );
            }
            Some(JSXAttributeValue::Element(_) | JSXAttributeValue::Fragment(_)) => {
                return Err(Error::from_reason(
                    "Universal JSX attribute values are not implemented in the AST-native milestone yet",
                ));
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn add_static_attr(
        &mut self,
        span: Span,
        element_id: &str,
        key: &str,
        value: Expression<'a>,
        has_spread: bool,
        init_props: &mut std::vec::Vec<ObjectPropertyKind<'a>>,
        attr_exprs: &mut std::vec::Vec<Statement<'a>>,
    ) {
        if has_spread {
            attr_exprs.push(self.set_prop_statement(span, element_id, key, value, None));
        } else {
            init_props.push(self.object_property(span, key, value));
        }
    }

    fn set_prop_statement(
        &mut self,
        span: Span,
        element_id: &str,
        key: &str,
        value: Expression<'a>,
        prev: Option<Expression<'a>>,
    ) -> Statement<'a> {
        let expression = self.set_prop_expression(span, element_id, key, value, prev);
        self.expression_statement(span, expression)
    }

    fn set_prop_expression(
        &mut self,
        span: Span,
        element_id: &str,
        key: &str,
        value: Expression<'a>,
        prev: Option<Expression<'a>>,
    ) -> Expression<'a> {
        self.uses_set_prop = true;
        let mut args = vec![
            self.identifier_arg(span, element_id),
            self.string_arg(span, key),
            expression_to_argument(value),
        ];
        if let Some(prev) = prev {
            args.push(expression_to_argument(prev));
        }
        self.call_identifier(span, &self.helper_local("_$setProp"), args)
    }

    /// Port of the universal generate's `processSpreads`.
    #[allow(clippy::too_many_arguments)]
    fn process_universal_spreads(
        &mut self,
        element: &JSXElement<'a>,
        element_id: &str,
        has_children: bool,
        ref_exprs: &mut std::vec::Vec<Statement<'a>>,
        attr_exprs: &mut std::vec::Vec<Statement<'a>>,
        dynamics: &mut std::vec::Vec<DynamicSlot<'a>>,
        children_attr: &mut Option<oxc_ast::ast::JSXExpressionContainer<'a>>,
    ) -> Result<()> {
        let span = element.span;
        let mut spread_args: std::vec::Vec<Expression<'a>> = std::vec::Vec::new();
        let mut running: std::vec::Vec<ObjectPropertyKind<'a>> = std::vec::Vec::new();
        let mut dynamic_spread = false;
        let mut first_spread = false;
        let mut init_props = std::vec::Vec::new();

        for attr in &element.opening_element.attributes {
            match attr {
                JSXAttributeItem::SpreadAttribute(spread) => {
                    first_spread = true;
                    if !running.is_empty() {
                        let props = std::mem::take(&mut running);
                        spread_args.push(
                            self.ast()
                                .expression_object(spread.span, self.ast().vec_from_iter(props)),
                        );
                    }
                    // JSX inside spread arguments and property values stays
                    // raw for the deferred pass (Babel's outer traversal).
                    let argument = spread.argument.clone_in(self.allocator);
                    let arg = if self.classify().is_dynamic(None, &argument, false) {
                        dynamic_spread = true;
                        match zero_arg_call_thunk(&argument, self.allocator) {
                            Some(callee) => callee,
                            None => arrow_return_expression(self.allocator, spread.span, argument),
                        }
                    } else {
                        argument
                    };
                    spread_args.push(arg);
                }
                JSXAttributeItem::Attribute(attr) => {
                    let key = match &attr.name {
                        oxc_ast::ast::JSXAttributeName::Identifier(name) => name.name.to_string(),
                        oxc_ast::ast::JSXAttributeName::NamespacedName(name) => {
                            format!("{}:{}", name.namespace.name, name.name.name)
                        }
                    };
                    let container = match &attr.value {
                        Some(JSXAttributeValue::ExpressionContainer(container)) => Some(container),
                        _ => None,
                    };
                    let dynamic = container.is_some_and(|container| {
                        container
                            .expression
                            .as_expression()
                            .is_some_and(|expression| {
                                self.classify().is_dynamic(
                                    Some(container.span.start),
                                    expression,
                                    false,
                                )
                            })
                    });
                    let can_native_spread = key != "ref"
                        && !(key.contains(':')
                            && key.split(':').next().is_some_and(|ns| ns == "prop"));
                    if (first_spread || dynamic) && can_native_spread {
                        if dynamic {
                            let container = container.expect("dynamic attr has container");
                            let mut value =
                                jsx_expression_to_expression(&container.expression, self.allocator);
                            // Unlike the dom generate (#2959), keep the condition
                            // memo: universal has no hydration ids to drift, and
                            // custom-renderer prop values can be expensive.
                            if self.wrap_conditionals && is_condition_shape(&value) {
                                value = transform_condition_inline(self, container.span, value);
                            }
                            running.push(self.object_getter_property(attr.span, &key, value));
                        } else {
                            let value = match &attr.value {
                                None => self.ast().expression_boolean_literal(attr.span, true),
                                Some(JSXAttributeValue::StringLiteral(value)) => {
                                    self.ast().expression_string_literal(
                                        value.span,
                                        self.ast().str(&value.value),
                                        None,
                                    )
                                }
                                Some(JSXAttributeValue::ExpressionContainer(container)) => {
                                    let mut value = jsx_expression_to_expression(
                                        &container.expression,
                                        self.allocator,
                                    );
                                    self.attr_planner().fold_confident(&mut value);
                                    value
                                }
                                Some(
                                    JSXAttributeValue::Element(_) | JSXAttributeValue::Fragment(_),
                                ) => {
                                    return Err(Error::from_reason(
                                        "Universal JSX attribute values are not implemented in the AST-native milestone yet",
                                    ));
                                }
                            };
                            running.push(self.object_property(attr.span, &key, value));
                        }
                    } else {
                        self.lower_universal_attribute(
                            attr,
                            element_id,
                            true,
                            has_children,
                            &mut init_props,
                            ref_exprs,
                            attr_exprs,
                            dynamics,
                            children_attr,
                        )?;
                    }
                }
            }
        }

        debug_assert!(init_props.is_empty(), "spread path never uses init props");

        if !running.is_empty() {
            let props = std::mem::take(&mut running);
            spread_args.push(
                self.ast()
                    .expression_object(span, self.ast().vec_from_iter(props)),
            );
        }

        let props = if spread_args.len() == 1 && !dynamic_spread {
            spread_args.pop().expect("single spread argument exists")
        } else {
            self.uses_merge_props = true;
            let args = spread_args
                .into_iter()
                .map(expression_to_argument)
                .collect();
            self.call_identifier(span, &self.helper_local("_$mergeProps"), args)
        };

        self.uses_spread = true;
        attr_exprs.push(self.expression_statement(
            span,
            self.call_identifier(
                span,
                &self.helper_local("_$spread"),
                vec![
                    self.identifier_arg(span, element_id),
                    expression_to_argument(props),
                    Argument::BooleanLiteral(self.ast().alloc_boolean_literal(span, has_children)),
                ],
            ),
        ));
        Ok(())
    }

    /// The universal ref protocol (Babel `universal/element.ts`).
    fn universal_ref_statements(
        &mut self,
        span: Span,
        element_id: &str,
        mut value: Expression<'a>,
    ) -> std::vec::Vec<Statement<'a>> {
        self.visit_expression(&mut value);
        let elem = self.identifier_expression(span, element_id);
        let is_constant = matches!(&value, Expression::Identifier(identifier)
            if self.bindings.is_const(identifier.name.as_str()));
        let is_lval = matches!(
            value,
            Expression::Identifier(_)
                | Expression::StaticMemberExpression(_)
                | Expression::ComputedMemberExpression(_)
        );

        let ref_call = |ctx: &mut Self, target: Expression<'a>| {
            ctx.uses_ref = true;
            let getter = arrow_return_expression(ctx.allocator, span, target);
            ctx.call_identifier(
                span,
                &ctx.helper_local("_$ref"),
                vec![
                    expression_to_argument(getter),
                    expression_to_argument(elem.clone_in(ctx.allocator)),
                ],
            )
        };

        if !is_constant && is_lval {
            let ref_id = self.next_ref_id();
            let declaration =
                self.variable_statement(span, &ref_id, value.clone_in(self.allocator));
            let test = callable_test(
                self.allocator,
                span,
                self.identifier_expression(span, &ref_id),
            );
            let target = self.identifier_expression(span, &ref_id);
            let call = ref_call(self, target);
            let fallback =
                assignment_fallback(self.allocator, span, &value, elem.clone_in(self.allocator))
                    .expect("lval refs are assignable");
            let statement = self.expression_statement(
                span,
                self.ast()
                    .expression_conditional(span, test, call, fallback),
            );
            return vec![declaration, statement];
        }

        if is_constant
            || matches!(
                value,
                Expression::ArrowFunctionExpression(_)
                    | Expression::FunctionExpression(_)
                    | Expression::ArrayExpression(_)
            )
        {
            let call = ref_call(self, value);
            return vec![self.expression_statement(span, call)];
        }

        let ref_id = self.next_ref_id();
        let declaration = self.variable_statement(span, &ref_id, value);
        let test = callable_test(
            self.allocator,
            span,
            self.identifier_expression(span, &ref_id),
        );
        let target = self.identifier_expression(span, &ref_id);
        let call = ref_call(self, target);
        let statement = self.expression_statement(
            span,
            self.ast()
                .expression_logical(span, test, oxc_ast::ast::LogicalOperator::And, call),
        );
        vec![declaration, statement]
    }

    #[allow(clippy::too_many_arguments)]
    fn lower_universal_children(
        &mut self,
        element: &JSXElement<'a>,
        children_attr: Option<&oxc_ast::ast::JSXExpressionContainer<'a>>,
        element_id: &str,
        declarations: &mut std::vec::Vec<Statement<'a>>,
        appends: &mut std::vec::Vec<Statement<'a>>,
        child_exprs: &mut std::vec::Vec<Statement<'a>>,
        dynamics: &mut std::vec::Vec<DynamicSlot<'a>>,
    ) -> Result<()> {
        // Babel's `checkLength`: significance counted before adjacent-text
        // merging.
        let mut significant = 0usize;
        let mut plans: std::vec::Vec<ChildPlan<'a>> = std::vec::Vec::new();

        for child in &element.children {
            match child {
                JSXChild::Text(text) => {
                    // Babel keeps raw entity text for `createTextNode` (it
                    // emits the trimmed source into a template literal).
                    let value = trim_jsx_text(&text.value);
                    if !value.is_empty() {
                        significant += 1;
                        push_text_plan(&mut plans, value);
                    }
                }
                JSXChild::ExpressionContainer(container) => {
                    if !matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                        significant += 1;
                        self.plan_expression_child(container, &mut plans)?;
                    }
                }
                JSXChild::Element(child_element) => {
                    significant += 1;
                    if !is_component_name(&child_element.opening_element.name) {
                        let tag_name = element_name(&child_element.opening_element.name)?;
                        if !self
                            .dynamic_dom_elements
                            .iter()
                            .any(|name| name == &tag_name)
                        {
                            let result = self.lower_native_element(child_element)?;
                            plans.push(ChildPlan::Native(result));
                            continue;
                        }
                        // Dynamic mode: a dom-renderer element can't nest
                        // directly under this renderer's native element
                        // (Babel throws in the universal `transformChildren`;
                        // renderer boundaries need a component).
                        let parent_tag = element_name(&element.opening_element.name)?;
                        return Err(Error::from_reason(format!(
                            "<{tag_name}> is not supported in <{parent_tag}>.\n        Wrap the usage with a component that would render this element, eg. Canvas"
                        )));
                    }
                    let (value, setup) = self.lower_element(child_element)?;
                    let value = self.setup_iife(child_element.span, setup, value);
                    plans.push(ChildPlan::Value {
                        span: child_element.span,
                        value,
                    });
                }
                JSXChild::Fragment(fragment) => {
                    significant += 1;
                    let value = self.lower_fragment(fragment)?;
                    plans.push(ChildPlan::Value {
                        span: fragment.span,
                        value,
                    });
                }
                JSXChild::Spread(spread) => {
                    significant += 1;
                    // Babel classifies the original expression — nested JSX
                    // lowers after the dynamic decision, so `{...[<span/>]}`
                    // stays static even though the lowered form is a call.
                    let dynamic = self.classify().is_dynamic(None, &spread.expression, false);
                    let mut value = spread.expression.clone_in(self.allocator);
                    self.visit_expression(&mut value);
                    let value = if dynamic {
                        arrow_return_expression(self.allocator, spread.span, value)
                    } else {
                        value
                    };
                    plans.push(ChildPlan::Value {
                        span: spread.span,
                        value,
                    });
                }
            }
        }

        if plans.is_empty()
            && let Some(container) = children_attr
        {
            significant += 1;
            self.plan_expression_child(container, &mut plans)?;
        }

        let multi = significant > 1;

        // Text nodes get hoisted ids in multi-child mode so they can serve as
        // insertion anchors.
        for plan in &mut plans {
            if let ChildPlan::Text { id, .. } = plan
                && multi
            {
                *id = Some(self.next_element_id());
            }
        }

        let anchor = |plans: &[ChildPlan<'a>], index: usize| -> Option<String> {
            plans[index + 1..].iter().find_map(|plan| match plan {
                ChildPlan::Text { id, .. } => id.clone(),
                ChildPlan::Native(result) => Some(result.id.clone()),
                ChildPlan::Value { .. } => None,
            })
        };

        for index in 0..plans.len() {
            let anchor_id = anchor(&plans, index);
            let plan = std::mem::replace(
                &mut plans[index],
                ChildPlan::Text {
                    value: String::new(),
                    id: None,
                },
            );
            match plan {
                ChildPlan::Text { value, id } => {
                    let span = element.span;
                    let text_node = self.create_text_node(span, &value);
                    if let Some(id) = id {
                        declarations.push(self.variable_statement(span, &id, text_node));
                        let node = self.identifier_expression(span, &id);
                        appends.push(self.insert_node_statement(span, element_id, node));
                    } else {
                        appends.push(self.insert_node_statement(span, element_id, text_node));
                    }
                }
                ChildPlan::Native(result) => {
                    declarations.extend(result.declarations);
                    let node = self.identifier_expression(element.span, &result.id);
                    appends.push(self.insert_node_statement(element.span, element_id, node));
                    child_exprs.extend(result.exprs);
                    dynamics.extend(result.dynamics);
                }
                ChildPlan::Value { span, value } => {
                    self.uses_insert = true;
                    let mut args = vec![
                        self.identifier_arg(span, element_id),
                        expression_to_argument(value),
                    ];
                    if multi {
                        args.push(expression_to_argument(match anchor_id {
                            Some(id) => self.identifier_expression(span, &id),
                            None => self.ast().expression_null_literal(span),
                        }));
                    }
                    child_exprs.push(self.expression_statement(
                        span,
                        self.call_identifier(span, &self.helper_local("_$insert"), args),
                    ));
                }
            }
        }
        Ok(())
    }

    /// One expression-container child: static values fold into text, dynamic
    /// values become wrapped `insert()` slots.
    fn plan_expression_child(
        &mut self,
        container: &oxc_ast::ast::JSXExpressionContainer<'a>,
        plans: &mut std::vec::Vec<ChildPlan<'a>>,
    ) -> Result<()> {
        if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
            return Ok(());
        }
        if let Some(value) = static_jsx_expression(&container.expression, Some(&self.bindings)) {
            // Folded expression values are escaped like Babel's template text
            // (raw JSXText keeps its entities as written and is not escaped).
            push_text_plan(
                plans,
                escape_html_text_expression(&value.into_template_value()),
            );
            return Ok(());
        }
        let dynamic = container
            .expression
            .as_expression()
            .is_some_and(|expression| {
                self.classify()
                    .is_dynamic(Some(container.span.start), expression, false)
            });
        let mut value = jsx_expression_to_expression(&container.expression, self.allocator);
        self.visit_expression(&mut value);
        let value = if dynamic {
            self.universal_child_expression(container.span, value)
        } else {
            value
        };
        plans.push(ChildPlan::Value {
            span: container.span,
            value,
        });
        Ok(())
    }

    /// Mirror of Babel's `transformNode` wrapping for a dynamic universal
    /// child expression (`insert()` value).
    fn universal_child_expression(&mut self, span: Span, value: Expression<'a>) -> Expression<'a> {
        if self.wrap_conditionals && is_condition_shape(&value) {
            return transform_condition(self, span, value, false)
                .into_expression(self.allocator, span);
        }
        if let Some(callee) = zero_arg_call_thunk(&value, self.allocator) {
            return callee;
        }
        arrow_return_expression(self.allocator, span, value)
    }

    /// `createTemplate(wrap: true)` for a dynamic universal expression.
    /// Babel's `wrapDynamics`: one effect per template root; multiple slots
    /// batch into a keyed object with per-key change detection.
    fn wrap_dynamics(
        &mut self,
        mut dynamics: std::vec::Vec<DynamicSlot<'a>>,
    ) -> Option<Statement<'a>> {
        if dynamics.is_empty() {
            return None;
        }
        let effect_local = self.register_effect();

        if dynamics.len() == 1 {
            let slot = dynamics.pop().expect("single dynamic slot exists");
            let span = slot.span;
            // `wrapForEffect`: only IIFE callees unwrap — a bare identifier
            // callee would receive the effect's previous value.
            let getter = match &slot.value {
                Expression::CallExpression(call)
                    if call.arguments.is_empty()
                        && matches!(
                            call.callee,
                            Expression::ArrowFunctionExpression(_)
                                | Expression::FunctionExpression(_)
                        ) =>
                {
                    call.callee.clone_in(self.allocator)
                }
                _ => crate::shared::ast::concise_arrow_thunk(self.allocator, span, slot.value),
            };
            let set_prop = self.set_prop_statement(
                span,
                &slot.elem,
                &slot.key,
                self.identifier_expression(span, "_v$"),
                Some(self.identifier_expression(span, "_$p")),
            );
            let setter =
                self.arrow_with_param_names(span, vec!["_v$", "_$p"], self.ast().vec1(set_prop));
            return Some(self.expression_statement(
                span,
                self.call_identifier(
                    span,
                    &effect_local,
                    vec![
                        expression_to_argument(getter),
                        expression_to_argument(setter),
                    ],
                ),
            ));
        }

        let span = dynamics
            .first()
            .map_or_else(|| Span::new(0, 0), |slot| slot.span);
        let mut value_props = self.ast().vec();
        let mut statements = self.ast().vec();
        let mut param_names = std::vec::Vec::new();

        for (index, slot) in dynamics.into_iter().enumerate() {
            let prop_name = get_numbered_id(index);
            let slot_span = slot.span;
            value_props.push(self.object_property(slot_span, &prop_name, slot.value));

            let prev_member = self.optional_member(slot_span, "_p$", &prop_name);
            let changed = self.ast().expression_binary(
                slot_span,
                self.identifier_expression(slot_span, &prop_name),
                oxc_ast::ast::BinaryOperator::StrictInequality,
                prev_member.clone_in(self.allocator),
            );
            let set_prop = self.set_prop_expression(
                slot_span,
                &slot.elem,
                &slot.key,
                self.identifier_expression(slot_span, &prop_name),
                Some(prev_member),
            );
            statements.push(self.expression_statement(
                slot_span,
                self.ast().expression_logical(
                    slot_span,
                    changed,
                    oxc_ast::ast::LogicalOperator::And,
                    set_prop,
                ),
            ));
            param_names.push(prop_name);
        }

        let values_object = self.ast().expression_object(span, value_props);
        let getter = arrow_return_expression(self.allocator, span, values_object);
        let setter = self.arrow_with_destructured_params(span, &param_names, "_p$", statements);
        Some(self.expression_statement(
            span,
            self.call_identifier(
                span,
                &effect_local,
                vec![
                    expression_to_argument(getter),
                    expression_to_argument(setter),
                ],
            ),
        ))
    }

    /// `_p$?.<name>`
    fn optional_member(&self, span: Span, object: &str, name: &str) -> Expression<'a> {
        let member = self.ast().alloc_static_member_expression(
            span,
            self.identifier_expression(span, object),
            self.ast().identifier_name(span, self.ast().ident(name)),
            true,
        );
        self.ast().expression_chain(
            span,
            oxc_ast::ast::ChainElement::StaticMemberExpression(member),
        )
    }

    fn arrow_with_param_names(
        &self,
        span: Span,
        names: std::vec::Vec<&str>,
        statements: ArenaVec<'a, Statement<'a>>,
    ) -> Expression<'a> {
        let params = self.ast().vec_from_iter(names.into_iter().map(|name| {
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
            oxc_ast::ast::FormalParameterKind::ArrowFormalParameters,
            params,
            None,
        );
        let body = self.ast().function_body(span, self.ast().vec(), statements);
        self.ast()
            .expression_arrow_function(span, false, false, None, params, None, body)
    }

    /// `({ a, b }, _p$) => { ... }`
    fn arrow_with_destructured_params(
        &self,
        span: Span,
        names: &[String],
        prev_name: &str,
        statements: ArenaVec<'a, Statement<'a>>,
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
        let mut params_vec = self.ast().vec();
        params_vec.push(first);
        params_vec.push(second);
        let params = self.ast().formal_parameters(
            span,
            oxc_ast::ast::FormalParameterKind::ArrowFormalParameters,
            params_vec,
            None,
        );
        let body = self.ast().function_body(span, self.ast().vec(), statements);
        self.ast()
            .expression_arrow_function(span, false, false, None, params, None, body)
    }

    fn lower_component(
        &mut self,
        element: &JSXElement<'a>,
    ) -> Result<(Expression<'a>, std::vec::Vec<Statement<'a>>)> {
        crate::shared::component::lower_component_with_setup(self, element)
    }

    /// Component `ref` prop — same protocol as the shared Babel component
    /// transform.
    fn universal_component_ref(
        &mut self,
        span: Span,
        value: Expression<'a>,
        setup: &mut std::vec::Vec<Statement<'a>>,
    ) -> Option<ObjectPropertyKind<'a>> {
        if let Expression::Identifier(identifier) = &value {
            let name = identifier.name.to_string();
            if self.bindings.is_const(&name) {
                return Some(self.object_property(span, "ref", value));
            }
        }
        if matches!(
            value,
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        ) {
            return Some(self.object_property(span, "ref", value));
        }

        let apply_ref_call = |ctx: &mut Self, ref_identifier: Expression<'a>| {
            ctx.uses_apply_ref = true;
            ctx.call_identifier(
                span,
                &ctx.helper_local("_$applyRef"),
                vec![
                    expression_to_argument(ref_identifier),
                    expression_to_argument(ctx.identifier_expression(span, "r$")),
                ],
            )
        };

        if let Expression::CallExpression(_) = &value {
            let ref_id = self.next_ref_id();
            setup.push(self.variable_statement(span, &ref_id, value));
            let test = callable_test(
                self.allocator,
                span,
                self.identifier_expression(span, &ref_id),
            );
            let target = self.identifier_expression(span, &ref_id);
            let apply = apply_ref_call(self, target);
            let mut statements = self.ast().vec();
            statements.push(self.expression_statement(
                span,
                self.ast().expression_logical(
                    span,
                    test,
                    oxc_ast::ast::LogicalOperator::And,
                    apply,
                ),
            ));
            return Some(object_method_property(
                self.allocator,
                span,
                "ref",
                "r$",
                statements,
            ));
        }

        let ref_id = self.next_ref_id();
        let mut statements = self.ast().vec();
        statements.push(self.variable_statement(span, &ref_id, value.clone_in(self.allocator)));
        let test = callable_test(
            self.allocator,
            span,
            self.identifier_expression(span, &ref_id),
        );
        let target = self.identifier_expression(span, &ref_id);
        let apply = apply_ref_call(self, target);
        let fallback = assignment_fallback(
            self.allocator,
            span,
            &value,
            self.identifier_expression(span, "r$"),
        )?;
        statements.push(
            self.expression_statement(
                span,
                self.ast()
                    .expression_conditional(span, test, apply, fallback),
            ),
        );
        Some(object_method_property(
            self.allocator,
            span,
            "ref",
            "r$",
            statements,
        ))
    }

    pub(crate) fn lower_fragment(&mut self, fragment: &JSXFragment<'a>) -> Result<Expression<'a>> {
        crate::shared::fragment::lower_fragment(self, fragment)
    }

    fn create_text_node(&mut self, span: Span, value: &str) -> Expression<'a> {
        self.uses_create_text_node = true;
        self.call_identifier(
            span,
            &self.helper_local("_$createTextNode"),
            vec![self.string_arg(span, value)],
        )
    }

    fn insert_node_statement(
        &mut self,
        span: Span,
        parent_id: &str,
        child: Expression<'a>,
    ) -> Statement<'a> {
        self.uses_insert_node = true;
        self.expression_statement(
            span,
            self.call_identifier(
                span,
                &self.helper_local("_$insertNode"),
                vec![
                    self.identifier_arg(span, parent_id),
                    expression_to_argument(child),
                ],
            ),
        )
    }

    fn next_ref_id(&mut self) -> String {
        if let Some(dom) = &mut self.dynamic_dom {
            return dom.next_ref_id();
        }
        crate::shared::utils::next_unique_local("_ref", &mut self.ref_index, &self.bindings)
    }

    pub(crate) fn capture_this_expression(&mut self, span: Span) -> Expression<'a> {
        let name = if let Some(name) = &self.current_this_capture {
            name.clone()
        } else if let Some(name) = &self.pending_this_capture {
            let name = name.clone();
            self.current_this_capture = Some(name.clone());
            name
        } else {
            let name = if let Some(dom) = &mut self.dynamic_dom {
                crate::shared::utils::next_unique_local("_self", &mut dom.this_index, &dom.bindings)
            } else {
                crate::shared::utils::next_unique_local(
                    "_self",
                    &mut self.this_index,
                    &self.bindings,
                )
            };
            self.pending_this_capture = Some(name.clone());
            self.current_this_capture = Some(name.clone());
            name
        };
        self.identifier_expression(span, &name)
    }

    pub(crate) fn take_this_capture_statement(&mut self, span: Span) -> Option<Statement<'a>> {
        let name = self.pending_this_capture.take()?;
        Some(crate::shared::ast::variable_statement(
            self.allocator,
            span,
            oxc_ast::ast::VariableDeclarationKind::Const,
            &name,
            self.ast().expression_this(span),
        ))
    }

    pub(crate) fn clear_this_capture_context(&mut self) {
        self.current_this_capture = None;
    }

    /// Babel replaces a JSX root in place and immediately re-enters the
    /// replacement, so raw JSX left inside the statement itself (foreign
    /// renderer elements, deferred attribute values, prop getters) lowers
    /// now; JSX deferred into the inserted setup statements waits for the
    /// container-end pass.
    fn lower_deferred_statement_jsx(&mut self, statement: &mut Statement<'a>) {
        self.lower_foreign_jsx_statements(std::slice::from_mut(statement));
    }

    /// Collects statement bindings into this transform's table and mirrors
    /// them into the nested dom renderer's table (dynamic mode), which lowers
    /// native subtrees and needs the same const/function knowledge.
    pub(crate) fn in_class_method_scope(&self) -> bool {
        matches!(
            self.function_parent_stack.last(),
            Some(crate::shared::transform::FunctionParentKind::ClassMethod)
        )
    }

    fn collect_bindings(&mut self, statement: &Statement<'a>) {
        self.bindings.collect(statement);
        if let Some(dom) = &mut self.dynamic_dom {
            dom.bindings.collect(statement);
        }
    }

    pub(crate) fn enter_binding_scope(&mut self, kind: crate::shared::bindings::BindingScopeKind) {
        self.bindings.enter_scope(kind);
        if let Some(dom) = &mut self.dynamic_dom {
            dom.bindings.enter_scope(kind);
        }
    }

    pub(crate) fn exit_binding_scope(&mut self) {
        self.bindings.exit_scope();
        if let Some(dom) = &mut self.dynamic_dom {
            dom.bindings.exit_scope();
        }
    }

    pub(crate) fn process_statements(&mut self, statements: &mut ArenaVec<'a, Statement<'a>>) {
        self.statement_depth += 1;
        self.enter_binding_scope(crate::shared::bindings::BindingScopeKind::Block);
        let mut body = ArenaVec::new_in(&self.allocator);
        for mut statement in statements.drain(..) {
            if self.error.is_some() {
                body.push(statement);
                continue;
            }
            if let Some(setup) = self.lower_variable_jsx_initializer(&mut statement) {
                self.lower_deferred_statement_jsx(&mut statement);
                // Babel's `transformThis` inserts the capture before the
                // statement *prior to* `createTemplate` inserting setup, so
                // the capture precedes the setup statements that use it.
                // `getStatementParent().insertBefore` targets the JSX's own
                // statement wherever it nests, so no depth gate applies.
                if self.in_class_method_scope()
                    && let Some(capture) = self.take_this_capture_statement(statement.span())
                {
                    body.push(capture);
                    self.clear_this_capture_context();
                }
                body.extend(setup);
                self.collect_bindings(&statement);
                body.push(statement);
                continue;
            }
            if let Some(setup) = self.lower_return_jsx(&mut statement) {
                self.lower_deferred_statement_jsx(&mut statement);
                if self.in_class_method_scope()
                    && let Some(capture) = self.take_this_capture_statement(statement.span())
                {
                    body.push(capture);
                    self.clear_this_capture_context();
                }
                body.extend(setup);
                body.push(statement);
                continue;
            }
            self.visit_statement(&mut statement);
            self.lower_deferred_statement_jsx(&mut statement);
            self.collect_bindings(&statement);
            if self.in_class_method_scope()
                && let Some(capture) = self.take_this_capture_statement(statement.span())
            {
                body.push(capture);
                self.clear_this_capture_context();
            }
            body.push(statement);
        }
        // Statements inserted before their parent (the setup groups) join
        // Babel's container-level queue, so JSX deferred into them lowers
        // after every statement in this body has processed its own roots.
        self.lower_foreign_jsx_statements(&mut body);
        self.exit_binding_scope();
        *statements = body;
        self.statement_depth -= 1;
    }

    fn lower_variable_jsx_initializer(
        &mut self,
        statement: &mut Statement<'a>,
    ) -> Option<std::vec::Vec<Statement<'a>>> {
        // Babel's `isVarInit` is per-declarator and its `insertBefore`
        // targets the whole statement, including through `export const`.
        let declaration = match statement {
            Statement::VariableDeclaration(declaration) => declaration,
            Statement::ExportDeclaration(export) => match &mut export.declaration {
                oxc_ast::ast::Declaration::VariableDeclaration(declaration) => declaration,
                _ => return None,
            },
            _ => return None,
        };
        if !declaration.declarations.iter().any(|declarator| {
            declarator.init.as_ref().is_some_and(|init| {
                matches!(
                    init.get_inner_expression(),
                    Expression::JSXElement(_) | Expression::JSXFragment(_)
                )
            })
        }) {
            return None;
        }

        let mut setup: Option<std::vec::Vec<Statement<'a>>> = None;
        for index in 0..declaration.declarations.len() {
            let Some(init) = declaration.declarations[index].init.take() else {
                continue;
            };
            let init = if matches!(
                init.get_inner_expression(),
                Expression::JSXElement(_) | Expression::JSXFragment(_)
            ) {
                let (init, lowered) = self.lower_statement_position_jsx(init);
                if let Some(lowered) = lowered {
                    setup.get_or_insert_with(std::vec::Vec::new).extend(lowered);
                }
                init
            } else {
                let mut init = init;
                // Non-root inits in a mixed declaration still traverse
                // normally (nested JSX takes the expression-position path).
                self.visit_expression(&mut init);
                init
            };
            declaration.declarations[index].init = Some(init);
        }
        setup
    }

    fn lower_return_jsx(
        &mut self,
        statement: &mut Statement<'a>,
    ) -> Option<std::vec::Vec<Statement<'a>>> {
        let Statement::ReturnStatement(return_statement) = statement else {
            return None;
        };
        let argument = return_statement.argument.take()?;
        let (argument, lowered) = self.lower_statement_position_jsx(argument);
        return_statement.argument = Some(argument);
        lowered
    }

    /// Statement-position JSX (var initializers and return arguments) lifts
    /// its setup statements instead of wrapping them in an IIFE, mirroring
    /// Babel's `createTemplate` optimization.
    fn lower_statement_position_jsx(
        &mut self,
        mut expression: Expression<'a>,
    ) -> (Expression<'a>, Option<std::vec::Vec<Statement<'a>>>) {
        if matches!(
            expression,
            Expression::JSXElement(_) | Expression::JSXFragment(_)
        ) {
            crate::shared::transform::replace_this_in_jsx_root(self, &mut expression);
        }
        match expression {
            Expression::JSXElement(element) => {
                // `lower_element` lifts setup statements (Babel's
                // `createTemplate` optimization) for both renderers — a dom
                // subtree in statement position flattens instead of keeping
                // the dom transform's IIFE wrapping.
                let is_root = self.jsx_root_span.is_none();
                if is_root {
                    self.jsx_root_span = Some(element.span);
                }
                let lowered = self.lower_element(&element);
                if is_root {
                    self.jsx_root_span = None;
                }
                match lowered {
                    Ok((replacement, setup)) => {
                        let replacement = crate::shared::transform::finalize_root_capture(
                            self,
                            element.span,
                            replacement,
                        );
                        (replacement, Some(setup))
                    }
                    Err(error) => {
                        self.error = Some(error.to_string());
                        (Expression::JSXElement(element), Some(std::vec::Vec::new()))
                    }
                }
            }
            Expression::JSXFragment(fragment) => {
                let is_root = self.jsx_root_span.is_none();
                if is_root {
                    self.jsx_root_span = Some(fragment.span);
                }
                let lowered = self.lower_fragment(&fragment);
                if is_root {
                    self.jsx_root_span = None;
                }
                match lowered {
                    Ok(replacement) => {
                        let replacement = crate::shared::transform::finalize_root_capture(
                            self,
                            fragment.span,
                            replacement,
                        );
                        (replacement, Some(std::vec::Vec::new()))
                    }
                    Err(error) => {
                        self.error = Some(error.to_string());
                        (
                            Expression::JSXFragment(fragment),
                            Some(std::vec::Vec::new()),
                        )
                    }
                }
            }
            Expression::ParenthesizedExpression(parenthesized) => {
                let inner = parenthesized.unbox().expression;
                match inner {
                    Expression::JSXElement(_) | Expression::JSXFragment(_) => {
                        self.lower_statement_position_jsx(inner)
                    }
                    inner => (inner, None),
                }
            }
            expression => (expression, None),
        }
    }
}

fn push_text_plan<'a>(plans: &mut std::vec::Vec<ChildPlan<'a>>, value: String) {
    if let Some(ChildPlan::Text {
        value: previous, ..
    }) = plans.last_mut()
    {
        previous.push_str(&value);
    } else {
        plans.push(ChildPlan::Text { value, id: None });
    }
}

impl<'a> ConditionBuilder<'a> for AstUniversalTransform<'a, '_> {
    fn condition_allocator(&self) -> &'a Allocator {
        self.allocator
    }

    fn memo_wrapper_enabled(&self) -> bool {
        self.memo_wrapper.is_some()
    }

    fn register_memo(&mut self) -> String {
        if let Some(dom) = &mut self.dynamic_dom {
            dom.template_state.uses_memo = true;
        } else {
            self.uses_memo = true;
        }
        self.memo_wrapper_local()
    }

    fn next_condition_id(&mut self) -> String {
        if let Some(dom) = &mut self.dynamic_dom {
            return dom.next_condition_id();
        }
        crate::shared::utils::next_unique_local("_c", &mut self.condition_index, &self.bindings)
    }

    fn classify(&self) -> Classify<'_> {
        AstUniversalTransform::classify(self)
    }
}

impl<'a> crate::shared::component_children::ComponentChildLower<'a>
    for AstUniversalTransform<'a, '_>
{
    fn lower_child_element_with_setup(
        &mut self,
        element: &JSXElement<'a>,
    ) -> Result<(Expression<'a>, std::vec::Vec<Statement<'a>>)> {
        self.lower_element(element)
    }
}

impl<'a> crate::shared::mode_lower::ModeLower<'a> for AstUniversalTransform<'a, '_> {
    fn wrap_conditionals_enabled(&self) -> bool {
        self.wrap_conditionals
    }

    fn lower_child_element(&mut self, element: &JSXElement<'a>) -> Result<Expression<'a>> {
        let (value, setup) = self.lower_element(element)?;
        Ok(self.setup_iife(element.span, setup, value))
    }

    fn memo_wrap_dynamic_child(&mut self, span: Span, thunk: Expression<'a>) -> Expression<'a> {
        memo_wrap_thunk(self, span, thunk)
    }
}

impl<'a> crate::shared::component::ComponentLower<'a> for AstUniversalTransform<'a, '_> {
    fn mark_create_component(&mut self) {
        self.uses_create_component = true;
    }

    fn is_jsx_root_tag(&self, span: Span) -> bool {
        self.jsx_root_span == Some(span)
    }

    fn component_ref_prop(
        &mut self,
        span: Span,
        value: Expression<'a>,
        setup: &mut std::vec::Vec<Statement<'a>>,
    ) -> Option<ObjectPropertyKind<'a>> {
        self.universal_component_ref(span, value, setup)
    }
}

impl<'a> ComponentPropContext<'a> for AstUniversalTransform<'a, '_> {
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
        let callee = if callee.starts_with("_$") {
            self.helper_local(callee)
        } else {
            callee.to_string()
        };
        self.call_expression(
            span,
            self.ast()
                .expression_identifier(span, self.ast().ident(&callee)),
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
