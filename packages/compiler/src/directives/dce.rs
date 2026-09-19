//! Port of the Babel implementation's `removeUnusedVariables`: after
//! function-level directive extraction the client build replaces function
//! bodies with references, so anything only those bodies used — including
//! now-unneeded imports — must go. That is the server-code-leak guarantee.
//!
//! The shake is scoped to "orphan candidates": the names referenced from the
//! replaced subtrees, expanded transitively with the names referenced by each
//! declaration the shake removes. Bindings that were already unreferenced
//! before the transform are not candidates and survive untouched.
//!
//! Repeat semantic analysis and removal on the original AST until stable.
//! Keeping original spans allows a single final codegen to map to authored code.

use crate::shared::ast_builder::AstBuilder;
use oxc_allocator::Allocator;
use oxc_ast::ast::{BindingPattern, Expression, Program, Statement};
use oxc_ast_visit::{Visit, VisitMut, walk, walk_mut};
use oxc_semantic::{AstNode, Scoping, SemanticBuilder};
use oxc_span::SPAN;
use oxc_syntax::{node::NodeId, symbol::SymbolId};

/// Mirrors the Babel implementation's message verbatim (it warns through
/// `console.warn`; this side uses stderr like the template validator).
const DIRECT_EVAL_WARNING: &str = "server-functions: skipping dead-code elimination for this module because it contains a direct eval() call";

/// Remove orphan candidates and their cascades without discarding source spans.
pub(crate) fn remove_unused_variables<'a>(
    program: &mut Program<'a>,
    allocator: &'a Allocator,
    orphans: std::collections::HashSet<String>,
    dev: bool,
) {
    let mut candidates = orphans;
    if candidates.is_empty() {
        return;
    }
    {
        let semantic = SemanticBuilder::new().build(program).semantic;
        if has_direct_eval(program, semantic.scoping()) {
            if dev {
                eprintln!("{DIRECT_EVAL_WARNING}");
            }
            return;
        }
    }

    loop {
        let removals = collect_removals(program, &candidates);
        if removals.nodes.is_empty() && removals.pattern_ids.is_empty() {
            return;
        }
        let mut remover = Remover {
            nodes: removals.nodes,
            pattern_ids: removals.pattern_ids,
            candidates: &mut candidates,
            builder: AstBuilder::new(allocator),
            changed: false,
        };
        remover.visit_program(program);
        // Stop if a requested removal has no supported mutation.
        if !remover.changed {
            return;
        }
    }
}

fn has_direct_eval(program: &Program<'_>, scoping: &Scoping) -> bool {
    struct DirectEvalDetector<'s> {
        scoping: &'s Scoping,
        found: bool,
    }

    impl<'b> Visit<'b> for DirectEvalDetector<'_> {
        fn visit_call_expression(&mut self, call: &oxc_ast::ast::CallExpression<'b>) {
            if let Expression::Identifier(identifier) = &call.callee
                && identifier.name == "eval"
            {
                let shadowed = identifier
                    .reference_id
                    .get()
                    .is_some_and(|id| self.scoping.get_reference(id).symbol_id().is_some());
                if !shadowed {
                    self.found = true;
                    return;
                }
            }
            walk::walk_call_expression(self, call);
        }
    }

    let mut detector = DirectEvalDetector {
        scoping,
        found: false,
    };
    detector.visit_program(program);
    detector.found
}

/// Names in reference positions within a removed subtree — the cascade seed
/// (Babel's `collectReferencedNames`).
struct ReferencedNames<'t> {
    names: &'t mut std::collections::HashSet<String>,
}

impl<'b> Visit<'b> for ReferencedNames<'_> {
    fn visit_identifier_reference(&mut self, it: &oxc_ast::ast::IdentifierReference<'b>) {
        self.names.insert(it.name.to_string());
    }
}

