use crate::error::Result;
use oxc_ast::ast::Expression;
use oxc_span::Span;

use crate::shared::ast_builder::AstBuilder;
use crate::shared::component_callee::ComponentCalleeContext;
use crate::universal::transform::AstUniversalTransform;

impl<'a> ComponentCalleeContext<'a> for AstUniversalTransform<'a, '_> {
    fn ast(&self) -> AstBuilder<'a> {
        self.ast()
    }

    fn is_built_in(&self, name: &str) -> bool {
        self.built_ins.iter().any(|built_in| built_in == name)
    }

    fn is_builtin_shadowed(&self, span: Span) -> bool {
        self.bindings.is_builtin_shadowed(span)
    }

    fn register_built_in(&mut self, name: &str) {
        if !self
            .built_in_imports
            .iter()
            .any(|built_in| built_in == name)
        {
            self.built_in_imports.push(name.to_string());
        }
    }

    fn capture_this_callee(&mut self, span: Span) -> Result<Expression<'a>> {
        Ok(self.capture_this_expression(span))
    }
}
