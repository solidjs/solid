use oxc_allocator::Allocator;
use oxc_ast_visit::VisitMut;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::{ParseOptions, Parser};
use oxc_span::SourceType;

use crate::dom::element::{AstDomTransform, DomTransformConfig};
use crate::error::CompileError;
use crate::ssr::transform::AstSsrTransform;
use crate::universal::transform::{
    AstUniversalTransform, DynamicDomConfig, UniversalWrapperConfig,
};

/// Output mode selected for JSX compilation.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum Generate {
    #[default]
    Dom,
    Ssr,
    Universal,
    Dynamic,
}

/// Source syntax selection, mirroring the Babel plugin's `syntax` option.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum Syntax {
    /// Route `.tsrx` filenames through the TSRX frontend, everything else
    /// through standard JSX.
    #[default]
    Auto,
    /// Never use the TSRX frontend.
    Jsx,
    /// Force the TSRX frontend for every file.
    Tsrx,
}

/// A wrapper import setting without any Node-API representation in its interface.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub enum Wrapper {
    #[default]
    Default,
    Disabled,
    Name(String),
}

/// A native renderer routed through dynamic mode.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Renderer {
    pub name: String,
    pub module_name: Option<String>,
    pub elements: Vec<String>,
}

/// Default runtime import path — same as `@solidjs/babel-plugin` and the
/// deleted `babel-preset-solid`.
pub(crate) const DEFAULT_MODULE_NAME: &str = "@solidjs/web";

/// Control-flow components auto-imported from [`DEFAULT_MODULE_NAME`].
pub(crate) const DEFAULT_BUILT_INS: &[&str] = &[
    "For", "Show", "Switch", "Match", "Loading", "Reveal", "Portal", "Repeat", "Dynamic", "Errored",
];

pub(crate) fn default_built_ins() -> Vec<String> {
    DEFAULT_BUILT_INS
        .iter()
        .map(|name| (*name).to_string())
        .collect()
}

/// Rust-native JSX compiler options.
///
/// Defaults match `@solidjs/babel-plugin` / the old `babel-preset-solid`:
/// DOM generate, `@solidjs/web`, and the Solid control-flow `builtIns`. The
/// Node adapter applies the same values when those fields are omitted.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompileOptions {
    pub filename: Option<String>,
    /// Source syntax routing (Babel's `syntax`): `Auto` sends `.tsrx`
    /// filenames through the TSRX frontend (requires the `tsrx` feature).
    pub syntax: Syntax,
    pub module_name: String,
    pub generate: Generate,
    pub hydratable: bool,
    /// SSR-only: behavior-claim (`_bnd`) marker emission for server components.
    pub server_components: bool,
    pub dev: bool,
    pub source_map: bool,
    pub context_to_custom_elements: bool,
    pub delegate_events: bool,
    pub delegated_events: Vec<String>,
    pub omit_quotes: bool,
    pub omit_attribute_spacing: bool,
    pub inline_styles: bool,
    pub effect_wrapper: Wrapper,
    pub wrap_conditionals: bool,
    pub memo_wrapper: Wrapper,
    pub static_marker: String,
    pub require_import_source: Option<String>,
    pub validate: bool,
    pub omit_nested_closing_tags: bool,
    pub omit_last_closing_tag: bool,
    /// Constant-fold the program and eliminate the code and control-flow
    /// components that folding proves unreachable. A server build and its
    /// client build must agree on this: folding changes the rendered tree
    /// shape, and with it hydration ids.
    pub optimize: bool,
    pub built_ins: Vec<String>,
    pub renderers: Vec<Renderer>,
}

