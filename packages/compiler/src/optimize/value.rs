//! The constant lattice the `optimize` pass folds against.
//!
//! Only values a JavaScript engine would produce with *no observable side
//! effect* live here: literals, and the operators over them whose ECMAScript
//! semantics this module reproduces exactly. Anything whose folded spelling
//! could differ from the engine's own (string/number coercions outside the
//! safe-integer range, non-ASCII relational comparison) deliberately returns
//! `None` and stays in the output untouched. A missed fold costs bytes; a
//! wrong fold costs correctness.

use std::collections::HashMap;

use oxc_ast::ast::Expression;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};

use crate::shared::utils::format_number;

/// The constant each identifier *reference* resolves to, keyed by the
/// reference's span start. Keying by span rather than by name is what lets
/// the pass fold a `const` declared in any scope: resolution already
/// happened in [`super::env::collect_facts`], so a lookup here cannot
/// confuse two same-named bindings.
pub(crate) type ConstantEnv = HashMap<u32, Const>;

/// A JavaScript primitive known at compile time.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Const {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(String),
}

impl Const {
    /// ECMAScript `ToBoolean`.
    pub(crate) fn truthy(&self) -> bool {
        match self {
            Const::Undefined | Const::Null => false,
            Const::Bool(value) => *value,
            Const::Number(value) => *value != 0.0 && !value.is_nan(),
            Const::String(value) => !value.is_empty(),
        }
    }

    fn type_of(&self) -> &'static str {
        match self {
            Const::Undefined => "undefined",
            // `typeof null` is the specified wart.
            Const::Null => "object",
            Const::Bool(_) => "boolean",
            Const::Number(_) => "number",
            Const::String(_) => "string",
        }
    }

    /// ECMAScript `ToString`, restricted to spellings this compiler can
    /// reproduce byte-for-byte (see [`number_to_js_string`]).
    fn to_js_string(&self) -> Option<String> {
        match self {
            Const::Undefined => Some("undefined".to_string()),
            Const::Null => Some("null".to_string()),
            Const::Bool(value) => Some(if *value { "true" } else { "false" }.to_string()),
            Const::Number(value) => number_to_js_string(*value),
            Const::String(value) => Some(value.clone()),
        }
    }

    /// ECMAScript `ToNumber`. String coercion is not folded: the numeric
    /// string grammar (leading/trailing whitespace, hex, `Infinity`, empty
    /// string) is wide enough that a partial port would fold some inputs
    /// wrongly.
    fn to_number(&self) -> Option<f64> {
        match self {
            Const::Undefined => Some(f64::NAN),
            Const::Null => Some(0.0),
            Const::Bool(value) => Some(if *value { 1.0 } else { 0.0 }),
            Const::Number(value) => Some(*value),
            Const::String(_) => None,
        }
    }
}

/// `String(number)` for the values whose JavaScript spelling this compiler
/// reproduces exactly: the non-finite names and integers up to
/// `Number.MAX_SAFE_INTEGER`. Fractional values and the exponent-notation
/// range are left unfolded rather than risk a Rust/JavaScript formatting
/// divergence.
fn number_to_js_string(value: f64) -> Option<String> {
    if value.is_nan() || value.is_infinite() {
        return Some(format_number(value));
    }
    if value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0 {
        return Some(format_number(value));
    }
    None
}

/// ECMAScript `ToInt32`.
fn to_int32(value: f64) -> i32 {
    if !value.is_finite() || value == 0.0 {
        return 0;
    }
    let truncated = value.trunc();
    let wrapped = truncated.rem_euclid(4_294_967_296.0);
    if wrapped >= 2_147_483_648.0 {
        (wrapped - 4_294_967_296.0) as i32
    } else {
        wrapped as i32
    }
}

/// ECMAScript `ToUint32`.
fn to_uint32(value: f64) -> u32 {
    to_int32(value) as u32
}

