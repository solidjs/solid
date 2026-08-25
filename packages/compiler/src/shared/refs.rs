use oxc_allocator::CloneIn;
use oxc_ast::ast::{Expression, ObjectPropertyKind, Statement, VariableDeclarationKind};
use oxc_span::Span;

use crate::dom::element::AstDomTransform;

/// Target-neutral hooks for the component `ref` protocol (Babel's ref
/// branches in `shared/component.ts`, applied by every generate mode).
pub(crate) trait RefPropertyContext<'a> {
    fn allocator(&self) -> &'a oxc_allocator::Allocator;
    /// `binding.kind === "const" || binding.kind === "module"` for a plain
    /// identifier ref target.
    fn is_const_ref_binding(&self, name: &str) -> bool;
    fn next_ref_id(&mut self) -> String;
    fn mark_uses_apply_ref(&mut self);
}

impl<'a> RefPropertyContext<'a> for AstDomTransform<'a, '_> {
    fn allocator(&self) -> &'a oxc_allocator::Allocator {
        self.allocator
    }

    fn is_const_ref_binding(&self, name: &str) -> bool {
        self.bindings.is_const(name)
    }

    fn next_ref_id(&mut self) -> String {
        AstDomTransform::next_ref_id(self)
    }

    fn mark_uses_apply_ref(&mut self) {
        self.template_state.uses_apply_ref = true;
    }
}

pub(crate) fn component_ref_property<'a, C: RefPropertyContext<'a>>(
    ctx: &mut C,
    span: Span,
    value: Expression<'a>,
    setup: &mut std::vec::Vec<Statement<'a>>,
) -> Option<ObjectPropertyKind<'a>> {
    let allocator = ctx.allocator();
    let ast = crate::shared::ast_builder::AstBuilder::new(allocator);
    let object_property =
        |value| crate::shared::ast::object_property(allocator, span, "ref", value);
    let identifier = |name: &str| ast.expression_identifier(span, ast.ident(name));
    let apply_ref_call = |ref_identifier: Expression<'a>| {
        ast.expression_call(
            span,
            identifier("_$applyRef"),
            None,
            ast.vec_from_array([
                crate::shared::ast::expression_to_argument(ref_identifier),
                crate::shared::ast::expression_to_argument(identifier("r$")),
            ]),
            false,
        )
    };

    if let Expression::Identifier(id) = &value {
        let name = id.name.to_string();
        if ctx.is_const_ref_binding(&name) {
            return Some(object_property(value));
        }
    }
    if matches!(
        value,
        Expression::ArrowFunctionExpression(_)
            | Expression::FunctionExpression(_)
            | Expression::ArrayExpression(_)
    ) {
        return Some(object_property(value));
    }

    if let Expression::CallExpression(_) = &value {
        ctx.mark_uses_apply_ref();
        let ref_id = ctx.next_ref_id();
        setup.push(crate::shared::ast::variable_statement(
            allocator,
            span,
            VariableDeclarationKind::Var,
            &ref_id,
            value,
        ));
        let mut statements = ast.vec();
        let typeof_ref = callable_test(allocator, span, identifier(&ref_id));
        statements.push(ast.statement_expression(
            span,
            ast.expression_logical(
                span,
                typeof_ref,
                oxc_ast::ast::LogicalOperator::And,
                apply_ref_call(identifier(&ref_id)),
            ),
        ));
        return Some(crate::shared::ast::object_method_property(
            allocator, span, "ref", "r$", statements,
        ));
    }

    let assign_fallback = assignment_fallback(allocator, span, &value, identifier("r$"))?;
    let ref_id = ctx.next_ref_id();
    let mut statements = ast.vec();
    statements.push(crate::shared::ast::variable_statement(
        allocator,
        span,
        VariableDeclarationKind::Var,
        &ref_id,
        value,
    ));
    let test = callable_test(allocator, span, identifier(&ref_id));
    ctx.mark_uses_apply_ref();
    statements.push(ast.statement_expression(
        span,
        ast.expression_conditional(
            span,
            test,
            apply_ref_call(identifier(&ref_id)),
            assign_fallback,
        ),
    ));
    Some(crate::shared::ast::object_method_property(
        allocator, span, "ref", "r$", statements,
    ))
}

pub(crate) fn ref_assignment_fallback<'a>(
    ctx: &AstDomTransform<'a, '_>,
    span: Span,
    value: &Expression<'a>,
    assignment_value: Expression<'a>,
) -> Option<Expression<'a>> {
    assignment_fallback(ctx.allocator, span, value, assignment_value)
}

