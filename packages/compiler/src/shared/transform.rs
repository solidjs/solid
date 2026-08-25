use crate::error::Result;
use oxc_allocator::Vec as ArenaVec;
use oxc_ast::ast::{ClassElement, Expression, JSXElement, JSXFragment, Program, Statement};
use oxc_ast_visit::{VisitMut, walk_mut};
use oxc_span::{GetSpan, Span};

use crate::dom::element::AstDomTransform;
use crate::shared::fragment::lower_fragment;
use crate::ssr::transform::AstSsrTransform;
use crate::universal::transform::AstUniversalTransform;

pub(crate) trait JsxTransform<'a>: VisitMut<'a> {
    fn has_error(&self) -> bool;
    fn set_error(&mut self, error: String);
    fn process_statements(&mut self, statements: &mut ArenaVec<'a, Statement<'a>>);
    fn lower_jsx_element(&mut self, element: &JSXElement<'a>) -> Result<Expression<'a>>;
    fn lower_jsx_fragment(&mut self, fragment: &JSXFragment<'a>) -> Result<Expression<'a>>;
    fn lower_class_field_value(&mut self, span: Span, value: Expression<'a>) -> Expression<'a>;
    fn arena(&self) -> &'a oxc_allocator::Allocator;
    /// The `_self$` alias expression for a `this` capture (Babel's
    /// `transformThis` uid).
    fn capture_this(&mut self, span: Span) -> Expression<'a>;
    /// Marks a function expression as the callee of its own call (an IIFE);
    /// Babel's `Scope.push` hoists `var` uids into such functions as
    /// parameters. Only the SSR transform tracks these. Keyed by node address
    /// (spans are unreliable — synthesized nodes share them).
    fn push_iife_callee(&mut self, _addr: usize) {}
    fn pop_iife_callee(&mut self) {}
    /// Records a function/arrow node whose body has already been driven
    /// through `process_statements` — which ends with its own deferred pass,
    /// so nothing raw is left inside. Keyed by node address (spans are
    /// unreliable — synthesized nodes share them). No-ops unless
    /// `body_lowering_settled` holds.
    fn mark_body_lowered(&mut self, addr: usize);
    fn is_body_lowered(&self, addr: usize) -> bool;
    /// Whether a body finishing right now is genuinely fully lowered. False
    /// while a JSX root is mid-lowering and the target defers its own passes
    /// until the root settles (SSR): the body still has raw JSX waiting for
    /// the outer pass, so marking it would drop that JSX silently. Targets
    /// whose `process_statements` always runs its deferred pass are settled
    /// unconditionally.
    fn body_lowering_settled(&self) -> bool {
        true
    }
    /// Stack of enclosing function parents (Babel's `getFunctionParent`
    /// chain), used to place `_self$` captures.
    fn function_parents(&mut self) -> &mut std::vec::Vec<FunctionParentKind>;
    /// Set when a `MethodDefinition` is about to visit its value function so
    /// `visit_function` can classify it as a class method.
    fn mark_next_function_class_method(&mut self);
    fn take_next_function_class_method(&mut self) -> bool;
    /// Takes the pending `const _self$ = this;` capture statement, if any.
    fn take_this_capture(&mut self, span: Span) -> Option<Statement<'a>>;
    /// Name of the pending capture, if any (used to detect captures created
    /// within a function's subtree).
    fn pending_capture_name(&self) -> Option<String>;
    /// Pre-scan hook: collect every identifier name in the program so uid
    /// generation (Babel's `generateUid`) can skip colliding candidates.
    fn scan_taken_names(&mut self, program: &Program<'a>);
    /// Opens a function frame in the binding table(s) when the traversal
    /// enters a function-like scope (functions, arrows, static blocks), so
    /// identifier classification resolves against the live scope chain.
    fn enter_function_bindings(&mut self);
    fn exit_function_bindings(&mut self);
    /// Declares a function's parameters into the binding table after its
    /// scope opens (patch-mode subject resolution; dom only).
    fn declare_function_params(&mut self, _params: &oxc_ast::ast::FormalParameters<'a>) {}
    /// Row-proof stamping hook (DESIGN-PATCH-CHANNEL §3c, dom only): called
    /// with every expression slot after its subtree has lowered, so a
    /// single-param function whose body became a proven-pure template can be
    /// wrapped with the runtime's `rowProof` marker in place.
    fn wrap_pure_row(&mut self, _expression: &mut Expression<'a>) {}
    /// Pre-walk row-shape capture (dom only): return-position JSX inlines
    /// its setup statements FLAT into the enclosing block, so whether a
    /// block body was ORIGINALLY a lone `return <jsx/>` (stampable — every
    /// other statement is user code at build time, which must deny) is only
    /// knowable before the walk. Pushed at function-scope entry, popped at
    /// exit into a "last function shape" slot that `wrap_pure_row` reads.
    fn enter_function_shape(&mut self, _single_return_block: bool) {}
    fn exit_function_shape(&mut self) {}
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum FunctionParentKind {
    /// `ClassMethod` in Babel — the capture inserts before the JSX statement.
    ClassMethod,
    /// Plain function / object method / private class method — Babel's
    /// `parent.push` unshifts the capture at the top of the function body.
    Function,
    /// Arrow function — same `parent.push` route as `Function`.
    Arrow,
}

/// Babel's `transformThis` with no function parent (top level, class field
/// initializers) wraps the transformed node: `(() => { const _self$ = this;
/// return node; })()`.
pub(crate) fn wrap_result_with_capture<'a>(
    allocator: &'a oxc_allocator::Allocator,
    span: Span,
    capture: Statement<'a>,
    result: Expression<'a>,
) -> Expression<'a> {
    let ast = crate::shared::ast_builder::AstBuilder::new(allocator);
    let mut statements = ast.vec();
    statements.push(capture);
    statements.push(ast.statement_return(span, Some(result)));
    let params = ast.formal_parameters(
        span,
        oxc_ast::ast::FormalParameterKind::ArrowFormalParameters,
        ast.vec(),
        None,
    );
    let body = ast.function_body(span, ast.vec(), statements);
    let arrow = ast.expression_arrow_function(span, false, false, None, params, None, body);
    ast.expression_call(span, arrow, None, ast.vec(), false)
}

/// Applies the stack-empty capture rule at a JSX root's completion: when the
/// root has no enclosing function, the pending capture wraps the result.
pub(crate) fn finalize_root_capture<'a, T: JsxTransform<'a>>(
    target: &mut T,
    span: Span,
    result: Expression<'a>,
) -> Expression<'a> {
    if !target.function_parents().is_empty() {
        return result;
    }
    let Some(capture) = target.take_this_capture(span) else {
        return result;
    };
    wrap_result_with_capture(target.arena(), span, capture, result)
}

/// Babel `parent.push({ id, init: this, kind: "const" })`: the capture
/// unshifts at the top of the enclosing (non-class-method) function body.
fn unshift_capture_into_body<'a>(
    allocator: &'a oxc_allocator::Allocator,
    body: &mut oxc_ast::ast::FunctionBody<'a>,
    capture: Statement<'a>,
) {
    let ast = crate::shared::ast_builder::AstBuilder::new(allocator);
    let mut statements = ast.vec();
    statements.push(capture);
    statements.extend(body.statements.drain(..));
    body.statements = statements;
}

/// Consumes a capture at a function's exit only when it was created within
/// the function's subtree (a pending capture from an outer JSX root belongs
/// to the outer scope). Class methods flush through the statement loop.
pub(crate) fn exit_function_scope<'a, T: JsxTransform<'a>>(
    target: &mut T,
    kind: FunctionParentKind,
    span: Span,
    pending_at_entry: Option<String>,
) -> Option<Statement<'a>> {
    let popped = target.function_parents().pop();
    debug_assert_eq!(popped, Some(kind));
    if kind == FunctionParentKind::ClassMethod {
        return None;
    }
    if target.pending_capture_name() == pending_at_entry {
        return None;
    }
    target.take_this_capture(span)
}

pub(crate) fn visit_function_scope<'a, T: JsxTransform<'a>>(
    target: &mut T,
    function: &mut oxc_ast::ast::Function<'a>,
    flags: oxc_syntax::scope::ScopeFlags,
) {
    let kind = if target.take_next_function_class_method() {
        FunctionParentKind::ClassMethod
    } else {
        FunctionParentKind::Function
    };
    let pending_at_entry = target.pending_capture_name();
    target.function_parents().push(kind);
    target.enter_function_bindings();
    target.declare_function_params(&function.params);
    target.enter_function_shape(
        function
            .body
            .as_ref()
            .is_some_and(|body| body.statements.len() == 1
                && matches!(body.statements[0], Statement::ReturnStatement(_))),
    );
    walk_mut::walk_function(target, function, flags);
    target.exit_function_shape();
    target.exit_function_bindings();
    if let Some(capture) = exit_function_scope(target, kind, function.span, pending_at_entry)
        && let Some(body) = function.body.as_mut()
    {
        unshift_capture_into_body(target.arena(), body, capture);
    }
    target.mark_body_lowered(std::ptr::from_ref(&*function) as usize);
}

pub(crate) fn visit_arrow_function_scope<'a, T: JsxTransform<'a>>(
    target: &mut T,
    arrow: &mut oxc_ast::ast::ArrowFunctionExpression<'a>,
) {
    let expression_body = arrow.is_expression();
    let pending_at_entry = target.pending_capture_name();
    target.function_parents().push(FunctionParentKind::Arrow);
    target.enter_function_bindings();
    target.declare_function_params(&arrow.params);
    target.enter_function_shape(
        !expression_body
            && arrow.get_function_body().is_some_and(|body| {
                body.statements.len() == 1
                    && matches!(body.statements[0], Statement::ReturnStatement(_))
            }),
    );
    walk_mut::walk_arrow_function_expression(target, arrow);
    if expression_body && let Some(expression) = arrow.get_expression_mut() {
        lower_deferred_jsx_expression(target, expression);
    }
    target.exit_function_shape();
    target.exit_function_bindings();
    if let Some(capture) = exit_function_scope(
        target,
        FunctionParentKind::Arrow,
        arrow.span,
        pending_at_entry,
    ) {
        ensure_arrow_block(target.arena(), arrow);
        let body = arrow
            .get_function_body_mut()
            .expect("ensure_arrow_block creates a function body");
        unshift_capture_into_body(target.arena(), body, capture);
    }
    target.mark_body_lowered(std::ptr::from_ref(&*arrow) as usize);
}

/// Babel `ensureBlock`: `() => expr` becomes `() => { return expr; }`.
fn ensure_arrow_block<'a>(
    allocator: &'a oxc_allocator::Allocator,
    arrow: &mut oxc_ast::ast::ArrowFunctionExpression<'a>,
) {
    if !arrow.is_expression() {
        return;
    }
    let ast = crate::shared::ast_builder::AstBuilder::new(allocator);
    let expression = arrow
        .get_expression_mut()
        .expect("expression arrow has an expression body");
    let span = expression.span();
    let placeholder = ast.expression_null_literal(span);
    let value = std::mem::replace(expression, placeholder);
    let body = ast.function_body(
        span,
        ast.vec(),
        ast.vec1(ast.statement_return(span, Some(value))),
    );
    arrow.body = ast.arrow_function_body_block(body);
}

/// Babel `Scope.push`'s IIFE fast path fires for an anonymous function
/// expression called with no more arguments than it has parameters. Returns
/// the callee node's address for identity tracking.
pub(crate) fn iife_callee_addr(call: &oxc_ast::ast::CallExpression<'_>) -> Option<usize> {
    match &call.callee {
        Expression::ArrowFunctionExpression(arrow)
            if call.arguments.len() <= arrow.params.items.len() =>
        {
            Some(std::ptr::from_ref(&**arrow) as usize)
        }
        Expression::FunctionExpression(function)
            if function.id.is_none() && call.arguments.len() <= function.params.items.len() =>
        {
            Some(std::ptr::from_ref(&**function) as usize)
        }
        _ => None,
    }
}

/// Port of Babel's `transformThis`: before a JSX root lowers, every `this`
/// belonging to the root's function parent — in expression positions *and*
/// JSX tag names, at any depth that doesn't cross a non-arrow function or
/// class boundary (`getTargetFunctionParent`) — is replaced with the `_self$`
/// capture. The root element's own tag stays raw (`path.traverse` never
/// visits the root node itself); `component_callee_expression` handles that
/// case at lowering time.
pub(crate) fn replace_this_in_jsx_root<'a, T: JsxTransform<'a>>(
    target: &mut T,
    expression: &mut Expression<'a>,
) {
    let root_element_span = match expression {
        Expression::JSXElement(element) => Some(element.span),
        Expression::JSXFragment(_) => None,
        _ => return,
    };

    struct ThisPass<'ctx, 'a, T: JsxTransform<'a>> {
        target: &'ctx mut T,
        root_element_span: Option<Span>,
        marker: std::marker::PhantomData<&'a ()>,
    }

