//! `"use server"` directive transform — the second, independent pass of the
//! compiler (alongside the JSX pass). Ported from the Babel implementation
//! living in vite-plugin-solid `src/server-functions/` (hoisted from
//! solid-start); the parity suite in `__tests__/` checks the two produce the
//! same output for shared fixtures.
//!
//! The runtime ABI is frozen: `registerServerReference(id, fn)` on the
//! server, `createServerReference(id)` proxies on the client, and the
//! `<xxhash32(relative path)>-<count>` ID format shared by both builds.

mod dce;
mod transform;
mod validate;
pub(crate) mod xxhash;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::{ParseOptions, Parser};

use crate::config::source_type_for_filename;
use transform::{DirectivesTransform, Env, ImportDef, ImportKind, Mode};

const DEFAULT_RUNTIME: &str = "@solidjs/web/server-functions";

/// A runtime import override, mirroring the Babel plugin's
/// `ImportDefinition` (`kind: "named" | "default"`).
#[napi(object)]
#[derive(Default)]
pub struct DirectiveImportOption {
    pub kind: Option<String>,
    pub name: Option<String>,
    pub source: String,
}

#[napi(object)]
#[derive(Default)]
pub struct TransformDirectivesOptions {
    pub filename: Option<String>,
    /// Project root; function IDs hash the root-relative path so client and
    /// server builds of the same checkout agree on every ID without baking
    /// machine-specific absolute paths into the output.
    pub root: Option<String>,
    /// `"server"` keeps the module and registers extracted functions;
    /// `"client"` replaces them with reference proxies.
    pub mode: Option<String>,
    /// `"development"` appends the function name to generated IDs.
    pub env: Option<String>,
    /// The directive text. Default `"use server"`.
    pub directive: Option<String>,
    pub source_map: Option<bool>,
    /// Runtime import for `registerServerReference` (server output).
    pub register: Option<DirectiveImportOption>,
    /// Runtime import for `createServerReference` (both outputs).
    pub create: Option<DirectiveImportOption>,
}

/// One extracted server function, for the bundler plugin's manifest.
#[napi(object)]
pub struct ServerFunctionMeta {
    /// The wire ID (`<hash>-<count>[-<name>]`).
    pub id: String,
    /// The descriptive source name (`anonymous` when none applies).
    pub name: String,
    /// Export names bound to this function (module-level directives only;
    /// empty for function-level extractions).
    pub exports: Vec<String>,
}

#[napi(object)]
pub struct TransformDirectivesResult {
    pub code: String,
    pub map: Option<String>,
    /// Whether the pass transformed anything — mirrors the Babel
    /// implementation's `valid` flag; callers should keep the original
    /// module when false.
    pub valid: bool,
    pub functions: Vec<ServerFunctionMeta>,
}

