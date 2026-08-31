//! TSRX syntax frontend (feature `tsrx`).
//!
//! Routes `.tsrx` sources through `tsrx_parser_engine` (the community
//! `oxc-tsrx` project, pinned by revision — the only TSRX grammar authority
//! on the Rust side), lowers parser interchange into compiler-owned typed
//! Solid TSRX semantic IR, lowers that IR directly to the crate's Oxc AST,
//! and finishes with symbol-exact lazy/accessor rewrites. The desugaring contract
//! is frozen by `@solidjs/babel-plugin/src/tsrx/desugar.ts` and its fixture
//! corpus; both frontends must lower identically.

mod leaf;
mod lower;
mod names;
mod project;
mod rewrite;
mod semantic;
mod source_map;
mod style;
mod style_projection;
mod tape;
mod tooling;

pub use project::Projection;
pub use tooling::{
    TsrxEmbeddedRegion, TsrxEmbeddedRegionKind, TsrxTypecheckMapping, TsrxTypecheckProjection,
    TsrxTypecheckProjectionOptions, project_tsrx_for_typecheck,
};

use tsrx_parser_engine::{
    TsrxParseOptions, TsrxParseRequest, TsrxParseResult, TsrxUtf16ParseRequest,
    parse_tsrx_utf16_with_options, parse_tsrx_with_options,
};
use tsrx_tape_schema::{CoordinateDomain, ParseCompleteness, RecordIndex, ValueRef};

use crate::error::CompileError;

/// Parse TSRX source and project it to plain TSX for the shared pipeline.
pub fn run_frontend(
    source: &str,
    filename: Option<&str>,
    source_maps: bool,
) -> Result<Projection, CompileError> {
    let filename = filename.unwrap_or("input.tsrx");
    let tape = parse_tape(source, filename)?;
    let semantic = lower_semantic(source, &tape)?;
    project_semantic(source, filename, &semantic, source_maps)
}

pub(crate) fn run_compiler_frontend<'a>(
    allocator: &'a oxc_allocator::Allocator,
    source: &str,
    filename: Option<&str>,
) -> Result<lower::DirectLowered<'a>, CompileError> {
    let filename = filename.unwrap_or("input.tsrx");
    let tape = parse_tape(source, filename)?;
    let semantic = lower_semantic(source, &tape)?;
    let styles = style_projection::plan(source, filename, &semantic)
        .map_err(|error| project_error(source, error))?;
    lower::lower(allocator, source, &semantic, &styles)
}

fn parse_tape(source: &str, filename: &str) -> Result<tsrx_tape_schema::FlatTape, CompileError> {
    let options = TsrxParseOptions {
        filename,
        include_ts_fields: true,
        ..TsrxParseOptions::default()
    };

    let result = parse_source(source, options)?;
    if result.status != ParseCompleteness::Complete {
        return Err(first_diagnostic_error(source, &result));
    }
    let mut tape = result
        .program
        .ok_or_else(|| CompileError::parse("TSRX parse returned no program"))?;

    if result.coordinate_domain == CoordinateDomain::OriginalUtf16Units {
        rebase_utf16_spans(source, &mut tape).map_err(CompileError::parse)?;
    }
    Ok(tape)
}

fn lower_semantic<'t>(
    source: &str,
    tape: &'t tsrx_tape_schema::FlatTape,
) -> Result<semantic::SolidTsrxModule<'t>, CompileError> {
    let root = tape::Node::root(tape)
        .ok_or_else(|| CompileError::parse("TSRX parse produced no program"))?;
    semantic::lower(root).map_err(|error| {
        let (line, column) = line_column(source, error.start);
        CompileError::parse(format!("{} ({line}:{column})", error.message))
    })
}

fn project_semantic(
    source: &str,
    filename: &str,
    semantic: &semantic::SolidTsrxModule<'_>,
    source_maps: bool,
) -> Result<Projection, CompileError> {
    project::project(source, filename, semantic, source_maps)
        .map_err(|error| project_error(source, error))
}

fn project_error(source: &str, error: project::ProjectError) -> CompileError {
    let (line, column) = line_column(source, error.start);
    CompileError::parse(format!("{} ({line}:{column})", error.message))
}

/// Apply lazy/accessor rewrites to the explicit tooling projection.
pub fn apply_rewrites<'a>(
    allocator: &'a oxc_allocator::Allocator,
    program: &mut oxc_ast::ast::Program<'a>,
    projection: &Projection,
    source_maps: bool,
) -> Result<(), CompileError> {
    rewrite::apply(allocator, program, projection, source_maps).map_err(CompileError::transform)
}

pub fn apply_direct_rewrites<'a>(
    allocator: &'a oxc_allocator::Allocator,
    program: &mut oxc_ast::ast::Program<'a>,
    artifacts: &rewrite::RewriteArtifacts,
    source_maps: bool,
) -> Result<(), CompileError> {
    rewrite::apply_artifacts(allocator, program, artifacts, source_maps)
        .map_err(CompileError::transform)?;
    rewrite::clear_generated_spans(program, artifacts, source_maps);
    Ok(())
}

