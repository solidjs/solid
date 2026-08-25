//! The solid-refresh pass proper. Phases mirror the Babel plugin:
//!
//! 1. Pragma scan — the first `@refresh skip` / `@refresh reload` comment
//!    anywhere in the file wins (skip bails entirely; reload emits a decline
//!    block, still fixes render calls, and skips component registration).
//! 2. `fixRender` — top-level-ish `render()`/`hydrate()` calls (every
//!    ancestor a statement) become `const _cleanup = ...;
//!    if (hot) hot.dispose(_cleanup);`.
//! 3. Bubbling — eligible top-level function-declaration components hoist to
//!    the top of the module (in the reference plugin's exact, requeue-quirky
//!    order; see `bubble`).
//! 4. Wrapping — eligible components and `createContext` results wrap in
//!    `$$component(...)`, creating the registry const, runtime imports, and
//!    the trailing `if (hot) { ... $$refresh(...) }` block on first use.

use oxc_allocator::{Allocator, Vec as ArenaVec};
use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::{ScopeId, Scoping, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, Span};

use crate::directives::relative_id;
use crate::directives::xxhash::xxhash32;
use crate::shared::ast::{
    expression_to_argument, import_named, object_property, variable_statement,
};
use crate::shared::ast_builder::AstBuilder;

use super::signature::{CommentInfo, Printer};

const SPAN: Span = Span::new(0, 0);

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Bundler {
    Esm,
    Vite,
    Webpack5,
    RspackEsm,
    Standard,
}

impl Bundler {
    fn as_str(self) -> &'static str {
        match self {
            Bundler::Esm => "esm",
            Bundler::Vite => "vite",
            Bundler::Webpack5 => "webpack5",
            Bundler::RspackEsm => "rspack-esm",
            Bundler::Standard => "standard",
        }
    }
}

pub(crate) struct RefreshConfig {
    pub bundler: Bundler,
    pub fix_render: bool,
    pub granular: bool,
    pub filename: Option<String>,
    pub import_source: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CalleeType {
    Render,
    Context,
}

/// Import registrations the plugin recognizes, per source module.
fn definitions_for_source(source: &str) -> &'static [(&'static str, CalleeType)] {
    match source {
        "@solidjs/web" => &[
            ("render", CalleeType::Render),
            ("hydrate", CalleeType::Render),
        ],
        "solid-js" | "solid-js/web" => &[("createContext", CalleeType::Context)],
        _ => &[],
    }
}

/// Semantic facts gathered before any mutation (spans key into the original
/// AST nodes, which keep their spans when moved).
struct Analysis {
    /// `ExpressionStatement` span starts eligible for the render fix, in
    /// Babel traversal order.
    render_statements: std::collections::HashSet<u32>,
    /// Valid `createContext(...)` call span starts.
    context_calls: std::collections::HashSet<u32>,
    /// Foreign bindings (granular `dependencies`) per candidate root span
    /// start.
    dependencies: std::collections::HashMap<u32, Vec<String>>,
    /// Span starts of component function declarations left untouched
    /// because rewriting them into `const` bindings would collide with TS
    /// declaration merging (solid-refresh#76 / vite-plugin-solid#145) —
    /// a deliberate divergence from the Babel plugin; see
    /// `scan_merged_functions`.
    merged_functions: std::collections::HashSet<u32>,
}

pub(crate) struct RefreshTransform<'a> {
    allocator: &'a Allocator,
    config: RefreshConfig,
    source: &'a str,
    comments: Vec<CommentInfo>,
    analysis: Analysis,
    taken: std::collections::HashSet<String>,
    imports: std::collections::HashMap<String, String>,
    prepended_imports: Vec<Statement<'a>>,
    registry: Option<String>,
    refresh_local: Option<String>,
    /// (top-level index, statement) — the `const _REGISTRY = ...` insert.
    registry_insertion: Option<(usize, Statement<'a>)>,
    changed: bool,
}

impl<'a> RefreshTransform<'a> {
    pub(crate) fn new(allocator: &'a Allocator, config: RefreshConfig, source: &'a str) -> Self {
        Self {
            allocator,
            config,
            source,
            comments: Vec::new(),
            analysis: Analysis {
                render_statements: std::collections::HashSet::new(),
                context_calls: std::collections::HashSet::new(),
                dependencies: std::collections::HashMap::new(),
                merged_functions: std::collections::HashSet::new(),
            },
            taken: std::collections::HashSet::new(),
            imports: std::collections::HashMap::new(),
            prepended_imports: Vec::new(),
            registry: None,
            refresh_local: None,
            registry_insertion: None,
            changed: false,
        }
    }

