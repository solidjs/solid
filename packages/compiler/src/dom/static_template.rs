use crate::error::{Error, Result};
use oxc_ast::ast::{JSXChild, JSXElement, JSXExpression};

use crate::dom::attrs::CloseTagContext;
use crate::dom::element::AstDomTransform;
use crate::shared::utils::{
    element_name, escape_html_text, escape_html_text_expression, is_component_name,
    static_jsx_expression_value, trim_jsx_text,
};

pub(crate) fn lower_static_native_template<'a>(
    ctx: &AstDomTransform<'a, '_>,
    element: &JSXElement<'a>,
    close_context: CloseTagContext,
) -> Result<Option<crate::dom::template::TemplateHtml>> {
    if is_component_name(&element.opening_element.name) {
        return Ok(None);
    }

    let tag_name = element_name(&element.opening_element.name)?;

    // Claim targets (a[href] / form[action]) can't inline into a static
    // subtree — the emitted claimElement call needs an element reference, so
    // they take the dynamic-child path. Descendants are covered by recursion
    // (a child returning None propagates None up).
    if crate::dom::element::is_claim_target(&tag_name, &element.opening_element.attributes) {
        return Ok(None);
    }

    let mut template = crate::dom::template::TemplateHtml::open_tag(&tag_name);

    // Attributes only land in the emitted markup, not the validation variant.
    let Some(children_replacement) = ctx.try_append_planned_static_attributes(
        &element.opening_element.attributes,
        &tag_name,
        &mut template.html,
    )?
    else {
        return Ok(None);
    };

    template.push_both(">");

    if tag_name == "noscript" {
        if ctx.should_close_tag(&tag_name, close_context.clone()) {
            template.html.push_str(&format!("</{tag_name}>"));
        }
        if !crate::shared::utils::is_void_element(&tag_name) {
            template.closed.push_str(&format!("</{tag_name}>"));
        }
        return Ok(Some(template));
    }

    let child_to_be_closed = ctx.child_close_context(&tag_name, close_context.clone());
    // The textarea `value` fold replaces the element's children with a
    // single synthesized child.
    let children: &[JSXChild<'a>] = match &children_replacement {
        Some(child) => std::slice::from_ref(child),
        None => &element.children,
    };
    let last_element = ctx.find_last_element(children);
    for (index, child) in children.iter().enumerate() {
        match child {
            JSXChild::Text(text) => {
                let text = trim_jsx_text(&text.value);
                if !text.is_empty() {
                    template.push_both(&escape_html_text(&text));
                }
            }
            JSXChild::ExpressionContainer(container) => {
                if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                    continue;
                }
                let value = ctx
                    .static_jsx_expression_value(&container.expression)
                    .or_else(|| static_jsx_expression_value(&container.expression));
                let Some(value) = value else {
                    return Ok(None);
                };
                template.push_both(&escape_html_text_expression(&value));
            }
            JSXChild::Element(child) => {
                // Cross-renderer nesting errors even in fully static subtrees
                // (Babel routes the child through the other renderer's
                // transform first, then throws in `transformChildren`).
                if ctx.is_foreign_element(child) {
                    let child_tag = element_name(&child.opening_element.name)?;
                    return Err(Error::from_reason(format!(
                        "<{child_tag}> is not supported in <{tag_name}>.\n      Wrap the usage with a component that would render this element, eg. Canvas"
                    )));
                }
                let Some(child_template) = lower_static_native_template(
                    ctx,
                    child,
                    CloseTagContext {
                        last_element: Some(index) == last_element,
                        to_be_closed: child_to_be_closed.clone(),
                    },
                )?
                else {
                    return Ok(None);
                };
                template.append(child_template);
            }
            _ => return Ok(None),
        }
    }

    if ctx.should_close_tag(&tag_name, close_context) {
        template.html.push_str(&format!("</{tag_name}>"));
    }
    if !crate::shared::utils::is_void_element(&tag_name) {
        template.closed.push_str(&format!("</{tag_name}>"));
    }

    Ok(Some(template))
}
