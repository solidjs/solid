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
    [
        "For", "Show", "Switch", "Match", "Errored", "Loading", "Dynamic",
    ]
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

fn compile_corpus(dir: &str, generate: Generate) -> Vec<(String, String)> {
    let root = fixture_root(dir);
    let mut outputs = Vec::new();
    let mut entries: Vec<_> = std::fs::read_dir(&root)
        .unwrap_or_else(|error| panic!("fixture corpus {} must exist: {error}", root.display()))
        .map(|entry| entry.expect("readable fixture entry").path())
        .filter(|path| path.is_dir())
        .collect();
    entries.sort();
    assert!(
        !entries.is_empty(),
        "fixture corpus {dir} must not be empty"
    );

    let mut failures = Vec::new();
    for fixture in entries {
        let name = fixture
            .file_name()
            .expect("fixture directory name")
            .to_string_lossy()
            .into_owned();
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

    let lazy_scopes = by_name("lazyScopes");
    assert!(
        lazy_scopes.contains("__lazy0.count++") && lazy_scopes.contains("++__lazy0.count"),
        "lazy update target rewrite: {lazy_scopes}"
    );

    let keyed = by_name("forKeyed");
    assert!(keyed.contains("_$For"), "For auto-import: {keyed}");

    let code_blocks = by_name("codeBlocks");
    assert!(
        code_blocks.contains("const title = (() => {"),
        "expression-position statement container: {code_blocks}"
    );

    let lazy_shadowing = by_name("lazyShadowing");
    assert!(
        lazy_shadowing.contains("__lazy") && lazy_shadowing.contains("inner"),
        "lazy binding around expression-position container: {lazy_shadowing}"
    );
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

#[test]
fn compiles_standalone_lazy_assignment_statements() {
    let source = "export function run(source) @{\n\
        &{ value, ...rest } = source;\n\
        &[first, ...tail] = source.items;\n\
        value++;\n\
        return [value, rest, first, tail];\n\
        <p />\n\
    }";
    let options = CompileOptions {
        filename: Some("standalone-lazy.tsrx".into()),
        ..fixture_options(Generate::Dom)
    };
    let output = compile(source, &options).expect("standalone lazy assignments compile");
    assert!(
        output.code.contains("const __lazy0 = source;"),
        "{}",
        output.code
    );
    assert!(
        output.code.contains("const __lazy1 = source.items;"),
        "{}",
        output.code
    );
    assert!(output.code.contains("__lazy0.value++"), "{}", output.code);
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
        message
            .to_lowercase()
            .contains("scoped <style> blocks are not yet supported"),
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
fn rejects_control_flow_and_structural_early_errors() {
    let cases = [
        (
            "return escaping @for",
            "export function C({ xs }) @{ <ul>@for (const x of xs) { return <li>{x}</li>; }</ul> }",
            "Return statements are not allowed",
        ),
        (
            "continue escaping @for",
            "export function C({ xs }) @{ <ul>@for (const x of xs) { continue; <li>{x}</li> }</ul> }",
            "Continue statements are not allowed",
        ),
        (
            "break escaping @switch",
            "export const C = ({ x }) => @switch (x) { @case 1: { break; <p /> } };",
            "Break statements are not allowed",
        ),
        (
            "for-await",
            "export function C({ xs }) @{ <ul>@for await (const x of xs) { <li>{x}</li> }</ul> }",
            "`for await` is not supported",
        ),
        (
            "for-in",
            "export function C({ obj }) @{ <ul>@for (const key in obj) { <li>{key}</li> }</ul> }",
            "@for must iterate with for...of",
        ),
        (
            "statement after output",
            "export function C() @{ <p />; const x = 1; }",
            "render expression precedes another statement",
        ),
        (
            "multiple output nodes",
            "export function C() @{ <p />; <span /> }",
            "render expression precedes another statement",
        ),
        (
            "@finally",
            "export const C = () => @try { <p /> } @finally { <p /> };",
            "expected an `@pending` or `@catch` clause",
        ),
        (
            "spaced statement-container sigil",
            "export function C() @ { <p /> }",
            "Expected a semicolon",
        ),
        (
            "spaced lazy-pattern sigil",
            "export function C({ x }) @{ const & { value } = x; <p>{value}</p> }",
            "Unexpected token",
        ),
    ];

    for (name, source, expected) in cases {
        let message = compile_error(source);
        assert!(
            message.contains(expected),
            "{name} diagnostic must contain {expected:?}: {message}"
        );
    }
}

#[test]
fn unicode_offsets_preserve_authored_diagnostic_coordinates() {
    let message = compile_error(
        "const emoji = \"🚀\";\nexport function C() @{\n  <div>\n    @if (true) { return <p />; }\n  </div>\n}\n",
    );
    assert!(
        message.ends_with("(4:17)"),
        "UTF-16 spans must rebase to authored line/column coordinates: {message}"
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
