//! Post-reparse rewrites for the TSRX frontend.
//!
//! The projection keeps authored binding names (`let [count, setCount] = …`,
//! `function C({ name })`) so the reparsed program has real bindings that
//! `oxc_semantic` resolves exactly. This pass then applies, by symbol:
//!
//! - **Lazy renames** — each anchored `&` pattern collapses to one `__lazyN`
//!   binding, and every reference to a destructured name becomes a deferred
//!   member access (`count` → `__lazy0[0]`, `name` → `__lazy1.name`),
//!   matching `@tsrx/core`'s `applyLazyTransforms` output byte-for-byte.
//! - **Accessor call rewrites** — reads of anchored arrow parameters become
//!   zero-argument calls (`item` → `item()`), the RC accessor adaptation for
//!   keyed `For` items, `For` indexes, and `@catch` error bindings. Pure
//!   reads only: writes and read-write updates stay untouched, mirroring the
//!   Babel frontend's `rewriteReadsToCalls`.

use std::collections::{HashMap, HashSet};

use oxc_allocator::{Allocator, CloneIn};
use oxc_ast::ast::{
    Argument, ArrowFunctionBody, AssignmentTarget, BindingPattern, Expression, Function,
    FunctionBody, ImportOrExportKind, JSXElementName, JSXMemberExpressionObject, ObjectProperty,
    Program, PropertyKey, SimpleAssignmentTarget, Statement, VariableDeclarationKind,
};
use oxc_ast_visit::{VisitMut, walk_mut};
use oxc_semantic::{Semantic, SemanticBuilder};
use oxc_span::{GetSpan, GetSpanMut, Span};
use oxc_syntax::{
    number::NumberBase,
    operator::{AssignmentOperator, BinaryOperator, LogicalOperator},
    scope::ScopeFlags,
    symbol::SymbolId,
};

use crate::shared::ast_builder::AstBuilder;

use super::project::Projection;

type SpanKey = (u32, u32);

#[derive(Default)]
struct Names {
    used: HashSet<String>,
    next: HashMap<&'static str, u32>,
}

impl Names {
    fn allocate(&mut self, prefix: &'static str) -> String {
        let mut index = *self.next.get(prefix).unwrap_or(&0);
        loop {
            let name = format!("{prefix}{index}");
            index += 1;
            if self.used.insert(name.clone()) {
                self.next.insert(prefix, index);
                return name;
            }
        }
    }
}

enum AccessStep<'a> {
    Static(String),
    Computed(Expression<'a>),
    Default(Expression<'a>),
}

struct LazyBinding<'a> {
    identity: Option<SymbolId>,
    source: String,
    source_accessor: bool,
    steps: Vec<AccessStep<'a>>,
    direct_default: Option<Expression<'a>>,
    kind: LazyKind<'a>,
    jsx_compatible: bool,
}

enum LazyKind<'a> {
    Value,
    ObjectRest(Vec<RestKey<'a>>),
    ArrayRest(usize),
}

enum RestKey<'a> {
    Static(String),
    Computed(Expression<'a>),
}

enum Replacement<'a> {
    Lazy(LazyBinding<'a>),
    Call,
}

impl<'a> LazyBinding<'a> {
    fn clone_in(&self, allocator: &'a Allocator) -> Self {
        Self {
            identity: self.identity,
            source: self.source.clone(),
            source_accessor: self.source_accessor,
            steps: self
                .steps
                .iter()
                .map(|step| match step {
                    AccessStep::Static(name) => AccessStep::Static(name.clone()),
                    AccessStep::Computed(value) => AccessStep::Computed(value.clone_in(allocator)),
                    AccessStep::Default(value) => AccessStep::Default(value.clone_in(allocator)),
                })
                .collect(),
            direct_default: self
                .direct_default
                .as_ref()
                .map(|value| value.clone_in(allocator)),
            kind: match &self.kind {
                LazyKind::Value => LazyKind::Value,
                LazyKind::ObjectRest(keys) => LazyKind::ObjectRest(
                    keys.iter()
                        .map(|key| match key {
                            RestKey::Static(name) => RestKey::Static(name.clone()),
                            RestKey::Computed(value) => {
                                RestKey::Computed(value.clone_in(allocator))
                            }
                        })
                        .collect(),
                ),
                LazyKind::ArrayRest(index) => LazyKind::ArrayRest(*index),
            },
            jsx_compatible: self.jsx_compatible,
        }
    }

    fn embedded_spans(&self) -> Vec<Span> {
        let mut spans = Vec::new();
        for step in &self.steps {
            if let AccessStep::Computed(value) | AccessStep::Default(value) = step {
                spans.push(value.span());
            }
        }
        if let LazyKind::ObjectRest(keys) = &self.kind {
            for key in keys {
                if let RestKey::Computed(value) = key {
                    spans.push(value.span());
                }
            }
        }
        spans
    }

    fn has_ancestor_default(&self) -> bool {
        self.steps.iter().enumerate().any(|(index, step)| {
            matches!(step, AccessStep::Default(_))
                && self.steps[index + 1..]
                    .iter()
                    .any(|next| !matches!(next, AccessStep::Default(_)))
        })
    }
}

struct Plan<'a> {
    references: HashMap<SpanKey, Replacement<'a>>,
    patterns: HashMap<SpanKey, String>,
    omit_name: Option<String>,
    array_name: Option<String>,
}

pub fn apply<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
    projection: &Projection,
    source_maps: bool,
) -> Result<(), String> {
    if projection.lazy_patterns.is_empty() && projection.accessor_arrows.is_empty() {
        return Ok(());
    }

    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .build(program)
        .semantic;
    let mut names = collect_names(&semantic);
    let plan = build_plan(allocator, &semantic, projection, &mut names)?;
    drop(semantic);

    let mut rewriter = Rewriter {
        allocator,
        ast: AstBuilder::new(allocator),
        plan: &plan,
        names,
        temp_scopes: vec![Vec::new()],
        active_expansions: Vec::new(),
        source_maps,
        error: None,
    };
    rewriter.visit_program(program);
    if let Some(error) = rewriter.error {
        Err(error)
    } else {
        Ok(())
    }
}

fn collect_names(semantic: &Semantic<'_>) -> Names {
    let mut names = Names::default();
    for node in semantic.nodes() {
        match node.kind() {
            oxc_ast::AstKind::BindingIdentifier(ident) => {
                names.used.insert(ident.name.to_string());
            }
            oxc_ast::AstKind::IdentifierReference(ident) => {
                names.used.insert(ident.name.to_string());
            }
            oxc_ast::AstKind::JSXIdentifier(ident) => {
                names.used.insert(ident.name.to_string());
            }
            _ => {}
        }
    }
    names
}

