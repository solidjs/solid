//! Compatibility facade for constructing Oxc AST nodes.
//!
//! Oxc 0.138 moved node construction from methods on `AstBuilder` to
//! constructors on the AST node types, and 0.144 removed the old methods.
//! Keeping the compiler's construction vocabulary in one facade avoids
//! scattering allocator and concise-arrow conversions throughout every
//! lowering pass.

use oxc_allocator::{Allocator, ArenaBox, ArenaVec};
use oxc_ast::{ast::*, builder::AstBuilder as OxcAstBuilder};
use oxc_span::Span;
use oxc_str::{Ident, Str};
use oxc_syntax::{
    number::NumberBase,
    operator::{AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator},
};

#[derive(Clone, Copy)]
pub(crate) struct AstBuilder<'a> {
    allocator: &'a Allocator,
}

// Several helpers are only reached from the node-gated passes (directives,
// lazy, refresh); the default-feature clippy config still flags genuinely
// dead code.
#[cfg_attr(not(feature = "node"), allow(dead_code))]
impl<'a> AstBuilder<'a> {
    pub(crate) fn new(allocator: &'a Allocator) -> Self {
        Self { allocator }
    }

    fn inner(&self) -> OxcAstBuilder<'a> {
        OxcAstBuilder::new(self.allocator)
    }

    pub(crate) fn vec<T>(&self) -> ArenaVec<'a, T> {
        ArenaVec::new_in(&self.inner())
    }

    pub(crate) fn vec1<T>(&self, value: T) -> ArenaVec<'a, T> {
        ArenaVec::from_value_in(value, &self.inner())
    }

    pub(crate) fn vec_with_capacity<T>(&self, capacity: usize) -> ArenaVec<'a, T> {
        ArenaVec::with_capacity_in(capacity, &self.inner())
    }

    pub(crate) fn vec_from_iter<T, I>(&self, iter: I) -> ArenaVec<'a, T>
    where
        I: IntoIterator<Item = T>,
    {
        ArenaVec::from_iter_in(iter, &self.inner())
    }

    pub(crate) fn vec_from_array<T, const N: usize>(&self, values: [T; N]) -> ArenaVec<'a, T> {
        ArenaVec::from_array_in(values, &self.inner())
    }

    pub(crate) fn ident(&self, value: &str) -> Ident<'a> {
        Ident::from_str_in(value, &self.inner())
    }

    pub(crate) fn str(&self, value: &str) -> Str<'a> {
        Str::from_str_in(value, &self.inner())
    }

    pub(crate) fn alloc<T>(&self, value: T) -> ArenaBox<'a, T> {
        ArenaBox::new_in(value, &self.inner())
    }

    pub(crate) fn expression_boolean_literal(&self, span: Span, value: bool) -> Expression<'a> {
        Expression::new_boolean_literal(span, value, &self.inner())
    }

    pub(crate) fn expression_null_literal(&self, span: Span) -> Expression<'a> {
        Expression::new_null_literal(span, &self.inner())
    }

    pub(crate) fn expression_numeric_literal(
        &self,
        span: Span,
        value: f64,
        raw: Option<Str<'a>>,
        base: NumberBase,
    ) -> Expression<'a> {
        Expression::new_numeric_literal(span, value, raw, base, &self.inner())
    }

    pub(crate) fn expression_string_literal(
        &self,
        span: Span,
        value: impl Into<Str<'a>>,
        raw: Option<Str<'a>>,
    ) -> Expression<'a> {
        Expression::new_string_literal(span, value, raw, &self.inner())
    }

    pub(crate) fn expression_template_literal(
        &self,
        span: Span,
        quasis: ArenaVec<'a, TemplateElement<'a>>,
        expressions: ArenaVec<'a, Expression<'a>>,
    ) -> Expression<'a> {
        Expression::new_template_literal(span, quasis, expressions, &self.inner())
    }

    pub(crate) fn expression_identifier(
        &self,
        span: Span,
        name: impl Into<Ident<'a>>,
    ) -> Expression<'a> {
        Expression::new_identifier(span, name, &self.inner())
    }

    pub(crate) fn expression_array(
        &self,
        span: Span,
        elements: ArenaVec<'a, ArrayExpressionElement<'a>>,
    ) -> Expression<'a> {
        Expression::new_array_expression(span, elements, &self.inner())
    }

    pub(crate) fn expression_assignment(
        &self,
        span: Span,
        operator: AssignmentOperator,
        left: AssignmentTarget<'a>,
        right: Expression<'a>,
    ) -> Expression<'a> {
        Expression::new_assignment_expression(span, operator, left, right, &self.inner())
    }

    pub(crate) fn expression_binary(
        &self,
        span: Span,
        left: Expression<'a>,
        operator: BinaryOperator,
        right: Expression<'a>,
    ) -> Expression<'a> {
        Expression::new_binary_expression(span, left, operator, right, &self.inner())
    }

    pub(crate) fn expression_call(
        &self,
        span: Span,
        callee: Expression<'a>,
        type_arguments: Option<ArenaBox<'a, TSTypeParameterInstantiation<'a>>>,
        arguments: ArenaVec<'a, Argument<'a>>,
        optional: bool,
    ) -> Expression<'a> {
        Expression::new_call_expression(
            span,
            callee,
            type_arguments,
            arguments,
            optional,
            &self.inner(),
        )
    }

    pub(crate) fn expression_chain(
        &self,
        span: Span,
        expression: ChainElement<'a>,
    ) -> Expression<'a> {
        Expression::new_chain_expression(span, expression, &self.inner())
    }

    pub(crate) fn expression_conditional(
        &self,
        span: Span,
        test: Expression<'a>,
        consequent: Expression<'a>,
        alternate: Expression<'a>,
    ) -> Expression<'a> {
        Expression::new_conditional_expression(span, test, consequent, alternate, &self.inner())
    }

    pub(crate) fn expression_logical(
        &self,
        span: Span,
        left: Expression<'a>,
        operator: LogicalOperator,
        right: Expression<'a>,
    ) -> Expression<'a> {
        Expression::new_logical_expression(span, left, operator, right, &self.inner())
    }

    pub(crate) fn expression_object(
        &self,
        span: Span,
        properties: ArenaVec<'a, ObjectPropertyKind<'a>>,
    ) -> Expression<'a> {
        Expression::new_object_expression(span, properties, &self.inner())
    }

    pub(crate) fn expression_sequence(
        &self,
        span: Span,
        expressions: ArenaVec<'a, Expression<'a>>,
    ) -> Expression<'a> {
        Expression::new_sequence_expression(span, expressions, &self.inner())
    }

    pub(crate) fn expression_this(&self, span: Span) -> Expression<'a> {
        Expression::new_this_expression(span, &self.inner())
    }

    pub(crate) fn expression_unary(
        &self,
        span: Span,
        operator: UnaryOperator,
        argument: Expression<'a>,
    ) -> Expression<'a> {
        Expression::new_unary_expression(span, operator, argument, &self.inner())
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn expression_function(
        &self,
        span: Span,
        r#type: FunctionType,
        id: Option<BindingIdentifier<'a>>,
        generator: bool,
        r#async: bool,
        declare: bool,
        type_parameters: Option<ArenaBox<'a, TSTypeParameterDeclaration<'a>>>,
        this_param: Option<ArenaBox<'a, TSThisParameter<'a>>>,
        params: FormalParameters<'a>,
        return_type: Option<ArenaBox<'a, TSTypeAnnotation<'a>>>,
        body: Option<FunctionBody<'a>>,
    ) -> Expression<'a> {
        Expression::new_function_expression(
            span,
            r#type,
            id,
            generator,
            r#async,
            declare,
            type_parameters,
            this_param,
            ArenaBox::new_in(params, &self.inner()),
            return_type,
            body.map(|body| ArenaBox::new_in(body, &self.inner())),
            &self.inner(),
        )
    }

    pub(crate) fn expression_import_meta(&self, span: Span) -> Expression<'a> {
        Expression::new_import_meta(span, &self.inner())
    }

    pub(crate) fn statement_block(
        &self,
        span: Span,
        body: ArenaVec<'a, Statement<'a>>,
    ) -> Statement<'a> {
        Statement::new_block_statement(span, body, &self.inner())
    }

    pub(crate) fn statement_empty(&self, span: Span) -> Statement<'a> {
        Statement::new_empty_statement(span, &self.inner())
    }

    pub(crate) fn statement_expression(
        &self,
        span: Span,
        expression: Expression<'a>,
    ) -> Statement<'a> {
        Statement::new_expression_statement(span, expression, &self.inner())
    }

    pub(crate) fn statement_if(
        &self,
        span: Span,
        test: Expression<'a>,
        consequent: Statement<'a>,
        alternate: Option<Statement<'a>>,
    ) -> Statement<'a> {
        Statement::new_if_statement(span, test, consequent, alternate, &self.inner())
    }

    pub(crate) fn statement_return(
        &self,
        span: Span,
        argument: Option<Expression<'a>>,
    ) -> Statement<'a> {
        Statement::new_return_statement(span, argument, &self.inner())
    }

    pub(crate) fn identifier_name(
        &self,
        span: Span,
        name: impl Into<Ident<'a>>,
    ) -> IdentifierName<'a> {
        IdentifierName::new(span, name, &self.inner())
    }

    pub(crate) fn alloc_identifier_reference(
        &self,
        span: Span,
        name: impl Into<Ident<'a>>,
    ) -> ArenaBox<'a, IdentifierReference<'a>> {
        IdentifierReference::boxed(span, name, &self.inner())
    }

    pub(crate) fn binding_identifier(
        &self,
        span: Span,
        name: impl Into<Ident<'a>>,
    ) -> BindingIdentifier<'a> {
        BindingIdentifier::new(span, name, &self.inner())
    }

    pub(crate) fn binding_pattern_binding_identifier(
        &self,
        span: Span,
        name: impl Into<Ident<'a>>,
    ) -> BindingPattern<'a> {
        BindingPattern::new_binding_identifier(span, name, &self.inner())
    }

    pub(crate) fn binding_pattern_object_pattern(
        &self,
        span: Span,
        properties: ArenaVec<'a, BindingProperty<'a>>,
        rest: Option<ArenaBox<'a, BindingRestElement<'a>>>,
    ) -> BindingPattern<'a> {
        BindingPattern::new_object_pattern(span, properties, rest, &self.inner())
    }

    pub(crate) fn binding_pattern_array_pattern(
        &self,
        span: Span,
        elements: ArenaVec<'a, Option<BindingPattern<'a>>>,
        rest: Option<ArenaBox<'a, BindingRestElement<'a>>>,
    ) -> BindingPattern<'a> {
        BindingPattern::new_array_pattern(span, elements, rest, &self.inner())
    }

    pub(crate) fn binding_property(
        &self,
        span: Span,
        key: PropertyKey<'a>,
        value: BindingPattern<'a>,
        shorthand: bool,
        computed: bool,
    ) -> BindingProperty<'a> {
        BindingProperty::new(span, key, value, shorthand, computed, &self.inner())
    }

    pub(crate) fn formal_parameters(
        &self,
        span: Span,
        kind: FormalParameterKind,
        items: ArenaVec<'a, FormalParameter<'a>>,
        rest: Option<ArenaBox<'a, FormalParameterRest<'a>>>,
    ) -> FormalParameters<'a> {
        FormalParameters::new(span, kind, items, rest, &self.inner())
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn formal_parameter(
        &self,
        span: Span,
        decorators: ArenaVec<'a, Decorator<'a>>,
        pattern: BindingPattern<'a>,
        type_annotation: Option<ArenaBox<'a, TSTypeAnnotation<'a>>>,
        initializer: Option<ArenaBox<'a, Expression<'a>>>,
        optional: bool,
        accessibility: Option<TSAccessibility>,
        readonly: bool,
        r#override: bool,
    ) -> FormalParameter<'a> {
        FormalParameter::new(
            span,
            decorators,
            pattern,
            type_annotation,
            initializer,
            optional,
            accessibility,
            readonly,
            r#override,
            &self.inner(),
        )
    }

    pub(crate) fn function_body(
        &self,
        span: Span,
        directives: ArenaVec<'a, Directive<'a>>,
        statements: ArenaVec<'a, Statement<'a>>,
    ) -> FunctionBody<'a> {
        FunctionBody::new(span, directives, statements, &self.inner())
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn expression_arrow_function(
        &self,
        span: Span,
        expression: bool,
        r#async: bool,
        type_parameters: Option<ArenaBox<'a, TSTypeParameterDeclaration<'a>>>,
        params: FormalParameters<'a>,
        return_type: Option<ArenaBox<'a, TSTypeAnnotation<'a>>>,
        mut body: FunctionBody<'a>,
    ) -> Expression<'a> {
        let arrow_body = if expression && body.directives.is_empty() && body.statements.len() == 1 {
            match body.statements.pop().expect("arrow body length checked") {
                Statement::ExpressionStatement(statement) => statement.unbox().expression.into(),
                statement => {
                    body.statements.push(statement);
                    ArrowFunctionBody::FunctionBody(ArenaBox::new_in(body, &self.inner()))
                }
            }
        } else {
            ArrowFunctionBody::FunctionBody(ArenaBox::new_in(body, &self.inner()))
        };
        Expression::new_arrow_function_expression(
            span,
            r#async,
            type_parameters,
            ArenaBox::new_in(params, &self.inner()),
            return_type,
            arrow_body,
            &self.inner(),
        )
    }

    pub(crate) fn alloc_static_member_expression(
        &self,
        span: Span,
        object: Expression<'a>,
        property: IdentifierName<'a>,
        optional: bool,
    ) -> ArenaBox<'a, StaticMemberExpression<'a>> {
        StaticMemberExpression::boxed(span, object, property, optional, &self.inner())
    }

    pub(crate) fn alloc_string_literal(
        &self,
        span: Span,
        value: impl Into<Str<'a>>,
        raw: Option<Str<'a>>,
    ) -> ArenaBox<'a, StringLiteral<'a>> {
        StringLiteral::boxed(span, value, raw, &self.inner())
    }

    pub(crate) fn string_literal(
        &self,
        span: Span,
        value: impl Into<Str<'a>>,
        raw: Option<Str<'a>>,
    ) -> StringLiteral<'a> {
        StringLiteral::new(span, value, raw, &self.inner())
    }

    pub(crate) fn alloc_boolean_literal(
        &self,
        span: Span,
        value: bool,
    ) -> ArenaBox<'a, BooleanLiteral> {
        BooleanLiteral::boxed(span, value, &self.inner())
    }

    pub(crate) fn property_key_static_identifier(
        &self,
        span: Span,
        name: impl Into<Ident<'a>>,
    ) -> PropertyKey<'a> {
        PropertyKey::new_static_identifier(span, name, &self.inner())
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn object_property_kind_object_property(
        &self,
        span: Span,
        kind: PropertyKind,
        key: PropertyKey<'a>,
        value: Expression<'a>,
        method: bool,
        shorthand: bool,
        computed: bool,
    ) -> ObjectPropertyKind<'a> {
        ObjectPropertyKind::new_object_property(
            span,
            kind,
            key,
            value,
            method,
            shorthand,
            computed,
            &self.inner(),
        )
    }

    pub(crate) fn alloc_object_expression(
        &self,
        span: Span,
        properties: ArenaVec<'a, ObjectPropertyKind<'a>>,
    ) -> ArenaBox<'a, ObjectExpression<'a>> {
        ObjectExpression::boxed(span, properties, &self.inner())
    }

    pub(crate) fn alloc_spread_element(
        &self,
        span: Span,
        argument: Expression<'a>,
    ) -> ArenaBox<'a, SpreadElement<'a>> {
        SpreadElement::boxed(span, argument, &self.inner())
    }

    pub(crate) fn alloc_computed_member_expression(
        &self,
        span: Span,
        object: Expression<'a>,
        expression: Expression<'a>,
        optional: bool,
    ) -> ArenaBox<'a, ComputedMemberExpression<'a>> {
        ComputedMemberExpression::boxed(span, object, expression, optional, &self.inner())
    }

    pub(crate) fn alloc_block_statement(
        &self,
        span: Span,
        body: ArenaVec<'a, Statement<'a>>,
    ) -> ArenaBox<'a, BlockStatement<'a>> {
        BlockStatement::boxed(span, body, &self.inner())
    }

    pub(crate) fn variable_declarator(
        &self,
        span: Span,
        _kind: VariableDeclarationKind,
        id: BindingPattern<'a>,
        type_annotation: Option<ArenaBox<'a, TSTypeAnnotation<'a>>>,
        init: Option<Expression<'a>>,
        definite: bool,
    ) -> VariableDeclarator<'a> {
        VariableDeclarator::new(span, id, type_annotation, init, definite, &self.inner())
    }

    pub(crate) fn alloc_variable_declaration(
        &self,
        span: Span,
        kind: VariableDeclarationKind,
        declarations: ArenaVec<'a, VariableDeclarator<'a>>,
        declare: bool,
    ) -> ArenaBox<'a, VariableDeclaration<'a>> {
        VariableDeclaration::boxed(span, kind, declarations, declare, &self.inner())
    }

    pub(crate) fn import_declaration_specifier_import_specifier(
        &self,
        span: Span,
        imported: ModuleExportName<'a>,
        local: BindingIdentifier<'a>,
        import_kind: ImportOrExportKind,
    ) -> ImportDeclarationSpecifier<'a> {
        ImportDeclarationSpecifier::new_import_specifier(
            span,
            imported,
            local,
            import_kind,
            &self.inner(),
        )
    }

    pub(crate) fn import_declaration_specifier_import_default_specifier(
        &self,
        span: Span,
        local: BindingIdentifier<'a>,
    ) -> ImportDeclarationSpecifier<'a> {
        ImportDeclarationSpecifier::new_import_default_specifier(span, local, &self.inner())
    }

    pub(crate) fn alloc_import_declaration(
        &self,
        span: Span,
        specifiers: Option<ArenaVec<'a, ImportDeclarationSpecifier<'a>>>,
        source: StringLiteral<'a>,
        phase: Option<ImportPhase>,
        with_clause: Option<ArenaBox<'a, WithClause<'a>>>,
        import_kind: ImportOrExportKind,
    ) -> ArenaBox<'a, ImportDeclaration<'a>> {
        ImportDeclaration::boxed(
            span,
            specifiers,
            source,
            phase,
            with_clause,
            import_kind,
            &self.inner(),
        )
    }

    pub(crate) fn module_export_name_identifier_name(
        &self,
        span: Span,
        name: impl Into<Ident<'a>>,
    ) -> ModuleExportName<'a> {
        ModuleExportName::new_identifier_name(span, name, &self.inner())
    }

    pub(crate) fn module_export_name_identifier_reference(
        &self,
        span: Span,
        name: impl Into<Ident<'a>>,
    ) -> ModuleExportName<'a> {
        ModuleExportName::new_identifier_reference(span, name, &self.inner())
    }

    pub(crate) fn module_export_name_string_literal(
        &self,
        span: Span,
        value: impl Into<Str<'a>>,
        raw: Option<Str<'a>>,
    ) -> ModuleExportName<'a> {
        ModuleExportName::new_string_literal(span, value, raw, &self.inner())
    }

    pub(crate) fn export_specifier(
        &self,
        span: Span,
        local: ModuleExportName<'a>,
        exported: ModuleExportName<'a>,
        export_kind: ImportOrExportKind,
    ) -> ExportSpecifier<'a> {
        ExportSpecifier::new(span, local, exported, export_kind, &self.inner())
    }

    pub(crate) fn alloc_export_default_declaration(
        &self,
        span: Span,
        declaration: ExportDefaultDeclarationKind<'a>,
    ) -> ArenaBox<'a, ExportDefaultDeclaration<'a>> {
        ExportDefaultDeclaration::boxed(span, declaration, &self.inner())
    }

    pub(crate) fn alloc_export_named_declaration(
        &self,
        span: Span,
        specifiers: ArenaVec<'a, ExportSpecifier<'a>>,
        export_kind: ImportOrExportKind,
    ) -> ArenaBox<'a, ExportNamedDeclaration<'a>> {
        ExportNamedDeclaration::boxed(span, specifiers, export_kind, &self.inner())
    }

    pub(crate) fn arrow_function_body_expression(
        &self,
        expression: Expression<'a>,
    ) -> ArrowFunctionBody<'a> {
        expression.into()
    }

    pub(crate) fn arrow_function_body_block(
        &self,
        body: FunctionBody<'a>,
    ) -> ArrowFunctionBody<'a> {
        ArrowFunctionBody::FunctionBody(ArenaBox::new_in(body, &self.inner()))
    }

    pub(crate) fn jsx_child_text(
        &self,
        span: Span,
        value: impl Into<Str<'a>>,
        raw: Option<Str<'a>>,
    ) -> JSXChild<'a> {
        JSXChild::new_text(span, value, raw, &self.inner())
    }

    pub(crate) fn jsx_child_expression_container(
        &self,
        span: Span,
        expression: JSXExpression<'a>,
    ) -> JSXChild<'a> {
        JSXChild::new_expression_container(span, expression, &self.inner())
    }

    pub(crate) fn jsx_expression_container(
        &self,
        span: Span,
        expression: JSXExpression<'a>,
    ) -> JSXExpressionContainer<'a> {
        JSXExpressionContainer::new(span, expression, &self.inner())
    }

    pub(crate) fn template_element_with_lone_surrogates(
        &self,
        span: Span,
        value: TemplateElementValue<'a>,
        tail: bool,
        lone_surrogates: bool,
    ) -> TemplateElement<'a> {
        TemplateElement::new_with_lone_surrogates(span, value, tail, lone_surrogates, &self.inner())
    }

    pub(crate) fn void_0(&self, span: Span) -> Expression<'a> {
        self.expression_unary(
            span,
            UnaryOperator::Void,
            self.expression_numeric_literal(span, 0.0, None, NumberBase::Decimal),
        )
    }
}