/// `typeof <value> === "function" || Array.isArray(<value>)`
pub(crate) fn callable_test<'a>(
    allocator: &'a oxc_allocator::Allocator,
    span: Span,
    value: Expression<'a>,
) -> Expression<'a> {
    let ast = crate::shared::ast_builder::AstBuilder::new(allocator);
    let typeof_ref = ast.expression_binary(
        span,
        ast.expression_unary(
            span,
            oxc_ast::ast::UnaryOperator::Typeof,
            value.clone_in(allocator),
        ),
        oxc_ast::ast::BinaryOperator::StrictEquality,
        ast.expression_string_literal(span, ast.str("function"), None),
    );
    let is_array_callee = Expression::StaticMemberExpression(ast.alloc_static_member_expression(
        span,
        ast.expression_identifier(span, ast.ident("Array")),
        ast.identifier_name(span, ast.ident("isArray")),
        false,
    ));
    let array_is_array = ast.expression_call(
        span,
        is_array_callee,
        None,
        ast.vec1(crate::shared::ast::expression_to_argument(value)),
        false,
    );
    ast.expression_logical(
        span,
        typeof_ref,
        oxc_ast::ast::LogicalOperator::Or,
        array_is_array,
    )
}

/// The `<value> = <assignment_value>` fallback for a non-callable ref target,
/// guarded for optional members.
pub(crate) fn assignment_fallback<'a>(
    allocator: &'a oxc_allocator::Allocator,
    span: Span,
    value: &Expression<'a>,
    assignment_value: Expression<'a>,
) -> Option<Expression<'a>> {
    let ast = crate::shared::ast_builder::AstBuilder::new(allocator);
    let static_member_target = |member: &oxc_ast::ast::StaticMemberExpression<'a>| {
        oxc_ast::ast::AssignmentTarget::StaticMemberExpression(oxc_allocator::Box::new_in(
            member.clone_in(allocator),
            &allocator,
        ))
    };
    match value {
        Expression::Identifier(identifier) => Some(ast.expression_assignment(
            span,
            oxc_ast::ast::AssignmentOperator::Assign,
            oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(
                ast.alloc_identifier_reference(identifier.span, ast.ident(&identifier.name)),
            ),
            assignment_value,
        )),
        Expression::StaticMemberExpression(member) if member.optional => {
            let Expression::Identifier(object) = &member.object else {
                return None;
            };
            let test = ast.expression_unary(
                span,
                oxc_ast::ast::UnaryOperator::LogicalNot,
                ast.expression_unary(
                    span,
                    oxc_ast::ast::UnaryOperator::LogicalNot,
                    ast.expression_identifier(span, ast.ident(&object.name)),
                ),
            );
            let mut non_optional = member.clone_in(allocator);
            non_optional.optional = false;
            let assign = ast.expression_assignment(
                span,
                oxc_ast::ast::AssignmentOperator::Assign,
                static_member_target(&non_optional),
                assignment_value,
            );
            Some(ast.expression_logical(span, test, oxc_ast::ast::LogicalOperator::And, assign))
        }
        Expression::StaticMemberExpression(member) => Some(ast.expression_assignment(
            span,
            oxc_ast::ast::AssignmentOperator::Assign,
            static_member_target(member),
            assignment_value,
        )),
        Expression::ComputedMemberExpression(member) if !member.optional => {
            Some(ast.expression_assignment(
                span,
                oxc_ast::ast::AssignmentOperator::Assign,
                oxc_ast::ast::AssignmentTarget::ComputedMemberExpression(
                    member.clone_in(allocator),
                ),
                assignment_value,
            ))
        }
        Expression::ChainExpression(chain) => {
            let oxc_ast::ast::ChainElement::StaticMemberExpression(member) = &chain.expression
            else {
                return None;
            };
            if !member.optional {
                return None;
            }
            let Expression::Identifier(object) = &member.object else {
                return None;
            };
            let test = ast.expression_unary(
                span,
                oxc_ast::ast::UnaryOperator::LogicalNot,
                ast.expression_unary(
                    span,
                    oxc_ast::ast::UnaryOperator::LogicalNot,
                    ast.expression_identifier(span, ast.ident(&object.name)),
                ),
            );
            let mut non_optional = member.clone_in(allocator);
            non_optional.optional = false;
            let assign = ast.expression_assignment(
                span,
                oxc_ast::ast::AssignmentOperator::Assign,
                static_member_target(&non_optional),
                assignment_value,
            );
            Some(ast.expression_logical(span, test, oxc_ast::ast::LogicalOperator::And, assign))
        }
        _ => None,
    }
}
