//! Span hygiene for the directly lowered TSRX program.
//!
//! The lowering builds Solid JSX nodes in place of TSRX constructs. Nodes it
//! synthesizes carry empty (`start == end`) spans so the source map only
//! anchors authored text; without source maps every span is cleared so the
//! codegen never mistakes a stale authored offset for a real position.

use oxc_ast::ast::Program;
use oxc_ast_visit::{VisitMut, walk_mut};
use oxc_span::Span;

pub fn clear_generated_spans<'a>(program: &mut Program<'a>, source_maps: bool) {
    if !source_maps {
        AllSpanClearer.visit_program(program);
        return;
    }
    GeneratedSpanClearer.visit_program(program);
}

struct AllSpanClearer;

impl<'a> VisitMut<'a> for AllSpanClearer {
    fn visit_span(&mut self, span: &mut Span) {
        *span = Span::default();
        walk_mut::walk_span(self, span);
    }
}

struct GeneratedSpanClearer;

impl<'a> VisitMut<'a> for GeneratedSpanClearer {
    fn visit_span(&mut self, span: &mut Span) {
        if span.start == span.end {
            *span = Span::default();
        }
        walk_mut::walk_span(self, span);
    }
}