/// Evaluates `expression` to a primitive, or `None` when it is not a
/// side-effect-free constant this module can reproduce.
pub(crate) fn evaluate(expression: &Expression<'_>, env: &ConstantEnv) -> Option<Const> {
    match expression {
        Expression::NullLiteral(_) => Some(Const::Null),
        Expression::BooleanLiteral(literal) => Some(Const::Bool(literal.value)),
        Expression::NumericLiteral(literal) => Some(Const::Number(literal.value)),
        Expression::StringLiteral(literal) => Some(Const::String(literal.value.to_string())),
        Expression::Identifier(identifier) => env.get(&identifier.span.start).cloned(),
        Expression::TemplateLiteral(template) => {
            let mut out = String::new();
            for (index, quasi) in template.quasis.iter().enumerate() {
                // A cooked value of `None` means an illegal escape sequence,
                // which only a tagged template may observe.
                out.push_str(quasi.value.cooked.as_ref()?.as_str());
                if let Some(expression) = template.expressions.get(index) {
                    out.push_str(&evaluate(expression, env)?.to_js_string()?);
                }
            }
            Some(Const::String(out))
        }
        Expression::UnaryExpression(unary) => {
            if unary.operator == UnaryOperator::Void {
                // `void` discards its operand's value but not its effects.
                return evaluate(&unary.argument, env).map(|_| Const::Undefined);
            }
            let argument = evaluate(&unary.argument, env)?;
            match unary.operator {
                UnaryOperator::LogicalNot => Some(Const::Bool(!argument.truthy())),
                UnaryOperator::Typeof => Some(Const::String(argument.type_of().to_string())),
                UnaryOperator::UnaryPlus => Some(Const::Number(argument.to_number()?)),
                UnaryOperator::UnaryNegation => Some(Const::Number(-argument.to_number()?)),
                UnaryOperator::BitwiseNot => {
                    Some(Const::Number(f64::from(!to_int32(argument.to_number()?))))
                }
                UnaryOperator::Void | UnaryOperator::Delete => None,
            }
        }
        Expression::BinaryExpression(binary) => {
            let left = evaluate(&binary.left, env)?;
            let right = evaluate(&binary.right, env)?;
            binary_value(&left, binary.operator, &right)
        }
        Expression::LogicalExpression(logical) => {
            let left = evaluate(&logical.left, env)?;
            let short_circuits = match logical.operator {
                LogicalOperator::And => !left.truthy(),
                LogicalOperator::Or => left.truthy(),
                LogicalOperator::Coalesce => !matches!(left, Const::Null | Const::Undefined),
            };
            if short_circuits {
                Some(left)
            } else {
                evaluate(&logical.right, env)
            }
        }
        Expression::ConditionalExpression(conditional) => {
            let test = evaluate(&conditional.test, env)?;
            if test.truthy() {
                evaluate(&conditional.consequent, env)
            } else {
                evaluate(&conditional.alternate, env)
            }
        }
        _ => None,
    }
}

fn binary_value(left: &Const, operator: BinaryOperator, right: &Const) -> Option<Const> {
    match operator {
        BinaryOperator::Addition => match (left, right) {
            // String concatenation whenever either side is already a string;
            // otherwise both sides coerce to numbers.
            (Const::String(_), _) | (_, Const::String(_)) => Some(Const::String(format!(
                "{}{}",
                left.to_js_string()?,
                right.to_js_string()?
            ))),
            _ => Some(Const::Number(left.to_number()? + right.to_number()?)),
        },
        BinaryOperator::Subtraction => Some(Const::Number(left.to_number()? - right.to_number()?)),
        BinaryOperator::Multiplication => {
            Some(Const::Number(left.to_number()? * right.to_number()?))
        }
        BinaryOperator::Division => Some(Const::Number(left.to_number()? / right.to_number()?)),
        BinaryOperator::Remainder => Some(Const::Number(js_remainder(
            left.to_number()?,
            right.to_number()?,
        ))),
        BinaryOperator::Exponential => Some(Const::Number(js_exponent(
            left.to_number()?,
            right.to_number()?,
        ))),
        BinaryOperator::StrictEquality => Some(Const::Bool(strict_equals(left, right)?)),
        BinaryOperator::StrictInequality => Some(Const::Bool(!strict_equals(left, right)?)),
        BinaryOperator::Equality => Some(Const::Bool(loose_equals(left, right)?)),
        BinaryOperator::Inequality => Some(Const::Bool(!loose_equals(left, right)?)),
        BinaryOperator::LessThan
        | BinaryOperator::LessEqualThan
        | BinaryOperator::GreaterThan
        | BinaryOperator::GreaterEqualThan => compare(left, operator, right),
        BinaryOperator::BitwiseAnd => Some(Const::Number(f64::from(
            to_int32(left.to_number()?) & to_int32(right.to_number()?),
        ))),
        BinaryOperator::BitwiseOR => Some(Const::Number(f64::from(
            to_int32(left.to_number()?) | to_int32(right.to_number()?),
        ))),
        BinaryOperator::BitwiseXOR => Some(Const::Number(f64::from(
            to_int32(left.to_number()?) ^ to_int32(right.to_number()?),
        ))),
        BinaryOperator::ShiftLeft => Some(Const::Number(f64::from(
            to_int32(left.to_number()?) << (to_uint32(right.to_number()?) & 31),
        ))),
        BinaryOperator::ShiftRight => Some(Const::Number(f64::from(
            to_int32(left.to_number()?) >> (to_uint32(right.to_number()?) & 31),
        ))),
        BinaryOperator::ShiftRightZeroFill => Some(Const::Number(f64::from(
            to_uint32(left.to_number()?) >> (to_uint32(right.to_number()?) & 31),
        ))),
        BinaryOperator::In | BinaryOperator::Instanceof => None,
    }
}

