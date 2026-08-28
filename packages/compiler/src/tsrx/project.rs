//! TSRX → Solid JSX desugaring, as authored-text projection.
//!
//! Mirrors `@solidjs/babel-plugin`'s `src/tsrx/desugar.ts` (the frozen
//! contract) construct-for-construct, but in the text domain: the tape from
//! `tsrx_parser_engine` locates TSRX constructs, and each construct span is
//! replaced with the desugared Solid-JSX source form. Authored bytes outside
//! constructs are copied verbatim. The projected text reparses with the
//! crate's own oxc and produces the same AST the Babel frontend hands its
//! pipeline — generated parentheses are trivia (`preserve_parens: false`)
//! and generated JSX carries no stray whitespace children.
//!
//! Lazy `&` patterns are only *stripped* here (each pattern keeps its
//! authored binding names, so the reparsed program has real,
//! scope-resolvable bindings); the `__lazyN` renames and accessor-call
//! rewrites happen after the reparse in [`crate::tsrx::rewrite`], driven by
//! the anchors recorded in [`Projection`].
//!
//! Emission is strictly append-only (no detached buffers), so anchor offsets
//! are final as they are recorded. Where output order differs from authored
//! order (a `@switch` `@default` case becomes the leading `fallback`
//! attribute), blocks are validated in the Babel frontend's order first and
//! re-analyzed cheaply during emission.

use super::{
    style_projection::{
        self, RefSetup, StyleAction, StyleProjection, class_attribute, decode_json_string,
        is_callback_ref, is_class_attribute, is_direct_ref_target, push_class_map, push_js_string,
    },
    tape::{self, Node},
};

/// Result of projecting one TSRX module to plain TSX.
pub struct Projection {
    pub text: String,
    /// Concatenated extracted stylesheets in owner-visitor order.
    pub css: String,
    /// Space-separated scope hashes, or `None` when no styles were present.
    pub css_hash: Option<String>,
    /// Projected offset of each lazy pattern's opening bracket, with its
    /// preallocated `__lazyN` name.
    pub lazy_patterns: Vec<(u32, String, bool)>,
    /// Projected offset of a generated arrow (its parameter `(`), with the
    /// binding names whose reads must become zero-argument calls (RC accessor
    /// semantics for keyed `For` items, `For` indexes, and `@catch` errors).
    pub accessor_arrows: Vec<(u32, Vec<String>)>,
}

/// A structured frontend diagnostic in authored coordinates.
pub struct ProjectError {
    pub message: String,
    /// Authored byte offset the diagnostic points at.
    pub start: u32,
}

impl ProjectError {
    fn new(message: impl Into<String>, node: Node<'_>) -> Self {
        Self {
            message: message.into(),
            start: node.span().map(|(start, _)| start).unwrap_or(0),
        }
    }
}

type Result<T> = std::result::Result<T, ProjectError>;

/// Whether a rendered expression is structurally JSX (usable as a bare JSX
/// child) or needs an expression container.
#[derive(Clone, Copy, PartialEq)]
enum Shape {
    Jsx,
    Expr,
}

/// Where a node sits, which decides its rendered form.
#[derive(Clone, Copy, PartialEq)]
enum Position {
    /// The `@{}` body of a function: statements plus `return render;`.
    FunctionBody,
    /// Expression slot (arrow body, attribute container, argument, …).
    Expression,
    /// JSX child slot: non-JSX results need `{…}` wrapping.
    JsxChild,
}

const FUNCTION_TYPES: [&str; 3] = [
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
];

const RENDER_ENTRY_TYPES: [&str; 9] = [
    "JSXElement",
    "JSXFragment",
    "JSXText",
    "JSXCodeBlock",
    "JSXIfExpression",
    "JSXForExpression",
    "JSXSwitchExpression",
    "JSXTryExpression",
    "JSXStyleElement",
];

const LOOP_TYPES: [&str; 5] = [
    "ForStatement",
    "ForInStatement",
    "ForOfStatement",
    "WhileStatement",
    "DoWhileStatement",
];

/// TSRX constructs are validation boundaries: their blocks are checked when
/// they desugar, with their own construct label.
const ESCAPE_BOUNDARY_TYPES: [&str; 5] = [
    "JSXCodeBlock",
    "JSXIfExpression",
    "JSXForExpression",
    "JSXSwitchExpression",
    "JSXTryExpression",
];

fn is_function(ty: &str) -> bool {
    FUNCTION_TYPES.contains(&ty)
}

fn is_construct(ty: &str) -> bool {
    matches!(
        ty,
        "JSXIfExpression" | "JSXForExpression" | "JSXSwitchExpression" | "JSXTryExpression"
    )
}

fn is_render_entry(ty: &str) -> bool {
    RENDER_ENTRY_TYPES.contains(&ty)
}

fn is_dynamic_element(node: Node<'_>) -> bool {
    node.ty() == "JSXElement"
        && node
            .node_field("openingElement")
            .is_some_and(|opening| opening.bool_field("isDynamic"))
}

fn is_lazy_pattern(node: Node<'_>) -> bool {
    matches!(node.ty(), "ArrayPattern" | "ObjectPattern") && node.bool_field("lazy")
}

