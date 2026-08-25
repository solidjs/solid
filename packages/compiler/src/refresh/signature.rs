//! Babel-generator-faithful printer for solid-refresh signature hashing.
//!
//! The Babel plugin computes `signature: xxHash32(generate(component).code)`
//! where `generate` is `@babel/generator` with default options. The hash is
//! compared between HMR updates, so the *print format is part of the frozen
//! contract*: this printer reproduces `@babel/generator`'s default output
//! (2-space indent, raw literals preserved from source, comment placement,
//! Babel's paren-minimization) for the node shapes that appear inside
//! components. The refresh parity suite compares emitted signature strings
//! against the reference plugin byte-for-byte.
//!
//! Known divergences are limited to exotic TypeScript *type* syntax
//! (conditional/mapped/infer types and template literal types print as raw
//! source slices instead of Babel's re-formatting); see the fixture README.

use oxc_ast::ast::*;
use oxc_span::{GetSpan, Span};

/// Comment payload captured from the parsed program (the printer runs after
/// AST surgery, but spans still index the original source).
#[derive(Clone)]
pub(crate) struct CommentInfo {
    /// Span including delimiters.
    pub span: Span,
    /// Start offset of the token the comment is attached to (leading only).
    pub attached_to: u32,
    pub is_line: bool,
    pub is_leading: bool,
}

pub(crate) struct Printer<'s> {
    source: &'s str,
    comments: &'s [CommentInfo],
    printed_comments: std::cell::RefCell<std::collections::HashSet<u32>>,
    out: String,
    indent: usize,
}

const INDENT: &str = "  ";

// Minimum-precedence contexts.
const P_TOP: u8 = 0; // expression statement / return / arrow body...
const P_ASSIGN: u8 = 2; // argument positions, object values, RHS
const P_COND_TEST: u8 = 4;
const P_LHS: u8 = 18; // callee / member object

impl<'s> Printer<'s> {
    pub(crate) fn new(source: &'s str, comments: &'s [CommentInfo]) -> Self {
        Self {
            source,
            comments,
            printed_comments: std::cell::RefCell::new(std::collections::HashSet::new()),
            out: String::new(),
            indent: 0,
        }
    }

    pub(crate) fn finish(self) -> String {
        self.out
    }

