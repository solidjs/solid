//! The single component-children implementation, mirroring the Babel
//! plugin's `transformComponentChildren` (`shared/component.ts`): one
//! traversal shared by the client generates, with per-mode emission behind
//! [`ModeLower`] / [`ComponentChildLower`].

use crate::error::Result;
use oxc_allocator::CloneIn;
use oxc_ast::ast::{
    CommentPosition, Expression, JSXChild, JSXElement, JSXExpression, Program, Statement,
};
use oxc_ast_visit::{Visit, walk};
use oxc_span::{GetSpan, Span};
use std::cell::RefCell;
use std::collections::HashMap;

use crate::shared::array::expression_to_array_element;
use crate::shared::ast::arrow_return_expression;
use crate::shared::classify::jsx_text_is_filtered;
use crate::shared::condition::{is_condition_shape, transform_condition_inline};
use crate::shared::fragment::lower_fragment;
use crate::shared::mode_lower::{ModeLower, mode_ast};
use crate::shared::classify::is_dynamic_deep;
use crate::shared::utils::{
    coverage_ignore_block_comments, decode_html_entities, is_component_name, trim_jsx_text,
};

// Component element start → pragma anchor, for a pragma written immediately
// before that component (including through a transparent fragment). Filled by
// `anchor_coverage_pragmas`, read when the component builds its `children`
// getter (#2138).
thread_local! {
    static INCOMING_COVERAGE_PRAGMAS: RefCell<HashMap<u32, Span>> = RefCell::new(HashMap::new());
}

/// The extra seam component children need beyond [`ModeLower`]: element
/// children keep their setup statements (template declarations + operations)
/// separate so the caller can host them in the `children` getter.
pub(crate) trait ComponentChildLower<'a>: ModeLower<'a> {
    fn lower_child_element_with_setup(
        &mut self,
        element: &JSXElement<'a>,
    ) -> Result<(Expression<'a>, std::vec::Vec<Statement<'a>>)>;
}

pub(crate) struct ComponentChildren<'a> {
    pub(crate) value: Expression<'a>,
    pub(crate) needs_getter: bool,
    pub(crate) setup: std::vec::Vec<Statement<'a>>,
    /// Where the authored coverage pragmas are anchored; see
    /// [`anchor_coverage_pragmas`].
    pub(crate) coverage_pragma_span: Option<Span>,
}

enum ChildKind {
    /// Text or a non-dynamic expression: never wrapped.
    Static,
    /// A dynamic expression container or spread: memo-wrapped in arrays,
    /// getter-hosted when it is the only child.
    DynamicExpression,
    /// A JSX element or component: dynamic (getter-hosted), but never
    /// memo-wrapped — element setup folds into a per-entry IIFE in arrays.
    Element,
}

struct ChildValue<'a> {
    value: Expression<'a>,
    kind: ChildKind,
    /// Setup statements for native element children (template declarations +
    /// operations). Hoisted into the getter for a single child, folded into a
    /// per-child IIFE inside multi-child arrays — matching Babel, where each
    /// array entry is its own `(() => { ... })()`.
    setup: std::vec::Vec<Statement<'a>>,
}

