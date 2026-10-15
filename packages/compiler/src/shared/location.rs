//! Source positions for the names the compiler carries into output.
//!
//! Two consumers read a `line:column` from the same offset arithmetic and
//! disagree on the column's origin, so both conventions live here:
//!
//! - [`line_column`] is Babel's `loc`: 1-based line, 0-based UTF-16 column.
//!   The refresh pass prints it into its `location` metadata because the
//!   `solid-refresh` Babel plugin did.
//! - [`source_location`] is the `sourceNames` `locations` kind: the same
//!   line, the column **1-based** — the stack-trace / editor convention, so
//!   a browser links `http://localhost:5173/src/App.tsx:18:3` to the right
//!   place and `at src/App.tsx:18:3` in a console report is clickable.

/// Node's `path.relative(root, id)` with separators normalized to `/` — the
/// hash input contract shared with the Babel implementation's `compile()`.
/// Also the refresh pass's cwd-relative `location` strings and the
/// `sourceNames` `locations` paths.
pub(crate) fn relative_id(root: Option<&str>, filename: &str) -> String {
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));
    let root = normalize(&cwd, root.map(std::path::Path::new).unwrap_or(&cwd));
    let file = normalize(&cwd, std::path::Path::new(filename));

    let mut root_parts = root.iter().peekable();
    let mut file_parts = file.iter().peekable();
    while let (Some(a), Some(b)) = (root_parts.peek(), file_parts.peek()) {
        if a != b {
            break;
        }
        root_parts.next();
        file_parts.next();
    }
    let mut parts: Vec<String> = Vec::new();
    for _ in root_parts {
        parts.push("..".to_string());
    }
    for part in file_parts {
        parts.push(part.to_string_lossy().into_owned());
    }
    parts.join("/")
}

/// Resolve against `cwd` and fold `.`/`..` segments (Node `path.resolve`).
fn normalize(cwd: &std::path::Path, path: &std::path::Path) -> std::path::PathBuf {
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    let mut result = std::path::PathBuf::new();
    for component in joined.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                result.pop();
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}

/// Babel loc: 1-based line, 0-based UTF-16 column.
pub(crate) fn line_column(source: &str, offset: u32) -> (usize, usize) {
    let offset = (offset as usize).min(source.len());
    let mut line = 1;
    let mut line_start = 0;
    let mut chars = source[..offset].char_indices().peekable();
    while let Some((position, ch)) = chars.next() {
        let next = match ch {
            '\r' => {
                if chars.peek().is_some_and(|(_, next)| *next == '\n') {
                    let (next_position, next) = chars.next().expect("peeked line feed");
                    next_position + next.len_utf8()
                } else {
                    position + ch.len_utf8()
                }
            }
            '\n' | '\u{2028}' | '\u{2029}' => position + ch.len_utf8(),
            _ => continue,
        };
        line += 1;
        line_start = next;
    }
    let column = source[line_start..offset].encode_utf16().count();
    (line, column)
}

/// The path every location string of a module starts with: `filename` made
/// relative to `root` (the project root; the working directory without one)
/// with posix separators, like the directives pass's ids. `None` without a
/// filename — then no location is emitted at all, the refresh pass's rule.
pub(crate) fn location_base(root: Option<&str>, filename: Option<&str>) -> Option<String> {
    filename.map(|filename| relative_id(root, filename))
}

/// `<base>:<line>:<column>` for the source `offset`, line and column both
/// 1-based. The column is one more than Babel's `loc.column` on purpose:
/// stack traces and editors count columns from 1, and this string is meant
/// to be clicked, where the refresh pass's `location` field is a different
/// consumer that keeps Babel's 0-based column.
pub(crate) fn source_location(base: &str, source: &str, offset: u32) -> String {
    let (line, column) = line_column(source, offset);
    format!("{base}:{line}:{}", column + 1)
}

#[cfg(test)]
mod tests {
    use super::{line_column, source_location};

    #[test]
    fn source_locations_count_javascript_line_terminators_and_utf16_columns() {
        for terminator in ["\n", "\r", "\r\n", "\u{2028}", "\u{2029}"] {
            let source = format!("é🚀{terminator}a🚀z");
            let next_line = "é🚀".len() + terminator.len();
            for (offset, line, column) in [
                (0, 1, 0),
                (2, 1, 1),
                (6, 1, 3),
                (next_line, 2, 0),
                (next_line + 1, 2, 1),
                (next_line + 5, 2, 3),
                (source.len(), 2, 4),
            ] {
                assert_eq!(
                    line_column(&source, offset as u32),
                    (line, column),
                    "offset {offset}, terminator {terminator:?}"
                );
            }
        }
        assert_eq!(line_column("a\r\nb", 2), (2, 0));
        assert_eq!(line_column("", 0), (1, 0));
    }

    #[test]
    fn source_location_columns_are_one_based() {
        assert_eq!(
            source_location("src/App.tsx", "const a = 1;", 0),
            "src/App.tsx:1:1"
        );
        assert_eq!(
            source_location("src/App.tsx", "const a = 1;\n  <Home />", 15),
            "src/App.tsx:2:3"
        );
    }
}