fn build_plan<'a>(
    allocator: &'a Allocator,
    semantic: &Semantic<'_>,
    projection: &Projection,
    names: &mut Names,
) -> Result<Plan<'a>, String> {
    let mut lazy_by_start = HashMap::new();
    for (start, _, source_accessor) in &projection.lazy_patterns {
        lazy_by_start.insert(*start, (names.allocate("__lazy"), *source_accessor));
    }
    let arrows_by_start: HashMap<u32, &Vec<String>> = projection
        .accessor_arrows
        .iter()
        .map(|(start, names)| (*start, names))
        .collect();
    let mut planner = Planner {
        allocator,
        semantic,
        lazy_by_start: &lazy_by_start,
        references: HashMap::new(),
        patterns: HashMap::new(),
        uses_omit: false,
        uses_array: false,
    };

    for node in semantic.nodes() {
        match node.kind() {
            oxc_ast::AstKind::VariableDeclarator(declarator) => {
                planner.plan_lazy_pattern(&declarator.id)?;
            }
            oxc_ast::AstKind::FormalParameter(parameter) => {
                planner.plan_lazy_pattern(&parameter.pattern)?;
            }
            oxc_ast::AstKind::CatchClause(clause) => {
                if let Some(parameter) = &clause.param {
                    planner.plan_lazy_pattern(&parameter.pattern)?;
                }
            }
            oxc_ast::AstKind::ArrowFunctionExpression(arrow) => {
                let Some(expected) = arrows_by_start.get(&arrow.span.start) else {
                    continue;
                };
                for parameter in &arrow.params.items {
                    let BindingPattern::BindingIdentifier(ident) = &parameter.pattern else {
                        continue;
                    };
                    if expected.iter().any(|name| name == ident.name.as_str()) {
                        planner.record_symbol(
                            ident.span,
                            ident.symbol_id.get(),
                            Replacement::Call,
                            &[],
                        )?;
                    }
                }
            }
            _ => {}
        }
    }

    for (start, _, _) in &projection.lazy_patterns {
        if !planner
            .patterns
            .keys()
            .any(|(pattern_start, _)| pattern_start == start)
        {
            return Err(format!(
                "TSRX frontend: lazy pattern anchor at projected offset {start} did not match a supported binding pattern"
            ));
        }
    }

    if planner.uses_array
        && semantic
            .scoping()
            .get_root_binding("globalThis".into())
            .is_some()
    {
        return Err(
            "TSRX lazy array rest cannot safely access the intrinsic Array because this module binds `globalThis`; rename that top-level binding".into(),
        );
    }
    let omit_name = planner.uses_omit.then(|| names.allocate("__lazyOmit"));
    let array_name = planner.uses_array.then(|| names.allocate("__lazyArray"));
    Ok(Plan {
        references: planner.references,
        patterns: planner.patterns,
        omit_name,
        array_name,
    })
}

struct Planner<'a, 's, 'p> {
    allocator: &'a Allocator,
    semantic: &'s Semantic<'p>,
    lazy_by_start: &'s HashMap<u32, (String, bool)>,
    references: HashMap<SpanKey, Replacement<'a>>,
    patterns: HashMap<SpanKey, String>,
    uses_omit: bool,
    uses_array: bool,
}

impl<'a> Planner<'a, '_, '_> {
    fn plan_lazy_pattern(&mut self, pattern: &BindingPattern<'_>) -> Result<(), String> {
        let span = pattern.span();
        if matches!(
            pattern,
            BindingPattern::ObjectPattern(_) | BindingPattern::ArrayPattern(_)
        ) && let Some((source, source_accessor)) = self.lazy_by_start.get(&span.start).cloned()
        {
            self.collect_pattern(
                pattern,
                LazyBinding {
                    identity: None,
                    source: source.clone(),
                    source_accessor,
                    steps: Vec::new(),
                    direct_default: None,
                    kind: LazyKind::Value,
                    jsx_compatible: true,
                },
            )?;
            self.patterns.insert((span.start, span.end), source);
            return Ok(());
        }

        match pattern {
            BindingPattern::AssignmentPattern(default) => self.plan_lazy_pattern(&default.left),
            BindingPattern::ObjectPattern(object) => {
                for property in &object.properties {
                    self.plan_lazy_pattern(&property.value)?;
                }
                if let Some(rest) = &object.rest {
                    self.plan_lazy_pattern(&rest.argument)?;
                }
                Ok(())
            }
            BindingPattern::ArrayPattern(array) => {
                for element in array.elements.iter().flatten() {
                    self.plan_lazy_pattern(element)?;
                }
                if let Some(rest) = &array.rest {
                    self.plan_lazy_pattern(&rest.argument)?;
                }
                Ok(())
            }
            BindingPattern::BindingIdentifier(_) => Ok(()),
        }
    }

