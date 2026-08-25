//! `"use server"` directive pass, ported from the Babel implementation in
//! vite-plugin-solid (`src/server-functions/plugin.ts`, hoisted from
//! solid-start). Two forms are supported:
//!
//! - Function-level `"use server"` (first statement of a function body): the
//!   function is registered on the server (`register`) and replaced on both
//!   sides by a callable reference (`create`) addressed by a build-stable ID.
//! - Module-level `"use server"` (first statement of the module): every
//!   exported function becomes a server function. The client build's module
//!   body is replaced entirely by reference exports, so server-only code
//!   never reaches the browser.
//!
//! The port aims for output parity with the Babel plugin (checked by the
//! directives parity suite in `__tests__/`), including generated identifier
//! naming (`serverFunction_1`, `fn_1`, `registerServerReference_1`, ...)
//! and statement ordering.

use oxc_allocator::{Allocator, Vec as ArenaVec};
use oxc_ast::ast::{
    BindingPattern, Declaration, ExportDefaultDeclarationKind, Expression, FunctionType,
    ImportOrExportKind, Program, Statement, VariableDeclarationKind,
};
use oxc_ast_visit::{VisitMut, walk_mut};
use oxc_span::Span;

use crate::shared::ast::{expression_to_argument, variable_statement};
use crate::shared::ast_builder::AstBuilder;

const SPAN: Span = Span::new(0, 0);

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    Server,
    Client,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Env {
    Production,
    Development,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ImportKind {
    Named,
    Default,
}

pub(crate) struct ImportDef {
    pub(crate) kind: ImportKind,
    pub(crate) name: String,
    pub(crate) source: String,
}

pub(crate) struct FunctionMeta {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) exports: Vec<String>,
}

pub(crate) struct DirectivesTransform<'a> {
    allocator: &'a Allocator,
    mode: Mode,
    env: Env,
    directive: String,
    hash: String,
    count: u32,
    register: ImportDef,
    create: ImportDef,
    /// Babel's `generateUniqueName` collision set: every binding identifier,
    /// identifier reference, and label in the original program, plus every
    /// name generated so far (Babel records generated uids on the program
    /// scope).
    taken: std::collections::HashSet<String>,
    /// `source[name]` -> local, mirroring the Babel `imports` map.
    import_locals: Vec<(String, String)>,
    /// Runtime imports in final order. Babel unshifts each new import to the
    /// program front, so later imports print above earlier ones; we push to
    /// the front here and splice the whole list to the top at the end.
    prepended_imports: Vec<Statement<'a>>,
    pub(crate) functions: Vec<FunctionMeta>,
    pub(crate) valid: bool,
    /// Names referenced from the client-mode replaced function subtrees —
    /// the only bindings the DCE pass may shake (plus cascades). Mirrors the
    /// Babel implementation's `StateContext.orphans`.
    pub(crate) orphans: std::collections::HashSet<String>,
    module_level_applied: bool,
}

enum RuntimeImport {
    Register,
    Create,
}

