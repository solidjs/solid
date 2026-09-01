//! Self-contained TSRX scoped-CSS semantics.
//!
//! This module deliberately has no dependency on the TSRX/Oxc frontend.  The
//! frontend only needs to translate its template into [`Element`] values.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StyleLocation<'a> {
    pub filename: &'a str,
    pub line: u32,
    pub column: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum StyleKind {
    #[default]
    Block,
    Expression,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ElementKind {
    Native(String),
    Dynamic,
    Component,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AttributeValue {
    Static(String),
    Dynamic,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Attribute {
    pub name: String,
    pub value: Option<AttributeValue>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ElementChild {
    Element(Element),
    /// An expression or control-flow boundary which can produce arbitrary
    /// elements. Matching across it must be conservative.
    Dynamic,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Element {
    /// Stable caller-owned identity, returned in `scoped_elements`.
    pub id: u32,
    pub kind: ElementKind,
    pub attributes: Vec<Attribute>,
    pub has_spread: bool,
    pub children: Vec<ElementChild>,
}

#[cfg(test)]
impl Element {
    pub fn native(id: u32, tag: impl Into<String>) -> Self {
        Self {
            id,
            kind: ElementKind::Native(tag.into()),
            attributes: Vec::new(),
            has_spread: false,
            children: Vec::new(),
        }
    }

    pub fn with_static_attr(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.attributes.push(Attribute {
            name: name.into(),
            value: Some(AttributeValue::Static(value.into())),
        });
        self
    }
}

#[derive(Clone, Copy, Debug)]
pub struct StyleInput<'a> {
    pub css: &'a str,
    pub location: StyleLocation<'a>,
    pub elements: &'a [Element],
    pub kind: StyleKind,
    pub minify: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClassMapEntry {
    pub class_name: String,
    pub value: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StyleOutput {
    pub css: String,
    pub hash: String,
    /// Lexicographically sorted, matching `build_style_class_map`.
    pub class_map: Vec<ClassMapEntry>,
    /// Native/dynamic element ids that need the hash class.
    pub scoped_elements: BTreeSet<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StyleError {
    pub message: String,
    pub offset: usize,
}

impl fmt::Display for StyleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} at CSS byte {}", self.message, self.offset)
    }
}

impl std::error::Error for StyleError {}

pub fn compile_style(input: StyleInput<'_>) -> Result<StyleOutput, StyleError> {
    compile_style_with_class_map_selectors(input, false)
}

/// Compile while preserving every standalone class selector exposed by the
/// returned class map. A frontend should set this for a free-standing style
/// block with a `ref`, because the referenced map can apply those classes
/// outside the statically visible element tree.
pub fn compile_style_with_class_map_selectors(
    input: StyleInput<'_>,
    preserve_class_map_selectors: bool,
) -> Result<StyleOutput, StyleError> {
    let hash_source = format!(
        "{}:{}:{}:{}",
        input.location.filename, input.location.line, input.location.column, input.css
    )
    .replace('\r', "");
    let hash = format!("tsrx-{}", &sha256(hash_source.as_bytes())[..8]);
    let mut sheet = Parser::new(input.css).parse()?;
    analyze_items(&mut sheet.items, None)?;

    let mut class_entries = BTreeMap::new();
    collect_class_map(&mut sheet.items, &mut class_entries);
    let arena = Arena::from_roots(input.elements);
    let mut scoped_elements = BTreeSet::new();

    match input.kind {
        StyleKind::Expression => prepare_expression(&mut sheet.items),
        StyleKind::Block => {
            for index in 0..arena.len() {
                prune_items(&mut sheet.items, &arena, index, &mut scoped_elements, None);
            }
            if preserve_class_map_selectors {
                preserve_class_map(&mut sheet.items);
            }
        }
    }

    let local_keyframes = collect_keyframes(&sheet.items);
    let mut render = Render {
        source: input.css,
        hash: &hash,
        minify: input.minify,
        local_keyframes: &local_keyframes,
    };
    let css = if let (Some(first), Some(last)) = (sheet.items.first(), sheet.items.last()) {
        format!(
            "{}{}{}",
            &input.css[..first.span().0],
            render.items(&sheet.items, false),
            &input.css[last.span().1..]
        )
    } else {
        input.css.to_string()
    };
    let class_map = class_entries
        .into_iter()
        .map(|(class_name, (start, end))| ClassMapEntry {
            value: format!("{hash} {class_name}"),
            class_name,
            start,
            end,
        })
        .collect();
    Ok(StyleOutput {
        css,
        hash,
        class_map,
        scoped_elements,
    })
}

#[derive(Clone, Debug)]
struct Sheet {
    items: Vec<Item>,
}

#[derive(Clone, Debug)]
enum Item {
    Rule(Rule),
    At(AtRule),
    Decl(Declaration),
}

impl Item {
    fn span(&self) -> (usize, usize) {
        match self {
            Self::Rule(x) => (x.start, x.end),
            Self::At(x) => (x.start, x.end),
            Self::Decl(x) => (x.start, x.end_with_semicolon),
        }
    }
}

#[derive(Clone, Debug)]
struct Rule {
    start: usize,
    end: usize,
    selectors: SelectorList,
    block: Block,
    parent: Option<usize>,
    global_block: bool,
}

#[derive(Clone, Debug)]
struct AtRule {
    start: usize,
    end: usize,
    name: String,
    prelude: String,
    prelude_start: usize,
    block: Option<Block>,
}

#[derive(Clone, Debug)]
struct Declaration {
    start: usize,
    end_with_semicolon: usize,
    property: String,
    value: String,
    value_start: usize,
}

#[derive(Clone, Debug)]
struct Block {
    start: usize,
    end: usize,
    items: Vec<Item>,
}

#[derive(Clone, Debug)]
struct SelectorList {
    start: usize,
    end: usize,
    selectors: Vec<Complex>,
}

#[derive(Clone, Debug)]
struct Complex {
    start: usize,
    end: usize,
    parts: Vec<Relative>,
    used: bool,
    class_map: bool,
}

#[derive(Clone, Debug)]
struct Relative {
    start: usize,
    combinator: Option<(String, usize, usize)>,
    simple: Vec<Simple>,
    global: bool,
    global_like: bool,
    scoped: bool,
}

#[derive(Clone, Debug)]
enum Simple {
    Type(String, usize, usize),
    Class(String, usize, usize),
    Id(String, usize, usize),
    Attr(AttrSelector),
    Pseudo(Pseudo),
    PseudoElement(usize, usize),
    Nest(usize, usize),
    Other(usize, usize),
}

impl Simple {
    fn span(&self) -> (usize, usize) {
        match self {
            Self::Type(_, a, b)
            | Self::Class(_, a, b)
            | Self::Id(_, a, b)
            | Self::PseudoElement(a, b)
            | Self::Nest(a, b)
            | Self::Other(a, b) => (*a, *b),
            Self::Attr(x) => (x.start, x.end),
            Self::Pseudo(x) => (x.start, x.end),
        }
    }
}

#[derive(Clone, Debug)]
struct AttrSelector {
    start: usize,
    end: usize,
    name: String,
    op: Option<String>,
    value: Option<String>,
    insensitive: bool,
}

#[derive(Clone, Debug)]
struct Pseudo {
    start: usize,
    end: usize,
    name: String,
    args: Option<SelectorList>,
}

mod analysis;
mod hash;
mod parser;
mod render;

#[cfg(test)]
mod tests;

use analysis::*;
use hash::sha256;
use parser::Parser;
use render::Render;
