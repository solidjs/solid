//! TSRX's scoped-CSS engine through the public `style` module, as a frontend
//! other than TSRX drives it.
//!
//! The engine needs no `tsrx` feature; only the parity check against a
//! compiled `.tsrx` module does. Like `host_independent_interface.rs`, this
//! compiles only without the `node` feature (integration-test binaries have no
//! N-API host to link against).
#![cfg(not(feature = "node"))]

use solidjs_compiler::style::{
    Attribute, AttributeValue, Element, ElementChild, ElementKind, StyleInput, StyleKind,
    StyleLocation, compile_style, compile_style_with_class_map_selectors,
};

const CSS: &str = ".used { color:red } .unused { color:blue } span { color:green }";

fn native(id: u32, tag: &str, class: Option<&str>, children: Vec<Element>) -> Element {
    Element {
        id,
        kind: ElementKind::Native(tag.into()),
        attributes: class
            .map(|class| Attribute {
                name: "class".into(),
                value: Some(AttributeValue::Static(class.into())),
            })
            .into_iter()
            .collect(),
        has_spread: false,
        children: children.into_iter().map(ElementChild::Element).collect(),
    }
}

/// `<div class="used"><span /></div>`, the elements the stylesheet governs.
fn view() -> Vec<Element> {
    vec![native(
        1,
        "div",
        Some("used"),
        vec![native(2, "span", None, vec![])],
    )]
}

fn input<'a>(elements: &'a [Element], kind: StyleKind) -> StyleInput<'a> {
    StyleInput {
        css: CSS,
        location: StyleLocation {
            filename: "/exact/engine.tsrx",
            line: 3,
            column: 4,
        },
        elements,
        kind,
        minify: false,
    }
}

#[cfg(feature = "tsrx")]
#[test]
fn produces_the_stylesheet_a_tsrx_file_gets() {
    use solidjs_compiler::{CompileOptions, Syntax, compile};

    let tsrx = compile(
        &format!(
            "export function View() @{{\n  <>\n    <style>{CSS}</style>\n    <div class=\"used\"><span /></div>\n  </>\n}}"
        ),
        &CompileOptions {
            filename: Some("/exact/engine.tsrx".into()),
            syntax: Syntax::Tsrx,
            ..CompileOptions::default()
        },
    )
    .expect("compile TSRX");

    let elements = view();
    let output = compile_style(input(&elements, StyleKind::Block)).expect("compile style");
    assert_eq!(Some(output.hash.as_str()), tsrx.css_hash.as_deref());
    assert_eq!(Some(output.css.as_str()), tsrx.css.as_deref());
    assert!(output.css.contains(&format!(".used.{}", output.hash)));
    assert!(output.css.contains(&format!("span.{}", output.hash)));
    assert!(output.css.contains("/* (unused) .unused"), "{}", output.css);
    assert_eq!(
        output.scoped_elements.into_iter().collect::<Vec<_>>(),
        [1, 2]
    );
}

#[test]
fn hashes_by_location_and_reports_class_maps() {
    let elements = view();
    let here = compile_style(input(&elements, StyleKind::Block)).unwrap();
    let mut moved = input(&elements, StyleKind::Block);
    moved.location.line = 4;
    assert_ne!(compile_style(moved).unwrap().hash, here.hash);

    let expression = compile_style(input(&[], StyleKind::Expression)).unwrap();
    let classes: Vec<_> = expression
        .class_map
        .iter()
        .map(|entry| (entry.class_name.as_str(), entry.value.clone()))
        .collect();
    assert_eq!(
        classes,
        [
            ("unused", format!("{} unused", expression.hash)),
            ("used", format!("{} used", expression.hash)),
        ]
    );

    let preserved =
        compile_style_with_class_map_selectors(input(&elements, StyleKind::Block), true).unwrap();
    assert!(
        preserved
            .css
            .contains(&format!(".unused.{}", preserved.hash)),
        "{}",
        preserved.css
    );
}

#[test]
fn reports_invalid_stylesheets_as_style_errors() {
    let error = compile_style(StyleInput {
        css: ".a { color:red",
        ..input(&[], StyleKind::Block)
    })
    .unwrap_err();
    assert!(error.offset <= ".a { color:red".len(), "{error}");
    assert!(error.to_string().contains("at CSS byte"), "{error}");
}
