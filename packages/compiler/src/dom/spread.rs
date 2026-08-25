use crate::error::{Error, Result};
use oxc_allocator::CloneIn;
use oxc_ast::ast::{JSXAttributeItem, JSXAttributeValue, ObjectPropertyKind, Statement};
use oxc_span::Span;

use crate::dom::element::AstDomTransform;
use crate::shared::ast::arrow_return_expression;
use crate::shared::condition::zero_arg_call_thunk;
use crate::shared::constants::dom_with_state;
use crate::shared::utils::{decode_html_entities, source_from_span};

impl<'a> AstDomTransform<'a, '_> {
    /// Port of Babel's `processSpreads` (dom/element.ts).
    pub(crate) fn spread_attribute_statement(
        &mut self,
        attributes: &[JSXAttributeItem<'a>],
        tag_name: &str,
        element_id: &str,
        skip_children: bool,
    ) -> Result<Statement<'a>> {
        self.template_state.uses_spread = true;
        // A spread may carry delegated event handlers, which can't be known at
        // compile time; hydratable roots must replay events (Babel parity).
        if self.hydratable {
            self.has_hydratable_event = true;
        }
        let mut prop_objects = std::vec::Vec::new();
        let mut running_props = std::vec::Vec::new();
        let mut dynamic_spread = false;
        for attr in attributes {
            match attr {
                JSXAttributeItem::SpreadAttribute(spread) => {
                    if !running_props.is_empty() {
                        prop_objects.push(self.ast().expression_object(
                            spread.span,
                            self.ast().vec_from_iter(running_props.drain(..)),
                        ));
                    }
                    let is_static =
                        source_from_span(spread.span, self.source).contains(&self.static_marker);
                    let dynamic = self.classify().is_dynamic(None, &spread.argument, false);
                    let value = spread.argument.clone_in(self.allocator);
                    let value = if dynamic {
                        dynamic_spread = true;
                        // Babel's `inlineCallExpression`: `{...results()}`
                        // passes `results` straight through to mergeProps.
                        match zero_arg_call_thunk(&value, self.allocator) {
                            Some(callee) => callee,
                            None => arrow_return_expression(self.allocator, spread.span, value),
                        }
                    } else {
                        value
                    };
                    let value = if is_static {
                        let mut properties = self.ast().vec();
                        properties.push(ObjectPropertyKind::SpreadProperty(
                            self.ast().alloc_spread_element(spread.span, value),
                        ));
                        self.ast().expression_object(spread.span, properties)
                    } else {
                        value
                    };
                    prop_objects.push(value);
                }
                JSXAttributeItem::Attribute(attr) => {
                    // Babel's `processSpreads` filters `ref` out of the props
                    // (`key !== "ref"`); it runs through the ref protocol as a
                    // regular attribute instead.
                    if matches!(&attr.name, oxc_ast::ast::JSXAttributeName::Identifier(name) if name.name == "ref")
                    {
                        continue;
                    }
                    running_props.push(self.spread_attribute_property(attr, tag_name)?);
                }
            }
        }
        if !running_props.is_empty() {
            prop_objects.push(self.ast().expression_object(
                Span::default(),
                self.ast().vec_from_iter(running_props.drain(..)),
            ));
        }

        let props = if prop_objects.len() == 1 && !dynamic_spread {
            prop_objects
                .pop()
                .expect("single spread props object exists")
        } else {
            self.template_state.uses_merge_props = true;
            self.call_identifier(Span::default(), "_$mergeProps", prop_objects)
        };

        Ok(self.ast().statement_expression(
            Span::default(),
            self.call_identifier(
                Span::default(),
                "_$spread",
                vec![
                    self.identifier_expression(Span::default(), element_id),
                    props,
                    self.ast()
                        .expression_boolean_literal(Span::default(), skip_children),
                ],
            ),
        ))
    }

    fn spread_attribute_property(
        &mut self,
        attr: &oxc_ast::ast::JSXAttribute<'a>,
        tag_name: &str,
    ) -> Result<ObjectPropertyKind<'a>> {
        let name = match &attr.name {
            oxc_ast::ast::JSXAttributeName::Identifier(name) => name.name.to_string(),
            oxc_ast::ast::JSXAttributeName::NamespacedName(name)
                if name.namespace.name == "prop" =>
            {
                let local_name = name.name.name.to_string();
                if dom_with_state(tag_name, &local_name).is_some() {
                    local_name
                } else {
                    format!("prop:{local_name}")
                }
            }
            oxc_ast::ast::JSXAttributeName::NamespacedName(_) => {
                return Err(Error::from_reason(
                    "Namespaced attributes are not implemented in the AST-native milestone yet",
                ));
            }
        };

        // Babel's no-`inlineStyles` preprocess wraps style values in IIFEs at
        // the JSX level, before spreads are processed — the wrap makes the
        // value a call expression, so it always lands as a getter (and any
        // `/*@static*/` marker is lost with the original node's comments).
        if name == "style" && !self.inline_styles {
            match &attr.value {
                Some(JSXAttributeValue::StringLiteral(value)) => {
                    let planner = self.attr_planner();
                    let text = decode_html_entities(&value.value);
                    let template = planner.style_string_template_literal(attr.span, &text);
                    let wrapped = planner.style_no_inline_iife(attr.span, template);
                    return Ok(self.object_getter_property(attr.span, &name, wrapped));
                }
                Some(JSXAttributeValue::ExpressionContainer(container))
                    if container.expression.as_expression().is_some() =>
                {
                    let value = self.attribute_value_expression(container);
                    let wrapped = self.attr_planner().style_no_inline_iife(attr.span, value);
                    return Ok(self.object_getter_property(attr.span, &name, wrapped));
                }
                _ => {}
            }
        }

        match &attr.value {
            None => Ok(self.object_property(
                attr.span,
                &name,
                self.ast().expression_boolean_literal(attr.span, true),
            )),
            Some(JSXAttributeValue::StringLiteral(value)) => {
                let value = decode_html_entities(&value.value);
                Ok(self.object_property(
                    attr.span,
                    &name,
                    self.ast()
                        .expression_string_literal(attr.span, self.ast().str(&value), None),
                ))
            }
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                let dynamic = container
                    .expression
                    .as_expression()
                    .is_some_and(|expression| {
                        self.classify()
                            .is_dynamic(Some(container.span.start), expression, false)
                    });
                let value = self.attribute_value_expression(container);
                if dynamic {
                    // No condition memo in spread getters (#2959): attribute
                    // values are primitives deduped by assignProp, and the ssr
                    // generate emits the bare expression — a client-only memo
                    // drifts hydration ids.
                    Ok(self.object_getter_property(attr.span, &name, value))
                } else {
                    Ok(self.object_property(attr.span, &name, value))
                }
            }
            Some(JSXAttributeValue::Element(_) | JSXAttributeValue::Fragment(_)) => {
                Err(Error::from_reason(
                    "JSX spread attribute object values are not implemented in the AST-native milestone yet",
                ))
            }
        }
    }
}