    fn collect_pattern(
        &mut self,
        pattern: &BindingPattern<'_>,
        mut access: LazyBinding<'a>,
    ) -> Result<(), String> {
        match pattern {
            BindingPattern::BindingIdentifier(ident) => {
                let excluded = access.embedded_spans();
                self.record_symbol(
                    ident.span,
                    ident.symbol_id.get(),
                    Replacement::Lazy(access),
                    &excluded,
                )
            }
            BindingPattern::AssignmentPattern(default) => {
                access
                    .steps
                    .push(AccessStep::Default(default.right.clone_in(self.allocator)));
                access.direct_default = Some(default.right.clone_in(self.allocator));
                access.jsx_compatible = false;
                self.collect_pattern(&default.left, access)
            }
            BindingPattern::ObjectPattern(object) => {
                let keys = object
                    .properties
                    .iter()
                    .map(|property| self.rest_key(property))
                    .collect::<Result<Vec<_>, _>>()?;
                for property in &object.properties {
                    let mut child = self.child_access(&access, &property.key, property.computed)?;
                    child.direct_default = None;
                    self.collect_pattern(&property.value, child)?;
                }
                if let Some(rest) = &object.rest {
                    let BindingPattern::BindingIdentifier(ident) = &rest.argument else {
                        return Err(
                            "TSRX lazy object rest currently requires an identifier binding".into(),
                        );
                    };
                    let mut rest_access = access.clone_in(self.allocator);
                    rest_access.kind = LazyKind::ObjectRest(keys);
                    rest_access.direct_default = None;
                    rest_access.jsx_compatible = false;
                    let excluded = rest_access.embedded_spans();
                    self.uses_omit = true;
                    self.record_symbol(
                        ident.span,
                        ident.symbol_id.get(),
                        Replacement::Lazy(rest_access),
                        &excluded,
                    )?;
                }
                Ok(())
            }
            BindingPattern::ArrayPattern(array) => {
                for (index, element) in array.elements.iter().enumerate() {
                    let Some(element) = element else { continue };
                    let mut child = access.clone_in(self.allocator);
                    child.steps.push(AccessStep::Computed(
                        AstBuilder::new(self.allocator).expression_numeric_literal(
                            element.span(),
                            index as f64,
                            None,
                            NumberBase::Decimal,
                        ),
                    ));
                    child.direct_default = None;
                    child.jsx_compatible = false;
                    self.collect_pattern(element, child)?;
                }
                if let Some(rest) = &array.rest {
                    let BindingPattern::BindingIdentifier(ident) = &rest.argument else {
                        return Err(
                            "TSRX lazy array rest currently requires an identifier binding".into(),
                        );
                    };
                    let mut rest_access = access.clone_in(self.allocator);
                    rest_access.kind = LazyKind::ArrayRest(array.elements.len());
                    rest_access.direct_default = None;
                    rest_access.jsx_compatible = false;
                    let excluded = rest_access.embedded_spans();
                    self.uses_array = true;
                    self.record_symbol(
                        ident.span,
                        ident.symbol_id.get(),
                        Replacement::Lazy(rest_access),
                        &excluded,
                    )?;
                }
                Ok(())
            }
        }
    }

    fn child_access(
        &self,
        parent: &LazyBinding<'a>,
        key: &PropertyKey<'_>,
        computed: bool,
    ) -> Result<LazyBinding<'a>, String> {
        let mut child = parent.clone_in(self.allocator);
        if !computed && let PropertyKey::StaticIdentifier(ident) = key {
            child.steps.push(AccessStep::Static(ident.name.to_string()));
            return Ok(child);
        }
        if !key.is_expression() {
            return Err("TSRX lazy destructuring does not support private property keys".into());
        }
        child.steps.push(AccessStep::Computed(
            key.to_expression().clone_in(self.allocator),
        ));
        child.jsx_compatible = false;
        Ok(child)
    }

    fn rest_key(
        &self,
        property: &oxc_ast::ast::BindingProperty<'_>,
    ) -> Result<RestKey<'a>, String> {
        if !property.computed {
            if let PropertyKey::StaticIdentifier(ident) = &property.key {
                return Ok(RestKey::Static(ident.name.to_string()));
            }
            if let PropertyKey::StringLiteral(value) = &property.key {
                return Ok(RestKey::Static(value.value.to_string()));
            }
            if let PropertyKey::NumericLiteral(value) = &property.key {
                return Ok(RestKey::Static(value.value.to_string()));
            }
        }
        if !property.key.is_expression() {
            return Err("TSRX lazy destructuring does not support private property keys".into());
        }
        Ok(RestKey::Computed(
            property.key.to_expression().clone_in(self.allocator),
        ))
    }

    fn record_symbol(
        &mut self,
        symbol_span: Span,
        symbol_id: Option<SymbolId>,
        replacement: Replacement<'a>,
        excluded: &[Span],
    ) -> Result<(), String> {
        let Some(symbol_id) = symbol_id else {
            return Err(format!(
                "TSRX frontend: unresolved binding at offset {}",
                symbol_span.start
            ));
        };
        for reference in self.semantic.scoping().get_resolved_references(symbol_id) {
            let flags = reference.flags();
            match &replacement {
                Replacement::Call if !flags.is_read_only() => continue,
                Replacement::Lazy(_) if !flags.is_read() && !flags.is_write() => continue,
                _ => {}
            }
            let node = self.semantic.nodes().get_node(reference.node_id());
            let span = node.kind().span();
            if excluded
                .iter()
                .any(|range| span.start >= range.start && span.end <= range.end)
            {
                continue;
            }
            let parent = self.semantic.nodes().parent_kind(reference.node_id());
            if matches!(
                parent,
                oxc_ast::AstKind::ImportSpecifier(_) | oxc_ast::AstKind::ExportSpecifier(_)
            ) {
                return Err("TSRX lazy bindings cannot appear in import/export specifiers".into());
            }
            let owned = match &replacement {
                Replacement::Call => Replacement::Call,
                Replacement::Lazy(binding) => {
                    let mut binding = binding.clone_in(self.allocator);
                    binding.identity = Some(symbol_id);
                    Replacement::Lazy(binding)
                }
            };
            self.references.insert((span.start, span.end), owned);
        }
        Ok(())
    }
}

struct Rewriter<'a, 'p> {
    allocator: &'a Allocator,
    ast: AstBuilder<'a>,
    plan: &'p Plan<'a>,
    names: Names,
    temp_scopes: Vec<Vec<String>>,
    active_expansions: Vec<SymbolId>,
    source_maps: bool,
    error: Option<String>,
}

struct SourceMapAnchor {
    span: Span,
}

impl<'a> VisitMut<'a> for SourceMapAnchor {
    fn visit_assignment_expression(
        &mut self,
        expression: &mut oxc_ast::ast::AssignmentExpression<'a>,
    ) {
        if expression.span.is_empty() {
            expression.span = self.span;
        }
        walk_mut::walk_assignment_expression(self, expression);
    }

    fn visit_update_expression(&mut self, expression: &mut oxc_ast::ast::UpdateExpression<'a>) {
        if expression.span.is_empty() {
            expression.span = self.span;
        }
        walk_mut::walk_update_expression(self, expression);
    }

    fn visit_identifier_reference(
        &mut self,
        identifier: &mut oxc_ast::ast::IdentifierReference<'a>,
    ) {
        if identifier.span.is_empty() {
            identifier.span = self.span;
        }
    }
}

