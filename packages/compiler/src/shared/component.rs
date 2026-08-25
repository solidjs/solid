//! The single component-transformation prop loop for the client generates,
//! mirroring the Babel plugin's `transformComponent` (`shared/component.ts`):
//! one traversal with per-mode emission behind [`ComponentLower`].

use crate::error::{Error, Result};
use oxc_allocator::CloneIn;
use oxc_ast::ast::{
    Expression, JSXAttributeItem, JSXAttributeValue, JSXElement, ObjectPropertyKind, Statement,
};
use oxc_span::{GetSpan, Span};

use crate::dom::element::AstDomTransform;
use crate::shared::ast_builder::AstBuilder;
use crate::shared::component_callee::{ComponentCalleeContext, component_callee_expression};
use crate::shared::component_children::{ComponentChildLower, component_children};
use crate::shared::component_props::{
    ComponentPropContext, component_property, component_props_expression,
    component_spread_expression, flush_component_props,
};
use crate::shared::condition::{is_condition_shape, transform_condition_inline};
use crate::shared::mode_lower::mode_ast;
use crate::shared::refs::component_ref_property;
use crate::shared::utils::decode_html_entities;

/// The per-mode seams of the component prop loop beyond the children and
/// prop-emission contexts: helper-usage bookkeeping, root-tag detection, and
/// the mode's ref-prop lowering.
pub(crate) trait ComponentLower<'a>:
    ComponentChildLower<'a> + ComponentPropContext<'a> + ComponentCalleeContext<'a>
{
    /// Marks the `createComponent` helper as used.
    fn mark_create_component(&mut self);
    /// Whether this element is the JSX root currently being lowered (Babel
    /// keeps a raw `this` in the root tag callee).
    fn is_jsx_root_tag(&self, span: Span) -> bool;
    /// Lowers a `ref` prop; setup statements (`var _ref$ = ...`) accumulate
    /// into the surrounding component IIFE.
    fn component_ref_prop(
        &mut self,
        span: Span,
        value: Expression<'a>,
        setup: &mut std::vec::Vec<Statement<'a>>,
    ) -> Option<ObjectPropertyKind<'a>>;
}