    fn ast(&self) -> AstBuilder<'a> {
        AstBuilder::new(self.allocator)
    }

    pub(crate) fn run(&mut self, program: &mut Program<'a>) -> bool {
        self.comments = program
            .comments
            .iter()
            .map(|comment| CommentInfo {
                span: comment.span,
                attached_to: comment.attached_to,
                is_line: comment.kind == CommentKind::Line,
                is_leading: comment.position == CommentPosition::Leading,
            })
            .collect();

        // First matching pragma anywhere in the file wins.
        let mut reload = false;
        for comment in &program.comments {
            let text = comment.content_span().source_text(self.source).trim();
            if text == "@refresh skip" {
                return false;
            }
            if text == "@refresh reload" {
                reload = true;
                break;
            }
        }

        self.scan_taken_names(program);
        self.analyze(program);

        if reload {
            let decline = self.build_decline_block();
            program.body.push(decline);
            self.changed = true;
            if self.config.fix_render {
                self.fix_statements(&mut program.body);
            }
            self.prepend_imports(program);
            return true;
        }

        if self.config.fix_render {
            self.fix_statements(&mut program.body);
        }
        self.bubble(program);
        self.wrap(program);

        if let Some((index, statement)) = self.registry_insertion.take() {
            program.body.insert(index, statement);
        }
        if self.registry.is_some() {
            let hot_block = self.build_refresh_block();
            program.body.push(hot_block);
        }
        self.prepend_imports(program);
        self.changed
    }

    fn prepend_imports(&mut self, program: &mut Program<'a>) {
        // Babel unshifts each import on creation, so the last-created import
        // ends up first; inserting in creation order at index 0 reproduces
        // that.
        for import in self.prepended_imports.drain(..) {
            program.body.insert(0, import);
        }
    }

    // --- Analysis -----------------------------------------------------------

    fn scan_taken_names(&mut self, program: &Program<'a>) {
        struct TakenNames<'t> {
            taken: &'t mut std::collections::HashSet<String>,
        }
        impl<'b> Visit<'b> for TakenNames<'_> {
            fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'b>) {
                self.taken.insert(it.name.to_string());
            }
            fn visit_identifier_reference(&mut self, it: &IdentifierReference<'b>) {
                self.taken.insert(it.name.to_string());
            }
            fn visit_label_identifier(&mut self, it: &LabelIdentifier<'b>) {
                self.taken.insert(it.name.to_string());
            }
        }
        let mut collector = TakenNames {
            taken: &mut self.taken,
        };
        collector.visit_program(program);
    }

    /// Babel's `scope.generateUidIdentifier(name)`: `_name`, `_name2`, ...
    fn generate_uid(&mut self, name: &str) -> String {
        let mut i = 1u32;
        loop {
            let candidate = if i == 1 {
                format!("_{name}")
            } else {
                format!("_{name}{i}")
            };
            if !self.taken.contains(&candidate) {
                self.taken.insert(candidate.clone());
                return candidate;
            }
            i += 1;
        }
    }

    /// Babel's `getImportIdentifier`, dedupe key `source[name]`.
    fn get_import(&mut self, name: &str) -> String {
        let key = format!("{}[{}]", self.config.import_source, name);
        if let Some(local) = self.imports.get(&key) {
            return local.clone();
        }
        let local = self.generate_uid(name);
        let import = import_named(self.allocator, &self.config.import_source, name, &local);
        self.prepended_imports.push(import);
        self.imports.insert(key, local.clone());
        local
    }

    fn analyze(&mut self, program: &Program<'a>) {
        let semantic = SemanticBuilder::new().build(program).semantic;
        let scoping = semantic.scoping();

        // Recognized import bindings.
        let mut identifiers: std::collections::HashMap<SymbolId, CalleeType> =
            std::collections::HashMap::new();
        let mut namespaces: std::collections::HashMap<
            SymbolId,
            &'static [(&'static str, CalleeType)],
        > = std::collections::HashMap::new();
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else {
                continue;
            };
            if import.import_kind.is_type() {
                continue;
            }
            let definitions = definitions_for_source(import.source.value.as_str());
            if definitions.is_empty() {
                continue;
            }
            for specifier in import.specifiers.iter().flatten() {
                match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                        if specifier.import_kind.is_type() {
                            continue;
                        }
                        let imported = specifier.imported.name();
                        if let Some((_, callee_type)) = definitions
                            .iter()
                            .find(|(name, _)| *name == imported.as_str())
                            && let Some(symbol_id) = specifier.local.symbol_id.get()
                        {
                            identifiers.insert(symbol_id, *callee_type);
                        }
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                        if let Some(symbol_id) = specifier.local.symbol_id.get() {
                            namespaces.insert(symbol_id, definitions);
                        }
                    }
                    // None of the recognized helpers are default exports.
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => {}
                }
            }
        }

        let resolve = |callee: &Expression<'_>, wanted: CalleeType| -> bool {
            match unwrap_expression(callee) {
                Expression::Identifier(identifier) => identifier
                    .reference_id
                    .get()
                    .and_then(|id| scoping.get_reference(id).symbol_id())
                    .is_some_and(|symbol| identifiers.get(&symbol) == Some(&wanted)),
                Expression::StaticMemberExpression(member) => {
                    let Expression::Identifier(object) = unwrap_expression(&member.object) else {
                        return false;
                    };
                    let Some(definitions) = object
                        .reference_id
                        .get()
                        .and_then(|id| scoping.get_reference(id).symbol_id())
                        .and_then(|symbol| namespaces.get(&symbol))
                    else {
                        return false;
                    };
                    definitions.iter().any(|(name, callee_type)| {
                        *callee_type == wanted && *name == member.property.name.as_str()
                    })
                }
                _ => false,
            }
        };

        // Render-fix targets: expression statements whose every ancestor is a
        // statement.
        if self.config.fix_render && (!identifiers.is_empty() || !namespaces.is_empty()) {
            let mut targets = std::collections::HashSet::new();
            collect_render_statements(&program.body, &mut |statement| {
                if let Some(call) = unwrap_call(&statement.expression)
                    && resolve(&call.callee, CalleeType::Render)
                {
                    targets.insert(statement.span.start);
                }
            });
            self.analysis.render_statements = targets;
        }

        // Valid createContext calls (checked at top-level declarator inits).
        if !identifiers.is_empty() || !namespaces.is_empty() {
            for statement in &program.body {
                let declaration = match statement {
                    Statement::VariableDeclaration(declaration) => Some(&**declaration),
                    Statement::ExportDeclaration(export) => match &export.declaration {
                        Declaration::VariableDeclaration(declaration) => Some(&**declaration),
                        _ => None,
                    },
                    _ => None,
                };
                let Some(declaration) = declaration else {
                    continue;
                };
                for declarator in &declaration.declarations {
                    let Some(init) = &declarator.init else {
                        continue;
                    };
                    if let Some(call) = unwrap_call(init)
                        && resolve(&call.callee, CalleeType::Context)
                    {
                        self.analysis.context_calls.insert(call.span.start);
                    }
                }
            }
        }

        self.scan_merged_functions(program, scoping);

        // Granular dependencies for component candidates.
        if self.config.granular {
            let root_scope = scoping.root_scope_id();
            for statement in &program.body {
                match statement {
                    Statement::FunctionDeclaration(function) => {
                        self.collect_candidate_function(function, scoping, root_scope)
                    }
                    Statement::ExportDeclaration(export) => match &export.declaration {
                        Declaration::FunctionDeclaration(function) => {
                            self.collect_candidate_function(function, scoping, root_scope)
                        }
                        Declaration::VariableDeclaration(declaration) => {
                            self.collect_candidate_declarators(declaration, scoping, root_scope)
                        }
                        _ => {}
                    },
                    Statement::ExportDefaultDeclaration(export) => {
                        if let ExportDefaultDeclarationKind::FunctionDeclaration(function) =
                            &export.declaration
                        {
                            self.collect_candidate_function(function, scoping, root_scope)
                        }
                    }
                    Statement::VariableDeclaration(declaration) => {
                        self.collect_candidate_declarators(declaration, scoping, root_scope)
                    }
                    _ => {}
                }
            }
        }
    }

    /// solid-refresh#76 / vite-plugin-solid#145 (deliberate divergence from
    /// the Babel plugin): rewriting `function A() {}` into
    /// `const A = $$component(...)` collides with TypeScript declaration
    /// merging. When `namespace A` merges with `function A`, tsc/esbuild
    /// lower the namespace against the function binding (and esbuild
    /// rejects `const`/`var` + `namespace` outright with "The symbol A has
    /// already been declared"), so the wrapped output either fails to
    /// compile or breaks the merge. Detect two shapes:
    ///
    /// - a same-name sibling *value* binding at the top level (namespace/
    ///   module, enum, class, var — what merges look like before stripping,
    ///   or what tsc emits alongside after stripping), and
    /// - module-level writes to the function's own binding (the post-strip
    ///   namespace IIFE assigns `A || (A = {})`, which `const` turns into a
    ///   potential TypeError and an esbuild assign-to-constant warning).
    ///
    /// Matching functions keep their original declaration — effectively a
    /// per-component `@refresh skip`: the component still works, it just
    /// isn't hot-wrapped. Type-only merges (`interface A`, `type A`,
    /// ambient `declare` declarations, bodiless overload signatures) are
    /// erased by the TS strip and don't suppress wrapping.
    fn scan_merged_functions(&mut self, program: &Program<'a>, scoping: &Scoping) {
        // (name, binding-id span start) of every top-level value binding.
        let mut bindings: Vec<(String, u32)> = Vec::new();
        // (name, binding-id span start, function span start, symbol).
        let mut candidates: Vec<(String, u32, u32, Option<SymbolId>)> = Vec::new();

        for statement in &program.body {
            match statement {
                Statement::ExportDeclaration(export) => {
                    collect_merge_bindings(&export.declaration, &mut bindings, &mut candidates);
                }
                Statement::ExportDefaultDeclaration(export) => {
                    if let ExportDefaultDeclarationKind::FunctionDeclaration(function) =
                        &export.declaration
                    {
                        collect_merge_function(function, &mut bindings, &mut candidates);
                    }
                }
                other => {
                    if let Some(declaration) = other.as_declaration() {
                        collect_merge_bindings(declaration, &mut bindings, &mut candidates);
                    }
                }
            }
        }

        for (name, id_span, function_span, symbol) in candidates {
            let has_sibling = bindings
                .iter()
                .any(|(other, other_span)| *other == name && *other_span != id_span);
            let has_write = symbol.is_some_and(|symbol| {
                scoping
                    .get_resolved_references(symbol)
                    .any(oxc_semantic::Reference::is_write)
            });
            if has_sibling || has_write {
                self.analysis.merged_functions.insert(function_span);
            }
        }
    }

    /// A component function declaration that is actually eligible for the
    /// function→`const $$component(...)` rewrite (and the bubbling that
    /// precedes it): merged declarations stay untouched.
    fn function_is_wrappable(&self, function: &Function<'a>) -> bool {
        function_is_component(function)
            && !self
                .analysis
                .merged_functions
                .contains(&function.span.start)
    }

    fn collect_candidate_function(
        &mut self,
        function: &Function<'a>,
        scoping: &Scoping,
        root_scope: ScopeId,
    ) {
        if !function_is_component(function) {
            return;
        }
        let mut collector = ForeignBindings::new(scoping, root_scope);
        collector.visit_function(function, oxc_semantic::ScopeFlags::Function);
        self.analysis
            .dependencies
            .insert(function.span.start, collector.names);
    }

    fn collect_candidate_declarators(
        &mut self,
        declaration: &VariableDeclaration<'a>,
        scoping: &Scoping,
        root_scope: ScopeId,
    ) {
        for declarator in &declaration.declarations {
            let BindingPattern::BindingIdentifier(id) = &declarator.id else {
                continue;
            };
            if !is_componentish(id.name.as_str()) {
                continue;
            }
            let Some(init) = &declarator.init else {
                continue;
            };
            if unwrap_component_function(init).is_none() {
                continue;
            }
            // Babel traverses the declarator: the binding id contributes no
            // references, so walking the init subtree is equivalent.
            let mut collector = ForeignBindings::new(scoping, root_scope);
            collector.visit_expression(init);
            self.analysis
                .dependencies
                .insert(declarator.span.start, collector.names);
        }
    }

    // --- fixRender ----------------------------------------------------------

    fn fix_statements(&mut self, statements: &mut ArenaVec<'a, Statement<'a>>) {
        let mut index = 0;
        while index < statements.len() {
            if self.is_render_target(&statements[index]) {
                let (cleanup, dispose) = self.build_render_fix(&mut statements[index]);
                statements[index] = cleanup;
                statements.insert(index + 1, dispose);
                index += 2;
                continue;
            }
            self.fix_statement_children(&mut statements[index]);
            index += 1;
        }
    }

    fn is_render_target(&self, statement: &Statement<'a>) -> bool {
        matches!(statement, Statement::ExpressionStatement(stmt)
            if self.analysis.render_statements.contains(&stmt.span.start))
    }

    /// Statement positions that aren't containers (if/loop bodies): a fixed
    /// call gets blockified, matching Babel's `insertAfter` behavior.
    fn fix_statement_slot(&mut self, slot: &mut Statement<'a>) {
        if self.is_render_target(slot) {
            let (cleanup, dispose) = self.build_render_fix(slot);
            let ast = self.ast();
            let mut body = ast.vec();
            body.push(cleanup);
            body.push(dispose);
            *slot = ast.statement_block(SPAN, body);
            return;
        }
        self.fix_statement_children(slot);
    }

    fn fix_statement_children(&mut self, statement: &mut Statement<'a>) {
        match statement {
            Statement::BlockStatement(block) => self.fix_statements(&mut block.body),
            Statement::IfStatement(stmt) => {
                self.fix_statement_slot(&mut stmt.consequent);
                if let Some(alternate) = &mut stmt.alternate {
                    self.fix_statement_slot(alternate);
                }
            }
            Statement::ForStatement(stmt) => self.fix_statement_slot(&mut stmt.body),
            Statement::ForInStatement(stmt) => self.fix_statement_slot(&mut stmt.body),
            Statement::ForOfStatement(stmt) => self.fix_statement_slot(&mut stmt.body),
            Statement::WhileStatement(stmt) => self.fix_statement_slot(&mut stmt.body),
            Statement::DoWhileStatement(stmt) => self.fix_statement_slot(&mut stmt.body),
            Statement::LabeledStatement(stmt) => self.fix_statement_slot(&mut stmt.body),
            Statement::TryStatement(stmt) => {
                self.fix_statements(&mut stmt.block.body);
                if let Some(handler) = &mut stmt.handler {
                    self.fix_statements(&mut handler.body.body);
                }
                if let Some(finalizer) = &mut stmt.finalizer {
                    self.fix_statements(&mut finalizer.body);
                }
            }
            Statement::SwitchStatement(stmt) => {
                for case in &mut stmt.cases {
                    self.fix_statements(&mut case.consequent);
                }
            }
            Statement::FunctionDeclaration(function) => {
                if let Some(body) = &mut function.body {
                    self.fix_statements(&mut body.statements);
                }
            }
            Statement::ExportDeclaration(export) => {
                if let Declaration::FunctionDeclaration(function) = &mut export.declaration
                    && let Some(body) = &mut function.body
                {
                    self.fix_statements(&mut body.statements);
                }
            }
            Statement::ExportDefaultDeclaration(export) => {
                if let ExportDefaultDeclarationKind::FunctionDeclaration(function) =
                    &mut export.declaration
                    && let Some(body) = &mut function.body
                {
                    self.fix_statements(&mut body.statements);
                }
            }
            _ => {}
        }
    }

    fn build_render_fix(
        &mut self,
        statement: &mut Statement<'a>,
    ) -> (Statement<'a>, Statement<'a>) {
        let ast = self.ast();
        let Statement::ExpressionStatement(stmt) = statement else {
            unreachable!("checked by is_render_target");
        };
        let span = stmt.span;
        let expression = std::mem::replace(&mut stmt.expression, ast.expression_null_literal(SPAN));
        let name = self.generate_uid("cleanup");
        let cleanup = variable_statement(
            self.allocator,
            span,
            VariableDeclarationKind::Const,
            &name,
            expression,
        );
        // `if (<hot>) <hot>.dispose(_cleanup);` — no block, like Babel.
        let hot = self.hot_expression();
        let dispose_callee =
            Expression::StaticMemberExpression(ast.alloc_static_member_expression(
                SPAN,
                self.hot_expression(),
                ast.identifier_name(SPAN, "dispose"),
                false,
            ));
        let mut arguments = ast.vec();
        arguments.push(Argument::Identifier(
            ast.alloc_identifier_reference(SPAN, ast.ident(&name)),
        ));
        let dispose_call = ast.expression_call(SPAN, dispose_callee, None, arguments, false);
        let dispose = ast.statement_if(
            SPAN,
            hot,
            ast.statement_expression(SPAN, dispose_call),
            None,
        );
        self.changed = true;
        (cleanup, dispose)
    }

    // --- Bubbling -----------------------------------------------------------

    fn bubble(&mut self, program: &mut Program<'a>) {
        let ast = self.ast();
        let body = std::mem::replace(&mut program.body, ast.vec());
        let mut hoisted: Vec<Statement<'a>> = Vec::new();
        let mut rest: Vec<Statement<'a>> = Vec::new();
        // Some(true) when the first bubbled declaration sat in an export —
        // Babel's traversal requeues exactly that one and re-hoists it to
        // the very front after everything else (observed behavior of the
        // reference plugin; see the fixture suite).
        let mut first_bubbled_exported: Option<bool> = None;

        for statement in body {
            match statement {
                Statement::FunctionDeclaration(function)
                    if self.function_is_wrappable(&function) =>
                {
                    hoisted.push(Statement::FunctionDeclaration(function));
                    first_bubbled_exported.get_or_insert(false);
                }
                Statement::ExportDeclaration(export)
                    if matches!(
                        &export.declaration,
                        Declaration::FunctionDeclaration(function)
                            if self.function_is_wrappable(function)
                    ) =>
                {
                    let export = export.unbox();
                    let Declaration::FunctionDeclaration(function) = export.declaration else {
                        unreachable!("matched above");
                    };
                    let name = function.id.as_ref().unwrap().name.as_str().to_string();
                    hoisted.push(Statement::FunctionDeclaration(function));
                    rest.push(self.build_named_export(&name));
                    first_bubbled_exported.get_or_insert(true);
                }
                Statement::ExportDefaultDeclaration(export)
                    if matches!(
                        &export.declaration,
                        ExportDefaultDeclarationKind::FunctionDeclaration(function)
                            if self.function_is_wrappable(function)
                    ) =>
                {
                    let export = export.unbox();
                    let ExportDefaultDeclarationKind::FunctionDeclaration(function) =
                        export.declaration
                    else {
                        unreachable!("matched above");
                    };
                    let name = function.id.as_ref().unwrap().name.as_str().to_string();
                    hoisted.push(Statement::FunctionDeclaration(function));
                    rest.push(Statement::ExportDefaultDeclaration(
                        ast.alloc_export_default_declaration(
                            SPAN,
                            ExportDefaultDeclarationKind::Identifier(
                                ast.alloc_identifier_reference(SPAN, ast.ident(&name)),
                            ),
                        ),
                    ));
                    first_bubbled_exported.get_or_insert(true);
                }
                other => rest.push(other),
            }
        }

        hoisted.reverse();
        if first_bubbled_exported == Some(true) {
            // After reversing, the first-bubbled declaration is last; move
            // it back to the front (the requeue re-hoist).
            if let Some(first) = hoisted.pop() {
                hoisted.insert(0, first);
            }
        }

        program.body.extend(hoisted);
        program.body.extend(rest);
    }

    fn build_named_export(&self, name: &str) -> Statement<'a> {
        let ast = self.ast();
        let specifier = ast.export_specifier(
            SPAN,
            ast.module_export_name_identifier_reference(SPAN, ast.ident(name)),
            ast.module_export_name_identifier_name(SPAN, ast.ident(name)),
            ImportOrExportKind::Value,
        );
        Statement::ExportNamedDeclaration(ast.alloc_export_named_declaration(
            SPAN,
            ast.vec1(specifier),
            ImportOrExportKind::Value,
        ))
    }

    // --- Wrapping -----------------------------------------------------------

    fn wrap(&mut self, program: &mut Program<'a>) {
        for index in 0..program.body.len() {
            // Split the borrow: take the statement out, work, put it back.
            let ast = self.ast();
            let statement = std::mem::replace(&mut program.body[index], ast.statement_empty(SPAN));
            let statement = self.wrap_statement(index, statement);
            program.body[index] = statement;
        }
    }

    fn wrap_statement(&mut self, index: usize, statement: Statement<'a>) -> Statement<'a> {
        match statement {
            Statement::FunctionDeclaration(function) if self.function_is_wrappable(&function) => {
                self.wrap_function_declaration(index, function)
            }
            Statement::VariableDeclaration(mut declaration) => {
                self.wrap_declarators(index, &mut declaration);
                Statement::VariableDeclaration(declaration)
            }
            Statement::ExportDeclaration(mut export) => {
                if let Declaration::VariableDeclaration(declaration) = &mut export.declaration {
                    self.wrap_declarators(index, declaration);
                }
                Statement::ExportDeclaration(export)
            }
            other => other,
        }
    }

    fn wrap_declarators(
        &mut self,
        index: usize,
        declaration: &mut oxc_allocator::Box<'a, VariableDeclaration<'a>>,
    ) {
        for declarator in declaration.declarations.iter_mut() {
            self.wrap_declarator(index, declarator);
        }
    }

    fn wrap_declarator(&mut self, index: usize, declarator: &mut VariableDeclarator<'a>) {
        let BindingPattern::BindingIdentifier(id) = &declarator.id else {
            return;
        };
        let name = id.name.as_str().to_string();
        let Some(init) = &declarator.init else {
            return;
        };

        if is_componentish(&name) && unwrap_component_function(init).is_some() {
            let init = declarator.init.take().unwrap();
            let component = unwrap_expression_owned(init);
            let location_span = component.span();
            let deps_key = declarator.span.start;
            let wrapped = self.wrap_component(
                index,
                &name,
                component,
                location_span,
                Some(deps_key),
                false,
            );
            declarator.init = Some(wrapped);
            return;
        }

        let is_context = unwrap_call(init)
            .is_some_and(|call| self.analysis.context_calls.contains(&call.span.start));
        if is_context {
            let init = declarator.init.take().unwrap();
            let call = unwrap_expression_owned(init);
            let wrapped = self.wrap_context(index, &name, call);
            declarator.init = Some(wrapped);
        }
    }

    fn wrap_function_declaration(
        &mut self,
        index: usize,
        function: oxc_allocator::Box<'a, Function<'a>>,
    ) -> Statement<'a> {
        let name = function.id.as_ref().unwrap().name.as_str().to_string();
        let location_span = function.span;
        let deps_key = function.span.start;

        // Babel: `t.functionExpression(decl.id, decl.params, decl.body)` —
        // id/params/body carry over, TS bits drop.
        let mut function = function;
        function.r#type = FunctionType::FunctionExpression;
        function.type_parameters = None;
        function.return_type = None;
        function.this_param = None;
        function.declare = false;
        let component = Expression::FunctionExpression(function);

        let wrapped =
            self.wrap_component(index, &name, component, location_span, Some(deps_key), true);
        variable_statement(
            self.allocator,
            location_span,
            VariableDeclarationKind::Const,
            &name,
            wrapped,
        )
    }

    fn wrap_component(
        &mut self,
        index: usize,
        name: &str,
        component: Expression<'a>,
        location_span: Span,
        deps_key: Option<u32>,
        synthesized: bool,
    ) -> Expression<'a> {
        let ast = self.ast();
        let registry = self.ensure_registry(index);
        let component_import = self.get_import("$$component");

        let mut properties = ast.vec();
        if let Some(filename) = self.config.filename.clone() {
            let (line, column) = line_column(self.source, location_span.start);
            let location = format!("{}:{line}:{column}", relative_id(None, &filename));
            properties.push(object_property(
                self.allocator,
                SPAN,
                "location",
                Expression::StringLiteral(ast.alloc_string_literal(SPAN, ast.str(&location), None)),
            ));
        }
        if self.config.granular {
            let printed = self.print_signature(&component, synthesized);
            if std::env::var_os("REFRESH_SIG_DEBUG").is_some() {
                eprintln!("SIG[{name}] = {printed:?}");
            }
            let signature = format!("{:x}", xxhash32(&printed, 0));
            properties.push(object_property(
                self.allocator,
                SPAN,
                "signature",
                Expression::StringLiteral(ast.alloc_string_literal(
                    SPAN,
                    ast.str(&signature),
                    None,
                )),
            ));
            let dependencies = deps_key
                .and_then(|key| self.analysis.dependencies.get(&key))
                .cloned()
                .unwrap_or_default();
            if !dependencies.is_empty() {
                properties.push(object_property(
                    self.allocator,
                    SPAN,
                    "dependencies",
                    self.build_dependencies_thunk(&dependencies),
                ));
            }
        }

        let mut arguments = ast.vec();
        arguments.push(Argument::Identifier(
            ast.alloc_identifier_reference(SPAN, ast.ident(&registry)),
        ));
        arguments.push(Argument::StringLiteral(ast.alloc_string_literal(
            SPAN,
            ast.str(name),
            None,
        )));
        arguments.push(expression_to_argument(component));
        arguments.push(Argument::ObjectExpression(
            ast.alloc_object_expression(SPAN, properties),
        ));

        self.changed = true;
        ast.expression_call(
            SPAN,
            Expression::Identifier(
                ast.alloc_identifier_reference(SPAN, ast.ident(&component_import)),
            ),
            None,
            arguments,
            false,
        )
    }

    fn wrap_context(&mut self, index: usize, name: &str, call: Expression<'a>) -> Expression<'a> {
        let ast = self.ast();
        let registry = self.ensure_registry(index);
        let component_import = self.get_import("$$component");

        let mut arguments = ast.vec();
        arguments.push(Argument::Identifier(
            ast.alloc_identifier_reference(SPAN, ast.ident(&registry)),
        ));
        arguments.push(Argument::StringLiteral(ast.alloc_string_literal(
            SPAN,
            ast.str(name),
            None,
        )));
        arguments.push(expression_to_argument(call));

        self.changed = true;
        ast.expression_call(
            SPAN,
            Expression::Identifier(
                ast.alloc_identifier_reference(SPAN, ast.ident(&component_import)),
            ),
            None,
            arguments,
            false,
        )
    }

    fn build_dependencies_thunk(&self, dependencies: &[String]) -> Expression<'a> {
        let ast = self.ast();
        let mut properties = ast.vec();
        for name in dependencies {
            let key = ast.property_key_static_identifier(SPAN, ast.ident(name));
            let value =
                Expression::Identifier(ast.alloc_identifier_reference(SPAN, ast.ident(name)));
            properties.push(ast.object_property_kind_object_property(
                SPAN,
                PropertyKind::Init,
                key,
                value,
                false,
                true,
                false,
            ));
        }
        let object = ast.expression_object(SPAN, properties);
        let params = ast.formal_parameters(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            ast.vec(),
            None,
        );
        let body = ast.function_body(
            SPAN,
            ast.vec(),
            ast.vec1(ast.statement_expression(SPAN, object)),
        );
        ast.expression_arrow_function(SPAN, true, false, None, params, None, body)
    }

    fn print_signature(&self, component: &Expression<'a>, synthesized: bool) -> String {
        let mut printer = Printer::new(self.source, &self.comments);
        match component {
            // Function-declaration components print like the synthesized
            // `t.functionExpression` (a fresh node: no leading comments, TS
            // bits already dropped above).
            Expression::FunctionExpression(function) if synthesized => {
                printer.print_function_as_expression(function)
            }
            _ => printer.print_component_expression(component),
        }
        printer.finish()
    }

    fn ensure_registry(&mut self, index: usize) -> String {
        if let Some(registry) = &self.registry {
            return registry.clone();
        }
        let ast = self.ast();
        let registry_import = self.get_import("$$registry");
        let registry_name = self.generate_uid("REGISTRY");
        let call = ast.expression_call(
            SPAN,
            Expression::Identifier(
                ast.alloc_identifier_reference(SPAN, ast.ident(&registry_import)),
            ),
            None,
            ast.vec(),
            false,
        );
        let statement = variable_statement(
            self.allocator,
            SPAN,
            VariableDeclarationKind::Const,
            &registry_name,
            call,
        );
        self.registry_insertion = Some((index, statement));
        let refresh_local = self.get_import("$$refresh");
        self.refresh_local = Some(refresh_local);
        self.registry = Some(registry_name.clone());
        registry_name
    }

    // --- HMR blocks -----------------------------------------------------------

    /// `import.meta.hot` / `import.meta.webpackHot` / `module.hot`.
    fn hot_expression(&self) -> Expression<'a> {
        let ast = self.ast();
        match self.config.bundler {
            Bundler::Esm | Bundler::Vite | Bundler::Webpack5 | Bundler::RspackEsm => {
                let property = match self.config.bundler {
                    Bundler::Webpack5 | Bundler::RspackEsm => "webpackHot",
                    _ => "hot",
                };
                let meta = ast.expression_import_meta(SPAN);
                Expression::StaticMemberExpression(ast.alloc_static_member_expression(
                    SPAN,
                    meta,
                    ast.identifier_name(SPAN, property),
                    false,
                ))
            }
            Bundler::Standard => {
                Expression::StaticMemberExpression(ast.alloc_static_member_expression(
                    SPAN,
                    Expression::Identifier(
                        ast.alloc_identifier_reference(SPAN, ast.ident("module")),
                    ),
                    ast.identifier_name(SPAN, "hot"),
                    false,
                ))
            }
        }
    }

    fn hot_member_call(
        &self,
        property: &'static str,
        arguments: ArenaVec<'a, Argument<'a>>,
    ) -> Statement<'a> {
        let ast = self.ast();
        let callee = Expression::StaticMemberExpression(ast.alloc_static_member_expression(
            SPAN,
            self.hot_expression(),
            ast.identifier_name(SPAN, property),
            false,
        ));
        ast.statement_expression(
            SPAN,
            ast.expression_call(SPAN, callee, None, arguments, false),
        )
    }

    /// `if (hot) { [hot.accept();] _$$refresh("<bundler>", hot, _REGISTRY); }`
    fn build_refresh_block(&mut self) -> Statement<'a> {
        let ast = self.ast();
        let mut body = ast.vec();
        if self.config.bundler == Bundler::Vite {
            body.push(self.hot_member_call("accept", ast.vec()));
        }
        let refresh_local = self.refresh_local.clone().unwrap();
        let registry = self.registry.clone().unwrap();
        let mut arguments = ast.vec();
        arguments.push(Argument::StringLiteral(ast.alloc_string_literal(
            SPAN,
            ast.str(self.config.bundler.as_str()),
            None,
        )));
        arguments.push(expression_to_argument(self.hot_expression()));
        arguments.push(Argument::Identifier(
            ast.alloc_identifier_reference(SPAN, ast.ident(&registry)),
        ));
        body.push(ast.statement_expression(
            SPAN,
            ast.expression_call(
                SPAN,
                Expression::Identifier(
                    ast.alloc_identifier_reference(SPAN, ast.ident(&refresh_local)),
                ),
                None,
                arguments,
                false,
            ),
        ));
        ast.statement_if(
            SPAN,
            self.hot_expression(),
            ast.statement_block(SPAN, body),
            None,
        )
    }

    /// `@refresh reload`:
    /// vite → `if (hot) { hot.accept(() => hot.invalidate()); }`
    /// else → `if (hot) { _$$decline("<bundler>", hot); }`
    fn build_decline_block(&mut self) -> Statement<'a> {
        let ast = self.ast();
        let mut body = ast.vec();
        if self.config.bundler == Bundler::Vite {
            // `() => import.meta.hot.invalidate()` (concise body).
            let invalidate_callee =
                Expression::StaticMemberExpression(ast.alloc_static_member_expression(
                    SPAN,
                    self.hot_expression(),
                    ast.identifier_name(SPAN, "invalidate"),
                    false,
                ));
            let invalidate = ast.expression_call(SPAN, invalidate_callee, None, ast.vec(), false);
            let params = ast.formal_parameters(
                SPAN,
                FormalParameterKind::ArrowFormalParameters,
                ast.vec(),
                None,
            );
            let arrow_body = ast.function_body(
                SPAN,
                ast.vec(),
                ast.vec1(ast.statement_expression(SPAN, invalidate)),
            );
            let callback =
                ast.expression_arrow_function(SPAN, true, false, None, params, None, arrow_body);
            let mut arguments = ast.vec();
            arguments.push(expression_to_argument(callback));
            body.push(self.hot_member_call("accept", arguments));
        } else {
            let decline_local = self.get_import("$$decline");
            let mut arguments = ast.vec();
            arguments.push(Argument::StringLiteral(ast.alloc_string_literal(
                SPAN,
                ast.str(self.config.bundler.as_str()),
                None,
            )));
            arguments.push(expression_to_argument(self.hot_expression()));
            body.push(ast.statement_expression(
                SPAN,
                ast.expression_call(
                    SPAN,
                    Expression::Identifier(
                        ast.alloc_identifier_reference(SPAN, ast.ident(&decline_local)),
                    ),
                    None,
                    arguments,
                    false,
                ),
            ));
        }
        ast.statement_if(
            SPAN,
            self.hot_expression(),
            ast.statement_block(SPAN, body),
            None,
        )
    }
}

