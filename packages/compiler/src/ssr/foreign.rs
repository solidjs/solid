//! Which `<script>`/`<style>` elements parse in SVG/MathML (foreign) content.
//!
//! In HTML those two are raw text, so the SSR output writes their children
//! as-is. Under `<svg>`/`<math>` they are ordinary elements whose text parses
//! as markup and character references, so it has to escape like any other
//! text. Mirrors the Babel plugin's `isInForeignContent`: the nearest JSX
//! ancestor that settles the namespace decides, components are transparent,
//! and an element with no deciding ancestor is HTML. The pass runs before
//! lowering, while every JSX ancestor (including those around JSX inside
//! expressions) is still in place.

use oxc_ast::ast::{
    Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElement, JSXExpression,
    Program,
};
use oxc_ast_visit::{Visit, walk};
use oxc_span::Span;

use crate::shared::constants::{mathml_elements, svg_elements};
use crate::shared::utils::{element_name, is_component_name};

const SVG_NS: &str = "http://www.w3.org/2000/svg";
const MATHML_NS: &str = "http://www.w3.org/1998/Math/MathML";

/// Start tags that leave foreign content as HTML elements (`font` only with
/// color/face/size, so it is left undecided).
const BREAKOUT_TAGS: &[&str] = &[
    "b",
    "big",
    "blockquote",
    "body",
    "br",
    "center",
    "code",
    "dd",
    "div",
    "dl",
    "dt",
    "em",
    "embed",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "hr",
    "i",
    "img",
    "li",
    "listing",
    "menu",
    "meta",
    "nobr",
    "ol",
    "p",
    "pre",
    "ruby",
    "s",
    "small",
    "span",
    "strike",
    "strong",
    "sub",
    "sup",
    "table",
    "tt",
    "u",
    "ul",
    "var",
];
/// SVG's HTML integration points and MathML's text integration points.
const HTML_INTEGRATION_POINTS: &[&str] = &[
    "foreignObject",
    "desc",
    "title",
    "mi",
    "mo",
    "mn",
    "ms",
    "mtext",
];

#[derive(Clone, Copy, PartialEq)]
enum Namespace {
    Html,
    Foreign,
    Undecided,
}

fn static_attribute(element: &JSXElement<'_>, name: &str) -> Option<String> {
    element.opening_element.attributes.iter().find_map(|attr| {
        let JSXAttributeItem::Attribute(attr) = attr else {
            return None;
        };
        let JSXAttributeName::Identifier(id) = &attr.name else {
            return None;
        };
        if id.name != name {
            return None;
        }
        match &attr.value {
            Some(JSXAttributeValue::StringLiteral(s)) => Some(s.value.to_string()),
            Some(JSXAttributeValue::ExpressionContainer(c)) => match &c.expression {
                JSXExpression::StringLiteral(s) => Some(s.value.to_string()),
                _ => None,
            },
            _ => None,
        }
    })
}

fn has_foreign_xmlns(element: &JSXElement<'_>) -> bool {
    matches!(
        static_attribute(element, "xmlns").as_deref(),
        Some(SVG_NS | MATHML_NS)
    )
}

fn classify(element: &JSXElement<'_>, tag_name: &str) -> Namespace {
    if HTML_INTEGRATION_POINTS.contains(&tag_name) || BREAKOUT_TAGS.contains(&tag_name) {
        return Namespace::Html;
    }
    if tag_name == "annotation-xml" {
        let encoding = static_attribute(element, "encoding").map(|e| e.to_ascii_lowercase());
        return match encoding.as_deref() {
            Some("text/html" | "application/xhtml+xml") => Namespace::Html,
            _ => Namespace::Foreign,
        };
    }
    if has_foreign_xmlns(element)
        || (tag_name != "font" && (svg_elements(tag_name) || mathml_elements(tag_name)))
    {
        return Namespace::Foreign;
    }
    Namespace::Undecided
}

/// Spans of the `<script>`/`<style>` elements in `program` that sit in
/// foreign content.
pub(crate) fn foreign_raw_text_spans(program: &Program<'_>) -> std::vec::Vec<Span> {
    struct Collector {
        ancestors: std::vec::Vec<Namespace>,
        spans: std::vec::Vec<Span>,
    }
    impl<'a> Visit<'a> for Collector {
        fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
            let name = &element.opening_element.name;
            let tag_name = (!is_component_name(name))
                .then(|| element_name(name).ok())
                .flatten();
            let Some(tag_name) = tag_name else {
                // Components are transparent: their children usually render in place.
                walk::walk_jsx_element(self, element);
                return;
            };
            if (tag_name == "script" || tag_name == "style")
                && (has_foreign_xmlns(element)
                    || self
                        .ancestors
                        .iter()
                        .rev()
                        .find(|ns| **ns != Namespace::Undecided)
                        == Some(&Namespace::Foreign))
            {
                self.spans.push(element.span);
            }
            self.ancestors.push(classify(element, &tag_name));
            walk::walk_jsx_element(self, element);
            self.ancestors.pop();
        }
        fn visit_expression(&mut self, expression: &Expression<'a>) {
            walk::walk_expression(self, expression);
        }
    }
    let mut collector = Collector {
        ancestors: std::vec::Vec::new(),
        spans: std::vec::Vec::new(),
    };
    collector.visit_program(program);
    collector.spans
}
