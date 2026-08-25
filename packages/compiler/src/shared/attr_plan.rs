use crate::error::{Error, Result};
use oxc_allocator::{Allocator, CloneIn};
use oxc_ast::ast::{
    ArrayExpressionElement, Expression, FormalParameterKind, JSXAttributeItem, JSXAttributeValue,
    JSXChild, JSXExpression, ObjectPropertyKind, TemplateElementValue,
};
use oxc_span::{GetSpan, SPAN, Span};

use crate::shared::ast_builder::AstBuilder;
use crate::shared::bindings::BindingTable;
use crate::shared::utils::{StaticValue, decode_html_entities, format_number};

/// Planned attribute value, mirroring the states a Babel JSX attribute value
/// moves through during preprocessing (`node.value` replaced by string
/// literals, split into synthetic attributes, ...).
pub(crate) enum PlanValue<'a> {
    None,
    /// A string-serializable value (JSX string literal or a confidently
    /// evaluated expression), ready for template inlining.
    Literal(String),
    /// A raw (unvisited) expression clone.
    Expr(Expression<'a>),
}

/// One planned attribute after Babel's preprocessing passes (dedupe, style
/// merging/splitting, class array/object splitting, class combining).
pub(crate) struct AttrPlan<'a> {
    pub(crate) span: Span,
    pub(crate) key: String,
    pub(crate) value: PlanValue<'a>,
    /// Synthesized from `style={{...}}` splitting (Babel `_styleProperty`).
    pub(crate) style_property: bool,
    /// Synthesized from `class={{...}}` splitting (Babel `_classProperty`).
    pub(crate) class_property: bool,
    /// The value carries the `/*@static*/` marker.
    pub(crate) marker_static: bool,
}

/// Result of the attribute preprocessing pipeline. Babel's
/// `transformSpecialCaseAttributes` can fold a textarea `value` attribute
/// into the element's (replaced) children; the synthesized child travels
/// alongside the plans so each generate can honor it.
pub(crate) struct AttrPlanOutcome<'a> {
    pub(crate) plans: std::vec::Vec<AttrPlan<'a>>,
    /// When set, the element's children are replaced with this single child
    /// (Babel: `path.node.children = [child]`).
    pub(crate) children_replacement: Option<JSXChild<'a>>,
}

/// Confident compile-time value, approximating `path.evaluate()` for the
/// expression shapes the fixtures and real-world templates rely on.
pub(crate) enum ConfidentValue {
    Str(String),
    Num(f64),
    Bool(bool),
    Nullish,
    /// A confident non-primitive (object/array of confident values).
    Object,
}

impl ConfidentValue {
    pub(crate) fn truthy(&self) -> bool {
        match self {
            ConfidentValue::Str(value) => !value.is_empty(),
            ConfidentValue::Num(value) => *value != 0.0 && !value.is_nan(),
            ConfidentValue::Bool(value) => *value,
            ConfidentValue::Nullish => false,
            ConfidentValue::Object => true,
        }
    }

    fn as_template_string(&self) -> Option<String> {
        match self {
            ConfidentValue::Str(value) => Some(value.clone()),
            ConfidentValue::Num(value) => Some(format_number(*value)),
            _ => None,
        }
    }
}

/// Shared attribute preprocessing context, the Rust analogue of Babel's
/// shared `evaluateAndInline` / `transformSpecialCaseAttributes` helpers plus
/// the dom generate's `transformAttributes` preprocessing passes. Each
/// generate builds one from its own state (`is_ssr` selects the SSR branches
/// exactly like Babel's `willBeSSR` flag).
pub(crate) struct AttrPlanner<'a, 'b> {
    pub(crate) allocator: &'a Allocator,
    pub(crate) source: &'b str,
    pub(crate) static_marker: &'b str,
    pub(crate) bindings: &'b BindingTable,
    pub(crate) inline_styles: bool,
    pub(crate) skip_xmlns_attribute: bool,
    pub(crate) is_ssr: bool,
}

