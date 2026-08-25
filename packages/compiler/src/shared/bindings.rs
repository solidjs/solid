use oxc_ast::ast::{
    BindingPattern, ImportDeclarationSpecifier, Statement, VariableDeclarationKind,
};

use crate::shared::utils::{StaticValue, static_expression};

/// How a binding scope closes. Function-like scopes drop everything declared
/// inside them; block scopes keep hoisted (`var`) declarations by moving them
/// into the parent frame, mirroring Babel registering `var`s on the enclosing
/// function scope.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum BindingScopeKind {
    Function,
    Block,
}

/// One declared name plus the classification facts the transforms consult.
struct Binding {
    name: String,
    /// Index of the owning frame in the scope stack at declaration time
    /// (re-tagged to the parent frame when a block scope pops a hoisted
    /// binding).
    scope: usize,
    /// `var`-declared: survives block-scope exits up to the enclosing
    /// function scope.
    hoisted: bool,
    /// `binding.kind === "const" || binding.kind === "module"` in Babel.
    is_const: bool,
    /// Function declaration or function-valued variable initializer (Babel's
    /// `detectResolvableEventHandler` follows both).
    is_function: bool,
    /// `import * as ns` local — Babel's `isDynamic` treats property access
    /// on namespace imports as static.
    namespace_import: bool,
    /// Confidently string/number-valued initializer for `path.evaluate()`.
    static_value: Option<StaticValue>,
    /// Confidently boolean-valued initializer for `path.evaluate()`.
    static_bool: Option<bool>,
}

/// Facts about a declaration being recorded, before it is attached to the
/// current scope frame.
#[derive(Default)]
struct DeclarationFacts {
    hoisted: bool,
    is_const: bool,
    is_function: bool,
    namespace_import: bool,
    static_value: Option<StaticValue>,
    static_bool: Option<bool>,
}

/// Binding facts collected while walking statements, shared by all
/// generates. Approximates the parts of Babel's scope analysis the
/// transforms rely on (`path.scope.getBinding`, `path.evaluate()` over const
/// bindings, `detectResolvableEventHandler`).
///
/// Bindings live in a stack of scope frames kept in sync with the traversal:
/// each generate's `process_statements` brackets a statement list with a
/// block frame, and the function/arrow visitors bracket function bodies with
/// a function frame. Lookups resolve the *innermost live* declaration of a
/// name — a binding from an earlier, already-popped sibling scope is gone,
/// and an inner declaration shadows outer ones, matching Babel's scope-chain
/// resolution.
pub(crate) struct BindingTable {
    /// Live declarations, in collection order. A frame's entries always form
    /// a suffix of this vec, so name resolution walks it back to front.
    bindings: std::vec::Vec<Binding>,
    scopes: std::vec::Vec<BindingScopeKind>,
    /// Every identifier name appearing anywhere in the program (bindings and
    /// references, any depth). Babel's `generateUid` skips candidates that
    /// collide with any binding, global, or reference; generated locals
    /// consult this so user code that already uses `_el$`-style names can't
    /// clash with compiler output.
    pub(crate) taken_names: std::collections::HashSet<String>,
    /// Names appearing as assignment/update targets anywhere in the program
    /// (see `is_reassigned`).
    reassigned_names: std::collections::HashSet<String>,
    /// Span starts of JSX tag identifiers that match a configured built-in
    /// but resolve to a real binding in their scope chain (Babel's
    /// `!path.scope.hasBinding(name)` gate on built-in aliasing). Populated
    /// by a scope-aware pre-scan; scope resolution is position-insensitive,
    /// so a shadowing declaration later in the same scope still counts.
    pub(crate) shadowed_builtin_spans: std::collections::HashSet<u32>,
}

impl Default for BindingTable {
    fn default() -> Self {
        Self {
            bindings: std::vec::Vec::new(),
            // Root frame so program-level collection always has a target.
            scopes: vec![BindingScopeKind::Function],
            taken_names: std::collections::HashSet::new(),
            reassigned_names: std::collections::HashSet::new(),
            shadowed_builtin_spans: std::collections::HashSet::new(),
        }
    }
}

