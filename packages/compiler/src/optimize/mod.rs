//! The `optimize` pass: constant folding, dead-code elimination, and static
//! resolution of Solid's control-flow components.
//!
//! It runs on the parsed program *before* any generate lowers JSX, so
//! whatever it resolves statically never reaches the DOM/SSR/universal
//! transforms at all: a `<Show>` whose condition is a compile-time constant
//! becomes its branch inline, and the branch is then templated like any other
//! markup instead of paying for a component call, a memo, and an insert hole.
//!
//! # What folds
//!
//! - Constant expressions: literals, template literals, and the unary,
//!   binary, logical, and conditional operators over them.
//! - `const` bindings, and `let` bindings nothing ever writes to, at any
//!   scope. References are resolved through `oxc_semantic` (see [`env`]), so
//!   a `const DEBUG = false` inside a component folds at its use sites while
//!   an unrelated binding of the same name elsewhere is untouched.
//! - Statements a constant condition makes unreachable: `if`/`else` branches,
//!   `while (false)` loops, and anything after a `return`, `throw`, `break`,
//!   or `continue`.
//! - Solid's control-flow components, in [`fold_flow_element`]:
//!   `<Show when>`, `<For each>`, `<Repeat count>`, `<Switch>`/`<Match when>`,
//!   and `<Dynamic component>` with a static intrinsic tag name.
//!
//! # What deliberately does not fold
//!
//! `<Portal>`, `<Loading>`, `<Errored>`, and `<Reveal>` each exist for a
//! runtime condition (a mount target, a pending read, a thrown error, a
//! reveal order) that no static analysis can decide, so they have no
//! compile-time form. A control-flow component with a spread attribute is
//! left alone as well, since the spread can supply or override the very prop
//! the fold reads. Function children (`<Show when={C}>{v => …}</Show>`) also
//! stop a fold: the runtime decides whether to call them from their arity.
//!
//! # Consistency requirement
//!
//! Folding changes the shape of the rendered tree, and therefore hydration
//! ids. A server build and its client build must be compiled with the same
//! `optimize` setting.

mod env;
mod value;

use oxc_allocator::{Allocator, TakeIn};
use oxc_ast::ast::{
    Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXChild,
    JSXElement, JSXElementName, JSXExpression, JSXFragment, ObjectProperty, Program, Statement,
};
use oxc_ast_visit::{Visit, VisitMut, walk, walk_mut};
use oxc_span::{GetSpan, Span};

use crate::shared::ast_builder::AstBuilder;
use crate::shared::classify::jsx_text_is_filtered;
use crate::shared::utils::decode_html_entities;
use env::ProgramFacts;
use value::{Const, array_literal_len, effectful_parts, evaluate, is_side_effect_free, truthiness};

/// Folding one node can expose the next one up (a `<Show>` that resolves to
/// an empty `<For>`, say). The traversal is post-order, so a single pass
/// already handles nesting; the extra rounds only exist for the rarer case
/// where a parent's fold enables a sibling's, and they stop as soon as a pass
/// changes nothing.
const MAX_PASSES: usize = 3;

/// The control-flow components this pass knows how to resolve statically.
/// `Match` is deliberately absent: it only has meaning inside a `<Switch>`,
/// which folds it as part of folding itself.
const FOLDABLE_FLOW: [&str; 5] = ["Show", "For", "Repeat", "Switch", "Dynamic"];

/// Every built-in this pass recognizes by name, including the ones it only
/// folds as part of another (`Match`).
const KNOWN_FLOW: [&str; 6] = ["Show", "For", "Repeat", "Switch", "Match", "Dynamic"];

/// Solid's own runtime always re-exports the control-flow components, so an
/// explicit `import { Show } from "solid-js"` names the same component the
/// compiler would auto-import from `moduleName`.
const SOLID_MODULE_NAME: &str = "solid-js";

pub(crate) fn optimize_program<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
    built_ins: &[String],
    module_name: &str,
) {
    let mut optimizer = Optimizer {
        allocator,
        ast: AstBuilder::new(allocator),
        built_ins,
        flow_sources: [module_name, SOLID_MODULE_NAME],
        facts: env::collect_facts(program),
        changed: false,
    };
    for _ in 0..MAX_PASSES {
        optimizer.changed = false;
        optimizer.visit_program(program);
        if !optimizer.changed {
            break;
        }
    }
}

/// What a resolved control-flow element renders in its own place.
enum Fold<'a> {
    /// The element's (or a winning branch's) JSX children, spliced in.
    Children(oxc_allocator::Vec<'a, JSXChild<'a>>),
    /// A single expression, such as a `fallback` prop's value.
    Expression(Expression<'a>),
    /// Nothing at all.
    Empty,
}

struct Optimizer<'a, 'o> {
    allocator: &'a Allocator,
    ast: AstBuilder<'a>,
    built_ins: &'o [String],
    /// Module specifiers an explicit built-in import may come from.
    flow_sources: [&'o str; 2],
    facts: ProgramFacts,
    changed: bool,
}

impl<'a> VisitMut<'a> for Optimizer<'a, '_> {
    fn visit_expression(&mut self, it: &mut Expression<'a>) {
        walk_mut::walk_expression(self, it);
        self.fold_expression(it);
    }

    fn visit_jsx_element(&mut self, it: &mut JSXElement<'a>) {
        walk_mut::walk_jsx_element(self, it);
        self.fold_children(&mut it.children);
    }

    fn visit_jsx_fragment(&mut self, it: &mut JSXFragment<'a>) {
        walk_mut::walk_jsx_fragment(self, it);
        self.fold_children(&mut it.children);
    }