pub(crate) fn lower_component_with_setup<'a, C: ComponentLower<'a>>(
    ctx: &mut C,
    element: &JSXElement<'a>,
) -> Result<(Expression<'a>, std::vec::Vec<Statement<'a>>)> {
    let allocator = ctx.condition_allocator();
    let ast = mode_ast(ctx);
    ctx.mark_create_component();
    let root_tag = ctx.is_jsx_root_tag(element.span);
    let component = component_callee_expression(ctx, &element.opening_element.name, root_tag)?;
    let mut prop_objects = std::vec::Vec::new();
    let mut running_props = std::vec::Vec::new();
    let mut force_merge_props = false;
    let mut setup = std::vec::Vec::new();

    for attr in &element.opening_element.attributes {
        let attr = match attr {
            JSXAttributeItem::Attribute(attr) => attr,
            JSXAttributeItem::SpreadAttribute(spread) => {
                flush_component_props(ctx, &mut running_props, &mut prop_objects, element.span);
                let spread = component_spread_expression(ctx, &spread.argument, spread.span);
                force_merge_props = force_merge_props || spread.force_merge;
                prop_objects.push(spread.value);
                continue;
            }
        };
        // Namespaced attributes pass through as literal `ns:name` prop keys
        // (Babel's `convertJSXIdentifier` string form).
        let name = match &attr.name {
            oxc_ast::ast::JSXAttributeName::Identifier(name) => name.name.to_string(),
            oxc_ast::ast::JSXAttributeName::NamespacedName(name) => {
                format!("{}:{}", name.namespace.name, name.name.name)
            }
        };
        let (value, needs_getter, condition_inlined) = match &attr.value {
            None => (
                ast.expression_boolean_literal(attr.span, true),
                false,
                false,
            ),
            Some(JSXAttributeValue::StringLiteral(value)) => {
                let span = value.span;
                let value = decode_html_entities(&value.value);
                (
                    ast.expression_string_literal(span, ast.str(&value), None),
                    false,
                    false,
                )
            }
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                let dynamic = component_prop_is_dynamic(ctx, &name, container);
                // JSX inside the value stays raw: Babel builds prop getters
                // around the untransformed expression and its outer traversal
                // lowers the JSX later. `this` was already rewritten by the
                // root-level `transformThis` pass.
                let mut value = container.expression.clone_in(allocator).into_expression();
                // Dynamic conditional/logical props collapse their memos
                // inline within the getter, mirroring Babel's
                // `transformCondition(..., true)`.
                let mut condition_inlined = false;
                if dynamic && ctx.wrap_conditionals_enabled() && is_condition_shape(&value) {
                    let span = value.span();
                    value = transform_condition_inline(ctx, span, value);
                    condition_inlined = true;
                }
                (value, dynamic, condition_inlined)
            }
            _ => {
                return Err(Error::from_reason(
                    "Component JSX attribute values are not implemented in the AST-native milestone yet",
                ));
            }
        };
        if name == "ref" {
            if let Some(ref_property) = ctx.component_ref_prop(attr.span, value, &mut setup) {
                running_props.push(ref_property);
            }
        } else if needs_getter && !condition_inlined {
            // Babel inlines a zero-arg arrow IIFE value's body straight into
            // the getter (`when={(() => {...})()}` → `get when() {...}`).
            match crate::shared::ast::zero_arg_iife_statements(allocator, attr.span, value) {
                Ok(statements) => {
                    running_props.push(crate::shared::ast::object_getter_property_with_statements(
                        allocator, attr.span, &name, statements,
                    ));
                }
                Err(value) => {
                    running_props.push(component_property(ctx, attr.span, &name, value, true));
                }
            }
        } else {
            running_props.push(component_property(
                ctx,
                attr.span,
                &name,
                value,
                needs_getter,
            ));
        }
    }

    let children = component_children(ctx, &element.children)?;
    if let Some(children) = children {
        if children.needs_getter {
            running_props.push(crate::shared::ast::object_getter_property_with_setup(
                allocator,
                element.span,
                "children",
                children.setup,
                children.value,
            ));
        } else {
            running_props.push(ComponentPropContext::object_property(
                ctx,
                element.span,
                "children",
                children.value,
            ));
        }
    }

    flush_component_props(ctx, &mut running_props, &mut prop_objects, element.span);
    let props = component_props_expression(ctx, element.span, prop_objects, force_merge_props);
    Ok((
        ComponentPropContext::call_identifier(
            ctx,
            element.span,
            "_$createComponent",
            vec![component, props],
        ),
        setup,
    ))
}

/// Babel gates component-prop getters on
/// `isDynamic(value, { checkMember: true, checkTags: true })` of the
/// original (pre-lowered) expression — marker comments and namespace-import
/// members short-circuit inside the shared predicate.
fn component_prop_is_dynamic<'a, C: ComponentLower<'a>>(
    ctx: &C,
    name: &str,
    container: &oxc_ast::ast::JSXExpressionContainer<'_>,
) -> bool {
    if name == "ref" {
        return false;
    }
    container
        .expression
        .as_expression()
        .is_some_and(|expression| {
            ctx.classify()
                .is_dynamic(Some(container.span.start), expression, true)
        })
}

impl<'a> ComponentLower<'a> for AstDomTransform<'a, '_> {
    fn mark_create_component(&mut self) {
        self.template_state.uses_create_component = true;
    }

    fn is_jsx_root_tag(&self, span: Span) -> bool {
        self.jsx_root_span == Some(span)
    }

    fn component_ref_prop(
        &mut self,
        span: Span,
        value: Expression<'a>,
        setup: &mut std::vec::Vec<Statement<'a>>,
    ) -> Option<ObjectPropertyKind<'a>> {
        component_ref_property(self, span, value, setup)
    }
}

impl<'a> ComponentCalleeContext<'a> for AstDomTransform<'a, '_> {
    fn ast(&self) -> AstBuilder<'a> {
        self.ast()
    }

    fn is_built_in(&self, name: &str) -> bool {
        self.built_ins.iter().any(|built_in| built_in == name)
    }

    fn is_builtin_shadowed(&self, span: Span) -> bool {
        self.bindings.is_builtin_shadowed(span)
    }

    fn register_built_in(&mut self, name: &str) {
        if !self
            .template_state
            .built_in_imports
            .iter()
            .any(|built_in| built_in == name)
        {
            self.template_state.built_in_imports.push(name.to_string());
        }
    }

    fn capture_this_callee(&mut self, span: Span) -> Result<Expression<'a>> {
        Ok(self.capture_this_expression(span))
    }
}
