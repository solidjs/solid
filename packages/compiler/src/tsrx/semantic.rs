//! Compiler-owned semantic IR for authored Solid TSRX.
//!
//! `FlatTape` is the parser interchange format. This module is the boundary
//! that turns its string-keyed ESTree/TSRX records into typed Solid constructs
//! before any text projection is emitted. Ordinary JavaScript expressions and
//! blocks remain tape [`Node`] references in this transitional slice; future
//! backends can lower those leaves directly to their native AST.

use std::collections::{HashMap, HashSet};

use super::tape::{self, Node};
use tsrx_tape_schema::RecordIndex;

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
const ESCAPE_BOUNDARY_TYPES: [&str; 5] = [
    "JSXCodeBlock",
    "JSXIfExpression",
    "JSXForExpression",
    "JSXSwitchExpression",
    "JSXTryExpression",
];

/// A half-open range in authored UTF-8 bytes.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct AuthoredSpan {
    pub start: u32,
    pub end: u32,
}

impl AuthoredSpan {
    fn of(node: Node<'_>) -> Result<Self, SemanticError> {
        node.span()
            .map(|(start, end)| Self { start, end })
            .ok_or_else(|| {
                SemanticError::new(
                    format!("TSRX node `{}` is missing its span", node.ty()),
                    node,
                )
            })
    }
}

/// The authored origin of one semantic construct.
///
/// `span` is the parser node's exact origin. `extent` also includes trailing
/// clauses that some parser revisions omit from the parent node span and is
/// therefore the range replaced by text projection.
#[derive(Clone, Copy)]
pub struct Origin<'t> {
    pub span: AuthoredSpan,
    pub extent: AuthoredSpan,
    pub tape: Node<'t>,
}

impl<'t> Origin<'t> {
    fn new(node: Node<'t>, include_clauses: bool) -> Result<Self, SemanticError> {
        let span = AuthoredSpan::of(node)?;
        let extent = if include_clauses {
            construct_extent(node, span)
        } else {
            span
        };
        Ok(Self {
            span,
            extent,
            tape: node,
        })
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum RenderShape {
    Jsx,
    Expr,
}

/// A typed template block whose entries still reference transitional tape nodes.
#[derive(Clone)]
pub struct TemplateBlock<'t> {
    pub node: Node<'t>,
    pub setup: Vec<Node<'t>>,
    pub renders: Vec<Node<'t>>,
    pub shape: RenderShape,
}

impl<'t> TemplateBlock<'t> {
    fn new(node: Node<'t>, construct: &str) -> Result<Self, SemanticError> {
        Self::from_entries(node, node.list_field("body").flatten().collect(), construct)
    }

    fn from_entries(
        node: Node<'t>,
        entries: Vec<Node<'t>>,
        construct: &str,
    ) -> Result<Self, SemanticError> {
        validate_no_control_flow_escape(&entries, construct)?;
        let (setup, renders) = partition_entries(&entries)?;
        let shape = predict_parts_shape(&setup, &renders);
        Ok(Self {
            node,
            setup,
            renders,
            shape,
        })
    }

    pub fn is_empty(&self) -> bool {
        self.setup.is_empty() && self.renders.is_empty()
    }
}

pub fn predict_entry_shape(node: Node<'_>) -> RenderShape {
    match node.ty() {
        "JSXElement" | "JSXFragment" | "JSXStyleElement" => RenderShape::Jsx,
        "JSXText" => RenderShape::Expr,
        "JSXIfExpression" | "JSXForExpression" | "JSXSwitchExpression" => RenderShape::Jsx,
        "JSXTryExpression" => {
            if node.has_node_field("handler") || node.has_node_field("pending") {
                RenderShape::Jsx
            } else {
                node.node_field("block")
                    .map(predict_raw_block_shape)
                    .unwrap_or(RenderShape::Expr)
            }
        }
        "JSXCodeBlock" => {
            if node.list_field("body").next().is_some() {
                RenderShape::Expr
            } else {
                node.node_field("render")
                    .map(predict_entry_shape)
                    .unwrap_or(RenderShape::Expr)
            }
        }
        _ => RenderShape::Expr,
    }
}

fn predict_raw_block_shape(block: Node<'_>) -> RenderShape {
    let entries = block.list_field("body").flatten().collect::<Vec<_>>();
    let (setup, renders) = partition_entries_unchecked(&entries);
    predict_parts_shape(&setup, &renders)
}

fn predict_parts_shape(setup: &[Node<'_>], renders: &[Node<'_>]) -> RenderShape {
    if !setup.is_empty() {
        return RenderShape::Expr;
    }
    match renders {
        [only] => predict_entry_shape(*only),
        _ => RenderShape::Jsx,
    }
}

#[derive(Clone)]
pub struct CodeBlock<'t> {
    pub origin: Origin<'t>,
    pub setup: Vec<Node<'t>>,
    pub render: Node<'t>,
}

#[derive(Clone)]
pub struct IfBranch<'t> {
    pub test: Node<'t>,
    pub body: TemplateBlock<'t>,
}

