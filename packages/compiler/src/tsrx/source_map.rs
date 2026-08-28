//! Source-map support for the authored-text TSRX projection.
//!
//! Oxc codegen maps generated JavaScript back to the projected TSX. This
//! module records the authored bytes copied into that projection and composes
//! codegen's map through those exact ranges. Generated projection gaps remain
//! explicitly unmapped instead of being attributed to nearby TSRX syntax.

use oxc_sourcemap::{SourceMap, SourceMapBuilder};
use oxc_syntax::identifier::is_identifier_name;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProjectionSegment {
    projected_start: u32,
    projected_end: u32,
    authored_start: u32,
}

/// Exact affine ranges copied from authored TSRX into projected TSX.
#[derive(Debug)]
pub(super) struct ProjectionMap {
    enabled: bool,
    segments: Vec<ProjectionSegment>,
}

impl ProjectionMap {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            segments: Vec::new(),
        }
    }

    pub fn record_verbatim(
        &mut self,
        projected_start: u32,
        authored_start: u32,
        authored_end: u32,
    ) {
        if !self.enabled || authored_end <= authored_start {
            return;
        }
        let len = authored_end - authored_start;
        let projected_end = projected_start + len;
        if let Some(previous) = self.segments.last_mut()
            && previous.projected_end == projected_start
            && previous.authored_start + (previous.projected_end - previous.projected_start)
                == authored_start
        {
            previous.projected_end = projected_end;
            return;
        }
        self.segments.push(ProjectionSegment {
            projected_start,
            projected_end,
            authored_start,
        });
    }

    fn authored_offset(&self, projected_offset: u32) -> Option<u32> {
        let index = self
            .segments
            .partition_point(|segment| segment.projected_start <= projected_offset);
        let segment = self.segments.get(index.checked_sub(1)?)?;
        (projected_offset < segment.projected_end)
            .then(|| segment.authored_start + projected_offset - segment.projected_start)
    }
}

/// Compose an Oxc JavaScript → projected-TSX map into a JavaScript → authored-
/// TSRX map. Tokens landing in generated projection gaps are retained as
/// source-less mappings so a preceding authored mapping cannot bleed across
/// generated code.
pub(super) fn compose(
    intermediate: &SourceMap<'_>,
    projection: &ProjectionMap,
    projected_source: &str,
    authored_source: &str,
    filename: &str,
) -> String {
    let projected_lines = LineOffsets::new(projected_source);
    let authored_lines = LineOffsets::new(authored_source);
    let mut builder = SourceMapBuilder::default();
    let source_id = builder.set_source_and_content(filename, authored_source);
    if let Some(file) = intermediate.get_file() {
        builder.set_file(file);
    }

    for token in intermediate.get_tokens() {
        let mapped = token
            .get_source_id()
            .and_then(|_| projected_lines.byte_offset(token.get_src_line(), token.get_src_col()))
            .and_then(|offset| projection.authored_offset(offset))
            .and_then(|offset| authored_lines.line_column(offset));

        if let Some((line, column)) = mapped {
            let name_id = token
                .get_name_id()
                .and_then(|id| intermediate.get_name(id))
                // Oxc derives names by slicing a node's source span. Projected
                // wrapper and whole-pattern spans can therefore yield strings
                // such as `{ name }`, which are not source-map symbol names.
                .filter(|name| is_identifier_name(name))
                .map(|name| builder.add_name(name));
            builder.add_token(
                token.get_dst_line(),
                token.get_dst_col(),
                line,
                column,
                Some(source_id),
                name_id,
            );
        } else {
            builder.add_token(token.get_dst_line(), token.get_dst_col(), 0, 0, None, None);
        }
    }

    builder.into_sourcemap().to_json_string()
}

/// Converts between UTF-8 byte offsets and source-map line/UTF-16-column
/// coordinates. JavaScript source maps count lines from zero.
struct LineOffsets<'a> {
    source: &'a str,
    starts: Vec<u32>,
}

impl<'a> LineOffsets<'a> {
    fn new(source: &'a str) -> Self {
        let mut starts = vec![0];
        let mut chars = source.char_indices().peekable();
        while let Some((offset, ch)) = chars.next() {
            let next = match ch {
                '\r' => {
                    if chars.peek().is_some_and(|(_, next)| *next == '\n') {
                        let (next_offset, next) = chars.next().expect("peeked line feed");
                        next_offset + next.len_utf8()
                    } else {
                        offset + ch.len_utf8()
                    }
                }
                '\n' | '\u{2028}' | '\u{2029}' => offset + ch.len_utf8(),
                _ => continue,
            };
            starts.push(next as u32);
        }
        Self { source, starts }
    }