// Semantic analysis assigns fresh IDs on each pass, including generated nodes
// that share dummy spans. These IDs remain stable while the remover runs.
struct Removals {
    /// Node IDs of whole nodes to remove: declarators with identifier ids,
    /// import specifier locals, function/class declarations.
    nodes: std::collections::HashSet<NodeId>,
    /// Symbol IDs of binding identifiers inside destructuring patterns, removed
    /// element-by-element (with cascade) rather than as whole declarators.
    pattern_ids: std::collections::HashSet<SymbolId>,
}

/// Bindings with no remaining read references, restricted to the
/// orphan-candidate set.
fn collect_removals(
    program: &Program<'_>,
    candidates: &std::collections::HashSet<String>,
) -> Removals {
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .build(program)
        .semantic;
    let scoping = semantic.scoping();

    // Babel treats exports as references (its scope collector calls
    // `binding.reference()` for exported declarations and specifiers), so
    // exported top-level names are never removed.
    let exported = exported_names(program);
    let root_scope = scoping.root_scope_id();

    let mut removals = Removals {
        nodes: std::collections::HashSet::new(),
        pattern_ids: std::collections::HashSet::new(),
    };
    for symbol_id in scoping.symbol_ids() {
        let name = scoping.symbol_name(symbol_id);
        // Only bindings orphaned by the rewrite (or by a prior removal) are
        // eligible; pre-existing dead code survives the transform.
        if !candidates.contains(name) {
            continue;
        }
        if scoping.symbol_scope_id(symbol_id) == root_scope && exported.contains(name) {
            continue;
        }
        let referenced = scoping
            .get_resolved_reference_ids(symbol_id)
            .iter()
            .any(|reference_id| scoping.get_reference(*reference_id).is_read());
        if referenced {
            continue;
        }
        let node: &AstNode = semantic.symbol_declaration(symbol_id);
        match node.kind() {
            oxc_ast::AstKind::VariableDeclarator(declarator) => {
                if matches!(&declarator.id, BindingPattern::BindingIdentifier(_)) {
                    // A for-in/for-of left binding cannot be removed whole —
                    // the iteration must survive. (Babel crashes here trying;
                    // keeping the loop binding is the safe superset.)
                    let nodes = semantic.nodes();
                    let declaration = nodes.parent_node(node.id());
                    if !matches!(
                        nodes.parent_kind(declaration.id()),
                        oxc_ast::AstKind::ForInStatement(_) | oxc_ast::AstKind::ForOfStatement(_)
                    ) {
                        removals.nodes.insert(declarator.node_id.get());
                    }
                } else {
                    // Destructured binding: remove just this element (the
                    // symbol ID identifies the binding).
                    removals.pattern_ids.insert(symbol_id);
                }
            }
            oxc_ast::AstKind::ImportSpecifier(specifier) => {
                removals.nodes.insert(specifier.node_id.get());
            }
            oxc_ast::AstKind::ImportDefaultSpecifier(specifier) => {
                removals.nodes.insert(specifier.node_id.get());
            }
            oxc_ast::AstKind::ImportNamespaceSpecifier(specifier) => {
                removals.nodes.insert(specifier.node_id.get());
            }
            // Function/class declarations (Babel binding kinds `hoisted` /
            // `let`). Params, catch params, and everything else stay.
            oxc_ast::AstKind::Function(function) if function.is_declaration() => {
                removals.nodes.insert(function.node_id.get());
            }
            oxc_ast::AstKind::Class(class) if class.is_declaration() => {
                removals.nodes.insert(class.node_id.get());
            }
            _ => {}
        }
    }
    removals
}

fn exported_names(program: &Program<'_>) -> std::collections::HashSet<String> {
    let mut names = std::collections::HashSet::new();
    for statement in &program.body {
        match statement {
            Statement::ExportNamedDeclaration(export) => {
                for specifier in &export.specifiers {
                    if let Some(local) = specifier.local.identifier_name() {
                        names.insert(local.to_string());
                    }
                }
            }
            Statement::ExportDeclaration(export) => {
                collect_declaration_names(&export.declaration, &mut names);
            }
            Statement::ExportDefaultDeclaration(export) => {
                if let Some(oxc_ast::ast::Expression::Identifier(identifier)) =
                    export.declaration.as_expression()
                {
                    names.insert(identifier.name.to_string());
                }
            }
            _ => {}
        }
    }
    names
}

