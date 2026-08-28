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

use oxc_sourcemap::SourceMap;
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
            source_map: true,
            ..fixture_options(generate)
        };
        match compile(&source, &options) {
            Ok(output) => {
                assert!(
                    output.source_map.is_some(),
                    "{dir}/{name}: source-map request must return a map"
                );
                outputs.push((name, output.code));
            }
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

fn line_column(source: &str, byte_offset: usize) -> (u32, u32) {
    let mut line = 0u32;
    let mut line_start = 0usize;
    let mut chars = source[..byte_offset].char_indices().peekable();
    while let Some((offset, ch)) = chars.next() {
        let next = match ch {
            '\r' => {
                if chars.peek().is_some_and(|(_, next)| *next == '\n') {
                    let (next_offset, next) = chars.next().expect("peeked line feed");
                    next_offset + next.len_utf8()
                } else {
                    offset + ch.len_utf8()
                }
            }
            '\n' | '\u{2028}' | '\u{2029}' => offset + ch.len_utf8(),
            _ => continue,
        };
        line += 1;
        line_start = next;
    }
    let column = source[line_start..byte_offset].encode_utf16().count() as u32;
    (line, column)
}

fn assert_maps_to(
    output: &solidjs_compiler::CompileOutput,
    generated_needle: &str,
    generated_relative_offset: usize,
    authored_source: &str,
    authored_needle: &str,
) {
    let generated_offset = output
        .code
        .find(generated_needle)
        .unwrap_or_else(|| panic!("generated output does not contain {generated_needle:?}"))
        + generated_relative_offset;
    let authored_offset = authored_source
        .find(authored_needle)
        .unwrap_or_else(|| panic!("authored source does not contain {authored_needle:?}"));
    let generated_position = line_column(&output.code, generated_offset);
    let authored_position = line_column(authored_source, authored_offset);
    let json = output.source_map.as_deref().expect("source map output");
    let map = SourceMap::from_json_string(json).expect("valid source map");
    let lookup = map.generate_lookup_table();
    let token = map
        .lookup_token(&lookup, generated_position.0, generated_position.1)
        .unwrap_or_else(|| {
            panic!(
                "no mapping for {generated_needle:?} at {generated_position:?}\ncode:\n{}\nmap:\n{json}",
                output.code
            )
        });
    assert_eq!(
        token.get_source_id(),
        Some(0),
        "{generated_needle:?} must map to authored TSRX"
    );
    assert_eq!(
        (token.get_src_line(), token.get_src_col()),
        authored_position,
        "{generated_needle:?} must map to {authored_needle:?}"
    );
    assert_eq!(map.get_source_content(0), Some(authored_source));
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

#[test]
fn source_maps_compose_verbatim_tsrx_ranges_through_codegen() {
    let source = r#"const marker = "🚀";
export function Card(props: { visible: boolean; name: string }) @{
  <section>
    @if (props.visible) {
      <span>{props.name}</span>
    }
  </section>
}"#;
    let output = compile(
        source,
        &CompileOptions {
            filename: Some("unicode-card.tsrx".into()),
            source_map: true,
            ..fixture_options(Generate::Dom)
        },
    )
    .expect("TSRX source maps compile");

    let map = SourceMap::from_json_string(output.source_map.as_deref().expect("source map"))
        .expect("valid source map");
    assert_eq!(map.get_source(0), Some("unicode-card.tsrx"));
    assert_maps_to(&output, "marker", 0, source, "marker");
    assert_maps_to(&output, "props.visible", 0, source, "props.visible");
    assert_maps_to(&output, "props.name", 0, source, "props.name");
}

#[test]
fn source_maps_follow_lazy_reads_back_to_their_authored_use() {
    let source = r#"export function User(props: { name: string }) @{
  const &{ name } = props;
  <p>{name}</p>
}"#;
    let output = compile(
        source,
        &CompileOptions {
            filename: Some("lazy-user.tsrx".into()),
            source_map: true,
            ..fixture_options(Generate::Dom)
        },
    )
    .expect("lazy TSRX source maps compile");

    assert_maps_to(
        &output,
        "__lazy0.name",
        "__lazy0.".len(),
        source,
        "name}</p>",
    );
}

#[test]
fn source_maps_cover_reordered_switches_and_accessor_rewrites() {
    let switch_source = r#"export function Status({ status }) @{
  @switch (status) {
    @case "ready": { <p>{status}</p> }
    @default: { <p>waiting</p> }
  }
}"#;
    let switch_output = compile(
        switch_source,
        &CompileOptions {
            filename: Some("status.tsrx".into()),
            source_map: true,
            ..fixture_options(Generate::Dom)
        },
    )
    .expect("switch source maps compile");
    assert_maps_to(&switch_output, "status ===", 0, switch_source, "status) {");

    let for_source = r#"export function List({ items }) @{
  <ul>
    @for (const item of items; index index; key item.id) {
      <li>{index + 1}. {item.name}</li>
    }
  </ul>
}"#;
    let for_output = compile(
        for_source,
        &CompileOptions {
            filename: Some("list.tsrx".into()),
            source_map: true,
            ..fixture_options(Generate::Dom)
        },
    )
    .expect("keyed for source maps compile");
    assert_maps_to(&for_output, "item().name", 0, for_source, "item.name");
    assert_maps_to(&for_output, "index()", 0, for_source, "index +");
}

