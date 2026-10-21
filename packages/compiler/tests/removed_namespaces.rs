//! Removed Solid 1.x attribute forms (`on:`, `oncapture:`, `attr:`, `bool:`,
//! `use:`, `classList`) are compile errors on native elements of the web
//! generates (#4187); supported namespaces and components are untouched.
#![cfg(not(feature = "node"))]

use solidjs_compiler::{CompileErrorKind, CompileOptions, Generate, compile};

fn web_modes() -> Vec<(&'static str, CompileOptions)> {
    vec![
        ("dom", CompileOptions::default()),
        (
            "dom hydratable",
            CompileOptions {
                hydratable: true,
                ..CompileOptions::default()
            },
        ),
        (
            "ssr",
            CompileOptions {
                generate: Generate::Ssr,
                ..CompileOptions::default()
            },
        ),
        (
            "ssr hydratable",
            CompileOptions {
                generate: Generate::Ssr,
                hydratable: true,
                ..CompileOptions::default()
            },
        ),
    ]
}

#[test]
fn removed_forms_error_on_native_elements() {
    let cases = [
        (
            "const v = <button on:click={() => {}} />;",
            "`on:click` on <button> uses the `on:` namespace, which was removed in Solid 2.0. Use a camelCase handler such as `onClick={handler}` for Solid events, or a `ref` callback that calls `addEventListener` for listener options or custom event names. (1:19)",
        ),
        (
            "const v = <div oncapture:click={f} />;",
            "`oncapture:click` on <div> uses the `oncapture:` namespace, which was removed in Solid 2.0.",
        ),
        (
            "const v = <div attr:foo=\"x\" />;",
            "`attr:foo` on <div> uses the `attr:` namespace, which was removed in Solid 2.0. Attributes are the default in 2.0: write `foo={value}` (or `prop:foo` to set a DOM property). (1:16)",
        ),
        (
            "const v = <div bool:hidden={true} />;",
            "`bool:hidden` on <div> uses the `bool:` namespace, which was removed in Solid 2.0. Boolean values add or remove the attribute in 2.0: write `hidden={condition}`. (1:16)",
        ),
        (
            "const v = <div use:tip={tip} />;",
            "`use:tip` on <div> uses the `use:` namespace, which was removed in Solid 2.0. Use a `ref` directive factory instead: `ref={tip(options)}`, or `ref={tip}` without options; arrays compose (`ref={[a, b]}`). (1:16)",
        ),
        (
            "const v = <div classList={{ active: true }} />;",
            "`classList` on <div> was removed in Solid 2.0. Use `class` with an object or array instead: `class={{ active: isActive() }}` or `class={[\"base\", { active: isActive() }]}`. (1:16)",
        ),
        // Nested native children (static and dynamic), spreads, custom
        // elements and SVG all take the same check.
        (
            "const v = <div>\n  <p><span use:tip /></p>\n</div>;",
            "`use:tip` on <span> uses the `use:` namespace",
        ),
        (
            "const v = <div>{x()}<span bool:hidden={h()}>{y()}</span></div>;",
            "`bool:hidden` on <span> uses the `bool:` namespace",
        ),
        (
            "const v = <div {...props} on:click={f} />;",
            "`on:click` on <div> uses the `on:` namespace",
        ),
        (
            "const v = <my-el attr:plain={p()} />;",
            "`attr:plain` on <my-el> uses the `attr:` namespace",
        ),
        (
            "const v = <svg><rect use:tip /></svg>;",
            "`use:tip` on <rect> uses the `use:` namespace",
        ),
        (
            "const v = <Comp><div classList={c()} /></Comp>;",
            "`classList` on <div> was removed in Solid 2.0.",
        ),
    ];
    for (mode, options) in web_modes() {
        for (source, expected) in cases {
            let error = compile(source, &options)
                .err()
                .unwrap_or_else(|| panic!("{mode}: `{source}` should not compile"));
            assert_eq!(
                error.kind(),
                CompileErrorKind::Transform,
                "{mode}: {source}"
            );
            assert!(
                error.message().contains(expected),
                "{mode}: `{source}`\n  got: {}\n  expected to contain: {expected}",
                error.message()
            );
        }
    }
}

#[test]
fn supported_namespaces_components_and_universal_still_compile() {
    let accepted = [
        "const v = <input prop:value={v()} />;",
        "const v = <svg xmlns:xlink=\"http://www.w3.org/1999/xlink\"><use xlink:href=\"#a\" /></svg>;",
        "const v = <div xml:lang=\"en\" />;",
        "const v = <div class={{ active: a() }} onClick={f} ref={r} />;",
        "const v = <div classlist=\"x\" onclick=\"go()\" />;",
        "const v = <Comp on:click={f} use:tip={t} attr:x=\"1\" bool:y classList={c} />;",
    ];
    for (mode, options) in web_modes() {
        for source in accepted {
            compile(source, &options).unwrap_or_else(|error| panic!("{mode}: `{source}`: {error}"));
        }
    }
    // A custom renderer's `setProp` owns its own naming.
    compile(
        "const v = <node use:tip={t} classList={c} on:click={f} />;",
        &CompileOptions {
            generate: Generate::Universal,
            ..CompileOptions::default()
        },
    )
    .expect("universal leaves attribute names to the renderer");
}