    fn byte_offset(&self, line: u32, utf16_column: u32) -> Option<u32> {
        let start = *self.starts.get(line as usize)? as usize;
        let end = self
            .starts
            .get(line as usize + 1)
            .copied()
            .map_or(self.source.len(), |offset| offset as usize);
        let mut column = 0u32;
        for (relative, ch) in self.source[start..end].char_indices() {
            if column == utf16_column {
                return Some((start + relative) as u32);
            }
            column += ch.len_utf16() as u32;
            if column > utf16_column {
                return None;
            }
        }
        (column == utf16_column).then_some(end as u32)
    }

    fn line_column(&self, byte_offset: u32) -> Option<(u32, u32)> {
        let byte_offset = byte_offset as usize;
        if byte_offset > self.source.len() || !self.source.is_char_boundary(byte_offset) {
            return None;
        }
        let line = self
            .starts
            .partition_point(|start| *start as usize <= byte_offset)
            .checked_sub(1)?;
        let start = self.starts[line] as usize;
        let column = self.source[start..byte_offset].encode_utf16().count() as u32;
        Some((line as u32, column))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_map_resolves_only_exact_verbatim_ranges() {
        let mut map = ProjectionMap::new(true);
        map.record_verbatim(3, 10, 14);
        map.record_verbatim(7, 14, 16);
        map.record_verbatim(12, 30, 32);

        assert_eq!(map.authored_offset(2), None);
        assert_eq!(map.authored_offset(3), Some(10));
        assert_eq!(map.authored_offset(8), Some(15));
        assert_eq!(map.authored_offset(9), None);
        assert_eq!(map.authored_offset(12), Some(30));
        assert_eq!(map.authored_offset(14), None);
    }

    #[test]
    fn line_offsets_use_utf16_columns_and_javascript_line_breaks() {
        let lines = LineOffsets::new("🚀a\r\n中\u{2028}z");
        assert_eq!(lines.byte_offset(0, 0), Some(0));
        assert_eq!(lines.byte_offset(0, 2), Some(4));
        assert_eq!(lines.byte_offset(0, 1), None);
        assert_eq!(lines.byte_offset(1, 1), Some(10));
        assert_eq!(lines.byte_offset(2, 0), Some(13));
        assert_eq!(lines.line_column(4), Some((0, 2)));
        assert_eq!(lines.line_column(7), Some((1, 0)));
        assert_eq!(lines.line_column(13), Some((2, 0)));
    }

    #[test]
    fn composition_preserves_generated_gaps_as_unmapped_tokens() {
        let projected = "xxname yy";
        let authored = "before name after";
        let mut projection = ProjectionMap::new(true);
        projection.record_verbatim(2, 7, 11);

        let mut intermediate = SourceMapBuilder::default();
        let projected_id = intermediate.set_source_and_content("input.tsrx", projected);
        let invalid_name = intermediate.add_name("{ name }");
        let valid_name = intermediate.add_name("name");
        intermediate.add_token(0, 0, 0, 0, Some(projected_id), None);
        intermediate.add_token(0, 2, 0, 2, Some(projected_id), Some(invalid_name));
        intermediate.add_token(0, 3, 0, 3, Some(projected_id), Some(valid_name));
        intermediate.add_token(0, 6, 0, 6, Some(projected_id), None);
        let intermediate = intermediate.into_sourcemap();

        let json = compose(
            &intermediate,
            &projection,
            projected,
            authored,
            "input.tsrx",
        );
        let composed = SourceMap::from_json_string(&json).expect("valid composed map");
        let tokens = composed.get_tokens().collect::<Vec<_>>();
        assert_eq!(tokens[0].get_source_id(), None);
        assert_eq!(tokens[1].get_source_id(), Some(0));
        assert_eq!((tokens[1].get_src_line(), tokens[1].get_src_col()), (0, 7));
        assert_eq!(tokens[1].get_name_id(), None);
        assert_eq!(tokens[2].get_source_id(), Some(0));
        assert_eq!(tokens[2].get_name_id(), Some(0));
        assert_eq!(tokens[3].get_source_id(), None);
        assert_eq!(composed.get_names().collect::<Vec<_>>(), vec!["name"]);
        assert_eq!(composed.get_source_content(0), Some(authored));
    }
}
