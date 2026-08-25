//! `lazy()` module-URL pass, ported from the Babel implementation in
//! vite-plugin-solid (`src/lazy-module-url.ts`). Detects
//! `lazy(() => import("specifier"))` calls where `lazy` is a named import
//! from `solid-js` and appends a placeholder string argument
//! (`"__SOLID_LAZY_MODULE__:<specifier>"`). The placeholder format is a
//! frozen contract: the bundler plugin's `resolveLazyModuleUrls` regex
//! (`"__SOLID_LAZY_MODULE__:([^"]+)"`) rewrites it to a resolved
//! project-relative path afterwards — that half stays in the plugin.
//!
//! The same pass recognizes `clientOnly(() => import("specifier"))` where
//! `clientOnly` is a named import from `@solidjs/web`, so the server half
//! can emit early modulepreload hints for the browser-only module.
//!
//! Both runtimes take an options bag in second position (`lazy`'s
//! `{ export }`, `clientOnly`'s `{ lazy, export }`), so the placeholder is
//! appended as a *third* argument, padding the options slot with `void 0`
//! when the call site omits it — the runtime's `moduleUrl` parameter is
//! positionally stable either way.

use crate::shared::ast_builder::AstBuilder;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, CallExpression, Expression, ImportDeclarationSpecifier, Program, Statement,
};
use oxc_ast_visit::{Visit, VisitMut, walk, walk_mut};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::{ParseOptions, Parser};
use oxc_semantic::SemanticBuilder;
use oxc_span::{GetSpan, Span};

use crate::config::{TransformResult, source_type_for_filename};

pub const LAZY_PLACEHOLDER_PREFIX: &str = "__SOLID_LAZY_MODULE__:";

#[napi(object)]
#[derive(Default)]
pub struct TransformLazyOptions {
    /// Mirrors the Babel plugin: without a filename the pass is a no-op
    /// (the placeholder is only useful to a bundler resolving relative to a
    /// module id).
    pub filename: Option<String>,
    pub source_map: Option<bool>,
}

pub fn transform_lazy(
    code: String,
    options: Option<TransformLazyOptions>,
) -> Result<TransformResult> {
    let options = options.unwrap_or_default();
    let Some(filename) = options.filename.as_deref() else {
        return Ok(TransformResult { code, map: None });
    };

    let source_type = source_type_for_filename(Some(filename))?;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &code, source_type)
        .with_options(ParseOptions {
            preserve_parens: false,
            ..ParseOptions::default()
        })
        .parse();
    if let Some(error) = crate::shared::parser::first_parser_error(parsed.diagnostics) {
        return Err(Error::from_reason(error));
    }

    let mut program = parsed.program;
    let targets = collect_targets(&program);
    if targets.is_empty() {
        // Nothing matched: hand back the input untouched instead of a
        // reprint (the Babel support pass reprints regardless, but callers
        // only care about the placeholder injection).
        return Ok(TransformResult { code, map: None });
    }

    let mut rewriter = Rewriter {
        allocator: &allocator,
        targets,
    };
    rewriter.visit_program(&mut program);

    let build = Codegen::new()
        .with_options(CodegenOptions {
            source_map_path: options
                .source_map
                .unwrap_or(false)
                .then(|| std::path::PathBuf::from(filename)),
            ..CodegenOptions::default()
        })
        .build(&program);

    Ok(TransformResult {
        code: build.code,
        map: build.map.map(|map| map.to_json_string()),
    })
}

/// A matched call: where it is, the import specifier to encode, and whether
/// the options slot needs a `void 0` filler before the placeholder
/// (`clientOnly(fn)` with no options bag).
struct Target {
    span: Span,
    specifier: String,
    pad_options: bool,
}

/// A `Target` for every eligible `lazy(...)` / `clientOnly(...)` call.
/// Eligibility mirrors the Babel plugin exactly:
/// - callee is the bare identifier `lazy` (resp. `clientOnly`),
/// - it resolves to a *named* import specifier whose declaration imports
///   from `solid-js` (resp. `@solidjs/web`) — local shadowing wins;
///   default/namespace imports and aliased locals don't match because the
///   callee must be spelled with the canonical name,
/// - the first argument is a function/arrow whose body is directly
///   `import("literal")` (or a block whose sole statement returns one),
/// - the call takes one argument (options omitted — the placeholder needs a
///   `void 0` filler) or two (the second being the options bag). More
///   arguments mean the call is already annotated and is left untouched.
fn collect_targets(program: &Program<'_>) -> Vec<Target> {
    let semantic = SemanticBuilder::new().build(program).semantic;
    let scoping = semantic.scoping();

    // Locals bound by named import specifiers, per recognized source.
    let mut lazy_symbols: std::collections::HashSet<oxc_semantic::SymbolId> =
        std::collections::HashSet::new();
    let mut client_only_symbols: std::collections::HashSet<oxc_semantic::SymbolId> =
        std::collections::HashSet::new();
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else {
            continue;
        };
        let set = match import.source.value.as_str() {
            "solid-js" => &mut lazy_symbols,
            "@solidjs/web" => &mut client_only_symbols,
            _ => continue,
        };
        for specifier in import.specifiers.iter().flatten() {
            if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier
                && let Some(symbol_id) = specifier.local.symbol_id.get()
            {
                set.insert(symbol_id);
            }
        }
    }
    if lazy_symbols.is_empty() && client_only_symbols.is_empty() {
        return Vec::new();
    }

    struct Collector<'s> {
        scoping: &'s oxc_semantic::Scoping,
        lazy_symbols: &'s std::collections::HashSet<oxc_semantic::SymbolId>,
        client_only_symbols: &'s std::collections::HashSet<oxc_semantic::SymbolId>,
        targets: &'s mut Vec<Target>,
    }

    impl<'b> Visit<'b> for Collector<'_> {
        fn visit_call_expression(&mut self, call: &CallExpression<'b>) {
            if let Some(target) = eligible_target(
                self.scoping,
                self.lazy_symbols,
                self.client_only_symbols,
                call,
            ) {
                self.targets.push(target);
            }
            walk::walk_call_expression(self, call);
        }
    }

    let mut targets = Vec::new();
    let mut collector = Collector {
        scoping,
        lazy_symbols: &lazy_symbols,
        client_only_symbols: &client_only_symbols,
        targets: &mut targets,
    };
    collector.visit_program(program);
    targets
}

