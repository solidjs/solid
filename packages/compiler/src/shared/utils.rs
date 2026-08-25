use crate::error::{Error, Result};
use oxc_ast::ast::BinaryOperator;
use oxc_ast::ast::{Expression, JSXChild, JSXElementName, JSXExpression};
use oxc_span::Span;

use crate::shared::constants::void_elements;

#[derive(Clone)]
pub(crate) enum StaticValue {
    String(String),
    Number(f64),
}

impl StaticValue {
    pub(crate) fn into_template_value(self) -> String {
        match self {
            StaticValue::String(value) => value,
            StaticValue::Number(value) => format_number(value),
        }
    }
}

pub(crate) fn element_name(name: &JSXElementName<'_>) -> Result<String> {
    match name {
        JSXElementName::Identifier(identifier) => Ok(identifier.name.to_string()),
        JSXElementName::IdentifierReference(identifier) => Ok(identifier.name.to_string()),
        JSXElementName::NamespacedName(name) => {
            Ok(format!("{}:{}", name.namespace.name, name.name.name))
        }
        _ => Err(Error::from_reason(
            "Only simple JSX element names are implemented in the AST-native milestone",
        )),
    }
}

pub(crate) fn is_component_name(name: &JSXElementName<'_>) -> bool {
    matches!(
        name,
        JSXElementName::MemberExpression(_) | JSXElementName::ThisExpression(_)
    ) || matches!(
        name,
        JSXElementName::IdentifierReference(identifier)
            if identifier
                .name
                .chars()
                .next()
                .is_some_and(|first| first.is_ascii_uppercase() || first == '_' || first == '$')
    )
}

pub(crate) fn static_jsx_expression_value(expression: &JSXExpression<'_>) -> Option<String> {
    static_jsx_expression(expression, None).map(StaticValue::into_template_value)
}

/// Mirror of Babel's `getStaticExpression` filter: only confident *string or
/// number* values count as static — booleans, `null`, and `undefined` fail
/// the `typeof` check and stay dynamic child inserts.
pub(crate) fn static_jsx_expression(
    expression: &JSXExpression<'_>,
    bindings: Option<&crate::shared::bindings::BindingTable>,
) -> Option<StaticValue> {
    match expression {
        JSXExpression::StringLiteral(value) => Some(StaticValue::String(value.value.to_string())),
        JSXExpression::NumericLiteral(value) => Some(StaticValue::Number(value.value)),
        JSXExpression::Identifier(identifier) => {
            static_identifier(identifier.name.as_str(), bindings)
        }
        JSXExpression::UnaryExpression(unary) => {
            static_unary_expression(unary.operator, &unary.argument, bindings)
        }
        JSXExpression::TemplateLiteral(template) => static_template_literal(template, bindings),
        JSXExpression::BinaryExpression(binary) => {
            static_binary_expression(&binary.left, binary.operator, &binary.right, bindings)
        }
        _ => None,
    }
}

pub(crate) fn static_expression(
    expression: &Expression<'_>,
    bindings: Option<&crate::shared::bindings::BindingTable>,
) -> Option<StaticValue> {
    match expression {
        Expression::StringLiteral(value) => Some(StaticValue::String(value.value.to_string())),
        Expression::NumericLiteral(value) => Some(StaticValue::Number(value.value)),
        Expression::Identifier(identifier) => static_identifier(identifier.name.as_str(), bindings),
        Expression::UnaryExpression(unary) => {
            static_unary_expression(unary.operator, &unary.argument, bindings)
        }
        Expression::TemplateLiteral(template) => static_template_literal(template, bindings),
        Expression::BinaryExpression(binary) => {
            static_binary_expression(&binary.left, binary.operator, &binary.right, bindings)
        }
        _ => None,
    }
}

fn static_identifier(
    name: &str,
    bindings: Option<&crate::shared::bindings::BindingTable>,
) -> Option<StaticValue> {
    // `path.evaluate()` resolves the global number constants confidently;
    // `undefined` evaluates confidently too but fails the string/number check.
    match name {
        "NaN" => Some(StaticValue::Number(f64::NAN)),
        "Infinity" => Some(StaticValue::Number(f64::INFINITY)),
        _ => bindings.and_then(|bindings| bindings.static_value(name)),
    }
}