fn collect_declaration_names(
    declaration: &oxc_ast::ast::Declaration<'_>,
    names: &mut std::collections::HashSet<String>,
) {
    match declaration {
        oxc_ast::ast::Declaration::VariableDeclaration(declaration) => {
            for declarator in &declaration.declarations {
                collect_pattern_names(&declarator.id, names);
            }
        }
        oxc_ast::ast::Declaration::FunctionDeclaration(function) => {
            if let Some(id) = &function.id {
                names.insert(id.name.to_string());
            }
        }
        oxc_ast::ast::Declaration::ClassDeclaration(class) => {
            if let Some(id) = &class.id {
                names.insert(id.name.to_string());
            }
        }
        _ => {}
    }
}

fn collect_pattern_names(
    pattern: &BindingPattern<'_>,
    names: &mut std::collections::HashSet<String>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(id) => {
            names.insert(id.name.to_string());
        }
        BindingPattern::ArrayPattern(array) => {
            for element in array.elements.iter().flatten() {
                collect_pattern_names(element, names);
            }
            if let Some(rest) = &array.rest {
                collect_pattern_names(&rest.argument, names);
            }
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                collect_pattern_names(&property.value, names);
            }
            if let Some(rest) = &object.rest {
                collect_pattern_names(&rest.argument, names);
            }
        }
        BindingPattern::AssignmentPattern(assignment) => {
            collect_pattern_names(&assignment.left, names);
        }
    }
}

struct Remover<'c, 'a> {
    nodes: std::collections::HashSet<NodeId>,
    pattern_ids: std::collections::HashSet<SymbolId>,
    /// Removed declarations cascade: names their subtrees referenced become
    /// candidates for the next fixpoint pass.
    candidates: &'c mut std::collections::HashSet<String>,
    builder: AstBuilder<'a>,
    /// Whether this pass mutated anything — the fixpoint's progress guard
    /// (a requested removal in a position that must stay would otherwise be
    /// re-requested forever).
    changed: bool,
}

