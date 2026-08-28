//! Frontend planning for TSRX scoped styles.
//!
//! This module translates parser tape into the CSS engine's element model,
//! assigns style actions to authored nodes, and prepares renderer-facing hash
//! and ref metadata. It intentionally owns no general TSRX construct emission.

use std::collections::{BTreeMap, BTreeSet};

use super::project::ProjectError;
use super::{
    style::{
        self, Attribute, AttributeValue, ClassMapEntry, Element, ElementChild, ElementKind,
        StyleInput, StyleKind, StyleLocation,
    },
    tape::{self, Node},
};

#[derive(Clone)]
pub(super) enum StyleAction {
    Remove,
    ClassMap(Vec<ClassMapEntry>),
    EmptyElement,
}

#[derive(Clone)]
pub(super) struct RefSetup<'t> {
    pub(super) target: Node<'t>,
    pub(super) class_map: Vec<ClassMapEntry>,
    pub(super) temp_name: Option<String>,
}

pub(super) struct StyleProjection<'t> {
    pub(super) actions: BTreeMap<u32, StyleAction>,
    pub(super) element_hashes: BTreeMap<u32, Vec<String>>,
    pub(super) owner_setups: BTreeMap<u32, Vec<RefSetup<'t>>>,
    pub(super) css: String,
    pub(super) css_hash: Option<String>,
}

pub(super) fn plan<'s, 't>(
    source: &'s str,
    filename: &'s str,
    root: Node<'t>,
) -> Result<StyleProjection<'t>, ProjectError> {
    StyleProcessor::process(source, filename, root)
}

struct StyleProcessor<'s, 't> {
    source: &'s str,
    filename: &'s str,
    consumed: BTreeSet<u32>,
    actions: BTreeMap<u32, StyleAction>,
    element_hashes: BTreeMap<u32, Vec<String>>,
    owner_setups: BTreeMap<u32, Vec<RefSetup<'t>>>,
    stylesheets: Vec<(String, String)>,
    identifiers: BTreeSet<String>,
    next_temp: usize,
}