    fn src(&self, span: Span) -> &'s str {
        &self.source[span.start as usize..span.end as usize]
    }

    fn push(&mut self, text: &str) {
        self.out.push_str(text);
    }

    fn newline(&mut self) {
        self.out.push('\n');
        for _ in 0..self.indent {
            self.out.push_str(INDENT);
        }
    }

    // --- Comments -------------------------------------------------------------

    fn comment_text(&self, comment: &CommentInfo) -> &'s str {
        self.src(comment.span)
    }

    fn mark_printed(&self, comment: &CommentInfo) {
        self.printed_comments
            .borrow_mut()
            .insert(comment.span.start);
    }

    fn is_printed(&self, comment: &CommentInfo) -> bool {
        self.printed_comments.borrow().contains(&comment.span.start)
    }

    /// Leading comments attached to a node start, in source order.
    fn leading_comments(&self, start: u32) -> Vec<CommentInfo> {
        self.comments
            .iter()
            .filter(|comment| {
                comment.is_leading && comment.attached_to == start && !self.is_printed(comment)
            })
            .cloned()
            .collect()
    }

    /// Babel prints statement-leading comments each on their own line.
    fn print_statement_leading_comments(&mut self, start: u32) {
        for comment in self.leading_comments(start) {
            self.mark_printed(&comment);
            let text = self.comment_text(&comment).to_string();
            self.push(&text);
            self.newline();
        }
    }

    /// Expression-leading comments print inline with no separator
    /// (`/* inline */props => props.x`).
    fn print_expression_leading_comments(&mut self, start: u32) {
        for comment in self.leading_comments(start) {
            self.mark_printed(&comment);
            let text = self.comment_text(&comment).to_string();
            self.push(&text);
            if comment.is_line {
                self.newline();
            }
        }
    }

    /// Same-line trailing comment after a statement (` // hi`,
    /// ` /* trailing */`). Detected by scanning the source after the node.
    fn print_trailing_comments(&mut self, end: u32) {
        let bytes = self.source.as_bytes();
        let mut pos = end as usize;
        loop {
            while pos < bytes.len()
                && (bytes[pos] == b' ' || bytes[pos] == b'\t' || bytes[pos] == b';')
            {
                pos += 1;
            }
            let Some(comment) = self
                .comments
                .iter()
                .find(|comment| comment.span.start as usize == pos && !self.is_printed(comment))
                .cloned()
            else {
                return;
            };
            self.mark_printed(&comment);
            let text = self.comment_text(&comment).to_string();
            self.push(" ");
            self.push(&text);
            pos = comment.span.end as usize;
            if comment.is_line {
                return;
            }
        }
    }

    // --- Entry points -----------------------------------------------------------

    /// Print a component expression (arrow / function expression), leading
    /// comments included — Babel's `generate(node)` prints the node's own
    /// leading comments.
    pub(crate) fn print_component_expression(&mut self, expression: &Expression<'_>) {
        self.print_expression_leading_comments(expression.span().start);
        self.print_expr(expression, P_TOP, false);
    }

    /// Print a function declaration the way Babel prints
    /// `t.functionExpression(decl.id, decl.params, decl.body)` — the id,
    /// params, and body are reused, TS type parameters/return types dropped.
    pub(crate) fn print_function_as_expression(&mut self, function: &Function<'_>) {
        self.push("function ");
        if let Some(id) = &function.id {
            self.push(id.name.as_str());
        }
        self.print_params(&function.params);
        self.push(" ");
        if let Some(body) = &function.body {
            self.print_block_body(body);
        } else {
            self.push("{}");
        }
    }

    // --- Statements -----------------------------------------------------------

    fn print_block_statement(&mut self, block: &BlockStatement<'_>) {
        if block.body.is_empty() {
            // Babel prints inner comments in empty blocks; components rarely
            // hit this — empty prints as `{}`.
            self.push("{}");
            return;
        }
        self.push("{");
        self.indent += 1;
        for statement in &block.body {
            self.newline();
            self.print_statement_line(statement);
        }
        self.indent -= 1;
        self.newline();
        self.push("}");
    }

    /// A function body: directives first (raw, with a blank line after the
    /// group when statements follow), then statements.
    fn print_block_body(&mut self, body: &FunctionBody<'_>) {
        if body.directives.is_empty() && body.statements.is_empty() {
            self.push("{}");
            return;
        }
        self.push("{");
        self.indent += 1;
        for directive in &body.directives {
            self.newline();
            let raw = self.src(directive.expression.span).to_string();
            self.push(&raw);
            self.push(";");
        }
        if !body.directives.is_empty() && !body.statements.is_empty() {
            // Babel emits an empty line between the directive prologue and
            // the first statement.
            self.out.push('\n');
        }
        for statement in &body.statements {
            self.newline();
            self.print_statement_line(statement);
        }
        self.indent -= 1;
        self.newline();
        self.push("}");
    }

    /// One statement at the current position, with its leading and trailing
    /// comments.
    fn print_statement_line(&mut self, statement: &Statement<'_>) {
        self.print_statement_leading_comments(statement.span().start);
        self.print_statement(statement);
        self.print_trailing_comments(statement.span().end);
    }

    fn print_statement(&mut self, statement: &Statement<'_>) {
        match statement {
            Statement::BlockStatement(block) => self.print_block_statement(block),
            Statement::ExpressionStatement(stmt) => {
                self.print_expr(&stmt.expression, P_TOP, true);
                self.push(";");
            }
            Statement::VariableDeclaration(decl) => {
                self.print_variable_declaration(decl, false);
                self.push(";");
            }
            Statement::ReturnStatement(stmt) => {
                self.push("return");
                if let Some(argument) = &stmt.argument {
                    self.push(" ");
                    self.print_expr(argument, P_TOP, false);
                }
                self.push(";");
            }
            Statement::IfStatement(stmt) => self.print_if(stmt),
            Statement::ForStatement(stmt) => {
                self.push("for (");
                match &stmt.init {
                    Some(ForStatementInit::VariableDeclaration(decl)) => {
                        self.print_variable_declaration(decl, true)
                    }
                    Some(init) => {
                        if let Some(expr) = init.as_expression() {
                            self.print_expr(expr, P_TOP, false);
                        }
                    }
                    None => {}
                }
                self.push(";");
                if let Some(test) = &stmt.test {
                    self.push(" ");
                    self.print_expr(test, P_TOP, false);
                }
                self.push(";");
                if let Some(update) = &stmt.update {
                    self.push(" ");
                    self.print_expr(update, P_TOP, false);
                }
                self.push(")");
                self.print_clause_body(&stmt.body);
            }
            Statement::ForInStatement(stmt) => {
                self.push("for (");
                self.print_for_left(&stmt.left);
                self.push(" in ");
                self.print_expr(&stmt.right, P_TOP, false);
                self.push(")");
                self.print_clause_body(&stmt.body);
            }
            Statement::ForOfStatement(stmt) => {
                self.push("for ");
                if stmt.r#await {
                    self.push("await ");
                }
                self.push("(");
                self.print_for_left(&stmt.left);
                self.push(" of ");
                self.print_expr(&stmt.right, P_ASSIGN, false);
                self.push(")");
                self.print_clause_body(&stmt.body);
            }
            Statement::WhileStatement(stmt) => {
                self.push("while (");
                self.print_expr(&stmt.test, P_TOP, false);
                self.push(")");
                self.print_clause_body(&stmt.body);
            }
            Statement::DoWhileStatement(stmt) => {
                self.push("do");
                match &stmt.body {
                    Statement::BlockStatement(block) => {
                        self.push(" ");
                        self.print_block_statement(block);
                    }
                    other => {
                        self.push(" ");
                        self.print_statement(other);
                    }
                }
                self.push(" while (");
                self.print_expr(&stmt.test, P_TOP, false);
                self.push(");");
            }
            Statement::SwitchStatement(stmt) => {
                self.push("switch (");
                self.print_expr(&stmt.discriminant, P_TOP, false);
                self.push(") {");
                self.indent += 1;
                for case in &stmt.cases {
                    self.newline();
                    self.print_statement_leading_comments(case.span.start);
                    match &case.test {
                        Some(test) => {
                            self.push("case ");
                            self.print_expr(test, P_TOP, false);
                            self.push(":");
                        }
                        None => self.push("default:"),
                    }
                    self.indent += 1;
                    for entry in &case.consequent {
                        self.newline();
                        self.print_statement_line(entry);
                    }
                    self.indent -= 1;
                }
                self.indent -= 1;
                self.newline();
                self.push("}");
            }
            Statement::TryStatement(stmt) => {
                self.push("try ");
                self.print_block_statement(&stmt.block);
                if let Some(handler) = &stmt.handler {
                    self.push(" catch ");
                    if let Some(param) = &handler.param {
                        self.push("(");
                        self.print_binding_pattern(&param.pattern);
                        self.push(") ");
                    }
                    self.print_block_statement(&handler.body);
                }
                if let Some(finalizer) = &stmt.finalizer {
                    self.push(" finally ");
                    self.print_block_statement(finalizer);
                }
            }
            Statement::ThrowStatement(stmt) => {
                self.push("throw ");
                self.print_expr(&stmt.argument, P_TOP, false);
                self.push(";");
            }
            Statement::BreakStatement(stmt) => {
                self.push("break");
                if let Some(label) = &stmt.label {
                    self.push(" ");
                    self.push(label.name.as_str());
                }
                self.push(";");
            }
            Statement::ContinueStatement(stmt) => {
                self.push("continue");
                if let Some(label) = &stmt.label {
                    self.push(" ");
                    self.push(label.name.as_str());
                }
                self.push(";");
            }
            Statement::LabeledStatement(stmt) => {
                self.push(stmt.label.name.as_str());
                self.push(": ");
                self.print_statement(&stmt.body);
            }
            Statement::FunctionDeclaration(function) => self.print_function(function, true),
            Statement::ClassDeclaration(class) => self.print_class(class),
            Statement::EmptyStatement(_) => self.push(";"),
            Statement::DebuggerStatement(_) => self.push("debugger;"),
            // Imports/exports can't appear inside component functions; TS
            // declaration statements print as raw slices (see module docs).
            other => {
                let raw = self.src(other.span()).to_string();
                self.push(&raw);
            }
        }
    }

    /// Loop/if bodies: ` {`-attached blocks or a single inline statement.
    fn print_clause_body(&mut self, body: &Statement<'_>) {
        match body {
            Statement::BlockStatement(block) => {
                self.push(" ");
                self.print_block_statement(block);
            }
            other => {
                self.push(" ");
                self.print_statement(other);
            }
        }
    }

    fn print_if(&mut self, stmt: &IfStatement<'_>) {
        self.push("if (");
        self.print_expr(&stmt.test, P_TOP, false);
        self.push(")");
        let block_consequent = matches!(&stmt.consequent, Statement::BlockStatement(_));
        self.print_clause_body(&stmt.consequent);
        if let Some(alternate) = &stmt.alternate {
            // Babel: `if (a) b();else ...` after a non-block consequent (no
            // space), ` else` after a block.
            if block_consequent {
                self.push(" else");
            } else {
                self.push("else");
            }
            match alternate {
                Statement::IfStatement(nested) => {
                    self.push(" ");
                    self.print_if(nested);
                }
                other => self.print_clause_body(other),
            }
        }
    }

    fn print_for_left(&mut self, left: &ForStatementLeft<'_>) {
        match left {
            ForStatementLeft::VariableDeclaration(decl) => {
                self.print_variable_declaration(decl, true)
            }
            other => {
                if let Some(target) = other.as_assignment_target() {
                    self.print_assignment_target(target);
                }
            }
        }
    }

    fn print_variable_declaration(&mut self, decl: &VariableDeclaration<'_>, for_head: bool) {
        self.push(decl.kind.as_str());
        self.push(" ");
        // Babel: declarators separate with `,\n<indent+1>` when any has an
        // init (statement position only); otherwise `, `.
        let has_inits = decl.declarations.iter().any(|d| d.init.is_some());
        let multiline = has_inits && !for_head && decl.declarations.len() > 1;
        for (index, declarator) in decl.declarations.iter().enumerate() {
            if index > 0 {
                if multiline {
                    self.push(",");
                    self.indent += 1;
                    self.newline();
                    self.indent -= 1;
                } else {
                    self.push(", ");
                }
            }
            self.print_binding_pattern(&declarator.id);
            if declarator.definite {
                self.push("!");
            }
            if let Some(annotation) = &declarator.type_annotation {
                self.push(": ");
                self.print_ts_type(&annotation.type_annotation);
            }
            if let Some(init) = &declarator.init {
                self.push(" = ");
                self.print_expr(init, P_ASSIGN, false);
            }
        }
    }

    // --- Functions / classes ------------------------------------------------------

    fn print_function(&mut self, function: &Function<'_>, declaration: bool) {
        if function.r#async {
            self.push("async ");
        }
        self.push("function");
        if function.generator {
            self.push("*");
        }
        match &function.id {
            Some(id) => {
                self.push(" ");
                self.push(id.name.as_str());
            }
            None => {
                if !declaration {
                    self.push(" ");
                }
            }
        }
        if let Some(type_parameters) = &function.type_parameters {
            self.print_type_parameters(type_parameters, false);
        }
        self.print_params(&function.params);
        if let Some(return_type) = &function.return_type {
            self.push(": ");
            self.print_ts_type(&return_type.type_annotation);
        }
        self.push(" ");
        if let Some(body) = &function.body {
            self.print_block_body(body);
        } else {
            self.push("{}");
        }
    }

    fn print_params(&mut self, params: &FormalParameters<'_>) {
        self.push("(");
        let mut first = true;
        for param in &params.items {
            if !first {
                self.push(", ");
            }
            first = false;
            self.print_binding_pattern_with_modifiers(
                &param.pattern,
                param.optional,
                param.type_annotation.as_deref(),
                param.initializer.as_deref(),
            );
        }
        if let Some(rest) = &params.rest {
            if !first {
                self.push(", ");
            }
            self.push("...");
            self.print_binding_pattern(&rest.rest.argument);
            if let Some(annotation) = &rest.type_annotation {
                self.push(": ");
                self.print_ts_type(&annotation.type_annotation);
            }
        }
        self.push(")");
    }

    fn print_arrow(&mut self, arrow: &ArrowFunctionExpression<'_>) {
        if arrow.r#async {
            self.push("async ");
        }
        if let Some(type_parameters) = &arrow.type_parameters {
            self.print_type_parameters(type_parameters, true);
        }
        if self.arrow_param_is_bare(arrow) {
            let params = &arrow.params;
            if let Some(param) = params.items.first() {
                self.print_binding_pattern(&param.pattern);
            }
        } else {
            self.print_params(&arrow.params);
            if let Some(return_type) = &arrow.return_type {
                self.push(": ");
                self.print_ts_type(&return_type.type_annotation);
            }
        }
        self.push(" => ");
        if let Some(body) = arrow.get_expression() {
            // Object-literal bodies (and anything starting with `{`) need
            // parens; sequences fall out of the P_ASSIGN context.
            if starts_with_object(body) {
                self.push("(");
                self.print_expr(body, P_TOP, false);
                self.push(")");
            } else {
                self.print_expr(body, P_ASSIGN, false);
            }
        } else {
            let body = arrow
                .get_function_body()
                .expect("non-expression arrow has a function body");
            self.print_block_body(body);
        }
    }

    fn arrow_param_is_bare(&self, arrow: &ArrowFunctionExpression<'_>) -> bool {
        if arrow.return_type.is_some() || arrow.type_parameters.is_some() {
            return false;
        }
        if arrow.params.rest.is_some() || arrow.params.items.len() != 1 {
            return false;
        }
        let param = &arrow.params.items[0];
        param.type_annotation.is_none()
            && !param.optional
            && param.initializer.is_none()
            && matches!(&param.pattern, BindingPattern::BindingIdentifier(_))
    }

    fn print_class(&mut self, class: &Class<'_>) {
        self.push("class");
        if let Some(id) = &class.id {
            self.push(" ");
            self.push(id.name.as_str());
        }
        if let Some(super_class) = class.heritage_expression() {
            self.push(" extends ");
            self.print_expr(super_class, P_LHS, false);
        }
        self.push(" {");
        if class.body.body.is_empty() {
            self.push("}");
            return;
        }
        self.indent += 1;
        for element in &class.body.body {
            self.newline();
            self.print_statement_leading_comments(element.span().start);
            self.print_class_element(element);
        }
        self.indent -= 1;
        self.newline();
        self.push("}");
    }

    fn print_class_element(&mut self, element: &ClassElement<'_>) {
        match element {
            ClassElement::MethodDefinition(method) => {
                if method.r#static {
                    self.push("static ");
                }
                let function = &method.value;
                if function.r#async {
                    self.push("async ");
                }
                match method.kind {
                    MethodDefinitionKind::Get => self.push("get "),
                    MethodDefinitionKind::Set => self.push("set "),
                    _ => {}
                }
                if function.generator {
                    self.push("*");
                }
                self.print_property_key(&method.key, method.computed);
                self.print_params(&function.params);
                if let Some(return_type) = &function.return_type {
                    self.push(": ");
                    self.print_ts_type(&return_type.type_annotation);
                }
                self.push(" ");
                if let Some(body) = &function.body {
                    self.print_block_body(body);
                } else {
                    self.push("{}");
                }
            }
            ClassElement::PropertyDefinition(property) => {
                if property.r#static {
                    self.push("static ");
                }
                self.print_property_key(&property.key, property.computed);
                if let Some(type_annotation) = &property.type_annotation {
                    self.push(": ");
                    self.print_ts_type(&type_annotation.type_annotation);
                }
                if let Some(value) = &property.value {
                    self.push(" = ");
                    self.print_expr(value, P_ASSIGN, false);
                }
                self.push(";");
            }
            ClassElement::StaticBlock(block) => {
                self.push("static {");
                self.indent += 1;
                for statement in &block.body {
                    self.newline();
                    self.print_statement_line(statement);
                }
                self.indent -= 1;
                self.newline();
                self.push("}");
            }
            other => {
                let raw = self.src(other.span()).to_string();
                self.push(&raw);
            }
        }
    }

    // --- Patterns -----------------------------------------------------------------

    fn print_binding_pattern(&mut self, pattern: &BindingPattern<'_>) {
        self.print_binding_pattern_with_modifiers(pattern, false, None, None);
    }

    fn print_binding_pattern_with_modifiers(
        &mut self,
        pattern: &BindingPattern<'_>,
        optional: bool,
        type_annotation: Option<&TSTypeAnnotation<'_>>,
        initializer: Option<&Expression<'_>>,
    ) {
        match pattern {
            BindingPattern::BindingIdentifier(id) => self.push(id.name.as_str()),
            BindingPattern::ObjectPattern(object) => self.print_object_pattern(object),
            BindingPattern::ArrayPattern(array) => self.print_array_pattern(array),
            BindingPattern::AssignmentPattern(assignment) => {
                self.print_binding_pattern(&assignment.left);
                self.push(" = ");
                self.print_expr(&assignment.right, P_ASSIGN, false);
            }
        }
        if optional {
            self.push("?");
        }
        if let Some(annotation) = type_annotation {
            self.push(": ");
            self.print_ts_type(&annotation.type_annotation);
        }
        if let Some(init) = initializer {
            self.push(" = ");
            self.print_expr(init, P_ASSIGN, false);
        }
    }

    /// Object patterns print multiline like object expressions.
    fn print_object_pattern(&mut self, object: &ObjectPattern<'_>) {
        if object.properties.is_empty() && object.rest.is_none() {
            self.push("{}");
            return;
        }
        self.push("{");
        self.indent += 1;
        let mut first = true;
        for property in &object.properties {
            if !first {
                self.push(",");
            }
            first = false;
            self.newline();
            if property.shorthand {
                // `{ a }` or `{ a = 1 }`.
                self.print_binding_pattern(&property.value);
            } else {
                self.print_property_key(&property.key, property.computed);
                self.push(": ");
                self.print_binding_pattern(&property.value);
            }
        }
        if let Some(rest) = &object.rest {
            if !first {
                self.push(",");
            }
            self.newline();
            self.push("...");
            self.print_binding_pattern(&rest.argument);
        }
        self.indent -= 1;
        self.newline();
        self.push("}");
    }

    /// Array patterns print inline.
    fn print_array_pattern(&mut self, array: &ArrayPattern<'_>) {
        self.push("[");
        let len = array.elements.len();
        for (index, element) in array.elements.iter().enumerate() {
            if let Some(pattern) = element {
                if index > 0 {
                    self.push(" ");
                }
                self.print_binding_pattern(pattern);
            }
            if index < len - 1 || element.is_none() {
                self.push(",");
            }
        }
        if let Some(rest) = &array.rest {
            if len > 0 {
                // A trailing hole already emitted its comma.
                if array
                    .elements
                    .last()
                    .is_some_and(|element| element.is_some())
                {
                    self.push(",");
                }
                self.push(" ");
            }
            self.push("...");
            self.print_binding_pattern(&rest.argument);
        }
        self.push("]");
    }

    fn print_assignment_target(&mut self, target: &AssignmentTarget<'_>) {
        // Assignment targets reuse expression printing where possible; the
        // pattern forms are raw-sliced (they only appear in destructuring
        // assignments, which are rare inside components).
        match target {
            AssignmentTarget::AssignmentTargetIdentifier(id) => self.push(id.name.as_str()),
            AssignmentTarget::StaticMemberExpression(member) => {
                self.print_static_member(member, false)
            }
            AssignmentTarget::ComputedMemberExpression(member) => {
                self.print_computed_member(member, false)
            }
            other => {
                let raw = self.src(other.span()).to_string();
                self.push(&raw);
            }
        }
    }

    // --- Expressions ----------------------------------------------------------------

    /// Own precedence of an expression node — parens are required when it is
    /// below the context minimum.
    fn expr_prec(expression: &Expression<'_>) -> u8 {
        match expression {
            Expression::SequenceExpression(_) => 1,
            Expression::AssignmentExpression(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::ConditionalExpression(_)
            | Expression::YieldExpression(_)
            | Expression::AwaitExpression(_) => 3,
            Expression::LogicalExpression(logical) => match logical.operator {
                LogicalOperator::Coalesce => 4,
                LogicalOperator::Or => 5,
                LogicalOperator::And => 6,
            },
            Expression::BinaryExpression(binary) => binary_prec(binary.operator),
            Expression::PrivateInExpression(_) => 11,
            Expression::UnaryExpression(_) => 16,
            Expression::UpdateExpression(update) => {
                if update.prefix {
                    16
                } else {
                    17
                }
            }
            Expression::TSAsExpression(_) | Expression::TSSatisfiesExpression(_) => 11,
            Expression::CallExpression(_) | Expression::ImportExpression(_) => 18,
            Expression::NewExpression(_) => 19,
            Expression::ChainExpression(_) => 18,
            _ => 20,
        }
    }

    fn print_expr(&mut self, expression: &Expression<'_>, min: u8, stmt_start: bool) {
        self.print_expression_leading_comments(expression.span().start);

        // Babel's "would start the statement with `{`/`function`/`class`"
        // rule: the offending node itself gets wrapped, not the whole
        // expression.
        if stmt_start && starts_statement_token(expression) {
            self.push("(");
            self.print_expr(expression, P_TOP, false);
            self.push(")");
            return;
        }

        let prec = Self::expr_prec(expression);
        if prec < min {
            self.push("(");
            self.print_expr(expression, P_TOP, false);
            self.push(")");
            return;
        }

        match expression {
            Expression::Identifier(id) => self.push(id.name.as_str()),
            Expression::ThisExpression(_) => self.push("this"),
            Expression::Super(_) => self.push("super"),
            Expression::NullLiteral(_) => self.push("null"),
            Expression::BooleanLiteral(literal) => {
                self.push(if literal.value { "true" } else { "false" })
            }
            // Raw-preserving literals: Babel prints `extra.raw` for nodes
            // that came from the parser.
            Expression::NumericLiteral(literal) => {
                let raw = self.src(literal.span).to_string();
                self.push(&raw);
            }
            Expression::StringLiteral(literal) => {
                let raw = self.src(literal.span).to_string();
                self.push(&raw);
            }
            Expression::BigIntLiteral(literal) => {
                let raw = self.src(literal.span).to_string();
                self.push(&raw);
            }
            Expression::RegExpLiteral(literal) => {
                let raw = self.src(literal.span).to_string();
                self.push(&raw);
            }
            Expression::TemplateLiteral(template) => self.print_template(template),
            Expression::TaggedTemplateExpression(tagged) => {
                self.print_expr(&tagged.tag, P_LHS, stmt_start);
                if let Some(type_arguments) = &tagged.type_arguments {
                    let raw = self.src(type_arguments.span).to_string();
                    self.push(&raw);
                }
                self.print_template(&tagged.quasi);
            }
            Expression::ImportMeta(_) => self.push("import.meta"),
            Expression::NewTarget(_) => self.push("new.target"),
            Expression::ArrayExpression(array) => self.print_array(array),
            Expression::ObjectExpression(object) => self.print_object(object),
            Expression::FunctionExpression(function) => self.print_function(function, false),
            Expression::ArrowFunctionExpression(arrow) => self.print_arrow(arrow),
            Expression::ClassExpression(class) => self.print_class(class),
            Expression::SequenceExpression(sequence) => {
                let mut first = true;
                for entry in &sequence.expressions {
                    if !first {
                        self.push(", ");
                    }
                    first = false;
                    self.print_expr(entry, P_ASSIGN, false);
                }
            }
            Expression::AssignmentExpression(assignment) => {
                self.print_assignment_target(&assignment.left);
                self.push(" ");
                self.push(assignment.operator.as_str());
                self.push(" ");
                self.print_expr(&assignment.right, P_ASSIGN, false);
            }
            Expression::ConditionalExpression(conditional) => {
                self.print_expr(&conditional.test, P_COND_TEST, stmt_start);
                self.push(" ? ");
                self.print_expr(&conditional.consequent, P_ASSIGN, false);
                self.push(" : ");
                self.print_expr(&conditional.alternate, P_ASSIGN, false);
            }
            Expression::LogicalExpression(logical) => self.print_logical(logical, stmt_start),
            Expression::BinaryExpression(binary) => self.print_binary(binary, stmt_start),
            Expression::PrivateInExpression(private) => {
                self.push(private.left.name.as_str());
                self.push(" in ");
                self.print_expr(&private.right, 12, false);
            }
            Expression::UnaryExpression(unary) => {
                let op = unary.operator.as_str();
                self.push(op);
                if unary.operator.is_keyword() {
                    self.push(" ");
                }
                let before = self.out.len();
                self.print_expr(&unary.argument, 16, false);
                // `- -x` / `+ +x`: Babel separates sign clashes with a space.
                if !unary.operator.is_keyword() {
                    let printed = &self.out[before..];
                    if let Some(first_char) = printed.chars().next() {
                        let clash =
                            (op == "-" && first_char == '-') || (op == "+" && first_char == '+');
                        if clash {
                            self.out.insert(before, ' ');
                        }
                    }
                }
            }
            Expression::UpdateExpression(update) => {
                if update.prefix {
                    self.push(update.operator.as_str());
                    self.print_update_target(&update.argument);
                } else {
                    self.print_update_target(&update.argument);
                    self.push(update.operator.as_str());
                }
            }
            Expression::AwaitExpression(await_expr) => {
                self.push("await ");
                self.print_expr(&await_expr.argument, 16, false);
            }
            Expression::YieldExpression(yield_expr) => {
                self.push("yield");
                if yield_expr.delegate {
                    self.push("*");
                }
                if let Some(argument) = &yield_expr.argument {
                    self.push(" ");
                    self.print_expr(argument, P_ASSIGN, false);
                }
            }
            Expression::CallExpression(call) => self.print_call(call, stmt_start),
            Expression::NewExpression(new_expr) => {
                self.push("new ");
                let callee_has_call = contains_call(&new_expr.callee);
                if callee_has_call {
                    self.push("(");
                    self.print_expr(&new_expr.callee, P_TOP, false);
                    self.push(")");
                } else {
                    self.print_expr(&new_expr.callee, 19, false);
                }
                self.push("(");
                self.print_arguments(&new_expr.arguments);
                self.push(")");
            }
            Expression::StaticMemberExpression(member) => {
                self.print_static_member(member, stmt_start)
            }
            Expression::ComputedMemberExpression(member) => {
                self.print_computed_member(member, stmt_start)
            }
            Expression::PrivateFieldExpression(member) => {
                self.print_member_object(&member.object, stmt_start);
                self.push(".#");
                self.push(member.field.name.as_str());
            }
            Expression::ChainExpression(chain) => match &chain.expression {
                ChainElement::CallExpression(call) => self.print_call(call, stmt_start),
                ChainElement::StaticMemberExpression(member) => {
                    self.print_static_member(member, stmt_start)
                }
                ChainElement::ComputedMemberExpression(member) => {
                    self.print_computed_member(member, stmt_start)
                }
                ChainElement::PrivateFieldExpression(member) => {
                    self.print_member_object(&member.object, stmt_start);
                    self.push("?.#");
                    self.push(member.field.name.as_str());
                }
                ChainElement::TSNonNullExpression(non_null) => {
                    self.print_expr(&non_null.expression, P_LHS, stmt_start);
                    self.push("!");
                }
            },
            Expression::ImportExpression(import) => {
                self.push("import(");
                self.print_expr(&import.source, P_ASSIGN, false);
                if let Some(options) = &import.options {
                    self.push(", ");
                    self.print_expr(options, P_ASSIGN, false);
                }
                self.push(")");
            }
            Expression::JSXElement(element) => self.print_jsx_element(element),
            Expression::JSXFragment(fragment) => self.print_jsx_fragment(fragment),
            Expression::TSAsExpression(as_expr) => {
                self.print_expr(&as_expr.expression, 11, stmt_start);
                self.push(" as ");
                self.print_ts_type(&as_expr.type_annotation);
            }
            Expression::TSSatisfiesExpression(satisfies) => {
                self.print_expr(&satisfies.expression, 11, stmt_start);
                self.push(" satisfies ");
                self.print_ts_type(&satisfies.type_annotation);
            }
            Expression::TSNonNullExpression(non_null) => {
                self.print_expr(&non_null.expression, P_LHS, stmt_start);
                self.push("!");
            }
            Expression::TSInstantiationExpression(instantiation) => {
                self.print_expr(&instantiation.expression, P_LHS, stmt_start);
                let raw = self.src(instantiation.type_arguments.span).to_string();
                self.push(&raw);
            }
            Expression::TSTypeAssertion(assertion) => {
                self.push("<");
                self.print_ts_type(&assertion.type_annotation);
                self.push(">");
                self.print_expr(&assertion.expression, 16, false);
            }
            Expression::ParenthesizedExpression(paren) => {
                // preserve_parens is off, but stay safe.
                self.print_expr(&paren.expression, min, stmt_start);
            }
            Expression::V8IntrinsicExpression(other) => {
                let raw = self.src(other.span).to_string();
                self.push(&raw);
            }
        }
    }

    fn print_update_target(&mut self, target: &SimpleAssignmentTarget<'_>) {
        match target {
            SimpleAssignmentTarget::AssignmentTargetIdentifier(id) => self.push(id.name.as_str()),
            SimpleAssignmentTarget::StaticMemberExpression(member) => {
                self.print_static_member(member, false)
            }
            SimpleAssignmentTarget::ComputedMemberExpression(member) => {
                self.print_computed_member(member, false)
            }
            other => {
                let raw = self.src(other.span()).to_string();
                self.push(&raw);
            }
        }
    }

    fn print_logical(&mut self, logical: &LogicalExpression<'_>, stmt_start: bool) {
        let prec = match logical.operator {
            LogicalOperator::Coalesce => 4,
            LogicalOperator::Or => 5,
            LogicalOperator::And => 6,
        };
        let mixed = |operand: &Expression<'_>| -> bool {
            match (&logical.operator, operand) {
                (LogicalOperator::Coalesce, Expression::LogicalExpression(inner)) => {
                    inner.operator != LogicalOperator::Coalesce
                }
                (
                    LogicalOperator::Or | LogicalOperator::And,
                    Expression::LogicalExpression(inner),
                ) => inner.operator == LogicalOperator::Coalesce,
                _ => false,
            }
        };
        if mixed(&logical.left) {
            self.push("(");
            self.print_expr(&logical.left, P_TOP, false);
            self.push(")");
        } else {
            self.print_expr(&logical.left, prec, stmt_start);
        }
        self.push(" ");
        self.push(logical.operator.as_str());
        self.push(" ");
        if mixed(&logical.right) {
            self.push("(");
            self.print_expr(&logical.right, P_TOP, false);
            self.push(")");
        } else {
            self.print_expr(&logical.right, prec + 1, false);
        }
    }

    fn print_binary(&mut self, binary: &BinaryExpression<'_>, stmt_start: bool) {
        let prec = binary_prec(binary.operator);
        if binary.operator == BinaryOperator::Exponential {
            // Right-associative; unary/prefix left operands are a syntax
            // error without parens (`-1 ** 2`), so the left context floor is
            // above them.
            self.print_expr(&binary.left, 17, stmt_start);
            self.push(" ** ");
            self.print_expr(&binary.right, prec, false);
        } else {
            self.print_expr(&binary.left, prec, stmt_start);
            self.push(" ");
            self.push(binary.operator.as_str());
            self.push(" ");
            self.print_expr(&binary.right, prec + 1, false);
        }
    }

    fn print_call(&mut self, call: &CallExpression<'_>, stmt_start: bool) {
        self.print_callee(&call.callee, stmt_start);
        if call.optional {
            self.push("?.");
        }
        if let Some(type_arguments) = &call.type_arguments {
            let raw = self.src(type_arguments.span).to_string();
            self.push(&raw);
        }
        self.push("(");
        self.print_arguments(&call.arguments);
        self.push(")");
    }

    fn print_callee(&mut self, callee: &Expression<'_>, stmt_start: bool) {
        match callee {
            // A chain callee outside its own chain needs parens: `(a?.b)()`.
            Expression::ChainExpression(_) => {
                self.push("(");
                self.print_expr(callee, P_TOP, false);
                self.push(")");
            }
            // Function expressions print bare as callees (Babel only wraps
            // at statement start); arrows always need parens (prec 3 < 18).
            _ => self.print_expr(callee, P_LHS, stmt_start),
        }
    }

    fn print_arguments(&mut self, arguments: &oxc_allocator::Vec<'_, Argument<'_>>) {
        let mut first = true;
        for argument in arguments {
            if !first {
                self.push(", ");
            }
            first = false;
            match argument {
                Argument::SpreadElement(spread) => {
                    self.push("...");
                    self.print_expr(&spread.argument, P_ASSIGN, false);
                }
                other => {
                    if let Some(expression) = other.as_expression() {
                        self.print_expr(expression, P_ASSIGN, false);
                        self.print_argument_trailing_comment(expression.span().end);
                    }
                }
            }
        }
    }

    /// `fn(a, b /* y */)` — trailing block comment directly after an
    /// argument, same line.
    fn print_argument_trailing_comment(&mut self, end: u32) {
        let bytes = self.source.as_bytes();
        let mut pos = end as usize;
        while pos < bytes.len() && (bytes[pos] == b' ' || bytes[pos] == b'\t') {
            pos += 1;
        }
        let Some(comment) = self
            .comments
            .iter()
            .find(|comment| {
                comment.span.start as usize == pos && !comment.is_line && !self.is_printed(comment)
            })
            .cloned()
        else {
            return;
        };
        self.mark_printed(&comment);
        let text = self.comment_text(&comment).to_string();
        self.push(" ");
        self.push(&text);
    }

    fn print_member_object(&mut self, object: &Expression<'_>, stmt_start: bool) {
        match object {
            Expression::ChainExpression(_) => {
                self.push("(");
                self.print_expr(object, P_TOP, false);
                self.push(")");
            }
            Expression::NumericLiteral(literal) => {
                let raw = self.src(literal.span).to_string();
                let needs_space = raw
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || byte == b'_');
                self.push(&raw);
                if needs_space {
                    // `5 .toFixed(1)` — Babel separates instead of wrapping.
                    self.push(" ");
                }
            }
            _ => self.print_expr(object, P_LHS, stmt_start),
        }
    }

    fn print_static_member(&mut self, member: &StaticMemberExpression<'_>, stmt_start: bool) {
        self.print_member_object(&member.object, stmt_start);
        if member.optional {
            self.push("?.");
        } else {
            self.push(".");
        }
        self.push(member.property.name.as_str());
    }

    fn print_computed_member(&mut self, member: &ComputedMemberExpression<'_>, stmt_start: bool) {
        self.print_member_object(&member.object, stmt_start);
        if member.optional {
            self.push("?.");
        }
        self.push("[");
        self.print_expr(&member.expression, P_TOP, false);
        self.push("]");
    }

    fn print_template(&mut self, template: &TemplateLiteral<'_>) {
        self.push("`");
        for (index, quasi) in template.quasis.iter().enumerate() {
            let raw = quasi.value.raw.as_str().to_string();
            self.push(&raw);
            if let Some(expression) = template.expressions.get(index) {
                self.push("${");
                self.print_expr(expression, P_TOP, false);
                self.push("}");
            }
        }
        self.push("`");
    }

    fn print_array(&mut self, array: &ArrayExpression<'_>) {
        self.push("[");
        let len = array.elements.len();
        for (index, element) in array.elements.iter().enumerate() {
            match element {
                ArrayExpressionElement::Elision(_) => {}
                ArrayExpressionElement::SpreadElement(spread) => {
                    if index > 0 {
                        self.push(" ");
                    }
                    self.push("...");
                    self.print_expr(&spread.argument, P_ASSIGN, false);
                }
                other => {
                    if index > 0 {
                        self.push(" ");
                    }
                    if let Some(expression) = other.as_expression() {
                        self.print_expr(expression, P_ASSIGN, false);
                    }
                }
            }
            let is_hole = matches!(element, ArrayExpressionElement::Elision(_));
            if index < len - 1 || is_hole {
                self.push(",");
            }
        }
        self.push("]");
    }

    fn print_object(&mut self, object: &ObjectExpression<'_>) {
        if object.properties.is_empty() {
            self.push("{}");
            return;
        }
        self.push("{");
        self.indent += 1;
        let mut first = true;
        for property in &object.properties {
            if !first {
                self.push(",");
            }
            first = false;
            self.newline();
            match property {
                ObjectPropertyKind::SpreadProperty(spread) => {
                    self.push("...");
                    self.print_expr(&spread.argument, P_ASSIGN, false);
                }
                ObjectPropertyKind::ObjectProperty(entry) => self.print_object_property(entry),
            }
        }
        self.indent -= 1;
        self.newline();
        self.push("}");
    }

    fn print_object_property(&mut self, property: &ObjectProperty<'_>) {
        if property.method || property.kind != PropertyKind::Init {
            let (function, is_arrow) = match &property.value {
                Expression::FunctionExpression(function) => (Some(function), false),
                Expression::ArrowFunctionExpression(_) => (None, true),
                _ => (None, false),
            };
            if let Some(function) = function {
                if function.r#async {
                    self.push("async ");
                }
                match property.kind {
                    PropertyKind::Get => self.push("get "),
                    PropertyKind::Set => self.push("set "),
                    PropertyKind::Init => {}
                }
                if function.generator {
                    self.push("*");
                }
                self.print_property_key(&property.key, property.computed);
                self.print_params(&function.params);
                if let Some(return_type) = &function.return_type {
                    self.push(": ");
                    self.print_ts_type(&return_type.type_annotation);
                }
                self.push(" ");
                if let Some(body) = &function.body {
                    self.print_block_body(body);
                } else {
                    self.push("{}");
                }
                return;
            }
            let _ = is_arrow;
        }
        if property.shorthand
            && let Some(name) = property.key.static_name()
        {
            self.push(&name);
            return;
        }
        self.print_property_key(&property.key, property.computed);
        self.push(": ");
        self.print_expr(&property.value, P_ASSIGN, false);
    }

    fn print_property_key(&mut self, key: &PropertyKey<'_>, computed: bool) {
        if computed {
            self.push("[");
            if let Some(expression) = key.as_expression() {
                self.print_expr(expression, P_TOP, false);
            }
            self.push("]");
            return;
        }
        match key {
            PropertyKey::StaticIdentifier(id) => self.push(id.name.as_str()),
            PropertyKey::PrivateIdentifier(id) => {
                self.push("#");
                self.push(id.name.as_str());
            }
            other => {
                // String/numeric keys keep their raw text.
                let raw = self.src(other.span()).to_string();
                self.push(&raw);
            }
        }
    }

    // --- JSX ------------------------------------------------------------------------

    fn print_jsx_element(&mut self, element: &JSXElement<'_>) {
        self.push("<");
        self.print_jsx_element_name(&element.opening_element.name);
        if let Some(type_arguments) = &element.opening_element.type_arguments {
            let raw = self.src(type_arguments.span).to_string();
            self.push(&raw);
        }
        for attribute in &element.opening_element.attributes {
            self.push(" ");
            match attribute {
                JSXAttributeItem::Attribute(attribute) => {
                    self.print_jsx_attribute_name(&attribute.name);
                    if let Some(value) = &attribute.value {
                        self.push("=");
                        match value {
                            JSXAttributeValue::StringLiteral(literal) => {
                                let raw = self.src(literal.span).to_string();
                                self.push(&raw);
                            }
                            JSXAttributeValue::ExpressionContainer(container) => {
                                self.print_jsx_expression_container(container);
                            }
                            JSXAttributeValue::Element(inner) => self.print_jsx_element(inner),
                            JSXAttributeValue::Fragment(inner) => self.print_jsx_fragment(inner),
                        }
                    }
                }
                JSXAttributeItem::SpreadAttribute(spread) => {
                    self.push("{...");
                    self.print_expr(&spread.argument, P_ASSIGN, false);
                    self.push("}");
                }
            }
        }
        if element.closing_element.is_none() {
            self.push(" />");
            return;
        }
        self.push(">");
        // Babel's generator indents while printing JSX children — JSX text
        // stays raw, but expression containers inside pick up the level.
        self.indent += 1;
        for child in &element.children {
            self.print_jsx_child(child);
        }
        self.indent -= 1;
        self.push("</");
        self.print_jsx_element_name(&element.opening_element.name);
        self.push(">");
    }

    fn print_jsx_fragment(&mut self, fragment: &JSXFragment<'_>) {
        self.push("<>");
        self.indent += 1;
        for child in &fragment.children {
            self.print_jsx_child(child);
        }
        self.indent -= 1;
        self.push("</>");
    }

    fn print_jsx_child(&mut self, child: &JSXChild<'_>) {
        match child {
            JSXChild::Text(text) => {
                // Verbatim, including source whitespace — Babel does not
                // re-indent JSX text.
                let raw = self.src(text.span).to_string();
                self.push(&raw);
            }
            JSXChild::Element(element) => self.print_jsx_element(element),
            JSXChild::Fragment(fragment) => self.print_jsx_fragment(fragment),
            JSXChild::ExpressionContainer(container) => {
                self.print_jsx_expression_container(container)
            }
            JSXChild::Spread(spread) => {
                self.push("{...");
                self.print_expr(&spread.expression, P_ASSIGN, false);
                self.push("}");
            }
        }
    }

    fn print_jsx_expression_container(&mut self, container: &JSXExpressionContainer<'_>) {
        if matches!(&container.expression, JSXExpression::EmptyExpression(_)) {
            // `{/* comment */}` — raw slice keeps the comment text exactly;
            // mark enclosed comments printed.
            for comment in self.comments {
                if comment.span.start >= container.span.start
                    && comment.span.end <= container.span.end
                {
                    self.mark_printed(comment);
                }
            }
            let raw = self.src(container.span).to_string();
            self.push(&raw);
            return;
        }
        self.push("{");
        if let Some(expression) = container.expression.as_expression() {
            self.print_expr(expression, P_TOP, false);
        }
        self.push("}");
    }

    fn print_jsx_element_name(&mut self, name: &JSXElementName<'_>) {
        let raw = self.src(name.span()).to_string();
        self.push(&raw);
    }

    fn print_jsx_attribute_name(&mut self, name: &JSXAttributeName<'_>) {
        let raw = self.src(name.span()).to_string();
        self.push(&raw);
    }

    // --- TypeScript types ---------------------------------------------------------

    fn print_type_parameters(
        &mut self,
        type_parameters: &TSTypeParameterDeclaration<'_>,
        arrow: bool,
    ) {
        self.push("<");
        let mut first = true;
        for param in &type_parameters.params {
            if !first {
                self.push(", ");
            }
            first = false;
            self.push(param.name.name.as_str());
            if let Some(constraint) = &param.constraint {
                self.push(" extends ");
                self.print_ts_type(constraint);
            }
            if let Some(default) = &param.default {
                self.push(" = ");
                self.print_ts_type(default);
            }
        }
        // Babel disambiguates single-parameter arrow generics from JSX with
        // a trailing comma.
        if arrow && type_parameters.params.len() == 1 {
            self.push(",");
        }
        self.push(">");
    }

    fn print_ts_type(&mut self, ts_type: &TSType<'_>) {
        match ts_type {
            TSType::TSTypeReference(reference) => {
                self.print_ts_type_name(&reference.type_name);
                if let Some(type_arguments) = &reference.type_arguments {
                    self.push("<");
                    let mut first = true;
                    for argument in &type_arguments.params {
                        if !first {
                            self.push(", ");
                        }
                        first = false;
                        self.print_ts_type(argument);
                    }
                    self.push(">");
                }
            }
            TSType::TSStringKeyword(_) => self.push("string"),
            TSType::TSNumberKeyword(_) => self.push("number"),
            TSType::TSBooleanKeyword(_) => self.push("boolean"),
            TSType::TSAnyKeyword(_) => self.push("any"),
            TSType::TSUnknownKeyword(_) => self.push("unknown"),
            TSType::TSNeverKeyword(_) => self.push("never"),
            TSType::TSVoidKeyword(_) => self.push("void"),
            TSType::TSUndefinedKeyword(_) => self.push("undefined"),
            TSType::TSNullKeyword(_) => self.push("null"),
            TSType::TSObjectKeyword(_) => self.push("object"),
            TSType::TSSymbolKeyword(_) => self.push("symbol"),
            TSType::TSBigIntKeyword(_) => self.push("bigint"),
            TSType::TSThisType(_) => self.push("this"),
            TSType::TSIntrinsicKeyword(_) => self.push("intrinsic"),
            TSType::TSArrayType(array) => {
                let needs_parens = matches!(
                    &array.element_type,
                    TSType::TSUnionType(_)
                        | TSType::TSIntersectionType(_)
                        | TSType::TSFunctionType(_)
                );
                if needs_parens {
                    self.push("(");
                }
                self.print_ts_type(&array.element_type);
                if needs_parens {
                    self.push(")");
                }
                self.push("[]");
            }
            TSType::TSTupleType(tuple) => {
                self.push("[");
                let mut first = true;
                for element in &tuple.element_types {
                    if !first {
                        self.push(", ");
                    }
                    first = false;
                    match element.as_ts_type() {
                        Some(entry) => self.print_ts_type(entry),
                        None => {
                            let raw = self.src(element.span()).to_string();
                            self.push(&raw);
                        }
                    }
                }
                self.push("]");
            }
            TSType::TSUnionType(union) => {
                let mut first = true;
                for entry in &union.types {
                    if !first {
                        self.push(" | ");
                    }
                    first = false;
                    self.print_ts_type(entry);
                }
            }
            TSType::TSIntersectionType(intersection) => {
                let mut first = true;
                for entry in &intersection.types {
                    if !first {
                        self.push(" & ");
                    }
                    first = false;
                    self.print_ts_type(entry);
                }
            }
            TSType::TSLiteralType(literal) => {
                let raw = self.src(literal.span).to_string();
                self.push(&raw);
            }
            TSType::TSTypeLiteral(literal) => {
                // Babel prints type literals multiline with `;` members.
                if literal.members.is_empty() {
                    self.push("{}");
                    return;
                }
                self.push("{");
                self.indent += 1;
                for member in &literal.members {
                    self.newline();
                    let raw = self
                        .src(member.span())
                        .trim_end_matches([';', ','])
                        .to_string();
                    self.push(&raw);
                    self.push(";");
                }
                self.indent -= 1;
                self.newline();
                self.push("}");
            }
            TSType::TSTypeQuery(query) => {
                let raw = self.src(query.span).to_string();
                self.push(&raw);
            }
            TSType::TSTypeOperatorType(operator) => {
                let raw = self.src(operator.span).to_string();
                self.push(&raw);
            }
            TSType::TSIndexedAccessType(indexed) => {
                self.print_ts_type(&indexed.object_type);
                self.push("[");
                self.print_ts_type(&indexed.index_type);
                self.push("]");
            }
            TSType::TSParenthesizedType(paren) => {
                self.push("(");
                self.print_ts_type(&paren.type_annotation);
                self.push(")");
            }
            // Exotic types (conditional, mapped, infer, template literal,
            // function/constructor types...) fall back to the raw source
            // slice — a documented signature-format divergence.
            other => {
                let raw = self.src(other.span()).to_string();
                self.push(&raw);
            }
        }
    }

    fn print_ts_type_name(&mut self, name: &TSTypeName<'_>) {
        let raw = self.src(name.span()).to_string();
        self.push(&raw);
    }
}