    impl<'a, T: JsxTransform<'a>> VisitMut<'a> for ThisPass<'_, 'a, T> {
        fn visit_expression(&mut self, expression: &mut Expression<'a>) {
            if let Expression::ThisExpression(this) = expression {
                *expression = self.target.capture_this(this.span);
                return;
            }
            walk_mut::walk_expression(self, expression);
        }

        // Babel's `getTargetFunctionParent` gate: `this` inside a nested
        // non-arrow function (or class) belongs to that scope, not the JSX
        // root's function parent, so it stays raw.
        fn visit_function(
            &mut self,
            _function: &mut oxc_ast::ast::Function<'a>,
            _flags: oxc_syntax::scope::ScopeFlags,
        ) {
        }

        fn visit_class(&mut self, _class: &mut oxc_ast::ast::Class<'a>) {}

        fn visit_jsx_element(&mut self, element: &mut JSXElement<'a>) {
            if Some(element.span) != self.root_element_span {
                replace_jsx_name_this(self.target, &mut element.opening_element.name);
            }
            walk_mut::walk_jsx_element(self, element);
        }
    }

    let mut pass = ThisPass {
        target,
        root_element_span,
        marker: std::marker::PhantomData,
    };
    pass.visit_expression(expression);
}

/// `<this.another/>` → `<_self$.another/>` (Babel replaces the base
/// `JSXIdentifier` of the tag). Closing-tag sync is irrelevant post-lowering.
fn replace_jsx_name_this<'a, T: JsxTransform<'a>>(
    target: &mut T,
    name: &mut oxc_ast::ast::JSXElementName<'a>,
) {
    use oxc_ast::ast::{JSXElementName, JSXMemberExpressionObject};

    fn capture_ident<'a, T: JsxTransform<'a>>(
        target: &mut T,
        span: Span,
    ) -> oxc_ast::ast::IdentifierReference<'a> {
        let Expression::Identifier(identifier) = target.capture_this(span) else {
            unreachable!("this capture lowers to an identifier");
        };
        identifier.unbox()
    }

    match name {
        JSXElementName::ThisExpression(this) => {
            let span = this.span;
            let identifier = capture_ident(target, span);
            *name = JSXElementName::IdentifierReference(oxc_allocator::Box::new_in(
                identifier,
                &target.arena(),
            ));
        }
        JSXElementName::MemberExpression(member) => {
            let mut object = &mut member.object;
            loop {
                match object {
                    JSXMemberExpressionObject::MemberExpression(inner) => {
                        object = &mut inner.object;
                    }
                    JSXMemberExpressionObject::ThisExpression(this) => {
                        let span = this.span;
                        let identifier = capture_ident(target, span);
                        *object = JSXMemberExpressionObject::IdentifierReference(
                            oxc_allocator::Box::new_in(identifier, &target.arena()),
                        );
                        break;
                    }
                    JSXMemberExpressionObject::IdentifierReference(_) => break,
                }
            }
        }
        _ => {}
    }
}