/// `%` is a remainder that keeps the dividend's sign, unlike Rust's `%` on
/// floats only in the infinity cases, which are spelled out here.
fn js_remainder(left: f64, right: f64) -> f64 {
    if left.is_nan() || right.is_nan() || left.is_infinite() || right == 0.0 {
        return f64::NAN;
    }
    if right.is_infinite() {
        return left;
    }
    left % right
}

/// `**` differs from Rust's `powf` for a `NaN` exponent base case.
fn js_exponent(left: f64, right: f64) -> f64 {
    if right.is_nan() {
        return f64::NAN;
    }
    if right == 0.0 {
        return 1.0;
    }
    // `(±1) ** ±Infinity` is NaN in JavaScript, but 1 in IEEE-754/Rust.
    if right.is_infinite() && left.abs() == 1.0 {
        return f64::NAN;
    }
    left.powf(right)
}

fn strict_equals(left: &Const, right: &Const) -> Option<bool> {
    Some(match (left, right) {
        (Const::Undefined, Const::Undefined) | (Const::Null, Const::Null) => true,
        (Const::Bool(left), Const::Bool(right)) => left == right,
        // `NaN !== NaN` and `-0 === 0` both fall out of the float compare.
        (Const::Number(left), Const::Number(right)) => left == right,
        (Const::String(left), Const::String(right)) => left == right,
        _ => false,
    })
}

fn loose_equals(left: &Const, right: &Const) -> Option<bool> {
    Some(match (left, right) {
        (Const::Undefined | Const::Null, Const::Undefined | Const::Null) => true,
        (Const::Undefined | Const::Null, _) | (_, Const::Undefined | Const::Null) => false,
        (Const::String(left), Const::String(right)) => left == right,
        // Every remaining pair coerces to numbers, and string coercion is
        // outside what this module folds.
        _ => left.to_number()? == right.to_number()?,
    })
}

fn compare(left: &Const, operator: BinaryOperator, right: &Const) -> Option<Const> {
    if let (Const::String(left), Const::String(right)) = (left, right) {
        // JavaScript compares strings by UTF-16 code unit; Rust's `str` order
        // is UTF-8 byte order. The two agree on ASCII, so only ASCII pairs
        // fold.
        if !left.is_ascii() || !right.is_ascii() {
            return None;
        }
        return Some(Const::Bool(match operator {
            BinaryOperator::LessThan => left < right,
            BinaryOperator::LessEqualThan => left <= right,
            BinaryOperator::GreaterThan => left > right,
            _ => left >= right,
        }));
    }
    let left = left.to_number()?;
    let right = right.to_number()?;
    if left.is_nan() || right.is_nan() {
        // Every relational operator is false when either side is NaN.
        return Some(Const::Bool(false));
    }
    Some(Const::Bool(match operator {
        BinaryOperator::LessThan => left < right,
        BinaryOperator::LessEqualThan => left <= right,
        BinaryOperator::GreaterThan => left > right,
        _ => left >= right,
    }))
}