fn static_unary_expression(
    operator: oxc_ast::ast::UnaryOperator,
    argument: &Expression<'_>,
    bindings: Option<&crate::shared::bindings::BindingTable>,
) -> Option<StaticValue> {
    use oxc_ast::ast::UnaryOperator;
    if operator == UnaryOperator::Typeof {
        return static_typeof(argument, bindings)
            .map(|type_name| StaticValue::String(type_name.to_string()));
    }
    let value = static_expression(argument, bindings)?;
    match (operator, value) {
        (UnaryOperator::UnaryNegation, StaticValue::Number(value)) => {
            Some(StaticValue::Number(-value))
        }
        (UnaryOperator::UnaryPlus, StaticValue::Number(value)) => Some(StaticValue::Number(value)),
        _ => None,
    }
}

/// Babel's `path.evaluate()` folds `typeof <confident value>` to the type
/// name string, which then passes `getStaticExpression`'s string check. The
/// operand set here covers the literal shapes evaluate resolves confidently
/// even though they aren't static child values themselves (booleans, null).
fn static_typeof(
    argument: &Expression<'_>,
    bindings: Option<&crate::shared::bindings::BindingTable>,
) -> Option<&'static str> {
    match argument {
        Expression::BooleanLiteral(_) => Some("boolean"),
        Expression::NullLiteral(_) => Some("object"),
        Expression::Identifier(identifier) if identifier.name == "undefined" => Some("undefined"),
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_ast::ast::UnaryOperator::Void
                && matches!(unary.argument, Expression::NumericLiteral(_)) =>
        {
            Some("undefined")
        }
        _ => match static_expression(argument, bindings)? {
            StaticValue::String(_) => Some("string"),
            StaticValue::Number(_) => Some("number"),
        },
    }
}

fn static_template_literal(
    template: &oxc_ast::ast::TemplateLiteral<'_>,
    bindings: Option<&crate::shared::bindings::BindingTable>,
) -> Option<StaticValue> {
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
            let value = static_expression(expressions.next()?, bindings)?;
            result.push_str(&value.into_template_value());
        }
    }
    Some(StaticValue::String(result))
}

fn static_binary_expression(
    left: &Expression<'_>,
    operator: BinaryOperator,
    right: &Expression<'_>,
    bindings: Option<&crate::shared::bindings::BindingTable>,
) -> Option<StaticValue> {
    let left = static_expression(left, bindings)?;
    let right = static_expression(right, bindings)?;
    match operator {
        BinaryOperator::Addition => match (left, right) {
            (StaticValue::Number(left), StaticValue::Number(right)) => {
                Some(StaticValue::Number(left + right))
            }
            (left, right) => Some(StaticValue::String(format!(
                "{}{}",
                left.into_template_value(),
                right.into_template_value()
            ))),
        },
        _ => None,
    }
}

pub(crate) fn source_from_span(span: Span, source: &str) -> &str {
    &source[span.start as usize..span.end as usize]
}

/// Exact port of Babel's `trimWhitespace`: strip `\r`; for multiline text,
/// drop each continuation line's indentation and all-whitespace lines, then
/// join with spaces (the first line keeps its leading, and the last line its
/// trailing, whitespace); finally collapse whitespace runs to single spaces.
pub(crate) fn trim_jsx_text(value: &str) -> String {
    let text = value.replace('\r', "");
    let text = if text.contains('\n') {
        text.split('\n')
            .enumerate()
            .map(|(index, line)| {
                if index > 0 {
                    line.trim_start_matches(char::is_whitespace)
                } else {
                    line
                }
            })
            .filter(|line| !line.chars().all(char::is_whitespace))
            .collect::<std::vec::Vec<_>>()
            .join(" ")
    } else {
        text
    };
    let mut collapsed = String::with_capacity(text.len());
    let mut in_whitespace = false;
    for character in text.chars() {
        if character.is_whitespace() {
            if !in_whitespace {
                collapsed.push(' ');
                in_whitespace = true;
            }
        } else {
            collapsed.push(character);
            in_whitespace = false;
        }
    }
    collapsed
}

pub(crate) fn escape_html_text(value: &str) -> String {
    value.replace('<', "&lt;")
}

