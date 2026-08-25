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

use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    AssignmentTarget, BindingPattern, Expression, JSXElementName, JSXMemberExpressionObject,
    ObjectProperty, Program,
};
use oxc_ast_visit::{VisitMut, walk_mut};
use oxc_semantic::{Semantic, SemanticBuilder};
use oxc_span::{GetSpan, Span};

use crate::shared::ast_builder::AstBuilder;

use super::project::Projection;

/// How one destructured name reaches its value through the lazy object.
#[derive(Clone)]
enum Access {
    Prop(String),
    Index(u32),
}

#[derive(Clone)]
enum Replacement {
    /// `name` → `__lazyN.prop` / `__lazyN[i]` (reads and writes).
    Member { object: String, access: Access },
    /// `name` → `name()` (pure reads).
    Call,
}

pub fn apply<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
    projection: &Projection,
) -> Result<(), String> {
    if projection.lazy_patterns.is_empty() && projection.accessor_arrows.is_empty() {
        return Ok(());
    }

    // `with_build_nodes` is off by default; the plan needs the node table for
    // reference-node spans and parent lookups.
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .build(program)
        .semantic;
    let plan = build_plan(&semantic, projection)?;
    drop(semantic);

    let mut rewriter = Rewriter {
        ast: AstBuilder::new(allocator),
        plan: &plan,
    };
    rewriter.visit_program(program);
    Ok(())
}

struct Plan {
    /// Identifier-reference span start → replacement.
    references: HashMap<u32, Replacement>,
    /// Lazy pattern span start → `__lazyN` name.
    patterns: HashMap<u32, String>,
}