fn lazy_assignment_pattern(node: Node<'_>) -> Option<Node<'_>> {
    if node.ty() != "ExpressionStatement" {
        return None;
    }
    let expression = node.node_field("expression")?;
    if expression.ty() != "AssignmentExpression" || expression.str_field("operator") != Some("=") {
        return None;
    }
    expression
        .node_field("left")
        .filter(|pattern| is_lazy_pattern(*pattern))
}

fn contains_lazy_pattern(node: Node<'_>) -> bool {
    let mut found = false;
    tape::walk(node, &mut |child| {
        if is_lazy_pattern(child) {
            found = true;
            return false;
        }
        true
    });
    found
}

fn contains_pattern_default(node: Node<'_>) -> bool {
    let mut found = false;
    tape::walk(node, &mut |child| {
        if child.ty() == "AssignmentPattern" {
            found = true;
            return false;
        }
        true
    });
    found
}

fn exported_lazy_declaration(root: Node<'_>) -> Option<Node<'_>> {
    let mut invalid = None;
    tape::walk(root, &mut |node| {
        if matches!(
            node.ty(),
            "ExportNamedDeclaration" | "ExportDefaultDeclaration"
        ) && let Some(declaration) = node.node_field("declaration")
            && declaration.ty() == "VariableDeclaration"
            && declaration
                .list_field("declarations")
                .flatten()
                .any(|declarator| {
                    declarator
                        .node_field("id")
                        .is_some_and(contains_lazy_pattern)
                })
        {
            invalid = Some(declaration);
            return false;
        }
        invalid.is_none()
    });
    invalid
}

pub fn project(
    source: &str,
    filename: &str,
    tape: &tsrx_tape_schema::FlatTape,
) -> Result<Projection> {
    let root = Node::root(tape).ok_or(ProjectError {
        message: "TSRX parse produced no program".into(),
        start: 0,
    })?;
    if let Some(declaration) = exported_lazy_declaration(root) {
        return Err(ProjectError::new(
            "TSRX lazy bindings cannot be exported",
            declaration,
        ));
    }

    let styles = style_projection::plan(source, filename, root)?;
    let css = styles.css.clone();
    let css_hash = styles.css_hash.clone();
    let mut renderer = Renderer {
        source,
        out: String::with_capacity(source.len() + source.len() / 4),
        styles,
        lazy_ids: collect_lazy_ids(root),
        lazy_patterns: Vec::new(),
        accessor_arrows: Vec::new(),
        suppress_nested_lazy: 0,
    };

    renderer.emit_verbatim_with_specials(root, 0, source.len() as u32, Position::Expression)?;

    Ok(Projection {
        text: renderer.out,
        css,
        css_hash,
        lazy_patterns: renderer.lazy_patterns,
        accessor_arrows: renderer.accessor_arrows,
    })
}

/// Preallocate `__lazyN` names for every lazy pattern in document order,
/// mirroring `@tsrx/core`'s `preallocateLazyIds`. Keyed by pattern span.
fn collect_lazy_ids(root: Node<'_>) -> Vec<(u32, u32)> {
    let mut spans: Vec<(u32, u32)> = Vec::new();
    tape::walk(root, &mut |node| {
        match node.ty() {
            "VariableDeclarator" => {
                if let Some(pattern) = node.node_field("id") {
                    collect_topmost_lazy_patterns(pattern, &mut spans);
                }
            }
            "FunctionDeclaration" | "FunctionExpression" | "ArrowFunctionExpression" => {
                for pattern in node.list_field("params").flatten() {
                    collect_topmost_lazy_patterns(pattern, &mut spans);
                }
            }
            "CatchClause" => {
                if let Some(pattern) = node.node_field("param") {
                    collect_topmost_lazy_patterns(pattern, &mut spans);
                }
            }
            "ExpressionStatement" => {
                if let Some(pattern) = lazy_assignment_pattern(node) {
                    collect_topmost_lazy_patterns(pattern, &mut spans);
                }
            }
            _ => {}
        }
        if node.ty() == "JSXForExpression"
            && node.has_node_field("key")
            && let Some(pattern) = for_binding_pattern(node)
            && pattern.ty() != "Identifier"
            && let Some(span) = pattern.span()
        {
            spans.push(span);
        }
        if node.ty() == "JSXTryExpression"
            && let Some(pattern) = node
                .node_field("handler")
                .and_then(|handler| handler.node_field("param"))
            && pattern.ty() != "Identifier"
            && let Some(span) = pattern.span()
        {
            spans.push(span);
        }
        true
    });
    spans.sort_unstable();
    spans.dedup();
    spans
}

fn collect_topmost_lazy_patterns(node: Node<'_>, spans: &mut Vec<(u32, u32)>) {
    match node.ty() {
        "AssignmentPattern" => {
            if let Some(left) = node.node_field("left") {
                collect_topmost_lazy_patterns(left, spans);
            }
        }
        "RestElement" => {
            if let Some(argument) = node.node_field("argument") {
                collect_topmost_lazy_patterns(argument, spans);
            }
        }
        "ObjectPattern" | "ArrayPattern" if is_lazy_pattern(node) => {
            if let Some(span) = node.span() {
                spans.push(span);
            }
        }
        "ObjectPattern" => {
            for property in node.list_field("properties").flatten() {
                let child = if property.ty() == "RestElement" {
                    property.node_field("argument")
                } else {
                    property.node_field("value")
                };
                if let Some(child) = child {
                    collect_topmost_lazy_patterns(child, spans);
                }
            }
        }
        "ArrayPattern" => {
            for element in node.list_field("elements").flatten() {
                collect_topmost_lazy_patterns(element, spans);
            }
            if let Some(rest) = node.node_field("rest") {
                collect_topmost_lazy_patterns(rest, spans);
            }
        }
        _ => {}
    }
}

fn for_binding_pattern(node: Node<'_>) -> Option<Node<'_>> {
    let left = node.node_field("left")?;
    if left.ty() != "VariableDeclaration" {
        return Some(left);
    }
    left.list_field("declarations")
        .flatten()
        .next()
        .and_then(|declarator| declarator.node_field("id"))
}

// ---------------------------------------------------------------------------
// Special-node collection (for verbatim regions)
// ---------------------------------------------------------------------------

struct Special<'t> {
    node: Node<'t>,
    /// Replacement span in authored bytes (differs from the node span only
    /// for lazy patterns, which also consume the preceding `&` sigil).
    span: (u32, u32),
    position: Position,
}

/// Find the outermost nodes within `node`'s subtree that need re-rendering,
/// in document order. Does not descend into found specials: their renderers
/// re-collect within themselves. `position` classifies `node` itself when it
/// is special.
fn collect_specials<'t>(
    node: Node<'t>,
    position: Position,
    styles: &StyleProjection<'t>,
    out: &mut Vec<Special<'t>>,
) {
    let ty = node.ty();
    let start = node.span().map_or(u32::MAX, |span| span.0);

    let special_span = if lazy_assignment_pattern(node).is_some() {
        node.span()
    } else if is_construct(ty) {
        // The engine's construct spans can exclude trailing clause blocks
        // (`@for … {…} @empty {…}` ends at the body); the replacement must
        // swallow every clause, so extend the end over clause-field spans.
        construct_replacement_span(node)
    } else if ty == "JSXCodeBlock"
        || ty == "JSXStyleElement"
        || is_dynamic_element(node)
        || (ty == "JSXElement"
            && (styles.element_hashes.contains_key(&start)
                || styles.owner_setups.contains_key(&start)))
        || (ty == "JSXFragment" && styles.owner_setups.contains_key(&start))
        || (ty == "JSXAttribute" && node.bool_field("shorthand"))
    {
        node.span()
    } else if is_lazy_pattern(node) {
        // The `&` sigil sits immediately before the pattern's bracket.
        node.span()
            .map(|(start, end)| (start.saturating_sub(1), end))
    } else {
        None
    };

    if let Some(span) = special_span {
        out.push(Special {
            node,
            span,
            position,
        });
        return;
    }

    collect_children(node, styles, out);
}

/// A construct's authored span extended to the furthest end of any direct
/// clause node (the tape is a source-ordered tree, so field spans can only
/// point at text belonging to the construct).
fn construct_replacement_span(node: Node<'_>) -> Option<(u32, u32)> {
    let (start, mut end) = node.span()?;
    for (key, value) in node.fields() {
        if matches!(key, "type" | "start" | "end" | "metadata" | "loc" | "range") {
            continue;
        }
        match value.kind() {
            tsrx_tape_schema::ValueKind::Object => {
                if let Some(child) = Node::from_value(node.tape(), value)
                    && let Some((_, child_end)) = child.span()
                {
                    end = end.max(child_end);
                }
            }
            tsrx_tape_schema::ValueKind::List => {
                for child in node.list_value(value).flatten() {
                    if let Some((_, child_end)) = child.span() {
                        end = end.max(child_end);
                    }
                }
            }
            _ => {}
        }
    }
    Some((start, end))
}

fn collect_children<'t>(node: Node<'t>, styles: &StyleProjection<'t>, out: &mut Vec<Special<'t>>) {
    let ty = node.ty();
    for (key, value) in node.fields() {
        if matches!(key, "type" | "start" | "end" | "metadata" | "loc" | "range") {
            continue;
        }
        let child_position = match (ty, key) {
            (parent, "body") if is_function(parent) => Position::FunctionBody,
            ("JSXElement" | "JSXFragment", "children") => Position::JsxChild,
            _ => Position::Expression,
        };
        match value.kind() {
            tsrx_tape_schema::ValueKind::Object => {
                if let Some(child) = Node::from_value(node.tape(), value) {
                    collect_specials(child, child_position, styles, out);
                }
            }
            tsrx_tape_schema::ValueKind::List => {
                if let Some(list) = value.as_list() {
                    let mut next = node.tape().list_first_value(list);
                    while let Some(entry) = next.filter(|entry| !entry.is_none()) {
                        if let Some(item) = node.tape().list_value(entry)
                            && let Some(child) = Node::from_value(node.tape(), item)
                        {
                            collect_specials(child, child_position, styles, out);
                        }
                        next = node.tape().list_value_next(entry);
                    }
                }
            }
            _ => {}
        }
    }
}