#[derive(Clone)]
pub struct IfChain<'t> {
    pub origin: Origin<'t>,
    pub branches: Vec<IfBranch<'t>>,
    pub fallback: Option<TemplateBlock<'t>>,
}

/// Runtime callback contract selected by the authored `index`/`key` clauses.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ForCallbackMode {
    /// No index and no custom key: raw item.
    Default,
    /// `index` without `key`: accessor item and raw numeric index.
    Indexed,
    /// Custom key without an authored index: accessor item.
    Keyed,
    /// Custom key and index: accessor item and accessor index.
    KeyedIndexed,
}

impl ForCallbackMode {
    pub fn from_clauses(has_index: bool, has_key: bool) -> Self {
        match (has_index, has_key) {
            (false, false) => Self::Default,
            (true, false) => Self::Indexed,
            (false, true) => Self::Keyed,
            (true, true) => Self::KeyedIndexed,
        }
    }

    pub fn item_is_accessor(self) -> bool {
        self != Self::Default
    }

    pub fn index_is_accessor(self) -> bool {
        self == Self::KeyedIndexed
    }

    pub fn emits_non_keyed_intent(self) -> bool {
        self == Self::Indexed
    }
}

#[derive(Clone)]
pub struct ForLoop<'t> {
    pub origin: Origin<'t>,
    pub pattern: Node<'t>,
    pub iterable: Node<'t>,
    pub index: Option<Node<'t>>,
    pub key: Option<Node<'t>>,
    pub body: TemplateBlock<'t>,
    pub empty: Option<TemplateBlock<'t>>,
    pub callback_mode: ForCallbackMode,
}

#[derive(Clone)]
pub enum SwitchArm<'t> {
    Case {
        origin: Origin<'t>,
        test: Node<'t>,
        block: TemplateBlock<'t>,
    },
    Default {
        origin: Origin<'t>,
        block: TemplateBlock<'t>,
    },
}

impl<'t> SwitchArm<'t> {
    pub fn origin(&self) -> Origin<'t> {
        match self {
            Self::Case { origin, .. } | Self::Default { origin, .. } => *origin,
        }
    }

    pub fn block(&self) -> &TemplateBlock<'t> {
        match self {
            Self::Case { block, .. } | Self::Default { block, .. } => block,
        }
    }
}

#[derive(Clone)]
pub struct Switch<'t> {
    pub origin: Origin<'t>,
    pub discriminant: Node<'t>,
    pub arms: Vec<SwitchArm<'t>>,
}

impl<'t> Switch<'t> {
    pub fn default_arm(&self) -> Option<&SwitchArm<'t>> {
        self.arms
            .iter()
            .find(|arm| matches!(arm, SwitchArm::Default { .. }))
    }
}

#[derive(Clone)]
pub enum CatchBinding<'t> {
    Identifier { name: &'t str },
    Pattern(Node<'t>),
}

#[derive(Clone)]
pub struct TryCatch<'t> {
    pub origin: Origin<'t>,
    pub binding: Option<CatchBinding<'t>>,
    pub reset: Option<Node<'t>>,
    pub body: TemplateBlock<'t>,
}

#[derive(Clone)]
pub struct Try<'t> {
    pub origin: Origin<'t>,
    pub body: TemplateBlock<'t>,
    pub pending: Option<TemplateBlock<'t>>,
    pub catch: Option<TryCatch<'t>>,
}

#[derive(Clone)]
pub enum ControlFlow<'t> {
    CodeBlock(CodeBlock<'t>),
    If(IfChain<'t>),
    For(ForLoop<'t>),
    Switch(Switch<'t>),
    Try(Try<'t>),
}

impl<'t> ControlFlow<'t> {
    pub fn origin(&self) -> Origin<'t> {
        match self {
            Self::CodeBlock(node) => node.origin,
            Self::If(node) => node.origin,
            Self::For(node) => node.origin,
            Self::Switch(node) => node.origin,
            Self::Try(node) => node.origin,
        }
    }
}

#[derive(Clone, Copy)]
pub struct RawTextScript<'t> {
    pub origin: Origin<'t>,
    pub payload: AuthoredSpan,
}

#[derive(Clone, Copy)]
pub enum TemplateSite<'t> {
    DynamicElement { origin: Origin<'t> },
    RawTextScript(RawTextScript<'t>),
    StyleElement { origin: Origin<'t> },
    ShorthandAttribute { origin: Origin<'t>, name: &'t str },
}

impl<'t> TemplateSite<'t> {
    pub fn origin(&self) -> Origin<'t> {
        match self {
            Self::DynamicElement { origin }
            | Self::StyleElement { origin }
            | Self::ShorthandAttribute { origin, .. } => *origin,
            Self::RawTextScript(script) => script.origin,
        }
    }
}

#[derive(Clone, Copy)]
pub struct LazyPattern<'t> {
    pub origin: Origin<'t>,
    pub source_accessor: bool,
}

#[derive(Clone, Copy)]
pub struct LazyAssignment<'t> {
    pub origin: Origin<'t>,
    pub pattern: Node<'t>,
    pub value: Node<'t>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EmbeddedKind {
    Css,
    Script,
}

/// Authored embedded-language region supplied structurally by the parser.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EmbeddedRegion {
    pub kind: EmbeddedKind,
    pub span: AuthoredSpan,
}