pub(crate) fn escape_html_text_expression(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;")
}

/// Attribute-position HTML escaping, mirroring the Babel plugin's
/// `escapeHTML(s, true)`: `&`, `"` AND `<` — uniform across DOM and SSR
/// output (stage-4 SSR invariant: a raw "<select" byte sequence in SSR
/// output is always a genuine tag start, so the runtime's
/// resolveSSRSelectValues can region-jump on it; in innerHTML template
/// strings `&lt;` parses identically to a raw `<`).
pub(crate) fn escape_html_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}

/// Full WHATWG entity decoding (named + numeric, including semicolon-less
/// legacy forms), matching the Babel plugin's `html-entities` `decode()`.
pub(crate) fn decode_html_entities(value: &str) -> String {
    htmlize::unescape(value).into_owned()
}

pub(crate) fn format_attribute_value_with_quotes(value: &str, omit_quotes: bool) -> String {
    // Quoting need is decided on the unescaped text (as the Babel plugin
    // does); HTML escaping applies either way.
    let escaped = escape_html_attribute(value);
    if omit_quotes && can_omit_attribute_quotes(value) {
        escaped
    } else {
        format!("\"{escaped}\"")
    }
}

fn can_omit_attribute_quotes(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|char| {
            !matches!(
                char,
                ' ' | '\t' | '\n' | '\r' | '"' | '\'' | '`' | '=' | '<' | '>'
            )
        })
}

