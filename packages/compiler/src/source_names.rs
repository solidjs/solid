//! `sourceNames.primitives` — name reactive primitives after the identifier
//! they are declared as. `const [count, setCount] = createSignal(0)` becomes
//! `createSignal(0, { name: "count" })`, `const doubled = createMemo(fn)`
//! becomes `createMemo(fn, { name: "doubled" })`, so the dev and observe
//! runtimes label the node the way the source does instead of `signal` /
//! `computed`.
//!
//! An independent pass, like `transform_directives` / `transform_lazy` /
//! `transform_refresh`: plain JavaScript in and out, no JSX involved, so it
//! applies to `.ts`/`.js` modules — where shared signals and stores tend to
//! live — as well as component files. The Vite plugin runs it ahead of the
//! JSX transform.
//!
//! Rules:
//! - Only calls whose callee resolves to an import from `solid-js` or
//!   `@solidjs/signals` are named — a named import (aliased or not) or a
//!   namespace member (`Solid.createSignal`). A user's own `createCounter()`
//!   wrapper is not a primitive; the signal inside it is, and gets its own
//!   local name.
//! - An explicit name is never overridden: an options object literal
//!   without `name` gains one, one with `name` (or a spread) is left alone,
//!   and a non-literal options argument is left alone — we cannot see
//!   inside it.
//! - The name is the declared identifier: a `const`/`let`/`var` binding, the
//!   first element of an array pattern (`[count, setCount]`), an object
//!   literal's property key (`{ count: createSignal(0) }`), or a class
//!   field. A call in any other position stays with the runtime default.
//! - Inside a named function that is not a component — first letter not
//!   uppercase, so `createCounter`, `useTheme`, a method — the name is
//!   prefixed with that function's (`createCounter.count`), the dotted
//!   convention stores already use (`store.todos`); the Performance panel
//!   adapter folds the tail into the primitive on its labels. Inside a
//!   component the owner path already says `<Counter>`, so no prefix.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, ArrowFunctionExpression, BindingPattern, CallExpression, Class, Expression, Function,
    ImportDeclarationSpecifier, MethodDefinition, ObjectProperty, ObjectPropertyKind, Program,
    PropertyDefinition, PropertyKey, Statement, VariableDeclarator,
};
use oxc_ast_visit::{Visit, VisitMut, walk, walk_mut};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::{ParseOptions, Parser};
use oxc_semantic::{Scoping, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::scope::ScopeFlags;

use crate::config::{TransformResult, source_type_for_filename};
use crate::shared::ast::object_property;
use crate::shared::ast_builder::AstBuilder;

/// The modules whose primitives the pass names.
const PRIMITIVE_SOURCES: &[&str] = &["solid-js", "@solidjs/signals"];

#[napi(object)]
#[derive(Default)]
pub struct TransformSourceNamesOptions {
    /// Decides the source type (`.ts`, `.tsx`, `.js`, `.jsx`); TSX without
    /// one.
    pub filename: Option<String>,
    pub source_map: Option<bool>,
}

pub fn transform_source_names(
    code: String,
    options: Option<TransformSourceNamesOptions>,
) -> Result<TransformResult> {
    let options = options.unwrap_or_default();
    let filename = options.filename.as_deref();
    let untouched = |code: String| TransformResult {
        code,
        map: None,
        css: None,
        css_hash: None,
    };
    // Cheap gate before parsing: no import of a primitive source, nothing
    // to name. The Vite plugin applies the same string check before calling.
    if !PRIMITIVE_SOURCES.iter().any(|source| code.contains(source)) {
        return Ok(untouched(code));
    }

    let source_type = source_type_for_filename(filename)?;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &code, source_type)
        .with_options(ParseOptions {
            preserve_parens: false,
            ..ParseOptions::default()
        })
        .parse();
    if let Some(error) = crate::shared::parser::first_parser_error(parsed.diagnostics) {
        return Err(Error::from_reason(error));
    }

    let mut program = parsed.program;
    let targets = collect_targets(&program);
    if targets.is_empty() {
        return Ok(untouched(code));
    }

    let mut rewriter = Rewriter {
        allocator: &allocator,
        targets,
    };
    rewriter.visit_program(&mut program);

    let build = Codegen::new()
        .with_options(CodegenOptions {
            source_map_path: options
                .source_map
                .unwrap_or(false)
                .then(|| std::path::PathBuf::from(filename.unwrap_or("input.tsx"))),
            ..CodegenOptions::default()
        })
        .build(&program);

    Ok(TransformResult {
        code: build.code,
        map: build.map.map(|map| map.to_json_string()),
        css: None,
        css_hash: None,
    })
}

