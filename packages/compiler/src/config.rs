use napi::bindgen_prelude::*;
use napi_derive::napi;
use oxc_span::SourceType;

#[napi(object)]
#[derive(Default)]
pub struct RendererOption {
    pub name: String,
    pub module_name: Option<String>,
    pub elements: Vec<String>,
}

#[napi(object)]
#[derive(Default)]
pub struct TransformOptions {
    pub filename: Option<String>,
    pub module_name: Option<String>,
    pub generate: Option<String>,
    pub hydratable: Option<bool>,
    pub dev: Option<bool>,
    pub source_map: Option<bool>,
    pub context_to_custom_elements: Option<bool>,
    pub delegate_events: Option<bool>,
    pub delegated_events: Option<Vec<String>>,
    pub omit_quotes: Option<bool>,
    pub omit_attribute_spacing: Option<bool>,
    pub inline_styles: Option<bool>,
    /// The reactive wrapper import name (Babel's `effectWrapper: string`).
    /// `false` or `""` disables wrapping; `true`/unset means the default
    /// `"effect"`.
    pub effect_wrapper: Option<Either<bool, String>>,
    pub wrap_conditionals: Option<bool>,
    /// The memo wrapper import name (Babel's `memoWrapper: string`), with the
    /// same boolean shorthand as `effect_wrapper`. Default `"memo"`.
    pub memo_wrapper: Option<Either<bool, String>>,
    /// The patch-mode driver import name (Babel's `patchDriver: string`),
    /// with the same boolean shorthand. DORMANT by default (`Wrapper::Default`
    /// disables it); set an explicit name to opt in.
    pub patch_driver: Option<Either<bool, String>>,
    pub static_marker: Option<String>,
    /// Babel's `requireImportSource`: when set, only files carrying a
    /// `@jsxImportSource <value>` comment are transformed; other files are
    /// returned untouched.
    pub require_import_source: Option<String>,
    /// Babel's `validate` (default `true`): warn on template HTML that a
    /// browser would re-parse differently (implied end tags, foster
    /// parenting, nested `<a>`/`<form>`, …).
    pub validate: Option<bool>,
    pub omit_nested_closing_tags: Option<bool>,
    pub omit_last_closing_tag: Option<bool>,
    /// Babel's `serverComponents`: SSR-only. `ref`/`on*` positions on
    /// intrinsic elements compile to a guarded `_$ssrClaim` hole (the
    /// `_bnd` behavior-claim marker) instead of dropping.
    pub server_components: Option<bool>,
    pub built_ins: Option<Vec<String>>,
    pub renderers: Option<Vec<RendererOption>>,
}

#[napi(object)]
pub struct TransformResult {
    pub code: String,
    pub map: Option<String>,
}

pub(crate) fn source_type_for_filename(filename: Option<&str>) -> Result<SourceType> {
    filename
        .map(SourceType::from_path)
        .transpose()
        .map_err(|error| Error::from_reason(error.to_string()))?
        .map_or_else(|| Ok(SourceType::tsx()), Ok)
}