impl BindingTable {
    pub(crate) fn enter_scope(&mut self, kind: BindingScopeKind) {
        self.scopes.push(kind);
    }

    pub(crate) fn exit_scope(&mut self) {
        debug_assert!(self.scopes.len() > 1, "cannot pop the root binding scope");
        let index = self.scopes.len() - 1;
        let kind = self.scopes.pop().expect("scope stack is never empty");
        let first = self
            .bindings
            .iter()
            .rposition(|binding| binding.scope < index)
            .map_or(0, |position| position + 1);
        if kind == BindingScopeKind::Block && index > 0 {
            // `var`s escape the block into the parent frame; lexical
            // declarations die with it.
            let popped = self.bindings.split_off(first);
            for mut binding in popped {
                if binding.hoisted {
                    binding.scope = index - 1;
                    self.bindings.push(binding);
                }
            }
        } else {
            self.bindings.truncate(first);
        }
    }

    /// Innermost live declaration of `name` (Babel's `scope.getBinding`).
    /// Entries are in collection order and popped frames are removed, so the
    /// last match is the innermost one.
    fn resolve(&self, name: &str) -> Option<&Binding> {
        self.bindings
            .iter()
            .rev()
            .find(|binding| binding.name == name)
    }

    /// Records a declaration in the current frame. A redeclaration of the
    /// same name in the same frame merges (`var x = 1; var x = () => {};`
    /// stays one binding), preserving the accumulate-only semantics the
    /// classifications rely on.
    fn declare(&mut self, name: &str, facts: DeclarationFacts) {
        let scope = self.scopes.len() - 1;
        let existing = self
            .bindings
            .iter_mut()
            .rev()
            .take_while(|binding| binding.scope == scope)
            .find(|binding| binding.name == name);
        if let Some(existing) = existing {
            existing.hoisted |= facts.hoisted;
            existing.is_const |= facts.is_const;
            existing.is_function |= facts.is_function;
            existing.namespace_import |= facts.namespace_import;
            if facts.static_value.is_some() {
                existing.static_value = facts.static_value;
            }
            if facts.static_bool.is_some() {
                existing.static_bool = facts.static_bool;
            }
            return;
        }
        self.bindings.push(Binding {
            name: name.to_string(),
            scope,
            hoisted: facts.hoisted,
            is_const: facts.is_const,
            is_function: facts.is_function,
            namespace_import: facts.namespace_import,
            static_value: facts.static_value,
            static_bool: facts.static_bool,
        });
    }

    /// Whether `name` resolves to ANY live declaration (Babel's
    /// `scope.getBinding` presence check for the patch-mode subject guard).
    pub(crate) fn has_binding(&self, name: &str) -> bool {
        self.resolve(name).is_some()
    }

    /// Declares a function's parameters in the current frame. The statement
    /// walk only covers declarations; patch-mode subject resolution needs
    /// params (row functions' subjects ARE their params).
    pub(crate) fn declare_function_params(
        &mut self,
        params: &oxc_ast::ast::FormalParameters<'_>,
    ) {
        let mut names = std::vec::Vec::new();
        for param in &params.items {
            collect_binding_names(&param.pattern, &mut names);
        }
        if let Some(rest) = &params.rest {
            collect_binding_names(&rest.rest.argument, &mut names);
        }
        for name in names {
            self.declare(&name, DeclarationFacts::default());
        }
    }

    pub(crate) fn is_const(&self, name: &str) -> bool {
        self.resolve(name).is_some_and(|binding| binding.is_const)
    }

    pub(crate) fn is_function(&self, name: &str) -> bool {
        self.resolve(name)
            .is_some_and(|binding| binding.is_function)
    }

    pub(crate) fn is_namespace_import(&self, name: &str) -> bool {
        self.resolve(name)
            .is_some_and(|binding| binding.namespace_import)
    }

