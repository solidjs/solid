use super::*;

use super::*;

fn input<'a>(css: &'a str, elements: &'a [Element], kind: StyleKind) -> StyleInput<'a> {
    StyleInput {
        css,
        location: StyleLocation {
            filename: "App.tsrx",
            line: 3,
            column: 4,
        },
        elements,
        kind,
        minify: false,
    }
}

#[test]
fn matches_sha256_hash_and_strips_carriage_returns() {
    let output = compile_style(input(
        ".a .b:hover { color:red }",
        &[],
        StyleKind::Expression,
    ))
    .unwrap();
    assert_eq!(output.hash, "tsrx-f5ea950f");
    let cr = compile_style(StyleInput {
        css: ".a\r {x:y}",
        location: StyleLocation {
            filename: "A\r.tsrx",
            line: 1,
            column: 0,
        },
        elements: &[],
        kind: StyleKind::Expression,
        minify: false,
    })
    .unwrap();
    let plain = compile_style(StyleInput {
        css: ".a {x:y}",
        location: StyleLocation {
            filename: "A.tsrx",
            line: 1,
            column: 0,
        },
        elements: &[],
        kind: StyleKind::Expression,
        minify: false,
    })
    .unwrap();
    assert_eq!(cr.hash, plain.hash);
}

#[test]
fn scopes_first_selector_then_uses_where() {
    let mut parent = Element::native(1, "div").with_static_attr("class", "a");
    parent.children.push(ElementChild::Element(
        Element::native(2, "span").with_static_attr("class", "b"),
    ));
    let roots = [parent];
    let output =
        compile_style(input(".a .b:hover { color:red }", &roots, StyleKind::Block)).unwrap();
    assert_eq!(
        output.css,
        ".a.tsrx-f5ea950f .b:where(.tsrx-f5ea950f):hover { color:red }"
    );
}

#[test]
fn expression_map_is_sorted_and_prunes_unreachable_rules() {
    let css =
        "div { color: red; }.z {a:b}.a {c:d}:global(.badge) {e:f}:global(body) { margin: 0; }";
    let output = compile_style(input(css, &[], StyleKind::Expression)).unwrap();
    assert_eq!(
        output
            .class_map
            .iter()
            .map(|x| x.class_name.as_str())
            .collect::<Vec<_>>(),
        ["a", "badge", "z"]
    );
    assert!(output.css.starts_with("/* (unused) div { color: red; }*/"));
    assert!(output.css.contains(".badge {e:f}"));
    assert!(
        output
            .css
            .contains("/* (unused) :global(body) { margin: 0; }*/")
    );
}

#[test]
fn rewrites_keyframes_and_animation_names() {
    let css = "@keyframes spin {from{x:y}to{x:z}} .a {animation: 1s spin, none}";
    let output = compile_style(input(css, &[], StyleKind::Expression)).unwrap();
    assert_eq!(output.hash, "tsrx-6209913b");
    assert_eq!(
        output.css,
        "@keyframes tsrx-6209913b-spin {from{x:y}to{x:z}} .a.tsrx-6209913b {animation: 1s tsrx-6209913b-spin, none}"
    );
}

#[test]
fn preserves_global_blocks_with_parity_comments() {
    let css = ":global { body { margin: 0 } }";
    let output = compile_style(input(css, &[], StyleKind::Block)).unwrap();
    assert_eq!(output.hash, "tsrx-24bf0053");
    assert_eq!(output.css, "/* :global {*/ body { margin: 0 } /*}*/");
}