impl Default for CompileOptions {
    fn default() -> Self {
        Self {
            filename: None,
            syntax: Syntax::default(),
            module_name: DEFAULT_MODULE_NAME.into(),
            generate: Generate::Dom,
            hydratable: false,
            server_components: false,
            dev: false,
            source_map: false,
            context_to_custom_elements: true,
            delegate_events: true,
            delegated_events: Vec::new(),
            omit_quotes: true,
            omit_attribute_spacing: true,
            inline_styles: true,
            effect_wrapper: Wrapper::Default,
            wrap_conditionals: true,
            memo_wrapper: Wrapper::Default,
            static_marker: "@static".into(),
            require_import_source: None,
            validate: true,
            omit_nested_closing_tags: false,
            omit_last_closing_tag: true,
            optimize: false,
            built_ins: default_built_ins(),
            renderers: Vec::new(),
        }
    }
}

/// Owned output from the reusable compiler core.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompileOutput {
    pub code: String,
    pub source_map: Option<String>,
    /// Extracted TSRX stylesheet output. `None` for the JSX route.
    pub css: Option<String>,
    /// Space-separated TSRX scope hashes, matching `@tsrx/core`.
    pub css_hash: Option<String>,
}

/// Compile one JavaScript or TypeScript module containing JSX.
///
/// The source is borrowed for the duration of compilation; no Oxc allocator,
/// AST node, or host-adapter error crosses this interface.
pub fn compile(source: &str, options: &CompileOptions) -> Result<CompileOutput, CompileError> {
    if options.module_name.is_empty() {
        return Err(CompileError::configuration(
            "JSX compilation requires a non-empty module name",
        ));
    }
    compile_inner(source, options)
}

/// Preserve the Node transform's established acceptance of an explicitly
/// empty `moduleName` without weakening the Rust-native interface.
#[cfg(feature = "node")]
pub(crate) fn compile_for_node_adapter(
    source: &str,
    options: &CompileOptions,
) -> Result<CompileOutput, CompileError> {
    compile_inner(source, options)
}

