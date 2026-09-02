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
    /// Source syntax routing, matching `@solidjs/babel-plugin`'s `syntax`:
    /// `"auto"` (default) compiles `.tsrx` filenames with the TSRX frontend,
    /// `"jsx"` never does, `"tsrx"` forces TSRX for every file.
    pub syntax: Option<String>,
    /// Runtime module compiled output imports helpers from.
    /// Default `"@solidjs/web"`.
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
    /// Graph-native REGION emission (DESIGN-REGIONS): template scopes whose
    /// dynamic bindings are static-key member chains of one constant store
    /// subject compile to one `region()` effect (raw commit reads + tracked
    /// residuals + deep flag) with a runtime classic fallback. Prototype —
    /// off by default.
    pub regions: Option<bool>,
    pub wrap_conditionals: Option<bool>,
    /// The memo wrapper import name (Babel's `memoWrapper: string`), with the
    /// same boolean shorthand as `effect_wrapper`. Default `"memo"`.
    pub memo_wrapper: Option<Either<bool, String>>,
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
    /// Component exports from `moduleName` that are auto-imported.
    /// Default `["For", "Show", "Switch", "Match", "Loading", "Reveal", "Portal", "Repeat", "Dynamic", "Errored"]`.
    pub built_ins: Option<Vec<String>>,
    pub renderers: Option<Vec<RendererOption>>,
}

#[napi(object)]
pub struct TransformResult {
    pub code: String,
    pub map: Option<String>,
    /// Extracted TSRX stylesheet output. Absent for ordinary JSX transforms.
    pub css: Option<String>,
    /// Space-separated TSRX scope hashes. Absent when no stylesheet was emitted.
    pub css_hash: Option<String>,
}

pub(crate) fn source_type_for_filename(filename: Option<&str>) -> Result<SourceType> {
    if filename.is_some_and(|filename| filename.ends_with(".tsrx")) {
        // Secondary passes receive already-projected ordinary code but retain
        // the authored filename for stable path-derived metadata.
        return Ok(SourceType::tsx());
    }
    filename
        .map(SourceType::from_path)
        .transpose()
        .map_err(|error| Error::from_reason(error.to_string()))?
        .map_or_else(|| Ok(SourceType::tsx()), Ok)
}
