//! Load ordinary JavaScript, TypeScript, and JSX leaves from the parser's
//! legal-TSX scaffold without deserializing `FlatTape`.

use std::collections::HashMap;

use oxc_allocator::{Allocator, CloneIn, TakeIn};
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
    parenthesized: HashMap<AuthoredSpan, AuthoredSpan>,
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
                preserve_parens: true,
                ..oxc_parser::ParseOptions::default()
            })
            .parse();
        if let Some(error) = crate::shared::parser::first_parser_error(parsed.diagnostics) {
            return Err(CompileError::parse(error));
        }
        let map = LeafMap::new(projection.view().segments, projected);
        let mut program = parsed.program;
        let mut parentheses = ParenthesesNormalizer {
            allocator,
            map: &map,
            authored: HashMap::new(),
        };
        parentheses.visit_program(&mut program);
        let parenthesized = parentheses.authored;
        Ok(Self {
            program,
            map,
            parenthesized,
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

    pub fn parenthesized_starts(&self) -> HashMap<u32, u32> {
        self.parenthesized
            .iter()
            .map(|(outer, inner)| (outer.start, inner.start))
            .collect()
    }

    pub fn finish(mut self, authored_source: &'a str) -> Program<'a> {
        // Comments are not visited by SpanRebaser. Keep only verbatim authored
        // comments, then rebase both their text and their attachment before
        // switching source_text. Scaffold offsets must never index authored UTF-8.
        let starts = self.parenthesized_starts();
        let map = &self.map;
        self.program.comments.retain_mut(|comment| {
            let Some(authored) = map.authored_span(comment.span) else {
                return false;
            };
            comment.span = Span::new(authored.start, authored.end);
            let attached = map
                .authored_endpoint(comment.attached_to, true)
                .unwrap_or(authored.end);
            comment.attached_to = starts.get(&attached).copied().unwrap_or(attached);
            true
        });
        self.program.source_text = authored_source;
        self.program
    }

    /// Clone the expression corresponding to `authored`, including authored
    /// parentheses removed before lowering.
    pub fn expression(
        &self,
        allocator: &'a Allocator,
        authored: AuthoredSpan,
    ) -> Option<Expression<'a>> {
        let mut finder = ExpressionFinder {
            allocator,
            map: &self.map,
            target: self
                .parenthesized
                .get(&authored)
                .copied()
                .unwrap_or(authored),
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
    synthetic_statement_ends: Vec<u32>,
}

impl LeafMap {
    fn new(segments: &[ProjectionSegment], projected: &str) -> Self {
        Self {
            // The parser inserts a separator before line-leading markup. Only
            // recognize an unmapped semicolon between contiguous authored bytes.
            synthetic_statement_ends: segments
                .windows(2)
                .filter_map(|pair| {
                    let left = &pair[0];
                    let right = &pair[1];
                    (left.original_start + left.projected.end - left.projected.start
                        == right.original_start
                        && projected
                            .get(left.projected.end as usize..right.projected.start as usize)
                            == Some(";")
                        && projected.as_bytes().get(right.projected.start as usize) == Some(&b'<'))
                    .then_some(right.projected.start)
                })
                .collect(),
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
        let projected = self.without_synthetic_terminator(projected);
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
        let projected = self.without_synthetic_terminator(projected);
        let start = self.authored_endpoint(projected.start, true)?;
        let end = self.authored_endpoint(projected.end, false)?;
        (start <= end).then_some(AuthoredSpan { start, end })
    }

    fn without_synthetic_terminator(&self, span: Span) -> Span {
        if span.start < span.end
            && self
                .synthetic_statement_ends
                .binary_search(&span.end)
                .is_ok()
        {
            Span::new(span.start, span.end - 1)
        } else {
            span
        }
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

/// Keep authored parenthesis spans available for leaf lookup, then unwrap
/// expression nodes before scaffold and JSX lowering.
/// Only contiguous authored spans become aliases; synthetic scaffolds must not
/// acquire an authored expression identity from their surrounding parentheses.
struct ParenthesesNormalizer<'a, 'm> {
    allocator: &'a Allocator,
    map: &'m LeafMap,
    authored: HashMap<AuthoredSpan, AuthoredSpan>,
}

impl<'a> VisitMut<'a> for ParenthesesNormalizer<'a, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        walk_mut::walk_expression(self, expression);
        if let Expression::ParenthesizedExpression(parenthesized) = expression {
            if let (Some(outer), Some(inner)) = (
                self.map.authored_span(parenthesized.span),
                self.map.authored_span(parenthesized.expression.span()),
            ) {
                self.authored.insert(outer, inner);
            }
            *expression = parenthesized.expression.take_in(&self.allocator);
        }
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
    fn finished_comments_have_authored_provenance() {
        let source = "/*! license 🚀 */ export function F(items) @{ const local = /* @__PURE__ */ factory(); @for(const item of items; key(/* key 🚀 */ item.id)) { <div>{local}</div> } }";
        let allocator = Allocator::default();
        let leaves = LeafProgram::parse(&allocator, source).unwrap();
        let expected = leaves
            .program
            .comments
            .iter()
            .filter_map(|comment| {
                leaves
                    .map
                    .authored_span(comment.span)
                    .map(|span| Span::new(span.start, span.end))
            })
            .collect::<Vec<_>>();
        assert_eq!(expected.len(), 3);
        assert!(
            leaves.program.comments[0].is_leading(),
            "{:?}",
            leaves.program.comments[0]
        );
        let program = leaves.finish(source);
        assert_eq!(
            program
                .comments
                .iter()
                .map(|comment| comment.span)
                .collect::<Vec<_>>(),
            expected
        );
        for comment in &program.comments {
            assert!(comment.span.source_text(source).starts_with("/*"));
            assert!(source.is_char_boundary(comment.attached_to as usize));
        }
    }

    #[test]
    fn preserves_codegen_comment_contract() {
        let source = "/*! license */ export function F(items) @{ const local = /* @__PURE__ */ factory(); @for(const item of items; key(/* key */ item.id)) { <div>{local}</div> } }";
        let allocator = Allocator::default();
        let lowered =
            super::super::run_compiler_frontend(&allocator, source, Some("comment.tsrx")).unwrap();
        assert_eq!(lowered.program.comments.len(), 3);
        let output = crate::compile(
            source,
            &crate::CompileOptions {
                filename: Some("comment.tsrx".into()),
                source_map: true,
                ..crate::CompileOptions::default()
            },
        )
        .unwrap();
        assert!(output.code.contains("license"), "{}", output.code);
    }

    #[test]
    fn codegen_comments_use_authored_utf8_offsets() {
        for generate in [
            crate::Generate::Dom,
            crate::Generate::Ssr,
            crate::Generate::Universal,
        ] {
            for value in ["🚀", "x🚀x", "é", "abcd"] {
                let source = format!(
                    "export function F(items, ready) @{{ @for(const item of items; key(item.id + \"{value}\")) {{ <div/> }} }}"
                );
                let result = std::panic::catch_unwind(|| {
                    crate::compile(
                        &source,
                        &crate::CompileOptions {
                            filename: Some("comments.tsrx".into()),
                            generate,
                            source_map: true,
                            ..crate::CompileOptions::default()
                        },
                    )
                });
                let output = result
                    .expect("codegen must not panic on authored UTF-8")
                    .expect("valid TSRX");
                let allocator = Allocator::default();
                let parsed =
                    oxc_parser::Parser::new(&allocator, &output.code, SourceType::mjs()).parse();
                assert!(
                    parsed.diagnostics.is_empty(),
                    "invalid generated JS: {}",
                    output.code
                );
            }
        }
    }

    #[test]
    fn loads_parenthesized_key_with_authored_inner_span() {
        for key in [
            "(item.id)",
            "(((item.id)))",
            "( /* before */ (item.id) /* after */ )",
        ] {
            let source = format!(
                "export function F(items) @{{ @for(const item of items; key{key}) {{ <div/> }} }}"
            );
            let allocator = Allocator::default();
            let leaves = LeafProgram::parse(&allocator, &source).expect("parser scaffold");
            let start = source.find(key).unwrap() as u32;
            let expression = leaves
                .expression(
                    &allocator,
                    AuthoredSpan {
                        start,
                        end: start + key.len() as u32,
                    },
                )
                .expect("parenthesized authored key");
            assert!(matches!(expression, Expression::StaticMemberExpression(_)));
            let inner = source.find("item.id").unwrap() as u32;
            assert_eq!(expression.span(), Span::new(inner, inner + 7));
        }
    }

    #[test]
    fn normalizes_parentheses_before_scaffold_lowering() {
        let source = "export function F(items, ready) @{ @if ((ready && items)) { <div>{((ready ? 1 : 2) + 3) * 4}</div> } @for(const item of items; key((item.id))) { <div/> } }";
        let allocator = Allocator::default();
        let leaves = LeafProgram::parse(&allocator, source).unwrap();
        let baseline =
            oxc_parser::Parser::new(&allocator, leaves.program.source_text, SourceType::tsx())
                .with_options(oxc_parser::ParseOptions {
                    preserve_parens: false,
                    ..oxc_parser::ParseOptions::default()
                })
                .parse();
        assert!(baseline.diagnostics.is_empty());
        // Includes scaffold parentheses and precedence-sensitive expressions.
        assert_eq!(
            oxc_codegen::Codegen::new().build(&leaves.program).code,
            oxc_codegen::Codegen::new().build(&baseline.program).code,
        );
        struct NoParentheses;
        impl<'a> Visit<'a> for NoParentheses {
            fn visit_expression(&mut self, expression: &Expression<'a>) {
                assert!(!matches!(
                    expression,
                    Expression::ParenthesizedExpression(_)
                ));
                walk::walk_expression(self, expression);
            }
        }
        NoParentheses.visit_program(&leaves.program);
    }

    #[test]
    fn does_not_alias_parentheses_across_synthetic_segments() {
        let allocator = Allocator::default();
        let mut parsed = oxc_parser::Parser::new(&allocator, "(value)", SourceType::tsx())
            .with_options(oxc_parser::ParseOptions {
                preserve_parens: true,
                ..oxc_parser::ParseOptions::default()
            })
            .parse();
        let map = LeafMap {
            segments: vec![LeafSegment {
                projected: Span::new(1, 6),
                authored_start: 10,
            }],
            synthetic_statement_ends: Vec::new(),
        };
        let mut normalizer = ParenthesesNormalizer {
            allocator: &allocator,
            map: &map,
            authored: HashMap::new(),
        };
        normalizer.visit_program(&mut parsed.program);
        assert!(normalizer.authored.is_empty());
        assert_eq!(
            oxc_codegen::Codegen::new()
                .build(&parsed.program)
                .code
                .trim(),
            "value;"
        );
    }

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

    #[test]
    fn does_not_map_unrelated_generated_semicolons() {
        for (projected, next_authored_start) in [("a;<b/>", 3), ("a;b", 1)] {
            let segments = [
                ProjectionSegment {
                    projected: tsrx_syntax::ByteSpan { start: 0, end: 1 },
                    original_start: 0,
                    fixable: true,
                },
                ProjectionSegment {
                    projected: tsrx_syntax::ByteSpan {
                        start: 2,
                        end: projected.len() as u32,
                    },
                    original_start: next_authored_start,
                    fixable: true,
                },
            ];
            let map = LeafMap::new(&segments, projected);
            let statement = Span::new(0, 2);
            assert!(map.authored_span(statement).is_none(), "{projected}");
            assert!(map.authored_extent(statement).is_none(), "{projected}");
        }
    }

    #[test]
    fn loads_only_the_complete_statement_at_a_synthetic_boundary() {
        for suffix in ["\n", " // café 🚀\r\n", " /* comment */\n"] {
            let source =
                format!("export function F() @{{ const a = () => 1{suffix}<div>{{a()}}</div> }}");
            let allocator = Allocator::default();
            let leaves = LeafProgram::parse(&allocator, &source).expect("parser scaffold");
            let start = source.find("const a").unwrap() as u32;
            let end = source.find("<div>").unwrap() as u32;
            let statement = leaves
                .statement(&allocator, AuthoredSpan { start, end })
                .expect("statement ending at synthetic separator");
            assert_eq!(statement.span(), Span::new(start, end));
            assert!(
                leaves
                    .statement(
                        &allocator,
                        AuthoredSpan {
                            start,
                            end: end - 1
                        }
                    )
                    .is_none()
            );
            assert!(
                leaves
                    .statement(
                        &allocator,
                        AuthoredSpan {
                            start: start + 1,
                            end
                        }
                    )
                    .is_none()
            );
        }
    }

    #[test]
    fn authored_semicolons_keep_their_original_extent() {
        let source = "export function F() @{ const a = () => 1;\n<div>{a()}</div> }";
        let allocator = Allocator::default();
        let leaves = LeafProgram::parse(&allocator, source).expect("parser scaffold");
        let start = source.find("const a").unwrap() as u32;
        let end = source.find(';').unwrap() as u32 + 1;
        let statement = leaves
            .statement(&allocator, AuthoredSpan { start, end })
            .unwrap();
        assert_eq!(statement.span(), Span::new(start, end));
        assert!(
            leaves
                .statement(
                    &allocator,
                    AuthoredSpan {
                        start,
                        end: end - 1
                    }
                )
                .is_none()
        );
    }
}