// --- Eligibility helpers -------------------------------------------------------

fn is_componentish(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

/// Top-level value bindings and component-function candidates for the
/// declaration-merge scan (`scan_merged_functions`).
fn collect_merge_bindings(
    declaration: &Declaration<'_>,
    bindings: &mut Vec<(String, u32)>,
    candidates: &mut Vec<(String, u32, u32, Option<SymbolId>)>,
) {
    match declaration {
        Declaration::FunctionDeclaration(function) => {
            collect_merge_function(function, bindings, candidates);
        }
        Declaration::VariableDeclaration(declaration) => {
            if declaration.declare {
                return;
            }
            for declarator in &declaration.declarations {
                collect_binding_names(&declarator.id, bindings);
            }
        }
        Declaration::ClassDeclaration(class) => {
            if class.declare {
                return;
            }
            if let Some(id) = &class.id {
                bindings.push((id.name.to_string(), id.span.start));
            }
        }
        Declaration::TSEnumDeclaration(declaration) if !declaration.declare => {
            bindings.push((declaration.id.name.to_string(), declaration.id.span.start));
        }
        // Conservative: any non-ambient `namespace A` / `module A` counts
        // as a merge even if its body turns out type-only (skipping the
        // wrap is always safe; the component still renders, it just isn't
        // hot-wrapped).
        Declaration::TSNamespaceDeclaration(declaration) => {
            if declaration.declare {
                return;
            }
            bindings.push((declaration.id.name.to_string(), declaration.id.span.start));
        }
        _ => {}
    }
}

fn collect_merge_function(
    function: &Function<'_>,
    bindings: &mut Vec<(String, u32)>,
    candidates: &mut Vec<(String, u32, u32, Option<SymbolId>)>,
) {
    let Some(id) = &function.id else { return };
    // Ambient declarations and TS overload signatures (no body) are erased
    // by the strip and bind nothing.
    if function.declare || function.body.is_none() {
        return;
    }
    bindings.push((id.name.to_string(), id.span.start));
    if function_is_component(function) {
        candidates.push((
            id.name.to_string(),
            id.span.start,
            function.span.start,
            id.symbol_id.get(),
        ));
    }
}

fn collect_binding_names(pattern: &BindingPattern<'_>, bindings: &mut Vec<(String, u32)>) {
    match pattern {
        BindingPattern::BindingIdentifier(id) => {
            bindings.push((id.name.to_string(), id.span.start));
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                collect_binding_names(&property.value, bindings);
            }
            if let Some(rest) = &object.rest {
                collect_binding_names(&rest.argument, bindings);
            }
        }
        BindingPattern::ArrayPattern(array) => {
            for element in array.elements.iter().flatten() {
                collect_binding_names(element, bindings);
            }
            if let Some(rest) = &array.rest {
                collect_binding_names(&rest.argument, bindings);
            }
        }
        BindingPattern::AssignmentPattern(assignment) => {
            collect_binding_names(&assignment.left, bindings);
        }
    }
}

