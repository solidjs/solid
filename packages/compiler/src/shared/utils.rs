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
            "Only simple JSX element names are supported",
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
        Expression::ParenthesizedExpression(parenthesized) => {
            static_expression(&parenthesized.expression, bindings)
        }
        Expression::ConditionalExpression(conditional) => {
            if static_boolean_expression(&conditional.test, bindings)? {
                static_expression(&conditional.consequent, bindings)
            } else {
                static_expression(&conditional.alternate, bindings)
            }
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

fn static_boolean_expression(
    expression: &Expression<'_>,
    bindings: Option<&crate::shared::bindings::BindingTable>,
) -> Option<bool> {
    match expression {
        Expression::BooleanLiteral(value) => Some(value.value),
        Expression::Identifier(identifier) => {
            bindings.and_then(|bindings| bindings.static_bool(identifier.name.as_str()))
        }
        Expression::ParenthesizedExpression(parenthesized) => {
            static_boolean_expression(&parenthesized.expression, bindings)
        }
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_ast::ast::UnaryOperator::LogicalNot =>
        {
            static_boolean_expression(&unary.argument, bindings).map(|value| !value)
        }
        _ => None,
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
        // The arithmetic the attribute evaluator (`evaluate_confident`) folds
        // too, so `{1 / 0}` is static in a child just as it is in an
        // attribute (Babel's `path.evaluate()` folds both).
        BinaryOperator::Subtraction | BinaryOperator::Multiplication | BinaryOperator::Division => {
            let (StaticValue::Number(left), StaticValue::Number(right)) = (left, right) else {
                return None;
            };
            Some(StaticValue::Number(match operator {
                BinaryOperator::Subtraction => left - right,
                BinaryOperator::Multiplication => left * right,
                _ => left / right,
            }))
        }
        _ => None,
    }
}

pub(crate) fn source_from_span(span: Span, source: &str) -> &str {
    &source[span.start as usize..span.end as usize]
}

/// Spans of the coverage-pragma block comments inside a JSX empty expression
/// container (`{/* istanbul ignore next */}`). Line comments never count,
/// matching Babel's `CommentBlock`-only filter.
pub(crate) fn coverage_ignore_block_comments(source: &str, span: Span) -> std::vec::Vec<Span> {
    let mut comments = std::vec::Vec::new();
    let Some(text) = source.get(span.start as usize..span.end as usize) else {
        return comments;
    };
    let mut index = 0;
    while index < text.len() {
        let rest = &text[index..];
        if rest.starts_with("//") {
            index += rest
                .find(['\n', '\r', '\u{2028}', '\u{2029}'])
                .unwrap_or(rest.len());
        } else if let Some(body) = rest.strip_prefix("/*") {
            let Some(end) = body.find("*/") else {
                break;
            };
            if is_coverage_ignore_comment(&body[..end]) {
                let start = span.start + index as u32;
                comments.push(Span::new(start, start + end as u32 + 4));
            }
            index += end + 4;
        } else {
            index += rest.chars().next().map_or(1, char::len_utf8);
        }
    }
    comments
}

/// `/^\s*(istanbul|c8)\s+ignore\b/` — `\b` is ASCII-word based, as in JS.
fn is_coverage_ignore_comment(comment: &str) -> bool {
    let comment = comment.trim_start();
    ["istanbul", "c8"].iter().any(|tool| {
        let Some(rest) = comment.strip_prefix(tool) else {
            return false;
        };
        if !rest.chars().next().is_some_and(char::is_whitespace) {
            return false;
        }
        let Some(rest) = rest.trim_start().strip_prefix("ignore") else {
            return false;
        };
        !rest
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric() || character == '_')
    })
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

/// Port of JS `Number::toString` (ECMA-262 §6.1.6.1.20), i.e. what
/// `String(number)` gives: the shortest digits that round-trip (Rust's
/// float formatting finds the same ones), laid out with JS's rules —
/// plain decimal when the decimal exponent is in `-7 < e < 21`, otherwise
/// exponent form with an explicit sign (`1e+21`, `1.5e-7`).
pub(crate) fn format_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value == 0.0 {
        // Covers -0, which JS prints as "0".
        return "0".to_string();
    }
    if value < 0.0 {
        return format!("-{}", format_number(-value));
    }
    if value.is_infinite() {
        return "Infinity".to_string();
    }

    // `{:e}` gives `d[.ddd]e[-]x` with the shortest round-trip digits.
    let scientific = format!("{value:e}");
    let (mantissa, exponent) = scientific
        .split_once('e')
        .expect("LowerExp output always has an exponent");
    let exponent: i32 = exponent.parse().expect("LowerExp exponent is an integer");
    let digits: String = mantissa.chars().filter(|char| *char != '.').collect();
    let k = digits.len() as i32;
    // JS's `n`: the value is `0.<digits> * 10^n`.
    let n = exponent + 1;

    if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        let (integer, fraction) = digits.split_at(n as usize);
        format!("{integer}.{fraction}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let sign = if exponent < 0 { '-' } else { '+' };
        let (first, rest) = digits.split_at(1);
        if rest.is_empty() {
            format!("{first}e{sign}{}", exponent.abs())
        } else {
            format!("{first}.{rest}e{sign}{}", exponent.abs())
        }
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
    match expression.as_expression() {
        Some(expression) => expression_can_return_hydratable_child(expression),
        None => false,
    }
}

/// Strips TS-only wrappers (casts, non-null, satisfies) and parens before a
/// shape check, the same way the Babel predicates recurse through
/// `TSAsExpression`/`TSNonNullExpression`/`TSSatisfiesExpression`.
fn unwrap_ts_wrappers<'e, 'a>(mut expression: &'e Expression<'a>) -> &'e Expression<'a> {
    loop {
        expression = match expression {
            Expression::TSAsExpression(cast) => &cast.expression,
            Expression::TSNonNullExpression(cast) => &cast.expression,
            Expression::TSSatisfiesExpression(cast) => &cast.expression,
            Expression::ParenthesizedExpression(paren) => &paren.expression,
            _ => return expression,
        };
    }
}

/// A hole is scoped unless its value is provably a primitive: any other
/// shape (a call, a property read behind a getter, an array) can build JSX
/// at read time, and only `props.children` used to count (#3567).
pub(crate) fn expression_can_return_hydratable_child(expression: &Expression<'_>) -> bool {
    match unwrap_ts_wrappers(expression) {
        Expression::ConditionalExpression(conditional) => {
            expression_can_return_hydratable_child(&conditional.consequent)
                || expression_can_return_hydratable_child(&conditional.alternate)
        }
        Expression::LogicalExpression(logical) => {
            expression_can_return_hydratable_child(&logical.left)
                || expression_can_return_hydratable_child(&logical.right)
        }
        Expression::SequenceExpression(sequence) => sequence
            .expressions
            .last()
            .is_some_and(expression_can_return_hydratable_child),
        Expression::AssignmentExpression(assignment) => {
            expression_can_return_hydratable_child(&assignment.right)
        }
        Expression::ArrayExpression(array) => array.elements.iter().any(|element| match element {
            oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread) => {
                expression_can_return_hydratable_child(&spread.argument)
            }
            oxc_ast::ast::ArrayExpressionElement::Elision(_) => false,
            _ => element
                .as_expression()
                .is_some_and(expression_can_return_hydratable_child),
        }),
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::TemplateLiteral(_)
        | Expression::UnaryExpression(_)
        | Expression::BinaryExpression(_)
        | Expression::PrivateInExpression(_)
        | Expression::UpdateExpression(_) => false,
        _ => true,
    }
}