fn eligible_target(
    scoping: &oxc_semantic::Scoping,
    lazy_symbols: &std::collections::HashSet<oxc_semantic::SymbolId>,
    client_only_symbols: &std::collections::HashSet<oxc_semantic::SymbolId>,
    call: &CallExpression<'_>,
) -> Option<Target> {
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    let eligible = match callee.name.as_str() {
        "lazy" => lazy_symbols,
        "clientOnly" => client_only_symbols,
        _ => return None,
    };
    let symbol = callee
        .reference_id
        .get()
        .and_then(|id| scoping.get_reference(id).symbol_id())?;
    if !eligible.contains(&symbol) {
        return None;
    }
    // Babel: bail on more arguments than the bare form takes (already
    // annotated) and on 0 arguments.
    if call.arguments.is_empty() || call.arguments.len() > 2 {
        return None;
    }
    // A spread in the options slot hides the real arity — leave it alone.
    if call.arguments.len() == 2 && call.arguments[1].as_expression().is_none() {
        return None;
    }
    let argument = call.arguments[0].as_expression()?;
    let specifier = extract_dynamic_import_specifier(argument)?;
    Some(Target {
        span: call.span,
        specifier,
        // The placeholder always lands in the third slot; a callsite
        // without an options bag gets `void 0` filler.
        pad_options: call.arguments.len() == 1,
    })
}

/// The Babel plugin's `extractDynamicImportSpecifier`: matches
/// `() => import("x")`, `() => { return import("x"); }`, and the
/// `function` equivalents, returning the literal specifier.
fn extract_dynamic_import_specifier(node: &Expression<'_>) -> Option<String> {
    let import = match node {
        Expression::ArrowFunctionExpression(arrow) if arrow.is_expression() => {
            arrow.get_expression()?
        }
        Expression::ArrowFunctionExpression(arrow) => {
            let body = arrow.get_function_body()?;
            if body.statements.len() != 1 {
                return None;
            }
            match body.statements.first()? {
                Statement::ReturnStatement(statement) => statement.argument.as_ref()?,
                _ => return None,
            }
        }
        Expression::FunctionExpression(function) => {
            let body = function.body.as_ref()?;
            if body.statements.len() != 1 {
                return None;
            }
            match body.statements.first()? {
                Statement::ReturnStatement(statement) => statement.argument.as_ref()?,
                _ => return None,
            }
        }
        _ => return None,
    };
    let Expression::ImportExpression(import) = import else {
        return None;
    };
    // Babel sees `import(x)` as a call with one argument; `import(x, opts)`
    // has two and is skipped (`options` here), as are phase imports.
    if import.options.is_some() || import.phase.is_some() {
        return None;
    }
    let Expression::StringLiteral(source) = &import.source else {
        return None;
    };
    Some(source.value.to_string())
}

struct Rewriter<'a> {
    allocator: &'a Allocator,
    targets: Vec<Target>,
}

impl<'a> VisitMut<'a> for Rewriter<'a> {
    fn visit_call_expression(&mut self, call: &mut CallExpression<'a>) {
        if let Some(index) = self
            .targets
            .iter()
            .position(|target| target.span == call.span())
        {
            let target = self.targets.remove(index);
            let ast = AstBuilder::new(self.allocator);
            if target.pad_options {
                call.arguments
                    .push(Argument::from(ast.void_0(Span::new(0, 0))));
            }
            let value = format!("{LAZY_PLACEHOLDER_PREFIX}{}", target.specifier);
            call.arguments
                .push(Argument::StringLiteral(ast.alloc_string_literal(
                    Span::new(0, 0),
                    ast.str(&value),
                    None,
                )));
        }
        walk_mut::walk_call_expression(self, call);
    }
}