    fn visit_object_property(&mut self, it: &mut ObjectProperty<'a>) {
        walk_mut::walk_object_property(self, it);
        // `{ enabled }` cannot stay shorthand once its value folded to a
        // literal; the printer would emit the key alone and lose the value.
        if it.shorthand && !matches!(it.value, Expression::Identifier(_)) {
            it.shorthand = false;
        }
    }

    fn visit_statements(&mut self, it: &mut oxc_allocator::Vec<'a, Statement<'a>>) {
        walk_mut::walk_statements(self, it);
        self.eliminate_dead_statements(it);
    }
}

// ---------------------------------------------------------------------------
// Expression folding
// ---------------------------------------------------------------------------

impl<'a> Optimizer<'a, '_> {
    fn fold_expression(&mut self, expression: &mut Expression<'a>) {
        if let Expression::JSXElement(element) = expression
            && let Some(fold) = self.fold_flow_element(element)
        {
            let span = element.span;
            *expression = self.fold_into_expression(span, fold);
            self.changed = true;
            return;
        }

        // The side a short-circuit does not reach never runs, so dropping
        // it is free. The side that *does* run has to be skippable before
        // the other one can replace the whole expression.
        match expression {
            Expression::LogicalExpression(logical) => {
                let Some(left) = truthiness(&logical.left, &self.facts.constants) else {
                    return;
                };
                let takes_left = match logical.operator {
                    oxc_syntax::operator::LogicalOperator::And => !left,
                    oxc_syntax::operator::LogicalOperator::Or => left,
                    // `??` turns on nullishness, not truthiness, so it only
                    // folds against a known constant.
                    oxc_syntax::operator::LogicalOperator::Coalesce => {
                        match evaluate(&logical.left, &self.facts.constants) {
                            Some(value) => !matches!(value, Const::Null | Const::Undefined),
                            None => return,
                        }
                    }
                };
                let span = logical.span;
                let kept = if takes_left {
                    logical.left.take_in(&self.allocator)
                } else {
                    let effectful = !is_side_effect_free(&logical.left);
                    let discarded = effectful.then(|| logical.left.take_in(&self.allocator));
                    let right = logical.right.take_in(&self.allocator);
                    self.keep_after(span, discarded, right)
                };
                *expression = kept;
                self.changed = true;
            }
            Expression::ConditionalExpression(conditional) => {
                let Some(test) = truthiness(&conditional.test, &self.facts.constants) else {
                    return;
                };
                let span = conditional.span;
                let effectful = !is_side_effect_free(&conditional.test);
                let discarded = effectful.then(|| conditional.test.take_in(&self.allocator));
                let kept = if test {
                    conditional.consequent.take_in(&self.allocator)
                } else {
                    conditional.alternate.take_in(&self.allocator)
                };
                *expression = self.keep_after(span, discarded, kept);
                self.changed = true;
            }
            _ => {
                if let Some(folded) = self.constant_expression(expression) {
                    *expression = folded;
                    self.changed = true;
                }
            }
        }
    }

