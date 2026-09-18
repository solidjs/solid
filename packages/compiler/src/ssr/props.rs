//! SSR hoisted props shapes — the oxc side of `babel-plugin/src/ssr/props.ts`
//! (#3511), byte-for-byte the same emission.
//!
//! A component's compiled props literal with getters is a dictionary-mode
//! object in V8 (an accessor in a literal skips the boilerplate fast path)
//! and allocates a closure per getter per instance. On the server every such
//! site becomes a module-level constructor whose getters are SHARED across
//! instances and read their state off the instance:
//!
//! ```js
//! var _m$ = Symbol();
//! var _d$ = { get() { const props = this[_m$]; return props.label; },
//!             enumerable: true, configurable: true };
//! function _P$(_p$, _p$2) { this[_m$] = _p$; this.as = _p$2;
//!                           Object.defineProperty(this, "label", _d$); }
//! _P$.prototype = Object.prototype;
//! Comp(new _P$(props, "a"))
//! ```
//!
//! Same own keys, order and descriptors, prototype `Object.prototype`. A
//! getter is defined only for a read through its object. Locals a body closes
//! over are captured by value at construction — equivalent only when the
//! binding can never change; anything else keeps the literal at that site.
//!
//! Runs after the SSR transform over the literals it marked (by the JSX
//! element's span), so every getter body is final. Two phases: a read-only
//! plan over `oxc_semantic` (post-order — a site nested in another's getter
//! is planned first, and the outer body sees it as the `new` it becomes),
//! then the rewrite.

use std::collections::{HashMap, HashSet};

use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::{AstKind, ast::*};
use oxc_ast_visit::{Visit, VisitMut, walk, walk_mut};
use oxc_semantic::{NodeId, Semantic, SemanticBuilder, SymbolFlags, SymbolId};
use oxc_span::{GetSpan, SPAN, Span};
use oxc_syntax::{
    operator::{AssignmentOperator, BinaryOperator, UnaryOperator},
    scope::ScopeFlags,
};

use crate::shared::ast::expression_to_argument;
use crate::shared::ast_builder::AstBuilder;
use crate::shared::utils::indexed_local;

const RECEIVER_MESSAGE: &str = "A props getter was read on an object that is not its props (a copied property descriptor?). Read through the props object, or use omit()/merge().";

/// Rewrites every planned site in `program` and returns the module-level
/// shapes for `prepend_helpers` to place. `sites` are the span starts of the
/// component elements whose props literals are candidates; `transparent`
/// the span starts of the module-level `_self$` capture IIFEs the transform
/// wrapped JSX roots in (module-level code to Babel, so not a function
/// parent here); `taken` the identifier names of the source (a name outside
/// it is compiler-made).
pub(crate) fn hoist_props<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
    sites: &HashSet<u32>,
    transparent: &HashSet<u32>,
    taken: &HashSet<String>,
    dev: bool,
) -> std::vec::Vec<Statement<'a>> {
    if sites.is_empty() {
        return std::vec::Vec::new();
    }
    let plans = {
        let semantic = SemanticBuilder::new()
            .with_build_nodes(true)
            .build(program)
            .semantic;
        let mut planner = Planner {
            semantic: &semantic,
            sites,
            transparent,
            taken,
            plans: HashMap::new(),
            function_depth: 0,
        };
        planner.visit_program(program);
        planner.plans
    };
    if plans.is_empty() {
        return std::vec::Vec::new();
    }
    let mut emitter = Emitter {
        ast: AstBuilder::new(allocator),
        plans,
        taken,
        dev,
        symbol_index: 0,
        ctor_index: 0,
        descriptor_index: 0,
        param_index: 0,
        symbols: std::vec::Vec::new(),
        hoisted: std::vec::Vec::new(),
        removed_temps: HashSet::new(),
    };
    emitter.visit_program(program);
    if !emitter.removed_temps.is_empty() {
        let mut cleanup = TempCleanup {
            names: &emitter.removed_temps,
        };
        cleanup.visit_program(program);
    }
    let ast = emitter.ast;
    let mut out = std::vec::Vec::new();
    if !emitter.symbols.is_empty() {
        let declarators = ast.vec_from_iter(emitter.symbols.iter().map(|name| {
            let callee = ast.expression_identifier(SPAN, ast.ident("Symbol"));
            let call = ast.expression_call(SPAN, callee, None, ast.vec(), false);
            ast.variable_declarator(
                SPAN,
                VariableDeclarationKind::Var,
                ast.binding_pattern_binding_identifier(SPAN, ast.ident(name)),
                None,
                Some(call),
                false,
            )
        }));
        out.push(Statement::VariableDeclaration(
            ast.alloc_variable_declaration(SPAN, VariableDeclarationKind::Var, declarators, false),
        ));
    }
    out.extend(emitter.hoisted);
    out
}