fn function_is_component(function: &Function<'_>) -> bool {
    let Some(id) = &function.id else {
        return false;
    };
    // Bodiless functions are TS ambient declarations or overload
    // signatures — Babel parses those as `TSDeclareFunction`, which the
    // plugin's `FunctionDeclaration` visitors never match.
    if function.declare || function.body.is_none() {
        return false;
    }
    is_componentish(id.name.as_str())
        && !function.generator
        && !function.r#async
        && function.params.items.len() + usize::from(function.params.rest.is_some()) < 2
}

fn arrow_is_component(arrow: &ArrowFunctionExpression<'_>) -> bool {
    !arrow.r#async && arrow.params.items.len() + usize::from(arrow.params.rest.is_some()) < 2
}

fn function_expression_is_component(function: &Function<'_>) -> bool {
    !function.generator
        && !function.r#async
        && function.params.items.len() + usize::from(function.params.rest.is_some()) < 2
}

/// Babel's `unwrapNode(node, ...)` through TS wrappers.
fn unwrap_expression<'p, 'a>(expression: &'p Expression<'a>) -> &'p Expression<'a> {
    match expression {
        Expression::TSAsExpression(inner) => unwrap_expression(&inner.expression),
        Expression::TSSatisfiesExpression(inner) => unwrap_expression(&inner.expression),
        Expression::TSNonNullExpression(inner) => unwrap_expression(&inner.expression),
        Expression::TSTypeAssertion(inner) => unwrap_expression(&inner.expression),
        Expression::TSInstantiationExpression(inner) => unwrap_expression(&inner.expression),
        Expression::ParenthesizedExpression(inner) => unwrap_expression(&inner.expression),
        other => other,
    }
}