impl<'a> AttrPlanner<'a, '_> {
    fn ast(&self) -> AstBuilder<'a> {
        AstBuilder::new(self.allocator)
    }

    /// Approximation of Babel's `path.evaluate()` over the value shapes the
    /// transforms rely on: literals, resolved static bindings, template
    /// literals, `+` concatenation/addition, negation, and confident
    /// object/array literals.
    pub(crate) fn evaluate_confident(&self, expression: &Expression<'a>) -> Option<ConfidentValue> {
        match expression {
            Expression::StringLiteral(value) => Some(ConfidentValue::Str(value.value.to_string())),
            Expression::NumericLiteral(value) => Some(ConfidentValue::Num(value.value)),
            Expression::BooleanLiteral(value) => Some(ConfidentValue::Bool(value.value)),
            Expression::NullLiteral(_) => Some(ConfidentValue::Nullish),
            Expression::Identifier(identifier) => {
                if identifier.name == "undefined" {
                    return Some(ConfidentValue::Nullish);
                }
                if identifier.name == "NaN" {
                    return Some(ConfidentValue::Num(f64::NAN));
                }
                if identifier.name == "Infinity" {
                    return Some(ConfidentValue::Num(f64::INFINITY));
                }
                if let Some(value) = self.bindings.static_value(identifier.name.as_str()) {
                    return Some(match value {
                        StaticValue::String(value) => ConfidentValue::Str(value),
                        StaticValue::Number(value) => ConfidentValue::Num(value),
                    });
                }
                if let Some(value) = self.bindings.static_bool(identifier.name.as_str()) {
                    return Some(ConfidentValue::Bool(value));
                }
                None
            }
            Expression::TemplateLiteral(template) => {
                let mut result = String::new();
                let mut expressions = template.expressions.iter();
                for (index, quasi) in template.quasis.iter().enumerate() {
                    result.push_str(
                        quasi
                            .value
                            .cooked
                            .as_ref()
                            .map(|cooked| cooked.as_str())
                            .unwrap_or(quasi.value.raw.as_str()),
                    );
                    if index < template.quasis.len() - 1 {
                        let expression = expressions.next()?;
                        let value = self.evaluate_confident(expression)?;
                        result.push_str(&value.as_template_string()?);
                    }
                }
                Some(ConfidentValue::Str(result))
            }
            Expression::BinaryExpression(binary) => {
                let left = self.evaluate_confident(&binary.left)?;
                let right = self.evaluate_confident(&binary.right)?;
                use oxc_ast::ast::BinaryOperator;
                match binary.operator {
                    BinaryOperator::Addition => match (&left, &right) {
                        (ConfidentValue::Num(left), ConfidentValue::Num(right)) => {
                            Some(ConfidentValue::Num(left + right))
                        }
                        _ => Some(ConfidentValue::Str(format!(
                            "{}{}",
                            left.as_template_string()?,
                            right.as_template_string()?
                        ))),
                    },
                    BinaryOperator::Subtraction => match (left, right) {
                        (ConfidentValue::Num(left), ConfidentValue::Num(right)) => {
                            Some(ConfidentValue::Num(left - right))
                        }
                        _ => None,
                    },
                    BinaryOperator::Multiplication => match (left, right) {
                        (ConfidentValue::Num(left), ConfidentValue::Num(right)) => {
                            Some(ConfidentValue::Num(left * right))
                        }
                        _ => None,
                    },
                    BinaryOperator::Division => match (left, right) {
                        (ConfidentValue::Num(left), ConfidentValue::Num(right)) => {
                            Some(ConfidentValue::Num(left / right))
                        }
                        _ => None,
                    },
                    _ => None,
                }
            }
            Expression::UnaryExpression(unary) => {
                use oxc_ast::ast::UnaryOperator;
                let value = self.evaluate_confident(&unary.argument)?;
                match unary.operator {
                    UnaryOperator::LogicalNot => Some(ConfidentValue::Bool(!value.truthy())),
                    UnaryOperator::UnaryNegation => match value {
                        ConfidentValue::Num(value) => Some(ConfidentValue::Num(-value)),
                        _ => None,
                    },
                    UnaryOperator::Void => Some(ConfidentValue::Nullish),
                    UnaryOperator::Typeof => Some(ConfidentValue::Str(
                        match (&unary.argument, value) {
                            // Nullish conflates null and undefined; the raw
                            // argument disambiguates `typeof null` ("object")
                            // from `typeof void 0` ("undefined").
                            (Expression::NullLiteral(_), _) => "object",
                            (_, ConfidentValue::Nullish) => "undefined",
                            (_, ConfidentValue::Str(_)) => "string",
                            (_, ConfidentValue::Num(_)) => "number",
                            (_, ConfidentValue::Bool(_)) => "boolean",
                            (_, ConfidentValue::Object) => "object",
                        }
                        .to_string(),
                    )),
                    _ => None,
                }
            }
            Expression::ParenthesizedExpression(inner) => {
                self.evaluate_confident(&inner.expression)
            }
            Expression::ConditionalExpression(conditional) => {
                let test = self.evaluate_confident(&conditional.test)?;
                if test.truthy() {
                    self.evaluate_confident(&conditional.consequent)
                } else {
                    self.evaluate_confident(&conditional.alternate)
                }
            }
            Expression::LogicalExpression(logical) => {
                let left = self.evaluate_confident(&logical.left)?;
                use oxc_ast::ast::LogicalOperator;
                let take_right = match logical.operator {
                    LogicalOperator::Or => !left.truthy(),
                    LogicalOperator::And => left.truthy(),
                    LogicalOperator::Coalesce => matches!(left, ConfidentValue::Nullish),
                };
                if take_right {
                    self.evaluate_confident(&logical.right)
                } else {
                    Some(left)
                }
            }
            Expression::ObjectExpression(object) => {
                for property in &object.properties {
                    let ObjectPropertyKind::ObjectProperty(property) = property else {
                        return None;
                    };
                    if property.computed {
                        let key = property.key.as_expression()?;
                        self.evaluate_confident(key)?;
                    }
                    self.evaluate_confident(&property.value)?;
                }
                Some(ConfidentValue::Object)
            }
            Expression::ArrayExpression(array) => {
                for element in &array.elements {
                    let expression = element.as_expression()?;
                    self.evaluate_confident(expression)?;
                }
                Some(ConfidentValue::Object)
            }
            _ => None,
        }
    }

    /// Port of Babel's `evaluateAndInline`: folds confidently evaluatable
    /// expressions to literals — whole expressions, and object property
    /// values recursively.
    pub(crate) fn fold_confident(&self, expression: &mut Expression<'a>) {
        match expression {
            Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_) => {}
            Expression::ObjectExpression(object) => {
                // Arena AST: rebuild the property list with folded values.
                for property in object.properties.iter_mut() {
                    if let ObjectPropertyKind::ObjectProperty(property) = property {
                        let mut value = property.value.clone_in(self.allocator);
                        self.fold_confident(&mut value);
                        property.value = value;
                    }
                }
            }
            _ => match self.evaluate_confident(expression) {
                Some(ConfidentValue::Str(value)) => {
                    *expression = self.ast().expression_string_literal(
                        expression.span(),
                        self.ast().str(&value),
                        None,
                    );
                }
                Some(ConfidentValue::Num(value)) => {
                    *expression = self.ast().expression_numeric_literal(
                        expression.span(),
                        value,
                        None,
                        oxc_ast::ast::NumberBase::Decimal,
                    );
                }
                Some(ConfidentValue::Bool(value)) => {
                    *expression = self
                        .ast()
                        .expression_boolean_literal(expression.span(), value);
                }
                _ => {}
            },
        }
    }

    /// Whether the configured static marker comment appears between two
    /// source offsets (e.g. between `{` and the expression, or between an
    /// object property's key and its value).
    pub(crate) fn marker_between(&self, start: u32, end: u32) -> bool {
        let start = start as usize;
        let end = (end as usize).min(self.source.len());
        if start >= end {
            return false;
        }
        self.source[start..end].contains(self.static_marker)
    }

    /// Builds the ordered attribute plan for an element without spreads,
    /// porting Babel's preprocessing pipeline: `evaluateAndInline`,
    /// `transformSpecialCaseAttributes`, then dedupe are shared across
    /// generates; the style/class splitting passes belong to the dom generate's
    /// `transformAttributes` and are skipped for SSR (which has its own
    /// style/class serialization at emission time).
    pub(crate) fn plan_attributes(
        &self,
        attributes: &[JSXAttributeItem<'a>],
        tag_name: &str,
    ) -> Result<AttrPlanOutcome<'a>> {
        let mut plans = std::vec::Vec::new();

        for attr in attributes {
            let JSXAttributeItem::Attribute(attr) = attr else {
                return Err(Error::from_reason(
                    "plan_attributes only handles spread-free attribute lists",
                ));
            };
            let key = match &attr.name {
                oxc_ast::ast::JSXAttributeName::Identifier(name) => name.name.to_string(),
                oxc_ast::ast::JSXAttributeName::NamespacedName(name) => {
                    format!("{}:{}", name.namespace.name, name.name.name)
                }
            };
            // `_hk` is the internal hydration-key attribute; the Babel plugin
            // warns and strips it (usually pasted-in SSR output).
            if key == "_hk" {
                continue;
            }
            // `$key` on an intrinsic element is server markup identity (the
            // element-level spelling of the slot-call `$key`): SSR compiles
            // it to the `_key` attribute the frame morph matches keyed
            // elements by; a DOM compile of the same source strips it —
            // client-owned DOM is never morphed, and a literal `$key`
            // attribute is never intended output. (Babel: `renameElementKey`
            // in shared/utils.ts.)
            let key = if key == "$key" {
                if !self.is_ssr {
                    continue;
                }
                "_key".to_string()
            } else {
                key
            };
            // The `xmlns` attribute on template-root XML elements only
            // signals the namespace; it is dropped from the template.
            if key == "xmlns" && self.skip_xmlns_attribute {
                continue;
            }
            let (value, marker_static) = match &attr.value {
                None => (PlanValue::None, false),
                Some(JSXAttributeValue::StringLiteral(value)) => (
                    PlanValue::Literal(decode_html_entities(&value.value)),
                    false,
                ),
                Some(JSXAttributeValue::ExpressionContainer(container)) => {
                    let Some(expression) = container.expression.as_expression() else {
                        // Empty expression containers are dropped.
                        continue;
                    };
                    let marker = self.marker_between(container.span.start, expression.span().start);
                    let mut value = expression.clone_in(self.allocator);
                    self.fold_confident(&mut value);
                    (PlanValue::Expr(value), marker)
                }
                Some(JSXAttributeValue::Element(_) | JSXAttributeValue::Fragment(_)) => {
                    return Err(Error::from_reason(
                        "JSX attribute element values are not implemented in the AST-native milestone yet",
                    ));
                }
            };
            plans.push(AttrPlan {
                span: attr.span,
                key,
                value,
                style_property: false,
                class_property: false,
                marker_static,
            });
        }

        let children_replacement = self.special_case_stateful_plans(tag_name, &mut plans);
        dedupe_plans(&mut plans);
        if !self.is_ssr {
            if !self.inline_styles {
                self.wrap_styles_for_no_inline(&mut plans);
            }
            self.merge_static_styles(&mut plans);
            self.split_style_object(&mut plans);
            self.split_class_array(&mut plans);
            self.split_class_list(&mut plans);
            self.combine_class_attributes(&mut plans);
        }

        Ok(AttrPlanOutcome {
            plans,
            children_replacement,
        })
    }

    /// Port of Babel's `transformSpecialCaseAttributes`: stateful DOM props
    /// (`input.value`, `video.muted`, ...) rename to their inlinable
    /// attribute form when static (or always for SSR, whose HTML output has
    /// no post-parse state to fight), or to `prop:` writes when dynamic.
    /// A default textarea `value` folds into a replacement text/expression
    /// child, since HTML textareas carry their value as content.
    fn special_case_stateful_plans(
        &self,
        tag_name: &str,
        plans: &mut std::vec::Vec<AttrPlan<'a>>,
    ) -> Option<JSXChild<'a>> {
        let upper_tag = tag_name.to_ascii_uppercase();
        let prop_names: &[&str] = match upper_tag.as_str() {
            "INPUT" => &["value", "defaultValue", "checked", "defaultChecked"],
            "SELECT" => &["value"],
            "OPTION" => &["value", "selected", "defaultSelected"],
            "TEXTAREA" => &["value", "defaultValue"],
            "VIDEO" | "AUDIO" => &["muted", "defaultMuted"],
            _ => return None,
        };

        let mut present: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let mut transforms = std::vec::Vec::new();
        for prop in prop_names {
            if let Some(index) = plans.iter().position(|plan| plan.key == *prop) {
                present.insert(*prop);
                transforms.push((*prop, index));
            }
        }

        let mut children_replacement = None;
        let mut removals = std::vec::Vec::new();
        for (prop, index) in transforms {
            let (is_literal, is_null) = match &plans[index].value {
                // A valueless attribute reads as `true`.
                PlanValue::None | PlanValue::Literal(_) => (true, false),
                PlanValue::Expr(expression) => (
                    matches!(
                        expression,
                        Expression::StringLiteral(_)
                            | Expression::NumericLiteral(_)
                            | Expression::BooleanLiteral(_)
                            | Expression::NullLiteral(_)
                    ),
                    matches!(expression, Expression::NullLiteral(_)),
                ),
            };
            let default_key = format!("default{}{}", prop[..1].to_uppercase(), &prop[1..]);
            let is_default = prop.contains("default") || !present.contains(default_key.as_str());
            let default_attr_name = prop.replace("default", "").to_lowercase();

            if is_default
                && upper_tag == "TEXTAREA"
                && default_attr_name == "value"
                && !is_null
                // HTML output needs the text content for SSR; for dynamic DOM
                // the `prop:*` route survives the textarea "dirty" flag.
                && (self.is_ssr || is_literal)
            {
                children_replacement = Some(self.stateful_value_child(&plans[index]));
                removals.push(index);
            } else if is_default && (is_literal || self.is_ssr) {
                if prop != default_attr_name {
                    plans[index].key = default_attr_name;
                }
            } else {
                plans[index].key = format!("prop:{prop}");
            }
        }
        for index in removals.into_iter().rev() {
            plans.remove(index);
        }
        children_replacement
    }

    /// Babel's textarea fold child: a string value becomes a JSX text child,
    /// anything else an expression container (a valueless attribute reads as
    /// `{true}`).
    fn stateful_value_child(&self, plan: &AttrPlan<'a>) -> JSXChild<'a> {
        match &plan.value {
            PlanValue::Literal(text) => {
                let atom = self.ast().str(text);
                self.ast().jsx_child_text(plan.span, atom, Some(atom))
            }
            PlanValue::Expr(expression) => self.ast().jsx_child_expression_container(
                plan.span,
                JSXExpression::from(expression.clone_in(self.allocator)),
            ),
            PlanValue::None => self.ast().jsx_child_expression_container(
                plan.span,
                JSXExpression::from(self.ast().expression_boolean_literal(plan.span, true)),
            ),
        }
    }

    /// Babel's no-`inlineStyles` handling: every `style` value is wrapped in
    /// an IIFE so the later passes skip it and the runtime `style()` helper
    /// receives it whole.
    fn wrap_styles_for_no_inline(&self, plans: &mut [AttrPlan<'a>]) {
        for plan in plans.iter_mut() {
            if plan.key != "style" {
                continue;
            }
            let value = match std::mem::replace(&mut plan.value, PlanValue::None) {
                PlanValue::Literal(text) => {
                    Some(self.style_string_template_literal(plan.span, &text))
                }
                PlanValue::Expr(expression) => Some(expression),
                PlanValue::None => None,
            };
            plan.value = match value {
                Some(expression) => {
                    // The rewrap discards the value's leading comments in
                    // Babel, so a `/*@static*/` marker on a style stops
                    // applying and the IIFE registers as dynamic.
                    plan.marker_static = false;
                    PlanValue::Expr(self.style_no_inline_iife(plan.span, expression))
                }
                None => PlanValue::None,
            };
        }
    }

    /// Babel converts string styles to template literals so a multi-line
    /// string survives the no-`inlineStyles` wrap.
    pub(crate) fn style_string_template_literal(&self, span: Span, text: &str) -> Expression<'a> {
        let raw = self.ast().str(text);
        let quasi = self.ast().template_element_with_lone_surrogates(
            SPAN,
            TemplateElementValue {
                raw,
                cooked: Some(raw),
            },
            true,
            true,
        );
        self.ast()
            .expression_template_literal(span, self.ast().vec1(quasi), self.ast().vec())
    }

    /// `(() => <value>)()`, Babel's no-`inlineStyles` style wrapper.
    pub(crate) fn style_no_inline_iife(&self, span: Span, value: Expression<'a>) -> Expression<'a> {
        let arrow = self.arrow_with_return(span, value);
        self.ast()
            .expression_call(span, arrow, None, self.ast().vec(), false)
    }

    fn arrow_with_return(&self, span: Span, value: Expression<'a>) -> Expression<'a> {
        let statements = self
            .ast()
            .vec1(self.ast().statement_return(span, Some(value)));
        let params = self.ast().formal_parameters(
            span,
            FormalParameterKind::ArrowFormalParameters,
            self.ast().vec(),
            None,
        );
        let body = self.ast().function_body(span, self.ast().vec(), statements);
        self.ast()
            .expression_arrow_function(span, false, false, None, params, None, body)
    }

    /// Inline styles pass: string styles and confidently static object
    /// properties merge into one static `style` attribute appended at the
    /// end; the residual dynamic parts stay in place.
    fn merge_static_styles(&self, plans: &mut std::vec::Vec<AttrPlan<'a>>) {
        if !plans.iter().any(|plan| plan.key == "style") {
            return;
        }
        let mut inlined_style = String::new();
        let mut index = 0;
        while index < plans.len() {
            if plans[index].key != "style" {
                index += 1;
                continue;
            }

            if matches!(&plans[index].value, PlanValue::Literal(_)) {
                if let PlanValue::Literal(text) = &plans[index].value {
                    inlined_style.push_str(text.trim_end_matches(';'));
                    inlined_style.push(';');
                }
                plans.remove(index);
                continue;
            }

            if matches!(
                &plans[index].value,
                PlanValue::Expr(Expression::ObjectExpression(_))
            ) {
                let (retained, span) = {
                    let PlanValue::Expr(Expression::ObjectExpression(object)) = &plans[index].value
                    else {
                        unreachable!()
                    };
                    let mut retained = std::vec::Vec::new();
                    for property in object.properties.iter() {
                        let ObjectPropertyKind::ObjectProperty(property) = property else {
                            retained.push(property.clone_in(self.allocator));
                            continue;
                        };
                        if property.computed {
                            // Computed keys can't inline (values were already
                            // folded by `fold_confident`).
                            retained.push(ObjectPropertyKind::ObjectProperty(
                                property.clone_in(self.allocator),
                            ));
                            continue;
                        }
                        let Some(key) = static_style_key(&property.key) else {
                            retained.push(ObjectPropertyKind::ObjectProperty(
                                property.clone_in(self.allocator),
                            ));
                            continue;
                        };
                        match &property.value {
                            Expression::StringLiteral(value) => {
                                inlined_style.push_str(&format!("{key}:{};", value.value.as_str()));
                            }
                            Expression::NumericLiteral(value) => {
                                inlined_style
                                    .push_str(&format!("{key}:{};", format_number(value.value)));
                            }
                            Expression::NullLiteral(_) => {}
                            Expression::Identifier(identifier)
                                if identifier.name == "undefined" => {}
                            value => {
                                if let Some(evaluated) = self
                                    .evaluate_confident(value)
                                    .and_then(|value| value.as_template_string())
                                {
                                    inlined_style.push_str(&format!("{key}:{evaluated};"));
                                } else {
                                    retained.push(ObjectPropertyKind::ObjectProperty(
                                        property.clone_in(self.allocator),
                                    ));
                                }
                            }
                        }
                    }
                    (retained, object.span)
                };
                if retained.is_empty() {
                    plans.remove(index);
                    continue;
                }
                let properties = self.ast().vec_from_iter(retained);
                plans[index].value =
                    PlanValue::Expr(self.ast().expression_object(span, properties));
            }
            index += 1;
        }

        if !inlined_style.is_empty() {
            plans.push(AttrPlan {
                span: SPAN,
                key: "style".to_string(),
                value: PlanValue::Literal(inlined_style.trim_end_matches(';').to_string()),
                style_property: false,
                class_property: false,
                marker_static: false,
            });
        }
    }

    /// Splits the first spread-free `style={{...}}` object into individual
    /// `style:prop` attributes flagged `style_property` (Babel
    /// `_styleProperty`), compiling to `setStyleProperty()` calls.
    fn split_style_object(&self, plans: &mut std::vec::Vec<AttrPlan<'a>>) {
        let Some(index) = plans.iter().position(|plan| {
            plan.key == "style"
                && matches!(
                    &plan.value,
                    PlanValue::Expr(Expression::ObjectExpression(object))
                        if !object
                            .properties
                            .iter()
                            .any(|p| matches!(p, ObjectPropertyKind::SpreadProperty(_)))
                )
        }) else {
            return;
        };
        let attr_marker = plans[index].marker_static;
        let PlanValue::Expr(Expression::ObjectExpression(object)) = &plans[index].value else {
            return;
        };
        let object_span = object.span;

        let mut split_plans = std::vec::Vec::new();
        let mut retained = std::vec::Vec::new();
        for property in object.properties.iter() {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            if property.computed {
                retained.push(ObjectPropertyKind::ObjectProperty(
                    property.clone_in(self.allocator),
                ));
                continue;
            }
            let Some(key) = static_style_key(&property.key) else {
                retained.push(ObjectPropertyKind::ObjectProperty(
                    property.clone_in(self.allocator),
                ));
                continue;
            };
            let marker = attr_marker
                || self.marker_between(property.span.start, property.value.span().start);
            split_plans.push(AttrPlan {
                span: property.span,
                key: format!("style:{key}"),
                value: PlanValue::Expr(property.value.clone_in(self.allocator)),
                style_property: true,
                class_property: false,
                marker_static: marker,
            });
        }

        if retained.is_empty() {
            plans.remove(index);
            for (insert_at, plan) in (index..).zip(split_plans) {
                plans.insert(insert_at, plan);
            }
        } else {
            let properties = self.ast().vec_from_iter(retained);
            plans[index].value =
                PlanValue::Expr(self.ast().expression_object(object_span, properties));
            for (insert_at, plan) in (index + 1..).zip(split_plans) {
                plans.insert(insert_at, plan);
            }
        }
    }

    /// Class array preprocessing: leading static string classes split from a
    /// trailing fixed-shape object, `class={["a", { b: cond }]}` becoming
    /// `class="a" class={{ b: cond }}`.
    fn split_class_array(&self, plans: &mut std::vec::Vec<AttrPlan<'a>>) {
        let Some(index) = plans.iter().position(|plan| {
            plan.key == "class"
                && matches!(&plan.value, PlanValue::Expr(Expression::ArrayExpression(_)))
        }) else {
            return;
        };
        let PlanValue::Expr(Expression::ArrayExpression(array)) = &plans[index].value else {
            return;
        };

        let mut static_classes = std::vec::Vec::new();
        let mut cursor = 0;
        while let Some(ArrayExpressionElement::StringLiteral(value)) = array.elements.get(cursor) {
            static_classes.push(value.value.to_string());
            cursor += 1;
        }
        if static_classes.is_empty() || cursor != array.elements.len() - 1 {
            return;
        }
        let Some(ArrayExpressionElement::ObjectExpression(object)) = array.elements.get(cursor)
        else {
            return;
        };
        let static_class_set: std::collections::HashSet<String> = static_classes
            .iter()
            .flat_map(|class| class.split_whitespace().map(str::to_string))
            .collect();
        let conflicting = object.properties.iter().any(|property| match property {
            ObjectPropertyKind::SpreadProperty(_) => true,
            ObjectPropertyKind::ObjectProperty(property) => {
                if property.computed {
                    return true;
                }
                match static_style_key(&property.key) {
                    Some(key) => {
                        key.contains(' ') || key.contains(':') || static_class_set.contains(&key)
                    }
                    None => true,
                }
            }
        });
        if conflicting {
            return;
        }

        let object_expression = Expression::ObjectExpression(object.clone_in(self.allocator));
        let span = plans[index].span;
        let marker = plans[index].marker_static;
        plans[index].value = PlanValue::Literal(static_classes.join(" "));
        plans.insert(
            index + 1,
            AttrPlan {
                span,
                key: "class".to_string(),
                value: PlanValue::Expr(object_expression),
                style_property: false,
                class_property: false,
                marker_static: marker,
            },
        );
    }

    /// ClassList optimization: the first fixed-shape `class={{...}}` object
    /// splits per property — confident truthy keys become static classes,
    /// confident falsy keys drop, the rest become `class:prop` toggles.
    fn split_class_list(&self, plans: &mut std::vec::Vec<AttrPlan<'a>>) {
        let Some(index) = plans.iter().position(|plan| {
            plan.key == "class"
                && matches!(
                    &plan.value,
                    PlanValue::Expr(Expression::ObjectExpression(object))
                        if !object.properties.iter().any(|property| match property {
                            ObjectPropertyKind::SpreadProperty(_) => true,
                            ObjectPropertyKind::ObjectProperty(property) => {
                                property.computed
                                    || match &property.key {
                                        oxc_ast::ast::PropertyKey::StringLiteral(key) => {
                                            key.value.contains(' ') || key.value.contains(':')
                                        }
                                        _ => false,
                                    }
                            }
                        })
                )
        }) else {
            return;
        };
        let attr_marker = plans[index].marker_static;
        let PlanValue::Expr(Expression::ObjectExpression(object)) = &plans[index].value else {
            return;
        };

        let mut split_plans = std::vec::Vec::new();
        for property in object.properties.iter() {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            let Some(key) = static_style_key(&property.key) else {
                continue;
            };
            let marker = attr_marker
                || self.marker_between(property.span.start, property.value.span().start);
            match self.evaluate_confident(&property.value) {
                Some(value) => {
                    if value.truthy() {
                        split_plans.push(AttrPlan {
                            span: property.span,
                            key: "class".to_string(),
                            value: PlanValue::Literal(key),
                            style_property: false,
                            class_property: false,
                            marker_static: marker,
                        });
                    }
                }
                None => {
                    split_plans.push(AttrPlan {
                        span: property.span,
                        key: format!("class:{key}"),
                        value: PlanValue::Expr(property.value.clone_in(self.allocator)),
                        style_property: false,
                        class_property: true,
                        marker_static: marker,
                    });
                }
            }
        }

        plans.remove(index);
        for (insert_at, plan) in (index..).zip(split_plans) {
            plans.insert(insert_at, plan);
        }
    }

    /// Combines multiple `class` attributes into the first one — all-static
    /// parts join into one string, dynamic parts become a template literal
    /// with `|| ""` guards.
    fn combine_class_attributes(&self, plans: &mut std::vec::Vec<AttrPlan<'a>>) {
        let class_indices: std::vec::Vec<usize> = plans
            .iter()
            .enumerate()
            .filter(|(_, plan)| plan.key == "class")
            .map(|(index, _)| index)
            .collect();
        if class_indices.len() < 2 {
            return;
        }

        let mut quasis: std::vec::Vec<String> = vec![String::new()];
        let mut values = std::vec::Vec::new();
        for (position, index) in class_indices.iter().enumerate() {
            let is_last = position == class_indices.len() - 1;
            match &plans[*index].value {
                PlanValue::Expr(expression) => {
                    values.push(
                        self.ast().expression_logical(
                            expression.span(),
                            expression.clone_in(self.allocator),
                            oxc_ast::ast::LogicalOperator::Or,
                            self.ast()
                                .expression_string_literal(SPAN, self.ast().str(""), None),
                        ),
                    );
                    quasis.push(if is_last {
                        String::new()
                    } else {
                        " ".to_string()
                    });
                }
                PlanValue::Literal(text) => {
                    let last = quasis.last_mut().expect("quasis is non-empty");
                    last.push_str(text);
                    if !is_last {
                        last.push(' ');
                    }
                }
                PlanValue::None => {
                    let last = quasis.last_mut().expect("quasis is non-empty");
                    if !is_last {
                        last.push(' ');
                    }
                }
            }
        }

        let first = class_indices[0];
        if values.is_empty() {
            plans[first].value = PlanValue::Literal(quasis[0].clone());
        } else {
            let span = plans[first].span;
            let quasi_count = quasis.len();
            let elements =
                self.ast()
                    .vec_from_iter(quasis.into_iter().enumerate().map(|(index, raw)| {
                        let atom = self.ast().str(&raw);
                        self.ast().template_element_with_lone_surrogates(
                            SPAN,
                            TemplateElementValue {
                                raw: atom,
                                cooked: Some(atom),
                            },
                            index == quasi_count - 1,
                            true,
                        )
                    }));
            let expressions = self.ast().vec_from_iter(values);
            plans[first].value = PlanValue::Expr(self.ast().expression_template_literal(
                span,
                elements,
                expressions,
            ));
        }
        for index in class_indices.iter().skip(1).rev() {
            plans.remove(*index);
        }
    }
}

/// Resolves duplicate attributes after stateful DOM properties have been
/// normalized, matching Babel's preprocessing order. The last occurrence of
/// a normalized name wins, except `ref` which may appear multiple times.
fn dedupe_plans(plans: &mut std::vec::Vec<AttrPlan<'_>>) {
    let mut seen = std::collections::HashSet::new();
    let mut deduped = std::vec::Vec::with_capacity(plans.len());
    for plan in plans.drain(..).rev() {
        if plan.key == "ref" || seen.insert(plan.key.clone()) {
            deduped.push(plan);
        }
    }
    deduped.reverse();
    *plans = deduped;
}

/// Non-computed object key as a static string (`color`, `"background-color"`,
/// numeric keys) — the shape shared by the style/class object splitters.
pub(crate) fn static_style_key(key: &oxc_ast::ast::PropertyKey<'_>) -> Option<String> {
    match key {
        oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => {
            Some(identifier.name.to_string())
        }
        oxc_ast::ast::PropertyKey::StringLiteral(value) => Some(value.value.to_string()),
        oxc_ast::ast::PropertyKey::NumericLiteral(value) => Some(value.value.to_string()),
        _ => None,
    }
}