// --- Phase 1: plan -----------------------------------------------------------

struct SitePlan {
    /// Captured bindings in first-appearance order — the constructor's
    /// leading parameters and the `new` arguments.
    captures: std::vec::Vec<Capture>,
    /// One per method property (getter or `ref`), in property order.
    methods: std::vec::Vec<MethodPlan>,
}

#[derive(Clone)]
struct Capture {
    symbol: SymbolId,
    name: String,
}

#[derive(Default)]
struct MethodPlan {
    /// Indices into `captures`, in this body's first-use order (its aliases).
    uses: std::vec::Vec<usize>,
    /// Compiler temps (`var _v$;`) that live only in this body: declared here.
    temps: std::vec::Vec<String>,
}

struct Planner<'s, 'a> {
    semantic: &'s Semantic<'a>,
    sites: &'s HashSet<u32>,
    transparent: &'s HashSet<u32>,
    taken: &'s HashSet<String>,
    plans: HashMap<NodeId, SitePlan>,
    function_depth: usize,
}

impl<'a> Visit<'a> for Planner<'_, 'a> {
    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        self.function_depth += 1;
        walk::walk_function(self, it, flags);
        self.function_depth -= 1;
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        // The transform's own module-level capture IIFE runs once, in place.
        if self.transparent.contains(&it.span.start) {
            walk::walk_arrow_function_expression(self, it);
            return;
        }
        self.function_depth += 1;
        walk::walk_arrow_function_expression(self, it);
        self.function_depth -= 1;
    }

    fn visit_object_expression(&mut self, it: &ObjectExpression<'a>) {
        // Inner sites first: the outer body then sees them as constructed.
        walk::walk_object_expression(self, it);
        // A module-level site is built once; nothing to win.
        if self.function_depth == 0 || !self.sites.contains(&it.span.start) {
            return;
        }
        if let Some(plan) = self.plan_site(it) {
            self.plans.insert(it.node_id.get(), plan);
        }
    }
}

/// What a property of the literal is, once the literal is known to be
/// expressible as a constructor.
enum Member<'s, 'a> {
    Data,
    Getter(&'s Function<'a>),
    Ref(&'s Function<'a>),
}

fn key_name(property: &ObjectProperty<'_>) -> Option<String> {
    if property.computed {
        return None;
    }
    match &property.key {
        PropertyKey::StaticIdentifier(id) => Some(id.name.to_string()),
        PropertyKey::StringLiteral(s) => Some(s.value.to_string()),
        _ => None,
    }
}