pub(crate) fn visit_program<'a, T: JsxTransform<'a>>(target: &mut T, program: &mut Program<'a>) {
    target.scan_taken_names(program);
    target.process_statements(&mut program.body);
}

pub(crate) fn visit_statements<'a, T: JsxTransform<'a>>(
    target: &mut T,
    statements: &mut ArenaVec<'a, Statement<'a>>,
) {
    target.process_statements(statements);
}

pub(crate) fn visit_expression<'a, T: JsxTransform<'a>>(
    target: &mut T,
    expression: &mut Expression<'a>,
) {
    if target.has_error() {
        return;
    }
    if matches!(
        expression,
        Expression::JSXElement(_) | Expression::JSXFragment(_)
    ) {
        replace_this_in_jsx_root(target, expression);
    }
    if let Expression::JSXElement(element) = expression {
        match target.lower_jsx_element(element) {
            Ok(replacement) => *expression = replacement,
            Err(error) => target.set_error(error.to_string()),
        }
        return;
    }

    if let Expression::JSXFragment(fragment) = expression {
        match target.lower_jsx_fragment(fragment) {
            Ok(replacement) => *expression = replacement,
            Err(error) => target.set_error(error.to_string()),
        }
        return;
    }

    walk_mut::walk_expression(target, expression);
    // Row-proof stamping (§3c): the walk above lowered any JSX body this
    // function expression carries; if it proved pure, wrap in place.
    if matches!(
        expression,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        target.wrap_pure_row(expression);
    }
}