impl<'s, 't> StyleProcessor<'s, 't> {
    fn process(
        source: &'s str,
        filename: &'s str,
        root: Node<'t>,
    ) -> Result<StyleProjection<'t>, ProjectError> {
        let mut identifiers = BTreeSet::new();
        tape::walk(root, &mut |node| {
            if node.ty() == "Identifier"
                && let Some(name) = node.str_field("name")
            {
                identifiers.insert(name.to_string());
            }
            true
        });
        let mut processor = Self {
            source,
            filename,
            consumed: BTreeSet::new(),
            actions: BTreeMap::new(),
            element_hashes: BTreeMap::new(),
            owner_setups: BTreeMap::new(),
            stylesheets: Vec::new(),
            identifiers,
            next_temp: 0,
        };
        processor.visit(root, None)?;
        let css = processor
            .stylesheets
            .iter()
            .map(|(css, _)| css.as_str())
            .collect();
        let hashes: Vec<_> = processor
            .stylesheets
            .iter()
            .map(|(_, hash)| hash.as_str())
            .collect();
        Ok(StyleProjection {
            actions: processor.actions,
            element_hashes: processor.element_hashes,
            owner_setups: processor.owner_setups,
            css,
            css_hash: (!hashes.is_empty()).then(|| hashes.join(" ")),
        })
    }

    fn visit(&mut self, node: Node<'t>, parent: Option<Node<'t>>) -> Result<(), ProjectError> {
        if node.ty() == "JSXStyleElement" {
            let start = span_of(node)?.0;
            if !self.consumed.contains(&start) {
                if is_style_expression_position(parent) {
                    self.compile_expression_style(node)?;
                } else {
                    self.actions.insert(start, StyleAction::EmptyElement);
                }
            }
            return Ok(());
        }

        if node.ty() == "JSXCodeBlock"
            && let Some(render) = node.node_field("render")
            && is_native_render_root(render)
        {
            self.prepare_runtime_scope(node, render)?;
        } else if matches!(node.ty(), "JSXElement" | "JSXFragment") {
            self.prepare_runtime_scope(node, node)?;
        }

        if node.ty() == "JSXForExpression" {
            self.mark_unowned_styles(node);
            return Ok(());
        }
        let skipped_pending = (node.ty() == "JSXTryExpression")
            .then(|| node.node_field("pending"))
            .flatten();
        for child in semantic_children(node) {
            if skipped_pending.is_some_and(|pending| pending.span() == child.span()) {
                self.mark_unowned_styles(child);
            } else {
                self.visit(child, Some(node))?;
            }
        }
        Ok(())
    }

    fn mark_unowned_styles(&mut self, node: Node<'t>) {
        if is_function_or_class_boundary(node) {
            return;
        }
        if node.ty() == "JSXStyleElement" {
            if let Some((start, _)) = node.span()
                && !self.consumed.contains(&start)
            {
                self.actions.insert(start, StyleAction::EmptyElement);
            }
            return;
        }
        for child in structural_children(node, StructuralMode::Runtime) {
            self.mark_unowned_styles(child);
        }
    }

    fn consume_runtime_styles(&mut self, node: Node<'t>) {
        if is_function_or_class_boundary(node) {
            return;
        }
        if node.ty() == "JSXStyleElement" {
            if let Some((start, _)) = node.span() {
                self.consumed.insert(start);
                self.actions.insert(start, StyleAction::Remove);
            }
            return;
        }
        for child in structural_children(node, StructuralMode::Runtime) {
            self.consume_runtime_styles(child);
        }
    }

    fn prepare_runtime_scope(
        &mut self,
        setup_owner: Node<'t>,
        render_owner: Node<'t>,
    ) -> Result<(), ProjectError> {
        let render_children = structural_children(render_owner, StructuralMode::Runtime);
        let mut styles = Vec::new();
        for child in &render_children {
            collect_runtime_styles(*child, &self.consumed, &mut styles);
        }
        if styles.len() > 1 {
            return Err(error(
                "TSRX fragments can only have one style tag",
                styles[1],
            ));
        }
        let Some(style_node) = styles.first().copied() else {
            return Ok(());
        };
        let style_start = span_of(style_node)?.0;
        if self.consumed.contains(&style_start) {
            return Ok(());
        }

        let (css, location) = self.style_source(style_node)?;
        let roots = build_style_elements(&render_children);
        let mut annotatable = BTreeSet::new();
        collect_annotatable_ids(&roots, &mut annotatable);
        let refs = style_ref_targets(style_node);
        let output = style::compile_style_with_class_map_selectors(
            StyleInput {
                css,
                location,
                elements: &roots,
                kind: StyleKind::Block,
                minify: false,
            },
            !refs.is_empty(),
        )
        .map_err(|style_error| self.style_error(style_node, style_error))?;
        if !refs.is_empty() {
            let owner_start = span_of(setup_owner)?.0;
            for target in refs {
                self.add_ref_setup(owner_start, target, output.class_map.clone());
            }
        }
        for id in annotatable {
            self.element_hashes
                .entry(id)
                .or_default()
                .push(output.hash.clone());
        }
        self.consume_runtime_styles(render_owner);
        self.stylesheets.push((output.css, output.hash));
        Ok(())
    }

    fn compile_expression_style(&mut self, style_node: Node<'t>) -> Result<(), ProjectError> {
        let start = span_of(style_node)?.0;
        let (css, location) = self.style_source(style_node)?;
        let output = style::compile_style(StyleInput {
            css,
            location,
            elements: &[],
            kind: StyleKind::Expression,
            minify: false,
        })
        .map_err(|style_error| self.style_error(style_node, style_error))?;
        self.actions
            .insert(start, StyleAction::ClassMap(output.class_map));
        self.stylesheets.push((output.css, output.hash));
        Ok(())
    }

    fn style_source(&self, node: Node<'t>) -> Result<(&'s str, StyleLocation<'s>), ProjectError> {
        let css = node.str_field("css").ok_or_else(|| {
            error(
                "A TSRX <style> element is missing its raw stylesheet payload",
                node,
            )
        })?;
        let opening_end = node
            .node_field("openingElement")
            .and_then(Node::span)
            .map(|span| span.1)
            .ok_or_else(|| error("A TSRX <style> element is malformed", node))?;
        let payload_end = node
            .node_field("closingElement")
            .and_then(Node::span)
            .map_or(opening_end, |span| span.0);
        let raw = self
            .source
            .get(opening_end as usize..payload_end as usize)
            .ok_or_else(|| error("A TSRX <style> payload span is invalid", node))?;
        if decode_json_string(css).as_deref() != Some(raw) {
            return Err(error(
                "TSRX parser returned stylesheet bytes that do not match the authored source",
                node,
            ));
        }
        let (line, column) = source_line_column(self.source, span_of(node)?.0);
        Ok((
            raw,
            StyleLocation {
                filename: self.filename,
                line,
                column,
            },
        ))
    }

    fn style_error(&self, node: Node<'t>, style_error: style::StyleError) -> ProjectError {
        let payload_start = node
            .node_field("openingElement")
            .and_then(Node::span)
            .map_or_else(|| node.span().map_or(0, |span| span.0), |span| span.1);
        ProjectError {
            message: style_error.message,
            start: payload_start.saturating_add(style_error.offset as u32),
        }
    }

    fn add_ref_setup(&mut self, owner: u32, target: Node<'t>, class_map: Vec<ClassMapEntry>) {
        if target.ty() == "ArrayExpression" {
            for element in target.list_field("elements").flatten() {
                let target = if element.ty() == "SpreadElement" {
                    element.node_field("argument").unwrap_or(element)
                } else {
                    element
                };
                self.add_ref_setup(owner, target, class_map.clone());
            }
            return;
        }
        let temp_name = if is_direct_ref_target(target) || is_callback_ref(target) {
            None
        } else {
            Some(self.next_temp_name())
        };
        self.owner_setups.entry(owner).or_default().push(RefSetup {
            target,
            class_map,
            temp_name,
        });
    }

    fn next_temp_name(&mut self) -> String {
        loop {
            self.next_temp += 1;
            let name = format!("_tsrx_style_ref_{}", self.next_temp);
            if self.identifiers.insert(name.clone()) {
                return name;
            }
        }
    }
}

