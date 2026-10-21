//! Compile-time capture rule for `broadcast(fn)`.
//!
//! A broadcast server function's outer body runs once per caller (auth
//! gates, redirects), but the component it returns is rendered once and
//! shared by every caller with the same arguments. Whatever that component
//! reads from the outer body is therefore the *first* caller's value, shown
//! to everyone: `const user = await getUser(); return () => <p>{user.name}</p>`
//! leaks one viewer's data to the rest. It is also frozen, since the outer
//! body never re-runs for the shared render.
//!
//! So the returned component (and any local function it reaches) may only
//! read the server function's parameters (the share key), its own locals,
//! and module scope. Anything else from the outer body is rejected.
//!
//! What a call into imported code reads at runtime is out of reach here; the
//! shared render's own request event covers that in dev.

use std::collections::HashSet;

use oxc_ast::AstKind;
use oxc_ast::ast::{
    Expression, FormalParameters, FunctionBody, ImportDeclarationSpecifier, Program, Statement,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{Semantic, SemanticBuilder};
use oxc_span::GetSpan;
use oxc_syntax::scope::ScopeId;
use oxc_syntax::symbol::SymbolId;

use super::validate::line_column;

const BROADCAST: &str = "broadcast";

/// Checks every function passed to `broadcast` imported from one of the
/// runtime `sources`, returning a
/// human-readable error for the first outer-body read.
pub(crate) fn validate_broadcast_captures(
    program: &Program<'_>,
    code: &str,
    filename: &str,
    sources: &[&str],
) -> Result<(), String> {
    if !code.contains(BROADCAST) {
        return Ok(());
    }
    // Imported from the runtime under its own name, possibly renamed:
    // `import { broadcast as shared } from "@solidjs/web/server-functions"`.
    let specifiers = || {
        program
            .body
            .iter()
            .filter_map(|statement| match statement {
                Statement::ImportDeclaration(import)
                    if sources.contains(&import.source.value.as_str()) =>
                {
                    import.specifiers.as_ref()
                }
                _ => None,
            })
            .flatten()
            .filter_map(|specifier| match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(named)
                    if named.imported.name() == BROADCAST =>
                {
                    Some(&named.local)
                }
                _ => None,
            })
    };
    if specifiers().next().is_none() {
        return Ok(());
    }
    // Populates the symbol and reference cells read below; nodes are needed
    // to find a binding's declaration.
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .build(program)
        .semantic;
    let callees: HashSet<SymbolId> = specifiers()
        .filter_map(|local| local.symbol_id.get())
        .collect();

    let mut finder = BroadcastFinder {
        semantic: &semantic,
        callees,
        code,
        filename,
        error: None,
    };
    finder.visit_program(program);
    match finder.error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

struct BroadcastFinder<'s, 'a> {
    semantic: &'s Semantic<'a>,
    callees: HashSet<SymbolId>,
    code: &'s str,
    filename: &'s str,
    error: Option<String>,
}

/// A function handed to `broadcast`: its scope, parameters and body.
struct Target<'b, 'a> {
    scope: ScopeId,
    params: &'b FormalParameters<'a>,
    /// A block body's statements.
    body: Option<&'b FunctionBody<'a>>,
    /// An expression-bodied arrow's value.
    value: Option<&'b Expression<'a>>,
}

fn target_of<'b, 'a>(expression: &'b Expression<'a>) -> Option<Target<'b, 'a>> {
    match expression {
        Expression::ArrowFunctionExpression(arrow) => Some(Target {
            scope: arrow.scope_id.get()?,
            params: &arrow.params,
            body: arrow.get_function_body(),
            value: arrow.get_expression(),
        }),
        Expression::FunctionExpression(function) => Some(Target {
            scope: function.scope_id.get()?,
            params: &function.params,
            body: Some(function.body.as_deref()?),
            value: None,
        }),
        _ => None,
    }
}

impl<'s, 'a> BroadcastFinder<'s, 'a> {
    /// The function a binding is declared as: `function f() {}` or
    /// `const f = () => {}`.
    fn declared_function(&self, symbol: SymbolId) -> Option<Target<'a, 'a>> {
        match self.semantic.symbol_declaration(symbol).kind() {
            AstKind::Function(function) => Some(Target {
                scope: function.scope_id.get()?,
                params: &function.params,
                body: Some(function.body.as_deref()?),
                value: None,
            }),
            AstKind::VariableDeclarator(declarator) => target_of(declarator.init.as_ref()?),
            _ => None,
        }
    }

    /// A function written inline, or named by a binding declared as one.
    fn function_of<'b>(&self, expression: &'b Expression<'a>) -> Option<Target<'b, 'a>>
    where
        'a: 'b,
    {
        if let Expression::Identifier(identifier) = expression {
            return self
                .resolve(identifier)
                .and_then(|symbol| self.declared_function(symbol));
        }
        target_of(expression)
    }

    fn resolve(&self, identifier: &oxc_ast::ast::IdentifierReference<'_>) -> Option<SymbolId> {
        let reference = identifier.reference_id.get()?;
        self.semantic.scoping().get_reference(reference).symbol_id()
    }

    fn within(&self, scope: ScopeId, ancestor: ScopeId) -> bool {
        self.semantic
            .scoping()
            .scope_ancestors(scope)
            .any(|scope| scope == ancestor)
    }

    fn check(&mut self, target: &Target<'_, 'a>) {
        let scoping = self.semantic.scoping();
        let params: HashSet<SymbolId> = target
            .params
            .iter_bindings()
            .flat_map(|pattern| pattern.get_binding_identifiers())
            .filter_map(|binding| binding.symbol_id.get())
            .collect();

        // The components the body returns.
        let mut queue: Vec<ScopeId> = vec![];
        for expression in returned(target) {
            if let Some(component) = self.function_of(expression)
                && self.within(component.scope, target.scope)
            {
                queue.push(component.scope);
            }
        }

        // Every outer-body binding a component (or a local function it
        // reaches) reads.
        let mut seen = HashSet::new();
        while let Some(component) = queue.pop() {
            if !seen.insert(component) {
                continue;
            }
            for symbol in scoping.symbol_ids() {
                let declared = scoping.symbol_scope_id(symbol);
                if !self.within(declared, target.scope)
                    || self.within(declared, component)
                    || params.contains(&symbol)
                {
                    continue;
                }
                for &reference_id in scoping.get_resolved_reference_ids(symbol) {
                    let reference = scoping.get_reference(reference_id);
                    if !reference.flags().is_value()
                        || !self.within(reference.scope_id(), component)
                    {
                        continue;
                    }
                    if let Some(function) = self.declared_function(symbol) {
                        queue.push(function.scope);
                        continue;
                    }
                    let span = self
                        .semantic
                        .nodes()
                        .get_node(reference.node_id())
                        .kind()
                        .span();
                    let (line, column) = line_column(self.code, span.start);
                    let (decl_line, decl_column) =
                        line_column(self.code, scoping.symbol_span(symbol).start);
                    let filename = self.filename;
                    self.error = Some(format!(
                        "{filename}:{line}:{column}: a broadcast() render cannot read `{name}` from \
                         its server function's body (declared at {filename}:{decl_line}:{decl_column}). \
                         The render is shared by every caller with the same arguments, but the body \
                         runs per caller, so it would show the first caller's value to everyone. Read \
                         it inside the returned component, or pass it in as an argument.",
                        name = scoping.symbol_name(symbol),
                    ));
                    return;
                }
            }
        }
    }
}

/// The values a function body returns, not looking into nested functions.
fn returned<'b, 'a>(target: &Target<'b, 'a>) -> Vec<&'b Expression<'a>> {
    let mut found = vec![];
    found.extend(target.value);
    for statement in target.body.iter().flat_map(|body| &body.statements) {
        returns_in(statement, &mut found);
    }
    found
}

fn returns_in<'b, 'a>(statement: &'b Statement<'a>, found: &mut Vec<&'b Expression<'a>>) {
    match statement {
        Statement::ReturnStatement(statement) => found.extend(statement.argument.as_ref()),
        Statement::BlockStatement(block) => {
            block
                .body
                .iter()
                .for_each(|statement| returns_in(statement, found));
        }
        Statement::IfStatement(statement) => {
            returns_in(&statement.consequent, found);
            if let Some(alternate) = &statement.alternate {
                returns_in(alternate, found);
            }
        }
        Statement::TryStatement(statement) => {
            statement
                .block
                .body
                .iter()
                .for_each(|statement| returns_in(statement, found));
            if let Some(handler) = &statement.handler {
                handler
                    .body
                    .body
                    .iter()
                    .for_each(|statement| returns_in(statement, found));
            }
            if let Some(finalizer) = &statement.finalizer {
                finalizer
                    .body
                    .iter()
                    .for_each(|statement| returns_in(statement, found));
            }
        }
        Statement::SwitchStatement(statement) => {
            for case in &statement.cases {
                case.consequent
                    .iter()
                    .for_each(|statement| returns_in(statement, found));
            }
        }
        _ => {}
    }
}

impl<'a> Visit<'a> for BroadcastFinder<'_, 'a> {
    fn visit_call_expression(&mut self, call: &oxc_ast::ast::CallExpression<'a>) {
        if self.error.is_some() {
            return;
        }
        let is_broadcast = matches!(&call.callee, Expression::Identifier(callee)
            if self.resolve(callee).is_some_and(|symbol| self.callees.contains(&symbol)));
        if is_broadcast
            && let Some(argument) = call
                .arguments
                .first()
                .and_then(|argument| argument.as_expression())
            && let Some(target) = self.function_of(argument)
        {
            self.check(&target);
        }
        if self.error.is_none() {
            walk::walk_call_expression(self, call);
        }
    }
}