    pub(crate) fn static_value(&self, name: &str) -> Option<StaticValue> {
        self.resolve(name)
            .and_then(|binding| binding.static_value.clone())
    }

    pub(crate) fn static_bool(&self, name: &str) -> Option<bool> {
        self.resolve(name).and_then(|binding| binding.static_bool)
    }

    pub(crate) fn is_taken(&self, name: &str) -> bool {
        self.taken_names.contains(name)
    }

    /// Whether `name` is ever the target of an assignment or update anywhere
    /// in the program. The patch-mode subject guard (Babel checked
    /// `binding.constant`): a reassignable subject must fall back to effects,
    /// which re-evaluate the subject reference per run — a registered patch
    /// captures it once. Program-wide (scope-insensitive) is conservative in
    /// the safe direction, and it admits function params, which the binding
    /// table does not track.
    pub(crate) fn is_reassigned(&self, name: &str) -> bool {
        self.reassigned_names.contains(name)
    }

    /// Deep pre-scan of the whole program for identifier names (Babel's
    /// `generateUid` collision set) and assignment targets. Runs once before
    /// transformation.
    pub(crate) fn scan_taken_names(&mut self, program: &oxc_ast::ast::Program<'_>) {
        use oxc_ast_visit::Visit;

        struct TakenNames<'t> {
            taken: &'t mut std::collections::HashSet<String>,
            reassigned: &'t mut std::collections::HashSet<String>,
        }

