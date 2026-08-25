//! solid-refresh HMR transform — the dev-only pass that registers components
//! with the solid-refresh runtime so edits hot-swap instead of reloading.
//! Ported from the `solid-refresh` Babel plugin (v0.8.0-next.7, the version
//! vite-plugin-solid ships) with `jsx: false` semantics — the option surface
//! vite-plugin-solid exercises (`{ bundler: 'vite', fixRender: true,
//! jsx: false }`).
//!
//! The runtime ABI is frozen: `$$registry()`, `$$component(registry, name,
//! component, { location?, signature?, dependencies? })`, `$$refresh(bundler,
//! hot, registry)`, and `$$decline(bundler, hot)`. The import source is
//! configurable (`importSource`) because the runtime also ships as the
//! dev-only `solid-js/refresh` entry; the default stays `"solid-refresh"` to
//! match the Babel plugin byte-for-byte.
//!
//! Signature hashes reuse the directive pass's `xxhash32` port and a
//! Babel-generator-faithful printer (`signature.rs`) so HMR keeps treating
//! unchanged components as unchanged when tooling swaps over.

mod signature;
mod transform;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::{ParseOptions, Parser};

use crate::config::{TransformResult, source_type_for_filename};
use transform::{Bundler, RefreshConfig, RefreshTransform};

pub const DEFAULT_IMPORT_SOURCE: &str = "solid-refresh";

#[napi(object)]
#[derive(Default)]
pub struct TransformRefreshOptions {
    /// Used for `location` metadata (cwd-relative, like the Babel plugin)
    /// and to pick the parser dialect. Without it no locations are emitted.
    pub filename: Option<String>,
    /// `"esm" | "vite" | "webpack5" | "rspack-esm" | "standard"` (default
    /// `"standard"`), selecting the `import.meta.hot` /
    /// `import.meta.webpackHot` / `module.hot` API.
    pub bundler: Option<String>,
    /// Wrap top-level `render()`/`hydrate()` calls (imported from
    /// `@solidjs/web`) with `hot.dispose` cleanup. Default `true`.
    pub fix_render: Option<bool>,
    /// Emit per-component `signature`/`dependencies` metadata for granular
    /// HMR. Default `true`.
    pub granular: Option<bool>,
    /// The Babel plugin's JSX-granularity mode. Only `false` is supported by
    /// the native port (vite-plugin-solid always passes `false`); validated
    /// in `index.js`.
    pub jsx: Option<bool>,
    /// Module the runtime helpers are imported from. Default
    /// `"solid-refresh"`; set to `"solid-js/refresh"` for the Solid core
    /// entry (same frozen ABI).
    pub import_source: Option<String>,
    pub source_map: Option<bool>,
}

pub fn transform_refresh(
    code: String,
    options: Option<TransformRefreshOptions>,
) -> Result<TransformResult> {
    let options = options.unwrap_or_default();

    let bundler = match options.bundler.as_deref() {
        None | Some("standard") => Bundler::Standard,
        Some("esm") => Bundler::Esm,
        Some("vite") => Bundler::Vite,
        Some("webpack5") => Bundler::Webpack5,
        Some("rspack-esm") => Bundler::RspackEsm,
        Some(other) => {
            return Err(Error::from_reason(format!(
                "transformRefresh `bundler` option must be \"esm\", \"vite\", \"webpack5\", \"rspack-esm\" or \"standard\", got {other:?}"
            )));
        }
    };
    if options.jsx == Some(true) {
        return Err(Error::from_reason(
            "transformRefresh does not support `jsx: true` (JSX-granularity mode); pass `jsx: false` like vite-plugin-solid does",
        ));
    }

    let config = RefreshConfig {
        bundler,
        fix_render: options.fix_render.unwrap_or(true),
        granular: options.granular.unwrap_or(true),
        filename: options.filename.clone(),
        import_source: options
            .import_source
            .clone()
            .unwrap_or_else(|| DEFAULT_IMPORT_SOURCE.to_string()),
    };

    let source_type = source_type_for_filename(options.filename.as_deref())?;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &code, source_type)
        .with_options(ParseOptions {
            preserve_parens: false,
            ..ParseOptions::default()
        })
        .parse();
    if let Some(error) = crate::shared::parser::first_parser_error(parsed.diagnostics) {
        return Err(Error::from_reason(error));
    }

    let mut program = parsed.program;
    let mut pass = RefreshTransform::new(&allocator, config, &code);
    let changed = pass.run(&mut program);
    drop(pass);

    if !changed {
        // Skipped modules (`@refresh skip`) and modules with nothing to
        // register come back untouched.
        return Ok(TransformResult { code, map: None });
    }

    let build = Codegen::new()
        .with_options(CodegenOptions {
            source_map_path: options.source_map.unwrap_or(false).then(|| {
                std::path::PathBuf::from(options.filename.as_deref().unwrap_or("module.tsx"))
            }),
            ..CodegenOptions::default()
        })
        .build(&program);

    Ok(TransformResult {
        code: build.code,
        map: build.map.map(|map| map.to_json_string()),
    })
}