impl<'a> DirectivesTransform<'a> {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        allocator: &'a Allocator,
        mode: Mode,
        env: Env,
        directive: String,
        hash: String,
        register: ImportDef,
        create: ImportDef,
    ) -> Self {
        Self {
            allocator,
            mode,
            env,
            directive,
            hash,
            count: 0,
            register,
            create,
            taken: std::collections::HashSet::new(),
            import_locals: Vec::new(),
            prepended_imports: Vec::new(),
            functions: Vec::new(),
            valid: false,
            orphans: std::collections::HashSet::new(),
            module_level_applied: false,
        }
    }

    fn ast(&self) -> AstBuilder<'a> {
        AstBuilder::new(self.allocator)
    }

    /// Whether the pass replaced any function bodies on the client, which
    /// requires the dead-code-elimination pass Babel runs afterwards.
    pub(crate) fn needs_dce(&self) -> bool {
        // Babel runs `removeUnusedVariables` only on the function-level path
        // (module-level client output is rebuilt from scratch instead).
        self.valid && self.count > 0 && !self.module_level_applied
    }

    pub(crate) fn run(&mut self, program: &mut Program<'a>) {
        self.scan_taken_names(program);
        let is_module_level = program
            .directives
            .iter()
            .any(|directive| directive.expression.value == self.directive);
        if is_module_level {
            self.module_level_applied = true;
            program
                .directives
                .retain(|directive| directive.expression.value != self.directive);
            self.transform_module_level(program);
            self.valid = true;
        } else {
            self.transform_function_level(program);
            if self.count > 0 {
                self.valid = true;
            }
        }
        // Splice the runtime imports (already in Babel's final order) above
        // everything else, matching `unshiftContainer` on the program body.
        for import in self.prepended_imports.drain(..).rev() {
            program.body.insert(0, import);
        }
    }

    // --- Naming -------------------------------------------------------------

    fn scan_taken_names(&mut self, program: &Program<'a>) {
        use oxc_ast_visit::Visit;

        struct TakenNames<'t> {
            taken: &'t mut std::collections::HashSet<String>,
        }

        impl<'b> Visit<'b> for TakenNames<'_> {
            fn visit_binding_identifier(&mut self, it: &oxc_ast::ast::BindingIdentifier<'b>) {
                self.taken.insert(it.name.to_string());
            }
            fn visit_identifier_reference(&mut self, it: &oxc_ast::ast::IdentifierReference<'b>) {
                self.taken.insert(it.name.to_string());
            }
            fn visit_label_identifier(&mut self, it: &oxc_ast::ast::LabelIdentifier<'b>) {
                self.taken.insert(it.name.to_string());
            }
        }

        let mut collector = TakenNames {
            taken: &mut self.taken,
        };
        collector.visit_program(program);
    }

    /// Names in reference positions within a replaced subtree, recorded as
    /// orphan candidates for the DCE pass (Babel's `collectReferencedNames`).
    fn collect_orphan_references(&mut self, expression: &Expression<'a>) {
        use oxc_ast_visit::Visit;

        struct ReferencedNames<'t> {
            names: &'t mut std::collections::HashSet<String>,
        }

        impl<'b> Visit<'b> for ReferencedNames<'_> {
            fn visit_identifier_reference(&mut self, it: &oxc_ast::ast::IdentifierReference<'b>) {
                self.names.insert(it.name.to_string());
            }
        }

        let mut collector = ReferencedNames {
            names: &mut self.orphans,
        };
        collector.visit_expression(expression);
    }

    /// Babel's `generateUniqueName`: `name_1`, `name_2`, ... skipping any
    /// name in the collision set.
    fn generate_unique_name(&mut self, name: &str) -> String {
        let mut i = 1u32;
        loop {
            let candidate = format!("{name}_{i}");
            if !self.taken.contains(&candidate) {
                self.taken.insert(candidate.clone());
                return candidate;
            }
            i += 1;
        }
    }

    /// Babel's `createID`: `<hash>-<count>` with the descriptive name
    /// appended in development for readable IDs.
    fn create_id(&mut self, name: &str) -> String {
        let base = format!("{}-{}", self.hash, self.count);
        self.count += 1;
        match self.env {
            Env::Development => format!("{base}-{name}"),
            Env::Production => base,
        }
    }

    /// Babel's `getImportIdentifier`: dedupe by `source[name]`, generating
    /// the import declaration on first use.
    fn import_local(&mut self, which: RuntimeImport) -> String {
        let def = match which {
            RuntimeImport::Register => &self.register,
            RuntimeImport::Create => &self.create,
        };
        let name = match def.kind {
            ImportKind::Named => def.name.clone(),
            ImportKind::Default => "default".to_string(),
        };
        let key = format!("{}[{}]", def.source, name);
        if let Some((_, local)) = self.import_locals.iter().find(|(k, _)| *k == key) {
            return local.clone();
        }
        let source = def.source.clone();
        let kind = def.kind;
        let local = self.generate_unique_name(&name);
        let ast = self.ast();
        let specifier = match kind {
            ImportKind::Named => ast.import_declaration_specifier_import_specifier(
                SPAN,
                ast.module_export_name_identifier_name(SPAN, ast.ident(&name)),
                ast.binding_identifier(SPAN, ast.ident(&local)),
                ImportOrExportKind::Value,
            ),
            ImportKind::Default => ast.import_declaration_specifier_import_default_specifier(
                SPAN,
                ast.binding_identifier(SPAN, ast.ident(&local)),
            ),
        };
        let import = Statement::ImportDeclaration(ast.alloc_import_declaration(
            SPAN,
            Some(ast.vec1(specifier)),
            ast.string_literal(SPAN, ast.str(&source), None),
            None,
            None,
            ImportOrExportKind::Value,
        ));
        self.prepended_imports.insert(0, import);
        self.import_locals.push((key, local.clone()));
        local
    }

    // --- Small AST builders ---------------------------------------------------

    fn identifier(&self, name: &str) -> Expression<'a> {
        let ast = self.ast();
        ast.expression_identifier(SPAN, ast.ident(name))
    }

    fn string(&self, value: &str) -> Expression<'a> {
        let ast = self.ast();
        ast.expression_string_literal(SPAN, ast.str(value), None)
    }

    /// Dev-only trailing `name` argument for the reference calls —
    /// `registerServerReference(id, fn, name)` on the server,
    /// `createServerReference(id, name)` on the client — seeding the runtime
    /// metadata channel with a human-readable label for dev tooling. The
    /// argument is trailing/optional (out-of-band consumers are unaffected),
    /// production output emits nothing (byte-identical to before), and
    /// anonymous extractions emit nothing.
    fn dev_name_argument(&self, name: &str) -> Option<Expression<'a>> {
        (self.env == Env::Development && name != "anonymous").then(|| self.string(name))
    }

    fn call(&self, callee: &str, args: Vec<Expression<'a>>) -> Expression<'a> {
        let ast = self.ast();
        let mut arguments = ast.vec_with_capacity(args.len());
        for arg in args {
            arguments.push(expression_to_argument(arg));
        }
        ast.expression_call(SPAN, self.identifier(callee), None, arguments, false)
    }

    fn const_statement(&self, name: &str, init: Expression<'a>) -> Statement<'a> {
        variable_statement(
            self.allocator,
            SPAN,
            VariableDeclarationKind::Const,
            name,
            init,
        )
    }

    /// Babel's `bubbleFunctionDeclaration` const: `const name = function
    /// name(params) { body }`. `t.functionExpression` drops TS return types
    /// and type parameters, so those clear here too.
    fn function_declaration_to_const(
        &self,
        function: oxc_allocator::Box<'a, oxc_ast::ast::Function<'a>>,
    ) -> Statement<'a> {
        let mut function = function;
        function.r#type = FunctionType::FunctionExpression;
        function.declare = false;
        function.type_parameters = None;
        function.return_type = None;
        let name = function
            .id
            .as_ref()
            .expect("bubbled function declarations always carry a name")
            .name
            .to_string();
        self.const_statement(&name, Expression::FunctionExpression(function))
    }

    fn export_named_specifier_statement(&self, local: &str, exported: &str) -> Statement<'a> {
        let ast = self.ast();
        let specifier = ast.export_specifier(
            SPAN,
            ast.module_export_name_identifier_reference(SPAN, ast.ident(local)),
            ast.module_export_name_identifier_name(SPAN, ast.ident(exported)),
            ImportOrExportKind::Value,
        );
        Statement::ExportNamedDeclaration(ast.alloc_export_named_declaration(
            SPAN,
            ast.vec1(specifier),
            ImportOrExportKind::Value,
        ))
    }

    // --- Module-level directive ------------------------------------------------

    fn transform_module_level(&mut self, program: &mut Program<'a>) {
        self.bubble_top_level_functions(program);

        let bindings = collect_top_level_bindings(program);
        let exports = collect_exported_bindings(program, &bindings);

        match self.mode {
            Mode::Server => self.module_level_server(program, &exports),
            Mode::Client => self.module_level_client(program, &exports),
        }
    }

    /// Rewrites top-level function declarations into `const` function
    /// expressions unshifted to the program front (Babel's
    /// `bubbleFunctionDeclaration` over top-level statements). Because each
    /// declaration is unshifted as it's visited, the hoisted block prints in
    /// reverse source order.
    fn bubble_top_level_functions(&mut self, program: &mut Program<'a>) {
        let ast = self.ast();
        let old = std::mem::replace(&mut program.body, ast.vec());
        let mut hoisted: Vec<Statement<'a>> = Vec::new();
        let mut rest: Vec<Statement<'a>> = Vec::new();
        for statement in old {
            match statement {
                Statement::FunctionDeclaration(function) if function.id.is_some() => {
                    hoisted.push(self.function_declaration_to_const(function));
                }
                Statement::ExportDeclaration(export)
                    if matches!(
                        &export.declaration,
                        Declaration::FunctionDeclaration(function) if function.id.is_some()
                    ) =>
                {
                    let export = export.unbox();
                    let Declaration::FunctionDeclaration(function) = export.declaration else {
                        unreachable!("shape checked above");
                    };
                    let name = function.id.as_ref().unwrap().name.to_string();
                    hoisted.push(self.function_declaration_to_const(function));
                    rest.push(self.export_named_specifier_statement(&name, &name));
                }
                Statement::ExportDefaultDeclaration(export)
                    if matches!(
                        &export.declaration,
                        ExportDefaultDeclarationKind::FunctionDeclaration(function)
                            if function.id.is_some()
                    ) =>
                {
                    let mut export = export;
                    let placeholder =
                        ExportDefaultDeclarationKind::from(ast.expression_null_literal(SPAN));
                    let ExportDefaultDeclarationKind::FunctionDeclaration(function) =
                        std::mem::replace(&mut export.declaration, placeholder)
                    else {
                        unreachable!("shape checked above");
                    };
                    let name = function.id.as_ref().unwrap().name.to_string();
                    hoisted.push(self.function_declaration_to_const(function));
                    export.declaration = ExportDefaultDeclarationKind::from(self.identifier(&name));
                    rest.push(Statement::ExportDefaultDeclaration(export));
                }
                other => rest.push(other),
            }
        }
        program.body.extend(hoisted.into_iter().rev());
        program.body.extend(rest);
    }

    fn module_level_server(&mut self, program: &mut Program<'a>, exports: &ExportedBindings) {
        // (statement index, statement) insertions, applied before the
        // indexed statement in call order.
        let mut insertions: Vec<(usize, Statement<'a>)> = Vec::new();

        for &key in &exports.unique {
            let name = binding_descriptive_name(program, key);
            let Some(name) = name else { continue };
            let exported_names = exports.exported_names_for(key);
            let fn_id = self.create_id(&name);
            // Babel's order inside `transformFunction`: register import
            // first, then the `serverFunction_N` uid, then (during
            // `replaceWith`) the create import.
            let register_local = self.import_local(RuntimeImport::Register);
            let source_local = self.generate_unique_name("serverFunction");
            let create_local = self.import_local(RuntimeImport::Create);

            let Some(slot) = binding_init_function_slot(program, key) else {
                continue;
            };
            let function_expression = std::mem::replace(
                slot,
                self.call(&create_local, vec![self.identifier(&source_local)]),
            );
            let mut register_args = vec![self.string(&fn_id), function_expression];
            if let Some(name_argument) = self.dev_name_argument(&name) {
                register_args.push(name_argument);
            }
            insertions.push((
                key.statement,
                self.const_statement(&source_local, self.call(&register_local, register_args)),
            ));
            self.functions.push(FunctionMeta {
                id: fn_id,
                name,
                exports: exported_names,
            });
        }

        apply_insertions(self.allocator, program, insertions);
    }

    fn module_level_client(&mut self, program: &mut Program<'a>, exports: &ExportedBindings) {
        let ast = self.ast();

        // IDs are generated per unique binding, in trace order.
        let mut source_ids: Vec<(BindingKey, String, String)> = Vec::new();
        for &key in &exports.unique {
            let Some(name) = binding_descriptive_name(program, key) else {
                continue;
            };
            let id = self.create_id(&name);
            self.functions.push(FunctionMeta {
                id: id.clone(),
                name: name.clone(),
                exports: exports.exported_names_for(key),
            });
            source_ids.push((key, id, name));
        }

        // The client build keeps none of the module: every export becomes a
        // reference and everything else (server-only imports, helpers,
        // secrets) is dropped wholesale.
        program.body = ast.vec();

        let mut declared: Vec<(BindingKey, String)> = Vec::new();
        let mut declarators = ast.vec();
        let mut specifiers = ast.vec();

        for (exported, key) in &exports.exported {
            let local = if let Some((_, local)) = declared.iter().find(|(k, _)| k == key) {
                Some(local.clone())
            } else {
                let local = self.generate_unique_name("fn");
                let Some((_, fn_id, name)) = source_ids.iter().find(|(k, _, _)| k == key) else {
                    continue;
                };
                let fn_id = fn_id.clone();
                let name = name.clone();
                let create_local = self.import_local(RuntimeImport::Create);
                let mut create_args = vec![self.string(&fn_id)];
                if let Some(name_argument) = self.dev_name_argument(&name) {
                    create_args.push(name_argument);
                }
                let ast = self.ast();
                declarators.push(ast.variable_declarator(
                    SPAN,
                    VariableDeclarationKind::Const,
                    ast.binding_pattern_binding_identifier(SPAN, ast.ident(&local)),
                    None,
                    Some(self.call(&create_local, create_args)),
                    false,
                ));
                declared.push((*key, local.clone()));
                Some(local)
            };
            if let Some(local) = local {
                let ast = self.ast();
                // Babel emits `export { fn_1 as "name" }` with a string
                // literal exported name.
                specifiers.push(ast.export_specifier(
                    SPAN,
                    ast.module_export_name_identifier_reference(SPAN, ast.ident(&local)),
                    ast.module_export_name_string_literal(SPAN, ast.str(exported), None),
                    ImportOrExportKind::Value,
                ));
            }
        }

        let ast = self.ast();
        if !declarators.is_empty() {
            program.body.push(Statement::VariableDeclaration(
                ast.alloc_variable_declaration(
                    SPAN,
                    VariableDeclarationKind::Const,
                    declarators,
                    false,
                ),
            ));
        }
        if !specifiers.is_empty() {
            program.body.push(Statement::ExportNamedDeclaration(
                ast.alloc_export_named_declaration(SPAN, specifiers, ImportOrExportKind::Value),
            ));
        }
    }

    // --- Function-level directives ----------------------------------------------

    fn transform_function_level(&mut self, program: &mut Program<'a>) {
        {
            let mut bubbler = Bubbler { transform: self };
            bubbler.visit_program(program);
        }
        let mut visitor = FunctionLevelVisitor {
            transform: self,
            top_index: 0,
            insertions: Vec::new(),
            name_stack: Vec::new(),
        };
        visitor.visit_program(program);
        let insertions = std::mem::take(&mut visitor.insertions);
        apply_insertions(self.allocator, program, insertions);
    }

    /// Shared function-body directive transform (Babel's `transformFunction`
    /// with `direct: false` semantics already applied by the caller).
    fn transform_marked_function(
        &mut self,
        expression: &mut Expression<'a>,
        name: &str,
        top_index: usize,
        insertions: &mut Vec<(usize, Statement<'a>)>,
    ) {
        let fn_id = self.create_id(name);
        self.functions.push(FunctionMeta {
            id: fn_id.clone(),
            name: name.to_string(),
            exports: Vec::new(),
        });
        match self.mode {
            Mode::Server => {
                let register_local = self.import_local(RuntimeImport::Register);
                let source_local = self.generate_unique_name("serverFunction");
                let create_local = self.import_local(RuntimeImport::Create);
                let function_expression = std::mem::replace(
                    expression,
                    self.call(&create_local, vec![self.identifier(&source_local)]),
                );
                let mut register_args = vec![self.string(&fn_id), function_expression];
                if let Some(name_argument) = self.dev_name_argument(name) {
                    register_args.push(name_argument);
                }
                insertions.push((
                    top_index,
                    self.const_statement(&source_local, self.call(&register_local, register_args)),
                ));
            }
            Mode::Client => {
                let create_local = self.import_local(RuntimeImport::Create);
                let mut create_args = vec![self.string(&fn_id)];
                if let Some(name_argument) = self.dev_name_argument(name) {
                    create_args.push(name_argument);
                }
                let replaced = std::mem::replace(expression, self.call(&create_local, create_args));
                // The function subtree is discarded on the client: whatever
                // it referenced may now be orphaned, and only those bindings
                // are eligible for the post-transform shake.
                self.collect_orphan_references(&replaced);
            }
        }
    }
}

// --- Bubbling (function-level path) ------------------------------------------

/// Babel's function-level pre-pass bubbles *every* function declaration to a
/// `const` at the top of its enclosing block (so exports keep working and the
/// directive transform only has to handle expression forms). Declarations
/// nested inside another bubbled declaration are skipped, matching Babel's
/// `tmp.skip()`.
struct Bubbler<'ctx, 'a> {
    transform: &'ctx mut DirectivesTransform<'a>,
}

impl<'a> VisitMut<'a> for Bubbler<'_, 'a> {
    fn visit_statements(&mut self, statements: &mut ArenaVec<'a, Statement<'a>>) {
        let ast = self.transform.ast();
        let old = std::mem::replace(statements, ast.vec());
        let mut hoisted: Vec<Statement<'a>> = Vec::new();
        let mut rest: Vec<Statement<'a>> = Vec::new();
        for statement in old {
            match statement {
                Statement::FunctionDeclaration(function) if function.id.is_some() => {
                    hoisted.push(self.transform.function_declaration_to_const(function));
                }
                Statement::ExportDeclaration(export)
                    if matches!(
                        &export.declaration,
                        Declaration::FunctionDeclaration(function) if function.id.is_some()
                    ) =>
                {
                    let export = export.unbox();
                    let Declaration::FunctionDeclaration(function) = export.declaration else {
                        unreachable!("shape checked above");
                    };
                    let name = function.id.as_ref().unwrap().name.to_string();
                    hoisted.push(self.transform.function_declaration_to_const(function));
                    rest.push(
                        self.transform
                            .export_named_specifier_statement(&name, &name),
                    );
                }
                Statement::ExportDefaultDeclaration(export)
                    if matches!(
                        &export.declaration,
                        ExportDefaultDeclarationKind::FunctionDeclaration(function)
                            if function.id.is_some()
                    ) =>
                {
                    let mut export = export;
                    let placeholder =
                        ExportDefaultDeclarationKind::from(ast.expression_null_literal(SPAN));
                    let ExportDefaultDeclarationKind::FunctionDeclaration(function) =
                        std::mem::replace(&mut export.declaration, placeholder)
                    else {
                        unreachable!("shape checked above");
                    };
                    let name = function.id.as_ref().unwrap().name.to_string();
                    hoisted.push(self.transform.function_declaration_to_const(function));
                    export.declaration =
                        ExportDefaultDeclarationKind::from(self.transform.identifier(&name));
                    rest.push(Statement::ExportDefaultDeclaration(export));
                }
                mut other => {
                    walk_mut::walk_statement(self, &mut other);
                    rest.push(other);
                }
            }
        }
        statements.extend(hoisted.into_iter().rev());
        statements.extend(rest);
    }
}

// --- Function-level traversal ---------------------------------------------------

struct FunctionLevelVisitor<'ctx, 'a> {
    transform: &'ctx mut DirectivesTransform<'a>,
    /// Index of the top-level statement currently being traversed — Babel's
    /// `getRootStatementPath` insertion anchor.
    top_index: usize,
    insertions: Vec<(usize, Statement<'a>)>,
    /// Nearest-binding names for `getDescriptiveName` (variable declarators
    /// with identifier ids; named function expressions use their own id).
    name_stack: Vec<String>,
}

impl<'a> FunctionLevelVisitor<'_, 'a> {
    fn body_has_directive(&self, body: &oxc_ast::ast::FunctionBody<'a>) -> bool {
        body.directives
            .iter()
            .any(|directive| directive.expression.value == self.transform.directive)
    }

    fn clean_directives(&self, body: &mut oxc_ast::ast::FunctionBody<'a>) {
        let directive = self.transform.directive.clone();
        body.directives
            .retain(|entry| entry.expression.value != directive);
    }

    /// Applies the transform when the expression is a marked function.
    /// Returns true when the expression was replaced (children must not be
    /// walked — Babel's `replaceWith` short-circuits the old subtree).
    fn maybe_transform_expression(&mut self, expression: &mut Expression<'a>) -> bool {
        let (has_directive, own_name) = match expression {
            Expression::ArrowFunctionExpression(arrow) if !arrow.is_expression() => (
                arrow
                    .get_function_body()
                    .is_some_and(|body| self.body_has_directive(body)),
                None,
            ),
            Expression::FunctionExpression(function) => (
                function
                    .body
                    .as_ref()
                    .is_some_and(|body| self.body_has_directive(body)),
                function.id.as_ref().map(|id| id.name.to_string()),
            ),
            _ => return false,
        };
        if !has_directive {
            return false;
        }
        match expression {
            Expression::ArrowFunctionExpression(arrow) => {
                if let Some(body) = arrow.get_function_body_mut() {
                    self.clean_directives(body);
                }
            }
            Expression::FunctionExpression(function) => {
                if let Some(body) = function.body.as_mut() {
                    self.clean_directives(body);
                }
            }
            _ => unreachable!("shape checked above"),
        }
        let name = own_name
            .or_else(|| self.name_stack.last().cloned())
            .unwrap_or_else(|| "anonymous".to_string());
        let top_index = self.top_index;
        let mut insertions = std::mem::take(&mut self.insertions);
        self.transform
            .transform_marked_function(expression, &name, top_index, &mut insertions);
        self.insertions = insertions;
        true
    }
}

impl<'a> VisitMut<'a> for FunctionLevelVisitor<'_, 'a> {
    fn visit_program(&mut self, program: &mut Program<'a>) {
        for (index, statement) in program.body.iter_mut().enumerate() {
            self.top_index = index;
            walk_mut::walk_statement(self, statement);
        }
    }

    fn visit_variable_declarator(&mut self, declarator: &mut oxc_ast::ast::VariableDeclarator<'a>) {
        let pushed = if let BindingPattern::BindingIdentifier(id) = &declarator.id {
            self.name_stack.push(id.name.to_string());
            true
        } else {
            false
        };
        walk_mut::walk_variable_declarator(self, declarator);
        if pushed {
            self.name_stack.pop();
        }
    }

    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        if self.maybe_transform_expression(expression) {
            return;
        }
        walk_mut::walk_expression(self, expression);
    }

    /// Babel parses `{ foo() {} }` (and getters/setters) as `ObjectMethod`,
    /// which the directive plugin does not visit — only plain
    /// function-valued properties (`{ foo: function () {} }`) are eligible.
    fn visit_object_property(&mut self, property: &mut oxc_ast::ast::ObjectProperty<'a>) {
        if property.method || property.kind != oxc_ast::ast::PropertyKind::Init {
            walk_mut::walk_property_key(self, &mut property.key);
            match &mut property.value {
                Expression::FunctionExpression(function) => {
                    walk_mut::walk_function(
                        self,
                        function,
                        oxc_syntax::scope::ScopeFlags::Function,
                    );
                }
                other => walk_mut::walk_expression(self, other),
            }
            return;
        }
        walk_mut::walk_object_property(self, property);
    }
}