pub fn transform_directives(
    code: String,
    options: Option<TransformDirectivesOptions>,
) -> Result<TransformDirectivesResult> {
    let options = options.unwrap_or_default();

    let mode = match options.mode.as_deref() {
        Some("server") => Mode::Server,
        Some("client") => Mode::Client,
        _ => {
            return Err(Error::from_reason(
                "transformDirectives requires a `mode` option of \"server\" or \"client\"",
            ));
        }
    };
    let env = match options.env.as_deref() {
        None | Some("production") => Env::Production,
        Some("development") => Env::Development,
        _ => {
            return Err(Error::from_reason(
                "transformDirectives `env` option must be \"production\" or \"development\"",
            ));
        }
    };
    let Some(filename) = options.filename.as_deref() else {
        return Err(Error::from_reason(
            "transformDirectives requires a `filename` option (function IDs hash the file path)",
        ));
    };
    let directive = options
        .directive
        .clone()
        .unwrap_or_else(|| "use server".to_string());

    let source_type = source_type_for_filename(Some(filename))?;
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

    let hash = xxhash::xxhash32_hex(&relative_id(options.root.as_deref(), filename));

    let mut program = parsed.program;

    // Closure-capture validation for function-level directives. Module-level
    // directives are unaffected: the whole module runs on the server, so its
    // closures survive intact.
    let is_module_level = program
        .directives
        .iter()
        .any(|entry| entry.expression.value == directive);
    if !is_module_level {
        validate::validate_captures(&program, &code, filename, &directive)
            .map_err(Error::from_reason)?;
    }

    let mut pass = DirectivesTransform::new(
        &allocator,
        mode,
        env,
        directive,
        hash,
        import_def(options.register.as_ref(), "registerServerReference"),
        import_def(options.create.as_ref(), "createServerReference"),
    );
    pass.run(&mut program);

    let valid = pass.valid;
    let functions = pass
        .functions
        .iter()
        .map(|function| ServerFunctionMeta {
            id: function.id.clone(),
            name: function.name.clone(),
            exports: function.exports.clone(),
        })
        .collect();
    let needs_dce = pass.needs_dce();
    let orphans = std::mem::take(&mut pass.orphans);
    drop(pass);

    let source_map = options.source_map.unwrap_or(false);
    let codegen = |program: &oxc_ast::ast::Program<'_>| {
        let build = Codegen::new()
            .with_options(CodegenOptions {
                source_map_path: source_map.then(|| std::path::PathBuf::from(filename)),
                ..CodegenOptions::default()
            })
            .build(program);
        (build.code, build.map.map(|map| map.to_json_string()))
    };

    let (build_code, build_map) = codegen(&program);
    let (code, map) = if needs_dce {
        // Babel's `removeUnusedVariables` fixpoint. This port re-parses
        // printed output between passes, so when it runs the source map is
        // regenerated relative to the pre-DCE output (a known limitation of
        // this milestone).
        let cleaned =
            dce::remove_unused_variables(build_code, source_type, orphans, env == Env::Development);
        if source_map {
            let allocator = Allocator::default();
            let reparsed = Parser::new(&allocator, &cleaned, source_type)
                .with_options(ParseOptions {
                    preserve_parens: false,
                    ..ParseOptions::default()
                })
                .parse();
            codegen(&reparsed.program)
        } else {
            (cleaned, None)
        }
    } else {
        (build_code, build_map)
    };

    Ok(TransformDirectivesResult {
        code,
        map,
        valid,
        functions,
    })
}

fn import_def(option: Option<&DirectiveImportOption>, default_name: &str) -> ImportDef {
    match option {
        Some(option) => ImportDef {
            kind: if option.kind.as_deref() == Some("default") {
                ImportKind::Default
            } else {
                ImportKind::Named
            },
            name: option
                .name
                .clone()
                .unwrap_or_else(|| default_name.to_string()),
            source: option.source.clone(),
        },
        None => ImportDef {
            kind: ImportKind::Named,
            name: default_name.to_string(),
            source: DEFAULT_RUNTIME.to_string(),
        },
    }
}

/// Node's `path.relative(root, id)` with separators normalized to `/` — the
/// hash input contract shared with the Babel implementation's `compile()`.
/// Also reused by the refresh pass for cwd-relative `location` strings.
pub(crate) fn relative_id(root: Option<&str>, filename: &str) -> String {
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));
    let root = normalize(&cwd, root.map(std::path::Path::new).unwrap_or(&cwd));
    let file = normalize(&cwd, std::path::Path::new(filename));

    let mut root_parts = root.iter().peekable();
    let mut file_parts = file.iter().peekable();
    while let (Some(a), Some(b)) = (root_parts.peek(), file_parts.peek()) {
        if a != b {
            break;
        }
        root_parts.next();
        file_parts.next();
    }
    let mut parts: Vec<String> = Vec::new();
    for _ in root_parts {
        parts.push("..".to_string());
    }
    for part in file_parts {
        parts.push(part.to_string_lossy().into_owned());
    }
    parts.join("/")
}

/// Resolve against `cwd` and fold `.`/`..` segments (Node `path.resolve`).
fn normalize(cwd: &std::path::Path, path: &std::path::Path) -> std::path::PathBuf {
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    let mut result = std::path::PathBuf::new();
    for component in joined.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                result.pop();
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}