fn unwrap_call<'p, 'a>(expression: &'p Expression<'a>) -> Option<&'p CallExpression<'a>> {
    match unwrap_expression(expression) {
        Expression::CallExpression(call) => Some(call),
        _ => None,
    }
}

fn unwrap_component_function<'p, 'a>(expression: &'p Expression<'a>) -> Option<&'p Expression<'a>> {
    match unwrap_expression(expression) {
        arrow @ Expression::ArrowFunctionExpression(inner) if arrow_is_component(inner) => {
            Some(arrow)
        }
        function @ Expression::FunctionExpression(inner)
            if function_expression_is_component(inner) =>
        {
            Some(function)
        }
        _ => None,
    }
}

fn unwrap_expression_owned(expression: Expression<'_>) -> Expression<'_> {
    match expression {
        Expression::TSAsExpression(inner) => unwrap_expression_owned(inner.unbox().expression),
        Expression::TSSatisfiesExpression(inner) => {
            unwrap_expression_owned(inner.unbox().expression)
        }
        Expression::TSNonNullExpression(inner) => unwrap_expression_owned(inner.unbox().expression),
        Expression::TSTypeAssertion(inner) => unwrap_expression_owned(inner.unbox().expression),
        Expression::TSInstantiationExpression(inner) => {
            unwrap_expression_owned(inner.unbox().expression)
        }
        Expression::ParenthesizedExpression(inner) => {
            unwrap_expression_owned(inner.unbox().expression)
        }
        other => other,
    }
}

// --- Render-fix target discovery (immutable twin of `fix_statements`) ----------

fn collect_render_statements<'a, 'p>(
    statements: &'p [Statement<'a>],
    callback: &mut impl FnMut(&'p ExpressionStatement<'a>),
) {
    for statement in statements {
        collect_render_statement(statement, callback);
    }
}

