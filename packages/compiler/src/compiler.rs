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
    pub patch_driver: Wrapper,
    pub static_marker: String,
    pub require_import_source: Option<String>,
    pub validate: bool,
    pub omit_nested_closing_tags: bool,
    pub omit_last_closing_tag: bool,
    pub built_ins: Vec<String>,
    pub renderers: Vec<Renderer>,
}

impl Default for CompileOptions {
    fn default() -> Self {
        Self {
            filename: None,
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
            patch_driver: Wrapper::Default,
            static_marker: "@static".into(),
            require_import_source: None,
            validate: true,
            omit_nested_closing_tags: false,
            omit_last_closing_tag: true,
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
    let source_type = source_type_for_filename(options.filename.as_deref())?;
    let allocator = Allocator::default();
    // Babel has no ParenthesizedExpression node (parens are trivia), so the
    // transform's expression matchers must never see one either. Preserving
    // parens here can hide logical expressions from conditional wrapping and
    // desynchronize generated output from Babel.
    let parsed = Parser::new(&allocator, source, source_type)
        .with_options(ParseOptions {
            preserve_parens: false,
            ..ParseOptions::default()
        })
        .parse();

    if let Some(error) = crate::shared::parser::first_parser_error(parsed.diagnostics) {
        return Err(CompileError::parse(error));
    }

    if let Some(lib) = options.require_import_source.as_deref()
        && !has_jsx_import_source(&parsed.program, source, lib)
    {
        return Ok(CompileOutput {
            code: source.to_string(),
            source_map: None,
        });
    }

    let mut program = parsed.program;
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
                std::path::PathBuf::from(options.filename.as_deref().unwrap_or("input.jsx"))
            }),
            ..CodegenOptions::default()
        })
        .build(&program);

    Ok(CompileOutput {
        code: build.code,
        source_map: build.map.map(|map| map.to_json_string()),
    })
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
        // DORMANT by default (extraction ruling, solid DESIGN §16): compiled
        // Patch mode is DEFAULT-ON (the shipped core carries the driver;
        // benchmarks and apps compile identically). Opt out with
        // `patchDriver: false`.
        patch_driver: wrapper_name(&options.patch_driver, "patchDriver"),
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
        patch_driver: dom.patch_driver,
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
}
