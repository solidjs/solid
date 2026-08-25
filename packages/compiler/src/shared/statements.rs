use oxc_allocator::Vec as ArenaVec;
use oxc_ast::ast::{Expression, Statement};
use oxc_ast_visit::VisitMut;
use oxc_span::GetSpan;

use crate::dom::element::AstDomTransform;
use crate::shared::fragment::lower_fragment;

impl<'a> AstDomTransform<'a, '_> {
    /// `lower_element_with_setup` with root marking: statement-position JSX
    /// entry points bypass the visitor's `lower_jsx_element`, but the root
    /// element's tag must still keep a raw `this` (Babel's `transformThis`
    /// skips the traversal root).
    fn lower_root_element_with_setup(
        &mut self,
        element: &oxc_ast::ast::JSXElement<'a>,
    ) -> crate::error::Result<(Expression<'a>, std::vec::Vec<Statement<'a>>)> {
        let is_root = self.jsx_root_span.is_none();
        if is_root {
            self.jsx_root_span = Some(element.span);
        }
        let result = self.lower_element_with_setup(element);
        if is_root {
            self.jsx_root_span = None;
        }
        result
    }

    fn lower_root_fragment(
        &mut self,
        fragment: &oxc_ast::ast::JSXFragment<'a>,
    ) -> crate::error::Result<Expression<'a>> {
        let is_root = self.jsx_root_span.is_none();
        if is_root {
            self.jsx_root_span = Some(fragment.span);
        }
        let result = lower_fragment(self, fragment);
        if is_root {
            self.jsx_root_span = None;
        }
        result
    }

    pub(crate) fn process_statements(&mut self, statements: &mut ArenaVec<'a, Statement<'a>>) {
        self.statement_depth += 1;
        self.bindings
            .enter_scope(crate::shared::bindings::BindingScopeKind::Block);
        let mut body = ArenaVec::new_in(&self.allocator);
        for mut statement in statements.drain(..) {
            if self.error.is_some() {
                body.push(statement);
                continue;
            }

            if let Some(setup) = self.lower_variable_jsx_initializer(&mut statement) {
                self.lower_deferred_statement_jsx(&mut statement);
                // Babel's `transformThis` inserts the capture before the
                // statement *prior to* `createTemplate` inserting setup, so
                // the capture precedes the setup statements that use it.
                // `getStatementParent().insertBefore` targets the JSX's own
                // statement wherever it nests, so no depth gate applies.
                if self.in_class_method_scope()
                    && let Some(capture) = self.take_this_capture_statement(statement.span())
                {
                    body.push(capture);
                    self.clear_this_capture_context();
                }
                body.extend(setup);
                self.bindings.collect(&statement);
                body.push(statement);
                continue;
            }

            if let Some(setup) = self.lower_return_jsx(&mut statement) {
                self.lower_deferred_statement_jsx(&mut statement);
                if self.in_class_method_scope()
                    && let Some(capture) = self.take_this_capture_statement(statement.span())
                {
                    body.push(capture);
                    self.clear_this_capture_context();
                }
                body.extend(setup);
                body.push(statement);
                continue;
            }

            self.visit_statement(&mut statement);
            self.lower_deferred_statement_jsx(&mut statement);
            self.bindings.collect(&statement);
            if self.in_class_method_scope()
                && let Some(capture) = self.take_this_capture_statement(statement.span())
            {
                body.push(capture);
                self.clear_this_capture_context();
            }
            body.push(statement);
        }
        // Babel's queue appends statements inserted via `insertBefore` (the
        // setup groups above) to the *container's* traversal queue, so JSX
        // deferred into them lowers only after every statement in this body
        // has processed its own roots — templates for JSX in attribute
        // values, handlers, and refs register after all sibling roots.
        crate::shared::transform::lower_deferred_jsx_statements(self, &mut body);
        self.bindings.exit_scope();
        *statements = body;
        self.statement_depth -= 1;
    }

    /// Babel's `transformThis` insertBefore route only fires when the JSX
    /// root's function parent is a `ClassMethod`; other parents take
    /// `parent.push` (capture at the function top) and no parent wraps the
    /// result expression.
    pub(crate) fn in_class_method_scope(&self) -> bool {
        matches!(
            self.function_parent_stack.last(),
            Some(crate::shared::transform::FunctionParentKind::ClassMethod)
        )
    }

    /// Babel replaces a JSX root in place and immediately re-enters the
    /// replacement, so raw JSX left inside the statement itself (spread
    /// getters on the replacement expression) lowers now; JSX deferred into
    /// the inserted setup statements waits for the container-end pass.
    fn lower_deferred_statement_jsx(&mut self, statement: &mut Statement<'a>) {
        crate::shared::transform::lower_deferred_jsx_statements(
            self,
            std::slice::from_mut(statement),
        );
    }

    fn lower_variable_jsx_initializer(
        &mut self,
        statement: &mut Statement<'a>,
    ) -> Option<std::vec::Vec<Statement<'a>>> {
        // Babel's `isVarInit` predicate is per-declarator and its
        // `insertBefore` targets the whole statement — including through an
        // `export const` wrapper (`getStatementParent` on an exported
        // declaration inserts before the export statement).
        let declaration = match statement {
            Statement::VariableDeclaration(declaration) => declaration,
            Statement::ExportDeclaration(export) => match &mut export.declaration {
                oxc_ast::ast::Declaration::VariableDeclaration(declaration) => declaration,
                _ => return None,
            },
            _ => return None,
        };

        if !declaration.declarations.iter().any(|declarator| {
            declarator.init.as_ref().is_some_and(|init| {
                matches!(
                    init.get_inner_expression(),
                    Expression::JSXElement(_) | Expression::JSXFragment(_)
                )
            })
        }) {
            return None;
        }

        let mut setup: Option<std::vec::Vec<Statement<'a>>> = None;
        for index in 0..declaration.declarations.len() {
            let Some(taken) = declaration.declarations[index].init.take() else {
                continue;
            };
            // Babel sees through parentheses: `const a = (<div/>);` is still
            // a var-init JSX root.
            let mut init = peel_jsx_parens(taken);
            if matches!(init, Expression::JSXElement(_) | Expression::JSXFragment(_)) {
                crate::shared::transform::replace_this_in_jsx_root(self, &mut init);
            }
            let replaced = match init {
                Expression::JSXElement(element) => {
                    match self.lower_root_element_with_setup(&element) {
                        Ok((replacement, statements)) => {
                            setup
                                .get_or_insert_with(std::vec::Vec::new)
                                .extend(statements);
                            crate::shared::transform::finalize_root_capture(
                                self,
                                element.span,
                                replacement,
                            )
                        }
                        Err(error) => {
                            self.error = Some(error.to_string());
                            setup.get_or_insert_with(std::vec::Vec::new);
                            Expression::JSXElement(element)
                        }
                    }
                }
                Expression::JSXFragment(fragment) => match self.lower_root_fragment(&fragment) {
                    Ok(replacement) => {
                        setup.get_or_insert_with(std::vec::Vec::new);
                        crate::shared::transform::finalize_root_capture(
                            self,
                            fragment.span,
                            replacement,
                        )
                    }
                    Err(error) => {
                        self.error = Some(error.to_string());
                        setup.get_or_insert_with(std::vec::Vec::new);
                        Expression::JSXFragment(fragment)
                    }
                },
                mut init => {
                    // Non-root inits in a mixed declaration still traverse
                    // normally (nested JSX takes the expression-position path).
                    self.visit_expression(&mut init);
                    init
                }
            };
            declaration.declarations[index].init = Some(replaced);
        }
        setup
    }

    fn lower_return_jsx(
        &mut self,
        statement: &mut Statement<'a>,
    ) -> Option<std::vec::Vec<Statement<'a>>> {
        let Statement::ReturnStatement(return_statement) = statement else {
            return None;
        };
        let mut argument = return_statement.argument.take()?;
        if matches!(
            argument,
            Expression::JSXElement(_) | Expression::JSXFragment(_)
        ) {
            crate::shared::transform::replace_this_in_jsx_root(self, &mut argument);
        }
        match argument {
            Expression::JSXElement(element) => match self.lower_root_element_with_setup(&element) {
                Ok((replacement, setup)) => {
                    let replacement = crate::shared::transform::finalize_root_capture(
                        self,
                        element.span,
                        replacement,
                    );
                    return_statement.argument = Some(replacement);
                    Some(setup)
                }
                Err(error) => {
                    self.error = Some(error.to_string());
                    return_statement.argument = Some(Expression::JSXElement(element));
                    Some(std::vec::Vec::new())
                }
            },
            Expression::JSXFragment(fragment) => match self.lower_root_fragment(&fragment) {
                Ok(replacement) => {
                    let replacement = crate::shared::transform::finalize_root_capture(
                        self,
                        fragment.span,
                        replacement,
                    );
                    return_statement.argument = Some(replacement);
                    Some(std::vec::Vec::new())
                }
                Err(error) => {
                    self.error = Some(error.to_string());
                    return_statement.argument = Some(Expression::JSXFragment(fragment));
                    Some(std::vec::Vec::new())
                }
            },
            Expression::ParenthesizedExpression(parenthesized) => {
                let mut inner = parenthesized.unbox().expression;
                if matches!(
                    inner,
                    Expression::JSXElement(_) | Expression::JSXFragment(_)
                ) {
                    crate::shared::transform::replace_this_in_jsx_root(self, &mut inner);
                }
                match inner {
                    Expression::JSXElement(element) => {
                        match self.lower_root_element_with_setup(&element) {
                            Ok((replacement, setup)) => {
                                let replacement = crate::shared::transform::finalize_root_capture(
                                    self,
                                    element.span,
                                    replacement,
                                );
                                return_statement.argument = Some(replacement);
                                Some(setup)
                            }
                            Err(error) => {
                                self.error = Some(error.to_string());
                                return_statement.argument = Some(Expression::JSXElement(element));
                                Some(std::vec::Vec::new())
                            }
                        }
                    }
                    Expression::JSXFragment(fragment) => {
                        match self.lower_root_fragment(&fragment) {
                            Ok(replacement) => {
                                let replacement = crate::shared::transform::finalize_root_capture(
                                    self,
                                    fragment.span,
                                    replacement,
                                );
                                return_statement.argument = Some(replacement);
                                Some(std::vec::Vec::new())
                            }
                            Err(error) => {
                                self.error = Some(error.to_string());
                                return_statement.argument = Some(Expression::JSXFragment(fragment));
                                Some(std::vec::Vec::new())
                            }
                        }
                    }
                    expression => {
                        return_statement.argument = Some(expression);
                        None
                    }
                }
            }
            argument => {
                return_statement.argument = Some(argument);
                None
            }
        }
    }

    pub(crate) fn lower_class_field_value(
        &mut self,
        span: oxc_span::Span,
        mut value: Expression<'a>,
    ) -> Expression<'a> {
        if matches!(
            value,
            Expression::JSXElement(_) | Expression::JSXFragment(_)
        ) {
            crate::shared::transform::replace_this_in_jsx_root(self, &mut value);
        }
        match value {
            Expression::JSXElement(element) => match self.lower_root_element_with_setup(&element) {
                Ok((replacement, setup)) => {
                    // Class field initializers have no function parent, so a
                    // capture wraps the whole setup IIFE in a second IIFE
                    // (Babel's `!parent` route in `transformThis`).
                    let value = self.setup_iife(span, setup, replacement);
                    crate::shared::transform::finalize_root_capture(self, span, value)
                }
                Err(error) => {
                    self.error = Some(error.to_string());
                    Expression::JSXElement(element)
                }
            },
            Expression::JSXFragment(fragment) => match self.lower_root_fragment(&fragment) {
                Ok(replacement) => {
                    crate::shared::transform::finalize_root_capture(self, span, replacement)
                }
                Err(error) => {
                    self.error = Some(error.to_string());
                    Expression::JSXFragment(fragment)
                }
            },
            Expression::ArrowFunctionExpression(mut arrow) if arrow.is_expression() => {
                let placeholder = self.ast().expression_null_literal(span);
                let mut expression = std::mem::replace(
                    arrow
                        .get_expression_mut()
                        .expect("expression arrow has an expression body"),
                    placeholder,
                );
                if matches!(
                    expression,
                    Expression::JSXElement(_) | Expression::JSXFragment(_)
                ) {
                    crate::shared::transform::replace_this_in_jsx_root(self, &mut expression);
                }
                match expression {
                    Expression::JSXElement(element) => {
                        match self.lower_root_element_with_setup(&element) {
                            Ok((replacement, setup)) => {
                                // The arrow is the JSX root's function parent:
                                // Babel's `parent.push` puts the capture at the
                                // top of the arrow body, above the setup IIFE.
                                if let Some(capture) = self.take_this_capture_statement(span) {
                                    self.clear_this_capture_context();
                                    let mut statements = self.ast().vec();
                                    statements.push(capture);
                                    let value = self.setup_iife(span, setup, replacement);
                                    statements.push(self.ast().statement_return(span, Some(value)));
                                    arrow.body = self.ast().arrow_function_body_block(
                                        self.ast().function_body(
                                            span,
                                            self.ast().vec(),
                                            statements,
                                        ),
                                    );
                                } else {
                                    let mut statements = self.ast().vec();
                                    statements.extend(setup);
                                    statements
                                        .push(self.ast().statement_return(span, Some(replacement)));
                                    arrow.body = self.ast().arrow_function_body_block(
                                        self.ast().function_body(
                                            span,
                                            self.ast().vec(),
                                            statements,
                                        ),
                                    );
                                }
                                Expression::ArrowFunctionExpression(arrow)
                            }
                            Err(error) => {
                                self.error = Some(error.to_string());
                                arrow.body = self.ast().arrow_function_body_expression(
                                    Expression::JSXElement(element),
                                );
                                Expression::ArrowFunctionExpression(arrow)
                            }
                        }
                    }
                    expression => {
                        arrow.body = self.ast().arrow_function_body_expression(expression);
                        Expression::ArrowFunctionExpression(arrow)
                    }
                }
            }
            value => {
                let mut value = value;
                self.visit_expression(&mut value);
                value
            }
        }
    }

    fn setup_iife(
        &self,
        span: oxc_span::Span,
        setup: std::vec::Vec<Statement<'a>>,
        result: Expression<'a>,
    ) -> Expression<'a> {
        if setup.is_empty() {
            return result;
        }
        let mut statements = self.ast().vec();
        statements.extend(setup);
        statements.push(self.ast().statement_return(span, Some(result)));
        let arrow = self.arrow_iife(span, statements);
        self.call_expression(span, arrow, std::vec::Vec::new())
    }
}

/// Strips parentheses around a JSX root (Babel's default parser produces no
/// `ParenthesizedExpression` nodes, so parenthesized JSX inits/returns take
/// the same statement-position route as bare ones). Non-JSX expressions are
/// returned untouched.
fn peel_jsx_parens(expression: Expression<'_>) -> Expression<'_> {
    if !matches!(
        expression.get_inner_expression(),
        Expression::JSXElement(_) | Expression::JSXFragment(_)
    ) {
        return expression;
    }
    let mut expression = expression;
    loop {
        match expression {
            Expression::ParenthesizedExpression(parenthesized) => {
                expression = parenthesized.unbox().expression;
            }
            expression => return expression,
        }
    }
}
