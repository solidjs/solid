//! The single fragment-lowering implementation, mirroring the Babel plugin's
//! `shared/fragment.ts` (`transformFragmentChildren`): one traversal shared
//! by every generate, with per-mode emission behind [`ModeLower`].

use crate::error::Result;
use oxc_allocator::CloneIn;
use oxc_ast::ast::{Expression, JSXChild, JSXExpression, JSXFragment};

use crate::shared::array::expression_to_array_element;
use crate::shared::ast::arrow_return_expression;
use crate::shared::mode_lower::{ModeLower, dynamic_child_thunk, mode_ast};
use crate::shared::utils::{decode_html_entities, trim_jsx_text};

pub(crate) fn lower_fragment<'a, C: ModeLower<'a>>(
    ctx: &mut C,
    fragment: &JSXFragment<'a>,
) -> Result<Expression<'a>> {
    let allocator = ctx.condition_allocator();
    let ast = mode_ast(ctx);
    let mut values = std::vec::Vec::new();
    for child in &fragment.children {
        match child {
            JSXChild::Text(text) => {
                let value = decode_html_entities(&trim_jsx_text(&text.value));
                if !value.is_empty() {
                    values.push(ast.expression_string_literal(text.span, ast.str(&value), None));
                }
            }
            JSXChild::ExpressionContainer(container) => {
                if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                    continue;
                }
                // Babel gates fragment-child wrapping on
                // `isDynamic(expr, { checkMember: true })` of the original
                // (pre-lowered) expression — JSX tags don't count in fragment
                // position; marker comments and namespace-import members
                // short-circuit inside the shared predicate. JSX inside the
                // hole stays raw for the deferred pass.
                let expression = container.expression.clone_in(allocator).into_expression();
                let dynamic =
                    ctx.classify()
                        .is_dynamic(Some(container.span.start), &expression, false);
                if !dynamic {
                    values.push(expression);
                    continue;
                }
                let thunk = dynamic_child_thunk(ctx, container.span, expression);
                values.push(ctx.memo_wrap_dynamic_child(container.span, thunk));
            }
            JSXChild::Element(element) => {
                values.push(ctx.lower_child_element(element)?);
            }
            JSXChild::Fragment(fragment) => {
                values.push(lower_fragment(ctx, fragment)?);
            }
            JSXChild::Spread(spread) => {
                // Babel's `JSXSpreadChild` branch of `transformNode`: dynamic
                // spreads become an explicit thunk the fragment memo-wraps;
                // static ones pass through raw.
                let expression = spread.expression.clone_in(allocator);
                if !ctx.classify().is_dynamic(None, &expression, false) {
                    values.push(expression);
                    continue;
                }
                let thunk = arrow_return_expression(allocator, spread.span, expression);
                values.push(ctx.memo_wrap_dynamic_child(spread.span, thunk));
            }
        }
    }

    Ok(match values.len() {
        0 => ast.expression_array(fragment.span, ast.vec()),
        1 => values.pop().expect("fragment value exists"),
        _ => ast.expression_array(
            ctx.fragment_array_span(fragment),
            ast.vec_from_iter(values.into_iter().map(expression_to_array_element)),
        ),
    })
}
