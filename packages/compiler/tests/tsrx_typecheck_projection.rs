//! Compiler-owned TSRX projection coverage through the unstable Rust API.
#![cfg(all(feature = "tsrx", not(feature = "node")))]

use oxc_sourcemap::SourceMap;
use solidjs_compiler::{
    CompileOptions, Syntax, TsrxEmbeddedRegionKind, TsrxTypecheckProjection,
    TsrxTypecheckProjectionOptions, compile, project_tsrx_for_typecheck,
};

fn project(source: &str) -> TsrxTypecheckProjection {
    project_tsrx_for_typecheck(
        source,
        &TsrxTypecheckProjectionOptions {
            filename: Some("typecheck.tsrx".into()),
        },
    )
    .expect("typecheck projection")
}

fn line_column(source: &str, byte_offset: usize) -> (u32, u32) {
    let line = source[..byte_offset]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count() as u32;
    let line_start = source[..byte_offset]
        .rfind('\n')
        .map_or(0, |offset| offset + 1);
    (
        line,
        source[line_start..byte_offset].encode_utf16().count() as u32,
    )
}

#[test]
fn projects_callback_bindings_as_authored() {
    // The bindings pass through untouched (#3474): where `For`/`Errored` hand
    // the callback an accessor the author reads it as one, and the projection
    // emits exactly the arrows `@tsrx/solid` does. Nothing is rewritten.
    let source = r#"export function Rows({ rows }) @{
  <>
    @for (const plain of rows) { <p>{plain.name}</p> }
    @for (const indexed of rows; index index) { <p>{indexed().name}:{index}</p> }
    @for (const keyed of rows; key keyed.id) { <p>{keyed().name}</p> }
    @for (const both of rows; index position; key both.id) { <p>{both().name}:{position()}</p> }
    @try { <Broken /> } @catch (error) { <p>{error().message}</p> }
  </>
}"#;
    let output = project(source);

    assert!(output.code.contains("from \"solid-js\""));
    assert!(output.code.contains("<__tsrx_For0"));
    assert!(output.code.contains("<__tsrx_Errored0"));
    assert!(output.code.contains("{(plain) => <p>{plain.name}</p>}"), "{}", output.code);
    assert!(
        output.code.contains("{(indexed, index) => <p>{indexed().name}:{index}</p>}"),
        "{}",
        output.code
    );
    assert!(output.code.contains("keyed={false}"));
    assert!(output.code.contains("keyed={(keyed) => keyed.id}"), "{}", output.code);
    assert!(output.code.contains("{(keyed) => <p>{keyed().name}</p>}"), "{}", output.code);
    assert!(
        output.code.contains("{(both, position) => <p>{both().name}:{position()}</p>}"),
        "{}",
        output.code
    );
    assert!(
        output.code.contains("fallback={(error) => <p>{error().message}</p>}"),
        "{}",
        output.code
    );
    assert!(!output.code.contains("__lazy"));
    assert!(!output.code.contains("plain().name"));
    assert!(!output.code.contains("index()"));

    let runtime = compile(
        source,
        &CompileOptions {
            filename: Some("typecheck.tsrx".into()),
            syntax: Syntax::Tsrx,
            ..CompileOptions::default()
        },
    )
    .expect("runtime projection");
    for shared_semantic_read in ["indexed().name", "both().name", "error().message", "plain.name"] {
        assert!(
            runtime.code.contains(shared_semantic_read),
            "runtime and tooling must share {shared_semantic_read}: {}",
            runtime.code
        );
    }
    assert!(!runtime.code.contains("__lazy"));
}