impl<'a> Remover<'_, 'a> {
    fn collector(&mut self) -> ReferencedNames<'_> {
        ReferencedNames {
            names: &mut *self.candidates,
        }
    }

    /// Prunes removed binding identifiers out of a pattern. Returns true when
    /// the pattern has no bindings left and should be removed by its parent
    /// (defaults and computed keys go with their element; the caller collects
    /// references from whatever it removes).
    fn prune_pattern(&mut self, pattern: &mut BindingPattern<'a>) -> bool {
        match pattern {
            BindingPattern::BindingIdentifier(id) => id
                .symbol_id
                .get()
                .is_some_and(|id| self.pattern_ids.contains(&id)),
            BindingPattern::AssignmentPattern(assignment) => {
                if self.prune_pattern(&mut assignment.left) {
                    self.collector().visit_expression(&assignment.right);
                    true
                } else {
                    false
                }
            }
            BindingPattern::ObjectPattern(object) => {
                let mut index = 0;
                while index < object.properties.len() {
                    if self.prune_pattern(&mut object.properties[index].value) {
                        let removed = object.properties.remove(index);
                        self.collector().visit_binding_property(&removed);
                        self.changed = true;
                    } else {
                        index += 1;
                    }
                }
                if let Some(rest) = &mut object.rest
                    && self.prune_pattern(&mut rest.argument)
                {
                    object.rest = None;
                    self.changed = true;
                }
                object.properties.is_empty() && object.rest.is_none()
            }
            BindingPattern::ArrayPattern(array) => {
                for element in array.elements.iter_mut() {
                    if let Some(pattern) = element
                        && self.prune_pattern(pattern)
                    {
                        let removed = element.take().expect("checked Some above");
                        self.collector().visit_binding_pattern(&removed);
                        self.changed = true;
                    }
                }
                if let Some(rest) = &mut array.rest
                    && self.prune_pattern(&mut rest.argument)
                {
                    array.rest = None;
                    self.changed = true;
                }
                // A removed element leaves a hole when later elements remain;
                // trailing holes truncate.
                while matches!(array.elements.last(), Some(None)) {
                    array.elements.pop();
                }
                array.elements.is_empty() && array.rest.is_none()
            }
        }
    }

    /// Prunes removed declarators (whole nodes and pattern surgery) out of a
    /// declaration, wherever it appears — statement position, `for` init,
    /// single-statement bodies. Returns true when no declarators remain.
    fn prune_declaration(
        &mut self,
        declaration: &mut oxc_ast::ast::VariableDeclaration<'a>,
    ) -> bool {
        let mut index = 0;
        while index < declaration.declarations.len() {
            let declarator = &mut declaration.declarations[index];
            let remove = self.nodes.contains(&declarator.node_id.get())
                || (!matches!(declarator.id, BindingPattern::BindingIdentifier(_))
                    && self.prune_pattern(&mut declarator.id));
            if remove {
                // The initializer is orphaned with its declarator
                // (aggressive-removal semantics), so its references cascade.
                let removed = declaration.declarations.remove(index);
                self.collector().visit_variable_declarator(&removed);
                self.changed = true;
            } else {
                index += 1;
            }
        }
        declaration.declarations.is_empty()
    }

    /// Whether `statement` was a declaration (possibly behind labels) that
    /// pruning emptied entirely — the caller then applies its position's
    /// policy: dropped from statement lists, replaced by `{}` as an
    /// if/loop body (Babel's removal hooks), gone with its labels.
    fn statement_fully_removed(&mut self, statement: &mut Statement<'a>) -> bool {
        match statement {
            Statement::VariableDeclaration(declaration) => self.prune_declaration(declaration),
            // `label: var x = ...;` — the emptied statement takes its labels
            // with it (Babel's LabeledStatement removal hook).
            Statement::LabeledStatement(labeled) => self.statement_fully_removed(&mut labeled.body),
            _ => false,
        }
    }

    /// Applies removal to a single-statement body position (if/else arms,
    /// loop bodies): an emptied declaration becomes an empty block, matching
    /// Babel's removal-hook replacement.
    fn empty_removed_body(&mut self, body: &mut Statement<'a>) {
        if self.statement_fully_removed(body) {
            *body = self.builder.statement_block(SPAN, self.builder.vec());
            self.changed = true;
        }
    }
}

impl<'a> VisitMut<'a> for Remover<'_, 'a> {
    fn visit_statements(&mut self, statements: &mut oxc_allocator::Vec<'a, Statement<'a>>) {
        let mut index = 0;
        while index < statements.len() {
            let keep = match &mut statements[index] {
                Statement::FunctionDeclaration(function)
                    if self.nodes.contains(&function.node_id.get()) =>
                {
                    self.collector()
                        .visit_function(function, oxc_syntax::scope::ScopeFlags::Function);
                    false
                }
                Statement::ClassDeclaration(class) if self.nodes.contains(&class.node_id.get()) => {
                    self.collector().visit_class(class);
                    false
                }
                // Babel's `VariableDeclaration` visitor drops emptied
                // declarations; an emptied labeled declaration goes with its
                // labels (removal hook).
                statement
                @ (Statement::VariableDeclaration(_) | Statement::LabeledStatement(_)) => {
                    !self.statement_fully_removed(statement)
                }
                Statement::ImportDeclaration(import) => {
                    let declaration_is_type = import.import_kind.is_type();
                    if let Some(specifiers) = &mut import.specifiers {
                        let had = specifiers.len();
                        specifiers.retain(|specifier| {
                                let node_id = match specifier {
                                    oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(node) => node.node_id.get(),
                                    oxc_ast::ast::ImportDeclarationSpecifier::ImportDefaultSpecifier(node) => node.node_id.get(),
                                    oxc_ast::ast::ImportDeclarationSpecifier::ImportNamespaceSpecifier(node) => node.node_id.get(),
                                };
                                !self.nodes.contains(&node_id)
                            });
                        let pruned = specifiers.len() != had;
                        if pruned {
                            self.changed = true;
                        }
                        // A pruned import whose surviving specifiers are all
                        // type-only imports no runtime binding, but the
                        // declaration would still emit — and a bare module
                        // edge to a server module is exactly the leak this
                        // shake guards against. The Babel implementation
                        // counts VALUE specifiers when deciding whole-
                        // declaration removal (solid-start #2273); mirror
                        // it: the declaration goes with its last value
                        // specifier. Imports the shake never touched stay
                        // untouched.
                        let type_only = declaration_is_type
                            || specifiers.iter().all(|specifier| {
                                matches!(
                                    specifier,
                                    oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(s)
                                        if s.import_kind.is_type()
                                )
                            });
                        !(had > 0 && (specifiers.is_empty() || (pruned && type_only)))
                    } else {
                        true
                    }
                }
                _ => true,
            };
            if keep {
                index += 1;
            } else {
                statements.remove(index);
                self.changed = true;
            }
        }
        for statement in statements.iter_mut() {
            walk_mut::walk_statement(self, statement);
        }
    }

