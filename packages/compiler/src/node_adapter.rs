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
use crate::{CompileOptions, Generate, Renderer, Syntax, Wrapper};

const UNSUPPORTED_GENERATE: &str =
    "The @solidjs/compiler backend implements DOM, SSR, universal, and dynamic modes only";

#[cfg(feature = "tsrx")]
#[napi(object)]
#[derive(Default)]
pub struct ProjectTsrxForTypecheckOptions {
    pub filename: Option<String>,
}

#[cfg(feature = "tsrx")]
#[napi(object)]
pub struct TsrxTypecheckEmbeddedRegion {
    pub kind: String,
    /// Authored JavaScript string offset in UTF-16 code units.
    pub start: u32,
    /// Authored JavaScript string offset in UTF-16 code units.
    pub end: u32,
    pub content: String,
}

#[cfg(feature = "tsrx")]
#[napi(object)]
pub struct TsrxTypecheckMapping {
    /// Authored JavaScript string offset in UTF-16 code units.
    pub source_start: u32,
    /// Generated JavaScript string offset in UTF-16 code units.
    pub generated_start: u32,
    pub source_length: u32,
    pub generated_length: u32,
}

#[cfg(feature = "tsrx")]
#[napi(object)]
pub struct TsrxTypecheckProjectionResult {
    pub code: String,
    pub map: String,
    pub mappings: Vec<TsrxTypecheckMapping>,
    pub css: String,
    pub css_hash: Option<String>,
    pub embedded_regions: Vec<TsrxTypecheckEmbeddedRegion>,
}

/// Experimental host-independent TSRX projection for typechecking tools.
#[cfg(feature = "tsrx")]
#[napi]
pub fn project_tsrx_for_typecheck(
    code: String,
    options: Option<ProjectTsrxForTypecheckOptions>,
) -> Result<TsrxTypecheckProjectionResult> {
    let options = options.unwrap_or_default();
    let output = crate::tsrx::project_tsrx_for_typecheck(
        &code,
        &crate::tsrx::TsrxTypecheckProjectionOptions {
            filename: options.filename,
        },
    )
    .map_err(|error| Error::from_reason(error.to_string()))?;
    let source_mapping_endpoints = output
        .mappings
        .iter()
        .flat_map(|mapping| [mapping.source_start, mapping.source_start + mapping.length])
        .collect::<Vec<_>>();
    let generated_mapping_endpoints = output
        .mappings
        .iter()
        .flat_map(|mapping| {
            [
                mapping.generated_start,
                mapping.generated_start + mapping.length,
            ]
        })
        .collect::<Vec<_>>();
    let source_mapping_utf16 = utf16_offsets(&code, &source_mapping_endpoints)?;
    let generated_mapping_utf16 = utf16_offsets(&output.code, &generated_mapping_endpoints)?;
    let mappings = source_mapping_utf16
        .chunks_exact(2)
        .zip(generated_mapping_utf16.chunks_exact(2))
        .map(|(source, generated)| TsrxTypecheckMapping {
            source_start: source[0],
            generated_start: generated[0],
            source_length: source[1] - source[0],
            generated_length: generated[1] - generated[0],
        })
        .collect();
    let endpoints = output
        .embedded_regions
        .iter()
        .flat_map(|region| [region.start, region.end])
        .collect::<Vec<_>>();
    let utf16_endpoints = utf16_offsets(&code, &endpoints)?;
    let embedded_regions = output
        .embedded_regions
        .into_iter()
        .zip(utf16_endpoints.chunks_exact(2))
        .map(|(region, offsets)| {
            let kind = match region.kind {
                crate::tsrx::TsrxEmbeddedRegionKind::Css => "css",
                crate::tsrx::TsrxEmbeddedRegionKind::Script => "script",
            };
            TsrxTypecheckEmbeddedRegion {
                kind: kind.into(),
                start: offsets[0],
                end: offsets[1],
                content: region.content,
            }
        })
        .collect();
    Ok(TsrxTypecheckProjectionResult {
        code: output.code,
        map: output.source_map,
        mappings,
        css: output.css,
        css_hash: output.css_hash,
        embedded_regions,
    })
}

#[cfg(feature = "tsrx")]
fn utf16_offsets(source: &str, byte_offsets: &[u32]) -> Result<Vec<u32>> {
    let mut indexed = byte_offsets.iter().copied().enumerate().collect::<Vec<_>>();
    indexed.sort_unstable_by_key(|(_, offset)| *offset);
    let mut converted = vec![0; byte_offsets.len()];
    let mut byte = 0usize;
    let mut utf16 = 0usize;
    for (index, target) in indexed {
        let target = target as usize;
        if target > source.len() {
            return Err(Error::from_reason(
                "TSRX embedded region exceeds the source length",
            ));
        }
        while byte < target {
            let character = source[byte..]
                .chars()
                .next()
                .ok_or_else(|| Error::from_reason("TSRX embedded region exceeds the source"))?;
            byte += character.len_utf8();
            utf16 += character.len_utf16();
        }
        if byte != target {
            return Err(Error::from_reason(
                "TSRX embedded region is not on a UTF-8 boundary",
            ));
        }
        converted[index] = u32::try_from(utf16).map_err(|_| {
            Error::from_reason("TSRX embedded region exceeds the N-API offset range")
        })?;
    }
    Ok(converted)
}

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
        css: output.css,
        css_hash: output.css_hash,
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
    // Same fallthrough as the Babel plugin's `isTsrxSource`: any value other
    // than "tsrx"/"jsx" behaves as "auto".
    let syntax = match options.syntax.as_deref() {
        Some("tsrx") => Syntax::Tsrx,
        Some("jsx") => Syntax::Jsx,
        _ => Syntax::Auto,
    };
    Ok(CompileOptions {
        filename: options.filename,
        syntax,
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
            css: None,
            css_hash: None,
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

    #[cfg(feature = "tsrx")]
    #[test]
    fn typecheck_projection_converts_all_embedded_offsets_in_one_utf16_pass() {
        let source = "const marker = \"🚀\"; export const C = () => <><style>.a{}</style><script>ok</script></>;";
        let output = project_tsrx_for_typecheck(
            source.into(),
            Some(ProjectTsrxForTypecheckOptions {
                filename: Some("offsets.tsrx".into()),
            }),
        )
        .expect("TSRX typecheck projection");
        assert_eq!(output.embedded_regions.len(), 2);
        for region in output.embedded_regions {
            let byte_start = source.find(&region.content).expect("embedded content");
            let byte_end = byte_start + region.content.len();
            assert_eq!(
                region.start,
                source[..byte_start].encode_utf16().count() as u32
            );
            assert_eq!(region.end, source[..byte_end].encode_utf16().count() as u32);
        }
    }
}