/// Node address of a function/arrow expression, matching the key
/// `visit_function_scope` / `visit_arrow_function_scope` mark bodies with.
fn function_node_addr(expression: &Expression<'_>) -> Option<usize> {
    match expression {
        Expression::FunctionExpression(function) => Some(std::ptr::from_ref(&**function) as usize),
        Expression::ArrowFunctionExpression(arrow) => Some(std::ptr::from_ref(&**arrow) as usize),
        _ => None,
    }
}

/// Babel's outer traversal re-enters each replaced JSX root and transforms
/// any JSX still inside it — dynamic attribute values are stored raw by the
/// element transforms and only lowered here, after the root's own templates
/// have registered. This walker replays that pass over lowered output in
/// document order.
struct DeferredJsxLowerer<'ctx, 'a, T: JsxTransform<'a>> {
    target: &'ctx mut T,
    marker: std::marker::PhantomData<&'a ()>,
}

impl<'a, T: JsxTransform<'a>> VisitMut<'a> for DeferredJsxLowerer<'_, 'a, T> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        // Keep the IIFE-callee context visible to the target while this
        // walker owns the traversal (SSR var hoisting shapes depend on it).
        if let Expression::CallExpression(call) = expression {
            let addr = iife_callee_addr(call);
            if let Some(addr) = addr {
                self.target.push_iife_callee(addr);
            }
            walk_mut::walk_expression(self, expression);
            if addr.is_some() {
                self.target.pop_iife_callee();
            }
            return;
        }
        if matches!(
            expression,
            Expression::JSXElement(_) | Expression::JSXFragment(_)
        ) {
            visit_expression(self.target, expression);
            // A transform may leave JSX untouched on purpose (a foreign
            // renderer's element in dynamic mode); don't loop on it.
            if !matches!(
                expression,
                Expression::JSXElement(_) | Expression::JSXFragment(_)
            ) {
                walk_mut::walk_expression(self, expression);
            }
            return;
        }
        // Function bodies re-enter the target's own traversal: deferred JSX in
        // statement position there (`get data() { return <jsx/>; }`) inlines
        // its setup statements through `process_statements`, and targets that
        // track function scopes (SSR var hoisting) see the enter/exit events.
        // Bodies `process_statements` already drove are skipped: it ends with
        // its own container-end deferred pass, so nothing raw survives inside
        // and re-entering makes compile time 3^depth in scope nesting.
        if let Some(addr) = function_node_addr(expression) {
            if !self.target.is_body_lowered(addr) {
                visit_expression(self.target, expression);
            }
            return;
        }
        walk_mut::walk_expression(self, expression);
    }
}

