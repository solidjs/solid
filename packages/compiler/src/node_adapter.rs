use napi::bindgen_prelude::*;
use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_parser::{ParseOptions, Parser};

use crate::compiler::{DEFAULT_MODULE_NAME, default_built_ins};
pub use crate::config::{TransformOptions, TransformResult};
pub use crate::directives::{
    DirectiveImportOption, ServerFunctionMeta, TransformDirectivesOptions,
    TransformDirectivesResult,
};
pub use crate::lazy::TransformLazyOptions;
pub use crate::refresh::TransformRefreshOptions;
use crate::{CompileOptions, Generate, Renderer, Wrapper};

const UNSUPPORTED_GENERATE: &str =
    "The @solidjs/compiler backend implements DOM, SSR, universal, and dynamic modes only";

/// The `"use server"` directive pass — a second, independent transform over
/// the same parse infrastructure as the JSX pass. Applies to plain
/// `.js`/`.ts` modules as well as JSX/TSX.
#[napi]
pub fn transform_directives(
    code: String,
    options: Option<TransformDirectivesOptions>,
) -> Result<TransformDirectivesResult> {
    crate::directives::transform_directives(code, options)
}

/// The `lazy()` module-URL pass — injects `__SOLID_LAZY_MODULE__:` placeholder
/// arguments into `lazy(() => import("..."))` calls for the bundler plugin to
/// resolve. Ported from vite-plugin-solid's `lazy-module-url` Babel plugin.
#[napi]
pub fn transform_lazy(
    code: String,
    options: Option<TransformLazyOptions>,
) -> Result<TransformResult> {
    crate::lazy::transform_lazy(code, options)
}

/// The solid-refresh HMR pass — wraps components in `$$component(...)`
/// registrations targeting the frozen solid-refresh runtime ABI. Ported from
/// the `solid-refresh` Babel plugin (jsx: false mode).
#[napi]
pub fn transform_refresh(
    code: String,
    options: Option<TransformRefreshOptions>,
) -> Result<TransformResult> {
    crate::refresh::transform_refresh(code, options)
}

#[napi]
pub fn transform(code: String, options: Option<TransformOptions>) -> Result<TransformResult> {
    let options = options.unwrap_or_default();
    let validation_error = if !supported_generate(options.generate.as_deref()) {
        Some(UNSUPPORTED_GENERATE)
    } else {
        None
    };
    if let Some(validation_error) = validation_error {
        return legacy_preflight(&code, &options, validation_error);
    }
    let options = core_options(options)?;
    let output = crate::compiler::compile_for_node_adapter(&code, &options)
        .map_err(|error| Error::from_reason(error.to_string()))?;
    Ok(TransformResult {
        code: output.code,
        map: output.source_map,
    })
}

fn core_options(options: TransformOptions) -> Result<CompileOptions> {
    let module_name = options
        .module_name
        .unwrap_or_else(|| DEFAULT_MODULE_NAME.to_string());
    let generate = match options.generate.as_deref().unwrap_or("dom") {
        "dom" => Generate::Dom,
        "ssr" => Generate::Ssr,
        "universal" => Generate::Universal,
        "dynamic" => Generate::Dynamic,
        _ => return Err(Error::from_reason(UNSUPPORTED_GENERATE)),
    };
    Ok(CompileOptions {
        filename: options.filename,
        module_name,
        generate,
        hydratable: options.hydratable.unwrap_or(false),
        server_components: options.server_components.unwrap_or(false),
        dev: options.dev.unwrap_or(false),
        source_map: options.source_map.unwrap_or(false),
        context_to_custom_elements: options.context_to_custom_elements.unwrap_or(true),
        delegate_events: options.delegate_events.unwrap_or(true),
        delegated_events: options.delegated_events.unwrap_or_default(),
        omit_quotes: options.omit_quotes.unwrap_or(true),
        omit_attribute_spacing: options.omit_attribute_spacing.unwrap_or(true),
        inline_styles: options.inline_styles.unwrap_or(true),
        effect_wrapper: wrapper(options.effect_wrapper),
        wrap_conditionals: options.wrap_conditionals.unwrap_or(true),
        memo_wrapper: wrapper(options.memo_wrapper),
        patch_driver: wrapper(options.patch_driver),
        static_marker: options.static_marker.unwrap_or_else(|| "@static".into()),
        require_import_source: options.require_import_source,
        validate: options.validate.unwrap_or(true),
        omit_nested_closing_tags: options.omit_nested_closing_tags.unwrap_or(false),
        omit_last_closing_tag: options.omit_last_closing_tag.unwrap_or(true),
        built_ins: options.built_ins.unwrap_or_else(default_built_ins),
        renderers: options
            .renderers
            .unwrap_or_default()
            .into_iter()
            .map(|renderer| Renderer {
                name: renderer.name,
                module_name: renderer.module_name,
                elements: renderer.elements,
            })
            .collect(),
    })
}