/// Typed semantic view of one Solid TSRX module.
pub struct SolidTsrxModule<'t> {
    pub root: Node<'t>,
    pub control_flow: Vec<ControlFlow<'t>>,
    pub template_sites: Vec<TemplateSite<'t>>,
    pub lazy_patterns: Vec<LazyPattern<'t>>,
    pub lazy_assignments: Vec<LazyAssignment<'t>>,
    pub embedded_regions: Vec<EmbeddedRegion>,
    control_index: HashMap<RecordIndex, usize>,
    template_site_index: HashMap<RecordIndex, usize>,
    lazy_pattern_index: HashMap<RecordIndex, usize>,
    authored_lazy_pattern_index: HashSet<RecordIndex>,
    lazy_assignment_index: HashMap<RecordIndex, usize>,
}

impl<'t> SolidTsrxModule<'t> {
    pub fn control_for(&self, node: Node<'_>) -> Option<&ControlFlow<'t>> {
        self.control_index
            .get(&node.object())
            .map(|index| &self.control_flow[*index])
    }

    pub fn template_site_for(&self, node: Node<'_>) -> Option<&TemplateSite<'t>> {
        self.template_site_index
            .get(&node.object())
            .map(|index| &self.template_sites[*index])
    }

    pub fn raw_text_script_for(&self, node: Node<'_>) -> Option<&RawTextScript<'t>> {
        match self.template_site_for(node) {
            Some(TemplateSite::RawTextScript(script)) => Some(script),
            _ => None,
        }
    }

    pub fn is_dynamic_element(&self, node: Node<'_>) -> bool {
        matches!(
            self.template_site_for(node),
            Some(TemplateSite::DynamicElement { .. })
        )
    }

    pub fn is_style_element(&self, node: Node<'_>) -> bool {
        matches!(
            self.template_site_for(node),
            Some(TemplateSite::StyleElement { .. })
        )
    }

    pub fn lazy_pattern_for(&self, node: Node<'_>) -> Option<&LazyPattern<'t>> {
        self.lazy_pattern_index
            .get(&node.object())
            .map(|index| &self.lazy_patterns[*index])
    }

    pub fn is_authored_lazy_pattern(&self, node: Node<'_>) -> bool {
        self.authored_lazy_pattern_index.contains(&node.object())
    }

    pub fn lazy_assignment_for(&self, node: Node<'_>) -> Option<&LazyAssignment<'t>> {
        self.lazy_assignment_index
            .get(&node.object())
            .map(|index| &self.lazy_assignments[*index])
    }
}

/// A semantic-lowering diagnostic in authored coordinates.
#[derive(Debug)]
pub struct SemanticError {
    pub message: String,
    pub start: u32,
}

impl SemanticError {
    fn new(message: impl Into<String>, node: Node<'_>) -> Self {
        Self {
            message: message.into(),
            start: node.span().map_or(0, |span| span.0),
        }
    }
}

/// Lower the parser-interchange root into compiler-owned Solid TSRX IR.
pub fn lower<'t>(root: Node<'t>) -> Result<SolidTsrxModule<'t>, SemanticError> {
    AuthoredSpan::of(root)?;
    let mut controls = Vec::new();
    let mut template_sites = Vec::new();
    let mut authored_lazy_patterns = Vec::new();
    let mut lazy_assignment_nodes = Vec::new();
    let mut embedded_regions = Vec::new();
    let mut lowering_error = None;
    tape::walk(root, &mut |node| {
        if lowering_error.is_some() {
            return false;
        }
        if is_exported_lazy_declaration(node) {
            lowering_error = Some(SemanticError::new(
                "TSRX lazy bindings cannot be exported",
                node.node_field("declaration").unwrap_or(node),
            ));
            return false;
        }
        if matches!(
            node.ty(),
            "JSXCodeBlock"
                | "JSXIfExpression"
                | "JSXForExpression"
                | "JSXSwitchExpression"
                | "JSXTryExpression"
        ) {
            controls.push(node);
        } else if let Some(raw) = tape::raw_text_payload(node, "script") {
            match (Origin::new(node, false), AuthoredSpan::of(raw)) {
                (Ok(origin), Ok(payload)) => {
                    template_sites.push(TemplateSite::RawTextScript(RawTextScript {
                        origin,
                        payload,
                    }));
                    embedded_regions.push(EmbeddedRegion {
                        kind: EmbeddedKind::Script,
                        span: payload,
                    });
                }
                (Err(error), _) | (_, Err(error)) => {
                    lowering_error = Some(error);
                    return false;
                }
            }
        } else if node.ty() == "JSXStyleElement" {
            match Origin::new(node, false) {
                Ok(origin) => template_sites.push(TemplateSite::StyleElement { origin }),
                Err(error) => {
                    lowering_error = Some(error);
                    return false;
                }
            }
        } else if tape::is_dynamic_element(node) {
            match Origin::new(node, false) {
                Ok(origin) => template_sites.push(TemplateSite::DynamicElement { origin }),
                Err(error) => {
                    lowering_error = Some(error);
                    return false;
                }
            }
        } else if node.ty() == "JSXAttribute" && node.bool_field("shorthand") {
            let name = node
                .node_field("name")
                .and_then(|name| name.str_field("name"))
                .filter(|name| !name.is_empty());
            let Some(name) = name else {
                lowering_error = Some(SemanticError::new(
                    "Shorthand prop is missing its name",
                    node,
                ));
                return false;
            };
            match Origin::new(node, false) {
                Ok(origin) => {
                    template_sites.push(TemplateSite::ShorthandAttribute { origin, name });
                }
                Err(error) => {
                    lowering_error = Some(error);
                    return false;
                }
            }
        }
        if is_authored_lazy_pattern(node) {
            authored_lazy_patterns.push(node);
        }
        if lazy_assignment_parts(node).is_some() {
            lazy_assignment_nodes.push(node);
        }
        if node.ty() == "JSXStyleElement"
            && let Some((start, end)) = tape::paired_element_payload_span(node)
        {
            embedded_regions.push(EmbeddedRegion {
                kind: EmbeddedKind::Css,
                span: AuthoredSpan { start, end },
            });
        }
        true
    });
    if let Some(error) = lowering_error {
        return Err(error);
    }

    // Tape field order is not source order. Lower in authored order so the
    // first structural diagnostic remains deterministic; for equal starts,
    // validate the containing construct before its descendants.
    controls.sort_by_key(|node| {
        let (start, end) = node.span().unwrap_or((u32::MAX, 0));
        (start, std::cmp::Reverse(end))
    });
    let mut control_flow = Vec::with_capacity(controls.len());
    for node in controls {
        control_flow.push(match node.ty() {
            "JSXCodeBlock" => lower_code_block(node)?,
            "JSXIfExpression" => lower_if(node)?,
            "JSXForExpression" => lower_for(node)?,
            "JSXSwitchExpression" => lower_switch(node)?,
            "JSXTryExpression" => lower_try(node)?,
            _ => {
                unreachable!("control candidates are filtered before semantic lowering")
            }
        });
    }
    let control_index = control_flow
        .iter()
        .enumerate()
        .map(|(index, control)| (control.origin().tape.object(), index))
        .collect();
    template_sites.sort_by_key(|site| site.origin().span);
    let template_site_index = template_sites
        .iter()
        .enumerate()
        .map(|(index, site)| (site.origin().tape.object(), index))
        .collect();
    let authored_lazy_pattern_index = authored_lazy_patterns
        .iter()
        .map(|pattern| pattern.object())
        .collect();
    let (lazy_patterns, lazy_pattern_index) =
        lower_lazy_patterns(authored_lazy_patterns, &control_flow)?;
    let lazy_assignments = lazy_assignment_nodes
        .into_iter()
        .map(|node| {
            let (pattern, value) = lazy_assignment_parts(node)
                .expect("lazy assignment candidates are filtered before lowering");
            Ok(LazyAssignment {
                origin: Origin::new(node, false)?,
                pattern,
                value,
            })
        })
        .collect::<Result<Vec<_>, SemanticError>>()?;
    let lazy_assignment_index = lazy_assignments
        .iter()
        .enumerate()
        .map(|(index, assignment)| (assignment.origin.tape.object(), index))
        .collect();
    embedded_regions.sort_by_key(|region| region.span);
    Ok(SolidTsrxModule {
        root,
        control_flow,
        template_sites,
        lazy_patterns,
        lazy_assignments,
        embedded_regions,
        control_index,
        template_site_index,
        lazy_pattern_index,
        authored_lazy_pattern_index,
        lazy_assignment_index,
    })
}

fn lower_code_block<'t>(node: Node<'t>) -> Result<ControlFlow<'t>, SemanticError> {
    let render = required_node(
        node,
        "render",
        "A TSRX statement container is missing its rendered output node",
    )?;
    Ok(ControlFlow::CodeBlock(CodeBlock {
        origin: Origin::new(node, false)?,
        setup: node.list_field("body").flatten().collect(),
        render,
    }))
}

fn lower_if<'t>(node: Node<'t>) -> Result<ControlFlow<'t>, SemanticError> {
    let mut raw_branches = Vec::new();
    let mut current = node;
    let raw_fallback;
    loop {
        let test = current
            .node_field("test")
            .ok_or_else(|| SemanticError::new("TSRX @if is missing its condition", node))?;
        let body_node = current
            .node_field("consequent")
            .ok_or_else(|| SemanticError::new("TSRX @if is missing its consequent block", node))?;
        raw_branches.push((test, body_node));
        match current.node_field("alternate") {
            Some(alternate) if matches!(alternate.ty(), "IfStatement" | "JSXIfExpression") => {
                current = alternate;
            }
            alternate => {
                raw_fallback = alternate;
                break;
            }
        }
    }
    // Match the established frontend's diagnostic order: the fallback is
    // validated before the authored @if branches.
    let fallback = raw_fallback
        .map(|fallback| TemplateBlock::new(fallback, "@else"))
        .transpose()?;
    let branches = raw_branches
        .into_iter()
        .map(|(test, body)| {
            Ok(IfBranch {
                test,
                body: TemplateBlock::new(body, "@if")?,
            })
        })
        .collect::<Result<_, SemanticError>>()?;
    Ok(ControlFlow::If(IfChain {
        origin: Origin::new(node, true)?,
        branches,
        fallback,
    }))
}