fn compile_inner(source: &str, options: &CompileOptions) -> Result<CompileOutput, CompileError> {
    let authored_source = source;
    let tsrx_route = match options.syntax {
        Syntax::Jsx => false,
        Syntax::Tsrx => true,
        Syntax::Auto => options
            .filename
            .as_deref()
            .is_some_and(|filename| filename.ends_with(".tsrx")),
    };

    #[cfg(not(feature = "tsrx"))]
    if tsrx_route {
        return Err(CompileError::configuration(
            "TSRX sources require a @solidjs/compiler build with the `tsrx` feature",
        ));
    }

    let allocator = Allocator::default();
    #[cfg(feature = "tsrx")]
    let (mut direct_program, direct_artifacts, direct_css, direct_css_hash) = if tsrx_route {
        let lowered =
            crate::tsrx::run_compiler_frontend(&allocator, source, options.filename.as_deref())?;
        (
            Some(lowered.program),
            Some(lowered.artifacts),
            Some(lowered.css),
            lowered.css_hash,
        )
    } else {
        (None, None, None, None)
    };

    let source_type = if tsrx_route {
        // TSRX leaves and generated nodes are represented as a TSX program.
        SourceType::tsx()
    } else {
        source_type_for_filename(options.filename.as_deref())?
    };
    #[cfg(feature = "tsrx")]
    let mut program = if let Some(program) = direct_program.take() {
        program
    } else {
        parse_program(&allocator, source, source_type)?
    };
    #[cfg(not(feature = "tsrx"))]
    let mut program = parse_program(&allocator, source, source_type)?;

    if let Some(lib) = options.require_import_source.as_deref()
        && !has_jsx_import_source(&program, source, lib)
    {
        #[cfg(feature = "tsrx")]
        let (css, css_hash) = if tsrx_route {
            (direct_css.clone(), direct_css_hash.clone())
        } else {
            (None, None)
        };
        #[cfg(not(feature = "tsrx"))]
        let (css, css_hash) = (None, None);
        return Ok(CompileOutput {
            // Babel's requireImportSource gate skips the transform, so callers
            // receive exactly what they authored. Style metadata was already
            // extracted and remains available to pipeline integrations.
            code: authored_source.to_string(),
            source_map: None,
            css,
            css_hash,
        });
    }

    #[cfg(feature = "tsrx")]
    if let Some(artifacts) = direct_artifacts.as_ref() {
        crate::tsrx::apply_direct_rewrites(
            &allocator,
            &mut program,
            artifacts,
            options.source_map,
        )?;
    }

    if options.optimize {
        crate::optimize::optimize_program(
            &allocator,
            &mut program,
            &options.built_ins,
            &options.module_name,
        );
    }

    match options.generate {
        Generate::Dom => {
            let mut transform = AstDomTransform::new(
                &allocator,
                source,
                &options.module_name,
                dom_transform_config(options, options.built_ins.clone()),
            );
            transform.visit_program(&mut program);
            if let Some(error) = transform.error.take() {
                return Err(CompileError::transform(error));
            }
            transform
                .prepend_helpers(&mut program)
                .map_err(|error| CompileError::transform(error.to_string()))?;
        }
        Generate::Dynamic => {
            if let Some(renderer) = dom_renderer(&options.renderers) {
                let mut transform = AstUniversalTransform::new_dynamic(
                    &allocator,
                    source,
                    &options.module_name,
                    options.built_ins.clone(),
                    dynamic_dom_config(options, renderer, &options.module_name),
                );
                transform.visit_program(&mut program);
                if let Some(error) = transform.error.take() {
                    return Err(CompileError::transform(error));
                }
                transform.prepend_helpers(&mut program);
                if let Some(error) = transform.error.take() {
                    return Err(CompileError::transform(error));
                }
            } else {
                let mut transform = AstUniversalTransform::new(
                    &allocator,
                    source,
                    &options.module_name,
                    options.built_ins.clone(),
                    options.static_marker.clone(),
                    universal_wrapper_config(options),
                );
                transform.visit_program(&mut program);
                if let Some(error) = transform.error.take() {
                    return Err(CompileError::transform(error));
                }
                transform.prepend_helpers(&mut program);
            }
        }
        Generate::Ssr => {
            let mut transform = AstSsrTransform::new(
                &allocator,
                source,
                &options.module_name,
                options.hydratable,
                options.server_components,
                options.wrap_conditionals,
                wrapper_name(&options.memo_wrapper, "memo"),
                options.static_marker.clone(),
                options.built_ins.clone(),
            );
            transform.visit_program(&mut program);
            if let Some(error) = transform.error.take() {
                return Err(CompileError::transform(error));
            }
            transform.prepend_helpers(&mut program);
        }
        Generate::Universal => {
            let mut transform = AstUniversalTransform::new(
                &allocator,
                source,
                &options.module_name,
                options.built_ins.clone(),
                options.static_marker.clone(),
                universal_wrapper_config(options),
            );
            transform.visit_program(&mut program);
            if let Some(error) = transform.error.take() {
                return Err(CompileError::transform(error));
            }
            transform.prepend_helpers(&mut program);
        }
    }

    let build = Codegen::new()
        .with_options(CodegenOptions {
            source_map_path: options.source_map.then(|| {
                std::path::PathBuf::from(options.filename.as_deref().unwrap_or(if tsrx_route {
                    "input.tsrx"
                } else {
                    "input.jsx"
                }))
            }),
            ..CodegenOptions::default()
        })
        .build(&program);

    #[cfg(feature = "tsrx")]
    let source_map = build.map.as_ref().map(|map| map.to_json_string());
    #[cfg(not(feature = "tsrx"))]
    let source_map = build.map.as_ref().map(|map| map.to_json_string());

    #[cfg(feature = "tsrx")]
    let (css, css_hash) = if tsrx_route {
        (direct_css, direct_css_hash)
    } else {
        (None, None)
    };
    #[cfg(not(feature = "tsrx"))]
    let (css, css_hash) = (None, None);

    Ok(CompileOutput {
        code: build.code,
        source_map,
        css,
        css_hash,
    })
}

