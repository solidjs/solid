use crate::error::{Error, Result};
use oxc_ast::ast::{Expression, JSXElementName, JSXMemberExpression, JSXMemberExpressionObject};
use oxc_span::Span;

use crate::shared::ast_builder::AstBuilder;
use crate::shared::utils::is_identifier_key;

/// Target-neutral hooks required to lower a component callee (the `Foo` in
/// `<Foo />`) into an `Expression`. DOM, SSR, and universal share the traversal
/// below and only differ in how built-in components are aliased and whether a
/// `this`-based callee is captured or rejected.
pub(crate) trait ComponentCalleeContext<'a> {
    fn ast(&self) -> AstBuilder<'a>;
    fn is_built_in(&self, name: &str) -> bool;
    fn register_built_in(&mut self, name: &str);
    /// Babel only aliases a built-in when `!path.scope.hasBinding(name)` —
    /// a binding anywhere in the tag's scope chain wins. Resolved by the
    /// scope-aware pre-scan, keyed by the tag identifier's span.
    fn is_builtin_shadowed(&self, span: Span) -> bool;
    fn capture_this_callee(&mut self, span: Span) -> Result<Expression<'a>>;
}

/// `root_tag`: Babel's `transformThis` uses `path.traverse`, which skips the
/// root JSX element itself — a `this` in the root element's tag name stays a
/// raw `this` expression; only descendant tags use the `_self$` capture.
pub(crate) fn component_callee_expression<'a, C: ComponentCalleeContext<'a>>(
    ctx: &mut C,
    name: &JSXElementName<'a>,
    root_tag: bool,
) -> Result<Expression<'a>> {
    match name {
        JSXElementName::Identifier(identifier) => Ok(component_identifier_expression(
            ctx,
            &identifier.name,
            identifier.span,
        )),
        JSXElementName::IdentifierReference(identifier) => Ok(component_identifier_expression(
            ctx,
            &identifier.name,
            identifier.span,
        )),
        JSXElementName::MemberExpression(member) => {
            component_member_expression(ctx, member, root_tag)
        }
        JSXElementName::ThisExpression(this) => {
            if root_tag {
                Ok(ctx.ast().expression_this(this.span))
            } else {
                ctx.capture_this_callee(this.span)
            }
        }
        JSXElementName::NamespacedName(_) => Err(Error::from_reason(
            "Namespaced component callees are not implemented in the AST-native milestone yet",
        )),
    }
}

fn component_member_expression<'a, C: ComponentCalleeContext<'a>>(
    ctx: &mut C,
    member: &JSXMemberExpression<'a>,
    root_tag: bool,
) -> Result<Expression<'a>> {
    let object = match &member.object {
        // Babel's built-in aliasing only fires on plain identifier tags
        // (`t.isIdentifier(tagId)`); the object of a member-expression tag
        // like `<For.Item>` always stays a raw identifier.
        JSXMemberExpressionObject::IdentifierReference(identifier) => ctx
            .ast()
            .expression_identifier(Span::new(0, 0), ctx.ast().ident(&identifier.name)),
        JSXMemberExpressionObject::MemberExpression(member) => {
            component_member_expression(ctx, member, root_tag)?
        }
        JSXMemberExpressionObject::ThisExpression(this) => {
            if root_tag {
                ctx.ast().expression_this(this.span)
            } else {
                ctx.capture_this_callee(this.span)?
            }
        }
    };
    Ok(member_property_expression(
        ctx,
        member.span,
        object,
        &member.property.name,
    ))
}

fn member_property_expression<'a, C: ComponentCalleeContext<'a>>(
    ctx: &C,
    span: Span,
    object: Expression<'a>,
    property: &str,
) -> Expression<'a> {
    if is_identifier_key(property) {
        Expression::StaticMemberExpression(ctx.ast().alloc_static_member_expression(
            span,
            object,
            ctx.ast().identifier_name(span, ctx.ast().ident(property)),
            false,
        ))
    } else {
        Expression::ComputedMemberExpression(
            ctx.ast().alloc_computed_member_expression(
                span,
                object,
                ctx.ast()
                    .expression_string_literal(span, ctx.ast().str(property), None),
                false,
            ),
        )
    }
}

fn component_identifier_expression<'a, C: ComponentCalleeContext<'a>>(
    ctx: &mut C,
    component: &str,
    span: Span,
) -> Expression<'a> {
    let name = if ctx.is_built_in(component) && !ctx.is_builtin_shadowed(span) {
        ctx.register_built_in(component);
        format!("_${component}")
    } else {
        component.to_string()
    };
    ctx.ast()
        .expression_identifier(Span::new(0, 0), ctx.ast().ident(&name))
}