/// Whether `expression` is known truthy or falsy. Wider than [`evaluate`]:
/// an object, array, function, class, or JSX literal has no constant value
/// but is always truthy.
pub(crate) fn truthiness(expression: &Expression<'_>, env: &ConstantEnv) -> Option<bool> {
    match expression {
        Expression::ObjectExpression(_)
        | Expression::ArrayExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_)
        | Expression::ClassExpression(_)
        | Expression::JSXElement(_)
        | Expression::JSXFragment(_) => Some(true),
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            truthiness(&unary.argument, env).map(|value| !value)
        }
        _ => evaluate(expression, env).map(|value| value.truthy()),
    }
}

/// The element count of an array literal with no spread elements, which is
/// what `<For each>` and friends need to recognize an empty list.
pub(crate) fn array_literal_len(expression: &Expression<'_>) -> Option<usize> {
    let Expression::ArrayExpression(array) = expression else {
        return None;
    };
    if array.elements.iter().any(|element| {
        matches!(
            element,
            oxc_ast::ast::ArrayExpressionElement::SpreadElement(_)
        )
    }) {
        return None;
    }
    Some(array.elements.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn number(value: f64) -> Const {
        Const::Number(value)
    }

    #[test]
    fn to_int32_wraps_like_the_specification() {
        assert_eq!(to_int32(4_294_967_296.0), 0);
        assert_eq!(to_int32(4_294_967_297.0), 1);
        assert_eq!(to_int32(-1.0), -1);
        assert_eq!(to_int32(2_147_483_648.0), i32::MIN);
        assert_eq!(to_int32(f64::NAN), 0);
        assert_eq!(to_int32(f64::INFINITY), 0);
        assert_eq!(to_uint32(-1.0), u32::MAX);
    }

    #[test]
    fn number_strings_fold_only_where_rust_and_javascript_agree() {
        assert_eq!(number_to_js_string(42.0).as_deref(), Some("42"));
        assert_eq!(number_to_js_string(f64::NAN).as_deref(), Some("NaN"));
        assert_eq!(number_to_js_string(0.5), None);
        assert_eq!(number_to_js_string(1e21), None);
    }

    #[test]
    fn arithmetic_edge_cases_match_javascript() {
        let Some(Const::Number(remainder)) =
            binary_value(&number(5.0), BinaryOperator::Remainder, &number(0.0))
        else {
            panic!("5 % 0 folds to a number");
        };
        assert!(remainder.is_nan(), "5 % 0 is NaN in JavaScript");
        let Some(Const::Number(power)) = binary_value(
            &number(1.0),
            BinaryOperator::Exponential,
            &number(f64::INFINITY),
        ) else {
            panic!("1 ** Infinity folds to a number");
        };
        assert!(power.is_nan(), "1 ** Infinity is NaN in JavaScript");
        assert_eq!(
            binary_value(&Const::Null, BinaryOperator::Addition, &number(1.0)),
            Some(number(1.0))
        );
        assert_eq!(
            binary_value(
                &Const::String("a".into()),
                BinaryOperator::Addition,
                &number(1.0)
            ),
            Some(Const::String("a1".into()))
        );
    }

    #[test]
    fn equality_follows_the_specification_warts() {
        assert_eq!(
            strict_equals(&number(f64::NAN), &number(f64::NAN)),
            Some(false)
        );
        assert_eq!(strict_equals(&number(-0.0), &number(0.0)), Some(true));
        assert_eq!(loose_equals(&Const::Null, &Const::Undefined), Some(true));
        assert_eq!(loose_equals(&Const::Null, &number(0.0)), Some(false));
        assert_eq!(loose_equals(&Const::Bool(true), &number(1.0)), Some(true));
    }

    #[test]
    fn relational_comparison_declines_non_ascii_strings() {
        assert_eq!(
            compare(
                &Const::String("a".into()),
                BinaryOperator::LessThan,
                &Const::String("b".into())
            ),
            Some(Const::Bool(true))
        );
        assert_eq!(
            compare(
                &Const::String("é".into()),
                BinaryOperator::LessThan,
                &Const::String("b".into())
            ),
            None
        );
        assert_eq!(
            compare(&number(f64::NAN), BinaryOperator::LessThan, &number(1.0)),
            Some(Const::Bool(false))
        );
    }
}