impl<'a> Rewriter<'a, '_> {
    fn generated_span(span: Span) -> Span {
        Span::new(span.start, span.start)
    }

    fn authored_expression(&self, mut expression: Expression<'a>, span: Span) -> Expression<'a> {
        if self.source_maps {
            *expression.span_mut() = span;
        }
        expression
    }

    fn source_map_anchor(&self, span: Span) -> SourceMapAnchor {
        SourceMapAnchor { span }
    }

    fn anchor_expression(&self, expression: &mut Expression<'a>, span: Span) {
        if !self.source_maps {
            return;
        }
        self.source_map_anchor(span).visit_expression(expression);
    }

    fn anchor_assignment_target(&self, target: &mut AssignmentTarget<'a>, span: Span) {
        if !self.source_maps {
            return;
        }
        self.source_map_anchor(span).visit_assignment_target(target);
    }

    fn anchor_simple_assignment_target(&self, target: &mut SimpleAssignmentTarget<'a>, span: Span) {
        if !self.source_maps {
            return;
        }
        let mut anchor = SourceMapAnchor { span };
        anchor.visit_simple_assignment_target(target);
    }

    fn replacement(&self, span: Span) -> Option<Replacement<'a>> {
        self.plan
            .references
            .get(&(span.start, span.end))
            .map(|replacement| match replacement {
                Replacement::Call => Replacement::Call,
                Replacement::Lazy(binding) => Replacement::Lazy(binding.clone_in(self.allocator)),
            })
    }

    fn begin_expansion(&mut self, binding: &LazyBinding<'a>) -> bool {
        let identity = binding
            .identity
            .expect("planned lazy replacement has a symbol identity");
        if self.active_expansions.contains(&identity) {
            return false;
        }
        self.active_expansions.push(identity);
        true
    }

    fn end_expansion(&mut self, binding: &LazyBinding<'a>) {
        let identity = binding
            .identity
            .expect("planned lazy replacement has a symbol identity");
        debug_assert_eq!(self.active_expansions.pop(), Some(identity));
    }

    fn expansion_active(&self, binding: &LazyBinding<'a>) -> bool {
        binding
            .identity
            .is_some_and(|identity| self.active_expansions.contains(&identity))
    }

    fn temp(&mut self) -> String {
        let name = self.names.allocate("__lazyValue");
        self.temp_scopes
            .last_mut()
            .expect("program temporary scope exists")
            .push(name.clone());
        name
    }

    fn ident(&self, name: &str, source: Span) -> Expression<'a> {
        self.ast
            .expression_identifier(Self::generated_span(source), self.ast.ident(name))
    }

    fn source_access(&self, binding: &LazyBinding<'a>, span: Span) -> Expression<'a> {
        let source = self.ident(&binding.source, span);
        if binding.source_accessor {
            self.ast.expression_call(
                Self::generated_span(span),
                source,
                None,
                self.ast.vec(),
                false,
            )
        } else {
            source
        }
    }

    fn static_member(&self, object: Expression<'a>, name: &str, span: Span) -> Expression<'a> {
        Expression::StaticMemberExpression(
            self.ast.alloc_static_member_expression(
                Self::generated_span(span),
                object,
                self.ast
                    .identifier_name(Self::generated_span(span), self.ast.ident(name)),
                false,
            ),
        )
    }

    fn computed_member(
        &self,
        object: Expression<'a>,
        key: Expression<'a>,
        span: Span,
    ) -> Expression<'a> {
        Expression::ComputedMemberExpression(self.ast.alloc_computed_member_expression(
            Self::generated_span(span),
            object,
            key,
            false,
        ))
    }

    fn apply_raw_step(
        &self,
        value: Expression<'a>,
        step: &AccessStep<'a>,
        span: Span,
    ) -> Expression<'a> {
        match step {
            AccessStep::Static(name) => self.static_member(value, name, span),
            AccessStep::Computed(key) => {
                self.computed_member(value, key.clone_in(self.allocator), span)
            }
            AccessStep::Default(_) => value,
        }
    }

    fn raw_access(&self, binding: &LazyBinding<'a>, span: Span) -> Expression<'a> {
        let expression = binding
            .steps
            .iter()
            .fold(self.source_access(binding, span), |value, step| {
                self.apply_raw_step(value, step, span)
            });
        self.authored_expression(expression, span)
    }

    fn value_access(&mut self, binding: &LazyBinding<'a>, span: Span) -> Expression<'a> {
        let mut value = self.source_access(binding, span);
        for step in &binding.steps {
            match step {
                AccessStep::Static(_) | AccessStep::Computed(_) => {
                    value = self.apply_raw_step(value, step, span);
                }
                AccessStep::Default(fallback) => {
                    let temp = self.temp();
                    let set = self.ast.expression_assignment(
                        Self::generated_span(span),
                        AssignmentOperator::Assign,
                        self.identifier_target(&temp, span),
                        value,
                    );
                    let test = self.ast.expression_binary(
                        Self::generated_span(span),
                        self.ident(&temp, span),
                        BinaryOperator::StrictEquality,
                        self.ast.void_0(Self::generated_span(span)),
                    );
                    let choose = self.ast.expression_conditional(
                        Self::generated_span(span),
                        test,
                        fallback.clone_in(self.allocator),
                        self.ident(&temp, span),
                    );
                    value = self.ast.expression_sequence(
                        Self::generated_span(span),
                        self.ast.vec_from_array([set, choose]),
                    );
                }
            }
        }
        let expression = match &binding.kind {
            LazyKind::Value => value,
            LazyKind::ObjectRest(keys) => {
                let Some(omit) = self.plan.omit_name.as_deref() else {
                    self.error = Some("Internal TSRX lazy object-rest helper mismatch".into());
                    return value;
                };
                let mut arguments = self.ast.vec_with_capacity(keys.len() + 1);
                arguments.push(Argument::from(value));
                for key in keys {
                    let expression = match key {
                        RestKey::Static(name) => self.ast.expression_string_literal(
                            Self::generated_span(span),
                            self.ast.str(name),
                            None,
                        ),
                        RestKey::Computed(value) => value.clone_in(self.allocator),
                    };
                    arguments.push(Argument::from(expression));
                }
                self.ast.expression_call(
                    Self::generated_span(span),
                    self.ident(omit, span),
                    None,
                    arguments,
                    false,
                )
            }
            LazyKind::ArrayRest(index) => {
                let Some(array) = self.plan.array_name.as_deref() else {
                    self.error = Some("Internal TSRX lazy array-rest helper mismatch".into());
                    return value;
                };
                let from = self.static_member(self.ident(array, span), "from", span);
                let converted = self.ast.expression_call(
                    Self::generated_span(span),
                    from,
                    None,
                    self.ast.vec1(Argument::from(value)),
                    false,
                );
                let slice = self.static_member(converted, "slice", span);
                self.ast.expression_call(
                    Self::generated_span(span),
                    slice,
                    None,
                    self.ast
                        .vec1(Argument::from(self.ast.expression_numeric_literal(
                            Self::generated_span(span),
                            *index as f64,
                            None,
                            NumberBase::Decimal,
                        ))),
                    false,
                )
            }
        };
        self.authored_expression(expression, span)
    }

    fn identifier_target(&self, name: &str, span: Span) -> AssignmentTarget<'a> {
        AssignmentTarget::AssignmentTargetIdentifier(
            self.ast
                .alloc_identifier_reference(Self::generated_span(span), self.ast.ident(name)),
        )
    }

    fn member_target(&self, expression: Expression<'a>) -> AssignmentTarget<'a> {
        match expression {
            Expression::StaticMemberExpression(member) => {
                AssignmentTarget::StaticMemberExpression(member)
            }
            Expression::ComputedMemberExpression(member) => {
                AssignmentTarget::ComputedMemberExpression(member)
            }
            _ => unreachable!("lazy raw access always ends in a member"),
        }
    }

    fn simple_member_target(&self, expression: Expression<'a>) -> SimpleAssignmentTarget<'a> {
        match expression {
            Expression::StaticMemberExpression(member) => {
                SimpleAssignmentTarget::StaticMemberExpression(member)
            }
            Expression::ComputedMemberExpression(member) => {
                SimpleAssignmentTarget::ComputedMemberExpression(member)
            }
            _ => unreachable!("lazy raw access always ends in a member"),
        }
    }

    fn target_parts(
        &self,
        binding: &LazyBinding<'a>,
        span: Span,
    ) -> (Expression<'a>, Expression<'a>) {
        let last = binding
            .steps
            .iter()
            .rposition(|step| !matches!(step, AccessStep::Default(_)))
            .expect("defaulted destructured binding has a property step");
        let mut object = self.source_access(binding, span);
        for step in &binding.steps[..last] {
            object = self.apply_raw_step(object, step, span);
        }
        let key = match &binding.steps[last] {
            AccessStep::Static(name) => self.ast.expression_string_literal(
                Self::generated_span(span),
                self.ast.str(name),
                None,
            ),
            AccessStep::Computed(value) => value.clone_in(self.allocator),
            AccessStep::Default(_) => unreachable!(),
        };
        (object, key)
    }

    fn lower_default_assignment(
        &mut self,
        span: Span,
        operator: AssignmentOperator,
        right: Expression<'a>,
        binding: &LazyBinding<'a>,
    ) -> Expression<'a> {
        let (object, key) = self.target_parts(binding, span);
        let object_name = self.temp();
        let key_name = self.temp();
        let value_name = self.temp();
        let destination = |this: &Self| {
            this.computed_member(
                this.ident(&object_name, span),
                this.ident(&key_name, span),
                span,
            )
        };
        let mut expressions = self.ast.vec();
        expressions.push(self.ast.expression_assignment(
            Self::generated_span(span),
            AssignmentOperator::Assign,
            self.identifier_target(&object_name, span),
            object,
        ));
        expressions.push(self.ast.expression_assignment(
            Self::generated_span(span),
            AssignmentOperator::Assign,
            self.identifier_target(&key_name, span),
            key,
        ));
        expressions.push(self.ast.expression_assignment(
            Self::generated_span(span),
            AssignmentOperator::Assign,
            self.identifier_target(&value_name, span),
            destination(self),
        ));
        let fallback = binding
            .direct_default
            .as_ref()
            .expect("lowering is only used for direct defaults")
            .clone_in(self.allocator);
        let defaulted = self.ast.expression_conditional(
            Self::generated_span(span),
            self.ast.expression_binary(
                Self::generated_span(span),
                self.ident(&value_name, span),
                BinaryOperator::StrictEquality,
                self.ast.void_0(Self::generated_span(span)),
            ),
            fallback,
            self.ident(&value_name, span),
        );
        expressions.push(self.ast.expression_assignment(
            Self::generated_span(span),
            AssignmentOperator::Assign,
            self.identifier_target(&value_name, span),
            defaulted,
        ));
        if let Some(logical) = assignment_logical(operator) {
            let write = self.ast.expression_assignment(
                Self::generated_span(span),
                AssignmentOperator::Assign,
                self.member_target(destination(self)),
                right,
            );
            expressions.push(self.ast.expression_logical(
                Self::generated_span(span),
                self.ident(&value_name, span),
                logical,
                write,
            ));
        } else {
            let binary = assignment_binary(operator)
                .expect("all non-logical compound assignments have a binary operator");
            let next = self.ast.expression_binary(
                Self::generated_span(span),
                self.ident(&value_name, span),
                binary,
                right,
            );
            expressions.push(self.ast.expression_assignment(
                Self::generated_span(span),
                AssignmentOperator::Assign,
                self.member_target(destination(self)),
                next,
            ));
        }
        let sequence = self
            .ast
            .expression_sequence(Self::generated_span(span), expressions);
        self.authored_expression(sequence, span)
    }

    fn lower_default_update(
        &mut self,
        update: &oxc_ast::ast::UpdateExpression<'a>,
        binding: &LazyBinding<'a>,
    ) -> Expression<'a> {
        let span = update.span;
        let (object, key) = self.target_parts(binding, span);
        let object_name = self.temp();
        let key_name = self.temp();
        let value_name = self.temp();
        let destination = |this: &Self| {
            this.computed_member(
                this.ident(&object_name, span),
                this.ident(&key_name, span),
                span,
            )
        };
        let mut expressions = self.ast.vec();
        for (name, value) in [(&object_name, object), (&key_name, key)] {
            expressions.push(self.ast.expression_assignment(
                Self::generated_span(span),
                AssignmentOperator::Assign,
                self.identifier_target(name, span),
                value,
            ));
        }
        expressions.push(self.ast.expression_assignment(
            Self::generated_span(span),
            AssignmentOperator::Assign,
            self.identifier_target(&value_name, span),
            destination(self),
        ));
        let fallback = binding
            .direct_default
            .as_ref()
            .expect("lowering is only used for direct defaults")
            .clone_in(self.allocator);
        let defaulted = self.ast.expression_conditional(
            Self::generated_span(span),
            self.ast.expression_binary(
                Self::generated_span(span),
                self.ident(&value_name, span),
                BinaryOperator::StrictEquality,
                self.ast.void_0(Self::generated_span(span)),
            ),
            fallback,
            self.ident(&value_name, span),
        );
        expressions.push(self.ast.expression_assignment(
            Self::generated_span(span),
            AssignmentOperator::Assign,
            self.identifier_target(&value_name, span),
            defaulted,
        ));
        if update.prefix {
            let changed = self.ast.expression_update(
                Self::generated_span(span),
                update.operator,
                true,
                SimpleAssignmentTarget::AssignmentTargetIdentifier(
                    self.ast.alloc_identifier_reference(
                        Self::generated_span(span),
                        self.ast.ident(&value_name),
                    ),
                ),
            );
            expressions.push(self.ast.expression_assignment(
                Self::generated_span(span),
                AssignmentOperator::Assign,
                self.member_target(destination(self)),
                changed,
            ));
        } else {
            let old_name = self.temp();
            let changed = self.ast.expression_update(
                Self::generated_span(span),
                update.operator,
                false,
                SimpleAssignmentTarget::AssignmentTargetIdentifier(
                    self.ast.alloc_identifier_reference(
                        Self::generated_span(span),
                        self.ast.ident(&value_name),
                    ),
                ),
            );
            expressions.push(self.ast.expression_assignment(
                Self::generated_span(span),
                AssignmentOperator::Assign,
                self.identifier_target(&old_name, span),
                changed,
            ));
            expressions.push(self.ast.expression_assignment(
                Self::generated_span(span),
                AssignmentOperator::Assign,
                self.member_target(destination(self)),
                self.ident(&value_name, span),
            ));
            expressions.push(self.ident(&old_name, span));
        }
        let sequence = self
            .ast
            .expression_sequence(Self::generated_span(span), expressions);
        self.authored_expression(sequence, span)
    }

    fn temp_declaration(&self, names: Vec<String>) -> Statement<'a> {
        let declarations = self.ast.vec_from_iter(names.into_iter().map(|name| {
            self.ast.variable_declarator(
                Span::default(),
                VariableDeclarationKind::Let,
                self.ast
                    .binding_pattern_binding_identifier(Span::default(), self.ast.ident(&name)),
                None,
                None,
                false,
            )
        }));
        Statement::VariableDeclaration(self.ast.alloc_variable_declaration(
            Span::default(),
            VariableDeclarationKind::Let,
            declarations,
            false,
        ))
    }

    fn prepend_temps(&self, body: &mut FunctionBody<'a>, names: Vec<String>) {
        if !names.is_empty() {
            body.statements.insert(0, self.temp_declaration(names));
        }
    }

    fn maybe_dynamic(&mut self, element: &mut oxc_ast::ast::JSXElement<'a>) {
        let (base_span, suffixes, uppercase) = jsx_name_parts(&element.opening_element.name);
        if !uppercase {
            return;
        }
        let Some(Replacement::Lazy(binding)) = self.replacement(base_span) else {
            return;
        };
        if binding.jsx_compatible {
            return;
        }
        if !self.begin_expansion(&binding) {
            return;
        }
        let mut component = self.value_access(&binding, base_span);
        for suffix in suffixes {
            component = self.static_member(component, &suffix, base_span);
        }
        self.visit_expression(&mut component);
        self.end_expansion(&binding);
        element.opening_element.name = JSXElementName::IdentifierReference(
            self.ast
                .alloc_identifier_reference(base_span, self.ast.ident("Dynamic")),
        );
        if let Some(closing) = &mut element.closing_element {
            closing.name = JSXElementName::IdentifierReference(
                self.ast
                    .alloc_identifier_reference(base_span, self.ast.ident("Dynamic")),
            );
        }
        element.opening_element.attributes.insert(
            0,
            self.ast
                .jsx_attribute_item_expression(base_span, "component", component),
        );
    }

    fn jsx_member_for(&self, binding: &LazyBinding<'a>, span: Span) -> Option<JSXElementName<'a>> {
        if !binding.jsx_compatible || binding.source_accessor {
            return None;
        }
        let mut object = JSXMemberExpressionObject::IdentifierReference(
            self.ast
                .alloc_identifier_reference(span, self.ast.ident(&binding.source)),
        );
        let mut static_steps = binding.steps.iter().filter_map(|step| match step {
            AccessStep::Static(name) => Some(name),
            _ => None,
        });
        let first = static_steps.next()?;
        let mut member = self.ast.alloc_jsx_member_expression(
            span,
            object,
            self.ast.jsx_identifier(span, self.ast.str(first)),
        );
        for property in static_steps {
            object = JSXMemberExpressionObject::MemberExpression(member);
            member = self.ast.alloc_jsx_member_expression(
                span,
                object,
                self.ast.jsx_identifier(span, self.ast.str(property)),
            );
        }
        Some(JSXElementName::MemberExpression(member))
    }
}