    /// Declarators in a `for` init are removable like statement-position
    /// ones; an emptied init drops entirely (`for (;;)`), matching Babel's
    /// single-declarator removal hook.
    fn visit_for_statement(&mut self, it: &mut oxc_ast::ast::ForStatement<'a>) {
        if let Some(oxc_ast::ast::ForStatementInit::VariableDeclaration(declaration)) = &mut it.init
            && self.prune_declaration(declaration)
        {
            it.init = None;
            self.changed = true;
        }
        self.empty_removed_body(&mut it.body);
        walk_mut::walk_for_statement(self, it);
    }

    /// For-in/for-of left patterns prune element-by-element, but the loop
    /// binding itself must survive for the iteration to remain — a fully
    /// emptied pattern stays as `{}`/`[]` (where Babel crashes trying to
    /// remove the whole left).
    fn visit_for_in_statement(&mut self, it: &mut oxc_ast::ast::ForInStatement<'a>) {
        if let oxc_ast::ast::ForStatementLeft::VariableDeclaration(declaration) = &mut it.left {
            for declarator in declaration.declarations.iter_mut() {
                if !matches!(declarator.id, BindingPattern::BindingIdentifier(_)) {
                    self.prune_pattern(&mut declarator.id);
                }
            }
        }
        self.empty_removed_body(&mut it.body);
        walk_mut::walk_for_in_statement(self, it);
    }

    fn visit_for_of_statement(&mut self, it: &mut oxc_ast::ast::ForOfStatement<'a>) {
        if let oxc_ast::ast::ForStatementLeft::VariableDeclaration(declaration) = &mut it.left {
            for declarator in declaration.declarations.iter_mut() {
                if !matches!(declarator.id, BindingPattern::BindingIdentifier(_)) {
                    self.prune_pattern(&mut declarator.id);
                }
            }
        }
        self.empty_removed_body(&mut it.body);
        walk_mut::walk_for_of_statement(self, it);
    }

    /// Emptied single-statement bodies: if arms become `{}` / drop the
    /// `else`, loop bodies become `{}` (Babel's removal hooks).
    fn visit_if_statement(&mut self, it: &mut oxc_ast::ast::IfStatement<'a>) {
        self.empty_removed_body(&mut it.consequent);
        if let Some(alternate) = &mut it.alternate
            && self.statement_fully_removed(alternate)
        {
            it.alternate = None;
            self.changed = true;
        }
        walk_mut::walk_if_statement(self, it);
    }

    fn visit_while_statement(&mut self, it: &mut oxc_ast::ast::WhileStatement<'a>) {
        self.empty_removed_body(&mut it.body);
        walk_mut::walk_while_statement(self, it);
    }

    fn visit_do_while_statement(&mut self, it: &mut oxc_ast::ast::DoWhileStatement<'a>) {
        self.empty_removed_body(&mut it.body);
        walk_mut::walk_do_while_statement(self, it);
    }
}
