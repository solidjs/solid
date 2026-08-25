use oxc_ast::ast::{ArrayExpressionElement, Expression};

pub(crate) fn expression_to_array_element<'a>(
    expression: Expression<'a>,
) -> ArrayExpressionElement<'a> {
    match expression {
        Expression::BooleanLiteral(value) => ArrayExpressionElement::BooleanLiteral(value),
        Expression::NullLiteral(value) => ArrayExpressionElement::NullLiteral(value),
        Expression::NumericLiteral(value) => ArrayExpressionElement::NumericLiteral(value),
        Expression::BigIntLiteral(value) => ArrayExpressionElement::BigIntLiteral(value),
        Expression::RegExpLiteral(value) => ArrayExpressionElement::RegExpLiteral(value),
        Expression::StringLiteral(value) => ArrayExpressionElement::StringLiteral(value),
        Expression::TemplateLiteral(value) => ArrayExpressionElement::TemplateLiteral(value),
        Expression::Identifier(value) => ArrayExpressionElement::Identifier(value),
        Expression::ImportMeta(value) => ArrayExpressionElement::ImportMeta(value),
        Expression::NewTarget(value) => ArrayExpressionElement::NewTarget(value),
        Expression::Super(value) => ArrayExpressionElement::Super(value),
        Expression::ArrayExpression(value) => ArrayExpressionElement::ArrayExpression(value),
        Expression::ThisExpression(value) => ArrayExpressionElement::ThisExpression(value),
        Expression::CallExpression(value) => ArrayExpressionElement::CallExpression(value),
        Expression::ChainExpression(value) => ArrayExpressionElement::ChainExpression(value),
        Expression::ClassExpression(value) => ArrayExpressionElement::ClassExpression(value),
        Expression::ObjectExpression(value) => ArrayExpressionElement::ObjectExpression(value),
        Expression::ArrowFunctionExpression(value) => {
            ArrayExpressionElement::ArrowFunctionExpression(value)
        }
        Expression::AssignmentExpression(value) => {
            ArrayExpressionElement::AssignmentExpression(value)
        }
        Expression::AwaitExpression(value) => ArrayExpressionElement::AwaitExpression(value),
        Expression::BinaryExpression(value) => ArrayExpressionElement::BinaryExpression(value),
        Expression::StaticMemberExpression(value) => {
            ArrayExpressionElement::StaticMemberExpression(value)
        }
        Expression::ComputedMemberExpression(value) => {
            ArrayExpressionElement::ComputedMemberExpression(value)
        }
        Expression::PrivateFieldExpression(value) => {
            ArrayExpressionElement::PrivateFieldExpression(value)
        }
        Expression::FunctionExpression(value) => ArrayExpressionElement::FunctionExpression(value),
        Expression::ImportExpression(value) => ArrayExpressionElement::ImportExpression(value),
        Expression::LogicalExpression(value) => ArrayExpressionElement::LogicalExpression(value),
        Expression::NewExpression(value) => ArrayExpressionElement::NewExpression(value),
        Expression::ConditionalExpression(value) => {
            ArrayExpressionElement::ConditionalExpression(value)
        }
        Expression::ParenthesizedExpression(value) => {
            ArrayExpressionElement::ParenthesizedExpression(value)
        }
        Expression::PrivateInExpression(value) => {
            ArrayExpressionElement::PrivateInExpression(value)
        }
        Expression::SequenceExpression(value) => ArrayExpressionElement::SequenceExpression(value),
        Expression::TaggedTemplateExpression(value) => {
            ArrayExpressionElement::TaggedTemplateExpression(value)
        }
        Expression::UnaryExpression(value) => ArrayExpressionElement::UnaryExpression(value),
        Expression::UpdateExpression(value) => ArrayExpressionElement::UpdateExpression(value),
        Expression::YieldExpression(value) => ArrayExpressionElement::YieldExpression(value),
        Expression::JSXElement(value) => ArrayExpressionElement::JSXElement(value),
        Expression::JSXFragment(value) => ArrayExpressionElement::JSXFragment(value),
        Expression::TSAsExpression(value) => ArrayExpressionElement::TSAsExpression(value),
        Expression::TSSatisfiesExpression(value) => {
            ArrayExpressionElement::TSSatisfiesExpression(value)
        }
        Expression::TSTypeAssertion(value) => ArrayExpressionElement::TSTypeAssertion(value),
        Expression::TSNonNullExpression(value) => {
            ArrayExpressionElement::TSNonNullExpression(value)
        }
        Expression::TSInstantiationExpression(value) => {
            ArrayExpressionElement::TSInstantiationExpression(value)
        }
        Expression::V8IntrinsicExpression(value) => {
            ArrayExpressionElement::V8IntrinsicExpression(value)
        }
    }
}
