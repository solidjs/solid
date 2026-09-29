//! Program-wide facts the `optimize` pass needs before it may rewrite
//! anything: which identifier references carry a known constant value, and
//! which JSX tags actually resolve to Solid's own control-flow components.
//!
//! Both answers come from `oxc_semantic`, so they are exact at any scope. A
//! reference is resolved to the symbol it binds to, and only that symbol's
//! declaration decides the answer: a `const` in a function body folds the
//! same way a module-level one does, and a same-named binding elsewhere in
//! the program is simply a different symbol and does not interfere.
//!
//! Facts are keyed by the source span of the reference rather than by name,
//! so the folding pass can look one up without carrying a scope stack of its
//! own. Spans are stable across the rewrite: the pass never renumbers a node
//! it keeps, and the nodes it creates are literals and intrinsic tags that no
//! lookup asks about.

use std::collections::HashMap;

use oxc_ast::ast::{
    ImportDeclarationSpecifier, ModuleExportName, Program, VariableDeclarationKind,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_syntax::symbol::SymbolId;

use super::value::{Const, ConstantEnv, evaluate};

/// What a JSX tag identifier resolves to.
enum TagBinding {
    /// Nothing in the program declares the name, so the compiler's own
    /// auto-import supplies it.
    Unbound,
    /// A named import, carrying the name the source module exports.
    Import { imported: String, source: String },
    /// Some other binding: a local, a parameter, an unrelated import form.
    Local,
}

pub(crate) struct ProgramFacts {
    /// The constant each identifier reference resolves to, keyed by the
    /// reference's span start.
    pub(crate) constants: ConstantEnv,
    /// What each identifier reference binds to, keyed by span start.
    tags: HashMap<u32, TagBinding>,
}

impl ProgramFacts {
    /// The built-in a JSX tag names, given the tag's own spelling and the
    /// module specifiers a Solid import may come from.
    ///
    /// An import decides the identity by its *exported* name, so
    /// `import { Show as Cond }` answers `Show` for a `<Cond>` tag. With no
    /// binding at all the tag is the auto-imported built-in of the same
    /// name. Every other binding is somebody else's component.
    pub(crate) fn tag_identity<'f>(
        &'f self,
        span_start: u32,
        name: &'f str,
        sources: &[&str],
    ) -> Option<&'f str> {
        match self.tags.get(&span_start)? {
            TagBinding::Unbound => Some(name),
            TagBinding::Import { imported, source } => sources
                .iter()
                .any(|candidate| *candidate == source)
                .then_some(imported.as_str()),
            TagBinding::Local => None,
        }
    }
}

pub(crate) fn collect_facts(program: &Program<'_>) -> ProgramFacts {
    // Populates the node, symbol, and reference ids the AST carries in its
    // own cells; nothing downstream reads them, so this is additive.
    let semantic = SemanticBuilder::new().build(program).semantic;
    let scoping = semantic.scoping();

    // Pass one walks in source order and records the value of every constant
    // declaration, evaluating each initializer against the constants already
    // seen. Source order is what keeps `const A = B; const B = 1;` from
    // folding `A` to a value the runtime would never reach.
    let mut collector = Collector {
        scoping,
        constants: ConstantEnv::new(),
        values: HashMap::new(),
        imports: HashMap::new(),
        tags: HashMap::new(),
        resolve_tags: false,
    };
    collector.visit_program(program);

    // Pass two resolves every remaining reference against the finished set,
    // so a use site earlier in the file than its declaration still folds,
    // and records what each tag binds to.
    collector.resolve_tags = true;
    collector.visit_program(program);

    ProgramFacts {
        constants: collector.constants,
        tags: collector.tags,
    }
}

/// The globals worth folding. They only apply to a reference that resolves to
/// no symbol, which is exactly the case where the global is what runs.
fn global_value(name: &str) -> Option<Const> {
    match name {
        "undefined" => Some(Const::Undefined),
        "NaN" => Some(Const::Number(f64::NAN)),
        "Infinity" => Some(Const::Number(f64::INFINITY)),
        _ => None,
    }
}

struct Collector<'s> {
    scoping: &'s Scoping,
    constants: ConstantEnv,
    values: HashMap<SymbolId, Const>,
    imports: HashMap<SymbolId, (String, String)>,
    tags: HashMap<u32, TagBinding>,
    resolve_tags: bool,
}

impl<'a> Visit<'a> for Collector<'_> {
    fn visit_import_declaration(&mut self, it: &oxc_ast::ast::ImportDeclaration<'a>) {
        if it.import_kind.is_value() {
            for specifier in it.specifiers.iter().flatten() {
                let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                    continue;
                };
                let Some(symbol) = specifier.local.symbol_id.get() else {
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
                self.imports
                    .insert(symbol, (imported, it.source.value.to_string()));
            }
        }
        walk::walk_import_declaration(self, it);
    }

    fn visit_variable_declaration(&mut self, it: &oxc_ast::ast::VariableDeclaration<'a>) {
        walk::walk_variable_declaration(self, it);
        // `var` is excluded: it is readable before its declaration runs, and
        // such a read sees `undefined` rather than throwing, so folding it to
        // the initializer would silently change the result. `let` qualifies
        // when nothing ever writes to it.
        if !matches!(
            it.kind,
            VariableDeclarationKind::Const | VariableDeclarationKind::Let
        ) {
            return;
        }
        for declarator in &it.declarations {
            let Some(binding) = declarator.id.get_binding_identifier() else {
                continue;
            };
            let Some(symbol) = binding.symbol_id.get() else {
                continue;
            };
            let Some(init) = &declarator.init else {
                continue;
            };
            if self.scoping.symbol_is_mutated(symbol) {
                continue;
            }
            if let Some(value) = evaluate(init, &self.constants) {
                self.values.insert(symbol, value);
            }
        }
    }

    fn visit_identifier_reference(&mut self, it: &oxc_ast::ast::IdentifierReference<'a>) {
        let symbol = it
            .reference_id
            .get()
            .and_then(|reference| self.scoping.get_reference(reference).symbol_id());
        let value = match symbol {
            Some(symbol) => self.values.get(&symbol).cloned(),
            None => global_value(it.name.as_str()),
        };
        if let Some(value) = value {
            self.constants.insert(it.span.start, value);
        }
        if self.resolve_tags {
            let binding = match symbol {
                None => TagBinding::Unbound,
                Some(symbol) => match self.imports.get(&symbol) {
                    Some((imported, source)) => TagBinding::Import {
                        imported: imported.clone(),
                        source: source.clone(),
                    },
                    None => TagBinding::Local,
                },
            };
            self.tags.insert(it.span.start, binding);
        }
    }
}