/// A primitive the pass knows how to name: where its options argument sits.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Primitive {
    /// `createSignal(value?, options?)`, `createOptimistic(value?, options?)`,
    /// `createMemo(compute, options?)` — options second.
    OptionsSecond,
    /// `createProjection(fn, seed, options?)` — options third.
    OptionsThird,
    /// `createStore(value, options?)` or `createStore(fn, seed, options?)`
    /// (`createOptimisticStore` alike) — decided per call by its arguments.
    Store,
}

fn primitive_by_name(name: &str) -> Option<Primitive> {
    match name {
        "createSignal" | "createOptimistic" | "createMemo" => Some(Primitive::OptionsSecond),
        "createProjection" => Some(Primitive::OptionsThird),
        "createStore" | "createOptimisticStore" => Some(Primitive::Store),
        _ => None,
    }
}

/// How a matched call gains its name.
enum Action {
    /// Append `{ name }` as a new argument, after `pad` `void 0` fillers for
    /// omitted positional arguments before the options slot.
    Append { pad: usize },
    /// Add a `name` property to the object literal already in the options
    /// slot (argument `index`).
    Extend { index: usize },
}

struct Target {
    span: Span,
    name: String,
    action: Action,
}

/// The name of a static property key (`count`, `"count"`), if it has one.
fn static_key_name(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(id) => Some(id.name.to_string()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.to_string()),
        _ => None,
    }
}

/// The name a primitive assigned to this pattern is declared as: the binding
/// itself, or the first element of an array pattern (`[count, setCount]`).
fn declared_name(pattern: &BindingPattern<'_>) -> Option<String> {
    match pattern {
        BindingPattern::BindingIdentifier(id) => Some(id.name.to_string()),
        BindingPattern::ArrayPattern(array) => match array.elements.first()? {
            Some(BindingPattern::BindingIdentifier(id)) => Some(id.name.to_string()),
            _ => None,
        },
        _ => None,
    }
}

/// The expression under TypeScript's no-op wrappers (`as`, `satisfies`, `!`).
fn unwrap_ts<'b, 'a>(mut expression: &'b Expression<'a>) -> &'b Expression<'a> {
    loop {
        expression = match expression {
            Expression::TSAsExpression(inner) => &inner.expression,
            Expression::TSSatisfiesExpression(inner) => &inner.expression,
            Expression::TSNonNullExpression(inner) => &inner.expression,
            Expression::TSTypeAssertion(inner) => &inner.expression,
            Expression::ParenthesizedExpression(inner) => &inner.expression,
            other => return other,
        };
    }
}

fn is_function_expression(expression: &Expression<'_>) -> bool {
    matches!(
        expression,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    )
}