fn supported_generate(generate: Option<&str>) -> bool {
    matches!(
        generate.unwrap_or("dom"),
        "dom" | "ssr" | "universal" | "dynamic"
    )
}

/// Preserve the Node transform's established parse/skip/module/generate error
/// ordering on the exceptional paths that cannot yet be represented by the
/// typed Rust options.
fn legacy_preflight(
    code: &str,
    options: &TransformOptions,
    validation_error: &'static str,
) -> Result<TransformResult> {
    let source_type = crate::config::source_type_for_filename(options.filename.as_deref())?;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, code, source_type)
        .with_options(ParseOptions {
            preserve_parens: false,
            ..ParseOptions::default()
        })
        .parse();
    if let Some(error) = crate::shared::parser::first_parser_error(parsed.diagnostics) {
        return Err(Error::from_reason(error));
    }
    if let Some(lib) = options.require_import_source.as_deref()
        && !crate::compiler::has_jsx_import_source(&parsed.program, code, lib)
    {
        return Ok(TransformResult {
            code: code.to_owned(),
            map: None,
        });
    }
    Err(Error::from_reason(validation_error))
}

fn wrapper(option: Option<Either<bool, String>>) -> Wrapper {
    match option {
        None | Some(Either::A(true)) => Wrapper::Default,
        Some(Either::A(false)) => Wrapper::Disabled,
        Some(Either::B(name)) if name.is_empty() => Wrapper::Disabled,
        Some(Either::B(name)) => Wrapper::Name(name),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn omitted_options_match_babel_plugin_defaults() {
        let result = transform(
            "const view = <For each={list}>{item => item}</For>;".into(),
            None,
        )
        .expect("Solid apps can omit moduleName and builtIns");
        assert!(
            result.code.contains("@solidjs/web"),
            "default moduleName: {}",
            result.code
        );
        assert!(
            result.code.contains("For as _$For"),
            "default builtIns auto-import For: {}",
            result.code
        );
    }

    #[test]
    fn explicit_empty_built_ins_does_not_auto_import() {
        let result = transform(
            "const view = <For each={list}>{item => item}</For>;".into(),
            Some(TransformOptions {
                built_ins: Some(Vec::new()),
                ..TransformOptions::default()
            }),
        )
        .expect("empty builtIns is an explicit opt-out");
        assert!(
            !result.code.contains("For as _$For"),
            "empty builtIns should leave For as a user component: {}",
            result.code
        );
    }

    #[test]
    fn require_import_source_skip_does_not_need_module_name() {
        let source = "const view = <div />;".to_string();
        let result = transform(
            source.clone(),
            Some(TransformOptions {
                require_import_source: Some("expected-library".into()),
                ..TransformOptions::default()
            }),
        )
        .expect("a skipped file does not require a module name");

        assert_eq!(result.code, source);

        let matching = "/** @jsxImportSource expected-library */\nconst view = <div />;";
        let result = transform(
            matching.into(),
            Some(TransformOptions {
                require_import_source: Some("expected-library".into()),
                ..TransformOptions::default()
            }),
        )
        .expect("a matching file compiles with default moduleName");
        assert!(result.code.contains("@solidjs/web"));
    }

    #[test]
    fn legacy_validation_order_is_preserved() {
        let skipped = "const view = <div />;".to_string();
        let result = transform(
            skipped.clone(),
            Some(TransformOptions {
                generate: Some("invalid".into()),
                require_import_source: Some("expected-library".into()),
                ..TransformOptions::default()
            }),
        )
        .expect("requireImportSource skip precedes generate validation");
        assert_eq!(result.code, skipped);

        let result = transform(
            "const view = <div>".into(),
            Some(TransformOptions {
                module_name: Some("dom".into()),
                generate: Some("invalid".into()),
                ..TransformOptions::default()
            }),
        );
        let Err(error) = result else {
            panic!("invalid syntax should fail before generate validation");
        };
        assert!(!error.to_string().contains("implements DOM"));
    }

    #[test]
    fn explicit_empty_module_name_remains_accepted() {
        transform(
            "const view = <div />;".into(),
            Some(TransformOptions {
                module_name: Some(String::new()),
                ..TransformOptions::default()
            }),
        )
        .expect("next accepts an explicitly empty moduleName");
    }
}
