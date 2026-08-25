//! TSRX frontend coverage through the public Rust interface.
//!
//! Every Babel TSRX fixture (`packages/babel-plugin/test/__tsrx_*_fixtures__`)
//! must compile through the Rust frontend with the same options as its Babel
//! suite. Byte-parity against the Babel `output.js` snapshots is enforced by
//! the JS parity harness (`__tests__/parity`); these tests pin the frontend's
//! structural behavior and its diagnostics.
//!
//! Like `host_independent_interface.rs`, this compiles only without the
//! `node` feature (integration-test binaries have no N-API host to link
//! against): `cargo test --no-default-features --features tsrx`.
#![cfg(all(feature = "tsrx", not(feature = "node")))]

use std::path::{Path, PathBuf};

use solidjs_compiler::{CompileErrorKind, CompileOptions, Generate, Syntax, compile};

fn built_ins() -> Vec<String> {
    ["For", "Show", "Switch", "Match", "Errored", "Loading", "Dynamic"]
        .into_iter()
        .map(String::from)
        .collect()
}

fn fixture_options(generate: Generate) -> CompileOptions {
    // Mirrors the per-mode Babel suites (tsrx-dom/ssr/universal.spec.js).
    let module_name = match generate {
        Generate::Dom => "r-dom",
        Generate::Ssr => "r-server",
        Generate::Universal => "r-custom",
        Generate::Dynamic => unreachable!("no TSRX dynamic fixture suite"),
    };
    CompileOptions {
        module_name: module_name.into(),
        generate,
        built_ins: built_ins(),
        ..CompileOptions::default()
    }
}

fn fixture_root(dir: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../babel-plugin/test")
        .join(dir)
}

/// Fixtures that exercise statement containers in expression position
/// (`const x = @{…}`, `{@{…}}`) — spec-valid TSRX that the Babel frontend
/// compiles but the pinned `oxc-tsrx` engine cannot parse yet (upstream gap,
/// see documentation/tsrx/frontend-notes.md). Their structured rejection is
/// pinned by `rejects_expression_position_containers_with_guidance`.
const EXPRESSION_POSITION_FIXTURES: &[&str] = &["codeBlocks", "lazyShadowing"];

fn compile_corpus(dir: &str, generate: Generate) -> Vec<(String, String)> {
    let root = fixture_root(dir);
    let mut outputs = Vec::new();
    let mut entries: Vec<_> = std::fs::read_dir(&root)
        .unwrap_or_else(|error| panic!("fixture corpus {} must exist: {error}", root.display()))
        .map(|entry| entry.expect("readable fixture entry").path())
        .filter(|path| path.is_dir())
        .collect();
    entries.sort();
    assert!(!entries.is_empty(), "fixture corpus {dir} must not be empty");

    let mut failures = Vec::new();
    for fixture in entries {
        let name = fixture
            .file_name()
            .expect("fixture directory name")
            .to_string_lossy()
            .into_owned();
        if EXPRESSION_POSITION_FIXTURES.contains(&name.as_str()) {
            continue;
        }
        let source = std::fs::read_to_string(fixture.join("code.tsrx"))
            .unwrap_or_else(|error| panic!("{name}: fixture must have code.tsrx: {error}"));
        let options = CompileOptions {
            filename: Some(format!("{name}.tsrx")),
            ..fixture_options(generate)
        };
        match compile(&source, &options) {
            Ok(output) => outputs.push((name, output.code)),
            Err(error) => failures.push(format!("{dir}/{name}: {error}")),
        }
    }
    assert!(
        failures.is_empty(),
        "fixtures must compile:\n{}",
        failures.join("\n")
    );
    outputs
}

#[test]
fn compiles_the_dom_fixture_corpus() {
    let outputs = compile_corpus("__tsrx_dom_fixtures__", Generate::Dom);
    let by_name = |name: &str| -> &str {
        &outputs
            .iter()
            .find(|(fixture, _)| fixture == name)
            .unwrap_or_else(|| panic!("corpus must contain {name}"))
            .1
    };

    let simple = by_name("simpleElement");
    assert!(simple.contains("_$template"), "template call: {simple}");
    assert!(simple.contains("_$insert"), "dynamic insert: {simple}");

    let lazy = by_name("lazyDestructuring");
    assert!(lazy.contains("__lazy"), "lazy rename: {lazy}");

    let keyed = by_name("forKeyed");
    assert!(keyed.contains("_$For"), "For auto-import: {keyed}");
}