/// Components are PascalCase; everything else named (`createCounter`,
/// `useTheme`, a method) is a primitive whose internals take its prefix.
fn is_component_name(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

/// An object literal already in the options slot: `Some(true)` when a
/// `name` property or a spread (which may carry one) is present, `Some(false)`
/// when it can safely gain the name, `None` when the argument is not a
/// literal we can see inside.
fn options_literal_has_name(argument: &Argument<'_>) -> Option<bool> {
    let Some(Expression::ObjectExpression(object)) = argument.as_expression().map(unwrap_ts) else {
        return None;
    };
    Some(object.properties.iter().any(|property| match property {
        ObjectPropertyKind::ObjectProperty(property) => {
            static_key_name(&property.key).as_deref() == Some("name")
        }
        ObjectPropertyKind::SpreadProperty(_) => true,
    }))
}

/// Which argument index the options object belongs at for this call, or
/// `None` when the call shape leaves it ambiguous.
fn options_index(primitive: Primitive, call: &CallExpression<'_>) -> Option<usize> {
    match primitive {
        Primitive::OptionsSecond => Some(1),
        Primitive::OptionsThird => Some(2),
        Primitive::Store => {
            let first = call.arguments.first()?.as_expression().map(unwrap_ts)?;
            if is_function_expression(first) {
                // `createStore(draft => …, seed, options?)`
                return Some(2);
            }
            match call.arguments.len() {
                // `createStore(value)`
                1 => Some(1),
                // `createStore(value, { shallow })` — an options literal with
                // only option keys. Anything else in second position could
                // be the seed of `createStore(deriveFn, seed)` where the
                // derive is passed by reference — an empty `{}` included.
                2 => {
                    let Some(Expression::ObjectExpression(object)) =
                        call.arguments[1].as_expression().map(unwrap_ts)
                    else {
                        return None;
                    };
                    (!object.properties.is_empty()
                        && object.properties.iter().all(|property| match property {
                            ObjectPropertyKind::ObjectProperty(property) => matches!(
                                static_key_name(&property.key).as_deref(),
                                Some("name" | "shallow")
                            ),
                            ObjectPropertyKind::SpreadProperty(_) => false,
                        }))
                    .then_some(1)
                }
                // `createStore(deriveFn, seed, options)` — three arguments
                // only fit the derived shape.
                3 => Some(2),
                _ => None,
            }
        }
    }
}

fn action_for(primitive: Primitive, call: &CallExpression<'_>) -> Option<Action> {
    let index = options_index(primitive, call)?;
    // A spread before the options slot hides the real arity.
    if call
        .arguments
        .iter()
        .take(index)
        .any(|argument| argument.as_expression().is_none())
    {
        return None;
    }
    if call.arguments.len() > index {
        return match options_literal_has_name(&call.arguments[index])? {
            true => None,
            false => Some(Action::Extend { index }),
        };
    }
    Some(Action::Append {
        pad: index - call.arguments.len(),
    })
}

/// Resolves what the pass names: locals bound by imports from a primitive
/// source, by the imported name (so `import { createSignal as sig }` still
/// counts), plus namespace imports whose members are looked up by name.
struct Imports {
    named: std::collections::HashMap<SymbolId, Primitive>,
    namespaces: std::collections::HashSet<SymbolId>,
}

fn collect_imports(program: &Program<'_>) -> Imports {
    let mut imports = Imports {
        named: std::collections::HashMap::new(),
        namespaces: std::collections::HashSet::new(),
    };
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else {
            continue;
        };
        if !PRIMITIVE_SOURCES.contains(&import.source.value.as_str()) {
            continue;
        }
        for specifier in import.specifiers.iter().flatten() {
            match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                    if let Some(primitive) = primitive_by_name(specifier.imported.name().as_str())
                        && let Some(symbol) = specifier.local.symbol_id.get()
                    {
                        imports.named.insert(symbol, primitive);
                    }
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                    if let Some(symbol) = specifier.local.symbol_id.get() {
                        imports.namespaces.insert(symbol);
                    }
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => {}
            }
        }
    }
    imports
}

fn collect_targets(program: &Program<'_>) -> Vec<Target> {
    // Semantic first: it is what fills the symbol ids the import scan reads.
    let semantic = SemanticBuilder::new().build(program).semantic;
    let imports = collect_imports(program);
    if imports.named.is_empty() && imports.namespaces.is_empty() {
        return Vec::new();
    }

    let mut collector = Collector {
        scoping: semantic.scoping(),
        imports: &imports,
        functions: Vec::new(),
        pending_function_name: None,
        targets: Vec::new(),
    };
    collector.visit_program(program);
    collector.targets
}

struct Collector<'s> {
    scoping: &'s Scoping,
    imports: &'s Imports,
    /// Enclosing functions, innermost last; `None` for an anonymous one that
    /// no declaration or property names.
    functions: Vec<Option<String>>,
    /// The declaration/property name to give the function expression that
    /// is its direct initializer (`const createCounter = () => …`,
    /// `{ createCounter() {} }`); consumed by the very next function visited.
    pending_function_name: Option<String>,
    targets: Vec<Target>,
}

impl Collector<'_> {
    fn resolve(&self, expression: &Expression<'_>) -> Option<SymbolId> {
        let Expression::Identifier(identifier) = expression else {
            return None;
        };
        identifier
            .reference_id
            .get()
            .and_then(|id| self.scoping.get_reference(id).symbol_id())
    }

    /// The primitive a callee names, if it resolves to one of ours.
    fn primitive(&self, callee: &Expression<'_>) -> Option<Primitive> {
        match callee {
            Expression::Identifier(_) => self.imports.named.get(&self.resolve(callee)?).copied(),
            Expression::StaticMemberExpression(member) => {
                let namespace = self.resolve(&member.object)?;
                self.imports
                    .namespaces
                    .contains(&namespace)
                    .then(|| primitive_by_name(member.property.name.as_str()))
                    .flatten()
            }
            _ => None,
        }
    }

    /// `createCounter.` for a primitive declared inside a non-component
    /// function; nothing at module level or inside a component.
    fn prefix(&self) -> Option<&str> {
        let name = self.functions.iter().rev().flatten().next()?;
        (!is_component_name(name)).then_some(name.as_str())
    }

    /// Records the call as a target when it is a primitive we can name.
    fn consider(&mut self, initializer: &Expression<'_>, declared: Option<String>) {
        let Some(declared) = declared else {
            return;
        };
        let Expression::CallExpression(call) = unwrap_ts(initializer) else {
            return;
        };
        let Some(primitive) = self.primitive(&call.callee) else {
            return;
        };
        let Some(action) = action_for(primitive, call) else {
            return;
        };
        let name = match self.prefix() {
            Some(prefix) => format!("{prefix}.{declared}"),
            None => declared,
        };
        self.targets.push(Target {
            span: call.span,
            name,
            action,
        });
    }

    /// Visits an initializer, handing a directly-initialized function the
    /// declaration's name.
    fn visit_initializer(&mut self, name: Option<String>, initializer: &Expression<'_>) {
        self.pending_function_name =
            name.filter(|_| is_function_expression(unwrap_ts(initializer)));
        self.visit_expression(initializer);
        self.pending_function_name = None;
    }

    fn with_function<F: FnOnce(&mut Self)>(&mut self, name: Option<String>, walk: F) {
        self.functions.push(name);
        walk(self);
        self.functions.pop();
    }
}

