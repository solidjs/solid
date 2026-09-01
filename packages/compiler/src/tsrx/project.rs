//! TSRX → Solid JSX desugaring, as authored-text projection.
//!
//! Mirrors `@solidjs/babel-plugin`'s `src/tsrx/desugar.ts` (the frozen
//! contract) construct-for-construct, but in the text domain: typed nodes from
//! [`super::semantic`] identify Solid semantics and each construct extent is
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
    semantic::{
        self, CatchBinding, CodeBlock, ControlFlow, ForLoop, IfChain, RenderShape as Shape,
        Switch as SemanticSwitch, SwitchArm, TemplateSite, Try as SemanticTry,
    },
    source_map::ProjectionMap,
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
    /// Parser-authored embedded CSS and raw-text script bodies.
    pub(super) embedded_regions: Vec<semantic::EmbeddedRegion>,
    /// Exact authored ranges copied into `text`, used to compose codegen maps.
    pub(super) source_map: ProjectionMap,
    /// Projected offset of each lazy pattern's opening bracket, with its
    /// preallocated `__lazyN` name.
    pub lazy_patterns: Vec<(u32, String, bool)>,
    /// Projected offset of a generated arrow (its parameter `(`), with the
    /// binding names whose reads must become zero-argument calls (RC accessor
    /// semantics for non-default `For` items, custom-key `For` indexes, and
    /// `@catch` errors).
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