fn build_plan(semantic: &Semantic<'_>, projection: &Projection) -> Result<Plan, String> {
    use oxc_ast::ast::{BindingProperty, PropertyKey};

    let lazy_by_start: HashMap<u32, &String> = projection
        .lazy_patterns
        .iter()
        .map(|(start, name)| (*start, name))
        .collect();
    let arrows_by_start: HashMap<u32, &Vec<String>> = projection
        .accessor_arrows
        .iter()
        .map(|(start, names)| (*start, names))
        .collect();

    let mut references: HashMap<u32, Replacement> = HashMap::new();
    let mut patterns: HashMap<u32, String> = HashMap::new();

    let record_symbol = |symbol_span: Span,
                             symbol_id: Option<oxc_syntax::symbol::SymbolId>,
                             replacement: Replacement,
                             references: &mut HashMap<u32, Replacement>|
     -> Result<(), String> {
        let Some(symbol_id) = symbol_id else {
            return Err(format!(
                "TSRX frontend: unresolved binding at offset {}",
                symbol_span.start
            ));
        };
        for reference in semantic.scoping().get_resolved_references(symbol_id) {
            let flags = reference.flags();
            match &replacement {
                Replacement::Call => {
                    // Mirrors rewriteReadsToCalls: assignment targets and
                    // read-write updates (`count++`) are left untouched, and
                    // type-position references are never value reads.
                    if !flags.is_read_only() {
                        continue;
                    }
                }
                Replacement::Member { .. } => {
                    if !flags.is_read() && !flags.is_write() {
                        // Type-only reference: renaming would not help the
                        // erased output and the authored name no longer
                        // exists. Leave it; type output is best-effort.
                        continue;
                    }
                }
            }
            let node = semantic.nodes().get_node(reference.node_id());
            let span = node.kind().span();
            let parent = semantic.nodes().parent_kind(reference.node_id());
            if matches!(
                parent,
                oxc_ast::AstKind::ImportSpecifier(_) | oxc_ast::AstKind::ExportSpecifier(_)
            ) {
                return Err(
                    "TSRX lazy bindings cannot appear in import/export specifiers".into(),
                );
            }
            references.insert(span.start, replacement.clone());
        }
        Ok(())
    };

    // Walk every binding pattern and arrow via the semantic node table.
    for node in semantic.nodes() {
        match node.kind() {
            oxc_ast::AstKind::VariableDeclarator(declarator) => {
                let pattern = &declarator.id;
                plan_lazy_pattern(pattern, &lazy_by_start, &mut patterns, &mut |span,
                                                                                symbol,
                                                                                replacement| {
                    record_symbol(span, symbol, replacement, &mut references)
                })?;
            }
            oxc_ast::AstKind::FormalParameter(parameter) => {
                let pattern = &parameter.pattern;
                plan_lazy_pattern(pattern, &lazy_by_start, &mut patterns, &mut |span,
                                                                                symbol,
                                                                                replacement| {
                    record_symbol(span, symbol, replacement, &mut references)
                })?;
            }
            oxc_ast::AstKind::ArrowFunctionExpression(arrow) => {
                let Some(names) = arrows_by_start.get(&arrow.span.start) else {
                    continue;
                };
                for parameter in &arrow.params.items {
                    let BindingPattern::BindingIdentifier(ident) = &parameter.pattern else {
                        continue;
                    };
                    if !names.iter().any(|name| name == ident.name.as_str()) {
                        continue;
                    }
                    record_symbol(
                        ident.span,
                        ident.symbol_id.get(),
                        Replacement::Call,
                        &mut references,
                    )?;
                }
            }
            _ => {}
        }
    }
    // Every anchor must have matched a real node, or the projection and the
    // reparse disagree — fail closed rather than emit half-rewritten output.
    for (start, _) in &projection.lazy_patterns {
        if !patterns.contains_key(start) {
            return Err(format!(
                "TSRX frontend: lazy pattern anchor at projected offset {start} did not match the reparsed program"
            ));
        }
    }

    return Ok(Plan {
        references,
        patterns,
    });

    fn plan_lazy_pattern(
        pattern: &BindingPattern<'_>,
        lazy_by_start: &HashMap<u32, &String>,
        patterns: &mut HashMap<u32, String>,
        record: &mut dyn FnMut(
            Span,
            Option<oxc_syntax::symbol::SymbolId>,
            Replacement,
        ) -> Result<(), String>,
    ) -> Result<(), String> {
        let span = pattern.span();
        let Some(lazy_name) = lazy_by_start.get(&span.start) else {
            return Ok(());
        };
        let lazy_name = (*lazy_name).clone();

        match pattern {
            BindingPattern::ObjectPattern(object) => {
                if object.rest.is_some() {
                    return Err(
                        "TSRX lazy object destructuring with rest elements is not supported"
                            .into(),
                    );
                }
                for property in &object.properties {
                    plan_object_property(property, &lazy_name, record)?;
                }
            }
            BindingPattern::ArrayPattern(array) => {
                if array.rest.is_some() {
                    return Err(
                        "TSRX lazy array destructuring with rest elements is not supported".into(),
                    );
                }
                for (index, element) in array.elements.iter().enumerate() {
                    let Some(element) = element else { continue };
                    let BindingPattern::BindingIdentifier(ident) = element else {
                        return Err(
                            "TSRX lazy array destructuring supports identifier elements only"
                                .into(),
                        );
                    };
                    record(
                        ident.span,
                        ident.symbol_id.get(),
                        Replacement::Member {
                            object: lazy_name.clone(),
                            access: Access::Index(index as u32),
                        },
                    )?;
                }
            }
            _ => return Ok(()),
        }

        patterns.insert(span.start, lazy_name);
        Ok(())
    }

    fn plan_object_property(
        property: &BindingProperty<'_>,
        lazy_name: &str,
        record: &mut dyn FnMut(
            Span,
            Option<oxc_syntax::symbol::SymbolId>,
            Replacement,
        ) -> Result<(), String>,
    ) -> Result<(), String> {
        if property.computed {
            return Err("TSRX lazy object destructuring with computed keys is not supported".into());
        }
        let key = match &property.key {
            PropertyKey::StaticIdentifier(ident) => ident.name.to_string(),
            _ => {
                return Err(
                    "TSRX lazy object destructuring supports identifier keys only".into(),
                );
            }
        };
        let BindingPattern::BindingIdentifier(ident) = &property.value else {
            return Err(
                "TSRX lazy object destructuring supports identifier bindings only".into(),
            );
        };
        record(
            ident.span,
            ident.symbol_id.get(),
            Replacement::Member {
                object: lazy_name.to_string(),
                access: Access::Prop(key),
            },
        )
    }
}

struct Rewriter<'a, 'p> {
    ast: AstBuilder<'a>,
    plan: &'p Plan,
}

impl<'a> Rewriter<'a, '_> {
    fn member_expression(&self, span: Span, object: &str, access: &Access) -> Expression<'a> {
        let object_expr = self.ast.expression_identifier(span, self.ast.ident(object));
        match access {
            Access::Prop(name) => Expression::StaticMemberExpression(
                self.ast.alloc_static_member_expression(
                    span,
                    object_expr,
                    self.ast.identifier_name(span, self.ast.ident(name)),
                    false,
                ),
            ),
            Access::Index(index) => Expression::ComputedMemberExpression(
                self.ast.alloc_computed_member_expression(
                    span,
                    object_expr,
                    self.ast.expression_numeric_literal(
                        span,
                        f64::from(*index),
                        None,
                        oxc_syntax::number::NumberBase::Decimal,
                    ),
                    false,
                ),
            ),
        }
    }
}