#[test]
fn rejects_destructuring_where_solid_passes_an_accessor() {
    // Destructuring an accessor has nothing to destructure. Both the runtime
    // compile and the typecheck projection fail at semantic lowering with the
    // same diagnostic, pointing at the pattern (#3474).
    let cases: [(&str, &str, u32, u32); 5] = [
        (
            "export function Rows({ rows }) @{\n  @for (const { name } of rows; index i) { <p>{name}</p> }\n}",
            "A destructured `@for` item binding is not supported together with `index` or `key`",
            2,
            14,
        ),
        (
            "export function Rows({ rows }) @{\n  @for (const [first] of rows; key first) { <p>{first}</p> }\n}",
            "A destructured `@for` item binding is not supported together with `index` or `key`",
            2,
            14,
        ),
        (
            "export function Rows({ rows }) @{\n  @for (const { id } of rows; index i; key id) { <p>{id}</p> }\n}",
            "A destructured `@for` item binding is not supported together with `index` or `key`",
            2,
            14,
        ),
        (
            "export function Rows() @{\n  @try { <Broken /> } @catch ({ message }) { <p>{message}</p> }\n}",
            "A destructured `@catch` error binding is not supported",
            2,
            30,
        ),
        (
            "export function Rows() @{\n  @try { <Broken /> } @catch ([first], reset) { <p onClick={reset}>{first}</p> }\n}",
            "A destructured `@catch` error binding is not supported",
            2,
            30,
        ),
    ];
    for (source, expected, line, column) in cases {
        let error = project_tsrx_for_typecheck(
            source,
            &TsrxTypecheckProjectionOptions {
                filename: Some("reject.tsrx".into()),
            },
        )
        .expect_err("destructured accessor must be rejected by the projection");
        assert!(
            error.message().contains(expected),
            "{source}\nprojection: {error}"
        );
        assert!(
            error.message().ends_with(&format!("({line}:{column})")),
            "{source}\nprojection location: {error}"
        );

        let error = compile(
            source,
            &CompileOptions {
                filename: Some("reject.tsrx".into()),
                syntax: Syntax::Tsrx,
                ..CompileOptions::default()
            },
        )
        .expect_err("destructured accessor must be rejected by the compile");
        assert!(error.message().contains(expected), "{source}\nruntime: {error}");
        assert!(
            error.message().ends_with(&format!("({line}:{column})")),
            "{source}\nruntime location: {error}"
        );
    }

    // Default keyed `@for` hands the callback the raw item: destructuring is
    // an ordinary one-time destructure there and stays allowed.
    let keyed = "export function Rows({ rows }) @{\n  @for (const { name } of rows) { <p>{name}</p> }\n}";
    assert!(project(keyed).code.contains("{({ name }) => <p>{name}</p>}"));
    compile(
        keyed,
        &CompileOptions {
            filename: Some("keyed.tsrx".into()),
            syntax: Syntax::Tsrx,
            ..CompileOptions::default()
        },
    )
    .expect("default keyed destructuring compiles");
}

#[test]
fn typecheck_helper_aliases_do_not_capture_authored_bindings_or_elements() {
    let source = r#"const __tsrx_For0 = "taken";
const For = (props: { children?: unknown }) => props.children;
export function Rows({ rows }: { rows: { name: string }[] }) @{
  <>
    <For>authored</For>
    @for (const row of rows; index index) { <p>{row.name}:{index}</p> }
  </>
}"#;
    let output = project(source);

    assert!(
        output.code.contains("For as __tsrx_For1"),
        "{}",
        output.code
    );
    assert!(
        output.code.contains("<For>authored</For>"),
        "{}",
        output.code
    );
    assert!(output.code.contains("<__tsrx_For1"), "{}", output.code);
}

#[test]
fn tooling_recovers_incomplete_editor_snapshots_without_loosening_compilation() {
    for source in [
        "export function View() @{",
        "export function View() @{ const value = ",
        "export function View() @{ @ }",
        "export function View() @{\n  <div>",
    ] {
        assert!(
            compile(
                source,
                &CompileOptions {
                    filename: Some("incomplete.tsrx".into()),
                    syntax: Syntax::Tsrx,
                    ..CompileOptions::default()
                },
            )
            .is_err(),
            "{source}"
        );

        let output = project_tsrx_for_typecheck(
            source,
            &TsrxTypecheckProjectionOptions {
                filename: Some("incomplete.tsrx".into()),
            },
        )
        .unwrap_or_else(|error| panic!("{source}: {error}"));
        assert!(!output.code.is_empty(), "{source}");
    }
}

#[test]
fn tooling_rejects_authored_lazy_destructuring() {
    let error = project_tsrx_for_typecheck(
        "export function Card(model) @{ const &{ title } = model; <p>{title}</p> }",
        &TsrxTypecheckProjectionOptions {
            filename: Some("authored-lazy.tsrx".into()),
        },
    )
    .expect_err("authored lazy destructuring must be rejected");
    assert!(
        error
            .message()
            .contains("Solid's TSRX frontend does not support authored lazy destructuring"),
        "{error}"
    );
}