pub(crate) fn lower_deferred_jsx_statements<'a, T: JsxTransform<'a>>(
    target: &mut T,
    statements: &mut [Statement<'a>],
) {
    let mut lowerer = DeferredJsxLowerer {
        target,
        marker: std::marker::PhantomData,
    };
    for statement in statements {
        lowerer.visit_statement(statement);
    }
}

fn lower_deferred_jsx_expression<'a, T: JsxTransform<'a>>(
    target: &mut T,
    expression: &mut Expression<'a>,
) {
    let mut lowerer = DeferredJsxLowerer {
        target,
        marker: std::marker::PhantomData,
    };
    lowerer.visit_expression(expression);
}

pub(crate) fn visit_class_element<'a, T: JsxTransform<'a>>(
    target: &mut T,
    class_element: &mut ClassElement<'a>,
) {
    if let ClassElement::MethodDefinition(method) = class_element {
        // Babel's `parent.block.type === "ClassMethod"` branch: captures for
        // JSX inside method bodies insert before the JSX statement. Private
        // methods are `ClassPrivateMethod` in Babel and take the
        // `parent.push` route like plain functions.
        if !matches!(method.key, oxc_ast::ast::PropertyKey::PrivateIdentifier(_)) {
            target.mark_next_function_class_method();
        }
        walk_mut::walk_class_element(target, class_element);
        return;
    }
    let ClassElement::PropertyDefinition(property) = class_element else {
        walk_mut::walk_class_element(target, class_element);
        return;
    };
    let Some(value) = property.value.take() else {
        return;
    };
    property.value = Some(target.lower_class_field_value(property.span, value));
}

/// Every JSX target drives traversal identically — it only customizes the
/// lowering hooks on `JsxTransform`. This macro wires the `VisitMut` entry
/// points to the shared dispatch functions above so the delegation lives in one
/// place instead of being copy-pasted per target.
macro_rules! impl_jsx_visit_mut {
    ($target:ident) => {
        impl<'a> VisitMut<'a> for $target<'a, '_> {
            fn visit_program(&mut self, program: &mut Program<'a>) {
                visit_program(self, program);
            }

            fn visit_statements(&mut self, statements: &mut ArenaVec<'a, Statement<'a>>) {
                visit_statements(self, statements);
            }

            fn visit_expression(&mut self, expression: &mut Expression<'a>) {
                visit_expression(self, expression);
            }

            fn visit_class_element(&mut self, class_element: &mut ClassElement<'a>) {
                visit_class_element(self, class_element);
            }

            fn visit_function(
                &mut self,
                function: &mut oxc_ast::ast::Function<'a>,
                flags: oxc_syntax::scope::ScopeFlags,
            ) {
                visit_function_scope(self, function, flags);
            }

            fn visit_arrow_function_expression(
                &mut self,
                arrow: &mut oxc_ast::ast::ArrowFunctionExpression<'a>,
            ) {
                visit_arrow_function_scope(self, arrow);
            }

            fn visit_static_block(&mut self, block: &mut oxc_ast::ast::StaticBlock<'a>) {
                // `var`s inside a class static block don't hoist past it.
                self.enter_function_bindings();
                walk_mut::walk_static_block(self, block);
                self.exit_function_bindings();
            }
        }
    };
}

macro_rules! impl_function_parent_accessors {
    () => {
        fn function_parents(&mut self) -> &mut std::vec::Vec<FunctionParentKind> {
            &mut self.function_parent_stack
        }

        fn mark_next_function_class_method(&mut self) {
            self.next_function_class_method = true;
        }

        fn take_next_function_class_method(&mut self) -> bool {
            std::mem::take(&mut self.next_function_class_method)
        }

        fn take_this_capture(&mut self, span: Span) -> Option<Statement<'a>> {
            let statement = self.take_this_capture_statement(span)?;
            self.clear_this_capture_context();
            Some(statement)
        }

        fn pending_capture_name(&self) -> Option<String> {
            self.pending_this_capture.clone()
        }

        fn mark_body_lowered(&mut self, addr: usize) {
            if self.body_lowering_settled() {
                self.lowered_function_bodies.insert(addr);
            }
        }

        fn is_body_lowered(&self, addr: usize) -> bool {
            self.lowered_function_bodies.contains(&addr)
        }
    };
}

impl<'a> JsxTransform<'a> for AstDomTransform<'a, '_> {
    fn has_error(&self) -> bool {
        self.error.is_some()
    }

    fn set_error(&mut self, error: String) {
        self.error = Some(error);
    }

    fn process_statements(&mut self, statements: &mut ArenaVec<'a, Statement<'a>>) {
        AstDomTransform::process_statements(self, statements);
    }