// ---------------------------------------------------------------------------
// Shape prediction (decides `{…}` wrapping before any text is emitted)
// ---------------------------------------------------------------------------

/// Shape of one render entry once lowered to an expression.
fn predict_entry_shape(node: Node<'_>) -> Shape {
    match node.ty() {
        "JSXElement" | "JSXFragment" | "JSXStyleElement" => Shape::Jsx,
        "JSXText" => Shape::Expr,
        "JSXIfExpression" | "JSXForExpression" | "JSXSwitchExpression" => Shape::Jsx,
        "JSXTryExpression" => predict_try_shape(node),
        "JSXCodeBlock" => {
            if node.list_field("body").next().is_some() {
                Shape::Expr
            } else {
                node.node_field("render")
                    .map(predict_entry_shape)
                    .unwrap_or(Shape::Expr)
            }
        }
        _ => Shape::Expr,
    }
}

fn predict_try_shape(node: Node<'_>) -> Shape {
    if node.has_node_field("handler") || node.has_node_field("pending") {
        return Shape::Jsx;
    }
    node.node_field("block")
        .map(|block| predict_block_shape(block))
        .unwrap_or(Shape::Expr)
}

/// Shape of a whole template block lowered to an expression (ignoring the
/// empty case, which callers reject or omit before wrapping decisions).
fn predict_block_shape(block: Node<'_>) -> Shape {
    let (setup, renders) = partition_entries(&block_entries(block));
    if !setup.is_empty() {
        return Shape::Expr;
    }
    match renders.as_slice() {
        [only] => predict_entry_shape(*only),
        [] => Shape::Expr,
        _ => Shape::Jsx,
    }
}

fn block_entries<'t>(block: Node<'t>) -> Vec<Node<'t>> {
    if block.ty() == "BlockStatement" {
        block.list_field("body").flatten().collect()
    } else {
        vec![block]
    }
}

/// Split entries into setup statements and render outputs, skipping
/// whitespace-only JSXText. Pure analysis; ordering errors surface in
/// [`Renderer::block_parts_of_entries`].
fn partition_entries<'t>(entries: &[Node<'t>]) -> (Vec<Node<'t>>, Vec<Node<'t>>) {
    let mut setup = Vec::new();
    let mut renders = Vec::new();
    for entry in entries {
        if is_render_entry(entry.ty()) {
            if entry.ty() == "JSXText" && entry.str_field("value").is_some_and(decode_json_ws_only)
            {
                continue;
            }
            renders.push(*entry);
        } else if renders.is_empty() {
            setup.push(*entry);
        }
    }
    (setup, renders)
}

/// Whether a template block lowers to nothing (fully empty block).
fn block_is_empty(block: Node<'_>) -> bool {
    let (setup, renders) = partition_entries(&block_entries(block));
    setup.is_empty() && renders.is_empty()
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

struct BlockParts<'t> {
    setup: Vec<Node<'t>>,
    renders: Vec<Node<'t>>,
}

struct Renderer<'s, 't> {
    source: &'s str,
    out: String,
    styles: StyleProjection<'t>,
    /// Document-ordered lazy pattern spans; index = lazy id.
    lazy_ids: Vec<(u32, u32)>,
    lazy_patterns: Vec<(u32, String, bool)>,
    accessor_arrows: Vec<(u32, Vec<String>)>,
    suppress_nested_lazy: usize,
}

impl<'s, 't> Renderer<'s, 't> {
    fn push_verbatim(&mut self, start: u32, end: u32) {
        if end <= start {
            return;
        }
        self.out
            .push_str(&self.source[start as usize..end as usize]);
    }

    fn push(&mut self, text: &str) {
        self.out.push_str(text);
    }

    /// Emit `[start, end)` of authored source, re-rendering the specials
    /// found within `scope`'s subtree.
    fn emit_verbatim_with_specials(
        &mut self,
        scope: Node<'_>,
        start: u32,
        end: u32,
        position: Position,
    ) -> Result<()> {
        let mut specials = Vec::new();
        collect_specials(scope, position, &self.styles, &mut specials);
        self.emit_region(start, end, &mut specials)
    }

    /// Emit an authored region, splicing in the specials whose replacement
    /// span lies within `[start, end)`.
    fn emit_region(&mut self, start: u32, end: u32, specials: &mut Vec<Special<'_>>) -> Result<()> {
        // Tape field order is not source order (e.g. `children` can precede
        // `openingElement`): splice in document order.
        specials.sort_by_key(|special| special.span.0);
        let mut cursor = start;
        for special in specials.iter() {
            let (s_start, s_end) = special.span;
            if s_start < cursor || s_end > end {
                continue;
            }
            self.push_verbatim(cursor, s_start);
            self.render_special(special.node, special.position)?;
            cursor = s_end;
        }
        self.push_verbatim(cursor, end);
        Ok(())
    }

    /// Emit one authored node in the given position: dispatches specials
    /// directly, copies everything else verbatim with nested specials.
    fn emit_node(&mut self, node: Node<'_>, position: Position) -> Result<()> {
        let ty = node.ty();
        let start = node.span().map_or(u32::MAX, |span| span.0);
        if ty == "JSXCodeBlock"
            || is_construct(ty)
            || ty == "JSXStyleElement"
            || is_dynamic_element(node)
            || (ty == "JSXElement"
                && (self.styles.element_hashes.contains_key(&start)
                    || self.styles.owner_setups.contains_key(&start)))
            || (ty == "JSXFragment" && self.styles.owner_setups.contains_key(&start))
            || (ty == "JSXAttribute" && node.bool_field("shorthand"))
            || lazy_assignment_pattern(node).is_some()
            || is_lazy_pattern(node)
        {
            return self.render_special(node, position);
        }
        let (start, end) = span_of(node)?;
        let mut specials = Vec::new();
        collect_children(node, &self.styles, &mut specials);
        self.emit_region(start, end, &mut specials)
    }

    fn render_special(&mut self, node: Node<'_>, position: Position) -> Result<()> {
        match node.ty() {
            "JSXCodeBlock" => self.render_code_block(node, position),
            "JSXIfExpression" => self.render_if(node),
            "JSXForExpression" => self.render_for(node),
            "JSXSwitchExpression" => self.render_switch(node),
            "JSXTryExpression" => self.render_try(node, position),
            "JSXStyleElement" => self.render_style(node),
            "JSXFragment" => self.render_scoped_fragment(node, position),
            "JSXAttribute" => self.render_shorthand_attr(node),
            "JSXElement" => self.render_scoped_element(node, position),
            "ExpressionStatement" if lazy_assignment_pattern(node).is_some() => {
                self.render_lazy_assignment(node)
            }
            "ArrayPattern" | "ObjectPattern" if self.suppress_nested_lazy > 0 => {
                self.emit_eager_pattern(node)
            }
            "ArrayPattern" | "ObjectPattern" => self.render_lazy_pattern(node),
            other => Err(ProjectError::new(
                format!("Unsupported TSRX construct `{other}`"),
                node,
            )),
        }
    }