fn lower_for<'t>(node: Node<'t>) -> Result<ControlFlow<'t>, SemanticError> {
    if node.str_field("statementType") != Some("ForOfStatement") {
        return Err(SemanticError::new(
            "@for must iterate with for...of; for...in and classic for loops are not TSRX template constructs",
            node,
        ));
    }
    if node.bool_field("await") {
        return Err(SemanticError::new(
            "`for await` is not supported inside Solid TSRX templates",
            node,
        ));
    }
    let pattern = tape::for_binding_pattern(node)
        .ok_or_else(|| SemanticError::new("TSRX @for is missing its binding", node))?;
    let iterable = required_node(node, "right", "TSRX @for is missing its iterable")?;
    let index = node.node_field("index");
    let key = node.node_field("key");
    let body = TemplateBlock::new(
        required_node(node, "body", "TSRX @for is missing its body")?,
        "@for",
    )?;
    let empty = node
        .node_field("empty")
        .map(|empty| TemplateBlock::new(empty, "@empty"))
        .transpose()?;
    Ok(ControlFlow::For(ForLoop {
        origin: Origin::new(node, true)?,
        pattern,
        iterable,
        index,
        key,
        body,
        empty,
        callback_mode: ForCallbackMode::from_clauses(index.is_some(), key.is_some()),
    }))
}

