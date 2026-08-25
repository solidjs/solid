//! Port of the Babel plugin's `shared/validate.ts`: detects template HTML
//! that a browser's `innerHTML` parser would restructure (implied end tags,
//! foster parenting, nested `<a>`/`<form>`, …) by re-parsing the markup with
//! a spec HTML parser (html5ever, the Rust counterpart of parse5) and
//! comparing the serialized result against the input.

use html5ever::tendril::TendrilSink;
use html5ever::{
    ParseOpts, QualName, local_name, ns, parse_fragment, serialize,
    serialize::{SerializeOpts, TraversalScope},
};
use markup5ever_rcdom::{RcDom, SerializableHandle};

pub(crate) struct InvalidMarkup {
    /// The normalized input (tags + `#text` placeholders).
    pub(crate) html: String,
    /// What the browser's parser produced from evaluating `html`.
    pub(crate) browser: String,
}

/// Returns information about the mismatch when the markup is invalid,
/// mirroring Babel's `isInvalidMarkup`.
pub(crate) fn is_invalid_markup(html: &str) -> Option<InvalidMarkup> {
    // Normalize dom-expressions comment placeholders so their positions are
    // validated too.
    let mut html = html
        .replace("<!>", "<!---->")
        .replace("<!$>", "<!--$-->")
        .replace("<!/>", "<!--/-->");

    // Text nodes are problematic ("doesn't" vs "doesn&#39;t"), so they all
    // become `#text` — the browser moving a text node still moves the
    // placeholder.
    html = replace_leading_text(&html);
    html = replace_trailing_text(&html);
    html = replace_inner_text(&html);

    // Fix escaping so it doesn't mess up the validation:
    // `&lt;script>a();&lt;/script>` -> `&lt;script&gt;a();&lt;/script&gt;`
    html = fix_lt_escapes(&html);

    // Edge cases: table partials are assumed to be used in the right place.
    if html.starts_with("<td>") || html.starts_with("<th>") {
        html = format!("<table><tbody><tr>{html}</tr></tbody></table>");
    }
    if html.starts_with("<tr>") {
        html = format!("<table><tbody>{html}</tbody></table>");
    }
    if html.starts_with("<col>") {
        html = format!("<table><colgroup>{html}</colgroup></table>");
    }
    if ["<thead>", "<tbody>", "<tfoot>", "<colgroup>", "<caption>"]
        .iter()
        .any(|prefix| html.starts_with(prefix))
    {
        html = format!("<table>{html}</table>");
    }

    // Empty table components round-trip losing the wrapper; skip them.
    match html.as_str() {
        "<table></table>"
        | "<table><thead></thead></table>"
        | "<table><tbody></tbody></table>"
        | "<table><thead></thead><tbody></tbody></table>" => return None,
        _ => {}
    }

    let browser = inner_html(&html);

    if html.to_lowercase() != browser.to_lowercase() {
        return Some(InvalidMarkup { html, browser });
    }
    None
}

/// Parses `html` as if assigned to a `<body>` element's `innerHTML` and
/// serializes the result back to a string.
fn inner_html(html: &str) -> String {
    let dom = parse_fragment(
        RcDom::default(),
        ParseOpts::default(),
        QualName::new(None, ns!(html), local_name!("body")),
        Vec::new(),
        false,
    )
    .one(html);

    // The fragment's parsed children live under a synthetic <html> root.
    let document = dom.document;
    let children = document.children.borrow();
    let Some(root) = children.first() else {
        return String::new();
    };

    let mut output = Vec::new();
    let handle = SerializableHandle::from(root.clone());
    if serialize(
        &mut output,
        &handle,
        SerializeOpts {
            traversal_scope: TraversalScope::ChildrenOnly(None),
            ..SerializeOpts::default()
        },
    )
    .is_err()
    {
        return String::new();
    }
    String::from_utf8_lossy(&output).into_owned()
}

/// `^[^<]+` -> `#text`
fn replace_leading_text(html: &str) -> String {
    match html.find('<') {
        Some(0) => html.to_string(),
        Some(position) => format!("#text{}", &html[position..]),
        None if html.is_empty() => String::new(),
        None => "#text".to_string(),
    }
}

/// `[^>]+$` -> `#text`
fn replace_trailing_text(html: &str) -> String {
    match html.rfind('>') {
        Some(position) if position + 1 < html.len() => format!("{}#text", &html[..=position]),
        Some(_) => html.to_string(),
        None if html.is_empty() => String::new(),
        None => "#text".to_string(),
    }
}

/// `>[^<]+<` -> `>#text<` (global)
fn replace_inner_text(html: &str) -> String {
    let bytes = html.as_bytes();
    let mut output = String::with_capacity(html.len());
    let mut cursor = 0;
    while let Some(offset) = html[cursor..].find('>') {
        let start = cursor + offset + 1;
        output.push_str(&html[cursor..start]);
        match html[start..].find('<') {
            Some(0) => cursor = start,
            Some(gap) => {
                output.push_str("#text");
                cursor = start + gap;
            }
            None => {
                // No closing `<`: the trailing-text pass already handled it.
                cursor = start;
            }
        }
        debug_assert!(cursor <= bytes.len());
    }
    output.push_str(&html[cursor..]);
    output
}

/// `&lt;([^>]+)>` -> `&lt;$1&gt;` (global)
fn fix_lt_escapes(html: &str) -> String {
    let mut output = String::with_capacity(html.len());
    let mut cursor = 0;
    while let Some(offset) = html[cursor..].find("&lt;") {
        let entity_end = cursor + offset + 4;
        output.push_str(&html[cursor..entity_end]);
        match html[entity_end..].find('>') {
            // `[^>]+` needs at least one char between the entity and `>`.
            Some(gap) if gap > 0 => {
                output.push_str(&html[entity_end..entity_end + gap]);
                output.push_str("&gt;");
                cursor = entity_end + gap + 1;
            }
            _ => cursor = entity_end,
        }
    }
    output.push_str(&html[cursor..]);
    output
}