/// `new (f())()` — a call anywhere in the callee's member spine forces
/// parens.
fn contains_call(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::CallExpression(_) | Expression::ImportExpression(_) => true,
        Expression::ChainExpression(_) => true,
        Expression::StaticMemberExpression(member) => contains_call(&member.object),
        Expression::ComputedMemberExpression(member) => contains_call(&member.object),
        Expression::PrivateFieldExpression(member) => contains_call(&member.object),
        Expression::NewExpression(_) => false,
        Expression::TSNonNullExpression(non_null) => contains_call(&non_null.expression),
        Expression::TaggedTemplateExpression(tagged) => contains_call(&tagged.tag),
        _ => false,
    }
}

fn binary_prec(operator: BinaryOperator) -> u8 {
    use BinaryOperator::*;
    match operator {
        BitwiseOR => 7,
        BitwiseXOR => 8,
        BitwiseAnd => 9,
        Equality | Inequality | StrictEquality | StrictInequality => 10,
        LessThan | LessEqualThan | GreaterThan | GreaterEqualThan | Instanceof | In => 11,
        ShiftLeft | ShiftRight | ShiftRightZeroFill => 12,
        Addition | Subtraction => 13,
        Multiplication | Division | Remainder => 14,
        Exponential => 15,
    }
}

