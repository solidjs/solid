//! `<Show>` lowered to the ternary it renders (production builds), the
//! native twin of the Babel plugin's `shared/lower-show.ts`.
//!
//! `{when ? children : fallback}` compiles to a memo of `!!when` and a memo
//! that renders the branch it selects: what `<Show>` does for JSX children
//! without `keyed`, minus the component call, the props object with its
//! getters, and two of its three memos.
//!
//! A callback child `{u => <b>{u().name}</b>}` becomes its body with each
//! `u()` read as `when` again. Only a `when` that reads names, members,
//! literals, operators and `const` signal/memo getters is copied, so a second
//! read gives the same value with nothing run in between. A binding that
//! reads the copy reads `when`'s own sources, so it is the same frame reader
//! the accessor's tracked guard made it (#4354, #3948, #4648); a read after
//! the branch closed reads the falsy value instead of throwing the
//! stale-read error, which dev builds keep (they keep the component).
//!
//! Anything else keeps the component: `keyed`, a spread, another prop, a
//! string `when`, a callback that is not one identifier param with a JSX
//! body, a child that could be a function, or a position where the ternary
//! would not be tracked (a component's non-sole child, an attribute, inside
//! a JSX expression).

use std::collections::{HashMap, HashSet};

use oxc_allocator::{Allocator, CloneIn};
use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, VisitMut, walk, walk_mut};
use oxc_semantic::{Scoping, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::UnaryOperator;

use crate::shared::ast_builder::AstBuilder;

const SOLID_SOURCES: [&str; 2] = ["solid-js", "@solidjs/web"];

pub(crate) fn lower_show<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
    module_name: &str,
    built_ins: &[String],
) {
    let scoping = SemanticBuilder::new()
        .build(program)
        .semantic
        .into_scoping();
    let mut facts = Facts::default();
    collect_facts(program, &scoping, module_name, &mut facts);
    if !facts.has_show && !(facts.unbound_show && built_ins.iter().any(|b| b == "Show")) {
        return;
    }
    let mut lower = Lower {
        ast: AstBuilder::new(allocator),
        allocator,
        scoping: &scoping,
        facts: &facts,
        built_ins,
        context: vec![Context::Statement],
    };
    lower.visit_program(program);
}

#[derive(Default)]
struct Facts {
    /// Local import symbol -> the Solid export it names.
    imports: HashMap<SymbolId, String>,
    /// `const` signal/memo getters never written.
    accessors: HashSet<SymbolId>,
    has_show: bool,
    unbound_show: bool,
}

fn collect_facts(program: &Program<'_>, scoping: &Scoping, module_name: &str, facts: &mut Facts) {
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else {
            continue;
        };
        if import.import_kind.is_type() {
            continue;
        }
        let source = import.source.value.as_str();
        if !SOLID_SOURCES.contains(&source) && source != module_name {
            continue;
        }
        let Some(specifiers) = &import.specifiers else {
            continue;
        };
        for specifier in specifiers {
            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                continue;
            };
            if specifier.import_kind.is_type() {
                continue;
            }
            let Some(symbol) = specifier.local.symbol_id.get() else {
                continue;
            };
            let name = specifier.imported.name().to_string();
            if name == "Show" {
                facts.has_show = true;
            }
            facts.imports.insert(symbol, name);
        }
    }
    struct Collector<'s> {
        scoping: &'s Scoping,
        facts: &'s mut Facts,
    }
    impl<'b> Visit<'b> for Collector<'_> {
        fn visit_variable_declaration(&mut self, it: &VariableDeclaration<'b>) {
            if it.kind == VariableDeclarationKind::Const {
                for declarator in &it.declarations {
                    let Some(Expression::CallExpression(call)) =
                        declarator.init.as_ref().map(unwrap)
                    else {
                        continue;
                    };
                    let Some(factory) = resolve_callee(self.scoping, &call.callee)
                        .and_then(|s| self.facts.imports.get(&s))
                    else {
                        continue;
                    };
                    let getter = match (factory.as_str(), &declarator.id) {
                        ("createMemo", BindingPattern::BindingIdentifier(id)) => id.symbol_id.get(),
                        ("createSignal", BindingPattern::ArrayPattern(array)) => {
                            match array.elements.first() {
                                Some(Some(BindingPattern::BindingIdentifier(id))) => {
                                    id.symbol_id.get()
                                }
                                _ => None,
                            }
                        }
                        _ => None,
                    };
                    if let Some(symbol) = getter
                        && !self.scoping.symbol_is_mutated(symbol)
                    {
                        self.facts.accessors.insert(symbol);
                    }
                }
            }
            walk::walk_variable_declaration(self, it);
        }
        fn visit_jsx_opening_element(&mut self, it: &JSXOpeningElement<'b>) {
            if let JSXElementName::IdentifierReference(id) = &it.name
                && id.name == "Show"
                && resolve(self.scoping, id).is_none()
            {
                self.facts.unbound_show = true;
            }
            walk::walk_jsx_opening_element(self, it);
        }
    }
    let mut collector = Collector { scoping, facts };
    collector.visit_program(program);
}