impl<'a> Planner<'_, 'a> {
    fn plan_site(&self, literal: &ObjectExpression<'a>) -> Option<SitePlan> {
        // ---- shape: what a constructor can express -----------------------------
        let mut seen = HashSet::new();
        let mut members = std::vec::Vec::new();
        let mut has_getter = false;
        for property in &literal.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            let key = key_name(property)?;
            if key == "__proto__" || !seen.insert(key.clone()) {
                return None;
            }
            match property.kind {
                PropertyKind::Set => return None,
                PropertyKind::Get => {
                    let Expression::FunctionExpression(function) = &property.value else {
                        return None;
                    };
                    has_getter = true;
                    members.push(Member::Getter(function));
                }
                PropertyKind::Init if property.method => {
                    if key != "ref" {
                        return None;
                    }
                    let Expression::FunctionExpression(function) = &property.value else {
                        return None;
                    };
                    members.push(Member::Ref(function));
                }
                PropertyKind::Init => members.push(Member::Data),
            }
        }
        if !has_getter {
            return None;
        }

        // ---- captures: what the bodies close over -------------------------------
        let mut captures = std::vec::Vec::new();
        let mut methods = std::vec::Vec::new();
        for member in &members {
            let function = match member {
                Member::Data => continue,
                Member::Getter(function) | Member::Ref(function) => *function,
            };
            let body = function.body.as_ref()?;
            let mut scan = BodyScan {
                planner: self,
                site: literal.span,
                method: function.node_id.get(),
                captures: &mut captures,
                plan: MethodPlan::default(),
                temps: std::vec::Vec::new(),
                fallback: false,
            };
            scan.visit_function_body(body);
            if scan.fallback {
                return None;
            }
            methods.push(scan.plan);
        }
        Some(SitePlan { captures, methods })
    }

    /// Is `node` inside a non-arrow function that is itself inside `method`?
    /// Such a function has its own `this`/`arguments`.
    fn inside_real_function(&self, node: NodeId, method: NodeId) -> bool {
        for ancestor in self.semantic.nodes().ancestor_ids(node) {
            if ancestor == method {
                return false;
            }
            if matches!(self.semantic.nodes().kind(ancestor), AstKind::Function(_)) {
                return true;
            }
        }
        false
    }

    fn is_inside(&self, node: NodeId, ancestor: NodeId) -> bool {
        self.semantic
            .nodes()
            .ancestor_ids(node)
            .any(|id| id == ancestor)
    }

    fn is_generated(&self, name: &str) -> bool {
        !self.taken.contains(name)
    }

    /// Babel's `!binding.constant`: assigned anywhere, or declared twice.
    fn is_mutated(&self, symbol: SymbolId) -> bool {
        let scoping = self.semantic.scoping();
        scoping.symbol_is_mutated(symbol) || !scoping.symbol_redeclarations(symbol).is_empty()
    }

    /// The SSR template emits `(_v$ = init, ssr(_tmpl$, _v$))` with `var _v$;`
    /// hoisted to the enclosing function. A temp that lives only inside
    /// `method` is declared inside it instead.
    fn is_local_temp(&self, symbol: SymbolId, method: NodeId) -> bool {
        let scoping = self.semantic.scoping();
        let flags = scoping.symbol_flags(symbol);
        if !flags.contains(SymbolFlags::FunctionScopedVariable)
            || flags.contains(SymbolFlags::CatchVariable)
            || !self.is_generated(scoping.symbol_name(symbol))
        {
            return false;
        }
        let declaration = scoping.symbol_declaration(symbol);
        let AstKind::VariableDeclarator(declarator) = self.semantic.nodes().kind(declaration)
        else {
            return false;
        };
        declarator.init.is_none()
            && scoping
                .get_resolved_references(symbol)
                .all(|reference| self.is_inside(reference.node_id(), method))
    }

    /// Is `symbol` initialized by the time the site constructs its props? The
    /// getter read it lazily; the constructor reads it now. A parameter or a
    /// function always is, and so is a compiler-made binding (declared right
    /// before the statement that uses it). Otherwise the declaration must
    /// precede the site in source, and the site must not sit inside the
    /// declaration itself (`const x = <Comp a={x.y} />` reads `x` lazily today).
    fn declared_before(&self, symbol: SymbolId, site: Span) -> bool {
        let scoping = self.semantic.scoping();
        let declaration = scoping.symbol_declaration(symbol);
        let kind = self.semantic.nodes().kind(declaration);
        if matches!(
            kind,
            AstKind::FormalParameter(_)
                | AstKind::FormalParameterRest(_)
                | AstKind::BindingRestElement(_)
                | AstKind::Function(_)
        ) {
            return true;
        }
        if self.is_generated(scoping.symbol_name(symbol)) {
            return true;
        }
        let span = kind.span();
        if span.start <= site.start && site.end <= span.end {
            return false;
        }
        span.start < site.start
    }
}

struct BodyScan<'p, 's, 'a> {
    planner: &'p Planner<'s, 'a>,
    site: Span,
    method: NodeId,
    captures: &'p mut std::vec::Vec<Capture>,
    plan: MethodPlan,
    temps: std::vec::Vec<SymbolId>,
    fallback: bool,
}