// --- Top-level binding tracing (module-level path) ----------------------------

/// Identity of a top-level `var`/`let`/`const` declarator: statement index in
/// the program body plus declarator index within the declaration.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct BindingKey {
    statement: usize,
    declarator: usize,
}

struct ExportedBindings {
    /// Deduped bindings in trace order (Babel's `Set<Binding>` insertion
    /// order).
    unique: Vec<BindingKey>,
    /// `(exported name, binding)` pairs in traversal order.
    exported: Vec<(String, BindingKey)>,
}

impl ExportedBindings {
    fn exported_names_for(&self, key: BindingKey) -> Vec<String> {
        self.exported
            .iter()
            .filter(|(_, k)| *k == key)
            .map(|(name, _)| name.clone())
            .collect()
    }
}

fn collect_top_level_bindings(
    program: &Program<'_>,
) -> std::collections::HashMap<String, BindingKey> {
    let mut bindings = std::collections::HashMap::new();
    for (statement_index, statement) in program.body.iter().enumerate() {
        let declaration = match statement {
            Statement::VariableDeclaration(declaration) => declaration,
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::VariableDeclaration(declaration) => declaration,
                _ => continue,
            },
            _ => continue,
        };
        for (declarator_index, declarator) in declaration.declarations.iter().enumerate() {
            if let BindingPattern::BindingIdentifier(id) = &declarator.id {
                bindings.insert(
                    id.name.to_string(),
                    BindingKey {
                        statement: statement_index,
                        declarator: declarator_index,
                    },
                );
            }
        }
    }
    bindings
}

