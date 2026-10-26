//! `compile_program` coverage through the public Rust interface: a frontend
//! that builds its own Oxc program from authored text that is not JavaScript.
//!
//! Like `host_independent_interface.rs`, this compiles only without the
//! `node` feature (integration-test binaries have no N-API host to link
//! against).
#![cfg(not(feature = "node"))]

use oxc_allocator::Allocator;
use oxc_ast::ast::Program;
use oxc_ast_visit::{VisitMut, walk_mut};
use oxc_parser::Parser;
use oxc_span::{SPAN, SourceType, Span};
use solidjs_compiler::{CompileOptions, Generate, compile_program};

/// The authored module: not JavaScript, so it cannot go through `compile`.
const AUTHORED: &str = "view greeting {\n  <p class=\"hi\">{user.name}</p>\n}\n";
/// What the stand-in frontend lowers it to.
const LOWERED: &str = "export const greeting = <p class=\"hi\">{user.name}</p>;";
const VIEW: &str = "<p class=\"hi\">{user.name}</p>";

/// Builds the lowered program in `allocator` the way an AST frontend would:
/// the view's nodes keep their authored positions, everything the frontend
/// synthesized around them is unspanned, and the program's source text is the
/// authored module.
fn lower<'a>(allocator: &'a Allocator) -> Program<'a> {
    struct Remap {
        lowered: Span,
        authored_start: u32,
    }
    impl<'a> VisitMut<'a> for Remap {
        fn visit_span(&mut self, span: &mut Span) {
            *span = if self.lowered.contains_inclusive(*span) {
                Span::new(
                    span.start - self.lowered.start + self.authored_start,
                    span.end - self.lowered.start + self.authored_start,
                )
            } else {
                SPAN
            };
            walk_mut::walk_span(self, span);
        }
    }

    let parsed = Parser::new(allocator, LOWERED, SourceType::tsx()).parse();
    assert!(parsed.diagnostics.is_empty(), "{:?}", parsed.diagnostics);
    let mut program = parsed.program;
    let start = LOWERED.find(VIEW).unwrap() as u32;
    Remap {
        lowered: Span::new(start, start + VIEW.len() as u32),
        authored_start: AUTHORED.find(VIEW).unwrap() as u32,
    }
    .visit_program(&mut program);
    program.source_text = allocator.alloc_str(AUTHORED);
    program
}

#[test]
fn compiles_a_frontend_program_for_every_back_end() {
    for generate in [Generate::Dom, Generate::Ssr, Generate::Universal] {
        let allocator = Allocator::default();
        let program = lower(&allocator);
        let output = compile_program(
            &allocator,
            program,
            AUTHORED,
            &CompileOptions {
                filename: Some("greeting.rx".into()),
                generate,
                hydratable: generate == Generate::Ssr,
                ..CompileOptions::default()
            },
        )
        .unwrap_or_else(|error| panic!("{generate:?}: {error}"));
        assert!(
            output.code.contains("export const greeting"),
            "{}",
            output.code
        );
        assert!(output.code.contains("user.name"), "{}", output.code);
        assert!(
            !output.code.contains("<p class=\"hi\">{"),
            "{}",
            output.code
        );
        assert_eq!(output.css, None);
        assert_eq!(output.css_hash, None);
    }
}

#[cfg(feature = "tsrx")]
#[test]
fn source_maps_point_at_the_authored_text() {
    use oxc_sourcemap::SourceMap;

    let allocator = Allocator::default();
    let program = lower(&allocator);
    let output = compile_program(
        &allocator,
        program,
        AUTHORED,
        &CompileOptions {
            filename: Some("greeting.rx".into()),
            source_map: true,
            ..CompileOptions::default()
        },
    )
    .expect("compile the frontend program");

    let json = output.source_map.as_deref().expect("source map");
    let map = SourceMap::from_json_string(json).expect("valid source map");
    assert!(json.contains("\"sources\":[\"greeting.rx\"]"), "{json}");
    assert_eq!(map.get_source_content(0), Some(AUTHORED));

    let generated = output.code.find("user.name").expect("generated read");
    let line = output.code[..generated].matches('\n').count() as u32;
    let column = (generated - output.code[..generated].rfind('\n').map_or(0, |i| i + 1)) as u32;
    let lookup = map.generate_lookup_table();
    let token = map
        .lookup_token(&lookup, line, column)
        .unwrap_or_else(|| panic!("no mapping for user.name\n{}\n{json}", output.code));
    let authored = AUTHORED.find("user.name").unwrap();
    let authored_line = AUTHORED[..authored].matches('\n').count() as u32;
    let authored_column = (authored - AUTHORED[..authored].rfind('\n').unwrap() - 1) as u32;
    assert_eq!(
        (token.get_src_line(), token.get_src_col()),
        (authored_line, authored_column),
        "user.name must map to the authored view\n{}",
        output.code
    );
}