fn resolve(scoping: &Scoping, id: &IdentifierReference<'_>) -> Option<SymbolId> {
    id.reference_id
        .get()
        .and_then(|r| scoping.get_reference(r).symbol_id())
}

fn resolve_callee(scoping: &Scoping, callee: &Expression<'_>) -> Option<SymbolId> {
    match callee {
        Expression::Identifier(id) => resolve(scoping, id),
        _ => None,
    }
}

fn unwrap<'b, 'a>(mut expr: &'b Expression<'a>) -> &'b Expression<'a> {
    loop {
        expr = match expr {
            Expression::ParenthesizedExpression(e) => &e.expression,
            Expression::TSAsExpression(e) => &e.expression,
            Expression::TSSatisfiesExpression(e) => &e.expression,
            Expression::TSNonNullExpression(e) => &e.expression,
            _ => return expr,
        }
    }
}

fn unwrap_owned<'a>(mut expr: Expression<'a>) -> Expression<'a> {
    loop {
        expr = match expr {
            Expression::ParenthesizedExpression(e) => e.unbox().expression,
            Expression::TSAsExpression(e) => e.unbox().expression,
            Expression::TSSatisfiesExpression(e) => e.unbox().expression,
            Expression::TSNonNullExpression(e) => e.unbox().expression,
            _ => return expr,
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Context {
    /// Directly inside a JSX expression container (no function between).
    JsxExpression,
    /// Anywhere else (a function body resets the JSX expression context).
    Statement,
}

struct Lower<'s, 'a> {
    ast: AstBuilder<'a>,
    allocator: &'a Allocator,
    scoping: &'s Scoping,
    facts: &'s Facts,
    built_ins: &'s [String],
    context: Vec<Context>,
}

/// How the lowered ternary is written where the `<Show>` stands.
#[derive(Clone, Copy, PartialEq)]
enum Form {
    /// `{when ? children : fallback}`: a child of an element or fragment.
    Container,
    /// `<>{when ? children : fallback}</>`: a component's sole child, or JSX
    /// outside JSX, so it compiles to a memo.
    Fragment,
}

fn is_insignificant(child: &JSXChild<'_>) -> bool {
    match child {
        JSXChild::Text(text) => {
            text.value.chars().all(char::is_whitespace) && text.value.contains('\n')
        }
        JSXChild::ExpressionContainer(c) => {
            matches!(c.expression, JSXExpression::EmptyExpression(_))
        }
        _ => false,
    }
}

fn is_intrinsic(name: &JSXElementName<'_>) -> bool {
    match name {
        JSXElementName::Identifier(id) => id.name.starts_with(|c: char| c.is_ascii_lowercase()),
        JSXElementName::NamespacedName(_) => true,
        _ => false,
    }
}

impl<'a> Lower<'_, 'a> {
    fn is_show(&self, element: &JSXElement<'a>) -> bool {
        let JSXElementName::IdentifierReference(id) = &element.opening_element.name else {
            return false;
        };
        match resolve(self.scoping, id) {
            Some(symbol) => self.facts.imports.get(&symbol).is_some_and(|n| n == "Show"),
            None => id.name == "Show" && self.built_ins.iter().any(|b| b == "Show"),
        }
    }

    /// Lowers the element in `child` in place when it is a lowerable `<Show>`.
    fn lower_child(&mut self, child: &mut JSXChild<'a>, form: Form) {
        let JSXChild::Element(element) = child else {
            return;
        };
        if !self.is_show(element) {
            return;
        }
        let span = element.span;
        let Some(ternary) = self.ternary(element) else {
            return;
        };
        *child = match form {
            Form::Container => self
                .ast
                .jsx_child_expression_container(span, JSXExpression::from(ternary)),
            Form::Fragment => {
                let fragment = self.ast.expression_jsx_fragment(
                    span,
                    self.ast.vec1(
                        self.ast
                            .jsx_child_expression_container(span, JSXExpression::from(ternary)),
                    ),
                );
                self.ast.jsx_child_expression(span, fragment)
            }
        };
    }

    fn void0(&self, span: Span) -> Expression<'a> {
        self.ast.expression_unary(
            span,
            UnaryOperator::Void,
            self.ast.expression_numeric_literal(
                span,
                0.0,
                None,
                oxc_syntax::number::NumberBase::Decimal,
            ),
        )
    }

    /// Validates the element and, when lowerable, takes its parts (leaving the
    /// element emptied) and returns the ternary.
    fn ternary(&mut self, element: &mut JSXElement<'a>) -> Option<Expression<'a>> {
        let span = element.span;
        let mut when_index = None;
        let mut fallback_index = None;
        for (index, item) in element.opening_element.attributes.iter().enumerate() {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return None;
            };
            let JSXAttributeName::Identifier(name) = &attribute.name else {
                return None;
            };
            let slot = match name.name.as_str() {
                "when" => &mut when_index,
                "fallback" => &mut fallback_index,
                _ => return None,
            };
            if slot.is_some() {
                return None;
            }
            match &attribute.value {
                Some(JSXAttributeValue::ExpressionContainer(c))
                    if !matches!(c.expression, JSXExpression::EmptyExpression(_)) => {}
                Some(JSXAttributeValue::Element(_)) | Some(JSXAttributeValue::Fragment(_)) => {}
                _ => return None,
            }
            *slot = Some(index);
        }
        let when_index = when_index?;
        let when_ref = attribute_expression(&element.opening_element.attributes[when_index])?;

        let significant: Vec<usize> = element
            .children
            .iter()
            .enumerate()
            .filter(|(_, c)| !is_insignificant(c))
            .map(|(i, _)| i)
            .collect();
        let sole_expr = match significant.as_slice() {
            [index] => match &element.children[*index] {
                JSXChild::ExpressionContainer(c) => c.expression.as_expression().map(unwrap),
                _ => None,
            },
            _ => None,
        };

        enum Children {
            Jsx,
            Callback(usize),
        }
        let children = match sole_expr {
            Some(Expression::ArrowFunctionExpression(arrow)) => {
                if !self.callback_lowerable(arrow, when_ref) {
                    return None;
                }
                Children::Callback(significant[0])
            }
            Some(Expression::FunctionExpression(_)) => return None,
            Some(expr) if !is_never_function(expr) => return None,
            _ => {
                for index in &significant {
                    if let JSXChild::ExpressionContainer(c) = &element.children[*index]
                        && matches!(
                            c.expression.as_expression().map(unwrap),
                            Some(
                                Expression::ArrowFunctionExpression(_)
                                    | Expression::FunctionExpression(_)
                            )
                        )
                    {
                        return None;
                    }
                }
                Children::Jsx
            }
        };

        // Lowerable: take the parts.
        let when = take_attribute_expression(
            self.allocator,
            &mut element.opening_element.attributes[when_index],
        );
        let fallback = fallback_index.map(|i| {
            take_attribute_expression(self.allocator, &mut element.opening_element.attributes[i])
        });
        let consequent = match children {
            Children::Jsx if significant.is_empty() => self.void0(span),
            Children::Jsx => {
                let children = std::mem::replace(&mut element.children, self.ast.vec());
                self.ast.expression_jsx_fragment(span, children)
            }
            Children::Callback(index) => {
                let child = std::mem::replace(
                    &mut element.children[index],
                    self.ast.jsx_child_text(span, "", None),
                );
                let JSXChild::ExpressionContainer(container) = child else {
                    unreachable!()
                };
                let expression = container.unbox().expression.into_expression();
                let Expression::ArrowFunctionExpression(arrow) = unwrap_owned(expression) else {
                    unreachable!()
                };
                self.substitute(arrow.unbox(), &when)
            }
        };
        Some(self.ast.expression_conditional(
            span,
            when,
            consequent,
            fallback.unwrap_or_else(|| self.void0(span)),
        ))
    }

    fn callback_lowerable(
        &self,
        arrow: &ArrowFunctionExpression<'a>,
        when: &Expression<'a>,
    ) -> bool {
        if arrow.r#async || arrow.params.items.len() != 1 || arrow.params.rest.is_some() {
            return false;
        }
        let param = &arrow.params.items[0];
        let BindingPattern::BindingIdentifier(id) = &param.pattern else {
            return false;
        };
        if param.initializer.is_some() {
            return false;
        }
        let Some(symbol) = id.symbol_id.get() else {
            return false;
        };
        if self.scoping.symbol_is_mutated(symbol) {
            return false;
        }
        let body = match &arrow.body {
            ArrowFunctionBody::FunctionBody(_) => return false,
            body => body.as_expression().map(unwrap),
        };
        if !matches!(
            body,
            Some(Expression::JSXElement(_) | Expression::JSXFragment(_))
        ) {
            return false;
        }
        if !self.is_plain_read(when) {
            return false;
        }
        // Each name `when` reads must mean the same where the body reads the
        // parameter: nothing the callback declares may shadow it.
        let mut names = NameCollector::default();
        names.visit_expression(when);
        let mut bindings = BindingCollector::default();
        bindings.visit_arrow_function_expression(arrow);
        if names.names.iter().any(|n| bindings.names.contains(n)) {
            return false;
        }
        // Every reference to the parameter is a `u()` read or a plain value
        // read in expression position.
        let mut refs = RefCounter {
            scoping: self.scoping,
            symbol,
            found: 0,
            bad: false,
        };
        refs.visit_arrow_function_expression(arrow);
        !refs.bad && refs.found == self.scoping.get_resolved_reference_ids(symbol).len()
    }

    fn substitute(
        &self,
        arrow: ArrowFunctionExpression<'a>,
        when: &Expression<'a>,
    ) -> Expression<'a> {
        let symbol = match &arrow.params.items[0].pattern {
            BindingPattern::BindingIdentifier(id) => id.symbol_id.get().unwrap(),
            _ => unreachable!(),
        };
        let mut body = match arrow.body {
            ArrowFunctionBody::FunctionBody(_) => unreachable!(),
            body => unwrap_owned(body.into_expression()),
        };
        let mut substitute = Substitute {
            allocator: self.allocator,
            scoping: self.scoping,
            symbol,
            when,
        };
        substitute.visit_expression(&mut body);
        body
    }

    /// Whether reading an expression again gives the same value with nothing
    /// run in between.
    fn is_plain_read(&self, expr: &Expression<'a>) -> bool {
        match expr {
            Expression::Identifier(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::StringLiteral(_) => true,
            Expression::TemplateLiteral(t) => t.expressions.is_empty(),
            Expression::ParenthesizedExpression(e) => self.is_plain_read(&e.expression),
            Expression::TSAsExpression(e) => self.is_plain_read(&e.expression),
            Expression::TSSatisfiesExpression(e) => self.is_plain_read(&e.expression),
            Expression::TSNonNullExpression(e) => self.is_plain_read(&e.expression),
            Expression::ChainExpression(chain) => match &chain.expression {
                ChainElement::StaticMemberExpression(m) => self.is_plain_read(&m.object),
                ChainElement::ComputedMemberExpression(m) => {
                    self.is_plain_read(&m.object) && self.is_plain_read(&m.expression)
                }
                _ => false,
            },
            Expression::StaticMemberExpression(m) => self.is_plain_read(&m.object),
            Expression::ComputedMemberExpression(m) => {
                self.is_plain_read(&m.object) && self.is_plain_read(&m.expression)
            }
            Expression::CallExpression(call) => {
                call.arguments.is_empty()
                    && !call.optional
                    && resolve_callee(self.scoping, &call.callee)
                        .is_some_and(|s| self.facts.accessors.contains(&s))
            }
            Expression::UnaryExpression(u) => {
                u.operator != UnaryOperator::Delete && self.is_plain_read(&u.argument)
            }
            Expression::BinaryExpression(b) => {
                self.is_plain_read(&b.left) && self.is_plain_read(&b.right)
            }
            Expression::LogicalExpression(l) => {
                self.is_plain_read(&l.left) && self.is_plain_read(&l.right)
            }
            Expression::ConditionalExpression(c) => {
                self.is_plain_read(&c.test)
                    && self.is_plain_read(&c.consequent)
                    && self.is_plain_read(&c.alternate)
            }
            _ => false,
        }
    }
}

