use oxc_ast::ast::{
    Argument, Expression, FormalParameterKind, ObjectPropertyKind, Statement,
    VariableDeclarationKind,
};
use oxc_span::Span;

use crate::shared::ast::{
    expression_to_argument, import_named, object_getter_property, object_property,
    variable_statement,
};
use crate::shared::ast_builder::AstBuilder;
use crate::universal::transform::AstUniversalTransform;

impl<'a> AstUniversalTransform<'a, '_> {
    pub(super) fn ast(&self) -> AstBuilder<'a> {
        AstBuilder::new(self.allocator)
    }

    pub(super) fn next_element_id(&mut self) -> String {
        // In dynamic mode the dom renderer's transform mints `_el$N` ids too;
        // Babel shares one uid namespace per program, so route through its
        // counter to keep names unique.
        if let Some(dom) = &mut self.dynamic_dom {
            return dom.next_element_id();
        }
        crate::shared::utils::next_unique_local("_el", &mut self.element_index, &self.bindings)
    }

    pub(super) fn variable_statement(
        &self,
        span: Span,
        name: &str,
        init: Expression<'a>,
    ) -> Statement<'a> {
        variable_statement(
            self.allocator,
            span,
            VariableDeclarationKind::Var,
            name,
            init,
        )
    }

    pub(super) fn expression_statement(
        &self,
        span: Span,
        expression: Expression<'a>,
    ) -> Statement<'a> {
        self.ast().statement_expression(span, expression)
    }

    pub(crate) fn setup_iife(
        &self,
        span: Span,
        setup: std::vec::Vec<Statement<'a>>,
        result: Expression<'a>,
    ) -> Expression<'a> {
        if setup.is_empty() {
            return result;
        }
        let mut statements = self.ast().vec();
        statements.extend(setup);
        statements.push(self.ast().statement_return(span, Some(result)));
        let params = self.ast().formal_parameters(
            span,
            FormalParameterKind::ArrowFormalParameters,
            self.ast().vec(),
            None,
        );
        let body = self.ast().function_body(span, self.ast().vec(), statements);
        let arrow = self
            .ast()
            .expression_arrow_function(span, false, false, None, params, None, body);
        self.call_expression(span, arrow, std::vec::Vec::new())
    }

    pub(super) fn call_expression(
        &self,
        span: Span,
        callee: Expression<'a>,
        args: std::vec::Vec<Expression<'a>>,
    ) -> Expression<'a> {
        self.ast().expression_call(
            span,
            callee,
            None,
            self.ast()
                .vec_from_iter(args.into_iter().map(expression_to_argument)),
            false,
        )
    }

    pub(super) fn call_identifier(
        &self,
        span: Span,
        callee: &str,
        args: std::vec::Vec<Argument<'a>>,
    ) -> Expression<'a> {
        self.ast().expression_call(
            span,
            self.ast()
                .expression_identifier(span, self.ast().ident(callee)),
            None,
            self.ast().vec_from_iter(args),
            false,
        )
    }

    pub(super) fn string_arg(&self, span: Span, value: &str) -> Argument<'a> {
        Argument::StringLiteral(
            self.ast()
                .alloc_string_literal(span, self.ast().str(value), None),
        )
    }

    pub(super) fn identifier_arg(&self, span: Span, name: &str) -> Argument<'a> {
        Argument::Identifier(
            self.ast()
                .alloc_identifier_reference(span, self.ast().ident(name)),
        )
    }

    pub(super) fn identifier_expression(&self, span: Span, name: &str) -> Expression<'a> {
        self.ast()
            .expression_identifier(span, self.ast().ident(name))
    }

    pub(super) fn object_property(
        &self,
        span: Span,
        name: &str,
        value: Expression<'a>,
    ) -> ObjectPropertyKind<'a> {
        object_property(self.allocator, span, name, value)
    }

    pub(super) fn object_getter_property(
        &self,
        span: Span,
        name: &str,
        value: Expression<'a>,
    ) -> ObjectPropertyKind<'a> {
        object_getter_property(self.allocator, span, name, value)
    }

    pub(super) fn import_named(&self, imported: &str, local: &str) -> Statement<'a> {
        import_named(self.allocator, self.module_name, imported, local)
    }
}