#[test]
fn prunes_against_element_tree_and_tracks_scoped_ids() {
    let mut section = Element::native(1, "section").with_static_attr("class", "card");
    section
        .children
        .push(ElementChild::Element(Element::native(2, "h2")));
    let roots = [section];
    let css = ".card {x:y}.card h2 {a:b}.card ol {c:d}";
    let output = compile_style(input(css, &roots, StyleKind::Block)).unwrap();
    assert!(output.css.contains(".card."));
    assert!(output.css.contains("h2:where("));
    assert!(output.css.contains("/* (unused) .card ol {c:d}*/"));
    assert_eq!(output.scoped_elements, BTreeSet::from([1, 2]));

    // Dynamic tags, attributes, and child regions are explicit
    // conservative boundaries in the frontend model.
    let dynamic = Element {
        id: 3,
        kind: ElementKind::Dynamic,
        attributes: vec![Attribute {
            name: "class".into(),
            value: Some(AttributeValue::Dynamic),
        }],
        has_spread: false,
        children: vec![ElementChild::Dynamic],
    };
    let component = Element {
        id: 4,
        kind: ElementKind::Component,
        attributes: Vec::new(),
        has_spread: false,
        children: Vec::new(),
    };
    let dynamic_roots = [dynamic, component];
    let conservative = compile_style(input(
        ".runtime-class {x:y}",
        &dynamic_roots,
        StyleKind::Block,
    ))
    .unwrap();
    assert!(!conservative.css.contains("(unused)"));
}

#[test]
fn supports_nested_rules_and_global_keyframes() {
    let css = ".card { color:green; span {color:red} &:hover {color:blue} } @keyframes -global-pulse {from{x:y}}";
    let output = compile_style(input(css, &[], StyleKind::Expression)).unwrap();
    assert_eq!(output.hash, "tsrx-25e005fa");
    assert_eq!(
        output.css,
        ".card.tsrx-25e005fa { color:green; span.tsrx-25e005fa {color:red} &:hover {color:blue} } @keyframes pulse {from{x:y}}"
    );
}

#[test]
fn preserves_outer_trivia_and_comments_unused_selector_runs() {
    let roots = [
        Element::native(1, "div").with_static_attr("class", "a"),
        Element::native(2, "div").with_static_attr("class", "c"),
    ];
    let css = "  .a, .b, .c {x:y}\n ";
    let output = compile_style(input(css, &roots, StyleKind::Block)).unwrap();
    assert_eq!(
        output.css,
        "  .a.tsrx-99f3dd6b /* (unused) .b*/, .c.tsrx-99f3dd6b {x:y}\n "
    );
}

#[test]
fn parses_and_conservatively_keeps_column_combinators() {
    let roots = [Element::native(1, "div").with_static_attr("class", "b")];
    let css = ".a || .b {x:y}";
    let output = compile_style(input(css, &roots, StyleKind::Block)).unwrap();
    assert_eq!(output.hash, "tsrx-f8aa311b");
    assert_eq!(output.css, ".a || .b.tsrx-f8aa311b {x:y}");
}

#[test]
fn preserves_nth_of_selector_lists_while_pruning_conservatively() {
    let roots = [Element::native(1, "li")];
    let css = "li:nth-child(2n + 1 of .featured, :global(.external)) {x:y}";
    let output = compile_style(input(css, &roots, StyleKind::Block)).unwrap();
    assert_eq!(output.hash, "tsrx-10770a85");
    assert_eq!(
        output.css,
        "li.tsrx-10770a85:nth-child(2n + 1 of .featured, :global(.external)) {x:y}"
    );
}

#[test]
fn preserves_nth_last_child_formulas() {
    let roots = [Element::native(1, "li")];
    let css = "li:nth-last-child(odd) {x:y}";
    let output = compile_style(input(css, &roots, StyleKind::Block)).unwrap();
    assert_eq!(output.hash, "tsrx-0d1d03e4");
    assert_eq!(output.css, "li.tsrx-0d1d03e4:nth-last-child(odd) {x:y}");
}

#[test]
fn removes_global_modifier_whitespace_and_adds_nested_ampersand() {
    let roots = [Element::native(1, "div")];
    let outer = compile_style(input("div :global.x {a:b}", &roots, StyleKind::Block)).unwrap();
    assert_eq!(outer.css, "div.tsrx-a070b2d0.x {a:b}");

    let nested = compile_style(input("div { :global.x {a:b} }", &roots, StyleKind::Block)).unwrap();
    assert_eq!(nested.css, "div.tsrx-eec6818f { &.x {a:b} }");
}