    // -- @{} statement containers ---------------------------------------------

    fn render_code_block(&mut self, node: Node<'_>, position: Position) -> Result<()> {
        let render = node.node_field("render").ok_or_else(|| {
            ProjectError::new(
                "A TSRX statement container is missing its rendered output node",
                node,
            )
        })?;
        let setup: Vec<Node<'_>> = node.list_field("body").flatten().collect();
        let style_setups = self
            .styles
            .owner_setups
            .get(&span_of(node)?.0)
            .cloned()
            .unwrap_or_default();

        match position {
            Position::FunctionBody => {
                self.push("{\n");
                self.emit_statements(&setup)?;
                for setup in &style_setups {
                    self.emit_ref_setup(setup)?;
                }
                self.push("return ");
                self.render_entry_expression(render)?;
                self.push(";\n}");
            }
            Position::Expression | Position::JsxChild => {
                let wrap = position == Position::JsxChild
                    && (if setup.is_empty() && style_setups.is_empty() {
                        predict_entry_shape(render) == Shape::Expr
                    } else {
                        true
                    });
                if wrap {
                    self.push("{");
                }
                if setup.is_empty() && style_setups.is_empty() {
                    self.render_entry_expression(render)?;
                } else {
                    self.push("(() => {\n");
                    self.emit_statements(&setup)?;
                    for setup in &style_setups {
                        self.emit_ref_setup(setup)?;
                    }
                    self.push("return ");
                    self.render_entry_expression(render)?;
                    self.push(";\n})()");
                }
                if wrap {
                    self.push("}");
                }
            }
        }
        Ok(())
    }

    // -- @if — Show / Switch+Match ---------------------------------------------

    fn render_if(&mut self, node: Node<'_>) -> Result<()> {
        struct Branch<'t> {
            test: Node<'t>,
            block: Node<'t>,
        }
        let mut branches = Vec::new();
        let mut current = node;
        let else_block: Option<Node<'_>>;
        loop {
            branches.push(Branch {
                test: current
                    .node_field("test")
                    .ok_or_else(|| ProjectError::new("TSRX @if is missing its condition", node))?,
                block: current.node_field("consequent").ok_or_else(|| {
                    ProjectError::new("TSRX @if is missing its consequent block", node)
                })?,
            });
            match current.node_field("alternate") {
                Some(alternate) if matches!(alternate.ty(), "IfStatement" | "JSXIfExpression") => {
                    current = alternate;
                }
                other => {
                    else_block = other;
                    break;
                }
            }
        }

        // Validate in the Babel frontend's order: @else first, then branches.
        if let Some(block) = else_block {
            self.block_parts(block, Some("@else"))?;
        }
        for branch in &branches {
            self.block_parts(branch.block, Some("@if"))?;
        }

        let has_fallback = else_block.is_some_and(|block| !block_is_empty(block));

        if let [branch] = branches.as_slice() {
            self.push("<Show when={");
            self.emit_node(branch.test, Position::Expression)?;
            self.push("}");
            if has_fallback {
                self.push(" fallback={");
                self.emit_block_expression(else_block.unwrap(), "@else")?;
                self.push("}");
            }
            return self.emit_construct_children(branch.block, "@if", "</Show>");
        }