fn attribute_expression<'b, 'a>(item: &'b JSXAttributeItem<'a>) -> Option<&'b Expression<'a>> {
    let JSXAttributeItem::Attribute(attribute) = item else {
        return None;
    };
    match &attribute.value {
        Some(JSXAttributeValue::ExpressionContainer(c)) => c.expression.as_expression(),
        _ => None,
    }
}

fn take_attribute_expression<'a>(
    allocator: &'a Allocator,
    item: &mut JSXAttributeItem<'a>,
) -> Expression<'a> {
    let ast = AstBuilder::new(allocator);
    let JSXAttributeItem::Attribute(attribute) = item else {
        unreachable!()
    };
    let span = attribute.span;
    match attribute.value.take() {
        Some(JSXAttributeValue::ExpressionContainer(c)) => c.unbox().expression.into_expression(),
        Some(JSXAttributeValue::Element(e)) => Expression::JSXElement(e),
        Some(JSXAttributeValue::Fragment(f)) => Expression::JSXFragment(f),
        _ => ast.expression_null_literal(span),
    }
}

/// An expression whose value can never be a function.
fn is_never_function(expr: &Expression<'_>) -> bool {
    match expr {
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::TemplateLiteral(_)
        | Expression::JSXElement(_)
        | Expression::JSXFragment(_)
        | Expression::BinaryExpression(_)
        | Expression::UnaryExpression(_)
        | Expression::UpdateExpression(_) => true,
        Expression::ParenthesizedExpression(e) => is_never_function(&e.expression),
        Expression::ConditionalExpression(c) => {
            is_never_function(&c.consequent) && is_never_function(&c.alternate)
        }
        Expression::LogicalExpression(l) => {
            is_never_function(&l.left) && is_never_function(&l.right)
        }
        _ => false,
    }
}

