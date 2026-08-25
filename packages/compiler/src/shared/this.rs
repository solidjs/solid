use oxc_ast::ast::{Expression, Statement};

use crate::dom::element::AstDomTransform;

impl<'a> AstDomTransform<'a, '_> {
    pub(crate) fn capture_this_expression(&mut self, span: oxc_span::Span) -> Expression<'a> {
        let name = if let Some(name) = &self.current_this_capture {
            name.clone()
        } else if let Some(name) = &self.pending_this_capture {
            let name = name.clone();
            self.current_this_capture = Some(name.clone());
            name
        } else {
            let name = self.next_this_id();
            self.pending_this_capture = Some(name.clone());
            self.current_this_capture = Some(name.clone());
            name
        };
        self.identifier_expression(span, &name)
    }

    pub(crate) fn take_this_capture_statement(
        &mut self,
        span: oxc_span::Span,
    ) -> Option<Statement<'a>> {
        let name = self.pending_this_capture.take()?;
        Some(self.const_statement(span, &name, self.ast().expression_this(span)))
    }

    pub(crate) fn clear_this_capture_context(&mut self) {
        self.current_this_capture = None;
    }

    fn next_this_id(&mut self) -> String {
        crate::shared::utils::next_unique_local("_self", &mut self.this_index, &self.bindings)
    }
}