        self.push("<Switch");
        if has_fallback {
            self.push(" fallback={");
            self.emit_block_expression(else_block.unwrap(), "@else")?;
            self.push("}");
        }
        self.push(">");
        for branch in &branches {
            self.push("<Match when={");
            self.emit_node(branch.test, Position::Expression)?;
            self.push("}");
            self.emit_construct_children(branch.block, "@if", "</Match>")?;
        }
        self.push("</Switch>");
        Ok(())
    }

    /// Emit a construct's block as its JSX children (or self-close when the
    /// block renders nothing), then the closing tag.
    fn emit_construct_children(
        &mut self,
        block: Node<'_>,
        construct: &str,
        closing: &str,
    ) -> Result<()> {
        if block_is_empty(block) {
            self.push("/>");
            return Ok(());
        }
        self.push(">");
        let shape = predict_block_shape(block);
        if shape == Shape::Jsx {
            self.emit_block_expression(block, construct)?;
        } else {
            self.push("{");
            self.emit_block_expression(block, construct)?;
            self.push("}");
        }
        self.push(closing);
        Ok(())
    }

    // -- @for — For --------------------------------------------------------------

    fn render_for(&mut self, node: Node<'_>) -> Result<()> {
        if node.str_field("statementType") != Some("ForOfStatement") {
            return Err(ProjectError::new(
                "@for must iterate with for...of; for...in and classic for loops are not TSRX template constructs",
                node,
            ));
        }
        if node.bool_field("await") {
            return Err(ProjectError::new(
                "`for await` is not supported inside Solid TSRX templates",
                node,
            ));
        }

        let pattern = for_binding_pattern(node)
            .ok_or_else(|| ProjectError::new("TSRX @for is missing its binding", node))?;
        let each = node
            .node_field("right")
            .ok_or_else(|| ProjectError::new("TSRX @for is missing its iterable", node))?;
        let index = node.node_field("index");
        let key = node.node_field("key");

        let body = node
            .node_field("body")
            .ok_or_else(|| ProjectError::new("TSRX @for is missing its body", node))?;
        // Validate the body before attribute emission (Babel order); reject a
        // renderless body up front.
        let parts = self.block_parts(body, Some("@for"))?;
        if parts.renders.is_empty() {
            return Err(ProjectError::new(
                "A TSRX @for body must end with rendered output",
                node,
            ));
        }

        self.push("<For each={");
        self.emit_node(each, Position::Expression)?;
        self.push("}");
        if let Some(key) = key {
            self.push(" keyed={(");
            if pattern.ty() == "Identifier" {
                self.emit_node(pattern, Position::Expression)?;
            } else {
                self.emit_eager_pattern(pattern)?;
            }
            self.push(") => (");
            self.emit_node(key, Position::Expression)?;
            self.push(")}");
        }
        if let Some(empty) = node.node_field("empty") {
            if !block_is_empty(empty) {
                self.push(" fallback={");
                self.emit_block_expression(empty, "@empty")?;
                self.push("}");
            } else {
                // Still validate the empty block (escape rules apply).
                self.block_parts(empty, Some("@empty"))?;
            }
        }
        self.push(">{");

        // RC `For` semantics: keyed mode hands the callback an item accessor,
        // and the index parameter is always an accessor — the post-reparse
        // pass rewrites those reads to calls, anchored at this arrow.
        let mut accessor_names = Vec::new();
        if key.is_some()
            && let Some(name) = ident_name(pattern)
        {
            accessor_names.push(name.to_string());
        }
        if let Some(index) = index
            && let Some(name) = ident_name(index)
        {
            accessor_names.push(name.to_string());
        }
        if !accessor_names.is_empty() {
            self.accessor_arrows
                .push((self.out.len() as u32, accessor_names));
        }

        self.push("(");
        if key.is_some() && pattern.ty() != "Identifier" {
            self.render_lazy_pattern_with_source(pattern, true)?;
        } else {
            self.emit_node(pattern, Position::Expression)?;
        }
        if let Some(index) = index {
            self.push(", ");
            self.emit_node(index, Position::Expression)?;
        }
        self.push(") => ");
        if parts.setup.is_empty() {
            self.push("(");
            self.emit_renders_expression(&parts.renders)?;
            self.push(")");
        } else {
            self.push("{\n");
            self.emit_statements(&parts.setup)?;
            self.push("return ");
            self.emit_renders_expression(&parts.renders)?;
            self.push(";\n}");
        }
        self.push("}</For>");
        Ok(())
    }

    // -- @switch — Switch / Match --------------------------------------------------

    fn render_switch(&mut self, node: Node<'_>) -> Result<()> {
        let discriminant = node
            .node_field("discriminant")
            .ok_or_else(|| ProjectError::new("TSRX @switch is missing its discriminant", node))?;
        let cases: Vec<Node<'_>> = node.list_field("cases").flatten().collect();

        // Validate every case in authored order first (the @default case is
        // emitted out of order, as the leading `fallback` attribute).
        for case in &cases {
            let entries = case_entries(*case);
            let label = if case.has_node_field("test") {
                "@case"
            } else {
                "@default"
            };
            let parts = self.block_parts_of_entries(&entries, Some(label))?;
            if !parts.setup.is_empty() && parts.renders.is_empty() {
                return Err(ProjectError::new(
                    "A TSRX @case block with setup statements must end with rendered output",
                    *case,
                ));
            }
        }

        let default_case = cases
            .iter()
            .copied()
            .find(|case| !case.has_node_field("test"));
        let has_fallback = default_case.is_some_and(|case| {
            let (setup, renders) = partition_entries(&case_entries(case));
            !(setup.is_empty() && renders.is_empty())
        });

        self.push("<Switch");
        if has_fallback {
            let case = default_case.unwrap();
            self.push(" fallback={");
            self.emit_case_expression(case, "@default")?;
            self.push("}");
        }
        self.push(">");
        for case in &cases {
            let Some(test) = case.node_field("test") else {
                continue;
            };
            self.push("<Match when={(");
            self.emit_node(discriminant, Position::Expression)?;
            self.push(") === (");
            self.emit_node(test, Position::Expression)?;
            self.push(")}");

            let entries = case_entries(*case);
            let (setup, renders) = partition_entries(&entries);
            if setup.is_empty() && renders.is_empty() {
                self.push("/>");
                continue;
            }
            self.push(">");
            let shape = if setup.is_empty() {
                match renders.as_slice() {
                    [only] => predict_entry_shape(*only),
                    _ => Shape::Jsx,
                }
            } else {
                Shape::Expr
            };
            if shape == Shape::Jsx {
                self.emit_case_expression(*case, "@case")?;
            } else {
                self.push("{");
                self.emit_case_expression(*case, "@case")?;
                self.push("}");
            }
            self.push("</Match>");
        }
        self.push("</Switch>");
        Ok(())
    }

    fn emit_case_expression(&mut self, case: Node<'_>, label: &str) -> Result<()> {
        let entries = case_entries(case);
        let parts = self.block_parts_of_entries(&entries, Some(label))?;
        self.emit_parts_expression(&parts)
    }

    // -- @try / @pending / @catch — Errored / Loading -------------------------------

    fn render_try(&mut self, node: Node<'_>, position: Position) -> Result<()> {
        if let Some(finalizer) = node.node_field("finalizer") {
            return Err(ProjectError::new(
                "@finally is not part of the TSRX template grammar",
                finalizer,
            ));
        }
        let block = node
            .node_field("block")
            .ok_or_else(|| ProjectError::new("TSRX @try is missing its block", node))?;

        // Validate in the Babel frontend's order: @try, then @pending, then
        // @catch — output order is the reverse nesting.
        let content_parts = self.block_parts(block, Some("@try"))?;
        if content_parts.renders.is_empty() {
            // Setup-only blocks get blockToExpression's message; fully empty
            // ones get the @try-specific message, matching the Babel frontend.
            return Err(if content_parts.setup.is_empty() {
                ProjectError::new("A TSRX @try block must end with rendered output", node)
            } else {
                ProjectError::new(
                    "A TSRX @try block with setup statements must end with rendered output",
                    block,
                )
            });
        }
        let pending = node.node_field("pending");
        if let Some(pending) = pending {
            self.block_parts(pending, Some("@pending"))?;
        }
        let handler = node.node_field("handler");
        let mut error_name = String::from("_e");
        let mut reset_name: Option<String> = None;
        let mut has_error_param = false;
        let mut error_pattern = None;
        if let Some(handler) = handler {
            if let Some(param) = handler.node_field("param") {
                if !matches!(param.ty(), "Identifier" | "ObjectPattern" | "ArrayPattern") {
                    return Err(ProjectError::new(
                        "The @catch error binding must be an identifier, object pattern, or array pattern",
                        param,
                    ));
                }
                if param.ty() == "Identifier"
                    && let Some(name) = ident_name(param)
                {
                    error_name = name.to_string();
                    has_error_param = true;
                } else {
                    error_pattern = Some(param);
                }
            }
            if let Some(reset) = handler.node_field("resetParam").and_then(ident_name) {
                reset_name = Some(reset.to_string());
            }
            let handler_body = handler
                .node_field("body")
                .ok_or_else(|| ProjectError::new("TSRX @catch is missing its block", handler))?;
            let handler_parts = self.block_parts(handler_body, Some("@catch"))?;
            if handler_parts.renders.is_empty() {
                return Err(if handler_parts.setup.is_empty() {
                    ProjectError::new("A TSRX @catch block must end with rendered output", handler)
                } else {
                    ProjectError::new(
                        "A TSRX @catch block with setup statements must end with rendered output",
                        handler_body,
                    )
                });
            }
        }

        let inner_shape = if pending.is_some() {
            Shape::Jsx
        } else {
            predict_block_shape(block)
        };
        let result_shape = if handler.is_some() {
            Shape::Jsx
        } else {
            inner_shape
        };

        let wrap = position == Position::JsxChild && result_shape != Shape::Jsx;
        if wrap {
            self.push("{");
        }

        if let Some(handler) = handler {
            self.push("<Errored fallback={");
            // RC `Errored` passes an `ErrorAccessor`: reads of the binding
            // become calls (only when the author bound one).
            if has_error_param {
                self.accessor_arrows
                    .push((self.out.len() as u32, vec![error_name.clone()]));
            }
            self.push("(");
            if let Some(pattern) = error_pattern {
                self.render_lazy_pattern_with_source(pattern, true)?;
            } else {
                self.push(&error_name);
            }
            if let Some(reset) = &reset_name {
                self.push(", ");
                self.push(reset);
            }
            self.push(") => (");
            let handler_body = handler.node_field("body").unwrap();
            self.emit_block_expression(handler_body, "@catch")?;
            self.push(")}>");
        }

        if let Some(pending) = pending {
            self.push("<Loading");
            if !block_is_empty(pending) {
                self.push(" fallback={");
                self.emit_block_expression(pending, "@pending")?;
                self.push("}");
            }
            self.push(">");
            let content_shape = predict_block_shape(block);
            if content_shape == Shape::Jsx {
                self.emit_block_expression(block, "@try")?;
            } else {
                self.push("{");
                self.emit_block_expression(block, "@try")?;
                self.push("}");
            }
            self.push("</Loading>");
        } else if handler.is_some() {
            let content_shape = predict_block_shape(block);
            if content_shape == Shape::Jsx {
                self.emit_block_expression(block, "@try")?;
            } else {
                self.push("{");
                self.emit_block_expression(block, "@try")?;
                self.push("}");
            }
        } else {
            self.emit_block_expression(block, "@try")?;
        }

        if handler.is_some() {
            self.push("</Errored>");
        }
        if wrap {
            self.push("}");
        }
        Ok(())
    }

    // -- Dynamic tags and shorthand props -----------------------------------------

    fn render_style(&mut self, node: Node<'_>) -> Result<()> {
        let start = span_of(node)?.0;
        match self.styles.actions.get(&start).cloned() {
            Some(StyleAction::Remove) => Ok(()),
            Some(StyleAction::ClassMap(entries)) => {
                push_class_map(&mut self.out, &entries);
                Ok(())
            }
            Some(StyleAction::EmptyElement) => {
                let opening = node.node_field("openingElement").ok_or_else(|| {
                    ProjectError::new("A TSRX <style> element is malformed", node)
                })?;
                let (opening_start, opening_end) = span_of(opening)?;
                if opening.bool_field("selfClosing") {
                    self.emit_verbatim_with_specials(
                        opening,
                        opening_start,
                        opening_end,
                        Position::Expression,
                    )
                } else {
                    self.emit_verbatim_with_specials(
                        opening,
                        opening_start,
                        opening_end.saturating_sub(1),
                        Position::Expression,
                    )?;
                    self.out.push_str(" />");
                    Ok(())
                }
            }
            None => Err(ProjectError::new(
                "internal TSRX frontend error: unprocessed style element",
                node,
            )),
        }
    }

    fn render_scoped_fragment(&mut self, node: Node<'_>, position: Position) -> Result<()> {
        let start = span_of(node)?.0;
        let setups = self
            .styles
            .owner_setups
            .get(&start)
            .cloned()
            .unwrap_or_default();
        self.begin_style_setup(&setups, position)?;
        let (start, end) = span_of(node)?;
        let mut specials = Vec::new();
        collect_children(node, &self.styles, &mut specials);
        self.emit_region(start, end, &mut specials)?;
        self.end_style_setup(&setups, position);
        Ok(())
    }

    fn render_scoped_element(&mut self, node: Node<'_>, position: Position) -> Result<()> {
        let start = span_of(node)?.0;
        let setups = self
            .styles
            .owner_setups
            .get(&start)
            .cloned()
            .unwrap_or_default();
        let hashes = self
            .styles
            .element_hashes
            .get(&start)
            .map(|hashes| hashes.join(" "))
            .unwrap_or_default();
        self.begin_style_setup(&setups, position)?;
        if is_dynamic_element(node) {
            self.render_dynamic_element(node, &hashes)?;
        } else {
            self.render_native_scoped_element(node, &hashes)?;
        }
        self.end_style_setup(&setups, position);
        Ok(())
    }

    fn begin_style_setup(&mut self, setups: &[RefSetup<'t>], position: Position) -> Result<()> {
        if setups.is_empty() {
            return Ok(());
        }
        if position == Position::JsxChild {
            self.push("{");
        }
        self.push("(() => {\n");
        for setup in setups {
            self.emit_ref_setup(setup)?;
        }
        self.push("return ");
        Ok(())
    }

    fn end_style_setup(&mut self, setups: &[RefSetup<'t>], position: Position) {
        if setups.is_empty() {
            return;
        }
        self.push(";\n})()");
        if position == Position::JsxChild {
            self.push("}");
        }
    }

    fn emit_ref_setup(&mut self, setup: &RefSetup<'t>) -> Result<()> {
        if is_direct_ref_target(setup.target) {
            self.emit_node(setup.target, Position::Expression)?;
            self.push(" = ");
            push_class_map(&mut self.out, &setup.class_map);
            self.push(";\n");
            return Ok(());
        }
        if is_callback_ref(setup.target) {
            self.push("(");
            self.emit_node(setup.target, Position::Expression)?;
            self.push(")(");
            push_class_map(&mut self.out, &setup.class_map);
            self.push(");\n");
            return Ok(());
        }
        let temp = setup.temp_name.as_deref().ok_or_else(|| {
            ProjectError::new(
                "internal TSRX frontend error: dynamic style ref has no temporary",
                setup.target,
            )
        })?;
        self.push("let ");
        self.push(temp);
        self.push(" = ");
        self.emit_node(setup.target, Position::Expression)?;
        self.push(";\nif (typeof ");
        self.push(temp);
        self.push(" === \"function\") {\n");
        self.push(temp);
        self.push("(");
        push_class_map(&mut self.out, &setup.class_map);
        self.push(");\n} else if (");
        self.push(temp);
        self.push(" && typeof ");
        self.push(temp);
        self.push(" === \"object\") {\nif (\"current\" in ");
        self.push(temp);
        self.push(") ");
        self.push(temp);
        self.push(".current = ");
        push_class_map(&mut self.out, &setup.class_map);
        self.push(";\nelse if (\"value\" in ");
        self.push(temp);
        self.push(") ");
        self.push(temp);
        self.push(".value = ");
        push_class_map(&mut self.out, &setup.class_map);
        self.push(";\n}\n");
        Ok(())
    }

    fn render_native_scoped_element(&mut self, node: Node<'_>, hash: &str) -> Result<()> {
        let opening = node
            .node_field("openingElement")
            .ok_or_else(|| ProjectError::new("JSX element is missing its opening tag", node))?;
        let (opening_start, opening_end) = span_of(opening)?;
        let mut specials = Vec::new();
        collect_children(opening, &self.styles, &mut specials);

        if hash.is_empty() {
            self.emit_region(opening_start, opening_end, &mut specials)?;
        } else if let Some(attribute) = class_attribute(opening) {
            if let Some(value) = attribute.node_field("value") {
                let (value_start, value_end) = span_of(value)?;
                self.emit_region(opening_start, value_start, &mut specials)?;
                self.emit_scoped_attribute_value(value, hash)?;
                self.emit_region(value_end, opening_end, &mut specials)?;
            } else {
                let (_, attribute_end) = span_of(attribute)?;
                self.emit_region(opening_start, attribute_end, &mut specials)?;
                self.push("=");
                push_js_string(&mut self.out, hash);
                self.emit_region(attribute_end, opening_end, &mut specials)?;
            }
        } else {
            let source = &self.source[opening_start as usize..opening_end as usize];
            let suffix = if source.ends_with("/>") { 2 } else { 1 };
            let insertion = opening_end.saturating_sub(suffix);
            self.emit_region(opening_start, insertion, &mut specials)?;
            self.push(" class=");
            push_js_string(&mut self.out, hash);
            self.emit_region(insertion, opening_end, &mut specials)?;
        }

        let (_, node_end) = span_of(node)?;
        let mut children = Vec::new();
        for child in node.list_field("children").flatten() {
            collect_specials(child, Position::JsxChild, &self.styles, &mut children);
        }
        self.emit_region(opening_end, node_end, &mut children)
    }

    fn emit_scoped_attribute_value(&mut self, value: Node<'_>, hash: &str) -> Result<()> {
        if value.ty() == "Literal"
            && let Some(current) = value.str_field("value").and_then(decode_json_string)
        {
            push_js_string(&mut self.out, &format!("{current} {hash}"));
            return Ok(());
        }
        let expression = if value.ty() == "JSXExpressionContainer" {
            value.node_field("expression").ok_or_else(|| {
                ProjectError::new("A JSX class expression is missing its value", value)
            })?
        } else {
            value
        };
        self.push("{`${");
        self.emit_node(expression, Position::Expression)?;
        self.push("} ");
        self.push(hash);
        self.push("`}");
        Ok(())
    }

    fn render_dynamic_element(&mut self, node: Node<'_>, hash: &str) -> Result<()> {
        let opening = node
            .node_field("openingElement")
            .ok_or_else(|| ProjectError::new("Dynamic tag is missing its opening element", node))?;
        let component = opening
            .node_field("name")
            .and_then(|name| name.node_field("expression"))
            .ok_or_else(|| {
                ProjectError::new("Dynamic tag is missing its component expression", node)
            })?;

        self.push("<Dynamic component={");
        self.emit_node(component, Position::Expression)?;
        self.push("}");
        let mut found_class = false;
        for attribute in opening.list_field("attributes").flatten() {
            self.push(" ");
            if !hash.is_empty() && is_class_attribute(attribute) {
                found_class = true;
                let name = attribute
                    .node_field("name")
                    .and_then(|name| name.str_field("name"))
                    .unwrap_or("class");
                self.push(name);
                if let Some(value) = attribute.node_field("value") {
                    self.push("=");
                    self.emit_scoped_attribute_value(value, hash)?;
                } else {
                    self.push("=");
                    push_js_string(&mut self.out, hash);
                }
            } else {
                self.emit_node(attribute, Position::Expression)?;
            }
        }
        if !hash.is_empty() && !found_class {
            self.push(" class=");
            push_js_string(&mut self.out, hash);
        }

        let has_children = node.list_field("children").next().is_some();
        if !has_children {
            self.push("/>");
            return Ok(());
        }
        self.push(">");
        let (_, opening_end) = span_of(opening)?;
        let children_end = match node.node_field("closingElement") {
            Some(closing) => span_of(closing)?.0,
            None => span_of(node)?.1,
        };
        // Children are authored content: emit the region verbatim with nested
        // specials (preserves JSXText exactly, like the Babel frontend).
        let mut specials = Vec::new();
        for child in node.list_field("children").flatten() {
            collect_specials(child, Position::JsxChild, &self.styles, &mut specials);
        }
        self.emit_region(opening_end, children_end, &mut specials)?;
        self.push("</Dynamic>");
        Ok(())
    }

    fn render_shorthand_attr(&mut self, node: Node<'_>) -> Result<()> {
        let name = node
            .node_field("name")
            .and_then(ident_name)
            .ok_or_else(|| ProjectError::new("Shorthand prop is missing its name", node))?;
        self.push(name);
        self.push("={");
        self.push(name);
        self.push("}");
        Ok(())
    }

    fn render_lazy_pattern(&mut self, node: Node<'_>) -> Result<()> {
        self.render_lazy_pattern_with_source(node, false)
    }

    fn render_lazy_pattern_with_source(
        &mut self,
        node: Node<'_>,
        source_accessor: bool,
    ) -> Result<()> {
        let span = span_of(node)?;
        let id = self
            .lazy_ids
            .iter()
            .position(|candidate| *candidate == span)
            .ok_or_else(|| {
                ProjectError::new("internal TSRX frontend error: unindexed lazy pattern", node)
            })?;
        self.lazy_patterns.push((
            self.out.len() as u32,
            format!("__lazy{id}"),
            source_accessor,
        ));
        // Emit the pattern minus its `&` sigil; binding names stay authored so
        // the reparsed program resolves scope exactly, and the post-reparse
        // pass renames them.
        let mut specials = Vec::new();
        collect_children(node, &self.styles, &mut specials);
        self.suppress_nested_lazy += 1;
        let result = self.emit_region(span.0, span.1, &mut specials);
        self.suppress_nested_lazy -= 1;
        result
    }

    fn emit_eager_pattern(&mut self, node: Node<'_>) -> Result<()> {
        let span = span_of(node)?;
        let mut specials = Vec::new();
        collect_children(node, &self.styles, &mut specials);
        self.emit_region(span.0, span.1, &mut specials)
    }

    fn render_lazy_assignment(&mut self, node: Node<'_>) -> Result<()> {
        let expression = node.node_field("expression").ok_or_else(|| {
            ProjectError::new(
                "TSRX lazy assignment is missing its assignment expression",
                node,
            )
        })?;
        let pattern = lazy_assignment_pattern(node)
            .ok_or_else(|| ProjectError::new("Malformed TSRX lazy assignment statement", node))?;
        if contains_pattern_default(pattern) {
            return Err(ProjectError::new(
                "TSRX standalone lazy assignment defaults are not supported by the JavaScript TSRX parser",
                pattern,
            ));
        }
        let value = expression.node_field("right").ok_or_else(|| {
            ProjectError::new(
                "TSRX lazy assignment is missing its source expression",
                expression,
            )
        })?;

        // Reparse the assignment as a lexical declaration so oxc_semantic can
        // resolve the introduced lazy names. The binding-pattern rewrite then
        // collapses this scaffold to `const __lazyN`, matching the JS frontend.
        self.push("const ");
        self.render_lazy_pattern(pattern)?;
        self.push(" = (");
        self.emit_node(value, Position::Expression)?;
        self.push(");");
        Ok(())
    }

    // -- Template block helpers -----------------------------------------------------

    /// Validate and split a template block (Babel `blockToParts`).
    fn block_parts<'n>(
        &mut self,
        block: Node<'n>,
        construct: Option<&str>,
    ) -> Result<BlockParts<'n>> {
        let entries = block_entries(block);
        self.block_parts_of_entries(&entries, construct)
    }

    fn block_parts_of_entries<'n>(
        &mut self,
        entries: &[Node<'n>],
        construct: Option<&str>,
    ) -> Result<BlockParts<'n>> {
        if let Some(construct) = construct {
            validate_no_control_flow_escape(entries, construct)?;
        }
        let mut setup = Vec::new();
        let mut renders: Vec<Node<'n>> = Vec::new();
        for entry in entries {
            if is_render_entry(entry.ty()) {
                if entry.ty() == "JSXText"
                    && entry.str_field("value").is_some_and(decode_json_ws_only)
                {
                    continue;
                }
                renders.push(*entry);
            } else {
                if !renders.is_empty() {
                    return Err(ProjectError::new(
                        "Statements may not follow the rendered output inside a TSRX template block",
                        *entry,
                    ));
                }
                setup.push(*entry);
            }
        }
        Ok(BlockParts { setup, renders })
    }

    /// Lower a whole template block to one expression (Babel
    /// `blockToExpression`). Callers must not invoke this for empty blocks.
    fn emit_block_expression(&mut self, block: Node<'_>, construct: &str) -> Result<()> {
        let parts = self.block_parts(block, Some(construct))?;
        if !parts.setup.is_empty() && parts.renders.is_empty() {
            return Err(ProjectError::new(
                format!(
                    "A TSRX {construct} block with setup statements must end with rendered output"
                ),
                block,
            ));
        }
        self.emit_parts_expression(&parts)
    }

    fn emit_parts_expression(&mut self, parts: &BlockParts<'_>) -> Result<()> {
        if parts.setup.is_empty() {
            return self.emit_renders_expression(&parts.renders);
        }
        self.push("(() => {\n");
        self.emit_statements(&parts.setup)?;
        self.push("return ");
        self.emit_renders_expression(&parts.renders)?;
        self.push(";\n})()");
        Ok(())
    }

    /// Combine render nodes into one expression (fragment for siblings).
    fn emit_renders_expression(&mut self, renders: &[Node<'_>]) -> Result<()> {
        match renders {
            [] => Ok(()),
            [only] => self.render_entry_expression(*only),
            many => {
                self.push("<>");
                for render in many {
                    self.emit_node(*render, Position::JsxChild)?;
                }
                self.push("</>");
                Ok(())
            }
        }
    }

    /// One render entry as an expression: JSXText becomes a string literal,
    /// everything else renders in expression position.
    fn render_entry_expression(&mut self, node: Node<'_>) -> Result<()> {
        if node.ty() == "JSXText" {
            // The tape scalar is already JSON-escaped: requote it as a JS
            // string literal (matches Babel's JSON.stringify raw).
            let value = node.str_field("value").unwrap_or("");
            self.push("\"");
            self.push(value);
            self.push("\"");
            return Ok(());
        }
        self.emit_node(node, Position::Expression)
    }

    fn emit_statements(&mut self, statements: &[Node<'_>]) -> Result<()> {
        for statement in statements {
            let before = self.out.len();
            self.emit_node(*statement, Position::Expression)?;
            let trimmed = self.out[before..].trim_end();
            if !trimmed.ends_with(';') && !trimmed.ends_with('}') {
                self.push(";");
            }
            self.push("\n");
        }
        Ok(())
    }
}

fn case_entries<'t>(case: Node<'t>) -> Vec<Node<'t>> {
    let consequent: Vec<Node<'t>> = case.list_field("consequent").flatten().collect();
    if consequent.len() == 1 && consequent[0].ty() == "BlockStatement" {
        consequent[0].list_field("body").flatten().collect()
    } else {
        consequent
    }
}