#[derive(Default)]
struct NameCollector {
    names: HashSet<String>,
}
impl<'b> Visit<'b> for NameCollector {
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'b>) {
        self.names.insert(it.name.to_string());
    }
}

#[derive(Default)]
struct BindingCollector {
    names: HashSet<String>,
}
impl<'b> Visit<'b> for BindingCollector {
    fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'b>) {
        self.names.insert(it.name.to_string());
    }
}

/// Counts the parameter's references that substitution can rewrite; any other
/// (a shorthand property, an optional call, a JSX tag, a type query) is bad.
struct RefCounter<'s> {
    scoping: &'s Scoping,
    symbol: SymbolId,
    found: usize,
    bad: bool,
}
impl RefCounter<'_> {
    fn is_param(&self, expr: &Expression<'_>) -> bool {
        matches!(expr, Expression::Identifier(id) if resolve(self.scoping, id) == Some(self.symbol))
    }
}
impl<'b> Visit<'b> for RefCounter<'_> {
    fn visit_object_property(&mut self, it: &ObjectProperty<'b>) {
        if it.shorthand && self.is_param(&it.value) {
            self.bad = true;
        }
        walk::walk_object_property(self, it);
    }
    fn visit_chain_expression(&mut self, it: &ChainExpression<'b>) {
        if let ChainElement::CallExpression(call) = &it.expression
            && self.is_param(&call.callee)
        {
            self.bad = true;
        }
        walk::walk_chain_expression(self, it);
    }
    fn visit_expression(&mut self, it: &Expression<'b>) {
        if self.is_param(it) {
            self.found += 1;
            return;
        }
        walk::walk_expression(self, it);
    }
}