pub(crate) fn format_number(value: f64) -> String {
    // JS `String(number)` spellings for the non-finite values (Rust would
    // print `NaN`/`inf`).
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

pub(crate) fn is_void_element(tag_name: &str) -> bool {
    void_elements(tag_name)
}

/// Static `class`/`style` attribute values collapse whitespace (and styles
/// drop the space after `;`/`:`), mirroring Babel's static-branch
/// `trimWhitespace` treatment. Other attributes serialize as-is.
pub(crate) fn normalize_static_attribute_value(name: &str, value: &str) -> String {
    if name != "style" && name != "class" {
        return value.to_string();
    }

    let mut normalized = String::new();
    let mut previous_was_whitespace = false;
    for char in value.chars().filter(|char| *char != '\r') {
        if char.is_whitespace() {
            if !previous_was_whitespace {
                normalized.push(' ');
                previous_was_whitespace = true;
            }
        } else {
            normalized.push(char);
            previous_was_whitespace = false;
        }
    }

    if name == "style" {
        normalized.replace("; ", ";").replace(": ", ":")
    } else {
        normalized
    }
}

pub(crate) fn is_identifier_key(name: &str) -> bool {
    name.chars()
        .all(|char| char == '_' || char == '$' || char.is_ascii_alphanumeric())
        && name
            .chars()
            .next()
            .is_some_and(|char| char == '_' || char == '$' || char.is_ascii_alphabetic())
}

/// Builds a 1-based generated local name such as `_el$`, `_el$2`, `_ref$`,
/// `_c$`, or `_self$`. The first occurrence omits the numeric suffix to match
/// the Babel plugin's naming.
/// Port of the Babel plugin's `getNumberedId`: short identifiers for keyed
/// multi-dynamic effect objects, skipping encodings that collide with
/// reserved words (they're used as shorthand destructuring bindings).
const RESERVED_WORDS: &[&str] = &[
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "new",
    "null",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
    "let",
    "static",
    "implements",
    "interface",
    "package",
    "private",
    "protected",
    "public",
    "await",
];

/// Mirror of Babel's `t.isValidIdentifier`: identifier syntax AND not a
/// reserved word.
pub(crate) fn is_valid_babel_identifier(name: &str) -> bool {
    is_identifier_key(name) && !RESERVED_WORDS.contains(&name)
}

pub(crate) fn get_numbered_id(mut num: usize) -> String {
    const CHARS: &[u8] = b"etaoinshrdlucwmfygpbTAOISWCBvkxjqzPHFMDRELNGUKVYJQZX_$";
    static RESERVED_INDICES: std::sync::OnceLock<std::vec::Vec<usize>> = std::sync::OnceLock::new();
    let reserved = RESERVED_INDICES.get_or_init(|| {
        let mut indices: std::vec::Vec<usize> = RESERVED_WORDS
            .iter()
            .filter_map(|word| {
                let mut value = 0usize;
                for ch in word.bytes() {
                    let index = CHARS.iter().position(|candidate| *candidate == ch)?;
                    value = value * CHARS.len() + index;
                }
                Some(value)
            })
            .collect();
        indices.sort_unstable();
        indices
    });
    for index in reserved {
        if *index <= num {
            num += 1;
        } else {
            break;
        }
    }
    let mut out = std::vec::Vec::new();
    loop {
        out.insert(0, CHARS[num % CHARS.len()]);
        num /= CHARS.len();
        if num == 0 {
            break;
        }
    }
    String::from_utf8(out).expect("numbered id is ascii")
}

pub(crate) fn indexed_local(prefix: &str, index: usize) -> String {
    if index == 1 {
        format!("{prefix}$")
    } else {
        format!("{prefix}${index}")
    }
}

/// Advances `index` to the next candidate whose name isn't already used in
/// the source program (Babel's `generateUid` collision loop) and returns it.
pub(crate) fn next_unique_local(
    prefix: &str,
    index: &mut usize,
    bindings: &crate::shared::bindings::BindingTable,
) -> String {
    loop {
        *index += 1;
        let name = indexed_local(prefix, *index);
        if !bindings.is_taken(&name) {
            return name;
        }
    }
}

pub(crate) fn template_id(index: usize) -> String {
    if index == 0 {
        "_tmpl$".to_string()
    } else {
        format!("_tmpl${}", index + 1)
    }
}

/// `_tmpl$`-family variant of [`next_unique_local`] (1-based external index;
/// the counter stores the last used 0-based value internally).
pub(crate) fn next_unique_template_id(
    index: &mut usize,
    bindings: &crate::shared::bindings::BindingTable,
) -> String {
    loop {
        let name = template_id(*index);
        *index += 1;
        if !bindings.is_taken(&name) {
            return name;
        }
    }
}

/// Mirror of the Babel plugin's `canChildSlotAllocateIds`: whether a child
/// slot can produce hydratable content that consumes hydration ids. Shared by
/// the dom and ssr generates so marking can never desync between them.
pub(crate) fn child_slot_allocates_ids(child: &JSXChild<'_>) -> bool {
    match child {
        JSXChild::Element(_) | JSXChild::Fragment(_) | JSXChild::Spread(_) => true,
        JSXChild::ExpressionContainer(container) => {
            jsx_expression_can_return_hydratable_child(&container.expression)
        }
        _ => false,
    }
}

fn jsx_expression_can_return_hydratable_child(expression: &JSXExpression<'_>) -> bool {
    match expression {
        JSXExpression::JSXElement(_)
        | JSXExpression::JSXFragment(_)
        | JSXExpression::CallExpression(_) => true,
        JSXExpression::StaticMemberExpression(member) => member.property.name == "children",
        JSXExpression::ChainExpression(chain) => match &chain.expression {
            oxc_ast::ast::ChainElement::StaticMemberExpression(member) => {
                member.property.name == "children"
            }
            _ => false,
        },
        JSXExpression::ConditionalExpression(conditional) => {
            expression_can_return_hydratable_child(&conditional.consequent)
                || expression_can_return_hydratable_child(&conditional.alternate)
        }
        JSXExpression::LogicalExpression(logical) => {
            expression_can_return_hydratable_child(&logical.right)
        }
        _ => false,
    }
}

pub(crate) fn expression_can_return_hydratable_child(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::JSXElement(_) | Expression::JSXFragment(_) | Expression::CallExpression(_) => {
            true
        }
        Expression::StaticMemberExpression(member) => member.property.name == "children",
        Expression::ChainExpression(chain) => match &chain.expression {
            oxc_ast::ast::ChainElement::StaticMemberExpression(member) => {
                member.property.name == "children"
            }
            _ => false,
        },
        Expression::ConditionalExpression(conditional) => {
            expression_can_return_hydratable_child(&conditional.consequent)
                || expression_can_return_hydratable_child(&conditional.alternate)
        }
        Expression::LogicalExpression(logical) => {
            expression_can_return_hydratable_child(&logical.right)
        }
        _ => false,
    }
}
