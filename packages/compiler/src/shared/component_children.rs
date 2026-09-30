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
use std::collections::HashMap;

use crate::shared::array::expression_to_array_element;
use crate::shared::ast::arrow_return_expression;
use crate::shared::classify::jsx_text_is_filtered;
use crate::shared::condition::{is_condition_shape, transform_condition_inline};
use crate::shared::fragment::lower_fragment;
use crate::shared::mode_lower::{ModeLower, mode_ast};
use crate::shared::utils::{coverage_ignore_block_comments, decode_html_entities, trim_jsx_text};

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
    children: &[JSXChild<'a>],
) -> Result<Option<ComponentChildren<'a>>> {
    let allocator = ctx.condition_allocator();
    let ast = mode_ast(ctx);
    let coverage_pragma_span = component_children_coverage_pragma_span(children, ctx.source());
    let mut values = std::vec::Vec::new();
    for child in children {
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

/// Babel's `filterChildren` hand-off: coverage pragmas in empty expression
/// containers accumulate until the next child that survives the filter, and
/// the first such child's pragmas lead the `children` getter — whatever kind
/// of child it is.
fn component_children_coverage_pragmas(
    children: &[JSXChild<'_>],
    source: &str,
) -> std::vec::Vec<Span> {
    let mut pending = std::vec::Vec::new();
    for child in children {
        match child {
            JSXChild::ExpressionContainer(container)
                if matches!(container.expression, JSXExpression::EmptyExpression(_)) =>
            {
                pending.extend(coverage_ignore_block_comments(source, container.span));
            }
            JSXChild::Text(text) if jsx_text_is_filtered(&text.value) => {}
            _ if !pending.is_empty() => return pending,
            _ => {}
        }
    }
    std::vec::Vec::new()
}

/// The span the `children` getter takes so codegen prints the authored
/// pragmas ahead of it: the first pragma's own start, which
/// [`anchor_coverage_pragmas`] attaches every pragma of the run to.
pub(crate) fn component_children_coverage_pragma_span(
    children: &[JSXChild<'_>],
    source: &str,
) -> Option<Span> {
    component_children_coverage_pragmas(children, source)
        .first()
        .copied()
}

/// Oxc attaches a comment to the token after it, so each `{/* … */}` pragma
/// hangs off its container's `}` and disappears with the JSX. Re-attach every
/// pragma of a run to the first pragma's start — a position no other node
/// starts at — so only the pragmas print, ahead of the getter spanned there.
pub(crate) fn anchor_coverage_pragmas(program: &mut Program<'_>, source: &str) {
    struct Collector<'s> {
        source: &'s str,
        anchors: HashMap<u32, u32>,
    }
    impl<'a> Visit<'a> for Collector<'_> {
        fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
            let pragmas = component_children_coverage_pragmas(&element.children, self.source);
            if let Some(anchor) = pragmas.first() {
                for pragma in &pragmas {
                    self.anchors.insert(pragma.start, anchor.start);
                }
            }
            walk::walk_jsx_element(self, element);
        }
    }

    let mut collector = Collector {
        source,
        anchors: HashMap::new(),
    };
    collector.visit_program(program);
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