fn lower_switch<'t>(node: Node<'t>) -> Result<ControlFlow<'t>, SemanticError> {
    let discriminant = required_node(
        node,
        "discriminant",
        "TSRX @switch is missing its discriminant",
    )?;
    let mut arms = Vec::new();
    for case in node.list_field("cases").flatten() {
        let origin = Origin::new(case, false)?;
        let entries = case_entries(case);
        arms.push(match case.node_field("test") {
            Some(test) => SwitchArm::Case {
                origin,
                test,
                block: TemplateBlock::from_entries(case, entries, "@case")?,
            },
            None => SwitchArm::Default {
                origin,
                block: TemplateBlock::from_entries(case, entries, "@default")?,
            },
        });
    }
    Ok(ControlFlow::Switch(Switch {
        origin: Origin::new(node, true)?,
        discriminant,
        arms,
    }))
}

fn lower_try<'t>(node: Node<'t>) -> Result<ControlFlow<'t>, SemanticError> {
    if let Some(finalizer) = node.node_field("finalizer") {
        return Err(SemanticError::new(
            "@finally is not part of the TSRX template grammar",
            finalizer,
        ));
    }
    let body = TemplateBlock::new(
        required_node(node, "block", "TSRX @try is missing its block")?,
        "@try",
    )?;
    let pending = node
        .node_field("pending")
        .map(|pending| TemplateBlock::new(pending, "@pending"))
        .transpose()?;
    let catch = node
        .node_field("handler")
        .map(|handler| {
            let binding = handler
                .node_field("param")
                .map(|param| match param.ty() {
                    "Identifier" => Ok(CatchBinding::Identifier {
                        name: param.str_field("name").unwrap_or(""),
                    }),
                    "ObjectPattern" | "ArrayPattern" => Ok(CatchBinding::Pattern(param)),
                    _ => Err(SemanticError::new(
                        "The @catch error binding must be an identifier, object pattern, or array pattern",
                        param,
                    )),
                })
                .transpose()?;
            let catch_body = required_node(
                handler,
                "body",
                "TSRX @catch is missing its block",
            )?;
            Ok(TryCatch {
                origin: Origin::new(handler, false)?,
                binding,
                reset: handler.node_field("resetParam"),
                body: TemplateBlock::new(catch_body, "@catch")?,
            })
        })
        .transpose()?;
    Ok(ControlFlow::Try(Try {
        origin: Origin::new(node, true)?,
        body,
        pending,
        catch,
    }))
}