impl<'a> BodyScan<'_, '_, 'a> {
    fn reference(&mut self, symbol: SymbolId, name: &str, write: bool) {
        if self.fallback {
            return;
        }
        let semantic = self.planner.semantic;
        let scoping = semantic.scoping();
        // Module-level: read live from module level, as from here.
        if scoping.symbol_scope_id(symbol) == scoping.root_scope_id() {
            return;
        }
        // Declared inside the body: moves with it.
        if self
            .planner
            .is_inside(scoping.symbol_declaration(symbol), self.method)
        {
            return;
        }
        if self.temps.contains(&symbol) {
            return;
        }
        if self.planner.is_local_temp(symbol, self.method) {
            self.temps.push(symbol);
            self.plan.temps.push(name.to_string());
            return;
        }
        if write
            || self.planner.is_mutated(symbol)
            || !self.planner.declared_before(symbol, self.site)
        {
            self.fallback = true;
            return;
        }
        let index = match self.captures.iter().position(|c| c.symbol == symbol) {
            Some(index) => index,
            None => {
                self.captures.push(Capture {
                    symbol,
                    name: name.to_string(),
                });
                self.captures.len() - 1
            }
        };
        if !self.plan.uses.contains(&index) {
            self.plan.uses.push(index);
        }
    }

    fn receiver_use(&mut self, node: NodeId) {
        if !self.planner.inside_real_function(node, self.method) {
            self.fallback = true;
        }
    }
}

impl<'a> Visit<'a> for BodyScan<'_, '_, 'a> {
    fn visit_object_expression(&mut self, it: &ObjectExpression<'a>) {
        if self.fallback {
            return;
        }
        let Some(inner) = self.planner.plans.get(&it.node_id.get()) else {
            walk::walk_object_expression(self, it);
            return;
        };
        // A nested site already planned: the body will hold
        // `new _P$(captures…, data values…)` here — its getter bodies move to
        // module level and are not this body's business.
        let captures = inner.captures.clone();
        for capture in captures {
            self.reference(capture.symbol, &capture.name, false);
        }
        for property in &it.properties {
            if let ObjectPropertyKind::ObjectProperty(property) = property
                && property.kind == PropertyKind::Init
                && !property.method
            {
                self.visit_expression(&property.value);
            }
        }
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        if self.fallback {
            return;
        }
        let reference = self
            .planner
            .semantic
            .scoping()
            .get_reference(it.reference_id());
        match reference.symbol_id() {
            // A global, or a template id postprocess declares at module level
            // after this: visible from module level as from here.
            None => {
                if it.name == "arguments" {
                    self.receiver_use(it.node_id.get());
                }
            }
            Some(symbol) => self.reference(symbol, &it.name, reference.is_write()),
        }
    }

    fn visit_this_expression(&mut self, it: &ThisExpression) {
        self.receiver_use(it.node_id.get());
    }

    fn visit_super(&mut self, it: &Super) {
        self.receiver_use(it.node_id.get());
    }

    fn visit_new_target(&mut self, it: &NewTarget) {
        self.receiver_use(it.node_id.get());
    }

    fn visit_private_field_expression(&mut self, _it: &PrivateFieldExpression<'a>) {
        self.fallback = true; // only parses inside its class body
    }

    fn visit_private_in_expression(&mut self, _it: &PrivateInExpression<'a>) {
        self.fallback = true;
    }
}

// --- Phase 2: emit -------------------------------------------------------------

/// Next `_prefix$N` not used anywhere in the source (Babel's
/// `generateUidIdentifier("prefix$")`).
fn uid(prefix: &str, index: &mut usize, taken: &HashSet<String>) -> String {
    loop {
        *index += 1;
        let name = indexed_local(prefix, *index);
        if !taken.contains(&name) {
            return name;
        }
    }
}

/// Next `_pN` in Babel's `generateUidIdentifier("p")` order — `_p`, `_p2` …
/// `_p9`, `_p0`, `_p1`, `_p10`, `_p11` … (its counter skips the two names
/// the leading `_p` and `_p1` would collide with). No `$`: the harness
/// canonicalizes `_x$N` names, so these must match Babel's byte for byte.
fn param_uid(index: &mut usize, taken: &HashSet<String>) -> String {
    loop {
        let i = *index;
        *index += 1;
        let name = match i {
            0 => "_p".to_string(),
            1..=8 => format!("_p{}", i + 1),
            9..=10 => format!("_p{}", i - 9),
            _ => format!("_p{}", i - 1),
        };
        if !taken.contains(&name) {
            return name;
        }
    }
}

