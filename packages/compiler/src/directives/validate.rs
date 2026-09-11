//! Compile-time closure-capture validation for function-level `"use server"`
//! functions.
//!
//! An extracted server function runs in a different closure environment than
//! the one it was written in: on the server it is hoisted to module top
//! level, on the client it is replaced by a network proxy. Either way, any
//! variable captured from an *intermediate* scope — declared between module
//! top level and the server function itself — silently reads garbage (or
//! simply doesn't exist) at runtime. This pass rejects those captures at
//! compile time instead.
//!
//! A function-level server function may only reference:
//!
//! - its own parameters and locals (including nested function scopes within
//!   it),
//! - module top-level bindings (imports, top-level `const`/`let`/`var`/
//!   `function`/`class`),
//! - true globals / unresolved references.
//!
//! `this` and `arguments` are the same problem without a declaration to
//! point at. An arrow takes both from its enclosing function, so an arrow
//! marked `"use server"` reads them from wherever it lands. Hoisted to
//! module top level that is `undefined` for `this` and nothing at all for
//! `arguments`, so both are rejected too. A marked `function` binds its own,
//! and so does any `function` or class nested inside the server function, so
//! those are left alone.
//!
//! The pass also rejects the directive in a position the transform never
//! extracts. A method, a getter, or a setter keeps its directive and keeps
//! running wherever it is called, browser included, so a directive there is
//! silently doing nothing. That is reported rather than ignored.
//!
//! Module-level directives are unaffected (the whole module runs on the
//! server, so its closures are intact); the caller skips this pass for them.
//! Eligibility otherwise mirrors the transform exactly, and directives
//! nested inside an already-extracted server function are ignored just like
//! the transform ignores them.

use oxc_ast::ast::{Expression, Program, PropertyKind};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_span::Span;
use oxc_syntax::scope::ScopeId;

/// Validates every function-level server function in `program`, returning a
/// human-readable error for the first invalid capture. Must run on the
/// original (untransformed) AST.
pub(crate) fn validate_captures(
    program: &Program<'_>,
    code: &str,
    filename: &str,
    directive: &str,
) -> Result<(), String> {
    // Cheap gate: the directive has to appear literally somewhere.
    if !code.contains(directive) {
        return Ok(());
    }

    // Populates the scope_id / reference_id cells the validator reads.
    let semantic = SemanticBuilder::new().build(program).semantic;

    let mut validator = CaptureValidator {
        scoping: semantic.scoping(),
        directive,
        server_scope: None,
        binds_own_this: false,
        error: None,
    };
    validator.visit_program(program);

    match validator.error {
        Some(error) => Err(format_error(error, code, filename, directive)),
        None => Ok(()),
    }
}

enum CaptureError {
    /// A named binding from an intermediate enclosing scope.
    Binding {
        name: String,
        reference_span: Span,
        declaration_span: Span,
        declared_in_function: bool,
    },
    /// `this` or `arguments`, taken from an enclosing function because the
    /// server function is an arrow. There is no declaration to point at.
    Implicit { name: Implicit, span: Span },
    /// The directive sits on a method, getter, or setter, which the
    /// transform never extracts.
    Method { name: String, span: Span },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Implicit {
    This,
    Arguments,
}

impl Implicit {
    fn name(self) -> &'static str {
        match self {
            Implicit::This => "this",
            Implicit::Arguments => "arguments",
        }
    }

    /// What the reference resolves to once the function sits at module top
    /// level, and the way out.
    fn explanation(self) -> &'static str {
        match self {
            Implicit::This => {
                "where `this` is undefined. Pass the value in as a parameter instead"
            }
            Implicit::Arguments => {
                "where `arguments` does not exist. Declare a rest parameter instead"
            }
        }
    }
}

fn format_error(error: CaptureError, code: &str, filename: &str, directive: &str) -> String {
    match error {
        CaptureError::Binding {
            name,
            reference_span,
            declaration_span,
            declared_in_function,
        } => {
            let (line, column) = line_column(code, reference_span.start);
            let (decl_line, decl_column) = line_column(code, declaration_span.start);
            let scope_kind = if declared_in_function {
                "function"
            } else {
                "block"
            };
            format!(
                "{filename}:{line}:{column}: server functions cannot capture non-top-level variables: \
                 `{name}` is declared in an enclosing {scope_kind} (at {filename}:{decl_line}:{decl_column}). \
                 Server functions may only reference their own parameters and locals, module top-level \
                 bindings, imports, and globals.",
            )
        }
        CaptureError::Implicit { name, span } => {
            let (line, column) = line_column(code, span.start);
            format!(
                "{filename}:{line}:{column}: server functions cannot capture `{implicit}` from an \
                 enclosing function: this one is an arrow, so it is extracted to module top level \
                 {explanation}.",
                implicit = name.name(),
                explanation = name.explanation(),
            )
        }
        CaptureError::Method { name, span } => {
            let (line, column) = line_column(code, span.start);
            format!(
                "{filename}:{line}:{column}: a \"{directive}\" directive has no effect on a method: \
                 {name} is not extracted, so its body would still run wherever it is called, \
                 including in the browser. Assign a function to a property instead.",
            )
        }
    }
}

