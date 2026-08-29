//! Load ordinary JavaScript, TypeScript, and JSX leaves from the parser's
//! legal-TSX scaffold without deserializing `FlatTape`.

use oxc_allocator::{Allocator, CloneIn};
use oxc_ast::ast::{BindingPattern, Expression, Program, Statement};
use oxc_ast_visit::{Visit, VisitMut, walk, walk_mut};
use oxc_span::{GetSpan, SourceType, Span};
use tsrx_syntax::{ControlContext, ProjectionSegment, project_for_parser, scan_for_parser};

use super::semantic::AuthoredSpan;
use crate::error::CompileError;

/// An Oxc program containing parser scaffolds plus all authored standard-
/// language leaves. The scaffold is temporary; direct semantic lowering
/// replaces it before the shared JSX transforms run.
pub(super) struct LeafProgram<'a> {
    pub program: Program<'a>,
    pub(super) map: LeafMap,
    marker_prefix: String,
    control_contexts: Vec<ControlContext>,
}

impl<'a> LeafProgram<'a> {
    pub fn parse(allocator: &'a Allocator, source: &str) -> Result<Self, CompileError> {
        let overlay = scan_for_parser(source)
            .map_err(|error| CompileError::parse(format!("TSRX scan failed: {error:?}")))?;
        let control_contexts = overlay
            .view()
            .nodes
            .iter()
            .map(|node| node.context)
            .collect();
        let projection = project_for_parser(source, &overlay)
            .map_err(|error| CompileError::parse(format!("TSRX projection failed: {error:?}")))?;
        let marker_prefix = projection
            .parser_marker_prefix()
            .ok_or_else(|| CompileError::parse("TSRX parser projection has no marker prefix"))?
            .to_string();
        let projected = allocator.alloc_str(projection.source());
        let parsed = oxc_parser::Parser::new(allocator, projected, SourceType::tsx())
            .with_options(oxc_parser::ParseOptions {
                preserve_parens: false,
                ..oxc_parser::ParseOptions::default()
            })
            .parse();
        if let Some(error) = crate::shared::parser::first_parser_error(parsed.diagnostics) {
            return Err(CompileError::parse(error));
        }
        Ok(Self {
            program: parsed.program,
            map: LeafMap::new(projection.view().segments),
            marker_prefix,
            control_contexts,
        })
    }

    pub fn control_contexts(&self) -> &[ControlContext] {
        &self.control_contexts
    }

    pub fn wrapper_name(&self, index: usize) -> String {
        format!("{}W{index}_", self.marker_prefix)
    }

    pub fn marker_prefix(&self) -> &str {
        &self.marker_prefix
    }

    pub fn rebase(&mut self) {
        SpanRebaser { map: &self.map }.visit_program(&mut self.program);
    }

    pub fn finish(mut self, authored_source: &'a str) -> Program<'a> {
        self.program.source_text = authored_source;
        self.program
    }

    /// Clone the smallest expression whose unchanged projected span exactly
    /// corresponds to `authored`.
    pub fn expression(
        &self,
        allocator: &'a Allocator,
        authored: AuthoredSpan,
    ) -> Option<Expression<'a>> {
        let mut finder = ExpressionFinder {
            allocator,
            map: &self.map,
            target: authored,
            found: None,
        };
        finder.visit_program(&self.program);
        finder.found
    }

    pub fn binding_pattern(
        &self,
        allocator: &'a Allocator,
        authored: AuthoredSpan,
    ) -> Option<BindingPattern<'a>> {
        let mut finder = BindingPatternFinder {
            allocator,
            map: &self.map,
            target: authored,
            found: None,
        };
        finder.visit_program(&self.program);
        finder.found
    }

    pub fn statement(
        &self,
        allocator: &'a Allocator,
        authored: AuthoredSpan,
    ) -> Option<Statement<'a>> {
        let mut finder = StatementFinder {
            allocator,
            map: &self.map,
            target: authored,
            found: None,
        };
        finder.visit_program(&self.program);
        finder.found
    }
}

#[derive(Clone, Copy)]
struct LeafSegment {
    projected: Span,
    authored_start: u32,
}

pub(super) struct LeafMap {
    segments: Vec<LeafSegment>,
}

impl LeafMap {
    fn new(segments: &[ProjectionSegment]) -> Self {
        Self {
            segments: segments
                .iter()
                .map(|segment| LeafSegment {
                    projected: Span::new(segment.projected.start, segment.projected.end),
                    authored_start: segment.original_start,
                })
                .collect(),
        }
    }