struct Emitter<'t, 'a> {
    ast: AstBuilder<'a>,
    plans: HashMap<NodeId, SitePlan>,
    taken: &'t HashSet<String>,
    dev: bool,
    symbol_index: usize,
    ctor_index: usize,
    descriptor_index: usize,
    param_index: usize,
    /// `_m$`, `_m$2`, … — one slot per capture position, shared by every site.
    symbols: std::vec::Vec<String>,
    hoisted: std::vec::Vec<Statement<'a>>,
    /// Function-level `var _v$;` declarators that moved into a getter.
    removed_temps: HashSet<String>,
}

impl<'a> VisitMut<'a> for Emitter<'_, 'a> {
    fn visit_expression(&mut self, it: &mut Expression<'a>) {
        walk_mut::walk_expression(self, it);
        let Expression::ObjectExpression(literal) = it else {
            return;
        };
        let Some(plan) = self.plans.remove(&literal.node_id.get()) else {
            return;
        };
        *it = self.emit_site(literal, &plan);
    }
}

impl<'a> Emitter<'_, 'a> {
    fn ident(&self, name: &str) -> Expression<'a> {
        self.ast.expression_identifier(SPAN, self.ast.ident(name))
    }

    fn this_slot(&self, index: usize) -> Expression<'a> {
        Expression::ComputedMemberExpression(self.ast.alloc_computed_member_expression(
            SPAN,
            self.ast.expression_this(SPAN),
            self.ident(&self.symbols[index]),
            false,
        ))
    }

    fn assign(&self, target: Expression<'a>, value: Expression<'a>) -> Statement<'a> {
        let target = match target {
            Expression::ComputedMemberExpression(member) => {
                AssignmentTarget::ComputedMemberExpression(member)
            }
            Expression::StaticMemberExpression(member) => {
                AssignmentTarget::StaticMemberExpression(member)
            }
            _ => unreachable!("assignment targets here are member expressions"),
        };
        self.ast.statement_expression(
            SPAN,
            self.ast
                .expression_assignment(SPAN, AssignmentOperator::Assign, target, value),
        )
    }

    /// `this.key` / `this["a-b"]`.
    fn own(&self, key: &str) -> Expression<'a> {
        if oxc_syntax::identifier::is_identifier_name(key) {
            Expression::StaticMemberExpression(self.ast.alloc_static_member_expression(
                SPAN,
                self.ast.expression_this(SPAN),
                self.ast.identifier_name(SPAN, self.ast.ident(key)),
                false,
            ))
        } else {
            Expression::ComputedMemberExpression(
                self.ast.alloc_computed_member_expression(
                    SPAN,
                    self.ast.expression_this(SPAN),
                    self.ast
                        .expression_string_literal(SPAN, self.ast.str(key), None),
                    false,
                ),
            )
        }
    }

    /// The statements a body starts with: the dev guard, one alias per
    /// captured binding it uses, its local temps.
    fn prelude(
        &self,
        method: &MethodPlan,
        plan: &SitePlan,
        getter: bool,
    ) -> ArenaVec<'a, Statement<'a>> {
        let ast = self.ast;
        let mut out = ast.vec();
        if self.dev && getter && !method.uses.is_empty() {
            // Dev names the rule when a forwarded descriptor is read elsewhere.
            let test = ast.expression_unary(
                SPAN,
                UnaryOperator::LogicalNot,
                ast.expression_binary(
                    SPAN,
                    self.ident(&self.symbols[method.uses[0]]),
                    BinaryOperator::In,
                    ast.expression_this(SPAN),
                ),
            );
            let error = ast.expression_new(
                SPAN,
                self.ident("Error"),
                ast.vec1(expression_to_argument(ast.expression_string_literal(
                    SPAN,
                    ast.str(RECEIVER_MESSAGE),
                    None,
                ))),
            );
            out.push(ast.statement_if(SPAN, test, ast.statement_throw(SPAN, error), None));
        }
        for &index in &method.uses {
            let capture = &plan.captures[index];
            out.push(Statement::VariableDeclaration(
                ast.alloc_variable_declaration(
                    SPAN,
                    VariableDeclarationKind::Const,
                    ast.vec1(ast.variable_declarator(
                        SPAN,
                        VariableDeclarationKind::Const,
                        ast.binding_pattern_binding_identifier(SPAN, ast.ident(&capture.name)),
                        None,
                        Some(self.this_slot(index)),
                        false,
                    )),
                    false,
                ),
            ));
        }
        if !method.temps.is_empty() {
            out.push(Statement::VariableDeclaration(
                ast.alloc_variable_declaration(
                    SPAN,
                    VariableDeclarationKind::Var,
                    ast.vec_from_iter(method.temps.iter().map(|name| {
                        ast.variable_declarator(
                            SPAN,
                            VariableDeclarationKind::Var,
                            ast.binding_pattern_binding_identifier(SPAN, ast.ident(name)),
                            None,
                            None,
                            false,
                        )
                    })),
                    false,
                ),
            ));
        }
        out
    }

    fn emit_site(&mut self, literal: &mut ObjectExpression<'a>, plan: &SitePlan) -> Expression<'a> {
        let ast = self.ast;
        while self.symbols.len() < plan.captures.len() {
            let name = uid("_m", &mut self.symbol_index, self.taken);
            self.symbols.push(name);
        }
        let ctor = uid("_P", &mut self.ctor_index, self.taken);
        let mut params: std::vec::Vec<String> = std::vec::Vec::new();
        let mut args: ArenaVec<'a, Argument<'a>> = ast.vec();
        let mut body: ArenaVec<'a, Statement<'a>> = ast.vec();
        let mut descriptors: ArenaVec<'a, VariableDeclarator<'a>> = ast.vec();

        for (index, capture) in plan.captures.iter().enumerate() {
            let param = param_uid(&mut self.param_index, self.taken);
            args.push(expression_to_argument(self.ident(&capture.name)));
            body.push(self.assign(self.this_slot(index), self.ident(&param)));
            params.push(param);
        }

        let properties = std::mem::replace(&mut literal.properties, ast.vec());
        let mut method_index = 0;
        for property in properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                unreachable!("planned literal has no spread");
            };
            let property = property.unbox();
            let key = key_name(&property).expect("planned literal has plain keys");
            let is_method = property.kind == PropertyKind::Get || property.method;
            if !is_method {
                let param = param_uid(&mut self.param_index, self.taken);
                args.push(expression_to_argument(property.value));
                body.push(self.assign(self.own(&key), self.ident(&param)));
                params.push(param);
                continue;
            }
            let method = &plan.methods[method_index];
            method_index += 1;
            let Expression::FunctionExpression(function) = property.value else {
                unreachable!("planned method is a function");
            };
            let function = function.unbox();
            let getter = property.kind == PropertyKind::Get;
            let mut statements = self.prelude(method, plan, getter);
            if let Some(function_body) = function.body {
                let function_body = function_body.unbox();
                statements.extend(function_body.statements);
            }
            let fn_body = ast.function_body(SPAN, ast.vec(), statements);
            if getter {
                let descriptor = uid("_d", &mut self.descriptor_index, self.taken);
                let get = ast.expression_function(
                    SPAN,
                    FunctionType::FunctionExpression,
                    None,
                    false,
                    false,
                    false,
                    None,
                    None,
                    ast.formal_parameters(
                        SPAN,
                        FormalParameterKind::UniqueFormalParameters,
                        ast.vec(),
                        None,
                    ),
                    None,
                    Some(fn_body),
                );
                let object = ast.expression_object(
                    SPAN,
                    ast.vec_from_array([
                        ast.object_property_kind_object_property(
                            SPAN,
                            PropertyKind::Init,
                            ast.property_key_static_identifier(SPAN, ast.ident("get")),
                            get,
                            true,
                            false,
                            false,
                        ),
                        ast.object_property_kind_object_property(
                            SPAN,
                            PropertyKind::Init,
                            ast.property_key_static_identifier(SPAN, ast.ident("enumerable")),
                            ast.expression_boolean_literal(SPAN, true),
                            false,
                            false,
                            false,
                        ),
                        ast.object_property_kind_object_property(
                            SPAN,
                            PropertyKind::Init,
                            ast.property_key_static_identifier(SPAN, ast.ident("configurable")),
                            ast.expression_boolean_literal(SPAN, true),
                            false,
                            false,
                            false,
                        ),
                    ]),
                );
                descriptors.push(ast.variable_declarator(
                    SPAN,
                    VariableDeclarationKind::Var,
                    ast.binding_pattern_binding_identifier(SPAN, ast.ident(&descriptor)),
                    None,
                    Some(object),
                    false,
                ));
                let define =
                    Expression::StaticMemberExpression(ast.alloc_static_member_expression(
                        SPAN,
                        self.ident("Object"),
                        ast.identifier_name(SPAN, ast.ident("defineProperty")),
                        false,
                    ));
                let call = ast.expression_call(
                    SPAN,
                    define,
                    None,
                    ast.vec_from_array([
                        expression_to_argument(ast.expression_this(SPAN)),
                        expression_to_argument(ast.expression_string_literal(
                            SPAN,
                            ast.str(&key),
                            None,
                        )),
                        expression_to_argument(self.ident(&descriptor)),
                    ]),
                    false,
                );
                body.push(ast.statement_expression(SPAN, call));
            } else {
                // `ref(r$) {…}`: an own data property holding a per-instance
                // arrow — a consumer calls it detached, so it cannot use `this`.
                let arrow = ast.expression_arrow_function(
                    SPAN,
                    false,
                    false,
                    None,
                    function.params.unbox(),
                    None,
                    fn_body,
                );
                body.push(self.assign(self.own(&key), arrow));
            }
            for temp in &method.temps {
                self.removed_temps.insert(temp.clone());
            }
        }

        if !descriptors.is_empty() {
            self.hoisted.push(Statement::VariableDeclaration(
                ast.alloc_variable_declaration(
                    SPAN,
                    VariableDeclarationKind::Var,
                    descriptors,
                    false,
                ),
            ));
        }
        let formal_parameters = ast.formal_parameters(
            SPAN,
            FormalParameterKind::FormalParameter,
            ast.vec_from_iter(params.iter().map(|name| {
                ast.formal_parameter(
                    SPAN,
                    ast.vec(),
                    ast.binding_pattern_binding_identifier(SPAN, ast.ident(name)),
                    None,
                    None,
                    false,
                    None,
                    false,
                    false,
                )
            })),
            None,
        );
        self.hoisted.push(ast.statement_function_declaration(
            SPAN,
            ast.binding_identifier(SPAN, ast.ident(&ctor)),
            formal_parameters,
            ast.function_body(SPAN, ast.vec(), body),
        ));
        let prototype = |object: Expression<'a>| {
            Expression::StaticMemberExpression(ast.alloc_static_member_expression(
                SPAN,
                object,
                ast.identifier_name(SPAN, ast.ident("prototype")),
                false,
            ))
        };
        self.hoisted.push(self.assign(
            prototype(self.ident(&ctor)),
            prototype(self.ident("Object")),
        ));

        ast.expression_new(literal.span, self.ident(&ctor), args)
    }
}

/// Drops the function-level `var _v$;` declarators whose temps moved into a
/// getter (a generated name is unique in the file), and any declaration left
/// empty by that.
struct TempCleanup<'t> {
    names: &'t HashSet<String>,
}

impl<'a> VisitMut<'a> for TempCleanup<'_> {
    fn visit_variable_declaration(&mut self, it: &mut VariableDeclaration<'a>) {
        walk_mut::walk_variable_declaration(self, it);
        it.declarations.retain(|declarator| {
            !(declarator.init.is_none()
                && matches!(&declarator.id, BindingPattern::BindingIdentifier(id) if self.names.contains(id.name.as_str())))
        });
    }

    fn visit_statements(&mut self, it: &mut ArenaVec<'a, Statement<'a>>) {
        walk_mut::walk_statements(self, it);
        it.retain(|statement| {
            !matches!(statement, Statement::VariableDeclaration(declaration) if declaration.declarations.is_empty())
        });
    }
}