        impl<'b> Visit<'b> for TakenNames<'_> {
            fn visit_binding_identifier(&mut self, it: &oxc_ast::ast::BindingIdentifier<'b>) {
                self.taken.insert(it.name.to_string());
            }
            fn visit_identifier_reference(&mut self, it: &oxc_ast::ast::IdentifierReference<'b>) {
                self.taken.insert(it.name.to_string());
            }
            fn visit_assignment_target(&mut self, it: &oxc_ast::ast::AssignmentTarget<'b>) {
                if let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(ident) = it {
                    self.reassigned.insert(ident.name.to_string());
                }
                oxc_ast_visit::walk::walk_assignment_target(self, it);
            }
            fn visit_update_expression(&mut self, it: &oxc_ast::ast::UpdateExpression<'b>) {
                if let oxc_ast::ast::SimpleAssignmentTarget::AssignmentTargetIdentifier(ident) =
                    &it.argument
                {
                    self.reassigned.insert(ident.name.to_string());
                }
                oxc_ast_visit::walk::walk_update_expression(self, it);
            }
        }

        let mut collector = TakenNames {
            taken: &mut self.taken_names,
            reassigned: &mut self.reassigned_names,
        };
        collector.visit_program(program);
    }

    /// Scope-aware pre-scan for built-in shadowing: walks the program with a
    /// scope stack (program, functions with hoisted `var`s, blocks with
    /// lexical declarations, loop heads, catch params) and records the span
    /// of every JSX identifier tag matching a configured built-in that is
    /// shadowed by a binding in scope. Mirrors Babel's `scope.hasBinding`,
    /// which registers all of a scope's declarations up front.
    pub(crate) fn scan_builtin_shadowing(
        &mut self,
        program: &oxc_ast::ast::Program<'_>,
        built_ins: &[String],
    ) {
        if built_ins.is_empty() {
            return;
        }
        let mut scanner = ShadowScanner {
            built_ins,
            scopes: std::vec::Vec::new(),
            shadowed: &mut self.shadowed_builtin_spans,
        };
        use oxc_ast_visit::Visit;
        scanner.visit_program(program);
    }

    pub(crate) fn is_builtin_shadowed(&self, span: oxc_span::Span) -> bool {
        self.shadowed_builtin_spans.contains(&span.start)
    }

    pub(crate) fn collect(&mut self, statement: &Statement<'_>) {
        match statement {
            // Babel's scope registers exported declarations like plain ones.
            Statement::ExportDeclaration(export) => match &export.declaration {
                oxc_ast::ast::Declaration::VariableDeclaration(declaration) => {
                    self.collect_variable_declaration(declaration);
                }
                oxc_ast::ast::Declaration::FunctionDeclaration(function) => {
                    if let Some(id) = &function.id {
                        let name = id.name.to_string();
                        self.declare(
                            &name,
                            DeclarationFacts {
                                is_function: true,
                                ..DeclarationFacts::default()
                            },
                        );
                    }
                }
                _ => {}
            },
            Statement::VariableDeclaration(declaration) => {
                self.collect_variable_declaration(declaration);
            }
            Statement::FunctionDeclaration(function) => {
                if let Some(id) = &function.id {
                    let name = id.name.to_string();
                    self.declare(
                        &name,
                        DeclarationFacts {
                            is_function: true,
                            ..DeclarationFacts::default()
                        },
                    );
                }
            }
            Statement::ImportDeclaration(import_declaration) => {
                if let Some(specifiers) = &import_declaration.specifiers {
                    for specifier in specifiers {
                        let (local, namespace_import) = match specifier {
                            ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                                (&specifier.local.name, false)
                            }
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                                (&specifier.local.name, false)
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                                (&specifier.local.name, true)
                            }
                        };
                        let local = local.to_string();
                        self.declare(
                            &local,
                            DeclarationFacts {
                                is_const: true,
                                namespace_import,
                                ..DeclarationFacts::default()
                            },
                        );
                    }
                }
            }
            _ => {}
        }
    }

    fn collect_variable_declaration(
        &mut self,
        declaration: &oxc_ast::ast::VariableDeclaration<'_>,
    ) {
        let is_const = declaration.kind == VariableDeclarationKind::Const;
        let hoisted = declaration.kind == VariableDeclarationKind::Var;
        for declarator in &declaration.declarations {
            let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
                let mut names = std::vec::Vec::new();
                collect_binding_names(&declarator.id, &mut names);
                for name in names {
                    self.declare(
                        &name,
                        DeclarationFacts {
                            hoisted,
                            is_const,
                            ..DeclarationFacts::default()
                        },
                    );
                }
                continue;
            };
            let name = binding.name.to_string();
            let mut facts = DeclarationFacts {
                hoisted,
                is_const,
                ..DeclarationFacts::default()
            };
            if let Some(init) = &declarator.init {
                // Babel's `detectResolvableEventHandler` follows variable
                // declarators of any kind to a function-valued init.
                facts.is_function = matches!(
                    init,
                    oxc_ast::ast::Expression::ArrowFunctionExpression(_)
                        | oxc_ast::ast::Expression::FunctionExpression(_)
                );
                if let oxc_ast::ast::Expression::BooleanLiteral(literal) = init {
                    facts.static_bool = Some(literal.value);
                }
                // Evaluate before declaring so a self-referential init can't
                // resolve to itself; earlier declarators are already visible.
                facts.static_value = static_expression(init, Some(self));
            }
            self.declare(&name, facts);
        }
    }
}

pub(crate) fn push_unique(values: &mut std::vec::Vec<String>, value: &str) {
    if !values.iter().any(|existing| existing == value) {
        values.push(value.to_string());
    }
}

fn collect_binding_names(pattern: &BindingPattern<'_>, names: &mut std::vec::Vec<String>) {
    match pattern {
        BindingPattern::BindingIdentifier(binding) => push_unique(names, &binding.name),
        BindingPattern::ArrayPattern(array) => {
            for element in array.elements.iter().flatten() {
                collect_binding_names(element, names);
            }
            if let Some(rest) = &array.rest {
                collect_binding_names(&rest.argument, names);
            }
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                collect_binding_names(&property.value, names);
            }
            if let Some(rest) = &object.rest {
                collect_binding_names(&rest.argument, names);
            }
        }
        BindingPattern::AssignmentPattern(assignment) => {
            collect_binding_names(&assignment.left, names);
        }
    }
}