    fn lower_jsx_element(&mut self, element: &JSXElement<'a>) -> Result<Expression<'a>> {
        let is_root = self.jsx_root_span.is_none();
        if is_root {
            self.jsx_root_span = Some(element.span);
        }
        let mut result = self.lower_element(element);
        if is_root {
            self.jsx_root_span = None;
            result = result.map(|value| finalize_root_capture(self, element.span, value));
        }
        result
    }

    fn lower_jsx_fragment(&mut self, fragment: &JSXFragment<'a>) -> Result<Expression<'a>> {
        let is_root = self.jsx_root_span.is_none();
        if is_root {
            self.jsx_root_span = Some(fragment.span);
        }
        let mut result = lower_fragment(self, fragment);
        if is_root {
            self.jsx_root_span = None;
            result = result.map(|value| finalize_root_capture(self, fragment.span, value));
        }
        result
    }

    fn lower_class_field_value(&mut self, span: Span, value: Expression<'a>) -> Expression<'a> {
        AstDomTransform::lower_class_field_value(self, span, value)
    }

    fn wrap_pure_row(&mut self, expression: &mut Expression<'a>) {
        AstDomTransform::wrap_pure_row_expression(self, expression);
    }

    fn declare_function_params(&mut self, params: &oxc_ast::ast::FormalParameters<'a>) {
        self.bindings.declare_function_params(params);
    }

    fn enter_function_shape(&mut self, single_return_block: bool) {
        self.function_shape_stack.push(single_return_block);
    }

    fn exit_function_shape(&mut self) {
        self.last_function_single_return = self.function_shape_stack.pop().unwrap_or(false);
    }

    fn arena(&self) -> &'a oxc_allocator::Allocator {
        self.allocator
    }

    fn capture_this(&mut self, span: Span) -> Expression<'a> {
        self.capture_this_expression(span)
    }

    fn scan_taken_names(&mut self, program: &Program<'a>) {
        self.bindings.scan_taken_names(program);
        let built_ins = self.built_ins.clone();
        self.bindings.scan_builtin_shadowing(program, &built_ins);
    }

    fn enter_function_bindings(&mut self) {
        self.bindings
            .enter_scope(crate::shared::bindings::BindingScopeKind::Function);
    }

    fn exit_function_bindings(&mut self) {
        self.bindings.exit_scope();
    }

    impl_function_parent_accessors!();
}

impl<'a> JsxTransform<'a> for AstSsrTransform<'a, '_> {
    fn has_error(&self) -> bool {
        self.error.is_some()
    }

    fn set_error(&mut self, error: String) {
        self.error = Some(error);
    }

    fn process_statements(&mut self, statements: &mut ArenaVec<'a, Statement<'a>>) {
        AstSsrTransform::process_statements(self, statements);
    }

    fn lower_jsx_element(&mut self, element: &JSXElement<'a>) -> Result<Expression<'a>> {
        let is_root = self.jsx_root_span.is_none();
        if is_root {
            self.jsx_root_span = Some(element.span);
        }
        let mut result = self.lower_element(element);
        if is_root {
            self.jsx_root_span = None;
            result = result.map(|value| finalize_root_capture(self, element.span, value));
        }
        result
    }

    fn lower_jsx_fragment(&mut self, fragment: &JSXFragment<'a>) -> Result<Expression<'a>> {
        let is_root = self.jsx_root_span.is_none();
        if is_root {
            self.jsx_root_span = Some(fragment.span);
        }
        let mut result = self.lower_fragment(fragment);
        if is_root {
            self.jsx_root_span = None;
            result = result.map(|value| finalize_root_capture(self, fragment.span, value));
        }
        result
    }

    fn lower_class_field_value(&mut self, span: Span, value: Expression<'a>) -> Expression<'a> {
        AstSsrTransform::lower_class_field_value(self, span, value)
    }

    fn arena(&self) -> &'a oxc_allocator::Allocator {
        self.allocator
    }

    fn capture_this(&mut self, span: Span) -> Expression<'a> {
        self.capture_this_expression(span)
    }

    fn push_iife_callee(&mut self, addr: usize) {
        self.iife_callee_addrs.push(addr);
    }

    fn pop_iife_callee(&mut self) {
        self.iife_callee_addrs.pop();
    }

    fn scan_taken_names(&mut self, program: &Program<'a>) {
        self.bindings.scan_taken_names(program);
        let built_ins = self.built_ins.clone();
        self.bindings.scan_builtin_shadowing(program, &built_ins);
    }

    fn enter_function_bindings(&mut self) {
        self.bindings
            .enter_scope(crate::shared::bindings::BindingScopeKind::Function);
    }

    fn exit_function_bindings(&mut self) {
        self.bindings.exit_scope();
    }

    /// SSR runs both of its deferred passes only outside a JSX root, so a body
    /// that finishes while one is mid-lowering still holds raw JSX for the
    /// outer pass and must not be marked.
    fn body_lowering_settled(&self) -> bool {
        self.jsx_root_span.is_none()
    }

    impl_function_parent_accessors!();
}

impl<'a> JsxTransform<'a> for AstUniversalTransform<'a, '_> {
    fn has_error(&self) -> bool {
        self.error.is_some()
    }

    fn set_error(&mut self, error: String) {
        self.error = Some(error);
    }

    fn process_statements(&mut self, statements: &mut ArenaVec<'a, Statement<'a>>) {
        AstUniversalTransform::process_statements(self, statements);
    }

    fn lower_jsx_element(&mut self, element: &JSXElement<'a>) -> Result<Expression<'a>> {
        let is_root = self.jsx_root_span.is_none();
        if is_root {
            self.jsx_root_span = Some(element.span);
        }
        let mut result = self
            .lower_element(element)
            .map(|(replacement, setup)| self.setup_iife(element.span, setup, replacement));
        if is_root {
            self.jsx_root_span = None;
            result = result.map(|value| finalize_root_capture(self, element.span, value));
        }
        result
    }

    fn lower_jsx_fragment(&mut self, fragment: &JSXFragment<'a>) -> Result<Expression<'a>> {
        let is_root = self.jsx_root_span.is_none();
        if is_root {
            self.jsx_root_span = Some(fragment.span);
        }
        let mut result = self.lower_fragment(fragment);
        if is_root {
            self.jsx_root_span = None;
            result = result.map(|value| finalize_root_capture(self, fragment.span, value));
        }
        result
    }

    fn lower_class_field_value(
        &mut self,
        _span: Span,
        mut value: Expression<'a>,
    ) -> Expression<'a> {
        self.visit_expression(&mut value);
        value
    }

    fn arena(&self) -> &'a oxc_allocator::Allocator {
        self.allocator
    }