fn error(message: impl Into<String>, node: Node<'_>) -> ProjectError {
    ProjectError {
        message: message.into(),
        start: node.span().map(|(start, _)| start).unwrap_or(0),
    }
}

fn span_of(node: Node<'_>) -> Result<(u32, u32), ProjectError> {
    node.span().ok_or_else(|| {
        error(
            format!("{} node is missing its source span", node.ty()),
            node,
        )
    })
}

fn source_line_column(source: &str, offset: u32) -> (u32, u32) {
    let offset = (offset as usize).min(source.len());
    let before = &source.as_bytes()[..offset];
    let line = 1 + before.iter().filter(|byte| **byte == b'\n').count() as u32;
    let line_start = before
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |position| position + 1);
    (
        line,
        source[line_start..offset].encode_utf16().count() as u32,
    )
}

fn is_native_render_root(node: Node<'_>) -> bool {
    matches!(
        node.ty(),
        "JSXElement"
            | "JSXFragment"
            | "JSXIfExpression"
            | "JSXForExpression"
            | "JSXSwitchExpression"
            | "JSXTryExpression"
    )
}

fn is_style_expression_position(parent: Option<Node<'_>>) -> bool {
    !parent.is_some_and(|parent| {
        matches!(
            parent.ty(),
            "JSXCodeBlock"
                | "JSXElement"
                | "JSXFragment"
                | "JSXStyleElement"
                | "BlockStatement"
                | "Program"
                | "SwitchCase"
        )
    })
}

fn is_function_or_class_boundary(node: Node<'_>) -> bool {
    matches!(
        node.ty(),
        "FunctionDeclaration"
            | "FunctionExpression"
            | "ArrowFunctionExpression"
            | "ClassDeclaration"
            | "ClassExpression"
    )
}