/// Read-only walker behind [`BindingTable::scan_builtin_shadowing`]. Frames
/// hold only names that match a configured built-in, so the stack stays tiny.
struct ShadowScanner<'b> {
    built_ins: &'b [String],
    scopes: std::vec::Vec<std::vec::Vec<String>>,
    shadowed: &'b mut std::collections::HashSet<u32>,
}

impl ShadowScanner<'_> {
    fn frame_from_names(&self, names: std::vec::Vec<String>) -> std::vec::Vec<String> {
        names
            .into_iter()
            .filter(|name| self.built_ins.iter().any(|built_in| built_in == name))
            .collect()
    }

    fn in_scope(&self, name: &str) -> bool {
        self.scopes
            .iter()
            .any(|frame| frame.iter().any(|binding| binding == name))
    }

    fn check_tag(&mut self, name: &str, span: oxc_span::Span) {
        if self.built_ins.iter().any(|built_in| built_in == name) && self.in_scope(name) {
            self.shadowed.insert(span.start);
        }
    }

    fn params_frame(&self, params: &oxc_ast::ast::FormalParameters<'_>) -> std::vec::Vec<String> {
        let mut names = std::vec::Vec::new();
        for param in &params.items {
            collect_binding_names(&param.pattern, &mut names);
        }
        if let Some(rest) = &params.rest {
            collect_binding_names(&rest.rest.argument, &mut names);
        }
        self.frame_from_names(names)
    }
}

