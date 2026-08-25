//! The single classification authority for traversal-level JSX semantics.
//!
//! Port of the *decision* layer of the Babel plugin's `shared/utils.ts` —
//! most importantly `isDynamic`, which in Babel is one function combining
//! the `/*@static*/` leading-comment check, the namespace-import member
//! carve-out, and the deep dynamic traversal. Every generate (dom, ssr,
//! universal) consults [`Classify`] for these decisions so the modes cannot
//! drift on *what* is dynamic; only emission differs per mode.
//!
//! Nothing outside this module may re-derive dynamic classification: the deep
//! traversal helpers are private here by design.

use oxc_ast::ast::BinaryOperator;
use oxc_ast::ast::{Expression, JSXChild};
use oxc_span::GetSpan;

use crate::shared::bindings::BindingTable;

/// Borrowed view over the state Babel's `isDynamic` reads through
/// `path.scope` / `getConfig(path)`: the binding table (namespace imports),
/// the raw source (comment trivia), and the configured static marker.
pub(crate) struct Classify<'c> {
    bindings: &'c BindingTable,
    source: &'c str,
    static_marker: &'c str,
}

impl<'c> Classify<'c> {
    pub(crate) fn new(bindings: &'c BindingTable, source: &'c str, static_marker: &'c str) -> Self {
        Self {
            bindings,
            source,
            static_marker,
        }
    }

    /// Whether the configured static marker comment appears between two
    /// source offsets (e.g. between an expression container's `{` and the
    /// expression itself — Babel's `leadingComments[0]` check).
    pub(crate) fn marker_between(&self, start: u32, end: u32) -> bool {
        let start = start as usize;
        let end = (end as usize).min(self.source.len());
        if start >= end {
            return false;
        }
        self.source[start..end].contains(self.static_marker)
    }

    /// Full port of Babel's `isDynamic(path, { checkMember: true, checkTags })`:
    /// the static-marker leading-comment check, the namespace-import member
    /// carve-out, and the deep traversal, in one place.
    ///
    /// `leading_from` is the source offset where the expression's leading
    /// trivia begins (the `{` of its expression container, the previous
    /// token of a condition branch). `None` skips the marker check for call
    /// sites whose Babel counterpart never sees a leading comment there
    /// (spread children, where the marker precedes `...` and attaches to the
    /// spread node instead of the expression).
    pub(crate) fn is_dynamic(
        &self,
        leading_from: Option<u32>,
        expression: &Expression<'_>,
        check_tags: bool,
    ) -> bool {
        let marker_static =
            leading_from.is_some_and(|from| self.marker_between(from, expression.span().start));
        let dynamic =
            !marker_static && is_dynamic_with_namespaces(expression, check_tags, self.bindings);
        #[cfg(test)]
        trace::record(expression.span(), check_tags, dynamic);
        dynamic
    }

    /// Mirror of the Babel plugin's `dynamic` marking for child holes
    /// (`transformNode`'s `isDynamic` on containers and spread children):
    /// decides the hydration `scope()` wrap together with
    /// `child_slot_allocates_ids`. Shared so the dom and ssr generates
    /// classify the same source identically.
    pub(crate) fn is_dynamic_child_slot(&self, child: &JSXChild<'_>) -> bool {
        match child {
            JSXChild::ExpressionContainer(container) => container
                .expression
                .as_expression()
                .is_some_and(|expression| {
                    self.is_dynamic(Some(container.span.start), expression, false)
                }),
            JSXChild::Spread(spread) => self.is_dynamic(None, &spread.expression, false),
            _ => false,
        }
    }
}

/// Babel's `filterChildren` text rule: raw JSX text starting with a newline
/// and containing only whitespace is dropped before children counting and
/// child-list filtering.
pub(crate) fn jsx_text_is_filtered(raw: &str) -> bool {
    matches!(raw.chars().next(), Some('\r' | '\n')) && raw.chars().all(char::is_whitespace)
}