fn parse_program<'a>(
    allocator: &'a Allocator,
    source: &'a str,
    source_type: SourceType,
) -> Result<oxc_ast::ast::Program<'a>, CompileError> {
    // Babel has no ParenthesizedExpression node (parens are trivia), so the
    // transform's expression matchers must never see one either. Preserving
    // parens here can hide logical expressions from conditional wrapping and
    // desynchronize generated output from Babel.
    let parsed = Parser::new(allocator, source, source_type)
        .with_options(ParseOptions {
            preserve_parens: false,
            ..ParseOptions::default()
        })
        .parse();
    if let Some(error) = crate::shared::parser::first_parser_error(parsed.diagnostics) {
        return Err(CompileError::parse(error));
    }
    Ok(parsed.program)
}

pub(crate) fn has_jsx_import_source(
    program: &oxc_ast::ast::Program<'_>,
    source: &str,
    required: &str,
) -> bool {
    program.comments.iter().any(|comment| {
        let text = comment.content_span().source_text(source);
        let mut pieces = text.split("@jsxImportSource");
        pieces.next();
        matches!((pieces.next(), pieces.next()), (Some(rest), None) if rest.trim() == required)
    })
}

fn source_type_for_filename(filename: Option<&str>) -> Result<SourceType, CompileError> {
    filename
        .map(SourceType::from_path)
        .transpose()
        .map_err(|error| CompileError::configuration(error.to_string()))?
        .map_or_else(|| Ok(SourceType::tsx()), Ok)
}

fn dom_transform_config(options: &CompileOptions, built_ins: Vec<String>) -> DomTransformConfig {
    DomTransformConfig {
        hydratable: options.hydratable,
        dev: options.dev,
        context_to_custom_elements: options.context_to_custom_elements,
        delegate_events: options.delegate_events,
        delegated_events: options.delegated_events.clone(),
        omit_quotes: options.omit_quotes,
        omit_attribute_spacing: options.omit_attribute_spacing,
        inline_styles: options.inline_styles,
        effect_wrapper: wrapper_name(&options.effect_wrapper, "effect"),
        wrap_conditionals: options.wrap_conditionals,
        memo_wrapper: wrapper_name(&options.memo_wrapper, "memo"),
        static_marker: options.static_marker.clone(),
        omit_nested_closing_tags: options.omit_nested_closing_tags,
        omit_last_closing_tag: options.omit_last_closing_tag,
        validate: options.validate,
        built_ins,
        wrapper_module_name: None,
        renderer_elements: None,
    }
}

fn dynamic_dom_config<'source>(
    options: &CompileOptions,
    renderer: &'source Renderer,
    default_module_name: &'source str,
) -> DynamicDomConfig<'source> {
    let dom = dom_transform_config(options, Vec::new());
    DynamicDomConfig {
        module_name: renderer
            .module_name
            .as_deref()
            .unwrap_or(default_module_name),
        elements: renderer.elements.clone(),
        hydratable: dom.hydratable,
        dev: dom.dev,
        context_to_custom_elements: dom.context_to_custom_elements,
        delegate_events: dom.delegate_events,
        delegated_events: dom.delegated_events,
        omit_quotes: dom.omit_quotes,
        omit_attribute_spacing: dom.omit_attribute_spacing,
        inline_styles: dom.inline_styles,
        effect_wrapper: dom.effect_wrapper,
        wrap_conditionals: dom.wrap_conditionals,
        memo_wrapper: dom.memo_wrapper,
        static_marker: dom.static_marker,
        omit_nested_closing_tags: dom.omit_nested_closing_tags,
        omit_last_closing_tag: dom.omit_last_closing_tag,
        validate: dom.validate,
    }
}

fn universal_wrapper_config(options: &CompileOptions) -> UniversalWrapperConfig {
    UniversalWrapperConfig {
        effect_wrapper: wrapper_name(&options.effect_wrapper, "effect"),
        wrap_conditionals: options.wrap_conditionals,
        memo_wrapper: wrapper_name(&options.memo_wrapper, "memo"),
    }
}

fn wrapper_name(option: &Wrapper, default: &str) -> Option<String> {
    match option {
        Wrapper::Default => Some(default.to_string()),
        Wrapper::Disabled => None,
        Wrapper::Name(name) if name.is_empty() => None,
        Wrapper::Name(name) => Some(name.clone()),
    }
}

