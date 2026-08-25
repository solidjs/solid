//! Public compiler-interface coverage without the Node/N-API adapter.
#![cfg(not(feature = "node"))]

use dom_expressions_compiler::{CompileErrorKind, CompileOptions, Generate, compile};

#[test]
fn compiles_through_the_public_rust_interface() {
    let output = compile(
        "const view = <div>{signal()}</div>;",
        &CompileOptions::default(),
    )
    .expect("compile through the public Rust interface");

    assert!(output.code.contains("template("));
    assert!(output.code.contains("insert("));
}

#[test]
fn supports_every_generate_mode_without_node_types() {
    for generate in [
        Generate::Dom,
        Generate::Ssr,
        Generate::Universal,
        Generate::Dynamic,
    ] {
        compile(
            "const view = <div />;",
            &CompileOptions {
                generate,
                ..CompileOptions::default()
            },
        )
        .unwrap_or_else(|error| panic!("{generate:?}: {error}"));
    }
}

#[test]
fn returns_owned_source_maps_and_typed_errors() {
    let output = compile(
        "const view = <div />;",
        &CompileOptions {
            source_map: true,
            ..CompileOptions::default()
        },
    )
    .expect("compile with a source map");
    assert!(output.source_map.is_some());

    let parse = compile("const view = <", &CompileOptions::default()).unwrap_err();
    assert_eq!(parse.kind(), CompileErrorKind::Parse);

    let configuration = compile(
        "const view = <div />;",
        &CompileOptions {
            module_name: String::new(),
            ..CompileOptions::default()
        },
    )
    .unwrap_err();
    assert_eq!(configuration.kind(), CompileErrorKind::Configuration);
}