fn collect_render_statement<'a, 'p>(
    statement: &'p Statement<'a>,
    callback: &mut impl FnMut(&'p ExpressionStatement<'a>),
) {
    match statement {
        Statement::ExpressionStatement(stmt) => callback(stmt),
        Statement::BlockStatement(block) => collect_render_statements(&block.body, callback),
        Statement::IfStatement(stmt) => {
            collect_render_statement(&stmt.consequent, callback);
            if let Some(alternate) = &stmt.alternate {
                collect_render_statement(alternate, callback);
            }
        }
        Statement::ForStatement(stmt) => collect_render_statement(&stmt.body, callback),
        Statement::ForInStatement(stmt) => collect_render_statement(&stmt.body, callback),
        Statement::ForOfStatement(stmt) => collect_render_statement(&stmt.body, callback),
        Statement::WhileStatement(stmt) => collect_render_statement(&stmt.body, callback),
        Statement::DoWhileStatement(stmt) => collect_render_statement(&stmt.body, callback),
        Statement::LabeledStatement(stmt) => collect_render_statement(&stmt.body, callback),
        Statement::TryStatement(stmt) => {
            collect_render_statements(&stmt.block.body, callback);
            if let Some(handler) = &stmt.handler {
                collect_render_statements(&handler.body.body, callback);
            }
            if let Some(finalizer) = &stmt.finalizer {
                collect_render_statements(&finalizer.body, callback);
            }
        }
        Statement::SwitchStatement(stmt) => {
            for case in &stmt.cases {
                collect_render_statements(&case.consequent, callback);
            }
        }
        Statement::FunctionDeclaration(function) => {
            if let Some(body) = &function.body {
                collect_render_statements(&body.statements, callback);
            }
        }
        Statement::ExportDeclaration(export) => {
            if let Declaration::FunctionDeclaration(function) = &export.declaration
                && let Some(body) = &function.body
            {
                collect_render_statements(&body.statements, callback);
            }
        }
        Statement::ExportDefaultDeclaration(export) => {
            if let ExportDefaultDeclarationKind::FunctionDeclaration(function) = &export.declaration
                && let Some(body) = &function.body
            {
                collect_render_statements(&body.statements, callback);
            }
        }
        _ => {}
    }
}