fn dom_renderer(renderers: &[Renderer]) -> Option<&Renderer> {
    renderers.iter().find(|renderer| renderer.name == "dom")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_without_node_feature_types() {
        let output = compile(
            "const view = <div>{name()}</div>;",
            &CompileOptions::default(),
        )
        .expect("compile JSX");
        assert!(output.code.contains("template("));
        assert!(output.code.contains("insert("));
    }

    #[test]
    fn classifies_parse_and_configuration_errors() {
        let parse = compile("const view = <", &CompileOptions::default()).unwrap_err();
        assert_eq!(parse.kind(), crate::CompileErrorKind::Parse);

        let options = CompileOptions {
            filename: Some("input.txt".into()),
            ..CompileOptions::default()
        };
        let configuration = compile("const view = <div />;", &options).unwrap_err();
        assert_eq!(configuration.kind(), crate::CompileErrorKind::Configuration);
    }

    #[cfg(feature = "tsrx")]
    fn compile_tsrx(source: &str, filename: &str) -> CompileOutput {
        compile(
            source,
            &CompileOptions {
                filename: Some(filename.into()),
                syntax: Syntax::Tsrx,
                ..CompileOptions::default()
            },
        )
        .expect("compile TSRX")
    }

    #[cfg(feature = "tsrx")]
    #[test]
    fn extracts_and_scopes_tsrx_styles_without_a_runtime_helper() {
        let output = compile_tsrx(
            r#"export function View({ value, Tag }) @{
  <>
    <style>.used { color:red } .unused { color:blue } span { color:green }</style>
    <div class="used" />
    <span class={value} />
    <Tag><i class="used" /></Tag>
    <{Tag} />
  </>
}"#,
            "/exact/style-scope.tsrx",
        );
        let hash = output.css_hash.as_deref().expect("scope hash");
        let css = output.css.as_deref().expect("TSRX CSS result");
        assert!(css.contains(&format!(".used.{hash}")));
        assert!(css.contains(&format!("span.{hash}")));
        assert!(!output.code.contains("<style"));
        assert!(output.code.contains(&format!("used {hash}")));
        assert!(output.code.contains(&format!("${{value}} {hash}")));
        assert!(output.code.contains(&format!("class: \"{hash}\"")));
        assert!(!output.code.contains("styleScope"));
    }

    #[cfg(feature = "tsrx")]
    #[test]
    fn lowers_style_expressions_and_runtime_refs() {
        let expression = compile_tsrx(
            "export const styles = <style>.foo { color:red } div { color:blue }</style>;",
            "expression.tsrx",
        );
        let hash = expression.css_hash.as_deref().expect("expression hash");
        assert!(
            expression
                .code
                .contains(&format!("\"foo\": \"{hash} foo\"")),
            "{}",
            expression.code
        );
        assert!(
            expression
                .css
                .as_deref()
                .unwrap()
                .contains("/* (unused) div")
        );

        let runtime = compile_tsrx(
            r#"export function View() @{
  let styles;
  <>
    <style ref={styles}>.foo { color:red }</style>
    <div class="foo" />
  </>
}"#,
            "ref.tsrx",
        );
        let hash = runtime.css_hash.as_deref().expect("runtime hash");
        assert!(
            runtime
                .code
                .contains(&format!("styles = {{ \"foo\": \"{hash} foo\" }}")),
            "{}",
            runtime.code
        );
        assert!(runtime.code.contains(&format!("foo {hash}")));

        let refs = compile_tsrx(
            r#"let styles;
const holder = {};
const callback = value => value;
const getRef = () => holder;
export const view = <>
  <style ref={[styles, holder.value, value => callback(value), getRef()]}>.foo { color:red }</style>
  <div class="foo" />
</>;"#,
            "ref-forms.tsrx",
        );
        assert!(refs.code.contains("styles = {"), "{}", refs.code);
        assert!(refs.code.contains("holder.value = {"), "{}", refs.code);
        assert!(refs.code.contains("callback(value)"), "{}", refs.code);
        assert!(
            refs.code.contains("let _tsrx_style_ref_1 = getRef()"),
            "{}",
            refs.code
        );
    }

    #[cfg(feature = "tsrx")]
    #[test]
    fn rejects_multiple_runtime_styles_per_fragment() {
        let result = compile(
            "const view = <><style>.a{}</style><style>.b{}</style><div /></>;",
            &CompileOptions {
                filename: Some("duplicate.tsrx".into()),
                syntax: Syntax::Tsrx,
                ..CompileOptions::default()
            },
        );
        let error = result.expect_err("multiple runtime styles must fail");
        assert!(
            error
                .to_string()
                .contains("TSRX fragments can only have one style tag")
        );
    }

    #[cfg(feature = "tsrx")]
    #[test]
    fn reports_empty_css_only_on_the_tsrx_route() {
        let tsrx = compile_tsrx("export const view = <div />;", "empty.tsrx");
        assert_eq!(tsrx.css.as_deref(), Some(""));
        assert_eq!(tsrx.css_hash, None);

        let jsx = compile("export const view = <div />;", &CompileOptions::default()).unwrap();
        assert_eq!(jsx.css, None);
        assert_eq!(jsx.css_hash, None);
    }

    #[cfg(feature = "tsrx")]
    #[test]
    fn scopes_control_flow_elements_and_annotates_the_whole_owner() {
        let output = compile_tsrx(
            r#"const Component = props => props.children;
export const View = ({ visible, items, Tag }) => <>
  <style>span { color:red }</style>
  @if (visible) { <span /> }
  @for (const item of items) { <i /> }
  <{Tag} />
  <Component><strong /></Component>
</>;"#,
            "control-style.tsrx",
        );
        let hash = output.css_hash.as_deref().expect("owner hash");
        let css = output.css.as_deref().expect("owner CSS");
        assert!(css.contains(&format!("span.{hash}")), "{css}");
        assert!(!css.contains("/* (unused) span"), "{css}");
        assert!(output.code.contains(&format!("<span class={hash}>")));
        assert!(output.code.contains(&format!("<i class={hash}>")));
        assert!(output.code.contains(&format!("class: \"{hash}\"")));
        assert!(output.code.contains(&format!("<strong class={hash}>")));
    }

    #[cfg(feature = "tsrx")]
    #[test]
    fn excludes_for_and_try_pending_styles_from_owner_collection() {
        let output = compile_tsrx(
            r#"export const View = ({ items }) => <>
  <style>.outer { color:red }</style>
  @for (const item of items) { <><style>.loop { color:blue }</style><b /></> }
  @try { <u /> } @pending { <><style>.pending { color:green }</style><em /></> }
</>;"#,
            "style-boundaries.tsrx",
        );
        let hash = output.css_hash.as_deref().expect("outer style scope");
        assert!(!hash.contains(' '), "{:?}", output.css_hash);
        let css = output.css.as_deref().unwrap();
        assert!(css.contains(".outer"), "{css}");
        assert!(!css.contains(".loop"), "{css}");
        assert!(!css.contains(".pending"), "{css}");
        assert_eq!(output.code.matches("<style").count(), 0);
        assert!(output.code.contains(&format!("<b class={hash}>")));
        assert!(output.code.contains(&format!("<em class={hash}>")));

        let for_only = compile_tsrx(
            "export const view = ({ items }) => @for (const item of items) { <><style>.loop { color:red }</style><b /></> };",
            "for-style-boundary.tsrx",
        );
        assert_eq!(for_only.css.as_deref(), Some(""));
        assert_eq!(for_only.css_hash, None);

        let pending_only = compile_tsrx(
            "export const view = () => @try { <u /> } @pending { <><style>.pending { color:red }</style><i /></> };",
            "pending-style-boundary.tsrx",
        );
        assert_eq!(pending_only.css.as_deref(), Some(""));
        assert_eq!(pending_only.css_hash, None);
    }

    #[cfg(feature = "tsrx")]
    #[test]
    fn style_refs_export_classes_and_expression_refs_are_ignored() {
        let runtime = compile_tsrx(
            r#"let styles;
const holder = {};
const callback = value => value;
const getRef = () => ({ current: null });
export const view = <>
  <style ref={[styles, holder.value, value => callback(value), { current: null }, getRef()]}>.foo { color:red } div { color:blue }</style>
  <div />
</>;"#,
            "ref-export.tsrx",
        );
        let hash = runtime.css_hash.as_deref().expect("runtime hash");
        let css = runtime.css.as_deref().unwrap();
        assert!(css.contains(&format!(".foo.{hash}")), "{css}");
        assert!(!css.contains("/* (unused) .foo"), "{css}");
        assert!(runtime.code.contains(&format!("\"foo\": \"{hash} foo\"")));
        assert!(runtime.code.contains(&format!("<div class={hash}>")));
        assert!(runtime.code.contains("styles = {"), "{}", runtime.code);
        assert!(
            runtime.code.contains("holder.value = {"),
            "{}",
            runtime.code
        );
        assert!(runtime.code.contains("callback(value)"), "{}", runtime.code);
        assert!(
            runtime.code.matches("_tsrx_style_ref_").count() >= 2,
            "{}",
            runtime.code
        );

        let expression = compile_tsrx(
            "const ignored = () => {}; export const styles = <style ref={ignored}>.foo { color:red }</style>;",
            "expression-ref.tsrx",
        );
        assert!(
            expression.code.contains(&format!(
                "\"foo\": \"{} foo\"",
                expression.css_hash.unwrap()
            )),
            "{}",
            expression.code
        );
    }

    #[cfg(feature = "tsrx")]
    #[test]
    fn leaves_unowned_styles_unextracted_and_keeps_owner_visitor_order() {
        let unowned = compile_tsrx(
            "<style>.orphan { color:red }</style>;",
            "unowned-style.tsrx",
        );
        assert_eq!(unowned.css.as_deref(), Some(""));
        assert_eq!(unowned.css_hash, None);

        let ordered = compile_tsrx(
            r#"export function View() @{
  const early = <style>.early { color:red }</style>;
  <>
    <style>.owner { color:blue }</style>
    <div />
  </>
}"#,
            "style-owner-order.tsrx",
        );
        let css = ordered.css.as_deref().unwrap();
        assert!(
            css.find(".owner").unwrap() < css.find(".early").unwrap(),
            "{css}"
        );
    }

    #[cfg(feature = "tsrx")]
    #[test]
    fn import_source_skip_preserves_authored_tsrx_while_compiled_tsrx_emits_maps() {
        let source = "export const view = <><style>.x { color:red }</style><div class=\"x\" /></>;";
        let skipped = compile(
            source,
            &CompileOptions {
                filename: Some("skip.tsrx".into()),
                syntax: Syntax::Tsrx,
                require_import_source: Some("solid-js".into()),
                source_map: true,
                ..CompileOptions::default()
            },
        )
        .unwrap();
        assert_eq!(skipped.code, source);
        assert!(skipped.css.as_deref().is_some_and(|css| !css.is_empty()));
        assert!(skipped.css_hash.is_some());
        assert_eq!(skipped.source_map, None);

        let tsrx = compile(
            source,
            &CompileOptions {
                filename: Some("mapped.tsrx".into()),
                syntax: Syntax::Tsrx,
                source_map: true,
                ..CompileOptions::default()
            },
        )
        .unwrap();
        let map = tsrx
            .source_map
            .as_deref()
            .expect("compiled TSRX source map");
        assert!(map.contains("\"sources\":[\"mapped.tsrx\"]"), "{map}");
        assert!(map.contains("\"sourcesContent\""), "{map}");

        let jsx = compile(
            "export const view = <div />;",
            &CompileOptions {
                filename: Some("mapped.tsx".into()),
                source_map: true,
                ..CompileOptions::default()
            },
        )
        .unwrap();
        assert!(jsx.source_map.is_some());
    }
}