#[test]
fn source_maps_reset_to_each_defaulted_lazy_use_after_fallbacks() {
    let source = r#"export function Counter(source) @{
  const &{ value = 1 } = source;
  const read = value;
  ++value;
  <p>{read}</p>
}"#;
    let output = compile(
        source,
        &CompileOptions {
            filename: Some("counter.tsrx".into()),
            source_map: true,
            ..fixture_options(Generate::Dom)
        },
    )
    .expect("defaulted lazy source maps compile");

    assert_maps_to(
        &output,
        "? 1 : __lazyValue0",
        "? 1 : ".len(),
        source,
        "value;\n  ++",
    );
    assert_maps_to(
        &output,
        "__lazyValue1[__lazyValue2] = ++",
        0,
        source,
        "value;\n  <p>",
    );
    assert_maps_to(&output, "++__lazyValue3", 0, source, "value;\n  <p>");
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
fn compiles_scoped_style_blocks_with_authored_location_hashes() {
    let source = "export function C() @{\n  <>\n    <style>\n.used { color: red; }\n.unused { color: blue; }\n    </style>\n    <div class=\"used\" />\n  </>\n}\n";
    let filename = "/exact/components/card.tsrx";
    let outputs: Vec<_> = [Generate::Dom, Generate::Ssr, Generate::Universal]
        .into_iter()
        .map(|generate| {
            compile(
                source,
                &CompileOptions {
                    filename: Some(filename.into()),
                    ..fixture_options(generate)
                },
            )
            .expect("scoped styles compile")
        })
        .collect();
    let expected_css = outputs[0].css.as_deref().expect("TSRX CSS result");
    let expected_hash = outputs[0].css_hash.as_deref().expect("scope hash");
    assert!(expected_css.contains(&format!(".used.{expected_hash}")));
    assert!(expected_css.contains("(unused)"), "{expected_css}");
    for output in &outputs {
        assert_eq!(output.css.as_deref(), Some(expected_css));
        assert_eq!(output.css_hash.as_deref(), Some(expected_hash));
        assert!(!output.code.contains("<style"));
        assert!(output.code.contains(expected_hash));
    }
}

#[test]
fn rejects_multiple_scoped_style_blocks_at_the_second_tag() {
    let message = compile_error(
        "export const C = () => <>\n  <style>.a { color:red }</style>\n  <style>.b { color:blue }</style>\n  <div />\n</>;",
    );
    assert!(
        message.contains("TSRX fragments can only have one style tag (3:2)"),
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