fn span_of(node: Node<'_>) -> Result<(u32, u32)> {
    node.span().ok_or_else(|| {
        ProjectError::new(
            format!("TSRX node `{}` is missing its span", node.ty()),
            node,
        )
    })
}

fn ident_name<'t>(node: Node<'t>) -> Option<&'t str> {
    if matches!(node.ty(), "Identifier" | "JSXIdentifier") {
        node.str_field("name")
    } else {
        None
    }
}

/// Whether a tape JSON string scalar (quotes stripped, escapes intact)
/// decodes to whitespace only.
fn decode_json_ws_only(escaped: &str) -> bool {
    let mut chars = escaped.chars();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' => match chars.next() {
                Some('n' | 'r' | 't' | 'f' | 'b') => {}
                Some('u') => {
                    let code: String = chars.by_ref().take(4).collect();
                    match u32::from_str_radix(&code, 16).ok().and_then(char::from_u32) {
                        Some(decoded) if decoded.is_whitespace() => {}
                        _ => return false,
                    }
                }
                _ => return false,
            },
            other if other.is_whitespace() => {}
            _ => return false,
        }
    }
    true
}

// ---------------------------------------------------------------------------
// Control-flow escape validation (mirrors validateNoControlFlowEscape)
// ---------------------------------------------------------------------------