impl<'a> VisitMut<'a> for Rewriter<'a, '_> {
    fn visit_program(&mut self, program: &mut Program<'a>) {
        walk_mut::walk_program(self, program);
        let temps = self.temp_scopes.pop().expect("program temporary scope");
        let mut additions = self.ast.vec();
        if let Some(omit) = &self.plan.omit_name {
            let specifier = self.ast.import_declaration_specifier_import_specifier(
                Span::default(),
                self.ast
                    .module_export_name_identifier_name(Span::default(), self.ast.ident("omit")),
                self.ast
                    .binding_identifier(Span::default(), self.ast.ident(omit)),
                ImportOrExportKind::Value,
            );
            additions.push(Statement::ImportDeclaration(
                self.ast.alloc_import_declaration(
                    Span::default(),
                    Some(self.ast.vec1(specifier)),
                    self.ast
                        .string_literal(Span::default(), self.ast.str("solid-js"), None),
                    None,
                    None,
                    ImportOrExportKind::Value,
                ),
            ));
        }
        if let Some(array) = &self.plan.array_name {
            let init = self.static_member(
                self.ast
                    .expression_identifier(Span::default(), self.ast.ident("globalThis")),
                "Array",
                Span::default(),
            );
            let declarator = self.ast.variable_declarator(
                Span::default(),
                VariableDeclarationKind::Const,
                self.ast
                    .binding_pattern_binding_identifier(Span::default(), self.ast.ident(array)),
                None,
                Some(init),
                false,
            );
            additions.push(Statement::VariableDeclaration(
                self.ast.alloc_variable_declaration(
                    Span::default(),
                    VariableDeclarationKind::Const,
                    self.ast.vec1(declarator),
                    false,
                ),
            ));
        }
        if !temps.is_empty() {
            additions.push(self.temp_declaration(temps));
        }
        let import_end = program
            .body
            .iter()
            .take_while(|statement| matches!(statement, Statement::ImportDeclaration(_)))
            .count();
        for (offset, statement) in additions.into_iter().enumerate() {
            program.body.insert(import_end + offset, statement);
        }
    }