/// Babel's `filterChildren` + `checkLength` composition: counts the children
/// that render content — text that survives the filter and has non-whitespace
/// content or is a pure-space run, non-empty expression containers, elements,
/// fragments, and spreads.
pub(crate) fn significant_children(children: &[JSXChild<'_>]) -> usize {
    children
        .iter()
        .filter(|child| match child {
            JSXChild::Text(text) => {
                let raw = text.value.as_str();
                if jsx_text_is_filtered(raw) {
                    return false;
                }
                raw.chars().any(|char| !char.is_whitespace()) || raw.chars().all(|char| char == ' ')
            }
            JSXChild::ExpressionContainer(container) => !matches!(
                container.expression,
                oxc_ast::ast::JSXExpression::EmptyExpression(_)
            ),
            _ => true,
        })
        .count()
}

/// Babel's `checkLength`: more than one significant child.
pub(crate) fn check_length(children: &[JSXChild<'_>]) -> bool {
    significant_children(children) > 1
}

/// Babel's `isDynamic` namespace carve-out: a member expression whose object
/// is an `import * as ns` local is not dynamic (top-level expression only —
/// nested occurrences inside a larger expression still count as dynamic,
/// matching Babel's pre-traversal check).
fn is_dynamic_with_namespaces(
    value: &Expression<'_>,
    check_tags: bool,
    bindings: &BindingTable,
) -> bool {
    match value {
        Expression::StaticMemberExpression(member) => {
            if let Expression::Identifier(object) = &member.object
                && bindings.is_namespace_import(&object.name)
            {
                return false;
            }
        }
        Expression::ComputedMemberExpression(member) => {
            if let Expression::Identifier(object) = &member.object
                && bindings.is_namespace_import(&object.name)
                && !is_dynamic_deep(&member.expression, check_tags)
            {
                return false;
            }
        }
        _ => {}
    }
    is_dynamic_deep(value, check_tags)
}

/// Deep port of the Babel plugin's `isDynamic(expr, { checkMember: true,
/// checkTags })` traversal: walks the whole expression (skipping function
/// bodies — functions themselves are never dynamic) and reports any call,
/// tagged template, member access, spread, or `in` binary expression. With
/// `check_tags`, JSX elements and non-empty JSX fragments count as dynamic;
/// without it their subtrees are skipped entirely, exactly like Babel's
/// `p.skip()`.
fn is_dynamic_deep(value: &Expression<'_>, check_tags: bool) -> bool {
    use oxc_ast_visit::Visit;

    if matches!(
        value,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return false;
    }

    struct DynamicDetector {
        dynamic: bool,
        check_tags: bool,
    }

    impl<'b> Visit<'b> for DynamicDetector {
        fn visit_call_expression(&mut self, _it: &oxc_ast::ast::CallExpression<'b>) {
            self.dynamic = true;
        }
        fn visit_tagged_template_expression(
            &mut self,
            _it: &oxc_ast::ast::TaggedTemplateExpression<'b>,
        ) {
            self.dynamic = true;
        }
        fn visit_static_member_expression(
            &mut self,
            _it: &oxc_ast::ast::StaticMemberExpression<'b>,
        ) {
            self.dynamic = true;
        }
        fn visit_computed_member_expression(
            &mut self,
            _it: &oxc_ast::ast::ComputedMemberExpression<'b>,
        ) {
            self.dynamic = true;
        }
        fn visit_private_field_expression(
            &mut self,
            _it: &oxc_ast::ast::PrivateFieldExpression<'b>,
        ) {
            self.dynamic = true;
        }
        fn visit_spread_element(&mut self, _it: &oxc_ast::ast::SpreadElement<'b>) {
            self.dynamic = true;
        }
        fn visit_binary_expression(&mut self, it: &oxc_ast::ast::BinaryExpression<'b>) {
            if it.operator == BinaryOperator::In {
                self.dynamic = true;
                return;
            }
            oxc_ast_visit::walk::walk_binary_expression(self, it);
        }
        fn visit_jsx_element(&mut self, _it: &oxc_ast::ast::JSXElement<'b>) {
            if self.check_tags {
                self.dynamic = true;
            }
        }
        fn visit_jsx_fragment(&mut self, it: &oxc_ast::ast::JSXFragment<'b>) {
            if self.check_tags && !it.children.is_empty() {
                self.dynamic = true;
            }
        }
        fn visit_function(
            &mut self,
            _it: &oxc_ast::ast::Function<'b>,
            _flags: oxc_syntax::scope::ScopeFlags,
        ) {
        }
        fn visit_arrow_function_expression(
            &mut self,
            _it: &oxc_ast::ast::ArrowFunctionExpression<'b>,
        ) {
        }
    }

    let mut detector = DynamicDetector {
        dynamic: false,
        check_tags,
    };
    // Babel's `path.traverse` starts below the root: a JSX element in root
    // position has its own attributes and children scanned (nested elements
    // still skip) even when tags themselves don't count. With `checkTags` the
    // root check fires first, as in Babel.
    match value {
        Expression::JSXElement(element) => {
            if check_tags {
                return true;
            }
            oxc_ast_visit::walk::walk_jsx_element(&mut detector, element);
        }
        Expression::JSXFragment(fragment) => {
            if check_tags && !fragment.children.is_empty() {
                return true;
            }
            oxc_ast_visit::walk::walk_jsx_fragment(&mut detector, fragment);
        }
        _ => detector.visit_expression(value),
    }
    detector.dynamic
}

/// Test-only recorder for [`Classify::is_dynamic`] decisions, keyed by the
/// expression's source span. The classification-trace harness below runs the
/// same source through every generate and asserts the *decisions* agree —
/// mode output can differ, classification cannot.
#[cfg(test)]
pub(crate) mod trace {
    use std::cell::RefCell;

    /// `(span_start, span_end, check_tags)` → the question asked.
    pub(crate) type Question = (u32, u32, bool);

    thread_local! {
        static TRACE: RefCell<Option<Vec<(Question, bool)>>> = const { RefCell::new(None) };
    }

    pub(crate) fn record(span: oxc_span::Span, check_tags: bool, dynamic: bool) {
        TRACE.with(|trace| {
            if let Some(decisions) = trace.borrow_mut().as_mut() {
                decisions.push(((span.start, span.end, check_tags), dynamic));
            }
        });
    }

    pub(crate) fn capture<T>(run: impl FnOnce() -> T) -> (T, Vec<(Question, bool)>) {
        TRACE.with(|trace| *trace.borrow_mut() = Some(Vec::new()));
        let result = run();
        let decisions = TRACE.with(|trace| trace.borrow_mut().take().unwrap_or_default());
        (result, decisions)
    }
}

/// The classification-trace harness: every generate must answer every shared
/// classification question identically for the same source. Emission differs
/// per mode; `Classify` decisions may not. A failure here means a call site
/// drifted (wrong `leading_from`/`check_tags`, or a mode re-deriving
/// classification on a rewritten expression).
#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::trace::{Question, capture};
    use crate::{CompileOptions, Generate};

    const MODES: [(&str, Generate); 3] = [
        ("dom", Generate::Dom),
        ("ssr", Generate::Ssr),
        ("universal", Generate::Universal),
    ];

    fn classify_decisions(source: &str, generate: Generate) -> BTreeMap<Question, Vec<bool>> {
        let options = CompileOptions {
            filename: Some("classify-trace.jsx".into()),
            module_name: "r-test".into(),
            generate,
            wrap_conditionals: true,
            built_ins: vec!["For".into(), "Show".into()],
            ..Default::default()
        };
        let (result, decisions) = capture(|| crate::compile(source, &options));
        result.unwrap_or_else(|error| panic!("{generate:?} failed on {source:?}: {error}"));
        let mut answers: BTreeMap<Question, Vec<bool>> = BTreeMap::new();
        for (question, dynamic) in decisions {
            let slot = answers.entry(question).or_default();
            if !slot.contains(&dynamic) {
                slot.push(dynamic);
            }
        }
        answers
    }

    #[test]
    fn all_generates_agree_on_classification() {
        // Union of the traversal-level surfaces: child holes, spread
        // children, component props and spreads, condition branches, static
        // markers, and the namespace-import carve-out.
        let corpus = [
            "const a = <div>{x}</div>;",
            "const a = <div>{x()}</div>;",
            "const a = <div>{x.y}</div>;",
            "const a = <div>{/*@static*/ x()}</div>;",
            "const a = <div a={x()} b={x.y} c={/*@static*/ x()} d=\"s\">{y}</div>;",
            "const a = <div>{cond() ? <b /> : y()}</div>;",
            "const a = <div>{cond() ? /*@static*/ x() : y()}</div>;",
            "const a = <div>{cond() && <span>{x()}</span>}</div>;",
            "const a = <>{x()}<span>{y.z}</span>{'t'}</>;",
            "const a = <>{...items()}</>;",
            "const a = <>{...items}</>;",
            "const a = <div>{...items()}</div>;",
            "const a = <Comp p={x()} q={x.y} r={/*@static*/ x()}>{y()}</Comp>;",
            "const a = <Comp {...props()} other={1} />;",
            "const a = <Comp {...{ a: <div>hi</div> }} />;",
            "const a = <Comp when={a() ? <b /> : <c />} />;",
            "const a = <Comp>{...items()}</Comp>;",
            "const a = <div {...spread()} {...stat} />;",
            "import * as ns from './m';\nconst a = <div a={ns.x}>{ns.y}{ns[k()]}</div>;",
            "import * as ns from './m';\nconst a = <Comp p={ns.x}>{ns.y}</Comp>;",
            "import * as ns from './m';\nconst a = <>{...ns.list}</>;",
            "const a = <div>{'a' in b}</div>;",
            "const a = <div>{tag`t${x}`}</div>;",
            "const a = <div>{() => x()}</div>;",
            "const a = <For each={list()}>{item => <span>{item.name}</span>}</For>;",
        ];

        let mut failures = Vec::new();
        let mut compared = 0usize;
        for source in corpus {
            let per_mode: Vec<(&str, BTreeMap<Question, Vec<bool>>)> = MODES
                .iter()
                .map(|(name, generate)| (*name, classify_decisions(source, *generate)))
                .collect();
            for (mode, answers) in &per_mode {
                assert!(
                    !answers.is_empty(),
                    "{mode} recorded no classification decisions for {source:?}"
                );
                for ((start, end, check_tags), values) in answers {
                    if values.len() > 1 {
                        failures.push(format!(
                            "{mode} self-conflicts on {:?} (checkTags={check_tags}) in {source:?}",
                            &source[*start as usize..*end as usize]
                        ));
                    }
                }
            }
            for (index, (mode_a, answers_a)) in per_mode.iter().enumerate() {
                for (mode_b, answers_b) in per_mode.iter().skip(index + 1) {
                    for (question, values_a) in answers_a {
                        let Some(values_b) = answers_b.get(question) else {
                            continue;
                        };
                        compared += 1;
                        if values_a != values_b {
                            let (start, end, check_tags) = question;
                            failures.push(format!(
                                "{mode_a}={values_a:?} vs {mode_b}={values_b:?} on {:?} (checkTags={check_tags}) in {source:?}",
                                &source[*start as usize..*end as usize]
                            ));
                        }
                    }
                }
            }
        }
        assert!(
            compared >= corpus.len(),
            "harness is vacuous: only {compared} shared classification questions compared"
        );
        assert!(
            failures.is_empty(),
            "classification drift between generates:\n{}",
            failures.join("\n")
        );
    }
}