#[test]
fn projects_dynamic_tags_and_scoped_styles() {
    let source = r#"export function Card({ model, Tag }: Props) @{
  <>
    <style>.card { color: red }.unused { color: blue }</style>
    <div>{model.title ?? "untitled"}:{model.nested.count ?? 0}</div>
    <{Tag} class="card" />
  </>
}"#;
    let output = project(source);

    assert!(output.code.contains("model.title"));
    assert!(output.code.contains("model.nested.count"));
    assert!(
        output.code.contains("<__tsrx_Dynamic0 component={Tag}"),
        "{}",
        output.code
    );
    assert!(output.code.contains("from \"@solidjs/web\""));
    assert!(!output.code.contains("<style>"));
    let hash = output.css_hash.as_deref().expect("scope hash");
    assert!(output.code.contains(hash));
    assert!(output.css.contains(hash));
    assert!(output.css.contains(".card"));
}

#[test]
fn returns_parser_authored_css_and_raw_script_regions() {
    let source = r#"const marker = "🚀";
export function Assets() @{
  <>
    <style>.应用 { color: red }</style>
    <script type="application/json">{"emoji":"🚀","close":"</ScRiPt>"}</script>
  </>
}"#;
    let output = project(source);
    assert!(output.code.contains("<script type=\"application/json\""));
    assert!(output.code.contains("emoji"), "{}", output.code);
    assert!(output.code.contains("ScRiPt"), "{}", output.code);
    assert_eq!(output.embedded_regions.len(), 2);

    let css = &output.embedded_regions[0];
    assert_eq!(css.kind, TsrxEmbeddedRegionKind::Css);
    assert_eq!(css.content, ".应用 { color: red }");
    assert_eq!(
        (css.start, css.end),
        (
            source.find(".应用").unwrap() as u32,
            (source.find(".应用").unwrap() + ".应用 { color: red }".len()) as u32,
        )
    );

    let script = &output.embedded_regions[1];
    assert_eq!(script.kind, TsrxEmbeddedRegionKind::Script);
    assert_eq!(script.content, r#"{"emoji":"🚀","close":"</ScRiPt>"}"#);
    assert_eq!(
        &source[script.start as usize..script.end as usize],
        script.content
    );
}

#[test]
fn accepts_style_and_raw_script_regions_in_authored_order() {
    for source in [
        r#"export function Assets() @{ <><script>one</script><style>.a{}</style><div class="a" /></> }"#,
        r#"export function Assets() @{ <><style>.a{}</style><script>one</script><div class="a" /></> }"#,
        r#"export function Assets() @{ <><script>one</script><style>.a{}</style><script>two</script><div class="a" /></> }"#,
    ] {
        let runtime = compile(
            source,
            &CompileOptions {
                filename: Some("assets.tsrx".into()),
                syntax: Syntax::Tsrx,
                ..CompileOptions::default()
            },
        )
        .expect("runtime projection accepts authored embed order");
        assert!(runtime.code.contains("script"));

        let tooling = project(source);
        assert_eq!(
            tooling
                .embedded_regions
                .iter()
                .filter(|region| region.kind == TsrxEmbeddedRegionKind::Css)
                .count(),
            1
        );
        assert_eq!(
            tooling
                .embedded_regions
                .iter()
                .filter(|region| region.kind == TsrxEmbeddedRegionKind::Script)
                .count(),
            source.matches("<script>").count()
        );
    }
}

#[test]
fn maps_virtual_tsx_identifiers_to_authored_tsrx() {
    let source = r#"const marker = "🚀";
export function Card(props: { visible: boolean; name: string }) @{
  @if (props.visible) { <span>{props.name}</span> }
}"#;
    let output = project(source);
    let generated_offset = output
        .code
        .find("props.name")
        .expect("generated identifier");
    let authored_offset = source.find("props.name").expect("authored identifier");
    let generated = line_column(&output.code, generated_offset);
    let authored = line_column(source, authored_offset);
    let map = SourceMap::from_json_string(&output.source_map).expect("valid source map");
    let lookup = map.generate_lookup_table();
    let token = map
        .lookup_token(&lookup, generated.0, generated.1)
        .expect("mapped generated token");

    assert_eq!(map.get_source(0), Some("typecheck.tsrx"));
    assert_eq!(map.get_source_content(0), Some(source));
    assert_eq!(token.get_source_id(), Some(0));
    assert_eq!((token.get_src_line(), token.get_src_col()), authored);

    let helper_offset = output.code.find("__tsrx_Show0").expect("helper import");
    let helper = line_column(&output.code, helper_offset);
    let token = map
        .lookup_token(&lookup, helper.0, helper.1)
        .expect("source-less helper token");
    assert_eq!(
        token.get_source_id(),
        None,
        "generated tooling imports must not map to authored TSRX"
    );
}