/// Parse compiler-projected TSX for the explicit tooling path.
pub(crate) fn parse_projected_tsx<'a>(
    allocator: &'a oxc_allocator::Allocator,
    projection: &'a Projection,
) -> Result<oxc_ast::ast::Program<'a>, CompileError> {
    let parsed = oxc_parser::Parser::new(allocator, &projection.text, oxc_span::SourceType::tsx())
        .with_options(oxc_parser::ParseOptions {
            preserve_parens: false,
            ..oxc_parser::ParseOptions::default()
        })
        .parse();
    if let Some(error) = crate::shared::parser::first_parser_error(parsed.diagnostics) {
        return Err(CompileError::parse(error));
    }
    Ok(parsed.program)
}

/// Compose codegen's projected-TSX source map back to authored TSRX.
pub fn compose_source_map(
    intermediate: &oxc_sourcemap::SourceMap<'_>,
    projection: &Projection,
    authored_source: &str,
    filename: &str,
) -> String {
    source_map::compose(
        intermediate,
        &projection.source_map,
        &projection.text,
        authored_source,
        filename,
    )
}

fn parse_source(
    source: &str,
    options: TsrxParseOptions<'_>,
) -> Result<TsrxParseResult, CompileError> {
    if source.is_ascii() {
        return parse_tsrx_with_options(&TsrxParseRequest { source }, options)
            .map_err(|error| CompileError::parse(format!("TSRX parse failed: {error:?}")));
    }
    // The canonical route is ASCII-only; non-ASCII sources go through the
    // exact-UTF-16 route and their spans are rebased to UTF-8 bytes below.
    let units: Vec<u16> = source.encode_utf16().collect();
    parse_tsrx_utf16_with_options(&TsrxUtf16ParseRequest { source: &units }, options)
        .map_err(|error| CompileError::parse(format!("TSRX parse failed: {error:?}")))
}

/// Rewrite every `start`/`end` field in the tape from UTF-16 code units to
/// UTF-8 byte offsets, so the projection can splice authored bytes directly.
fn rebase_utf16_spans(source: &str, tape: &mut tsrx_tape_schema::FlatTape) -> Result<(), String> {
    // Prefix table: UTF-16 unit index → UTF-8 byte offset.
    let mut unit_to_byte: Vec<u32> = Vec::new();
    for (byte_offset, ch) in source.char_indices() {
        for _ in 0..ch.len_utf16() {
            unit_to_byte.push(byte_offset as u32);
        }
    }
    unit_to_byte.push(source.len() as u32);

    let convert = |units: u32| -> Result<u32, String> {
        unit_to_byte
            .get(units as usize)
            .copied()
            .ok_or_else(|| format!("TSRX span offset {units} exceeds the source length"))
    };

    let object_count = tape.object_count() as u32;
    for object in 0..object_count {
        let object = RecordIndex::new(object);
        for name in ["start", "end"] {
            let Some(field) = tape.field_index(object, name) else {
                continue;
            };
            let Some(value) = tape.field_value(field) else {
                continue;
            };
            let Some(units) = tape.scalar_u32(value) else {
                continue;
            };
            tape.set_field_value(field, ValueRef::inline_u32(convert(units)?))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn first_diagnostic_error(source: &str, result: &TsrxParseResult) -> CompileError {
    let table = &result.errors;
    let Some(record) = table.records().first() else {
        return CompileError::parse("TSRX parse failed without diagnostics");
    };
    let message = table
        .string(record.message)
        .unwrap_or("TSRX parse failed")
        .to_string();
    let start = table
        .labels(record.labels)
        .and_then(|labels| {
            labels
                .iter()
                .find(|label| label.primary)
                .or_else(|| labels.first())
        })
        .map(|label| label.span.start);
    match start {
        Some(start) => {
            // Failed parses report in the authored domain of the used route;
            // for the UTF-16 route the offset is in code units, close enough
            // for a line/column computed over chars.
            let (line, column) = if result.coordinate_domain == CoordinateDomain::OriginalUtf16Units
            {
                line_column_utf16(source, start)
            } else {
                line_column(source, start)
            };
            CompileError::parse(format!("{message} ({line}:{column})"))
        }
        None => CompileError::parse(message),
    }
}

/// 1-based line and 0-based column for a UTF-8 byte offset (ESTree `loc`
/// convention, matching the Babel frontend's error suffix).
fn line_column(source: &str, offset: u32) -> (u32, u32) {
    let offset = (offset as usize).min(source.len());
    let before = &source.as_bytes()[..offset];
    let line = 1 + before.iter().filter(|byte| **byte == b'\n').count() as u32;
    let line_start = before
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map(|position| position + 1)
        .unwrap_or(0);
    let column = source[line_start..offset].encode_utf16().count() as u32;
    (line, column)
}

fn line_column_utf16(source: &str, offset_units: u32) -> (u32, u32) {
    let mut units = 0u32;
    for (byte_offset, ch) in source.char_indices() {
        if units >= offset_units {
            return line_column(source, byte_offset as u32);
        }
        units += ch.len_utf16() as u32;
    }
    line_column(source, source.len() as u32)
}