    /// Keeps `value`, evaluating `discarded` first when the fold could not
    /// simply skip it.
    ///
    /// A condition whose truthiness is known but whose evaluation is
    /// observable still has to run. `(discarded, value)` runs it in the same
    /// order the original did and yields the same result, so the branch goes
    /// even though the test stays.
    fn keep_after(
        &self,
        span: Span,
        discarded: Option<Expression<'a>>,
        value: Expression<'a>,
    ) -> Expression<'a> {
        let Some(discarded) = discarded else {
            return value;
        };
        let mut parts = std::vec::Vec::new();
        effectful_parts(discarded, &mut parts);
        if parts.is_empty() {
            return value;
        }
        parts.push(value);
        self.ast
            .expression_sequence(span, self.ast.vec_from_iter(parts))
    }

    /// The literal spelling of a constant expression, or `None` when the
    /// expression is not constant or is already at its shortest form.
    fn constant_expression(&self, expression: &Expression<'a>) -> Option<Expression<'a>> {
        if matches!(
            expression,
            Expression::NullLiteral(_)
                | Expression::BooleanLiteral(_)
                | Expression::NumericLiteral(_)
                | Expression::StringLiteral(_)
        ) {
            return None;
        }
        let span = expression.span();
        match evaluate(expression, &self.facts.constants)? {
            Const::Null => Some(self.ast.expression_null_literal(span)),
            Const::Bool(value) => Some(self.ast.expression_boolean_literal(span, value)),
            Const::Number(value) => Some(self.ast.expression_numeric_literal(
                span,
                value,
                None,
                oxc_syntax::number::NumberBase::Decimal,
            )),
            Const::String(value) => Some(self.ast.expression_string_literal(
                span,
                self.ast.str(&value),
                None,
            )),
            // `undefined` has no literal spelling; leaving the expression as
            // authored also keeps this pass from rewriting `void 0` forever.
            Const::Undefined => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Control-flow components
// ---------------------------------------------------------------------------

impl<'a> Optimizer<'a, '_> {
    /// Replaces every statically resolvable control-flow child in `children`
    /// with what it renders.
    fn fold_children(&mut self, children: &mut oxc_allocator::Vec<'a, JSXChild<'a>>) {
        let foldable = children.iter().any(
            |child| matches!(child, JSXChild::Element(element) if self.flow_tag(element).is_some()),
        );
        if !foldable {
            return;
        }
        let taken = std::mem::replace(children, self.ast.vec());
        let mut folded = self.ast.vec_with_capacity(taken.len());
        for child in taken {
            match child {
                JSXChild::Element(mut element) => {
                    if let Some(fold) = self.fold_flow_element(&mut element) {
                        self.changed = true;
                        self.push_fold(&mut folded, element.span, fold);
                    } else {
                        folded.push(JSXChild::Element(element));
                    }
                }
                other => folded.push(other),
            }
        }
        *children = folded;
    }

    fn push_fold(
        &self,
        out: &mut oxc_allocator::Vec<'a, JSXChild<'a>>,
        span: Span,
        fold: Fold<'a>,
    ) {
        match fold {
            Fold::Children(children) => out.extend(children),
            Fold::Expression(expression) => {
                out.push(self.ast.jsx_child_expression(span, expression))
            }
            Fold::Empty => {}
        }
    }

    fn fold_into_expression(&self, span: Span, fold: Fold<'a>) -> Expression<'a> {
        match fold {
            Fold::Expression(expression) => expression,
            Fold::Empty => self.ast.expression_null_literal(span),
            Fold::Children(mut children) => {
                let significant = children
                    .iter()
                    .filter(|child| !filtered_text(child))
                    .count();
                if significant == 0 {
                    return self.ast.expression_null_literal(span);
                }
                if significant == 1
                    && let Some(position) = children.iter().position(|child| !filtered_text(child))
                    && matches!(
                        children[position],
                        JSXChild::Element(_) | JSXChild::Fragment(_)
                    )
                {
                    return match children[position].take_in(&self.allocator) {
                        JSXChild::Element(element) => Expression::JSXElement(element),
                        JSXChild::Fragment(fragment) => Expression::JSXFragment(fragment),
                        // Unreachable given the match above.
                        _ => self.ast.expression_null_literal(span),
                    };
                }
                self.ast.expression_jsx_fragment(span, children)
            }
        }
    }

    /// The control-flow component `element` is, if it is one that this pass
    /// can resolve and the tag is not shadowed by a local binding.
    fn flow_tag(&self, element: &JSXElement<'a>) -> Option<&'static str> {
        let name = self.built_in_tag(element)?;
        FOLDABLE_FLOW.into_iter().find(|flow| *flow == name)
    }

    /// Resolves a tag to the Solid built-in it actually refers to.
    ///
    /// Being in the configured `builtIns` list only makes a name a
    /// candidate; a fold rewrites the component's semantics, so the tag has
    /// to resolve to Solid's own component before one is safe:
    ///
    /// - a value import from a Solid module decides the identity outright,
    ///   by the name that module exports, so `<Cond>` from
    ///   `import { Show as Cond }` is `Show`;
    /// - a tag that binds to nothing is the built-in the compiler
    ///   auto-imports;
    /// - anything else (a local `Show`, an import from an unrelated module)
    ///   is a different component and is left alone.
    fn built_in_tag(&self, element: &JSXElement<'a>) -> Option<&'static str> {
        let (name, span) = match &element.opening_element.name {
            JSXElementName::IdentifierReference(identifier) => {
                (identifier.name.as_str(), identifier.span)
            }
            JSXElementName::Identifier(identifier) => (identifier.name.as_str(), identifier.span),
            _ => return None,
        };
        let identity = self
            .facts
            .tag_identity(span.start, name, &self.flow_sources)?;
        self.known_flow(identity)
    }

    /// The built-in named `name`, when the configuration still treats that
    /// name as one. An empty `builtIns` is an explicit opt-out, and it turns
    /// the fold off as well as the auto-import.
    fn known_flow(&self, name: &str) -> Option<&'static str> {
        if !self.built_ins.iter().any(|built_in| built_in == name) {
            return None;
        }
        // Return a `'static` spelling so callers can compare tags cheaply.
        KNOWN_FLOW.into_iter().find(|known| *known == name)
    }

    fn fold_flow_element(&mut self, element: &mut JSXElement<'a>) -> Option<Fold<'a>> {
        let tag = self.flow_tag(element)?;
        // A spread can supply or override the prop the fold reads, so no
        // control-flow element with one is resolvable.
        if has_spread_attribute(element) {
            return None;
        }
        match tag {
            "Show" => self.fold_show(element),
            "For" => self.fold_for(element),
            "Repeat" => self.fold_repeat(element),
            "Switch" => self.fold_switch(element),
            "Dynamic" => self.fold_dynamic(element),
            _ => None,
        }
    }

    fn fold_show(&mut self, element: &mut JSXElement<'a>) -> Option<Fold<'a>> {
        let when = self.attribute_truthiness(attribute(element, "when")?)?;
        if !when {
            return Some(self.take_fallback(element));
        }
        if has_callback_child(&element.children) {
            return None;
        }
        Some(Fold::Children(std::mem::replace(
            &mut element.children,
            self.ast.vec(),
        )))
    }

    fn fold_for(&mut self, element: &mut JSXElement<'a>) -> Option<Fold<'a>> {
        let each = attribute(element, "each")?;
        let JSXAttributeValue::ExpressionContainer(container) = each.value.as_ref()? else {
            return None;
        };
        let expression = container.expression.as_expression()?;
        // `each={[]}` renders the fallback, and so does any statically falsy
        // `each`. `mapArray` treats `null`/`undefined`/`false` as an empty
        // list, which is what the prop's own type allows. Either way the
        // expression itself is dropped, so it has to be skippable.
        let empty = array_literal_len(expression) == Some(0)
            || truthiness(expression, &self.facts.constants) == Some(false);
        let empty = empty && is_side_effect_free(expression);
        if !empty {
            return None;
        }
        Some(self.take_fallback(element))
    }

    fn fold_repeat(&mut self, element: &mut JSXElement<'a>) -> Option<Fold<'a>> {
        let count = attribute(element, "count")?;
        let JSXAttributeValue::ExpressionContainer(container) = count.value.as_ref()? else {
            return None;
        };
        let Const::Number(count) =
            evaluate(container.expression.as_expression()?, &self.facts.constants)?
        else {
            return None;
        };
        // Written this way so `NaN` counts as empty, like `repeat` does.
        if count >= 1.0 {
            return None;
        }
        Some(self.take_fallback(element))
    }

    /// Resolves a `<Switch>` as far as its `<Match when>` conditions allow:
    /// statically false matches are dropped, a statically true match with no
    /// undecided match before it wins outright, and a switch whose every
    /// match is false renders its fallback.
    fn fold_switch(&mut self, element: &mut JSXElement<'a>) -> Option<Fold<'a>> {
        let mut matches = std::vec::Vec::new();
        for (index, child) in element.children.iter().enumerate() {
            match child {
                child if filtered_text(child) => {}
                JSXChild::Element(candidate)
                    if self.built_in_tag(candidate) == Some("Match")
                        && !has_spread_attribute(candidate) =>
                {
                    let when = attribute(candidate, "when")?;
                    matches.push((index, self.attribute_truthiness(when)));
                }
                // Anything else in a `<Switch>` is outside what this pass
                // models, so the whole element is left alone.
                _ => return None,
            }
        }
        if matches.is_empty() {
            return None;
        }

        let winner = matches
            .iter()
            .position(|(_, when)| *when == Some(true))
            .filter(|position| {
                matches[..*position]
                    .iter()
                    .all(|(_, when)| *when == Some(false))
            });
        if let Some(winner) = winner {
            let index = matches[winner].0;
            let JSXChild::Element(winning_match) = &mut element.children[index] else {
                return None;
            };
            if has_callback_child(&winning_match.children) {
                return None;
            }
            return Some(Fold::Children(std::mem::replace(
                &mut winning_match.children,
                self.ast.vec(),
            )));
        }

        if matches.iter().all(|(_, when)| *when == Some(false)) {
            return Some(self.take_fallback(element));
        }

        // No outcome yet, but every statically false match is dead weight and
        // the runtime would evaluate it on each pass.
        let dead: std::collections::HashSet<usize> = matches
            .iter()
            .filter(|(_, when)| *when == Some(false))
            .map(|(index, _)| *index)
            .collect();
        if !dead.is_empty() {
            let taken = std::mem::replace(&mut element.children, self.ast.vec());
            let kept = self.ast.vec_from_iter(
                taken
                    .into_iter()
                    .enumerate()
                    .filter_map(|(index, child)| (!dead.contains(&index)).then_some(child)),
            );
            element.children = kept;
            self.changed = true;
        }
        None
    }

    /// `<Dynamic component="div" …>` is just `<div …>`, which the generates
    /// can put in a template instead of creating an element at runtime.
    /// Only intrinsic tag names fold: a capitalized string is not a component
    /// reference, and a namespaced one is not something the transforms build
    /// dynamically.
    fn fold_dynamic(&mut self, element: &mut JSXElement<'a>) -> Option<Fold<'a>> {
        let component = attribute(element, "component")?;
        let tag = match component.value.as_ref()? {
            JSXAttributeValue::StringLiteral(literal) => decode_html_entities(&literal.value),
            JSXAttributeValue::ExpressionContainer(container) => {
                match evaluate(container.expression.as_expression()?, &self.facts.constants)? {
                    Const::String(value) => value,
                    _ => return None,
                }
            }
            _ => return None,
        };
        if !is_intrinsic_tag(&tag) {
            return None;
        }

        let span = element.span;
        let self_closing = element.closing_element.is_none();
        let mut attributes = self
            .ast
            .vec_with_capacity(element.opening_element.attributes.len());
        for item in element.opening_element.attributes.iter_mut() {
            if attribute_named(item, "component") {
                continue;
            }
            attributes.push(item.take_in(&self.allocator));
        }
        let children = std::mem::replace(&mut element.children, self.ast.vec());
        Some(Fold::Expression(self.ast.expression_jsx_intrinsic_element(
            span,
            &tag,
            attributes,
            children,
            self_closing,
        )))
    }

    /// Whether an attribute's value is statically truthy or falsy. A bare
    /// attribute (`<Show when />`) is `true`, matching JSX.
    fn attribute_truthiness(&self, attribute: &JSXAttribute<'a>) -> Option<bool> {
        match &attribute.value {
            None => Some(true),
            Some(JSXAttributeValue::StringLiteral(literal)) => Some(!literal.value.is_empty()),
            Some(JSXAttributeValue::Element(_) | JSXAttributeValue::Fragment(_)) => Some(true),
            Some(JSXAttributeValue::ExpressionContainer(container)) => container
                .expression
                .as_expression()
                .filter(|expression| is_side_effect_free(expression))
                .and_then(|expression| truthiness(expression, &self.facts.constants)),
        }
    }

    /// What the element renders when its condition fails: its `fallback`
    /// prop, or nothing.
    fn take_fallback(&mut self, element: &mut JSXElement<'a>) -> Fold<'a> {
        let Some(fallback) = element
            .opening_element
            .attributes
            .iter_mut()
            .find_map(|item| match item {
                JSXAttributeItem::Attribute(attribute)
                    if attribute_name(&attribute.name) == "fallback" =>
                {
                    Some(&mut **attribute)
                }
                _ => None,
            })
        else {
            return Fold::Empty;
        };
        let span = fallback.span;
        match &mut fallback.value {
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                if container.expression.as_expression().is_none() {
                    return Fold::Empty;
                }
                match container.expression.take_in(&self.allocator) {
                    JSXExpression::EmptyExpression(_) => Fold::Empty,
                    expression => Fold::Expression(expression.into_expression()),
                }
            }
            Some(JSXAttributeValue::StringLiteral(literal)) => {
                let value = decode_html_entities(&literal.value);
                Fold::Expression(self.ast.expression_string_literal(
                    span,
                    self.ast.str(&value),
                    None,
                ))
            }
            Some(JSXAttributeValue::Element(element)) => {
                Fold::Expression(Expression::JSXElement(element.take_in_box(&self.allocator)))
            }
            Some(JSXAttributeValue::Fragment(fragment)) => Fold::Expression(
                Expression::JSXFragment(fragment.take_in_box(&self.allocator)),
            ),
            // A bare `fallback` is `fallback={true}`, which renders nothing.
            None => Fold::Empty,
        }
    }
}

// ---------------------------------------------------------------------------
// Dead statements
// ---------------------------------------------------------------------------

impl<'a> Optimizer<'a, '_> {
    fn eliminate_dead_statements(
        &mut self,
        statements: &mut oxc_allocator::Vec<'a, Statement<'a>>,
    ) {
        // A resolution can leave nothing, one statement, or an effectful
        // test followed by the taken branch, so the list is rebuilt rather
        // than patched in place.
        let mut resolutions = std::vec::Vec::with_capacity(statements.len());
        let mut resolved_any = false;
        for statement in statements.iter_mut() {
            let resolution = self.resolve_statement(statement);
            resolved_any |= resolution.is_some();
            resolutions.push(resolution);
        }
        if resolved_any {
            let taken = std::mem::replace(statements, self.ast.vec());
            let mut rebuilt = self.ast.vec_with_capacity(taken.len());
            for (statement, resolution) in taken.into_iter().zip(resolutions) {
                match resolution {
                    Some(replacements) => {
                        for replacement in replacements {
                            rebuilt.push(replacement);
                        }
                    }
                    None => rebuilt.push(statement),
                }
            }
            *statements = rebuilt;
            self.changed = true;
        }

        // Everything after the first `return`/`throw`/`break`/`continue` is
        // unreachable, but a `var` or function declaration in it is still
        // hoisted, so a list carrying one is left intact.
        let unreachable_from = statements
            .iter()
            .position(is_terminator)
            .map(|position| position + 1)
            .filter(|start| *start < statements.len())
            .filter(|start| {
                !statements[*start..]
                    .iter()
                    .any(contains_hoisted_declaration)
            });
        if let Some(start) = unreachable_from {
            statements.truncate(start);
            self.changed = true;
        }

        if statements
            .iter()
            .any(|statement| matches!(statement, Statement::EmptyStatement(_)))
        {
            let taken = std::mem::replace(statements, self.ast.vec());
            *statements = self.ast.vec_from_iter(
                taken
                    .into_iter()
                    .filter(|statement| !matches!(statement, Statement::EmptyStatement(_))),
            );
        }
    }

    /// The statements a constant condition leaves behind, or `None` when the
    /// statement stands as written. An empty list removes it outright.
    fn resolve_statement(
        &mut self,
        statement: &mut Statement<'a>,
    ) -> Option<std::vec::Vec<Statement<'a>>> {
        match statement {
            Statement::IfStatement(branch) => {
                let test = truthiness(&branch.test, &self.facts.constants)?;
                let dropped_hoists = if test {
                    branch
                        .alternate
                        .as_ref()
                        .is_some_and(contains_hoisted_declaration)
                } else {
                    contains_hoisted_declaration(&branch.consequent)
                };
                if dropped_hoists {
                    return None;
                }
                let kept = if test {
                    Some(&mut branch.consequent)
                } else {
                    branch.alternate.as_mut()
                };
                // A bare function declaration as a branch body is Annex B
                // web-compatibility semantics, not something to relocate
                // into the enclosing list.
                if matches!(kept, Some(Statement::FunctionDeclaration(_))) {
                    return None;
                }
                let kept = kept.map(|kept| kept.take_in(&self.allocator));
                let mut resolved = std::vec::Vec::with_capacity(2);
                if let Some(effect) = self.discarded_test(&mut branch.test) {
                    resolved.push(effect);
                }
                resolved.extend(kept);
                Some(resolved)
            }
            Statement::WhileStatement(loop_statement) => {
                if truthiness(&loop_statement.test, &self.facts.constants)? {
                    return None;
                }
                if contains_hoisted_declaration(&loop_statement.body) {
                    return None;
                }
                // A `while` whose test is falsy evaluates that test exactly
                // once and never enters the body.
                Some(
                    self.discarded_test(&mut loop_statement.test)
                        .into_iter()
                        .collect(),
                )
            }
            _ => None,
        }
    }

    /// The statement that preserves a discarded test's evaluation, or `None`
    /// when skipping it changes nothing.
    fn discarded_test(&self, test: &mut Expression<'a>) -> Option<Statement<'a>> {
        if is_side_effect_free(test) {
            return None;
        }
        let span = test.span();
        let mut parts = std::vec::Vec::new();
        effectful_parts(test.take_in(&self.allocator), &mut parts);
        let kept = match parts.len() {
            0 => return None,
            1 => parts.pop().expect("one part"),
            _ => self
                .ast
                .expression_sequence(span, self.ast.vec_from_iter(parts)),
        };
        Some(self.ast.statement_expression(span, kept))
    }
}

// ---------------------------------------------------------------------------
// Small AST predicates
// ---------------------------------------------------------------------------

fn attribute_name(name: &JSXAttributeName<'_>) -> String {
    match name {
        JSXAttributeName::Identifier(identifier) => identifier.name.to_string(),
        JSXAttributeName::NamespacedName(namespaced) => {
            format!("{}:{}", namespaced.namespace.name, namespaced.name.name)
        }
    }
}

fn attribute_named(item: &JSXAttributeItem<'_>, name: &str) -> bool {
    matches!(item, JSXAttributeItem::Attribute(attribute) if attribute_name(&attribute.name) == name)
}

fn attribute<'e, 'a>(element: &'e JSXElement<'a>, name: &str) -> Option<&'e JSXAttribute<'a>> {
    element
        .opening_element
        .attributes
        .iter()
        .find_map(|item| match item {
            JSXAttributeItem::Attribute(attribute) if attribute_name(&attribute.name) == name => {
                Some(&**attribute)
            }
            _ => None,
        })
}

fn has_spread_attribute(element: &JSXElement<'_>) -> bool {
    element
        .opening_element
        .attributes
        .iter()
        .any(|item| matches!(item, JSXAttributeItem::SpreadAttribute(_)))
}

/// Whether any child is a function, which the runtime may call with the
/// narrowed value. Folding one away would drop that call.
fn has_callback_child(children: &[JSXChild<'_>]) -> bool {
    children.iter().any(|child| {
        matches!(
            child,
            JSXChild::ExpressionContainer(container)
                if matches!(
                    container.expression,
                    JSXExpression::ArrowFunctionExpression(_)
                        | JSXExpression::FunctionExpression(_)
                )
        )
    })
}

/// JSX text that renders nothing, by the same rule the generates filter with.
fn filtered_text(child: &JSXChild<'_>) -> bool {
    matches!(child, JSXChild::Text(text) if jsx_text_is_filtered(text.value.as_str()))
}

/// An intrinsic element name: lowercase-initial and free of the `:` a
/// namespaced tag carries.
fn is_intrinsic_tag(tag: &str) -> bool {
    tag.starts_with(|first: char| first.is_ascii_lowercase())
        && tag
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn is_terminator(statement: &Statement<'_>) -> bool {
    matches!(
        statement,
        Statement::ReturnStatement(_)
            | Statement::ThrowStatement(_)
            | Statement::BreakStatement(_)
            | Statement::ContinueStatement(_)
    )
}

/// Whether removing `statement` would remove a `var` or function declaration
/// that is hoisted out of it. Nested functions are their own scope and do not
/// count.
fn contains_hoisted_declaration(statement: &Statement<'_>) -> bool {
    struct Hoisted {
        found: bool,
    }

    impl<'a> Visit<'a> for Hoisted {
        fn visit_variable_declaration(&mut self, it: &oxc_ast::ast::VariableDeclaration<'a>) {
            if it.kind.is_var() {
                self.found = true;
            }
            walk::walk_variable_declaration(self, it);
        }

        fn visit_function(
            &mut self,
            it: &oxc_ast::ast::Function<'a>,
            _flags: oxc_syntax::scope::ScopeFlags,
        ) {
            // A function *declaration* hoists its name; its body does not
            // contribute anything to the enclosing scope.
            if it.is_declaration() {
                self.found = true;
            }
        }

        fn visit_arrow_function_expression(
            &mut self,
            _it: &oxc_ast::ast::ArrowFunctionExpression<'a>,
        ) {
        }

        fn visit_class(&mut self, _it: &oxc_ast::ast::Class<'a>) {}
    }

    let mut hoisted = Hoisted { found: false };
    hoisted.visit_statement(statement);
    hoisted.found
}

#[cfg(test)]
mod tests {
    use crate::{CompileOptions, Generate, compile};

    fn compile_with(source: &str, optimize: bool) -> String {
        compile(
            source,
            &CompileOptions {
                filename: Some("optimize.jsx".into()),
                module_name: "r-dom".into(),
                generate: Generate::Dom,
                optimize,
                ..CompileOptions::default()
            },
        )
        .expect("compile")
        .code
    }

    fn optimized(source: &str) -> String {
        compile_with(source, true)
    }

    #[test]
    fn show_resolves_to_the_branch_a_constant_condition_selects() {
        let taken = optimized("const view = <Show when={true}><div>on</div></Show>;");
        assert!(taken.contains("<div>on"), "{taken}");
        assert!(!taken.contains("createComponent"), "{taken}");
        assert!(!taken.contains("Show"), "{taken}");

        let dropped = optimized("const view = <Show when={false}><div>on</div></Show>;");
        assert!(dropped.contains("const view = null"), "{dropped}");

        let fallback =
            optimized("const view = <Show when={0} fallback={<span>off</span>}><div /></Show>;");
        assert!(fallback.contains("<span>off"), "{fallback}");
        assert!(!fallback.contains("<div"), "{fallback}");
    }

    #[test]
    fn show_folds_against_a_module_level_constant() {
        let source =
            "const DEBUG = false;\nexport const view = <div><Show when={DEBUG}><b /></Show></div>;";
        let folded = optimized(source);
        assert!(!folded.contains("<b"), "{folded}");
        assert!(!folded.contains("createComponent"), "{folded}");

        // A reassigned binding is not a constant, so nothing folds.
        let reassigned = optimized(
            "let DEBUG = false;\nDEBUG = true;\nexport const view = <div><Show when={DEBUG}><b /></Show></div>;",
        );
        assert!(reassigned.contains("createComponent"), "{reassigned}");
    }

    #[test]
    fn show_keeps_function_children_and_spreads() {
        let callback = optimized("const view = <Show when={true}>{v => <div>{v()}</div>}</Show>;");
        assert!(callback.contains("createComponent"), "{callback}");

        let spread = optimized("const view = <Show when={true} {...rest}><div /></Show>;");
        assert!(spread.contains("createComponent"), "{spread}");
    }

    #[test]
    fn for_resolves_an_empty_list_to_its_fallback() {
        let empty = optimized(
            "const view = <For each={[]} fallback={<span>none</span>}>{i => <li />}</For>;",
        );
        assert!(empty.contains("<span>none"), "{empty}");
        assert!(!empty.contains("createComponent"), "{empty}");

        let nullish = optimized("const view = <For each={null}>{i => <li />}</For>;");
        assert!(nullish.contains("const view = null"), "{nullish}");

        let dynamic = optimized("const view = <For each={items()}>{i => <li />}</For>;");
        assert!(dynamic.contains("createComponent"), "{dynamic}");
    }

    #[test]
    fn repeat_resolves_a_zero_count_to_its_fallback() {
        let empty = optimized(
            "const view = <Repeat count={0} fallback={<span>none</span>}>{i => <li />}</Repeat>;",
        );
        assert!(empty.contains("<span>none"), "{empty}");

        let some = optimized("const view = <Repeat count={3}>{i => <li />}</Repeat>;");
        assert!(some.contains("createComponent"), "{some}");
    }

    #[test]
    fn switch_picks_the_first_statically_true_match() {
        let winner = optimized(
            "const view = <Switch fallback={<a />}><Match when={false}><b /></Match><Match when={true}><i /></Match></Switch>;",
        );
        assert!(winner.contains("<i"), "{winner}");
        assert!(!winner.contains("<b"), "{winner}");
        assert!(!winner.contains("createComponent"), "{winner}");

        let none = optimized(
            "const view = <Switch fallback={<a />}><Match when={false}><b /></Match></Switch>;",
        );
        assert!(none.contains("<a"), "{none}");

        // An undecided match before a true one blocks the pick, but the dead
        // branch still goes.
        let pruned = optimized(
            "const view = <Switch><Match when={maybe()}><b /></Match><Match when={false}><u /></Match></Switch>;",
        );
        assert!(pruned.contains("createComponent"), "{pruned}");
        assert!(!pruned.contains("<u"), "{pruned}");
    }

    #[test]
    fn dynamic_with_a_static_intrinsic_tag_becomes_a_template() {
        let folded = optimized("const view = <Dynamic component=\"div\" id=\"main\" />;");
        assert!(folded.contains("_$template(`<div id=main"), "{folded}");
        assert!(!folded.contains("createComponent"), "{folded}");

        let component = optimized("const view = <Dynamic component={Widget} id=\"main\" />;");
        assert!(component.contains("createComponent"), "{component}");
    }

    #[test]
    fn constant_expressions_and_dead_statements_go() {
        let attribute = optimized("const view = <div id={\"a\" + \"b\"} tabindex={1 + 2} />;");
        assert!(attribute.contains("id=ab"), "{attribute}");
        assert!(attribute.contains("tabindex=3"), "{attribute}");

        let branch =
            optimized("function App() {\n  if (false) { missing(); }\n  return <div />;\n}");
        assert!(!branch.contains("missing"), "{branch}");

        let unreachable = optimized("function App() {\n  return <div />;\n  unreachable();\n}");
        assert!(!unreachable.contains("unreachable"), "{unreachable}");

        // A `var` in the dropped branch still hoists, so the branch stays.
        let hoisted =
            optimized("function App() {\n  if (false) { var kept = 1; }\n  return <div />;\n}");
        assert!(hoisted.contains("kept"), "{hoisted}");
    }

    /// A condition is discarded along with the branch that read it, so an
    /// effectful condition keeps running in front of whatever the branch
    /// resolved to. Composite literals are always truthy yet can run
    /// arbitrary code, so they are the interesting case.
    #[test]
    fn a_discarded_condition_keeps_its_side_effects() {
        let logical = optimized("export const x = [effect()] && other;");
        assert!(logical.contains("([effect()], other)"), "{logical}");

        let ternary = optimized("export const y = { k: effect() } ? a : b;");
        assert!(ternary.contains("({ k: effect() }, a)"), "{ternary}");

        // The sequence a previous fold left behind still decides the next
        // one, and only its effectful parts survive.
        let chained = optimized("export const n = ([effect()] && false) ? a : b;");
        assert!(chained.contains("([effect()], b)"), "{chained}");

        let spread = optimized("export const s = [...iterable()] ? a : b;");
        assert!(spread.contains("iterable()"), "{spread}");

        let computed_key = optimized("export const c = { [key()]: 1 } ? a : b;");
        assert!(computed_key.contains("key()"), "{computed_key}");

        // Evaluating a class runs its static blocks and heritage expression.
        let static_block = optimized("export const z = (class { static { effect(); } }) ? a : b;");
        assert!(static_block.contains("effect()"), "{static_block}");

        let heritage = optimized("export const w = (class extends base() {}) ? a : b;");
        assert!(heritage.contains("base()"), "{heritage}");

        // A component prop is not hoistable: Solid reads `when` inside a
        // memo, so evaluating it eagerly here would change when and how
        // often it runs. These stay unfolded rather than resequenced.
        let when = optimized("export const v = <Show when={[effect()]}><b /></Show>;");
        assert!(when.contains("effect()"), "{when}");
        assert!(when.contains("createComponent"), "{when}");

        let each = optimized("export const l = <For each={effects() && null}><b /></For>;");
        assert!(each.contains("effects()"), "{each}");

        let branch = optimized(
            "export function App() {\n  if ({ k: effect() }) { taken(); }\n  else { gone(); }\n  return <div />;\n}",
        );
        assert!(branch.contains("effect()"), "{branch}");
        assert!(branch.contains("taken()"), "{branch}");
        assert!(!branch.contains("gone()"), "{branch}");

        let loop_test = optimized(
            "export function App() {\n  while ([effect()] && false) { body(); }\n  return <div />;\n}",
        );
        assert!(loop_test.contains("effect()"), "{loop_test}");
        assert!(!loop_test.contains("body()"), "{loop_test}");
        assert!(!loop_test.contains("while"), "{loop_test}");

        // The unreached side of a short-circuit never runs, so dropping it
        // stays correct.
        let unreached = optimized("export const k = false && effect();");
        assert!(!unreached.contains("effect()"), "{unreached}");

        let untaken = optimized("export const j = true ? kept() : effect();");
        assert!(!untaken.contains("effect()"), "{untaken}");
        assert!(untaken.contains("kept()"), "{untaken}");
    }

    #[test]
    fn constants_fold_in_any_scope() {
        let local = optimized(
            "export function App() {\n  const DEBUG = false;\n  return <div><Show when={DEBUG}><b>panel</b></Show></div>;\n}",
        );
        assert!(!local.contains("panel"), "{local}");
        assert!(!local.contains("createComponent"), "{local}");

        let nested = optimized(
            "export function App() {\n  const N = 2;\n  const render = () => <div><Show when={N > 1}><b>panel</b></Show></div>;\n  return render();\n}",
        );
        assert!(nested.contains("<b>panel"), "{nested}");
        assert!(!nested.contains("createComponent"), "{nested}");

        // An unwritten `let` is a constant too; a written one is not.
        let unwritten = optimized(
            "export function App() {\n  let DEBUG = false;\n  return <Show when={DEBUG}><b /></Show>;\n}",
        );
        assert!(!unwritten.contains("createComponent"), "{unwritten}");

        let written = optimized(
            "export function App() {\n  let DEBUG = false;\n  DEBUG = flag();\n  return <Show when={DEBUG}><b /></Show>;\n}",
        );
        assert!(written.contains("createComponent"), "{written}");

        // A parameter shadows the outer constant, so the inner tag is not
        // decided by it.
        let shadowed = optimized(
            "const DEBUG = false;\nexport function App(DEBUG) {\n  return <Show when={DEBUG}><b /></Show>;\n}",
        );
        assert!(shadowed.contains("createComponent"), "{shadowed}");

        // Two unrelated locals of the same name resolve independently.
        let independent = optimized(
            "export function A() {\n  const FLAG = true;\n  return <Show when={FLAG}><b /></Show>;\n}\nexport function B(FLAG) {\n  return <Show when={FLAG}><i /></Show>;\n}",
        );
        assert!(independent.contains("<b"), "{independent}");
        assert!(independent.contains("createComponent"), "{independent}");

        // A local declaration cannot reach a reference outside its scope.
        let out_of_scope = optimized(
            "function inner() {\n  const OUTSIDE = false;\n  return OUTSIDE;\n}\nexport const view = <Show when={OUTSIDE}><b /></Show>;",
        );
        assert!(out_of_scope.contains("createComponent"), "{out_of_scope}");

        // A use site above its declaration still folds, since the function
        // body runs after the module finishes evaluating.
        let later = optimized(
            "export function App() {\n  return <Show when={DEBUG}><b /></Show>;\n}\nconst DEBUG = false;",
        );
        assert!(!later.contains("createComponent"), "{later}");
    }

    #[test]
    fn a_local_binding_shadows_a_solid_import_for_its_own_scope() {
        let source = "import { Show } from \"solid-js\";\nexport function App() {\n  const Show = props => props.children;\n  return <Show when={true}><b /></Show>;\n}\nexport const view = <Show when={true}><i /></Show>;";
        let output = optimized(source);
        // The inner tag binds to the local component and keeps its call...
        assert!(output.contains("createComponent"), "{output}");
        // ...while the outer one still resolves to the import and folds.
        assert!(output.contains("<i"), "{output}");
        assert_eq!(output.matches("_$createComponent(").count(), 1, "{output}");
    }

    #[test]
    fn a_built_in_tag_only_folds_when_it_resolves_to_solids_component() {
        let auto_imported = optimized("const view = <Show when={true}><div /></Show>;");
        assert!(
            !auto_imported.contains("createComponent"),
            "{auto_imported}"
        );

        let from_solid = optimized(
            "import { Show } from \"solid-js\";\nconst view = <Show when={true}><div /></Show>;",
        );
        assert!(!from_solid.contains("createComponent"), "{from_solid}");

        let from_module_name = optimized(
            "import { Show } from \"r-dom\";\nconst view = <Show when={true}><div /></Show>;",
        );
        assert!(
            !from_module_name.contains("createComponent"),
            "{from_module_name}"
        );

        let foreign = optimized(
            "import { Show } from \"./my-show\";\nconst view = <Show when={true}><div /></Show>;",
        );
        assert!(foreign.contains("createComponent"), "{foreign}");

        // The exported name decides the identity, so an alias folds as what
        // it renamed — and a local `Show` bound to a different import does
        // not become Solid's.
        let aliased = optimized(
            "import { Show as Cond } from \"solid-js\";\nconst view = <Cond when={true}><div /></Cond>;",
        );
        assert!(!aliased.contains("createComponent"), "{aliased}");

        let aliased_list = optimized(
            "import { For as Each } from \"solid-js\";\nconst view = <Each each={[]} fallback={<span />}>{i => <li />}</Each>;",
        );
        assert!(aliased_list.contains("<span"), "{aliased_list}");
        assert!(!aliased_list.contains("createComponent"), "{aliased_list}");

        let aliased_foreign = optimized(
            "import { Show as Cond } from \"./my-show\";\nconst view = <Cond when={true}><div /></Cond>;",
        );
        assert!(
            aliased_foreign.contains("createComponent"),
            "{aliased_foreign}"
        );

        let renamed = optimized(
            "import { Reveal as Show } from \"solid-js\";\nconst view = <Show when={true}><div /></Show>;",
        );
        assert!(renamed.contains("createComponent"), "{renamed}");

        let local = optimized(
            "function App() {\n  const Show = props => props.children;\n  return <Show when={true}><div /></Show>;\n}",
        );
        assert!(local.contains("createComponent"), "{local}");
    }

    #[test]
    fn the_pass_is_off_by_default() {
        let source = "const view = <Show when={false}><div /></Show>;";
        let untouched = compile_with(source, false);
        assert!(untouched.contains("createComponent"), "{untouched}");
        assert!(untouched.contains("Show as _$Show"), "{untouched}");
    }
}