fn lower_lazy_patterns<'t>(
    mut authored: Vec<Node<'t>>,
    controls: &[ControlFlow<'t>],
) -> Result<(Vec<LazyPattern<'t>>, HashMap<RecordIndex, usize>), SemanticError> {
    authored.sort_by_key(|node| {
        let (start, end) = node.span().unwrap_or((u32::MAX, 0));
        (start, std::cmp::Reverse(end))
    });
    let mut patterns = HashMap::<RecordIndex, LazyPattern<'t>>::new();
    let mut containing_end = 0;
    for node in authored {
        let span = AuthoredSpan::of(node)?;
        if span.start < containing_end {
            continue;
        }
        containing_end = span.end;
        patterns.insert(
            node.object(),
            LazyPattern {
                origin: Origin::new(node, false)?,
                source_accessor: false,
            },
        );
    }
    for control in controls {
        let pattern = match control {
            ControlFlow::For(loop_)
                if loop_.callback_mode.item_is_accessor() && loop_.pattern.ty() != "Identifier" =>
            {
                Some(loop_.pattern)
            }
            ControlFlow::Try(try_) => try_.catch.as_ref().and_then(|catch| match catch.binding {
                Some(CatchBinding::Pattern(pattern)) => Some(pattern),
                _ => None,
            }),
            _ => None,
        };
        if let Some(pattern) = pattern {
            match patterns.get_mut(&pattern.object()) {
                Some(site) => site.source_accessor = true,
                None => {
                    patterns.insert(
                        pattern.object(),
                        LazyPattern {
                            origin: Origin::new(pattern, false)?,
                            source_accessor: true,
                        },
                    );
                }
            }
        }
    }
    let mut patterns = patterns.into_values().collect::<Vec<_>>();
    patterns.sort_by_key(|pattern| pattern.origin.span);
    let mut outer_end = 0;
    patterns.retain(|pattern| {
        if pattern.origin.span.start < outer_end {
            return false;
        }
        outer_end = pattern.origin.span.end;
        true
    });
    let index = patterns
        .iter()
        .enumerate()
        .map(|(index, pattern)| (pattern.origin.tape.object(), index))
        .collect();
    Ok((patterns, index))
}

fn is_authored_lazy_pattern(node: Node<'_>) -> bool {
    matches!(node.ty(), "ArrayPattern" | "ObjectPattern") && node.bool_field("lazy")
}

fn lazy_assignment_parts(node: Node<'_>) -> Option<(Node<'_>, Node<'_>)> {
    if node.ty() != "ExpressionStatement" {
        return None;
    }
    let expression = node.node_field("expression")?;
    if expression.ty() != "AssignmentExpression" || expression.str_field("operator") != Some("=") {
        return None;
    }
    let pattern = expression
        .node_field("left")
        .filter(|pattern| is_authored_lazy_pattern(*pattern))?;
    Some((pattern, expression.node_field("right")?))
}

fn is_exported_lazy_declaration(node: Node<'_>) -> bool {
    matches!(
        node.ty(),
        "ExportNamedDeclaration" | "ExportDefaultDeclaration"
    ) && node
        .node_field("declaration")
        .filter(|declaration| declaration.ty() == "VariableDeclaration")
        .is_some_and(|declaration| {
            declaration
                .list_field("declarations")
                .flatten()
                .filter_map(|declarator| declarator.node_field("id"))
                .any(contains_authored_lazy_pattern)
        })
}

fn contains_authored_lazy_pattern(node: Node<'_>) -> bool {
    let mut found = false;
    tape::walk(node, &mut |child| {
        if is_authored_lazy_pattern(child) {
            found = true;
            return false;
        }
        true
    });
    found
}

fn partition_entries<'t>(
    entries: &[Node<'t>],
) -> Result<(Vec<Node<'t>>, Vec<Node<'t>>), SemanticError> {
    let mut setup = Vec::new();
    let mut renders = Vec::new();
    for entry in entries {
        if RENDER_ENTRY_TYPES.contains(&entry.ty()) {
            if entry.ty() == "JSXText" && entry.str_field("value").is_some_and(decode_json_ws_only)
            {
                continue;
            }
            renders.push(*entry);
        } else {
            if !renders.is_empty() {
                return Err(SemanticError::new(
                    "Statements may not follow the rendered output inside a TSRX template block",
                    *entry,
                ));
            }
            setup.push(*entry);
        }
    }
    Ok((setup, renders))
}

fn partition_entries_unchecked<'t>(entries: &[Node<'t>]) -> (Vec<Node<'t>>, Vec<Node<'t>>) {
    let mut setup = Vec::new();
    let mut renders = Vec::new();
    for entry in entries {
        if RENDER_ENTRY_TYPES.contains(&entry.ty()) {
            if entry.ty() == "JSXText" && entry.str_field("value").is_some_and(decode_json_ws_only)
            {
                continue;
            }
            renders.push(*entry);
        } else {
            setup.push(*entry);
        }
    }
    (setup, renders)
}

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

fn escape_message(kind: &str, construct: &str) -> String {
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

fn validate_no_control_flow_escape(
    entries: &[Node<'_>],
    construct: &str,
) -> Result<(), SemanticError> {
    let mut labels = Vec::new();
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
    ) -> Result<(), SemanticError> {
        let ty = node.ty();
        if FUNCTION_TYPES.contains(&ty) || ESCAPE_BOUNDARY_TYPES.contains(&ty) {
            return Ok(());
        }
        match ty {
            "ReturnStatement" => {
                return Err(SemanticError::new(
                    escape_message("return", construct),
                    node,
                ));
            }
            "BreakStatement" => {
                let label = node.node_field("label").and_then(identifier_name);
                let escapes = match label {
                    Some(label) => !labels.iter().any(|known| known == label),
                    None => breakables == 0,
                };
                if escapes {
                    return Err(SemanticError::new(escape_message("break", construct), node));
                }
                return Ok(());
            }
            "ContinueStatement" => {
                let label = node.node_field("label").and_then(identifier_name);
                let escapes = match label {
                    Some(label) => !labels.iter().any(|known| known == label),
                    None => loops == 0,
                };
                if escapes {
                    return Err(SemanticError::new(
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
                    .and_then(identifier_name)
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
            false
        });
        result
    }
}

fn identifier_name(node: Node<'_>) -> Option<&str> {
    matches!(node.ty(), "Identifier" | "JSXIdentifier")
        .then(|| node.str_field("name"))
        .flatten()
}

fn required_node<'t>(
    node: Node<'t>,
    field: &str,
    message: &str,
) -> Result<Node<'t>, SemanticError> {
    node.node_field(field)
        .ok_or_else(|| SemanticError::new(message, node))
}

fn case_entries<'t>(case: Node<'t>) -> Vec<Node<'t>> {
    let consequent: Vec<Node<'t>> = case.list_field("consequent").flatten().collect();
    if consequent.len() == 1 && consequent[0].ty() == "BlockStatement" {
        consequent[0].list_field("body").flatten().collect()
    } else {
        consequent
    }
}