struct Substitute<'s, 'w, 'a> {
    allocator: &'a Allocator,
    scoping: &'s Scoping,
    symbol: SymbolId,
    when: &'w Expression<'a>,
}
impl<'a> Substitute<'_, '_, 'a> {
    fn is_param(&self, expr: &Expression<'a>) -> bool {
        matches!(expr, Expression::Identifier(id) if resolve(self.scoping, id) == Some(self.symbol))
    }
    fn copy(&self) -> Expression<'a> {
        self.when.clone_in(self.allocator)
    }
}
impl<'a> VisitMut<'a> for Substitute<'_, '_, 'a> {
    fn visit_expression(&mut self, it: &mut Expression<'a>) {
        if let Expression::CallExpression(call) = it
            && call.arguments.is_empty()
            && !call.optional
            && self.is_param(&call.callee)
        {
            *it = self.copy();
            return;
        }
        if self.is_param(it) {
            let span = it.span();
            let copy = self.copy();
            *it = crate::shared::ast::arrow_return_expression(self.allocator, span, copy);
            return;
        }
        walk_mut::walk_expression(self, it);
    }
}

impl<'a> VisitMut<'a> for Lower<'_, 'a> {
    fn visit_jsx_element(&mut self, it: &mut JSXElement<'a>) {
        self.context.push(Context::Statement);
        walk_mut::walk_jsx_element(self, it);
        self.context.pop();
        let intrinsic = is_intrinsic(&it.opening_element.name);
        let significant = it.children.iter().filter(|c| !is_insignificant(c)).count();
        let form = if intrinsic {
            Some(Form::Container)
        } else if significant == 1 {
            Some(Form::Fragment)
        } else {
            None
        };
        if let Some(form) = form {
            for child in it.children.iter_mut() {
                self.lower_child(child, form);
            }
        }
    }