    fn authored_span(&self, projected: Span) -> Option<AuthoredSpan> {
        let mut index = self
            .segments
            .partition_point(|segment| segment.projected.start <= projected.start)
            .checked_sub(1)?;
        let first = self.segments.get(index)?;
        if projected.start < first.projected.start || projected.start > first.projected.end {
            return None;
        }
        let start = first.authored_start + projected.start - first.projected.start;
        let mut projected_cursor = projected.start;
        let mut authored_cursor = start;
        while projected_cursor < projected.end {
            let segment = self.segments.get(index)?;
            if projected_cursor < segment.projected.start
                || projected_cursor >= segment.projected.end
                || segment.authored_start + projected_cursor - segment.projected.start
                    != authored_cursor
            {
                return None;
            }
            let end = projected.end.min(segment.projected.end);
            authored_cursor += end - projected_cursor;
            projected_cursor = end;
            index += 1;
        }
        Some(AuthoredSpan {
            start,
            end: authored_cursor,
        })
    }

    pub(super) fn authored_extent(&self, projected: Span) -> Option<AuthoredSpan> {
        let start = self.authored_endpoint(projected.start, true)?;
        let end = self.authored_endpoint(projected.end, false)?;
        (start <= end).then_some(AuthoredSpan { start, end })
    }

    pub(super) fn authored_start(&self, projected: Span) -> Option<u32> {
        self.authored_endpoint(projected.start, true)
    }

    fn authored_endpoint(&self, offset: u32, start: bool) -> Option<u32> {
        let index = if start {
            self.segments
                .partition_point(|segment| segment.projected.start <= offset)
        } else {
            self.segments
                .partition_point(|segment| segment.projected.start < offset)
        }
        .checked_sub(1)?;
        let segment = self.segments.get(index)?;
        if offset < segment.projected.start || offset > segment.projected.end {
            return None;
        }
        Some(segment.authored_start + offset - segment.projected.start)
    }
}

struct ExpressionFinder<'a, 'm> {
    allocator: &'a Allocator,
    map: &'m LeafMap,
    target: AuthoredSpan,
    found: Option<Expression<'a>>,
}

impl<'a> Visit<'a> for ExpressionFinder<'a, '_> {
    fn visit_expression(&mut self, expression: &Expression<'a>) {
        if self.found.is_some() {
            return;
        }
        let span = expression.span();
        let exact = self.map.authored_extent(span) == Some(self.target);
        let template_root = matches!(
            expression,
            Expression::JSXElement(_) | Expression::JSXFragment(_)
        ) && self.map.authored_endpoint(span.start, true)
            == Some(self.target.start);
        if exact || template_root {
            let mut expression = expression.clone_in(self.allocator);
            SpanRebaser { map: self.map }.visit_expression(&mut expression);
            self.found = Some(expression);
            return;
        }
        walk::walk_expression(self, expression);
    }
}

struct BindingPatternFinder<'a, 'm> {
    allocator: &'a Allocator,
    map: &'m LeafMap,
    target: AuthoredSpan,
    found: Option<BindingPattern<'a>>,
}

impl<'a> Visit<'a> for BindingPatternFinder<'a, '_> {
    fn visit_binding_pattern(&mut self, pattern: &BindingPattern<'a>) {
        if self.found.is_some() {
            return;
        }
        if self.map.authored_span(pattern.span()) == Some(self.target) {
            let mut pattern = pattern.clone_in(self.allocator);
            SpanRebaser { map: self.map }.visit_binding_pattern(&mut pattern);
            self.found = Some(pattern);
            return;
        }
        walk::walk_binding_pattern(self, pattern);
    }
}

struct StatementFinder<'a, 'm> {
    allocator: &'a Allocator,
    map: &'m LeafMap,
    target: AuthoredSpan,
    found: Option<Statement<'a>>,
}

impl<'a> Visit<'a> for StatementFinder<'a, '_> {
    fn visit_statement(&mut self, statement: &Statement<'a>) {
        if self.found.is_some() {
            return;
        }
        if self.map.authored_extent(statement.span()) == Some(self.target) {
            let mut statement = statement.clone_in(self.allocator);
            SpanRebaser { map: self.map }.visit_statement(&mut statement);
            self.found = Some(statement);
            return;
        }
        walk::walk_statement(self, statement);
    }
}

struct SpanRebaser<'m> {
    map: &'m LeafMap,
}

impl<'a> VisitMut<'a> for SpanRebaser<'_> {
    fn visit_span(&mut self, span: &mut Span) {
        if span.is_unspanned() {
            return;
        }
        *span = self
            .map
            .authored_span(*span)
            .map_or(Span::default(), |authored| {
                Span::new(authored.start, authored.end)
            });
        walk_mut::walk_span(self, span);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_authored_expressions_from_parser_scaffolds() {
        let source = "export function View({ ready, value }: Props) @{ const local = 1; @if (ready) { <section><p>{value + local}</p></section> } }";
        let allocator = Allocator::default();
        let leaves = LeafProgram::parse(&allocator, source).expect("parser scaffold");
        for (authored, start) in [
            ("ready", source.find("@if (ready)").expect("condition") + 5),
            (
                "value + local",
                source.find("value + local").expect("child expression"),
            ),
        ] {
            let start = start as u32;
            let span = AuthoredSpan {
                start,
                end: start + authored.len() as u32,
            };
            assert!(
                leaves.expression(&allocator, span).is_some(),
                "missing {authored}"
            );
        }
    }
}