/// Babel's "cannot start an expression statement" set — these get wrapped in
/// parens at statement-start position (the node itself, not the whole
/// expression).
fn starts_statement_token(expression: &Expression<'_>) -> bool {
    matches!(
        expression,
        Expression::FunctionExpression(_)
            | Expression::ClassExpression(_)
            | Expression::ObjectExpression(_)
    )
}

fn starts_with_object(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::ObjectExpression(_) => true,
        Expression::AssignmentExpression(_) => false,
        Expression::BinaryExpression(binary) => starts_with_object(&binary.left),
        Expression::LogicalExpression(logical) => starts_with_object(&logical.left),
        Expression::ConditionalExpression(conditional) => starts_with_object(&conditional.test),
        Expression::CallExpression(call) => starts_with_object(&call.callee),
        Expression::StaticMemberExpression(member) => starts_with_object(&member.object),
        Expression::ComputedMemberExpression(member) => starts_with_object(&member.object),
        Expression::TaggedTemplateExpression(tagged) => starts_with_object(&tagged.tag),
        Expression::SequenceExpression(sequence) => {
            sequence.expressions.first().is_some_and(starts_with_object)
        }
        Expression::TSAsExpression(as_expr) => starts_with_object(&as_expr.expression),
        Expression::TSSatisfiesExpression(satisfies) => starts_with_object(&satisfies.expression),
        Expression::TSNonNullExpression(non_null) => starts_with_object(&non_null.expression),
        _ => false,
    }
}