    fn visit_jsx_fragment(&mut self, it: &mut JSXFragment<'a>) {
        self.context.push(Context::Statement);
        walk_mut::walk_jsx_fragment(self, it);
        self.context.pop();
        for child in it.children.iter_mut() {
            self.lower_child(child, Form::Container);
        }
    }

    fn visit_jsx_expression_container(&mut self, it: &mut JSXExpressionContainer<'a>) {
        self.context.push(Context::JsxExpression);
        walk_mut::walk_jsx_expression_container(self, it);
        self.context.pop();
    }

    fn visit_jsx_attribute(&mut self, it: &mut JSXAttribute<'a>) {
        // An attribute's value (`fallback={<Show/>}`, `fallback=<Show/>`)
        // keeps the component.
        self.context.push(Context::JsxExpression);
        walk_mut::walk_jsx_attribute(self, it);
        self.context.pop();
    }

    fn visit_function(&mut self, it: &mut Function<'a>, flags: oxc_semantic::ScopeFlags) {
        self.context.push(Context::Statement);
        walk_mut::walk_function(self, it, flags);
        self.context.pop();
    }

    fn visit_arrow_function_expression(&mut self, it: &mut ArrowFunctionExpression<'a>) {
        self.context.push(Context::Statement);
        walk_mut::walk_arrow_function_expression(self, it);
        self.context.pop();
    }

    fn visit_expression(&mut self, it: &mut Expression<'a>) {
        walk_mut::walk_expression(self, it);
        if self.context.last() == Some(&Context::JsxExpression) {
            return;
        }
        let Expression::JSXElement(element) = it else {
            return;
        };
        if !self.is_show(element) {
            return;
        }
        let span = element.span;
        let Some(ternary) = self.ternary(element) else {
            return;
        };
        *it = self.ast.expression_jsx_fragment(
            span,
            self.ast.vec1(
                self.ast
                    .jsx_child_expression_container(span, JSXExpression::from(ternary)),
            ),
        );
    }
}