#[test]
fn compiles_the_ssr_fixture_corpus() {
    let outputs = compile_corpus("__tsrx_ssr_fixtures__", Generate::Ssr);
    assert!(
        outputs.iter().all(|(_, code)| code.contains("r-server")),
        "SSR outputs import from the configured module"
    );
}

#[test]
fn compiles_the_universal_fixture_corpus() {
    let outputs = compile_corpus("__tsrx_universal_fixtures__", Generate::Universal);
    assert!(
        outputs.iter().all(|(_, code)| code.contains("r-custom")),
        "universal outputs import from the configured module"
    );
}

// -- syntax routing ----------------------------------------------------------

const TSRX_SOURCE: &str = "export function C() @{\n  <p>hi</p>\n}\n";

#[test]
fn auto_routes_tsrx_filenames_only() {
    let routed = compile(
        TSRX_SOURCE,
        &CompileOptions {
            filename: Some("component.tsrx".into()),
            ..fixture_options(Generate::Dom)
        },
    )
    .expect("auto syntax compiles .tsrx filenames");
    assert!(routed.code.contains("_$template"));

    // Same source under a .tsx filename is a plain-TSX parse error.
    let unrouted = compile(
        TSRX_SOURCE,
        &CompileOptions {
            filename: Some("component.tsx".into()),
            ..fixture_options(Generate::Dom)
        },
    )
    .unwrap_err();
    assert_eq!(unrouted.kind(), CompileErrorKind::Parse);
}

#[test]
fn explicit_syntax_overrides_the_filename() {
    let forced = compile(
        TSRX_SOURCE,
        &CompileOptions {
            filename: Some("component.tsx".into()),
            syntax: Syntax::Tsrx,
            ..fixture_options(Generate::Dom)
        },
    )
    .expect("syntax: tsrx forces the TSRX frontend");
    assert!(forced.code.contains("_$template"));

    let refused = compile(
        TSRX_SOURCE,
        &CompileOptions {
            filename: Some("component.tsrx".into()),
            syntax: Syntax::Jsx,
            ..fixture_options(Generate::Dom)
        },
    );
    assert!(refused.is_err(), "syntax: jsx must not parse TSRX");
}

// -- diagnostics -------------------------------------------------------------

fn compile_error(source: &str) -> String {
    compile(
        source,
        &CompileOptions {
            filename: Some("case.tsrx".into()),
            ..fixture_options(Generate::Dom)
        },
    )
    .expect_err("source must be rejected")
    .to_string()
}

#[test]
fn rejects_scoped_style_blocks() {
    let message = compile_error(
        "export function C() @{\n  <div>\n    <style>\n      div { color: red; }\n    </style>\n    <p>hi</p>\n  </div>\n}\n",
    );
    assert!(
        message.to_lowercase().contains("scoped <style> blocks are not yet supported"),
        "style diagnostic: {message}"
    );
}

#[test]
fn rejects_return_inside_an_if_branch() {
    let message = compile_error(
        "export function C({ ok }) @{\n  <div>\n    @if (ok) {\n      return <p>no</p>;\n    }\n  </div>\n}\n",
    );
    assert!(
        message.contains("Return statements are not allowed"),
        "@if return diagnostic: {message}"
    );
}

#[test]
fn rejects_statement_containers_without_rendered_output() {
    let message = compile_error("export function C() @{\n  const x = 1;\n}\n");
    assert!(
        message.contains("A TSRX statement container is missing its rendered output node"),
        "renderless container diagnostic: {message}"
    );
}

#[test]
fn rejects_expression_position_containers_with_guidance() {
    // The Babel-only fixtures stay the source of truth for the authored
    // forms; the native compiler must reject them with the structured
    // diagnostic until the upstream oxc-tsrx gap is fixed.
    for name in EXPRESSION_POSITION_FIXTURES {
        let path = fixture_root("__tsrx_dom_fixtures__").join(format!("{name}/code.tsrx"));
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("{name} fixture must exist: {error}"));
        let message = compile_error(&source);
        assert!(
            message.contains(
                "TSRX statement containers in expression position are not yet supported"
            ),
            "{name} diagnostic: {message}"
        );
    }
}

#[test]
fn parse_errors_carry_authored_line_and_column() {
    let error = compile(
        "const broken = <div\n",
        &CompileOptions {
            filename: Some("broken.tsrx".into()),
            ..fixture_options(Generate::Dom)
        },
    )
    .expect_err("unterminated element must fail");
    assert_eq!(error.kind(), CompileErrorKind::Parse);
}