    fn capture_this(&mut self, span: Span) -> Expression<'a> {
        self.capture_this_expression(span)
    }

    fn scan_taken_names(&mut self, program: &Program<'a>) {
        self.bindings.scan_taken_names(program);
        let built_ins = self.built_ins.clone();
        self.bindings.scan_builtin_shadowing(program, &built_ins);
        // Dynamic mode routes native elements through the embedded DOM
        // transform, whose generators consult their own binding table.
        if let Some(dom) = &mut self.dynamic_dom {
            dom.bindings.scan_taken_names(program);
            let dom_built_ins = dom.built_ins.clone();
            dom.bindings.scan_builtin_shadowing(program, &dom_built_ins);
        }
    }

    fn enter_function_bindings(&mut self) {
        AstUniversalTransform::enter_binding_scope(
            self,
            crate::shared::bindings::BindingScopeKind::Function,
        );
    }

    fn exit_function_bindings(&mut self) {
        AstUniversalTransform::exit_binding_scope(self);
    }

    fn declare_function_params(&mut self, params: &oxc_ast::ast::FormalParameters<'a>) {
        self.bindings.declare_function_params(params);
        // Dynamic mode: the embedded DOM renderer's patch-mode subject guard
        // resolves against ITS binding table (scopes already forward).
        if let Some(dom) = &mut self.dynamic_dom {
            dom.bindings.declare_function_params(params);
        }
    }

    fn wrap_pure_row(&mut self, expression: &mut Expression<'a>) {
        // Dynamic mode: row proofs live on the embedded DOM renderer.
        if let Some(dom) = &mut self.dynamic_dom {
            dom.wrap_pure_row_expression(expression);
        }
    }

    fn enter_function_shape(&mut self, single_return_block: bool) {
        if let Some(dom) = &mut self.dynamic_dom {
            dom.function_shape_stack.push(single_return_block);
        }
    }

    fn exit_function_shape(&mut self) {
        if let Some(dom) = &mut self.dynamic_dom {
            dom.last_function_single_return = dom.function_shape_stack.pop().unwrap_or(false);
        }
    }

    impl_function_parent_accessors!();
}

impl_jsx_visit_mut!(AstDomTransform);
impl_jsx_visit_mut!(AstUniversalTransform);

// The SSR transform additionally tracks function scopes: Babel's SSR
// `createTemplate` hoists bare `var _v$;` declarations for expression-position
// JSX to the nearest enclosing function (`path.scope.push`), so the visitor
// needs enter/exit hooks on functions to collect and attach them.
impl<'a> VisitMut<'a> for AstSsrTransform<'a, '_> {
    fn visit_program(&mut self, program: &mut Program<'a>) {
        visit_program(self, program);
    }

    fn visit_statements(&mut self, statements: &mut ArenaVec<'a, Statement<'a>>) {
        visit_statements(self, statements);
    }

    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        if let Expression::CallExpression(call) = expression {
            let addr = iife_callee_addr(call);
            if let Some(addr) = addr {
                self.iife_callee_addrs.push(addr);
            }
            walk_mut::walk_expression(self, expression);
            if addr.is_some() {
                self.iife_callee_addrs.pop();
            }
            return;
        }
        visit_expression(self, expression);
    }

    fn visit_class_element(&mut self, class_element: &mut ClassElement<'a>) {
        visit_class_element(self, class_element);
    }

    fn visit_arrow_function_expression(
        &mut self,
        arrow: &mut oxc_ast::ast::ArrowFunctionExpression<'a>,
    ) {
        let pending_at_entry = self.pending_capture_name();
        self.function_parents().push(FunctionParentKind::Arrow);
        self.enter_function_bindings();
        // Parameter positions resolve var hoists *outside* the function
        // (Babel's `getPatternParent`).
        self.push_var_scope(crate::ssr::transform::VarScopeKind::Params);
        self.visit_formal_parameters(&mut arrow.params);
        self.pop_var_scope();
        let expression_body = arrow.is_expression();
        self.push_var_scope(if expression_body {
            // Babel's scope for an expression body is the arrow itself —
            // eligible for the anonymous-IIFE parameter fast path.
            crate::ssr::transform::VarScopeKind::ArrowExpression
        } else {
            crate::ssr::transform::VarScopeKind::FunctionBody
        });
        if expression_body {
            self.visit_expression(
                arrow
                    .get_expression_mut()
                    .expect("expression arrow has an expression body"),
            );
            if let Some(expression) = arrow.get_expression_mut() {
                lower_deferred_jsx_expression(self, expression);
            }
        } else {
            self.visit_function_body(
                arrow
                    .get_function_body_mut()
                    .expect("block arrow has a function body"),
            );
        }
        self.exit_function_bindings();
        if let Some(capture) = exit_function_scope(
            self,
            FunctionParentKind::Arrow,
            arrow.span,
            pending_at_entry,
        ) {
            ensure_arrow_block(self.allocator, arrow);
            let body = arrow
                .get_function_body_mut()
                .expect("ensure_arrow_block creates a function body");
            unshift_capture_into_body(self.allocator, body, capture);
        }
        if expression_body {
            let vars = self.pop_var_scope();
            self.attach_scope_vars_to_arrow(arrow, vars);
        } else {
            let body = arrow
                .get_function_body_mut()
                .expect("block arrow has a function body");
            self.attach_var_scope_to_statements(&mut body.statements);
        }
        self.mark_body_lowered(std::ptr::from_ref(&*arrow) as usize);
    }