fn binding_declarator<'p, 'a>(
    program: &'p Program<'a>,
    key: BindingKey,
) -> Option<&'p oxc_ast::ast::VariableDeclarator<'a>> {
    let declaration = match &program.body[key.statement] {
        Statement::VariableDeclaration(declaration) => declaration,
        Statement::ExportDeclaration(export) => match &export.declaration {
            Declaration::VariableDeclaration(declaration) => declaration,
            _ => return None,
        },
        _ => return None,
    };
    declaration.declarations.get(key.declarator)
}

/// Unwraps Babel's `NestedExpression` set — parens are already erased by
/// `preserve_parens: false`, so only the TS wrapper nodes remain.
fn unwrap_expression<'e, 'a>(expression: &'e Expression<'a>) -> &'e Expression<'a> {
    match expression {
        Expression::TSAsExpression(inner) => unwrap_expression(&inner.expression),
        Expression::TSSatisfiesExpression(inner) => unwrap_expression(&inner.expression),
        Expression::TSNonNullExpression(inner) => unwrap_expression(&inner.expression),
        Expression::TSTypeAssertion(inner) => unwrap_expression(&inner.expression),
        Expression::TSInstantiationExpression(inner) => unwrap_expression(&inner.expression),
        other => other,
    }
}

fn unwrap_expression_mut<'e, 'a>(expression: &'e mut Expression<'a>) -> &'e mut Expression<'a> {
    match expression {
        Expression::TSAsExpression(inner) => unwrap_expression_mut(&mut inner.expression),
        Expression::TSSatisfiesExpression(inner) => unwrap_expression_mut(&mut inner.expression),
        Expression::TSNonNullExpression(inner) => unwrap_expression_mut(&mut inner.expression),
        Expression::TSTypeAssertion(inner) => unwrap_expression_mut(&mut inner.expression),
        Expression::TSInstantiationExpression(inner) => {
            unwrap_expression_mut(&mut inner.expression)
        }
        other => other,
    }
}