    fn visit_function(&mut self, function: &mut Function<'a>, _flags: ScopeFlags) {
        walk_mut::walk_formal_parameters(self, &mut function.params);
        if let Some(body) = &mut function.body {
            self.temp_scopes.push(Vec::new());
            self.visit_function_body(body);
            let temps = self.temp_scopes.pop().expect("function temporary scope");
            self.prepend_temps(body, temps);
        }
    }

    fn visit_arrow_function_expression(
        &mut self,
        arrow: &mut oxc_ast::ast::ArrowFunctionExpression<'a>,
    ) {
        walk_mut::walk_formal_parameters(self, &mut arrow.params);
        self.temp_scopes.push(Vec::new());
        self.visit_arrow_function_body(&mut arrow.body);
        let temps = self.temp_scopes.pop().expect("arrow temporary scope");
        if temps.is_empty() {
            return;
        }
        match &mut arrow.body {
            ArrowFunctionBody::FunctionBody(body) => self.prepend_temps(body, temps),
            body if body.is_expression() => {
                let placeholder =
                    ArrowFunctionBody::FunctionBody(self.ast.alloc(self.ast.function_body(
                        Span::default(),
                        self.ast.vec(),
                        self.ast.vec(),
                    )));
                let old = std::mem::replace(body, placeholder);
                let expression = old.into_expression();
                let statements = self.ast.vec_from_array([
                    self.temp_declaration(temps),
                    self.ast.statement_return(Span::default(), Some(expression)),
                ]);
                *body = ArrowFunctionBody::FunctionBody(self.ast.alloc(self.ast.function_body(
                    Span::default(),
                    self.ast.vec(),
                    statements,
                )));
            }
            _ => unreachable!(),
        }
    }

    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        if let Expression::JSXElement(element) = expression {
            self.maybe_dynamic(element);
        }