fn construct_extent(node: Node<'_>, span: AuthoredSpan) -> AuthoredSpan {
    let mut end = span.end;
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
    AuthoredSpan {
        start: span.start,
        end,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tsrx_parser_engine::TsrxParseOptions;
    use tsrx_tape_schema::{CoordinateDomain, ValueRef};

    fn parse(source: &str) -> tsrx_tape_schema::FlatTape {
        let result = crate::tsrx::parse_source(
            source,
            TsrxParseOptions {
                filename: "semantic.tsrx",
                include_ts_fields: true,
                ..TsrxParseOptions::default()
            },
        )
        .expect("parse TSRX");
        let domain = result.coordinate_domain;
        let mut tape = result.program.expect("complete tape");
        if domain == CoordinateDomain::OriginalUtf16Units {
            crate::tsrx::rebase_utf16_spans(source, &mut tape).expect("rebase UTF-16 spans");
        }
        tape
    }

    fn at<'t>(module: &'t SolidTsrxModule<'t>, source: &str, needle: &str) -> &'t ControlFlow<'t> {
        let start = source.find(needle).expect("needle") as u32;
        module
            .control_flow
            .iter()
            .find(|control| control.origin().span.start == start)
            .expect("control at authored offset")
    }

    #[test]
    fn lowers_statement_container_shape() {
        let source = "export function C() @{\n  const value = 1;\n  <p>{value}</p>\n}";
        let tape = parse(source);
        let module = lower(Node::root(&tape).unwrap()).expect("semantic IR");
        let ControlFlow::CodeBlock(block) = at(&module, source, "@{") else {
            panic!("expected statement container");
        };
        assert_eq!(block.setup.len(), 1);
        assert_eq!(block.setup[0].ty(), "VariableDeclaration");
        assert_eq!(block.render.ty(), "JSXElement");
        assert_eq!(block.origin.span.start, source.find("@{").unwrap() as u32);
    }

    #[test]
    fn records_only_consumed_raw_text_and_embedded_regions() {
        let source = "export function C() @{\n\
            <><style>.item { color: red; }</style><script>{\"ok\":true}</script></>\n\
        }";
        let tape = parse(source);
        let module = lower(Node::root(&tape).unwrap()).expect("semantic IR");
        let script = module
            .template_sites
            .iter()
            .find_map(|site| match site {
                TemplateSite::RawTextScript(script) => Some(script),
                _ => None,
            })
            .expect("raw script");
        assert_eq!(
            &source[script.payload.start as usize..script.payload.end as usize],
            "{\"ok\":true}"
        );
        assert_eq!(
            module
                .raw_text_script_for(script.origin.tape)
                .map(|script| script.payload),
            Some(script.payload)
        );
        assert_eq!(
            module
                .embedded_regions
                .iter()
                .map(|region| region.kind)
                .collect::<Vec<_>>(),
            [EmbeddedKind::Css, EmbeddedKind::Script]
        );
    }

    #[test]
    fn owns_template_and_lazy_site_semantics() {
        let source = "export function C({ Tag, rows, model }) @{\n\
            const &{ title } = model;\n\
            &{ current } = model;\n\
            <>\n\
              <style>.item { color: red; }</style>\n\
              <{Tag} /><div {title} />\n\
              @for (const { name } of rows; index index) { <p>{name}:{index}</p> }\n\
              @try { <Broken /> } @catch ({ message }) { <p>{message}</p> }\n\
            </>\n\
        }";
        let tape = parse(source);
        let module = lower(Node::root(&tape).unwrap()).expect("semantic IR");

        assert_eq!(
            module
                .template_sites
                .iter()
                .filter(|site| matches!(site, TemplateSite::StyleElement { .. }))
                .count(),
            1
        );
        assert_eq!(
            module
                .template_sites
                .iter()
                .filter(|site| matches!(site, TemplateSite::DynamicElement { .. }))
                .count(),
            1
        );
        assert_eq!(
            module
                .template_sites
                .iter()
                .filter(|site| matches!(site, TemplateSite::ShorthandAttribute { .. }))
                .count(),
            1
        );
        assert_eq!(module.lazy_assignments.len(), 1);
        assert_eq!(module.lazy_patterns.len(), 4);
        assert_eq!(
            module
                .lazy_patterns
                .iter()
                .filter(|pattern| pattern.source_accessor)
                .count(),
            2
        );
        for pattern in &module.lazy_patterns {
            assert_eq!(
                module
                    .lazy_pattern_for(pattern.origin.tape)
                    .map(|indexed| indexed.origin.span),
                Some(pattern.origin.span)
            );
        }
    }

    #[test]
    fn lowers_if_chain_and_fallback() {
        let source = "export const C = ({ a, b }) => @if (a) { <A /> } @else if (b) { <B /> } @else { <C /> };";
        let tape = parse(source);
        let module = lower(Node::root(&tape).unwrap()).expect("semantic IR");
        let ControlFlow::If(chain) = at(&module, source, "@if") else {
            panic!("expected if chain");
        };
        assert_eq!(
            module
                .control_flow
                .iter()
                .filter(|control| matches!(control, ControlFlow::If(_)))
                .count(),
            1
        );
        assert_eq!(chain.branches.len(), 2);
        assert!(chain.fallback.is_some());
        assert_eq!(chain.origin.span.start, source.find("@if").unwrap() as u32);
        assert_eq!(
            chain.origin.extent.end,
            source.rfind('}').unwrap() as u32 + 1
        );
    }

    #[test]
    fn computes_for_callback_mode_matrix() {
        let source = "export function C({ xs }) @{\n\
            <div>\n\
            @for (const a of xs) { <A /> }\n\
            @for (const b of xs; index i) { <B /> }\n\
            @for (const c of xs; key c.id) { <C /> }\n\
            @for (const d of xs; index j; key d.id) { <D /> }\n\
            </div>\n\
        }";
        let tape = parse(source);
        let module = lower(Node::root(&tape).unwrap()).expect("semantic IR");
        let modes: Vec<_> = module
            .control_flow
            .iter()
            .filter_map(|control| match control {
                ControlFlow::For(loop_) => Some(loop_.callback_mode),
                _ => None,
            })
            .collect();
        assert_eq!(
            modes,
            [
                ForCallbackMode::Default,
                ForCallbackMode::Indexed,
                ForCallbackMode::Keyed,
                ForCallbackMode::KeyedIndexed,
            ]
        );
        assert!(!modes[0].item_is_accessor());
        assert!(modes[1].emits_non_keyed_intent());
        assert!(!modes[1].index_is_accessor());
        assert!(modes[3].index_is_accessor());
    }

    #[test]
    fn lowers_switch_default_and_try_clauses() {
        let source = "export function C({ x }) @{\n\
            <>\n\
            @switch (x) { @case 1: { <A /> } @default: { <B /> } }\n\
            @try { <Main /> } @pending { <Wait /> } @catch (error, reset) { <Fail /> }\n\
            </>\n\
        }";
        let tape = parse(source);
        let module = lower(Node::root(&tape).unwrap()).expect("semantic IR");
        let ControlFlow::Switch(switch) = at(&module, source, "@switch") else {
            panic!("expected switch");
        };
        assert_eq!(switch.arms.len(), 2);
        assert!(switch.default_arm().is_some());
        let ControlFlow::Try(try_) = at(&module, source, "@try") else {
            panic!("expected try");
        };
        assert!(try_.pending.is_some());
        let catch = try_.catch.as_ref().expect("catch");
        assert!(matches!(
            catch.binding,
            Some(CatchBinding::Identifier { name: "error", .. })
        ));
        assert_eq!(
            catch.reset.and_then(|node| node.str_field("name")),
            Some("reset")
        );
    }

    #[test]
    fn preserves_utf8_authored_spans_after_utf16_rebase() {
        let source = "const marker = \"🚀\";\nexport const C = ({ ok }) => @if (ok) { <A /> };";
        let tape = parse(source);
        let module = lower(Node::root(&tape).unwrap()).expect("semantic IR");
        let control = at(&module, source, "@if");
        assert_eq!(
            control.origin().span.start,
            source.find("@if").unwrap() as u32
        );
        assert_eq!(
            &source[control.origin().span.start as usize..control.origin().span.end as usize],
            "@if (ok) { <A /> }"
        );
    }

    #[test]
    fn rejects_missing_required_fields_at_the_construct_origin() {
        let source = "export const C = ({ ok }) => @if (ok) { <A /> };";
        let mut tape = parse(source);
        let mut target = None;
        tape::walk(Node::root(&tape).unwrap(), &mut |node| {
            if node.ty() == "JSXIfExpression" {
                target = Some(node.object());
                return false;
            }
            true
        });
        let object = target.expect("if record");
        let field = tape.field_index(object, "test").expect("test field");
        tape.set_field_value(field, ValueRef::MISSING)
            .expect("remove test");
        let error = match lower(Node::root(&tape).unwrap()) {
            Ok(_) => panic!("malformed IR must fail"),
            Err(error) => error,
        };
        assert_eq!(error.message, "TSRX @if is missing its condition");
        assert_eq!(error.start, source.find("@if").unwrap() as u32);
    }
}
