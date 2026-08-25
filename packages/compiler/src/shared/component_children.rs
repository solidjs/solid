//! The single component-children implementation, mirroring the Babel
//! plugin's `transformComponentChildren` (`shared/component.ts`): one
//! traversal shared by the client generates, with per-mode emission behind
//! [`ModeLower`] / [`ComponentChildLower`].

use crate::error::Result;
use oxc_allocator::CloneIn;
use oxc_ast::ast::{Expression, JSXChild, JSXElement, JSXExpression, Statement};
use oxc_span::GetSpan;

use crate::shared::array::expression_to_array_element;
use crate::shared::ast::arrow_return_expression;
use crate::shared::condition::{is_condition_shape, transform_condition_inline};
use crate::shared::fragment::lower_fragment;
use crate::shared::mode_lower::{ModeLower, mode_ast};
use crate::shared::utils::{decode_html_entities, trim_jsx_text};

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
            })
        }
    })
}