/// 1-based line/column for a byte offset.
fn line_column(code: &str, offset: u32) -> (usize, usize) {
    let offset = (offset as usize).min(code.len());
    let before = &code[..offset];
    let line = before.matches('\n').count() + 1;
    let column = before
        .rfind('\n')
        .map(|newline| offset - newline)
        .unwrap_or(offset + 1);
    (line, column)
}

struct CaptureValidator<'s> {
    scoping: &'s Scoping,
    directive: &'s str,
    /// Scope of the server function currently being validated. Directives
    /// nested inside it are not extracted by the transform, so no stack is
    /// needed — the outermost eligible function wins.
    server_scope: Option<ScopeId>,
    /// Whether `this` and `arguments` at the current position are bound by a
    /// `function` or class inside the server function. False means they come
    /// from outside it and would not survive extraction. Only meaningful
    /// while `server_scope` is set.
    binds_own_this: bool,
    error: Option<CaptureError>,
}

impl CaptureValidator<'_> {
    fn body_has_directive(&self, body: &oxc_ast::ast::FunctionBody<'_>) -> bool {
        body.directives
            .iter()
            .any(|directive| directive.expression.value == self.directive)
    }

    fn enter_server_scope(
        &mut self,
        scope: Option<ScopeId>,
        binds_own_this: bool,
        walk: impl FnOnce(&mut Self),
    ) {
        if self.server_scope.is_some() || scope.is_none() {
            // Already validating an enclosing server function (nested
            // directives are ignored by the transform), or semantic did not
            // assign a scope (unreachable for valid programs).
            walk(self);
            return;
        }
        self.server_scope = scope;
        self.binds_own_this = binds_own_this;
        walk(self);
        self.server_scope = None;
        self.binds_own_this = false;
    }

    /// Walks a subtree that binds its own `this` and `arguments`, restoring
    /// the previous state afterwards. Nested arrows within it keep inheriting
    /// from it, which is exactly the flag staying true.
    fn with_own_this(&mut self, walk: impl FnOnce(&mut Self)) {
        let previous = std::mem::replace(&mut self.binds_own_this, true);
        walk(self);
        self.binds_own_this = previous;
    }

    /// Reports `this` or `arguments` read from outside the server function.
    fn check_implicit(&mut self, name: Implicit, span: Span) {
        if self.error.is_some() || self.server_scope.is_none() || self.binds_own_this {
            return;
        }
        self.error = Some(CaptureError::Implicit { name, span });
    }

    /// Reports a directive sitting on a method, getter, or setter. Skipped
    /// inside an already-extracted server function: that whole body ships to
    /// the server, so a directive within it changes nothing.
    fn check_method_directive(
        &mut self,
        body: Option<&oxc_ast::ast::FunctionBody<'_>>,
        key: &oxc_ast::ast::PropertyKey<'_>,
        span: Span,
    ) {
        if self.error.is_some() || self.server_scope.is_some() {
            return;
        }
        if !body.is_some_and(|body| self.body_has_directive(body)) {
            return;
        }
        let name = key
            .static_name()
            .map(|name| format!("`{name}`"))
            .unwrap_or_else(|| "this method".to_string());
        self.error = Some(CaptureError::Method { name, span });
    }

    fn check_reference(&mut self, identifier: &oxc_ast::ast::IdentifierReference<'_>) {
        if self.error.is_some() {
            return;
        }
        let Some(server_scope) = self.server_scope else {
            return;
        };
        let Some(reference_id) = identifier.reference_id.get() else {
            return;
        };
        let reference = self.scoping.get_reference(reference_id);
        // Type-only references (`typeof x` in TS type positions) are erased
        // from the output and never captured.
        if !reference.flags().is_value() {
            return;
        }
        let Some(symbol_id) = reference.symbol_id() else {
            // Unresolved: a true global, or the implicit `arguments` of an
            // enclosing function. A declared binding named `arguments` has a
            // symbol and falls through to the scope walk below.
            if identifier.name == "arguments" {
                self.check_implicit(Implicit::Arguments, identifier.span);
            }
            return;
        };
        let declaration_scope = self.scoping.symbol_scope_id(symbol_id);
        if declaration_scope == self.scoping.root_scope_id() {
            // Module top level: imports, top-level declarations.
            return;
        }
        // Walk up from the declaration scope; hitting the server function's
        // scope means the binding lives inside it (params, locals, nested
        // functions). Reaching the root without passing it means the binding
        // belongs to an intermediate enclosing scope — the invalid capture.
        let mut scope = declaration_scope;
        loop {
            if scope == server_scope {
                return;
            }
            match self.scoping.scope_parent_id(scope) {
                Some(parent) => scope = parent,
                None => break,
            }
        }
        self.error = Some(CaptureError::Binding {
            name: identifier.name.to_string(),
            reference_span: identifier.span,
            declaration_span: self.scoping.symbol_span(symbol_id),
            declared_in_function: self.scoping.scope_flags(declaration_scope).is_function(),
        });
    }
}