    fn visit_function(
        &mut self,
        function: &mut oxc_ast::ast::Function<'a>,
        _flags: oxc_syntax::scope::ScopeFlags,
    ) {
        let kind = if self.take_next_function_class_method() {
            FunctionParentKind::ClassMethod
        } else {
            FunctionParentKind::Function
        };
        let pending_at_entry = self.pending_capture_name();
        self.function_parents().push(kind);
        self.enter_function_bindings();
        // Parameter positions resolve var hoists *outside* the function
        // (Babel's `getPatternParent`).
        self.push_var_scope(crate::ssr::transform::VarScopeKind::Params);
        self.visit_formal_parameters(&mut function.params);
        self.pop_var_scope();
        self.push_var_scope(crate::ssr::transform::VarScopeKind::FunctionBody);
        if let Some(body) = function.body.as_mut() {
            self.visit_function_body(body);
        }
        self.exit_function_bindings();
        if let Some(capture) = exit_function_scope(self, kind, function.span, pending_at_entry)
            && let Some(body) = function.body.as_mut()
        {
            unshift_capture_into_body(self.allocator, body, capture);
        }
        if let Some(body) = function.body.as_mut() {
            self.attach_var_scope_to_statements(&mut body.statements);
        } else {
            self.pop_var_scope();
        }
        self.mark_body_lowered(std::ptr::from_ref(&*function) as usize);
    }

    fn visit_block_statement(&mut self, block: &mut oxc_ast::ast::BlockStatement<'a>) {
        // Babel's `Scope.push` targets the nearest block parent, so plain
        // blocks (if/loop/catch bodies, naked blocks) receive their own
        // hoisted `var` declarations.
        self.push_var_scope(crate::ssr::transform::VarScopeKind::Block);
        walk_mut::walk_block_statement(self, block);
        self.attach_var_scope_to_statements(&mut block.body);
    }

    fn visit_static_block(&mut self, block: &mut oxc_ast::ast::StaticBlock<'a>) {
        // `var`s inside a class static block don't hoist past it.
        self.enter_function_bindings();
        self.push_var_scope(crate::ssr::transform::VarScopeKind::StaticBlock);
        walk_mut::walk_static_block(self, block);
        self.attach_var_scope_to_statements(&mut block.body);
        self.exit_function_bindings();
    }

    fn visit_switch_statement(&mut self, statement: &mut oxc_ast::ast::SwitchStatement<'a>) {
        // Marker frame: pushes inside a switch route to the function parent
        // (Babel's `if (path.isSwitchStatement())` rule).
        self.push_var_scope(crate::ssr::transform::VarScopeKind::Switch);
        walk_mut::walk_switch_statement(self, statement);
        self.pop_var_scope();
    }

    // Loops are block parents in Babel's scope model: a `var` hoisted from a
    // loop head or a single-statement body lands in a (blockified) body block
    // rather than the enclosing function.
    fn visit_for_statement(&mut self, statement: &mut oxc_ast::ast::ForStatement<'a>) {
        self.push_var_scope(crate::ssr::transform::VarScopeKind::Block);
        walk_mut::walk_for_statement(self, statement);
        self.attach_var_scope_to_loop_body(&mut statement.body);
    }

    fn visit_for_in_statement(&mut self, statement: &mut oxc_ast::ast::ForInStatement<'a>) {
        self.push_var_scope(crate::ssr::transform::VarScopeKind::Block);
        walk_mut::walk_for_in_statement(self, statement);
        self.attach_var_scope_to_loop_body(&mut statement.body);
    }

    fn visit_for_of_statement(&mut self, statement: &mut oxc_ast::ast::ForOfStatement<'a>) {
        self.push_var_scope(crate::ssr::transform::VarScopeKind::Block);
        walk_mut::walk_for_of_statement(self, statement);
        self.attach_var_scope_to_loop_body(&mut statement.body);
    }

    fn visit_while_statement(&mut self, statement: &mut oxc_ast::ast::WhileStatement<'a>) {
        self.push_var_scope(crate::ssr::transform::VarScopeKind::Block);
        walk_mut::walk_while_statement(self, statement);
        self.attach_var_scope_to_loop_body(&mut statement.body);
    }

    fn visit_do_while_statement(&mut self, statement: &mut oxc_ast::ast::DoWhileStatement<'a>) {
        self.push_var_scope(crate::ssr::transform::VarScopeKind::Block);
        walk_mut::walk_do_while_statement(self, statement);
        self.attach_var_scope_to_loop_body(&mut statement.body);
    }
}