fn is_valid_function(expression: &Expression<'_>) -> bool {
    matches!(
        expression,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    )
}

/// Babel's `traceBinding`: follow identifier-initialized declarators to a
/// declarator whose init is a function/arrow expression.
fn trace_binding(
    program: &Program<'_>,
    bindings: &std::collections::HashMap<String, BindingKey>,
    name: &str,
) -> Option<BindingKey> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut current = name.to_string();
    loop {
        if !seen.insert(current.clone()) {
            return None;
        }
        let key = *bindings.get(&current)?;
        let declarator = binding_declarator(program, key)?;
        let init = declarator.init.as_ref()?;
        let init = unwrap_expression(init);
        if let Expression::Identifier(identifier) = init {
            current = identifier.name.to_string();
            continue;
        }
        if is_valid_function(init) {
            return Some(key);
        }
        return None;
    }
}

fn collect_exported_bindings(
    program: &Program<'_>,
    bindings: &std::collections::HashMap<String, BindingKey>,
) -> ExportedBindings {
    let mut unique: Vec<BindingKey> = Vec::new();
    let mut exported: Vec<(String, BindingKey)> = Vec::new();
    let mut push = |name: String, key: BindingKey| {
        if !unique.contains(&key) {
            unique.push(key);
        }
        exported.push((name, key));
    };

    for statement in &program.body {
        match statement {
            Statement::ExportDefaultDeclaration(export) => {
                if let Some(expression) = export.declaration.as_expression()
                    && let Expression::Identifier(identifier) = unwrap_expression(expression)
                    && let Some(key) = trace_binding(program, bindings, &identifier.name)
                {
                    push("default".to_string(), key);
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                if export.export_kind == ImportOrExportKind::Type {
                    continue;
                }
                // Babel visits specifiers before the declaration.
                for specifier in &export.specifiers {
                    let Some(local) = specifier.local.identifier_name() else {
                        continue;
                    };
                    if let Some(key) = trace_binding(program, bindings, local.as_str()) {
                        let exported_name = match &specifier.exported {
                            oxc_ast::ast::ModuleExportName::StringLiteral(literal) => {
                                literal.value.to_string()
                            }
                            other => other
                                .identifier_name()
                                .map(|name| name.to_string())
                                .unwrap_or_default(),
                        };
                        push(exported_name, key);
                    }
                }
            }
            Statement::ExportDeclaration(export) => {
                if let Declaration::VariableDeclaration(declaration) = &export.declaration {
                    for declarator in &declaration.declarations {
                        if let BindingPattern::BindingIdentifier(id) = &declarator.id
                            && let Some(key) = trace_binding(program, bindings, &id.name)
                        {
                            push(id.name.to_string(), key);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    ExportedBindings { unique, exported }
}

/// Babel's `getDescriptiveName` from a traced binding's init function: a
/// named function expression wins, otherwise the declarator name.
fn binding_descriptive_name(program: &Program<'_>, key: BindingKey) -> Option<String> {
    let declarator = binding_declarator(program, key)?;
    let init = unwrap_expression(declarator.init.as_ref()?);
    if let Expression::FunctionExpression(function) = init
        && let Some(id) = &function.id
    {
        return Some(id.name.to_string());
    }
    if !is_valid_function(init) {
        return None;
    }
    if let BindingPattern::BindingIdentifier(id) = &declarator.id {
        return Some(id.name.to_string());
    }
    Some("anonymous".to_string())
}

/// Mutable access to the function expression stored in a traced binding's
/// init (through TS wrappers, like Babel replacing the inner function path).
fn binding_init_function_slot<'p, 'a>(
    program: &'p mut Program<'a>,
    key: BindingKey,
) -> Option<&'p mut Expression<'a>> {
    let declaration = match &mut program.body[key.statement] {
        Statement::VariableDeclaration(declaration) => declaration,
        Statement::ExportDeclaration(export) => match &mut export.declaration {
            Declaration::VariableDeclaration(declaration) => declaration,
            _ => return None,
        },
        _ => return None,
    };
    let declarator = declaration.declarations.get_mut(key.declarator)?;
    let slot = unwrap_expression_mut(declarator.init.as_mut()?);
    is_valid_function(slot).then_some(slot)
}

/// Applies `(index, statement)` insertions before the indexed statements,
/// preserving call order for a shared index (Babel's successive
/// `insertBefore` calls).
fn apply_insertions<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
    insertions: Vec<(usize, Statement<'a>)>,
) {
    if insertions.is_empty() {
        return;
    }
    let ast = AstBuilder::new(allocator);
    let old = std::mem::replace(&mut program.body, ast.vec());
    let mut insertions: Vec<(usize, Statement<'a>)> = insertions;
    for (index, statement) in old.into_iter().enumerate() {
        let mut i = 0;
        while i < insertions.len() {
            if insertions[i].0 == index {
                let (_, inserted) = insertions.remove(i);
                program.body.push(inserted);
            } else {
                i += 1;
            }
        }
        program.body.push(statement);
    }
    for (_, statement) in insertions {
        program.body.push(statement);
    }
}