impl<'a> VisitMut<'a> for Rewriter<'a, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        walk_mut::walk_expression(self, expression);
        let Expression::Identifier(ident) = expression else {
            return;
        };
        let Some(replacement) = self.plan.references.get(&ident.span.start) else {
            return;
        };
        let span = ident.span;
        match replacement {
            Replacement::Member { object, access } => {
                *expression = self.member_expression(span, object, access);
            }
            Replacement::Call => {
                let callee = std::mem::replace(expression, self.ast.expression_null_literal(span));
                *expression = self
                    .ast
                    .expression_call(span, callee, None, self.ast.vec(), false);
            }
        }
    }

    fn visit_assignment_target(&mut self, target: &mut AssignmentTarget<'a>) {
        if let AssignmentTarget::AssignmentTargetIdentifier(ident) = target
            && let Some(Replacement::Member { object, access }) =
                self.plan.references.get(&ident.span.start)
            {
                let span = ident.span;
                let expression = self.member_expression(span, object, access);
                *target = match expression {
                    Expression::StaticMemberExpression(member) => {
                        AssignmentTarget::StaticMemberExpression(member)
                    }
                    Expression::ComputedMemberExpression(member) => {
                        AssignmentTarget::ComputedMemberExpression(member)
                    }
                    _ => unreachable!("member_expression builds member expressions"),
                };
                return;
            }
        walk_mut::walk_assignment_target(self, target);
    }

    fn visit_object_property(&mut self, property: &mut ObjectProperty<'a>) {
        // Object-pattern shorthand shares the key/value spelling: once the
        // value is rewritten the property can no longer print shorthand.
        if property.shorthand
            && let Expression::Identifier(ident) = &property.value
                && self.plan.references.contains_key(&ident.span.start) {
                    property.shorthand = false;
                }
        walk_mut::walk_object_property(self, property);
    }

    fn visit_jsx_element_name(&mut self, name: &mut JSXElementName<'a>) {
        if let JSXElementName::IdentifierReference(ident) = name
            && let Some(Replacement::Member { object, access }) =
                self.plan.references.get(&ident.span.start)
            {
                let span = ident.span;
                let Access::Prop(property) = access else {
                    // `<Count>` bound by lazy *array* destructuring has no JSX
                    // member spelling; the upstream engine cannot express it
                    // either.
                    return;
                };
                let member = self.ast.alloc_jsx_member_expression(
                    span,
                    JSXMemberExpressionObject::IdentifierReference(
                        self.ast
                            .alloc_identifier_reference(span, self.ast.ident(object)),
                    ),
                    self.ast.jsx_identifier(span, self.ast.str(property)),
                );
                *name = JSXElementName::MemberExpression(member);
                return;
            }
        walk_mut::walk_jsx_element_name(self, name);
    }

    fn visit_jsx_member_expression_object(
        &mut self,
        object: &mut JSXMemberExpressionObject<'a>,
    ) {
        if let JSXMemberExpressionObject::IdentifierReference(ident) = object
            && let Some(Replacement::Member {
                object: lazy,
                access: Access::Prop(property),
            }) = self.plan.references.get(&ident.span.start)
            {
                let span = ident.span;
                let member = self.ast.alloc_jsx_member_expression(
                    span,
                    JSXMemberExpressionObject::IdentifierReference(
                        self.ast
                            .alloc_identifier_reference(span, self.ast.ident(lazy)),
                    ),
                    self.ast.jsx_identifier(span, self.ast.str(property)),
                );
                *object = JSXMemberExpressionObject::MemberExpression(member);
                return;
            }
        walk_mut::walk_jsx_member_expression_object(self, object);
    }

    fn visit_binding_pattern(&mut self, pattern: &mut BindingPattern<'a>) {
        let span = pattern.span();
        if let Some(lazy_name) = self.plan.patterns.get(&span.start) {
            *pattern = self
                .ast
                .binding_pattern_binding_identifier(span, self.ast.ident(lazy_name));
            return;
        }
        walk_mut::walk_binding_pattern(self, pattern);
    }
}