pub(crate) fn component_children<'a, C: ComponentChildLower<'a>>(
    ctx: &mut C,
    element: &JSXElement<'a>,
) -> Result<Option<ComponentChildren<'a>>> {
    let children = &element.children;
    let allocator = ctx.condition_allocator();
    let ast = mode_ast(ctx);
    let coverage_pragma_span =
        coverage_pragma_span_for(element.span.start, children, ctx.source());
    let mut values = std::vec::Vec::new();
    for child in children.iter() {
        match child {
            JSXChild::Text(text) => {
                let span = text.span;
                let value = decode_html_entities(&trim_jsx_text(&text.value));
                if !value.is_empty() {
                    values.push(ChildValue {
                        value: ast.expression_string_literal(span, ast.str(&value), None),
                        kind: ChildKind::Static,
                        setup: std::vec::Vec::new(),
                    });
                }
            }
            JSXChild::ExpressionContainer(container) => {
                if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                    continue;
                }
                // Babel's `transformNode` gate for component children:
                // `isDynamic(expr, { checkMember: true, checkTags: true })`
                // on the original (pre-lowered) expression — marker comments
                // and namespace-import members short-circuit inside the
                // shared predicate. JSX inside the value stays raw for the
                // deferred pass.
                let dynamic = container
                    .expression
                    .as_expression()
                    .is_some_and(|expression| {
                        ctx.classify()
                            .is_dynamic(Some(container.span.start), expression, true)
                    });
                let mut value = container.expression.clone_in(allocator).into_expression();
                if dynamic && ctx.wrap_conditionals_enabled() && is_condition_shape(&value) {
                    // `transformCondition(..., true)` — memos collapse inline.
                    value = transform_condition_inline(ctx, container.span, value);
                }
                values.push(ChildValue {
                    value,
                    kind: if dynamic {
                        ChildKind::DynamicExpression
                    } else {
                        ChildKind::Static
                    },
                    setup: std::vec::Vec::new(),
                });
            }
            JSXChild::Element(element) => {
                let (value, setup) = ctx.lower_child_element_with_setup(element)?;
                values.push(ChildValue {
                    value,
                    kind: ChildKind::Element,
                    setup,
                });
            }
            JSXChild::Spread(spread) => {
                let value = spread.expression.clone_in(allocator);
                let dynamic = ctx.classify().is_dynamic(None, &value, false);
                values.push(ChildValue {
                    value,
                    kind: if dynamic {
                        ChildKind::DynamicExpression
                    } else {
                        ChildKind::Static
                    },
                    setup: std::vec::Vec::new(),
                });
            }
            JSXChild::Fragment(fragment) => {
                // Babel routes fragment children through `transformNode` →
                // `transformFragmentChildren`, then treats the result like an
                // element child (getter-hosted, never memo-wrapped). A
                // fragment lowering to a single setup IIFE splits back into
                // setup + value so the single-child getter inlines its body
                // (Babel's zero-arg callee unwrap in
                // `transformComponentChildren`); arrays re-fold the setup into
                // a per-entry IIFE, reproducing the original shape.
                let value = lower_fragment(ctx, fragment)?;
                let (value, setup) = crate::shared::ast::split_zero_arg_iife(allocator, value);
                values.push(ChildValue {
                    value,
                    kind: ChildKind::Element,
                    setup,
                });
            }
        }
    }

    Ok(match values.len() {
        0 => None,
        1 => {
            let child = values.pop().expect("component child exists");
            Some(ComponentChildren {
                value: child.value,
                needs_getter: !matches!(child.kind, ChildKind::Static),
                setup: child.setup,
                coverage_pragma_span,
            })
        }
        _ => {
            let span = children
                .first()
                .map_or_else(|| oxc_span::Span::new(0, 0), JSXChild::span);
            let elements = values
                .into_iter()
                .map(|child| {
                    let span = child.value.span();
                    // Element children keep their setup in a per-entry IIFE;
                    // dynamic expression children are memo-wrapped
                    // (`createTemplate(wrap: true)` with an arrow thunk —
                    // component children never use the bare-callee unwrap).
                    let value = if !child.setup.is_empty() {
                        let mut statements = ast.vec();
                        statements.extend(child.setup);
                        statements.push(ast.statement_return(span, Some(child.value)));
                        let iife = crate::shared::ast::arrow_iife(allocator, span, statements);
                        ast.expression_call(span, iife, None, ast.vec(), false)
                    } else if matches!(child.kind, ChildKind::DynamicExpression) {
                        let thunk = arrow_return_expression(allocator, span, child.value);
                        ctx.memo_wrap_dynamic_child(span, thunk)
                    } else {
                        child.value
                    };
                    expression_to_array_element(value)
                })
                .collect::<std::vec::Vec<_>>();
            Some(ComponentChildren {
                value: ast.expression_array(span, ast.vec_from_iter(elements)),
                needs_getter: true,
                setup: std::vec::Vec::new(),
                coverage_pragma_span,
            })
        }
    })
}

/// Where a run of coverage pragmas belongs after Babel's `filterChildren`
/// hand-off (#2138): this element's `children` getter, or a nested component
/// that the pragmas sit immediately before (fragments are transparent).
/// Nested components without a `children` getter cannot host the pragma —
/// fall back to the parent (#4701).
enum CoverageHandoff {
    Parent(std::vec::Vec<Span>),
    ToComponent {
        element_start: u32,
        pragmas: std::vec::Vec<Span>,
    },
}

fn coverage_handoff(children: &[JSXChild<'_>], source: &str) -> Option<CoverageHandoff> {
    let mut pending = std::vec::Vec::new();
    for child in children {
        match child {
            JSXChild::ExpressionContainer(container)
                if matches!(container.expression, JSXExpression::EmptyExpression(_)) =>
            {
                pending.extend(coverage_ignore_block_comments(source, container.span));
            }
            JSXChild::Text(text) if jsx_text_is_filtered(&text.value) => {}
            JSXChild::Fragment(fragment) if pending.is_empty() => {
                // Transparent: pragmas inside the fragment lead the parent's
                // getter or a nested component, same as Babel.
                return coverage_handoff(&fragment.children, source);
            }
            JSXChild::Element(element) if !pending.is_empty() => {
                return Some(
                    if is_component_name(&element.opening_element.name)
                        && nested_component_has_children_getter(element, source)
                    {
                        CoverageHandoff::ToComponent {
                            element_start: element.span.start,
                            pragmas: pending,
                        }
                    } else {
                        CoverageHandoff::Parent(pending)
                    },
                );
            }
            _ if !pending.is_empty() => return Some(CoverageHandoff::Parent(pending)),
            _ => {}
        }
    }
    None
}

/// Mirror of `component_children`'s `needs_getter` for a nested component,
/// without running the full lower — used so a hand-off is not aimed at a
/// getter that will never be emitted (#4701).
///
/// Prefer false when unsure: a Parent fallback keeps the pragma visible;
/// ToComponent without a getter drops it. Namespace-import members need
/// bindings we do not have at anchor time, so member expressions alone are
/// treated as dynamic (same as `is_dynamic_deep`).
fn nested_component_has_children_getter(element: &JSXElement<'_>, source: &str) -> bool {
    let mut kinds = std::vec::Vec::new();
    for child in element.children.iter() {
        match child {
            JSXChild::Text(text) => {
                let value = decode_html_entities(&trim_jsx_text(&text.value));
                if !value.is_empty() {
                    kinds.push(false);
                }
            }
            JSXChild::ExpressionContainer(container) => {
                if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                    continue;
                }
                let dynamic = container.expression.as_expression().is_some_and(|expression| {
                    // Match Classify's default `/*@static*/` leading-comment gate.
                    let from = container.span.start as usize;
                    let to = expression.span().start as usize;
                    let marked_static = source
                        .get(from..to)
                        .is_some_and(|slice| slice.contains("@static"));
                    !marked_static && is_dynamic_deep(expression, true)
                });
                kinds.push(dynamic);
            }
            JSXChild::Element(_) | JSXChild::Fragment(_) => kinds.push(true),
            JSXChild::Spread(spread) => kinds.push(is_dynamic_deep(&spread.expression, false)),
        }
    }
    match kinds.as_slice() {
        [] => false,
        [only] => *only,
        _ => true,
    }
}