/// A syntactic function-expression hole (`{() => ...}` / `{function () {}}`,
/// TS casts unwrapped). Function children never classify as `dynamic` — the
/// literal reads nothing at template time — yet at runtime they are deferred
/// holes exactly like call-shaped values, so the scope gates treat them as
/// scope-eligible alongside `dynamic` (solidjs/solid#3068 follow-up).
pub(crate) fn expression_is_function_shaped(expression: &Expression<'_>) -> bool {
    matches!(
        unwrap_ts_wrappers(expression),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    )
}

/// [`expression_is_function_shaped`] lifted to a JSX child slot.
pub(crate) fn jsx_child_is_function_hole(child: &JSXChild<'_>) -> bool {
    match child {
        JSXChild::ExpressionContainer(container) => match container.expression.as_expression() {
            Some(expression) => expression_is_function_shaped(expression),
            None => false,
        },
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::format_number;

    /// Each pair is `String(value)` as Node prints it.
    #[test]
    fn format_number_matches_js_number_to_string() {
        let cases: &[(f64, &str)] = &[
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-1.0, "-1"),
            (1.5, "1.5"),
            (0.1, "0.1"),
            (0.1 + 0.2, "0.30000000000000004"),
            (123.456, "123.456"),
            (1e-6, "0.000001"),
            (1.5e-6, "0.0000015"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (-1e-7, "-1e-7"),
            (5e-324, "5e-324"),
            (9007199254740993.0, "9007199254740992"),
            (2f64.powi(63), "9223372036854776000"),
            (1e19, "10000000000000000000"),
            (1e20, "100000000000000000000"),
            (123456789012345680000.0, "123456789012345680000"),
            (1e21, "1e+21"),
            (-1e21, "-1e+21"),
            (1.5e21, "1.5e+21"),
            (1.7976931348623157e308, "1.7976931348623157e+308"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "Infinity"),
            (f64::NEG_INFINITY, "-Infinity"),
        ];
        for (value, expected) in cases {
            assert_eq!(format_number(*value), *expected, "String({value:e})");
        }
    }
}