fn is_function(ty: &str) -> bool {
    FUNCTION_TYPES.contains(&ty)
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

pub fn project(
    source: &str,
    filename: &str,
    semantic: &semantic::SolidTsrxModule<'_>,
    source_maps: bool,
) -> Result<Projection> {
    let styles = style_projection::plan(source, filename, semantic)?;
    project_with_styles(source, semantic, styles, source_maps)
}

pub fn project_with_styles(
    source: &str,
    semantic: &semantic::SolidTsrxModule<'_>,
    styles: StyleProjection<'_>,
    source_maps: bool,
) -> Result<Projection> {
    let root = semantic.root;
    let css = styles.css.clone();
    let css_hash = styles.css_hash.clone();
    let embedded_regions = semantic.embedded_regions.clone();
    let mut renderer = Renderer {
        source,
        out: String::with_capacity(source.len() + source.len() / 4),
        semantic,
        styles,
        lazy_ids: collect_lazy_ids(semantic),
        lazy_patterns: Vec::new(),
        accessor_arrows: Vec::new(),
        source_map: ProjectionMap::new(source_maps),
    };

    renderer.emit_verbatim_with_specials(root, 0, source.len() as u32, Position::Expression)?;

    Ok(Projection {
        text: renderer.out,
        css,
        css_hash,
        embedded_regions,
        source_map: renderer.source_map,
        lazy_patterns: renderer.lazy_patterns,
        accessor_arrows: renderer.accessor_arrows,
    })
}

/// Preallocate `__lazyN` names for every lazy pattern in document order,
/// mirroring `@tsrx/core`'s `preallocateLazyIds`. Keyed by pattern span.
fn collect_lazy_ids(semantic: &semantic::SolidTsrxModule<'_>) -> Vec<(u32, u32)> {
    semantic
        .lazy_patterns
        .iter()
        .map(|pattern| (pattern.origin.span.start, pattern.origin.span.end))
        .collect()
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

fn has_synthetic_closing_element(node: Node<'_>) -> bool {
    node.node_field("closingElement")
        .and_then(Node::span)
        .is_some_and(|(start, end)| start == end)
}

fn is_synthetic_undefined(node: Node<'_>) -> bool {
    node.ty() == "Identifier"
        && node.str_field("name") == Some("undefined")
        && node.span().is_some_and(|(start, end)| start == end)
}

/// Find the outermost nodes within `node`'s subtree that need re-rendering,
/// in document order. Does not descend into found specials: their renderers
/// re-collect within themselves. `position` classifies `node` itself when it
/// is special.
fn collect_specials<'t>(
    node: Node<'t>,
    position: Position,
    styles: &StyleProjection<'t>,
    semantic: &semantic::SolidTsrxModule<'t>,
    out: &mut Vec<Special<'t>>,
) {
    let ty = node.ty();
    let start = node.span().map_or(u32::MAX, |span| span.0);

    let special_span = if semantic.lazy_assignment_for(node).is_some() {
        node.span()
    } else if let Some(control) = semantic.control_for(node) {
        let extent = control.origin().extent;
        Some((extent.start, extent.end))
    } else if semantic.template_site_for(node).is_some()
        || (ty == "JSXElement"
            && (styles.element_hashes.contains_key(&start)
                || styles.owner_setups.contains_key(&start)
                || has_synthetic_closing_element(node)))
        || (ty == "JSXFragment" && styles.owner_setups.contains_key(&start))
    {
        node.span()
    } else if semantic.is_authored_lazy_pattern(node) {
        // The `&` sigil sits immediately before the pattern's bracket.
        node.span()
            .map(|(start, end)| (start.saturating_sub(1), end))
    } else if is_synthetic_undefined(node) {
        node.span()
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

    collect_children(node, styles, semantic, out);
}

fn collect_children<'t>(
    node: Node<'t>,
    styles: &StyleProjection<'t>,
    semantic: &semantic::SolidTsrxModule<'t>,
    out: &mut Vec<Special<'t>>,
) {
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
                    collect_specials(child, child_position, styles, semantic, out);
                }
            }
            tsrx_tape_schema::ValueKind::List => {
                if let Some(list) = value.as_list() {
                    let mut next = node.tape().list_first_value(list);
                    while let Some(entry) = next.filter(|entry| !entry.is_none()) {
                        if let Some(item) = node.tape().list_value(entry)
                            && let Some(child) = Node::from_value(node.tape(), item)
                        {
                            collect_specials(child, child_position, styles, semantic, out);
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
// Rendering
// ---------------------------------------------------------------------------

struct Renderer<'s, 'm, 't> {
    source: &'s str,
    out: String,
    semantic: &'m semantic::SolidTsrxModule<'t>,
    styles: StyleProjection<'t>,
    /// Document-ordered lazy pattern spans; index = lazy id.
    lazy_ids: Vec<(u32, u32)>,
    lazy_patterns: Vec<(u32, String, bool)>,
    accessor_arrows: Vec<(u32, Vec<String>)>,
    source_map: ProjectionMap,
}

impl<'s, 'm, 't> Renderer<'s, 'm, 't> {
    fn push_verbatim(&mut self, start: u32, end: u32) {
        if end <= start {
            return;
        }
        self.source_map
            .record_verbatim(self.out.len() as u32, start, end);
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
        collect_specials(scope, position, &self.styles, self.semantic, &mut specials);
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
        if self.semantic.control_for(node).is_some()
            || self.semantic.template_site_for(node).is_some()
            || (ty == "JSXElement"
                && (self.styles.element_hashes.contains_key(&start)
                    || self.styles.owner_setups.contains_key(&start)
                    || has_synthetic_closing_element(node)))
            || (ty == "JSXFragment" && self.styles.owner_setups.contains_key(&start))
            || self.semantic.lazy_assignment_for(node).is_some()
            || self.semantic.is_authored_lazy_pattern(node)
            || self.semantic.lazy_pattern_for(node).is_some()
            || is_synthetic_undefined(node)
        {
            return self.render_special(node, position);
        }
        let (start, end) = span_of(node)?;
        let mut specials = Vec::new();
        collect_children(node, &self.styles, self.semantic, &mut specials);
        self.emit_region(start, end, &mut specials)
    }

    fn render_special(&mut self, node: Node<'_>, position: Position) -> Result<()> {
        if let Some(control) = self.semantic.control_for(node) {
            return match control {
                ControlFlow::CodeBlock(code) => self.render_code_block(code, position),
                ControlFlow::If(chain) => self.render_if(chain),
                ControlFlow::For(loop_) => self.render_for(loop_),
                ControlFlow::Switch(switch) => self.render_switch(switch),
                ControlFlow::Try(try_) => self.render_try(try_, position),
            };
        }
        if let Some(site) = self.semantic.template_site_for(node) {
            return match site {
                TemplateSite::StyleElement { .. } => self.render_style(node),
                TemplateSite::ShorthandAttribute { name, .. } => self.render_shorthand_attr(name),
                TemplateSite::RawTextScript(_) => self.render_raw_text_script(node, position),
                TemplateSite::DynamicElement { .. } => self.render_scoped_element(node, position),
            };
        }
        if let Some(assignment) = self.semantic.lazy_assignment_for(node) {
            return self.render_lazy_assignment(assignment);
        }
        match node.ty() {
            "JSXFragment" => self.render_scoped_fragment(node, position),
            "JSXElement" => self.render_scoped_element(node, position),
            "ArrayPattern" | "ObjectPattern" if self.semantic.lazy_pattern_for(node).is_some() => {
                self.render_lazy_pattern(node)
            }
            "ArrayPattern" | "ObjectPattern" => self.emit_eager_pattern(node),
            "Identifier" if is_synthetic_undefined(node) => {
                self.push("undefined");
                Ok(())
            }
            other => Err(ProjectError::new(
                format!("Unsupported TSRX construct `{other}`"),
                node,
            )),
        }
    }

    // -- @{} statement containers ---------------------------------------------

    fn render_code_block(&mut self, code: &CodeBlock<'t>, position: Position) -> Result<()> {
        let node = code.origin.tape;
        let render = code.render;
        let setup = &code.setup;
        let style_setups = self
            .styles
            .owner_setups
            .get(&span_of(node)?.0)
            .cloned()
            .unwrap_or_default();

        match position {
            Position::FunctionBody => {
                self.push("{\n");
                self.emit_statements(setup)?;
                for setup in &style_setups {
                    self.emit_ref_setup(setup)?;
                }
                self.push("return ");
                if let Some(render) = render {
                    self.render_entry_expression(render)?;
                } else {
                    self.push("null");
                }
                self.push(";\n}");
            }
            Position::Expression | Position::JsxChild => {
                let wrap = position == Position::JsxChild
                    && (if setup.is_empty() && style_setups.is_empty() {
                        render.is_none_or(|render| {
                            semantic::predict_entry_shape(render) == Shape::Expr
                        })
                    } else {
                        true
                    });
                if wrap {
                    self.push("{");
                }
                if setup.is_empty() && style_setups.is_empty() {
                    if let Some(render) = render {
                        self.render_entry_expression(render)?;
                    } else {
                        self.push("null");
                    }
                } else {
                    self.push("(() => {\n");
                    self.emit_statements(setup)?;
                    for setup in &style_setups {
                        self.emit_ref_setup(setup)?;
                    }
                    self.push("return ");
                    if let Some(render) = render {
                        self.render_entry_expression(render)?;
                    } else {
                        self.push("null");
                    }
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

    fn render_if(&mut self, chain: &IfChain<'t>) -> Result<()> {
        let has_fallback = chain
            .fallback
            .as_ref()
            .is_some_and(|fallback| !fallback.is_empty());

        if let [branch] = chain.branches.as_slice() {
            self.push("<Show when={");
            self.emit_node(branch.test, Position::Expression)?;
            self.push("}");
            if has_fallback {
                self.push(" fallback={");
                self.emit_template_block_expression(chain.fallback.as_ref().unwrap(), "@else")?;
                self.push("}");
            }
            return self.emit_construct_children(&branch.body, "@if", "</Show>");
        }

        self.push("<Switch");
        if has_fallback {
            self.push(" fallback={");
            self.emit_template_block_expression(chain.fallback.as_ref().unwrap(), "@else")?;
            self.push("}");
        }
        self.push(">");
        for branch in &chain.branches {
            self.push("<Match when={");
            self.emit_node(branch.test, Position::Expression)?;
            self.push("}");
            self.emit_construct_children(&branch.body, "@if", "</Match>")?;
        }
        self.push("</Switch>");
        Ok(())
    }

    /// Emit a construct's block as its JSX children (or self-close when the
    /// block renders nothing), then the closing tag.
    fn emit_construct_children(
        &mut self,
        block: &semantic::TemplateBlock<'_>,
        construct: &str,
        closing: &str,
    ) -> Result<()> {
        if block.is_empty() {
            self.push("/>");
            return Ok(());
        }
        self.push(">");
        if block.shape == Shape::Jsx {
            self.emit_template_block_expression(block, construct)?;
        } else {
            self.push("{");
            self.emit_template_block_expression(block, construct)?;
            self.push("}");
        }
        self.push(closing);
        Ok(())
    }

    // -- @for — For --------------------------------------------------------------

    fn render_for(&mut self, loop_: &ForLoop<'t>) -> Result<()> {
        let node = loop_.origin.tape;
        let pattern = loop_.pattern;
        let each = loop_.iterable;
        let index = loop_.index;
        let key = loop_.key;
        let mode = loop_.callback_mode;
        let body = &loop_.body;
        if body.renders.is_empty() {
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
        } else if mode.emits_non_keyed_intent() {
            self.push(" keyed={false}");
        }
        if let Some(empty) = &loop_.empty
            && !empty.is_empty()
        {
            self.push(" fallback={");
            self.emit_template_block_expression(empty, "@empty")?;
            self.push("}");
        }
        self.push(">{");

        // RC `For` callback shape:
        // - default keyed mode: raw item, accessor index (there is no TSRX index)
        // - keyed={false}: accessor item, raw index
        // - custom key: accessor item, accessor index
        // The post-reparse pass rewrites accessor reads at this arrow.
        let mut accessor_names = Vec::new();
        if mode.item_is_accessor()
            && let Some(name) = ident_name(pattern)
        {
            accessor_names.push(name.to_string());
        }
        if mode.index_is_accessor()
            && let Some(index) = index
            && let Some(name) = ident_name(index)
        {
            accessor_names.push(name.to_string());
        }
        if !accessor_names.is_empty() {
            self.accessor_arrows
                .push((self.out.len() as u32, accessor_names));
        }

        self.push("(");
        if mode.item_is_accessor() && pattern.ty() != "Identifier" {
            self.render_lazy_pattern(pattern)?;
        } else {
            self.emit_node(pattern, Position::Expression)?;
        }
        if let Some(index) = index {
            self.push(", ");
            self.emit_node(index, Position::Expression)?;
        }
        self.push(") => ");
        if body.setup.is_empty() {
            self.push("(");
            self.emit_renders_expression(&body.renders)?;
            self.push(")");
        } else {
            self.push("{\n");
            self.emit_statements(&body.setup)?;
            self.push("return ");
            self.emit_renders_expression(&body.renders)?;
            self.push(";\n}");
        }
        self.push("}</For>");
        Ok(())
    }

    // -- @switch — Switch / Match --------------------------------------------------

    fn render_switch(&mut self, switch: &SemanticSwitch<'t>) -> Result<()> {
        // Validate every case in authored order first (the @default case is
        // emitted out of order, as the leading `fallback` attribute).
        for arm in &switch.arms {
            let block = arm.block();
            if !block.setup.is_empty() && block.renders.is_empty() {
                return Err(ProjectError::new(
                    "A TSRX @case block with setup statements must end with rendered output",
                    arm.origin().tape,
                ));
            }
        }

        let default_arm = switch.default_arm();
        let has_fallback = default_arm.is_some_and(|arm| !arm.block().is_empty());

        self.push("<Switch");
        if has_fallback {
            self.push(" fallback={");
            self.emit_template_block_expression(default_arm.unwrap().block(), "@default")?;
            self.push("}");
        }
        self.push(">");
        for arm in &switch.arms {
            let SwitchArm::Case { test, block, .. } = arm else {
                continue;
            };
            self.push("<Match when={(");
            self.emit_node(switch.discriminant, Position::Expression)?;
            self.push(") === (");
            self.emit_node(*test, Position::Expression)?;
            self.push(")}");

            if block.is_empty() {
                self.push("/>");
                continue;
            }
            self.push(">");
            let shape = if block.setup.is_empty() {
                match block.renders.as_slice() {
                    [only] => semantic::predict_entry_shape(*only),
                    _ => Shape::Jsx,
                }
            } else {
                Shape::Expr
            };
            if shape == Shape::Jsx {
                self.emit_template_block_expression(block, "@case")?;
            } else {
                self.push("{");
                self.emit_template_block_expression(block, "@case")?;
                self.push("}");
            }
            self.push("</Match>");
        }
        self.push("</Switch>");
        Ok(())
    }

    // -- @try / @pending / @catch — Errored / Loading -------------------------------

    fn render_try(&mut self, try_: &SemanticTry<'t>, position: Position) -> Result<()> {
        let node = try_.origin.tape;
        let block = &try_.body;
        if block.renders.is_empty() {
            // Setup-only blocks get blockToExpression's message; fully empty
            // ones get the @try-specific message, matching the Babel frontend.
            return Err(if block.setup.is_empty() {
                ProjectError::new("A TSRX @try block must end with rendered output", node)
            } else {
                ProjectError::new(
                    "A TSRX @try block with setup statements must end with rendered output",
                    block.node,
                )
            });
        }
        let pending = try_.pending.as_ref();
        let handler = try_.catch.as_ref();
        let mut error_name = String::from("_e");
        let mut reset_name: Option<String> = None;
        let mut has_error_param = false;
        let mut error_pattern = None;
        if let Some(handler) = handler {
            if let Some(binding) = &handler.binding {
                match binding {
                    CatchBinding::Identifier { name, .. } => {
                        error_name = (*name).to_string();
                        has_error_param = true;
                    }
                    CatchBinding::Pattern(pattern) => error_pattern = Some(*pattern),
                }
            }
            if let Some(reset) = handler.reset.and_then(ident_name) {
                reset_name = Some(reset.to_string());
            }
            if handler.body.renders.is_empty() {
                return Err(if handler.body.setup.is_empty() {
                    ProjectError::new(
                        "A TSRX @catch block must end with rendered output",
                        handler.origin.tape,
                    )
                } else {
                    ProjectError::new(
                        "A TSRX @catch block with setup statements must end with rendered output",
                        handler.body.node,
                    )
                });
            }
        }

        let inner_shape = if pending.is_some() {
            Shape::Jsx
        } else {
            block.shape
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
                self.render_lazy_pattern(pattern)?;
            } else {
                self.push(&error_name);
            }
            if let Some(reset) = &reset_name {
                self.push(", ");
                self.push(reset);
            }
            self.push(") => (");
            self.emit_template_block_expression(&handler.body, "@catch")?;
            self.push(")}>");
        }

        if let Some(pending) = pending {
            self.push("<Loading");
            if !pending.is_empty() {
                self.push(" fallback={");
                self.emit_template_block_expression(pending, "@pending")?;
                self.push("}");
            }
            self.push(">");
            let content_shape = block.shape;
            if content_shape == Shape::Jsx {
                self.emit_template_block_expression(block, "@try")?;
            } else {
                self.push("{");
                self.emit_template_block_expression(block, "@try")?;
                self.push("}");
            }
            self.push("</Loading>");
        } else if handler.is_some() {
            let content_shape = block.shape;
            if content_shape == Shape::Jsx {
                self.emit_template_block_expression(block, "@try")?;
            } else {
                self.push("{");
                self.emit_template_block_expression(block, "@try")?;
                self.push("}");
            }
        } else {
            self.emit_template_block_expression(block, "@try")?;
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
        collect_children(node, &self.styles, self.semantic, &mut specials);
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
        if self.semantic.is_dynamic_element(node) {
            self.render_dynamic_element(node, &hashes)?;
        } else {
            self.render_native_scoped_element(node, &hashes)?;
        }
        self.end_style_setup(&setups, position);
        Ok(())
    }

    fn render_raw_text_script(&mut self, node: Node<'_>, position: Position) -> Result<()> {
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
        let payload = self
            .semantic
            .raw_text_script_for(node)
            .map(|script| script.payload)
            .ok_or_else(|| ProjectError::new("A TSRX raw-text script is malformed", node))?;
        let source = self.source;
        let content = source
            .get(payload.start as usize..payload.end as usize)
            .ok_or_else(|| ProjectError::new("A TSRX raw-text script span is invalid", node))?;
        self.begin_style_setup(&setups, position)?;
        self.emit_native_opening(node, &hashes)?;
        self.push("{");
        push_js_string(&mut self.out, content);
        self.push("}");
        self.push_verbatim(payload.end, span_of(node)?.1);
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
        let opening_end = self.emit_native_opening(node, hash)?;
        let (_, node_end) = span_of(node)?;
        let closing = node.node_field("closingElement");
        let synthetic_closing = closing
            .and_then(Node::span)
            .is_some_and(|(start, end)| start == end);
        let children_end = closing.and_then(Node::span).map_or(node_end, |span| span.0);
        let mut children = Vec::new();
        for child in node.list_field("children").flatten() {
            collect_specials(
                child,
                Position::JsxChild,
                &self.styles,
                self.semantic,
                &mut children,
            );
        }
        self.emit_region(opening_end, children_end, &mut children)?;
        if synthetic_closing {
            let opening = node.node_field("openingElement").ok_or_else(|| {
                ProjectError::new("Recovered JSX element is missing its opening tag", node)
            })?;
            let name = opening.node_field("name").ok_or_else(|| {
                ProjectError::new("Recovered JSX opening tag is missing its name", opening)
            })?;
            let (name_start, name_end) = span_of(name)?;
            self.push("</");
            self.push(&self.source[name_start as usize..name_end as usize]);
            self.push(">");
        } else if let Some(closing) = closing {
            let (_, closing_end) = span_of(closing)?;
            self.push_verbatim(children_end, closing_end);
        }
        Ok(())
    }

    fn emit_native_opening(&mut self, node: Node<'_>, hash: &str) -> Result<u32> {
        let opening = node
            .node_field("openingElement")
            .ok_or_else(|| ProjectError::new("JSX element is missing its opening tag", node))?;
        let (opening_start, opening_end) = span_of(opening)?;
        let mut specials = Vec::new();
        collect_children(opening, &self.styles, self.semantic, &mut specials);

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

        Ok(opening_end)
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
            collect_specials(
                child,
                Position::JsxChild,
                &self.styles,
                self.semantic,
                &mut specials,
            );
        }
        self.emit_region(opening_end, children_end, &mut specials)?;
        self.push("</Dynamic>");
        Ok(())
    }

    fn render_shorthand_attr(&mut self, name: &str) -> Result<()> {
        self.push(name);
        self.push("={");
        self.push(name);
        self.push("}");
        Ok(())
    }

    fn render_lazy_pattern(&mut self, node: Node<'_>) -> Result<()> {
        let source_accessor = self
            .semantic
            .lazy_pattern_for(node)
            .ok_or_else(|| {
                ProjectError::new("internal TSRX frontend error: unknown lazy pattern", node)
            })?
            .source_accessor;
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
        collect_children(node, &self.styles, self.semantic, &mut specials);
        self.emit_region(span.0, span.1, &mut specials)
    }

    fn emit_eager_pattern(&mut self, node: Node<'_>) -> Result<()> {
        let span = span_of(node)?;
        let mut specials = Vec::new();
        collect_children(node, &self.styles, self.semantic, &mut specials);
        self.emit_region(span.0, span.1, &mut specials)
    }

    fn render_lazy_assignment(&mut self, assignment: &semantic::LazyAssignment<'t>) -> Result<()> {
        let pattern = assignment.pattern;
        if contains_pattern_default(pattern) {
            return Err(ProjectError::new(
                "TSRX standalone lazy assignment defaults are not supported by the JavaScript TSRX parser",
                pattern,
            ));
        }
        let value = assignment.value;

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

    /// Lower a whole template block to one expression (Babel
    /// `blockToExpression`). Callers must not invoke this for empty blocks.
    fn emit_template_block_expression(
        &mut self,
        block: &semantic::TemplateBlock<'_>,
        construct: &str,
    ) -> Result<()> {
        if !block.setup.is_empty() && block.renders.is_empty() {
            return Err(ProjectError::new(
                format!(
                    "A TSRX {construct} block with setup statements must end with rendered output"
                ),
                block.node,
            ));
        }
        self.emit_parts_expression(&block.setup, &block.renders)
    }

    fn emit_parts_expression(&mut self, setup: &[Node<'_>], renders: &[Node<'_>]) -> Result<()> {
        if setup.is_empty() {
            return self.emit_renders_expression(renders);
        }
        self.push("(() => {\n");
        self.emit_statements(setup)?;
        self.push("return ");
        self.emit_renders_expression(renders)?;
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
