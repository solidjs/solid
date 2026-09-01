//! Host-independent TSRX projection for typecheck and editor tooling.
//!
//! This backend ends at post-semantic-rewrite TSX. It intentionally does not
//! contain host mappings or run Solid's DOM, SSR, or universal transforms.

use std::{collections::HashMap, path::PathBuf};

use oxc_allocator::Allocator;
use oxc_ast::ast::{IdentifierReference, ImportOrExportKind, JSXIdentifier, Program, Statement};
use oxc_ast_visit::VisitMut;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_semantic::SemanticBuilder;
use oxc_span::Span;

use super::{
    apply_rewrites, compose_source_map,
    names::Names,
    parse_projected_tsx,
    project::Projection,
    run_tooling_frontend,
    semantic::{EmbeddedKind as SemanticEmbeddedKind, EmbeddedRegion as SemanticEmbeddedRegion},
    source_map,
};
use crate::{CompileError, shared::ast_builder::AstBuilder};

const TYPECHECK_HELPERS: [(&str, &str, &str); 7] = [
    ("For", "solid-js", "__tsrx_For"),
    ("Show", "solid-js", "__tsrx_Show"),
    ("Switch", "solid-js", "__tsrx_Switch"),
    ("Match", "solid-js", "__tsrx_Match"),
    ("Errored", "solid-js", "__tsrx_Errored"),
    ("Loading", "solid-js", "__tsrx_Loading"),
    ("Dynamic", "@solidjs/web", "__tsrx_Dynamic"),
];

/// Options for the unstable host-independent typecheck projection.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TsrxTypecheckProjectionOptions {
    pub filename: Option<String>,
}

/// Language of an authored embedded region.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TsrxEmbeddedRegionKind {
    Css,
    Script,
}

/// Authored embedded-language region.
///
/// Rust offsets are UTF-8 byte offsets. Host adapters must convert them to
/// their string-coordinate domain (the Node adapter exposes UTF-16 units).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TsrxEmbeddedRegion {
    pub kind: TsrxEmbeddedRegionKind,
    pub start: u32,
    pub end: u32,
    pub content: String,
}

/// Exact equal-text range between authored TSRX and generated virtual TSX.
///
/// Rust offsets and lengths are UTF-8 bytes. Host adapters must convert both
/// coordinate spaces to their native string-offset domain.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TsrxTypecheckMapping {
    pub source_start: u32,
    pub generated_start: u32,
    pub length: u32,
}

/// Owned post-rewrite virtual TSX and its authored sidecars.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TsrxTypecheckProjection {
    pub code: String,
    pub source_map: String,
    pub mappings: Vec<TsrxTypecheckMapping>,
    pub css: String,
    pub css_hash: Option<String>,
    pub embedded_regions: Vec<TsrxEmbeddedRegion>,
}

/// Project authored TSRX into valid post-rewrite TSX for typechecking tools.
///
/// This unstable API shares the compiler-owned semantic IR with
/// [`crate::compile`], then deliberately emits and parses an independently
/// typecheckable TSX projection for TypeScript-based tooling.
pub fn project_tsrx_for_typecheck(
    source: &str,
    options: &TsrxTypecheckProjectionOptions,
) -> Result<TsrxTypecheckProjection, CompileError> {
    let filename = options.filename.as_deref().unwrap_or("input.tsrx");
    let projection = run_tooling_frontend(source, filename, true)?;
    let allocator = Allocator::default();
    let mut program = parse_projected_tsx(&allocator, &projection)?;
    inject_typecheck_helpers(&allocator, &mut program, &projection);
    apply_rewrites(&allocator, &mut program, &projection, true)?;
    let build = Codegen::new()
        .with_options(CodegenOptions {
            source_map_path: Some(PathBuf::from(filename)),
            ..CodegenOptions::default()
        })
        .build(&program);
    let intermediate = build.map.as_ref().ok_or_else(|| {
        CompileError::transform("TSRX typecheck projection did not produce a source map")
    })?;
    let mappings = source_map::exact_mappings(
        intermediate,
        &projection.source_map,
        &projection.text,
        source,
        &build.code,
    )
    .into_iter()
    .map(|mapping| TsrxTypecheckMapping {
        source_start: mapping.authored_start,
        generated_start: mapping.generated_start,
        length: mapping.length,
    })
    .collect();
    let source_map = compose_source_map(intermediate, &projection, source, filename);

    Ok(TsrxTypecheckProjection {
        code: build.code,
        source_map,
        mappings,
        css: projection.css,
        css_hash: projection.css_hash,
        embedded_regions: collect_embedded_regions(source, &projection.embedded_regions)?,
    })
}