#[test]
fn components_do_not_match_native_type_selectors() {
    let roots = [Element {
        id: 1,
        kind: ElementKind::Component,
        attributes: Vec::new(),
        has_spread: false,
        children: Vec::new(),
    }];
    let output = compile_style(input("div {x:y}", &roots, StyleKind::Block)).unwrap();
    assert_eq!(output.hash, "tsrx-3853b06d");
    assert_eq!(output.css, "/* (unused) div {x:y}*/");
}

#[test]
fn matches_the_complete_dynamic_attribute_whitelist() {
    let whitelist: &[(&str, &[&str])] = &[
        ("details", &["open"]),
        ("dialog", &["open"]),
        ("form", &["novalidate"]),
        (
            "iframe",
            &[
                "allow",
                "allowfullscreen",
                "allowpaymentrequest",
                "loading",
                "referrerpolicy",
            ],
        ),
        ("img", &["loading"]),
        (
            "input",
            &[
                "accept",
                "autocomplete",
                "capture",
                "checked",
                "disabled",
                "max",
                "maxlength",
                "min",
                "minlength",
                "multiple",
                "pattern",
                "placeholder",
                "readonly",
                "required",
                "size",
                "step",
            ],
        ),
        ("object", &["typemustmatch"]),
        ("ol", &["reversed", "start", "type"]),
        ("optgroup", &["disabled"]),
        ("option", &["disabled", "selected"]),
        ("script", &["async", "defer", "nomodule", "type"]),
        ("select", &["disabled", "multiple", "required", "size"]),
        (
            "textarea",
            &[
                "autocomplete",
                "disabled",
                "maxlength",
                "minlength",
                "placeholder",
                "readonly",
                "required",
                "rows",
                "wrap",
            ],
        ),
        (
            "video",
            &["autoplay", "controls", "loop", "muted", "playsinline"],
        ),
    ];
    for &(tag, attributes) in whitelist {
        let roots = [Element::native(1, tag)];
        for &attribute in attributes {
            let css = format!("{tag}[{attribute}]{{x:y}}");
            let output = compile_style(input(&css, &roots, StyleKind::Block)).unwrap();
            assert!(
                !output.css.contains("(unused)"),
                "{tag}[{attribute}] was pruned"
            );
        }
    }

    let roots = [
        Element::native(1, "input"),
        Element::native(2, "iframe"),
        Element::native(3, "form"),
    ];
    let css =
        "input[placeholder] {x:y} iframe[loading] {a:b} form[novalidate]{c:d} input[notreal]{d:e}";
    let output = compile_style(input(css, &roots, StyleKind::Block)).unwrap();
    assert_eq!(output.hash, "tsrx-f5567425");
    assert_eq!(
        output.css,
        "input[placeholder].tsrx-f5567425 {x:y} iframe[loading].tsrx-f5567425 {a:b} form[novalidate].tsrx-f5567425{c:d} /* (unused) input[notreal]{d:e}*/"
    );
}

#[test]
fn optionally_preserves_class_map_selectors_for_style_refs() {
    let output = compile_style_with_class_map_selectors(
        input(".kept {x:y} div {a:b}", &[], StyleKind::Block),
        true,
    )
    .unwrap();
    assert_eq!(output.hash, "tsrx-6c055f88");
    assert_eq!(
        output.css,
        ".kept.tsrx-6c055f88 {x:y} /* (unused) div {a:b}*/"
    );
    assert_eq!(output.class_map[0].class_name, "kept");
}

#[test]
fn rejects_global_in_the_middle() {
    let error =
        compile_style(input(".a :global(.x) .b {x:y}", &[], StyleKind::Expression)).unwrap_err();
    assert!(error.message.contains("not in the middle"));
}