impl<'a> Visit<'a> for Collector<'_> {
    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        walk::walk_binding_pattern(self, &declarator.id);
        let Some(init) = &declarator.init else {
            return;
        };
        let name = declared_name(&declarator.id);
        self.consider(init, name.clone());
        self.visit_initializer(name, init);
    }

    fn visit_object_property(&mut self, property: &ObjectProperty<'a>) {
        walk::walk_property_key(self, &property.key);
        let name = static_key_name(&property.key);
        // `{ count: createSignal(0) }` names the primitive; a method's
        // function takes the key as its name.
        if property.kind == oxc_ast::ast::PropertyKind::Init && !property.method {
            self.consider(&property.value, name.clone());
        }
        self.visit_initializer(name, &property.value);
    }

    fn visit_property_definition(&mut self, property: &PropertyDefinition<'a>) {
        walk::walk_property_key(self, &property.key);
        let Some(value) = &property.value else {
            return;
        };
        let name = static_key_name(&property.key);
        self.consider(value, name.clone());
        self.visit_initializer(name, value);
    }

    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        walk::walk_property_key(self, &method.key);
        self.pending_function_name = static_key_name(&method.key);
        self.visit_function(&method.value, ScopeFlags::Function);
        self.pending_function_name = None;
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        let name = function
            .id
            .as_ref()
            .map(|id| id.name.to_string())
            .or_else(|| self.pending_function_name.take());
        self.pending_function_name = None;
        self.with_function(name, |visitor| {
            walk::walk_function(visitor, function, flags)
        });
    }

    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression<'a>) {
        let name = self.pending_function_name.take();
        self.with_function(name, |visitor| {
            walk::walk_arrow_function_expression(visitor, arrow)
        });
    }

    fn visit_class(&mut self, class: &Class<'a>) {
        // A class body is not a function scope; fields are named bare.
        walk::walk_class(self, class);
    }
}

struct Rewriter<'a> {
    allocator: &'a Allocator,
    targets: Vec<Target>,
}

impl<'a> VisitMut<'a> for Rewriter<'a> {
    fn visit_call_expression(&mut self, call: &mut CallExpression<'a>) {
        if let Some(index) = self
            .targets
            .iter()
            .position(|target| target.span == call.span())
        {
            let target = self.targets.remove(index);
            let ast = AstBuilder::new(self.allocator);
            let span = Span::new(0, 0);
            let name = ast.expression_string_literal(span, ast.str(&target.name), None);
            let property = object_property(self.allocator, span, "name", name);
            match target.action {
                Action::Append { pad } => {
                    for _ in 0..pad {
                        call.arguments.push(Argument::from(ast.void_0(span)));
                    }
                    call.arguments.push(Argument::from(
                        ast.expression_object(span, ast.vec1(property)),
                    ));
                }
                Action::Extend { index } => {
                    if let Some(Expression::ObjectExpression(object)) =
                        call.arguments[index].as_expression_mut().map(unwrap_ts_mut)
                    {
                        object.properties.push(property);
                    }
                }
            }
        }
        walk_mut::walk_call_expression(self, call);
    }
}

/// `unwrap_ts` for a mutable expression.
fn unwrap_ts_mut<'b, 'a>(mut expression: &'b mut Expression<'a>) -> &'b mut Expression<'a> {
    loop {
        expression = match expression {
            Expression::TSAsExpression(inner) => &mut inner.expression,
            Expression::TSSatisfiesExpression(inner) => &mut inner.expression,
            Expression::TSNonNullExpression(inner) => &mut inner.expression,
            Expression::TSTypeAssertion(inner) => &mut inner.expression,
            Expression::ParenthesizedExpression(inner) => &mut inner.expression,
            other => return other,
        };
    }
}