        if let Expression::AssignmentExpression(assignment) = expression
            && let AssignmentTarget::AssignmentTargetIdentifier(ident) = &mut assignment.left
            && let Some(Replacement::Lazy(binding)) = self.replacement(ident.span)
            && self.expansion_active(&binding)
        {
            ident.span = Self::generated_span(ident.span);
            walk_mut::walk_expression(self, expression);
            return;
        }

        if let Expression::AssignmentExpression(assignment) = expression
            && let AssignmentTarget::AssignmentTargetIdentifier(ident) = &assignment.left
            && let Some(Replacement::Lazy(binding)) = self.replacement(ident.span)
            && binding.has_ancestor_default()
        {
            self.error = Some(
                "A TSRX lazy binding nested beneath an ancestor default is read-only; assign to the source object explicitly".into(),
            );
            return;
        }

        if let Expression::AssignmentExpression(assignment) = expression
            && !assignment.operator.is_assign()
            && let AssignmentTarget::AssignmentTargetIdentifier(ident) = &assignment.left
            && let Some(Replacement::Lazy(binding)) = self.replacement(ident.span)
            && binding.direct_default.is_some()
        {
            let span = assignment.span;
            let reference_span = ident.span;
            let mut right = assignment.right.clone_in(self.allocator);
            self.visit_expression(&mut right);
            let lowered = self.lower_default_assignment(span, assignment.operator, right, &binding);
            *expression = lowered;
            assert!(self.begin_expansion(&binding));
            walk_mut::walk_expression(self, expression);
            self.end_expansion(&binding);
            self.anchor_expression(expression, reference_span);
            return;
        }

        if let Expression::UpdateExpression(update) = expression
            && let SimpleAssignmentTarget::AssignmentTargetIdentifier(ident) = &mut update.argument
            && let Some(Replacement::Lazy(binding)) = self.replacement(ident.span)
            && self.expansion_active(&binding)
        {
            ident.span = Self::generated_span(ident.span);
            walk_mut::walk_expression(self, expression);
            return;
        }

        if let Expression::UpdateExpression(update) = expression
            && let SimpleAssignmentTarget::AssignmentTargetIdentifier(ident) = &update.argument
            && let Some(Replacement::Lazy(binding)) = self.replacement(ident.span)
            && binding.has_ancestor_default()
        {
            self.error = Some(
                "A TSRX lazy binding nested beneath an ancestor default is read-only; assign to the source object explicitly".into(),
            );
            return;
        }

        if let Expression::UpdateExpression(update) = expression
            && let SimpleAssignmentTarget::AssignmentTargetIdentifier(ident) = &update.argument
            && let Some(Replacement::Lazy(binding)) = self.replacement(ident.span)
            && binding.direct_default.is_some()
        {
            let reference_span = ident.span;
            let lowered = self.lower_default_update(update, &binding);
            *expression = lowered;
            assert!(self.begin_expansion(&binding));
            walk_mut::walk_expression(self, expression);
            self.end_expansion(&binding);
            self.anchor_expression(expression, reference_span);
            return;
        }

