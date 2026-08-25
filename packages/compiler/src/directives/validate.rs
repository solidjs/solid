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
//! Module-level directives are unaffected (the whole module runs on the
//! server, so its closures are intact); the caller skips this pass for them.
//! Eligibility mirrors the transform exactly: functions the transform would
//! never extract (object/class methods, getters/setters) are not validated,
//! and directives nested inside an already-extracted server function are
//! ignored just like the transform ignores them.

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
        error: None,
    };
    validator.visit_program(program);

    match validator.error {
        Some(error) => Err(format_error(error, code, filename)),
        None => Ok(()),
    }
}

struct CaptureError {
    name: String,
    reference_span: Span,
    declaration_span: Span,
    declared_in_function: bool,
}

fn format_error(error: CaptureError, code: &str, filename: &str) -> String {
    let (line, column) = line_column(code, error.reference_span.start);
    let (decl_line, decl_column) = line_column(code, error.declaration_span.start);
    let scope_kind = if error.declared_in_function {
        "function"
    } else {
        "block"
    };
    format!(
        "{filename}:{line}:{column}: server functions cannot capture non-top-level variables: \
         `{name}` is declared in an enclosing {scope_kind} (at {filename}:{decl_line}:{decl_column}). \
         Server functions may only reference their own parameters and locals, module top-level \
         bindings, imports, and globals.",
        name = error.name,
    )
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
    error: Option<CaptureError>,
}

impl CaptureValidator<'_> {
    fn body_has_directive(&self, body: &oxc_ast::ast::FunctionBody<'_>) -> bool {
        body.directives
            .iter()
            .any(|directive| directive.expression.value == self.directive)
    }

    fn enter_server_scope(&mut self, scope: Option<ScopeId>, walk: impl FnOnce(&mut Self)) {
        if self.server_scope.is_some() || scope.is_none() {
            // Already validating an enclosing server function (nested
            // directives are ignored by the transform), or semantic did not
            // assign a scope (unreachable for valid programs).
            walk(self);
            return;
        }
        self.server_scope = scope;
        walk(self);
        self.server_scope = None;
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
            // Unresolved: a true global.
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
        self.error = Some(CaptureError {
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
            let scope = match expression {
                Expression::ArrowFunctionExpression(arrow) => arrow.scope_id.get(),
                Expression::FunctionExpression(function) => function.scope_id.get(),
                _ => unreachable!("shape checked above"),
            };
            self.enter_server_scope(scope, |validator| {
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
            self.enter_server_scope(function.scope_id.get(), |validator| {
                walk::walk_function(validator, function, flags);
            });
            return;
        }
        walk::walk_function(self, function, flags);
    }

    /// Same carve-out as the transform: `{ foo() {} }` object methods (and
    /// getters/setters) are never extracted, so their directives are not
    /// validated — but nested eligible functions inside them still are.
    fn visit_object_property(&mut self, property: &oxc_ast::ast::ObjectProperty<'a>) {
        if property.method || property.kind != PropertyKind::Init {
            self.visit_property_key(&property.key);
            match &property.value {
                Expression::FunctionExpression(function) => {
                    walk::walk_function(self, function, oxc_syntax::scope::ScopeFlags::Function);
                }
                other => self.visit_expression(other),
            }
            return;
        }
        walk::walk_object_property(self, property);
    }
}