fn escape_message(kind: &str, construct: &str) -> String {
    // Match the ecosystem (@tsrx/solid) diagnostics verbatim for @if and @for.
    if construct == "@if" || construct == "@else" {
        return match kind {
            "return" => "Return statements are not allowed inside TSRX template @if blocks. Move the return before the template output or render conditionally instead.".into(),
            "break" => "Break statements are not allowed inside TSRX template @if blocks.".into(),
            _ => "Continue statements are not allowed inside TSRX template @if blocks. Filter before rendering or use conditional output instead.".into(),
        };
    }
    if construct == "@for" || construct == "@empty" {
        return match kind {
            "return" => "Return statements are not allowed inside TSRX template for...of loops. Filter the iterable before rendering or use an @empty fallback for empty lists.".into(),
            "break" => "Break statements are not allowed inside TSRX template for...of loops.".into(),
            _ => "Continue statements are not allowed inside TSRX template for...of loops. Filter the iterable before rendering.".into(),
        };
    }
    let noun = match kind {
        "return" => "Return",
        "break" => "Break",
        _ => "Continue",
    };
    format!("{noun} statements are not allowed inside TSRX template {construct} blocks.")
}

fn validate_no_control_flow_escape(entries: &[Node<'_>], construct: &str) -> Result<()> {
    let mut labels: Vec<String> = Vec::new();
    for entry in entries {
        check(*entry, 0, 0, &mut labels, construct)?;
    }
    return Ok(());

    fn check(
        node: Node<'_>,
        loops: u32,
        breakables: u32,
        labels: &mut Vec<String>,
        construct: &str,
    ) -> Result<()> {
        let ty = node.ty();
        if is_function(ty) || ESCAPE_BOUNDARY_TYPES.contains(&ty) {
            return Ok(());
        }
        match ty {
            "ReturnStatement" => {
                return Err(ProjectError::new(escape_message("return", construct), node));
            }
            "BreakStatement" => {
                let label = node.node_field("label").and_then(ident_name);
                let escapes = match label {
                    Some(label) => !labels.iter().any(|known| known == label),
                    None => breakables == 0,
                };
                if escapes {
                    return Err(ProjectError::new(escape_message("break", construct), node));
                }
                return Ok(());
            }
            "ContinueStatement" => {
                let label = node.node_field("label").and_then(ident_name);
                let escapes = match label {
                    Some(label) => !labels.iter().any(|known| known == label),
                    None => loops == 0,
                };
                if escapes {
                    return Err(ProjectError::new(
                        escape_message("continue", construct),
                        node,
                    ));
                }
                return Ok(());
            }
            "SwitchStatement" => {
                if let Some(discriminant) = node.node_field("discriminant") {
                    check(discriminant, loops, breakables, labels, construct)?;
                }
                for case in node.list_field("cases").flatten() {
                    check(case, loops, breakables + 1, labels, construct)?;
                }
                return Ok(());
            }
            "LabeledStatement" => {
                let label = node
                    .node_field("label")
                    .and_then(ident_name)
                    .unwrap_or("")
                    .to_string();
                labels.push(label);
                if let Some(body) = node.node_field("body") {
                    check(body, loops, breakables, labels, construct)?;
                }
                labels.pop();
                return Ok(());
            }
            _ => {}
        }
        let is_loop = LOOP_TYPES.contains(&ty);
        let next_loops = if is_loop { loops + 1 } else { loops };
        let next_breakables = if is_loop { breakables + 1 } else { breakables };

        let mut result = Ok(());
        tape::walk_children(node, &mut |child| {
            if result.is_err() {
                return false;
            }
            result = check(child, next_loops, next_breakables, labels, construct);
            // Each child handles its own recursion.
            false
        });
        result
    }
}