fn inject_typecheck_helpers<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
    projection: &Projection,
) {
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .build(program)
        .semantic;
    let mut names = Names::from_semantic(&semantic);
    drop(semantic);
    let aliases = TYPECHECK_HELPERS
        .iter()
        .map(|(name, _, prefix)| (*name, names.allocate(prefix)))
        .collect::<HashMap<_, _>>();
    let mut renamer = TypecheckHelperRenamer {
        ast: AstBuilder::new(allocator),
        projection,
        aliases: &aliases,
        used: HashMap::new(),
    };
    renamer.visit_program(program);

    for source in ["@solidjs/web", "solid-js"] {
        let helpers = TYPECHECK_HELPERS
            .iter()
            .filter_map(|(name, helper_source, _)| {
                (*helper_source == source)
                    .then(|| {
                        renamer
                            .used
                            .get(name)
                            .map(|span| (*name, aliases[*name].as_str(), *span))
                    })
                    .flatten()
            })
            .collect::<Vec<_>>();
        if !helpers.is_empty() {
            program
                .body
                .insert(0, helper_import(allocator, source, &helpers));
        }
    }
}

struct TypecheckHelperRenamer<'a, 'p> {
    ast: AstBuilder<'a>,
    projection: &'p Projection,
    aliases: &'p HashMap<&'static str, String>,
    used: HashMap<&'static str, Span>,
}

impl<'a> TypecheckHelperRenamer<'a, '_> {
    fn renamed_helper(&mut self, identifier: &str, span: Span) -> Option<String> {
        let (name, alias) = self.aliases.iter().find(|(name, _)| identifier == **name)?;
        if self
            .projection
            .source_map
            .authored_offset(span.start)
            .is_some()
        {
            return None;
        }
        self.used.entry(*name).or_insert(span);
        Some(alias.clone())
    }
}

impl<'a> VisitMut<'a> for TypecheckHelperRenamer<'a, '_> {
    fn visit_jsx_identifier(&mut self, identifier: &mut JSXIdentifier<'a>) {
        if let Some(name) = self.renamed_helper(identifier.name.as_str(), identifier.span) {
            identifier.name = self.ast.str(&name);
        }
    }

    fn visit_identifier_reference(&mut self, identifier: &mut IdentifierReference<'a>) {
        if let Some(name) = self.renamed_helper(identifier.name.as_str(), identifier.span) {
            identifier.name = self.ast.str(&name).into();
        }
    }
}

fn helper_import<'a>(
    allocator: &'a Allocator,
    source: &str,
    helpers: &[(&str, &str, Span)],
) -> Statement<'a> {
    let ast = AstBuilder::new(allocator);
    let span = helpers[0].2;
    let mut specifiers = ast.vec_with_capacity(helpers.len());
    for (imported, local, _) in helpers {
        specifiers.push(ast.import_declaration_specifier_import_specifier(
            span,
            ast.module_export_name_identifier_name(span, ast.ident(imported)),
            ast.binding_identifier(span, ast.ident(local)),
            ImportOrExportKind::Value,
        ));
    }
    Statement::ImportDeclaration(ast.alloc_import_declaration(
        span,
        Some(specifiers),
        ast.string_literal(span, ast.str(source), None),
        None,
        None,
        ImportOrExportKind::Value,
    ))
}

fn collect_embedded_regions(
    source: &str,
    regions: &[SemanticEmbeddedRegion],
) -> Result<Vec<TsrxEmbeddedRegion>, CompileError> {
    regions
        .iter()
        .map(|region| {
            let content = source
                .get(region.span.start as usize..region.span.end as usize)
                .ok_or_else(|| {
                    CompileError::parse("TSRX parser returned an invalid embedded region span")
                })?
                .to_owned();
            let kind = match region.kind {
                SemanticEmbeddedKind::Css => TsrxEmbeddedRegionKind::Css,
                SemanticEmbeddedKind::Script => TsrxEmbeddedRegionKind::Script,
            };
            Ok(TsrxEmbeddedRegion {
                kind,
                start: region.span.start,
                end: region.span.end,
                content,
            })
        })
        .collect()
}