fn semantic_children(node: Node<'_>) -> Vec<Node<'_>> {
    let mut children = Vec::new();
    tape::walk_children(node, &mut |child| {
        children.push(child);
        false
    });
    children
}

#[derive(Clone, Copy)]
enum StructuralMode {
    Runtime,
    Collection,
}

fn structural_children(node: Node<'_>, mode: StructuralMode) -> Vec<Node<'_>> {
    match node.ty() {
        "JSXElement" | "JSXFragment" => node.list_field("children").flatten().collect(),
        "BlockStatement" => node.list_field("body").flatten().collect(),
        "JSXIfExpression" | "IfStatement" => {
            [node.node_field("consequent"), node.node_field("alternate")]
                .into_iter()
                .flatten()
                .collect()
        }
        "JSXSwitchExpression" | "SwitchStatement" => node
            .list_field("cases")
            .flatten()
            .flat_map(|case| case.list_field("consequent").flatten())
            .collect(),
        "JSXCodeBlock" if matches!(mode, StructuralMode::Runtime) => node
            .list_field("body")
            .flatten()
            .chain(node.node_field("render"))
            .collect(),
        "Program" if matches!(mode, StructuralMode::Runtime) => {
            node.list_field("body").flatten().collect()
        }
        "JSXForExpression" if matches!(mode, StructuralMode::Runtime) => {
            [node.node_field("body"), node.node_field("empty")]
                .into_iter()
                .flatten()
                .collect()
        }
        "JSXTryExpression" | "TryStatement" if matches!(mode, StructuralMode::Runtime) => [
            node.node_field("block"),
            node.node_field("pending"),
            node.node_field("handler"),
            node.node_field("finalizer"),
        ]
        .into_iter()
        .flatten()
        .collect(),
        "JSXTryExpression" | "TryStatement" => {
            let handler_body = node
                .node_field("handler")
                .and_then(|handler| handler.node_field("body"));
            [
                node.node_field("block"),
                handler_body,
                node.node_field("finalizer"),
            ]
            .into_iter()
            .flatten()
            .collect()
        }
        "CatchClause" if matches!(mode, StructuralMode::Runtime) => {
            node.node_field("body").into_iter().collect()
        }
        _ => Vec::new(),
    }
}

fn collect_runtime_styles<'t>(
    node: Node<'t>,
    consumed: &BTreeSet<u32>,
    styles: &mut Vec<Node<'t>>,
) {
    if node.ty() == "JSXStyleElement" {
        if node.span().is_some_and(|span| !consumed.contains(&span.0)) {
            styles.push(node);
        }
        return;
    }
    if is_function_or_class_boundary(node) {
        return;
    }
    for child in structural_children(node, StructuralMode::Collection) {
        collect_runtime_styles(child, consumed, styles);
    }
}

fn build_style_elements(nodes: &[Node<'_>]) -> Vec<Element> {
    let mut roots = Vec::new();
    for node in nodes {
        append_style_nodes(*node, &mut roots);
    }
    roots
}

fn collect_annotatable_ids(elements: &[Element], out: &mut BTreeSet<u32>) {
    for element in elements {
        if matches!(element.kind, ElementKind::Native(_) | ElementKind::Dynamic) {
            out.insert(element.id);
        }
        for child in &element.children {
            if let ElementChild::Element(child) = child {
                collect_annotatable_ids(std::slice::from_ref(child), out);
            }
        }
    }
}

fn append_style_nodes(node: Node<'_>, out: &mut Vec<Element>) {
    if is_function_or_class_boundary(node) || node.ty() == "JSXStyleElement" {
        return;
    }
    match node.ty() {
        "JSXElement" => out.push(build_style_element(node)),
        "JSXText" => {}
        _ => {
            for child in semantic_children(node) {
                append_style_nodes(child, out);
            }
        }
    }
}

fn build_style_element(node: Node<'_>) -> Element {
    let id = node.span().map_or(0, |span| span.0);
    let opening = node.node_field("openingElement");
    let name = opening.and_then(|opening| opening.node_field("name"));
    let kind = if is_dynamic_element(node) {
        ElementKind::Dynamic
    } else if let Some(name) = name
        && name.ty() == "JSXIdentifier"
        && let Some(tag) = name.str_field("name")
        && tag != "children"
        && tag.chars().next().is_some_and(char::is_lowercase)
    {
        ElementKind::Native(tag.to_string())
    } else {
        ElementKind::Component
    };
    let mut element = Element {
        id,
        kind,
        attributes: Vec::new(),
        has_spread: false,
        children: Vec::new(),
    };
    if let Some(opening) = opening {
        for attribute in opening.list_field("attributes").flatten() {
            if attribute.ty() == "JSXSpreadAttribute" {
                element.has_spread = true;
                continue;
            }
            if attribute.ty() != "JSXAttribute" {
                continue;
            }
            let Some(name) = attribute
                .node_field("name")
                .and_then(|name| name.str_field("name"))
            else {
                element.has_spread = true;
                continue;
            };
            let value = attribute.node_field("value").map(|value| {
                if value.ty() == "Literal"
                    && let Some(string) = value.str_field("value").and_then(decode_json_string)
                {
                    AttributeValue::Static(string)
                } else {
                    AttributeValue::Dynamic
                }
            });
            element.attributes.push(Attribute {
                name: name.to_string(),
                value,
            });
        }
    }
    for child in node.list_field("children").flatten() {
        append_style_children(child, &mut element.children);
    }
    element
}

fn append_style_children(node: Node<'_>, out: &mut Vec<ElementChild>) {
    if is_function_or_class_boundary(node) || node.ty() == "JSXStyleElement" {
        return;
    }
    match node.ty() {
        "JSXElement" => out.push(ElementChild::Element(build_style_element(node))),
        "JSXText" => {}
        "JSXExpressionContainer" | "JSXSpreadChild" => {
            out.push(ElementChild::Dynamic);
            for child in semantic_children(node) {
                append_style_children(child, out);
            }
        }
        _ => {
            for child in semantic_children(node) {
                append_style_children(child, out);
            }
        }
    }
}

fn style_ref_targets(style_node: Node<'_>) -> Vec<Node<'_>> {
    let Some(opening) = style_node.node_field("openingElement") else {
        return Vec::new();
    };
    opening
        .list_field("attributes")
        .flatten()
        .filter(|attribute| {
            attribute.ty() == "JSXAttribute"
                && attribute
                    .node_field("name")
                    .and_then(|name| name.str_field("name"))
                    == Some("ref")
        })
        .filter_map(|attribute| {
            let value = attribute.node_field("value")?;
            if value.ty() == "JSXExpressionContainer" {
                value.node_field("expression")
            } else {
                Some(value)
            }
        })
        .filter(|target| target.ty() != "JSXEmptyExpression")
        .collect()
}

pub(super) fn is_direct_ref_target(node: Node<'_>) -> bool {
    matches!(node.ty(), "Identifier" | "MemberExpression")
}

pub(super) fn is_callback_ref(node: Node<'_>) -> bool {
    matches!(node.ty(), "ArrowFunctionExpression" | "FunctionExpression")
}

pub(super) fn is_class_attribute(node: Node<'_>) -> bool {
    node.ty() == "JSXAttribute"
        && node
            .node_field("name")
            .and_then(|name| name.str_field("name"))
            .is_some_and(|name| matches!(name, "class" | "className"))
}

pub(super) fn class_attribute(opening: Node<'_>) -> Option<Node<'_>> {
    opening
        .list_field("attributes")
        .flatten()
        .find(|attribute| is_class_attribute(*attribute))
}

pub(super) fn push_js_string(out: &mut String, value: &str) {
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000c}' => out.push_str("\\f"),
            ch if ch <= '\u{001f}' => {
                use std::fmt::Write;
                write!(out, "\\u{:04x}", ch as u32).expect("writing to String cannot fail");
            }
            ch => out.push(ch),
        }
    }
    out.push('"');
}

pub(super) fn push_class_map(out: &mut String, entries: &[ClassMapEntry]) {
    out.push('{');
    for (index, entry) in entries.iter().enumerate() {
        if index != 0 {
            out.push_str(", ");
        }
        push_js_string(out, &entry.class_name);
        out.push_str(": ");
        push_js_string(out, &entry.value);
    }
    out.push('}');
}

pub(super) fn decode_json_string(value: &str) -> Option<String> {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next()? {
            '"' => out.push('"'),
            '\\' => out.push('\\'),
            '/' => out.push('/'),
            'b' => out.push('\u{0008}'),
            'f' => out.push('\u{000c}'),
            'n' => out.push('\n'),
            'r' => out.push('\r'),
            't' => out.push('\t'),
            'u' => {
                let digits: String = chars.by_ref().take(4).collect();
                let unit = u16::from_str_radix(&digits, 16).ok()?;
                if (0xd800..=0xdbff).contains(&unit) {
                    if chars.next()? != '\\' || chars.next()? != 'u' {
                        return None;
                    }
                    let low_digits: String = chars.by_ref().take(4).collect();
                    let low = u16::from_str_radix(&low_digits, 16).ok()?;
                    if !(0xdc00..=0xdfff).contains(&low) {
                        return None;
                    }
                    let scalar = 0x10000 + (((unit as u32 - 0xd800) << 10) | (low as u32 - 0xdc00));
                    out.push(char::from_u32(scalar)?);
                } else if (0xdc00..=0xdfff).contains(&unit) {
                    return None;
                } else {
                    out.push(char::from_u32(unit as u32)?);
                }
            }
            _ => return None,
        }
    }
    Some(out)
}

fn is_dynamic_element(node: Node<'_>) -> bool {
    node.ty() == "JSXElement"
        && node
            .node_field("openingElement")
            .is_some_and(|opening| opening.bool_field("isDynamic"))
}
