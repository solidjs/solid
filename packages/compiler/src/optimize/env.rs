//! Program-wide facts the `optimize` pass needs before it may rewrite
//! anything: which names carry a known constant value, and which names
//! actually resolve to Solid's own control-flow components.
//!
//! Both answers rest on the same observation, which removes the need for a
//! scope model: a name the whole program declares exactly once cannot be
//! shadowed by anything but that one declaration, so every reference to it
//! resolves there. A name declared twice, or written to anywhere, is simply
//! not eligible.

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{
    Declaration, ImportDeclarationSpecifier, ModuleExportName, Program, Statement,
    VariableDeclarationKind,
};
use oxc_ast_visit::{Visit, walk};

use super::value::{Const, ConstantEnv, evaluate};

/// The globals worth folding, admitted only when the program never declares
/// or writes the name itself.
const FOLDABLE_GLOBALS: [&str; 3] = ["undefined", "NaN", "Infinity"];

/// A named import binding at the top level of the module.
pub(crate) struct ImportBinding {
    /// The name as exported by the source module, which is what identifies
    /// the component (`import { Show as Cond }` imports `Show`).
    pub(crate) imported: String,
    pub(crate) source: String,
}

pub(crate) struct ProgramFacts {
    pub(crate) constants: ConstantEnv,
    /// How many times each name is declared anywhere in the program.
    declared: HashMap<String, usize>,
    /// Top-level value imports, keyed by their local name.
    imports: HashMap<String, ImportBinding>,
}

impl ProgramFacts {
    /// The exported name `local` was imported under, when it comes from one
    /// of `sources`. The exported name is the component's identity, so an
    /// alias resolves to what it renamed: `import { Show as Cond }` answers
    /// `Show` for `Cond`.
    ///
    /// A name the program declares more than once could resolve to either
    /// declaration, so it does not qualify.
    pub(crate) fn solid_import(&self, local: &str, sources: &[&str]) -> Option<&str> {
        if self.declared.get(local) != Some(&1) {
            return None;
        }
        let import = self.imports.get(local)?;
        sources
            .iter()
            .any(|source| *source == import.source)
            .then_some(import.imported.as_str())
    }
}

pub(crate) fn collect_facts(program: &Program<'_>) -> ProgramFacts {
    let mut scan = Scan::default();
    scan.visit_program(program);

    let mut constants = ConstantEnv::new();
    for name in FOLDABLE_GLOBALS {
        if !scan.declared.contains_key(name) && !scan.reassigned.contains(name) {
            constants.insert(
                name.to_string(),
                match name {
                    "NaN" => Const::Number(f64::NAN),
                    "Infinity" => Const::Number(f64::INFINITY),
                    _ => Const::Undefined,
                },
            );
        }
    }

    let mut imports = HashMap::new();
    // Module-level `const`s execute top to bottom, so evaluating each
    // initializer against the environment built so far lets a later constant
    // be defined in terms of an earlier one.
    for statement in &program.body {
        if let Statement::ImportDeclaration(import) = statement {
            if !import.import_kind.is_value() {
                continue;
            }
            for specifier in import.specifiers.iter().flatten() {
                let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                    continue;
                };
                if !specifier.import_kind.is_value() {
                    continue;
                }
                let imported = match &specifier.imported {
                    ModuleExportName::IdentifierName(name) => name.name.to_string(),
                    ModuleExportName::IdentifierReference(name) => name.name.to_string(),
                    ModuleExportName::StringLiteral(name) => name.value.to_string(),
                };
                imports.insert(
                    specifier.local.name.to_string(),
                    ImportBinding {
                        imported,
                        source: import.source.value.to_string(),
                    },
                );
            }
            continue;
        }
        let declaration = match statement {
            Statement::VariableDeclaration(declaration) => &**declaration,
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::VariableDeclaration(declaration) => &**declaration,
                _ => continue,
            },
            _ => continue,
        };
        if declaration.kind != VariableDeclarationKind::Const {
            continue;
        }
        for declarator in &declaration.declarations {
            let Some(name) = declarator.id.get_binding_identifier() else {
                continue;
            };
            let name = name.name.as_str();
            if scan.declared.get(name) != Some(&1) || scan.reassigned.contains(name) {
                continue;
            }
            let Some(init) = &declarator.init else {
                continue;
            };
            if let Some(value) = evaluate(init, &constants) {
                constants.insert(name.to_string(), value);
            }
        }
    }

    ProgramFacts {
        constants,
        declared: scan.declared,
        imports,
    }
}

/// Counts every binding of every name in the program and records every name
/// written to, at any depth.
#[derive(Default)]
struct Scan {
    declared: HashMap<String, usize>,
    reassigned: HashSet<String>,
}

impl<'a> Visit<'a> for Scan {
    fn visit_binding_identifier(&mut self, it: &oxc_ast::ast::BindingIdentifier<'a>) {
        *self.declared.entry(it.name.to_string()).or_default() += 1;
    }

    fn visit_assignment_target(&mut self, it: &oxc_ast::ast::AssignmentTarget<'a>) {
        if let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) = it {
            self.reassigned.insert(identifier.name.to_string());
        }
        walk::walk_assignment_target(self, it);
    }

    fn visit_update_expression(&mut self, it: &oxc_ast::ast::UpdateExpression<'a>) {
        if let oxc_ast::ast::SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) =
            &it.argument
        {
            self.reassigned.insert(identifier.name.to_string());
        }
        walk::walk_update_expression(self, it);
    }
}