fn handoff_pragmas(handoff: &CoverageHandoff) -> &[Span] {
    match handoff {
        CoverageHandoff::Parent(pragmas) | CoverageHandoff::ToComponent { pragmas, .. } => {
            pragmas
        }
    }
}

/// The span the `children` getter takes so codegen prints the authored
/// pragmas ahead of it: the first pragma's own start, which
/// [`anchor_coverage_pragmas`] attaches every pragma of the run to.
/// Pragmas immediately before a nested component are excluded — they belong
/// on that child's getter via [`incoming_coverage_pragma_span`].
pub(crate) fn component_children_coverage_pragma_span(
    children: &[JSXChild<'_>],
    source: &str,
) -> Option<Span> {
    match coverage_handoff(children, source)? {
        CoverageHandoff::Parent(pragmas) => pragmas.first().copied(),
        CoverageHandoff::ToComponent { .. } => None,
    }
}

/// Merge own-children pragmas with a pragma written immediately before this
/// component in a parent (or transparent fragment). Prefer the incoming
/// anchor when both exist — [`anchor_coverage_pragmas`] rebinds own pragmas
/// onto that same span so Babel's concatenation is preserved (#4701).
pub(crate) fn coverage_pragma_span_for(
    element_start: u32,
    children: &[JSXChild<'_>],
    source: &str,
) -> Option<Span> {
    incoming_coverage_pragma_span(element_start)
        .or_else(|| component_children_coverage_pragma_span(children, source))
}

fn incoming_coverage_pragma_span(element_start: u32) -> Option<Span> {
    INCOMING_COVERAGE_PRAGMAS.with(|map| map.borrow().get(&element_start).copied())
}

/// Oxc attaches a comment to the token after it, so each `{/* … */}` pragma
/// hangs off its container's `}` and disappears with the JSX. Re-attach every
/// pragma of a run to the first pragma's start — a position no other node
/// starts at — so only the pragmas print, ahead of the getter spanned there.
pub(crate) fn anchor_coverage_pragmas(program: &mut Program<'_>, source: &str) {
    INCOMING_COVERAGE_PRAGMAS.with(|map| map.borrow_mut().clear());

    struct Collector<'s> {
        source: &'s str,
        anchors: HashMap<u32, u32>,
        incoming: HashMap<u32, Span>,
    }
    impl<'a> Visit<'a> for Collector<'_> {
        fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
            if let Some(handoff) = coverage_handoff(&element.children, self.source) {
                let own_pragmas = handoff_pragmas(&handoff);
                // Stacked incoming + own must share one getter span: prefer the
                // parent hand-off already registered for this element (#4701).
                let anchor_start = self
                    .incoming
                    .get(&element.span.start)
                    .map(|span| span.start)
                    .or_else(|| own_pragmas.first().map(|span| span.start));
                if let Some(anchor_start) = anchor_start {
                    for pragma in own_pragmas {
                        self.anchors.insert(pragma.start, anchor_start);
                    }
                }
                if let CoverageHandoff::ToComponent {
                    element_start,
                    pragmas,
                } = handoff
                    && let Some(anchor) = pragmas.first()
                {
                    self.incoming.insert(element_start, *anchor);
                }
            }
            walk::walk_jsx_element(self, element);
        }
    }

    let mut collector = Collector {
        source,
        anchors: HashMap::new(),
        incoming: HashMap::new(),
    };
    collector.visit_program(program);
    INCOMING_COVERAGE_PRAGMAS.with(|map| *map.borrow_mut() = collector.incoming);
    if collector.anchors.is_empty() {
        return;
    }
    for comment in program.comments.iter_mut() {
        if let Some(&anchor) = collector.anchors.get(&comment.span.start) {
            comment.attached_to = anchor;
            comment.position = CommentPosition::Leading;
        }
    }
}