impl<'a> Visit<'a> for CaptureValidator<'_> {
    fn visit_identifier_reference(&mut self, it: &oxc_ast::ast::IdentifierReference<'a>) {
        self.check_reference(it);
    }

    fn visit_expression(&mut self, expression: &Expression<'a>) {
        if self.error.is_some() {
            return;
        }
        // Mirrors the transform's eligibility: arrows with block bodies and
        // function expressions in expression position.
        let marked = match expression {
            Expression::ArrowFunctionExpression(arrow) if !arrow.is_expression() => arrow
                .get_function_body()
                .is_some_and(|body| self.body_has_directive(body)),
            Expression::FunctionExpression(function) => function
                .body
                .as_ref()
                .is_some_and(|body| self.body_has_directive(body)),
            _ => false,
        };
        if marked {
            // A marked `function` binds its own `this`/`arguments` and takes
            // them with it; a marked arrow reads them from where it was
            // written, which extraction leaves behind.
            let (scope, binds_own_this) = match expression {
                Expression::ArrowFunctionExpression(arrow) => (arrow.scope_id.get(), false),
                Expression::FunctionExpression(function) => (function.scope_id.get(), true),
                _ => unreachable!("shape checked above"),
            };
            self.enter_server_scope(scope, binds_own_this, |validator| {
                walk::walk_expression(validator, expression);
            });
            return;
        }
        walk::walk_expression(self, expression);
    }

    /// Function declarations are bubbled into `const` function expressions
    /// by the transform, so a marked declaration is extracted — validate it.
    fn visit_function(
        &mut self,
        function: &oxc_ast::ast::Function<'a>,
        flags: oxc_syntax::scope::ScopeFlags,
    ) {
        if self.error.is_some() {
            return;
        }
        let marked = function.is_declaration()
            && function
                .body
                .as_ref()
                .is_some_and(|body| self.body_has_directive(body));
        if marked {
            self.enter_server_scope(function.scope_id.get(), true, |validator| {
                walk::walk_function(validator, function, flags);
            });
            return;
        }
        // Any other `function` reached from inside a server function binds
        // its own `this` and `arguments` for everything below it.
        self.with_own_this(|validator| {
            walk::walk_function(validator, function, flags);
        });
    }

    /// A class body rebinds `this` for its methods, field initializers, and
    /// static blocks, so nothing inside one is an escaping capture.
    fn visit_class(&mut self, class: &oxc_ast::ast::Class<'a>) {
        self.with_own_this(|validator| {
            walk::walk_class(validator, class);
        });
    }

    fn visit_this_expression(&mut self, this: &oxc_ast::ast::ThisExpression) {
        self.check_implicit(Implicit::This, this.span);
    }

    /// `{ foo() {} }` object methods and `{ get x() {} }` accessors are
    /// never extracted by the transform, so a directive on one is reported.
    /// Nested eligible functions inside them are still validated.
    fn visit_object_property(&mut self, property: &oxc_ast::ast::ObjectProperty<'a>) {
        if property.method || property.kind != PropertyKind::Init {
            if let Expression::FunctionExpression(function) = &property.value {
                self.check_method_directive(
                    function.body.as_deref(),
                    &property.key,
                    property.span,
                );
            }
            if self.error.is_some() {
                return;
            }
            self.visit_property_key(&property.key);
            match &property.value {
                Expression::FunctionExpression(function) => {
                    self.with_own_this(|validator| {
                        walk::walk_function(
                            validator,
                            function,
                            oxc_syntax::scope::ScopeFlags::Function,
                        );
                    });
                }
                other => self.visit_expression(other),
            }
            return;
        }
        walk::walk_object_property(self, property);
    }

    /// Class methods, constructors, getters and setters are never extracted
    /// either.
    fn visit_method_definition(&mut self, method: &oxc_ast::ast::MethodDefinition<'a>) {
        self.check_method_directive(method.value.body.as_deref(), &method.key, method.span);
        if self.error.is_some() {
            return;
        }
        walk::walk_method_definition(self, method);
    }
}