// --- Foreign bindings (granular `dependencies`) ---------------------------------

/// Babel's `getForeignBindings`: referenced identifiers that resolve outside
/// the component subtree (module scope or unresolved globals), excluding
/// TS-type positions. Plain JSX identifiers count only when they resolve to
/// an imported binding (deliberate divergence from the Babel plugin, which
/// skips them entirely); JSX member-expression roots always count.
struct ForeignBindings<'s> {
    scoping: &'s Scoping,
    root_scope: ScopeId,
    seen: std::collections::HashSet<String>,
    names: Vec<String>,
}

impl<'s> ForeignBindings<'s> {
    fn new(scoping: &'s Scoping, root_scope: ScopeId) -> Self {
        Self {
            scoping,
            root_scope,
            seen: std::collections::HashSet::new(),
            names: Vec::new(),
        }
    }

    fn record(&mut self, identifier: &IdentifierReference<'_>) {
        let foreign = match identifier
            .reference_id
            .get()
            .and_then(|id| self.scoping.get_reference(id).symbol_id())
        {
            // Unresolved references are globals — Babel counts them
            // (`window`, `undefined`, even `NaN`).
            None => true,
            // Components are top-level, so "outside the subtree" is exactly
            // "bound in the module scope".
            Some(symbol) => self.scoping.symbol_scope_id(symbol) == self.root_scope,
        };
        if foreign && self.seen.insert(identifier.name.to_string()) {
            self.names.push(identifier.name.to_string());
        }
    }
}