/// Declarations visible at the top level of a block scope: `let`/`const`,
/// classes, and (module-strict) function declarations.
fn collect_lexical_names(statements: &[Statement<'_>], names: &mut std::vec::Vec<String>) {
    for statement in statements {
        let statement = match statement {
            Statement::ExportDeclaration(export) => match &export.declaration {
                oxc_ast::ast::Declaration::VariableDeclaration(declaration) => {
                    if declaration.kind != VariableDeclarationKind::Var {
                        for declarator in &declaration.declarations {
                            collect_binding_names(&declarator.id, names);
                        }
                    }
                    continue;
                }
                oxc_ast::ast::Declaration::FunctionDeclaration(function) => {
                    if let Some(id) = &function.id {
                        names.push(id.name.to_string());
                    }
                    continue;
                }
                oxc_ast::ast::Declaration::ClassDeclaration(class) => {
                    if let Some(id) = &class.id {
                        names.push(id.name.to_string());
                    }
                    continue;
                }
                _ => continue,
            },
            other => other,
        };
        match statement {
            Statement::VariableDeclaration(declaration)
                if declaration.kind != VariableDeclarationKind::Var =>
            {
                for declarator in &declaration.declarations {
                    collect_binding_names(&declarator.id, names);
                }
            }
            Statement::FunctionDeclaration(function) => {
                if let Some(id) = &function.id {
                    names.push(id.name.to_string());
                }
            }
            Statement::ClassDeclaration(class) => {
                if let Some(id) = &class.id {
                    names.push(id.name.to_string());
                }
            }
            Statement::ImportDeclaration(import) => {
                if let Some(specifiers) = &import.specifiers {
                    for specifier in specifiers {
                        names.push(specifier.local().name.to_string());
                    }
                }
            }
            _ => {}
        }
    }
}

/// Function-scoped hoisting: `var` declarations and function declarations at
/// any statement depth inside a function body, without descending into nested
/// functions or classes.
fn collect_var_names(statements: &[Statement<'_>], names: &mut std::vec::Vec<String>) {
    for statement in statements {
        collect_var_names_from_statement(statement, names);
    }
}

fn collect_var_names_from_statement(statement: &Statement<'_>, names: &mut std::vec::Vec<String>) {
    match statement {
        Statement::VariableDeclaration(declaration)
            if declaration.kind == VariableDeclarationKind::Var =>
        {
            for declarator in &declaration.declarations {
                collect_binding_names(&declarator.id, names);
            }
        }
        Statement::FunctionDeclaration(function) => {
            if let Some(id) = &function.id {
                names.push(id.name.to_string());
            }
        }
        Statement::BlockStatement(block) => collect_var_names(&block.body, names),
        Statement::IfStatement(statement) => {
            collect_var_names_from_statement(&statement.consequent, names);
            if let Some(alternate) = &statement.alternate {
                collect_var_names_from_statement(alternate, names);
            }
        }
        Statement::ForStatement(statement) => {
            if let Some(oxc_ast::ast::ForStatementInit::VariableDeclaration(declaration)) =
                &statement.init
                && declaration.kind == VariableDeclarationKind::Var
            {
                for declarator in &declaration.declarations {
                    collect_binding_names(&declarator.id, names);
                }
            }
            collect_var_names_from_statement(&statement.body, names);
        }
        Statement::ForInStatement(statement) => {
            collect_var_names_from_for_target(&statement.left, names);
            collect_var_names_from_statement(&statement.body, names);
        }
        Statement::ForOfStatement(statement) => {
            collect_var_names_from_for_target(&statement.left, names);
            collect_var_names_from_statement(&statement.body, names);
        }
        Statement::WhileStatement(statement) => {
            collect_var_names_from_statement(&statement.body, names);
        }
        Statement::DoWhileStatement(statement) => {
            collect_var_names_from_statement(&statement.body, names);
        }
        Statement::TryStatement(statement) => {
            collect_var_names(&statement.block.body, names);
            if let Some(handler) = &statement.handler {
                collect_var_names(&handler.body.body, names);
            }
            if let Some(finalizer) = &statement.finalizer {
                collect_var_names(&finalizer.body, names);
            }
        }
        Statement::SwitchStatement(statement) => {
            for case in &statement.cases {
                collect_var_names(&case.consequent, names);
            }
        }
        Statement::LabeledStatement(statement) => {
            collect_var_names_from_statement(&statement.body, names);
        }
        _ => {}
    }
}

fn collect_var_names_from_for_target(
    target: &oxc_ast::ast::ForStatementLeft<'_>,
    names: &mut std::vec::Vec<String>,
) {
    if let oxc_ast::ast::ForStatementLeft::VariableDeclaration(declaration) = target
        && declaration.kind == VariableDeclarationKind::Var
    {
        for declarator in &declaration.declarations {
            collect_binding_names(&declarator.id, names);
        }
    }
}

fn collect_for_head_names(
    target: &oxc_ast::ast::ForStatementLeft<'_>,
    names: &mut std::vec::Vec<String>,
) {
    if let oxc_ast::ast::ForStatementLeft::VariableDeclaration(declaration) = target {
        for declarator in &declaration.declarations {
            collect_binding_names(&declarator.id, names);
        }
    }
}

impl<'b> oxc_ast_visit::Visit<'b> for ShadowScanner<'_> {
    fn visit_program(&mut self, program: &oxc_ast::ast::Program<'b>) {
        let mut names = std::vec::Vec::new();
        collect_var_names(&program.body, &mut names);
        collect_lexical_names(&program.body, &mut names);
        self.scopes.push(self.frame_from_names(names));
        oxc_ast_visit::walk::walk_program(self, program);
        self.scopes.pop();
    }

    fn visit_function(
        &mut self,
        function: &oxc_ast::ast::Function<'b>,
        flags: oxc_syntax::scope::ScopeFlags,
    ) {
        let mut names = std::vec::Vec::new();
        // A function expression's own name binds inside itself.
        if let Some(id) = &function.id {
            names.push(id.name.to_string());
        }
        let mut frame = self.frame_from_names(names);
        frame.extend(self.params_frame(&function.params));
        if let Some(body) = &function.body {
            let mut body_names = std::vec::Vec::new();
            collect_var_names(&body.statements, &mut body_names);
            collect_lexical_names(&body.statements, &mut body_names);
            frame.extend(self.frame_from_names(body_names));
        }
        self.scopes.push(frame);
        oxc_ast_visit::walk::walk_function(self, function, flags);
        self.scopes.pop();
    }

    fn visit_arrow_function_expression(
        &mut self,
        arrow: &oxc_ast::ast::ArrowFunctionExpression<'b>,
    ) {
        let mut frame = self.params_frame(&arrow.params);
        if let Some(body) = arrow.get_function_body() {
            let mut body_names = std::vec::Vec::new();
            collect_var_names(&body.statements, &mut body_names);
            collect_lexical_names(&body.statements, &mut body_names);
            frame.extend(self.frame_from_names(body_names));
        }
        self.scopes.push(frame);
        oxc_ast_visit::walk::walk_arrow_function_expression(self, arrow);
        self.scopes.pop();
    }

    fn visit_block_statement(&mut self, block: &oxc_ast::ast::BlockStatement<'b>) {
        let mut names = std::vec::Vec::new();
        collect_lexical_names(&block.body, &mut names);
        self.scopes.push(self.frame_from_names(names));
        oxc_ast_visit::walk::walk_block_statement(self, block);
        self.scopes.pop();
    }

    fn visit_static_block(&mut self, block: &oxc_ast::ast::StaticBlock<'b>) {
        let mut names = std::vec::Vec::new();
        collect_var_names(&block.body, &mut names);
        collect_lexical_names(&block.body, &mut names);
        self.scopes.push(self.frame_from_names(names));
        oxc_ast_visit::walk::walk_static_block(self, block);
        self.scopes.pop();
    }

    fn visit_for_statement(&mut self, statement: &oxc_ast::ast::ForStatement<'b>) {
        let mut names = std::vec::Vec::new();
        if let Some(oxc_ast::ast::ForStatementInit::VariableDeclaration(declaration)) =
            &statement.init
        {
            for declarator in &declaration.declarations {
                collect_binding_names(&declarator.id, &mut names);
            }
        }
        self.scopes.push(self.frame_from_names(names));
        oxc_ast_visit::walk::walk_for_statement(self, statement);
        self.scopes.pop();
    }

    fn visit_for_in_statement(&mut self, statement: &oxc_ast::ast::ForInStatement<'b>) {
        let mut names = std::vec::Vec::new();
        collect_for_head_names(&statement.left, &mut names);
        self.scopes.push(self.frame_from_names(names));
        oxc_ast_visit::walk::walk_for_in_statement(self, statement);
        self.scopes.pop();
    }

    fn visit_for_of_statement(&mut self, statement: &oxc_ast::ast::ForOfStatement<'b>) {
        let mut names = std::vec::Vec::new();
        collect_for_head_names(&statement.left, &mut names);
        self.scopes.push(self.frame_from_names(names));
        oxc_ast_visit::walk::walk_for_of_statement(self, statement);
        self.scopes.pop();
    }

    fn visit_catch_clause(&mut self, clause: &oxc_ast::ast::CatchClause<'b>) {
        let mut names = std::vec::Vec::new();
        if let Some(param) = &clause.param {
            collect_binding_names(&param.pattern, &mut names);
        }
        self.scopes.push(self.frame_from_names(names));
        oxc_ast_visit::walk::walk_catch_clause(self, clause);
        self.scopes.pop();
    }

    fn visit_class(&mut self, class: &oxc_ast::ast::Class<'b>) {
        // A class expression's own name binds inside its body.
        let mut names = std::vec::Vec::new();
        if let Some(id) = &class.id {
            names.push(id.name.to_string());
        }
        self.scopes.push(self.frame_from_names(names));
        oxc_ast_visit::walk::walk_class(self, class);
        self.scopes.pop();
    }

    fn visit_jsx_element_name(&mut self, name: &oxc_ast::ast::JSXElementName<'b>) {
        match name {
            oxc_ast::ast::JSXElementName::Identifier(identifier) => {
                self.check_tag(&identifier.name, identifier.span);
            }
            oxc_ast::ast::JSXElementName::IdentifierReference(identifier) => {
                self.check_tag(&identifier.name, identifier.span);
            }
            _ => {}
        }
        oxc_ast_visit::walk::walk_jsx_element_name(self, name);
    }
}