        walk_mut::walk_expression(self, expression);
        let Expression::Identifier(ident) = expression else {
            return;
        };
        let span = ident.span;
        match self.replacement(span) {
            Some(Replacement::Lazy(binding)) => {
                if !self.begin_expansion(&binding) {
                    ident.span = Self::generated_span(span);
                    return;
                }
                *expression = self.value_access(&binding, span);
                walk_mut::walk_expression(self, expression);
                self.end_expansion(&binding);
                self.anchor_expression(expression, span);
            }
            Some(Replacement::Call) => {
                let callee = std::mem::replace(expression, self.ast.expression_null_literal(span));
                *expression = self
                    .ast
                    .expression_call(span, callee, None, self.ast.vec(), false);
            }
            None => {}
        }
    }

    fn visit_assignment_target(&mut self, target: &mut AssignmentTarget<'a>) {
        if let AssignmentTarget::AssignmentTargetIdentifier(ident) = target
            && let Some(Replacement::Lazy(binding)) = self.replacement(ident.span)
        {
            if binding.has_ancestor_default() {
                self.error = Some(
                    "A TSRX lazy binding nested beneath an ancestor default is read-only; assign to the source object explicitly".into(),
                );
                return;
            }
            if !matches!(binding.kind, LazyKind::Value) {
                self.error = Some("A TSRX lazy rest binding is read-only".into());
                return;
            }
            let span = ident.span;
            *target = self.member_target(self.raw_access(&binding, span));
            assert!(self.begin_expansion(&binding));
            walk_mut::walk_assignment_target(self, target);
            self.end_expansion(&binding);
            self.anchor_assignment_target(target, span);
            return;
        }
        walk_mut::walk_assignment_target(self, target);
    }

    fn visit_update_expression(&mut self, update: &mut oxc_ast::ast::UpdateExpression<'a>) {
        if let SimpleAssignmentTarget::AssignmentTargetIdentifier(ident) = &update.argument
            && let Some(Replacement::Lazy(binding)) = self.replacement(ident.span)
        {
            if binding.has_ancestor_default() {
                self.error = Some(
                    "A TSRX lazy binding nested beneath an ancestor default is read-only; assign to the source object explicitly".into(),
                );
                return;
            }
            if !matches!(binding.kind, LazyKind::Value) {
                self.error = Some("A TSRX lazy rest binding is read-only".into());
                return;
            }
            let span = ident.span;
            update.argument = self.simple_member_target(self.raw_access(&binding, span));
            assert!(self.begin_expansion(&binding));
            walk_mut::walk_simple_assignment_target(self, &mut update.argument);
            self.end_expansion(&binding);
            self.anchor_simple_assignment_target(&mut update.argument, span);
            return;
        }
        walk_mut::walk_update_expression(self, update);
    }

    fn visit_object_property(&mut self, property: &mut ObjectProperty<'a>) {
        if property.shorthand
            && let Expression::Identifier(ident) = &property.value
            && matches!(
                self.plan
                    .references
                    .get(&(ident.span.start, ident.span.end)),
                Some(Replacement::Lazy(_))
            )
        {
            property.shorthand = false;
        }
        walk_mut::walk_object_property(self, property);
    }

    fn visit_jsx_element_name(&mut self, name: &mut JSXElementName<'a>) {
        if let JSXElementName::IdentifierReference(ident) = name
            && ident
                .name
                .as_str()
                .chars()
                .next()
                .is_some_and(char::is_uppercase)
            && let Some(Replacement::Lazy(binding)) = self.replacement(ident.span)
            && let Some(replacement) = self.jsx_member_for(&binding, ident.span)
        {
            *name = replacement;
            return;
        }
        walk_mut::walk_jsx_element_name(self, name);
    }

    fn visit_jsx_member_expression_object(&mut self, object: &mut JSXMemberExpressionObject<'a>) {
        if let JSXMemberExpressionObject::IdentifierReference(ident) = object
            && ident
                .name
                .as_str()
                .chars()
                .next()
                .is_some_and(char::is_uppercase)
            && let Some(Replacement::Lazy(binding)) = self.replacement(ident.span)
            && let Some(JSXElementName::MemberExpression(member)) =
                self.jsx_member_for(&binding, ident.span)
        {
            *object = JSXMemberExpressionObject::MemberExpression(member);
            return;
        }
        walk_mut::walk_jsx_member_expression_object(self, object);
    }

    fn visit_binding_pattern(&mut self, pattern: &mut BindingPattern<'a>) {
        let span = pattern.span();
        if let Some(lazy_name) = self.plan.patterns.get(&(span.start, span.end)) {
            *pattern = self
                .ast
                .binding_pattern_binding_identifier(span, self.ast.ident(lazy_name));
            return;
        }
        walk_mut::walk_binding_pattern(self, pattern);
    }
}

fn jsx_name_parts(name: &JSXElementName<'_>) -> (Span, Vec<String>, bool) {
    fn walk(object: &JSXMemberExpressionObject<'_>, suffixes: &mut Vec<String>) -> (Span, bool) {
        match object {
            JSXMemberExpressionObject::IdentifierReference(ident) => (
                ident.span,
                ident
                    .name
                    .as_str()
                    .chars()
                    .next()
                    .is_some_and(char::is_uppercase),
            ),
            JSXMemberExpressionObject::MemberExpression(member) => {
                let result = walk(&member.object, suffixes);
                suffixes.push(member.property.name.to_string());
                result
            }
            JSXMemberExpressionObject::ThisExpression(this) => (this.span, false),
        }
    }
    match name {
        JSXElementName::IdentifierReference(ident) => (
            ident.span,
            Vec::new(),
            ident
                .name
                .as_str()
                .chars()
                .next()
                .is_some_and(char::is_uppercase),
        ),
        JSXElementName::MemberExpression(member) => {
            let mut suffixes = Vec::new();
            let result = walk(&member.object, &mut suffixes);
            suffixes.push(member.property.name.to_string());
            (result.0, suffixes, result.1)
        }
        _ => (Span::default(), Vec::new(), false),
    }
}

fn assignment_logical(operator: AssignmentOperator) -> Option<LogicalOperator> {
    match operator {
        AssignmentOperator::LogicalAnd => Some(LogicalOperator::And),
        AssignmentOperator::LogicalOr => Some(LogicalOperator::Or),
        AssignmentOperator::LogicalNullish => Some(LogicalOperator::Coalesce),
        _ => None,
    }
}

fn assignment_binary(operator: AssignmentOperator) -> Option<BinaryOperator> {
    Some(match operator {
        AssignmentOperator::Addition => BinaryOperator::Addition,
        AssignmentOperator::Subtraction => BinaryOperator::Subtraction,
        AssignmentOperator::Multiplication => BinaryOperator::Multiplication,
        AssignmentOperator::Division => BinaryOperator::Division,
        AssignmentOperator::Remainder => BinaryOperator::Remainder,
        AssignmentOperator::Exponential => BinaryOperator::Exponential,
        AssignmentOperator::ShiftLeft => BinaryOperator::ShiftLeft,
        AssignmentOperator::ShiftRight => BinaryOperator::ShiftRight,
        AssignmentOperator::ShiftRightZeroFill => BinaryOperator::ShiftRightZeroFill,
        AssignmentOperator::BitwiseOR => BinaryOperator::BitwiseOR,
        AssignmentOperator::BitwiseXOR => BinaryOperator::BitwiseXOR,
        AssignmentOperator::BitwiseAnd => BinaryOperator::BitwiseAnd,
        _ => return None,
    })
}