impl<'b> Visit<'b> for ForeignBindings<'_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'b>) {
        self.record(identifier);
    }

    // Write-only targets (`count = 1`) aren't ReferencedIdentifiers in Babel.
    fn visit_assignment_target(&mut self, target: &AssignmentTarget<'b>) {
        if matches!(target, AssignmentTarget::AssignmentTargetIdentifier(_)) {
            return;
        }
        walk::walk_assignment_target(self, target);
    }

    // `<Foo.Bar />` counts `Foo`; `<Foo />` counts only when `Foo` resolves
    // to an imported binding. Same-module components stay excluded (their
    // `$$component` proxy identity changes on every re-execution, so counting
    // them would remount everything on every edit), but an import gets a new
    // identity exactly when its source module changed — skipping it leaves a
    // patched component rendering the stale module while its non-JSX
    // references swap over (split-brain; divergence from the Babel plugin,
    // which skips all plain JSX identifiers).
    fn visit_jsx_element_name(&mut self, name: &JSXElementName<'b>) {
        match name {
            JSXElementName::MemberExpression(member) => {
                let mut object = &member.object;
                loop {
                    match object {
                        JSXMemberExpressionObject::MemberExpression(inner) => {
                            object = &inner.object
                        }
                        JSXMemberExpressionObject::IdentifierReference(identifier) => {
                            self.record(identifier);
                            break;
                        }
                        JSXMemberExpressionObject::ThisExpression(_) => break,
                    }
                }
            }
            JSXElementName::IdentifierReference(identifier) => {
                // Resolution is scope-aware: a component-local variable
                // shadowing an import resolves to the local symbol, which
                // carries no import flag and is skipped. Type-only imports
                // (`import type`) are erased by the TS strip and must not
                // leak into the emitted dependencies object.
                let imported = identifier
                    .reference_id
                    .get()
                    .and_then(|id| self.scoping.get_reference(id).symbol_id())
                    .is_some_and(|symbol| {
                        self.scoping
                            .symbol_flags(symbol)
                            .contains(oxc_semantic::SymbolFlags::Import)
                    });
                if imported {
                    self.record(identifier);
                }
            }
            _ => {}
        }
    }

    // TS type positions don't contribute references.
    fn visit_ts_type(&mut self, _: &TSType<'b>) {}
    fn visit_ts_type_annotation(&mut self, _: &TSTypeAnnotation<'b>) {}
    fn visit_ts_type_parameter_declaration(&mut self, _: &TSTypeParameterDeclaration<'b>) {}
    fn visit_ts_type_parameter_instantiation(&mut self, _: &TSTypeParameterInstantiation<'b>) {}
}

/// Babel loc: 1-based line, 0-based UTF-16 column.
fn line_column(source: &str, offset: u32) -> (usize, usize) {
    let prefix = &source[..offset as usize];
    let line = prefix.bytes().filter(|byte| *byte == b'\n').count() + 1;
    let line_start = prefix.rfind('\n').map_or(0, |index| index + 1);
    let column = prefix[line_start..].encode_utf16().count();
    (line, column)
}
