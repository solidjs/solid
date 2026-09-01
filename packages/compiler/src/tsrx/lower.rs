//! Direct lowering from compiler-owned TSRX semantics to Oxc AST.

use std::collections::{HashMap, HashSet};

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, AssignmentTarget, Expression, FormalParameterKind, FunctionBody, JSXAttributeItem,
    JSXAttributeName, JSXAttributeValue, JSXChild, JSXElement, JSXElementName, Program,
    PropertyKey, PropertyKind, Statement, TemplateElementValue, VariableDeclarationKind,
};
use oxc_ast_visit::{Visit, VisitMut, walk, walk_mut};
use oxc_span::{GetSpan, GetSpanMut, Span};
use oxc_syntax::operator::{AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator};
use tsrx_syntax::ControlContext;

use super::{
    leaf::LeafProgram,
    semantic::{
        AuthoredSpan, CatchBinding, CodeBlock, ControlFlow, ForLoop, IfChain, SolidTsrxModule,
        TemplateBlock, TemplateSite, Try as SemanticTry,
    },
    style::ClassMapEntry,
    style_projection::{
        RefSetup, StyleAction, StyleProjection, decode_json_string, is_callback_ref,
        is_direct_ref_target,
    },
    tape::Node,
};
use crate::{error::CompileError, shared::ast_builder::AstBuilder};

pub(crate) struct DirectLowered<'a> {
    pub program: Program<'a>,
    pub artifacts: super::rewrite::RewriteArtifacts,
    pub css: String,
    pub css_hash: Option<String>,
}

pub(super) fn lower<'a>(
    allocator: &'a Allocator,
    source: &str,
    semantic: &SolidTsrxModule<'_>,
    styles: &StyleProjection<'_>,
) -> Result<DirectLowered<'a>, CompileError> {
    if !is_supported(semantic, styles) {
        return Err(direct_invariant(
            "semantic control-flow validation admitted an unsupported block",
        ));
    }
    if semantic.lazy_patterns.iter().any(|pattern| {
        semantic.is_authored_lazy_pattern(pattern.origin.tape)
            && pattern
                .origin
                .span
                .start
                .checked_sub(1)
                .and_then(|start| source.as_bytes().get(start as usize))
                != Some(&b'&')
    }) {
        return Err(CompileError::parse(
            "Unexpected token in lazy binding pattern",
        ));
    }
    let mut leaves = LeafProgram::parse(allocator, source)?;
    let Some(style_owner_setups) =
        build_style_owner_setups(allocator, AstBuilder::new(allocator), &leaves, styles)
    else {
        return Err(direct_invariant(
            "a scoped style ref target could not be loaded",
        ));
    };
    let controls = semantic
        .control_flow
        .iter()
        .filter(|control| !matches!(control, ControlFlow::CodeBlock(_)))
        .collect::<Vec<_>>();
    if leaves.control_contexts().len() != controls.len() {
        return Err(direct_invariant(
            "parser and semantic control-flow counts do not match",
        ));
    }

    let mut lazy_assignments = LazyAssignmentScaffoldNormalizer {
        map: &leaves.map,
        patterns: semantic
            .lazy_assignments
            .iter()
            .filter_map(|assignment| {
                assignment
                    .pattern
                    .span()
                    .map(|(start, end)| AuthoredSpan { start, end })
            })
            .collect(),
    };
    lazy_assignments.visit_program(&mut leaves.program);
    if !lazy_assignments.patterns.is_empty() {
        return Err(direct_invariant(
            "a lazy assignment scaffold could not be normalized",
        ));
    }

    let marker_prefix = leaves.marker_prefix().to_string();
    let mut templates = TemplateScaffoldReplacer::new(
        AstBuilder::new(allocator),
        &leaves.map,
        &marker_prefix,
        semantic,
        source,
    );
    templates.visit_program(&mut leaves.program);
    if !templates.complete() {
        return Err(direct_invariant(
            "a template scaffold could not be replaced",
        ));
    }
    let mut style_lowerer =
        StyleScaffoldLowerer::new(AstBuilder::new(allocator), &leaves.map, styles);
    style_lowerer.visit_program(&mut leaves.program);
    if !style_lowerer.complete() {
        return Err(direct_invariant(
            "a scoped style action could not be applied",
        ));
    }

    let mut lowerer = Lowerer {
        allocator,
        ast: AstBuilder::new(allocator),
        semantic,
        leaves: &leaves,
        artifacts: super::rewrite::RewriteArtifacts {
            lazy_patterns: semantic
                .lazy_patterns
                .iter()
                .map(|pattern| {
                    (
                        pattern.origin.span.start,
                        String::new(),
                        pattern.source_accessor,
                    )
                })
                .collect(),
            accessor_arrows: Vec::new(),
        },
    };
    let mut expression_replacements = HashMap::new();
    let mut statement_replacements = HashMap::new();
    for (index, (control, context)) in controls
        .into_iter()
        .zip(leaves.control_contexts())
        .enumerate()
    {
        let expression = lowerer.control(control)?;
        if *context == ControlContext::Statement {
            let Some(anchor) = control_anchor(control) else {
                return Err(direct_invariant(
                    "a statement control-flow construct is missing its anchor",
                ));
            };
            statement_replacements.insert(anchor, expression);
        } else {
            expression_replacements.insert(leaves.wrapper_name(index), expression);
        }
    }
    let mut code_block_replacements = HashMap::new();
    let mut code_block_origins = HashMap::new();
    for control in &semantic.control_flow {
        let ControlFlow::CodeBlock(block) = control else {
            continue;
        };
        let Some(render) = block.render else {
            return Err(direct_invariant(
                "a code block is missing its render expression",
            ));
        };
        let Some((start, _)) = render.span() else {
            return Err(direct_invariant(
                "a code block render expression is missing its authored span",
            ));
        };
        code_block_replacements.insert(start, lowerer.code_block(block)?);
        code_block_origins.insert(start, ast_span(block.origin.span));
    }
    let artifacts = lowerer.artifacts;
    let function_style_owners = code_block_origins
        .iter()
        .map(|(render, origin)| (*render, origin.start))
        .collect();
    leaves.rebase();
    let mut replacer = ScaffoldReplacer {
        ast: AstBuilder::new(allocator),
        expression_replacements,
        statement_replacements,
        code_block_replacements,
    };
    replacer.visit_program(&mut leaves.program);
    let mut scaffold_finder = ParserScaffoldFinder {
        prefix: &marker_prefix,
        found: false,
    };
    scaffold_finder.visit_program(&leaves.program);
    if scaffold_finder.found {
        return Err(direct_invariant(&format!(
            "control-flow parser scaffolds could not be replaced; expressions {:?}, statements {:?}",
            replacer.expression_replacements.keys().collect::<Vec<_>>(),
            replacer.statement_replacements.keys().collect::<Vec<_>>()
        )));
    }
    let dynamic_origins = semantic
        .template_sites
        .iter()
        .filter_map(|site| match site {
            TemplateSite::DynamicElement { origin } => Some(origin.span),
            _ => None,
        })
        .collect::<Vec<_>>();
    DynamicElementAnchorer {
        origins: &dynamic_origins,
    }
    .visit_program(&mut leaves.program);

    let mut code_blocks = replacer
        .code_block_replacements
        .keys()
        .filter_map(|render| {
            code_block_origins
                .get(render)
                .copied()
                .map(|origin| (*render, origin))
        })
        .collect::<HashMap<_, _>>();
    FunctionCodeBlockFinalizer {
        ast: AstBuilder::new(allocator),
        code_blocks: &mut code_blocks,
    }
    .visit_program(&mut leaves.program);
    if !code_blocks.is_empty() {
        return Err(direct_invariant(
            "a function code block could not be finalized",
        ));
    }
    let mut style_owners = StyleOwnerLowerer::new(
        AstBuilder::new(allocator),
        style_owner_setups,
        function_style_owners,
    );
    style_owners.visit_program(&mut leaves.program);
    if !style_owners.complete() {
        return Err(direct_invariant(&format!(
            "scoped style owners could not be located; missing {:?}, observed {:?}",
            style_owners.setups.keys().collect::<Vec<_>>(),
            style_owners.observed
        )));
    }
    AuthoredJsxTextSanitizer { source }.visit_program(&mut leaves.program);
    let mut lazy_patterns = LazyPatternRootAligner {
        expected: semantic
            .lazy_patterns
            .iter()
            .map(|pattern| pattern.origin.span.start)
            .collect(),
    };
    lazy_patterns.visit_program(&mut leaves.program);
    if !lazy_patterns.expected.is_empty() {
        return Err(direct_invariant(&format!(
            "lazy binding patterns could not be aligned; missing {:?}",
            lazy_patterns.expected
        )));
    }
    let authored = allocator.alloc_str(source);
    Ok(DirectLowered {
        program: leaves.finish(authored),
        artifacts,
        css: styles.css.clone(),
        css_hash: styles.css_hash.clone(),
    })
}

fn direct_invariant(message: &str) -> CompileError {
    CompileError::transform(format!("TSRX direct lowering invariant failed: {message}"))
}

fn is_supported(semantic: &SolidTsrxModule<'_>, _styles: &StyleProjection<'_>) -> bool {
    semantic.control_flow.iter().all(|control| match control {
        ControlFlow::If(chain) => supported_if(chain),
        ControlFlow::Switch(switch) => switch.arms.iter().all(|arm| supported_block(arm.block())),
        ControlFlow::For(loop_) => {
            supported_block(&loop_.body) && loop_.empty.as_ref().is_none_or(supported_block)
        }
        ControlFlow::Try(try_) => {
            supported_block(&try_.body)
                && try_.pending.as_ref().is_none_or(supported_block)
                && try_
                    .catch
                    .as_ref()
                    .is_none_or(|catch| supported_block(&catch.body))
        }
        ControlFlow::CodeBlock(_) => true,
    })
}

fn supported_if(chain: &IfChain<'_>) -> bool {
    chain
        .branches
        .iter()
        .all(|branch| supported_block(&branch.body))
        && chain.fallback.as_ref().is_none_or(supported_block)
}

fn supported_block(block: &TemplateBlock<'_>) -> bool {
    block.setup.is_empty() || !block.renders.is_empty()
}

struct Lowerer<'a, 's, 't> {
    allocator: &'a Allocator,
    ast: AstBuilder<'a>,
    semantic: &'s SolidTsrxModule<'t>,
    leaves: &'s LeafProgram<'a>,
    artifacts: super::rewrite::RewriteArtifacts,
}

impl<'a> Lowerer<'a, '_, '_> {
    fn control(&mut self, control: &ControlFlow<'_>) -> Result<Expression<'a>, CompileError> {
        match control {
            ControlFlow::CodeBlock(block) => self.code_block(block),
            ControlFlow::If(chain) => self.if_chain(chain),
            ControlFlow::For(loop_) => self.for_loop(loop_),
            ControlFlow::Switch(switch) => self.switch(switch),
            ControlFlow::Try(try_) => self.try_expression(try_),
        }
    }

    fn code_block(&mut self, block: &CodeBlock<'_>) -> Result<Expression<'a>, CompileError> {
        let span = generated_span(block.origin.span);
        let mut statements = self.ast.vec_with_capacity(block.setup.len() + 1);
        for setup in &block.setup {
            statements.push(self.statement(*setup)?);
        }
        let render = block
            .render
            .ok_or_else(|| direct_invariant("a code block is missing its render expression"))
            .and_then(|render| self.render_expression(render))?;
        statements.push(self.ast.statement_return(span, Some(render)));
        let parameters = self.ast.formal_parameters(
            span,
            FormalParameterKind::ArrowFormalParameters,
            self.ast.vec(),
            None,
        );
        let body = self.ast.function_body(span, self.ast.vec(), statements);
        let arrow = self
            .ast
            .expression_arrow_function(span, false, false, None, parameters, None, body);
        Ok(self
            .ast
            .expression_call(span, arrow, None, self.ast.vec(), false))
    }

    fn try_expression(&mut self, try_: &SemanticTry<'_>) -> Result<Expression<'a>, CompileError> {
        let span = generated_span(try_.origin.span);
        let mut inner = self.block_expression(&try_.body)?.ok_or_else(|| {
            CompileError::transform("A TSRX @try block must end with rendered output")
        })?;
        if let Some(pending) = try_.pending.as_ref() {
            let mut attributes = self.ast.vec();
            if let Some(fallback) = self.block_expression(pending)? {
                attributes.push(
                    self.ast
                        .jsx_attribute_item_expression(span, "fallback", fallback),
                );
            }
            let children = self.ast.vec1(self.ast.jsx_child_expression(span, inner));
            inner = self
                .ast
                .expression_jsx_element(span, "Loading", attributes, children);
        }
        if let Some(catch) = try_.catch.as_ref() {
            let fallback = self.block_expression(&catch.body)?.ok_or_else(|| {
                CompileError::transform("A TSRX @catch block must end with rendered output")
            })?;
            let mut patterns = Vec::new();
            let mut accessor_names = Vec::new();
            match &catch.binding {
                Some(CatchBinding::Identifier { name }) => {
                    let parameter =
                        catch.origin.tape.node_field("param").ok_or_else(|| {
                            CompileError::transform("TSRX @catch binding is missing")
                        })?;
                    patterns.push(self.binding_pattern(parameter)?);
                    accessor_names.push((*name).to_string());
                }
                Some(CatchBinding::Pattern(pattern)) => {
                    patterns.push(self.binding_pattern(*pattern)?);
                }
                None => patterns.push(
                    self.ast
                        .binding_pattern_binding_identifier(span, self.ast.ident("_e")),
                ),
            }
            if let Some(reset) = catch.reset {
                patterns.push(self.binding_pattern(reset)?);
            }
            let callback_span = ast_span(catch.origin.span);
            let callback = self.arrow(callback_span, patterns, fallback);
            if !accessor_names.is_empty() {
                self.artifacts
                    .accessor_arrows
                    .push((callback_span.start, accessor_names));
            }
            let attributes = self.ast.vec1(
                self.ast
                    .jsx_attribute_item_expression(span, "fallback", callback),
            );
            let children = self.ast.vec1(self.ast.jsx_child_expression(span, inner));
            inner = self
                .ast
                .expression_jsx_element(span, "Errored", attributes, children);
        }
        Ok(inner)
    }

    fn for_loop(&mut self, loop_: &ForLoop<'_>) -> Result<Expression<'a>, CompileError> {
        let span = generated_span(loop_.origin.span);
        let mut attributes = self.ast.vec();
        attributes.push(self.ast.jsx_attribute_item_expression(
            span,
            "each",
            self.expression(loop_.iterable)?,
        ));
        if let Some(empty) = loop_.empty.as_ref()
            && let Some(expression) = self.block_expression(empty)?
        {
            attributes.push(
                self.ast
                    .jsx_attribute_item_expression(span, "fallback", expression),
            );
        }

        if let Some(key) = loop_.key {
            let key_expression = self.expression(key)?;
            let mut key_callback =
                self.arrow_from_patterns(ast_span_of(key), &[loop_.pattern], key_expression)?;
            if let Expression::ArrowFunctionExpression(callback) = &mut key_callback {
                for parameter in &mut callback.params.items {
                    GeneratedSubtreeUnspanner.visit_binding_pattern(&mut parameter.pattern);
                }
            }
            attributes.push(
                self.ast
                    .jsx_attribute_item_expression(span, "keyed", key_callback),
            );
        } else if loop_.callback_mode.emits_non_keyed_intent() {
            attributes.push(self.ast.jsx_attribute_item_expression(
                span,
                "keyed",
                self.ast.expression_boolean_literal(span, false),
            ));
        }
        let body = self.block_expression(&loop_.body)?.ok_or_else(|| {
            CompileError::transform("A TSRX @for body must end with rendered output")
        })?;
        let mut patterns = vec![loop_.pattern];
        if let Some(index) = loop_.index {
            patterns.push(index);
        }
        let callback = self.arrow_from_patterns(span, &patterns, body)?;
        let mut accessor_names = Vec::new();
        if loop_.callback_mode.item_is_accessor()
            && let Some(name) = identifier_name(loop_.pattern)
        {
            accessor_names.push(name.to_string());
        }
        if loop_.callback_mode.index_is_accessor()
            && let Some(index) = loop_.index
            && let Some(name) = identifier_name(index)
        {
            accessor_names.push(name.to_string());
        }
        if !accessor_names.is_empty() {
            self.artifacts
                .accessor_arrows
                .push((span.start, accessor_names));
        }
        let children = self.ast.vec1(self.ast.jsx_child_expression(span, callback));
        Ok(self
            .ast
            .expression_jsx_element(span, "For", attributes, children))
    }

    fn switch(
        &mut self,
        switch: &super::semantic::Switch<'_>,
    ) -> Result<Expression<'a>, CompileError> {
        let span = generated_span(switch.origin.span);
        let mut attributes = self.ast.vec();
        if let Some(default) = switch.default_arm()
            && let Some(expression) = self.block_expression(default.block())?
        {
            attributes.push(
                self.ast
                    .jsx_attribute_item_expression(span, "fallback", expression),
            );
        }
        let mut children = self.ast.vec();
        for arm in &switch.arms {
            let super::semantic::SwitchArm::Case { test, block, .. } = arm else {
                continue;
            };
            let arm_span = ast_span(block.node_span());
            let condition = self.ast.expression_binary(
                arm_span,
                self.expression(switch.discriminant)?,
                BinaryOperator::StrictEquality,
                self.expression(*test)?,
            );
            let mut match_attributes = self.ast.vec();
            match_attributes.push(
                self.ast
                    .jsx_attribute_item_expression(arm_span, "when", condition),
            );
            let match_children = self.block_children(block)?;
            let match_ = self.ast.expression_jsx_element(
                arm_span,
                "Match",
                match_attributes,
                match_children,
            );
            children.push(self.ast.jsx_child_expression(arm_span, match_));
        }
        Ok(self
            .ast
            .expression_jsx_element(span, "Switch", attributes, children))
    }

    fn if_chain(&mut self, chain: &IfChain<'_>) -> Result<Expression<'a>, CompileError> {
        let span = generated_span(chain.origin.span);
        if let [branch] = chain.branches.as_slice() {
            let mut attributes = self.ast.vec();
            attributes.push(self.ast.jsx_attribute_item_expression(
                span,
                "when",
                self.expression(branch.test)?,
            ));
            if let Some(fallback) = chain.fallback.as_ref()
                && let Some(expression) = self.block_expression(fallback)?
            {
                attributes.push(
                    self.ast
                        .jsx_attribute_item_expression(span, "fallback", expression),
                );
            }
            let children = self.block_children(&branch.body)?;
            return Ok(self
                .ast
                .expression_jsx_element(span, "Show", attributes, children));
        }

        let mut attributes = self.ast.vec();
        if let Some(fallback) = chain.fallback.as_ref()
            && let Some(expression) = self.block_expression(fallback)?
        {
            attributes.push(
                self.ast
                    .jsx_attribute_item_expression(span, "fallback", expression),
            );
        }
        let mut children = self.ast.vec();
        for branch in &chain.branches {
            let branch_span = ast_span(branch.body.node_span());
            let mut match_attributes = self.ast.vec();
            match_attributes.push(self.ast.jsx_attribute_item_expression(
                branch_span,
                "when",
                self.expression(branch.test)?,
            ));
            let match_children = self.block_children(&branch.body)?;
            let match_ = self.ast.expression_jsx_element(
                branch_span,
                "Match",
                match_attributes,
                match_children,
            );
            children.push(self.ast.jsx_child_expression(branch_span, match_));
        }
        Ok(self
            .ast
            .expression_jsx_element(span, "Switch", attributes, children))
    }

    fn block_expression(
        &mut self,
        block: &TemplateBlock<'_>,
    ) -> Result<Option<Expression<'a>>, CompileError> {
        let render = match block.renders.as_slice() {
            [] => Ok(None),
            [only] => self.render_expression(*only).map(Some),
            many => {
                let span = Span::default();
                let mut children = self.ast.vec_with_capacity(many.len());
                for render in many {
                    let expression = self.render_expression(*render)?;
                    children.push(self.ast.jsx_child_expression(Span::default(), expression));
                }
                Ok(Some(self.ast.expression_jsx_fragment(span, children)))
            }
        }?;
        if block.setup.is_empty() {
            return Ok(render);
        }
        let Some(render) = render else {
            return Ok(None);
        };
        let span = Span::default();
        let mut statements = self.ast.vec_with_capacity(block.setup.len() + 1);
        for setup in &block.setup {
            statements.push(self.statement(*setup)?);
        }
        statements.push(self.ast.statement_return(span, Some(render)));
        let parameters = self.ast.formal_parameters(
            span,
            FormalParameterKind::ArrowFormalParameters,
            self.ast.vec(),
            None,
        );
        let body = self.ast.function_body(span, self.ast.vec(), statements);
        let arrow = self
            .ast
            .expression_arrow_function(span, false, false, None, parameters, None, body);
        Ok(Some(self.ast.expression_call(
            span,
            arrow,
            None,
            self.ast.vec(),
            false,
        )))
    }

    fn block_children(
        &mut self,
        block: &TemplateBlock<'_>,
    ) -> Result<oxc_allocator::Vec<'a, JSXChild<'a>>, CompileError> {
        if !block.setup.is_empty() {
            let expression = self.block_expression(block)?.ok_or_else(|| {
                CompileError::transform(
                    "A TSRX control-flow block with setup statements must end with rendered output",
                )
            })?;
            return Ok(self
                .ast
                .vec1(self.ast.jsx_child_expression(Span::default(), expression)));
        }
        let mut children = self.ast.vec_with_capacity(block.renders.len());
        for render in &block.renders {
            let expression = self.render_expression(*render)?;
            children.push(self.ast.jsx_child_expression(Span::default(), expression));
        }
        Ok(children)
    }

    fn entry(&mut self, node: Node<'_>) -> Result<Expression<'a>, CompileError> {
        if let Some(control) = self.semantic.control_for(node) {
            return self.control(control);
        }
        self.expression(node)
    }

    fn render_expression(&mut self, node: Node<'_>) -> Result<Expression<'a>, CompileError> {
        if node.ty() == "JSXText" {
            let value = node
                .str_field("value")
                .and_then(decode_json_string)
                .ok_or_else(|| CompileError::transform("A TSRX JSX text node is invalid"))?;
            return Ok(self.ast.expression_string_literal(
                ast_span_of(node),
                self.ast.str(&value),
                None,
            ));
        }
        self.entry(node)
    }

    fn expression(&self, node: Node<'_>) -> Result<Expression<'a>, CompileError> {
        let authored = node
            .span()
            .map(|(start, end)| AuthoredSpan { start, end })
            .ok_or_else(|| CompileError::transform("TSRX leaf is missing its authored span"))?;
        self.leaves
            .expression(self.allocator, authored)
            .ok_or_else(|| {
                CompileError::transform(format!(
                    "Unable to load authored TSRX expression at {}..{}",
                    authored.start, authored.end
                ))
            })
    }

    fn binding_pattern(
        &self,
        node: Node<'_>,
    ) -> Result<oxc_ast::ast::BindingPattern<'a>, CompileError> {
        let authored = node
            .span()
            .map(|(start, end)| AuthoredSpan { start, end })
            .ok_or_else(|| CompileError::transform("TSRX binding is missing its authored span"))?;
        if let Some(name) = identifier_name(node) {
            return Ok(self
                .ast
                .binding_pattern_binding_identifier(ast_span(authored), self.ast.ident(name)));
        }
        self.leaves
            .binding_pattern(self.allocator, authored)
            .ok_or_else(|| {
                CompileError::transform(format!(
                    "Unable to load authored TSRX binding at {}..{}",
                    authored.start, authored.end
                ))
            })
    }

    fn statement(&self, node: Node<'_>) -> Result<Statement<'a>, CompileError> {
        let authored = node
            .span()
            .map(|(start, end)| AuthoredSpan { start, end })
            .ok_or_else(|| {
                CompileError::transform("TSRX statement is missing its authored span")
            })?;
        self.leaves
            .statement(self.allocator, authored)
            .ok_or_else(|| {
                CompileError::transform(format!(
                    "Unable to load authored TSRX statement at {}..{}",
                    authored.start, authored.end
                ))
            })
    }

    fn arrow_from_patterns(
        &self,
        span: Span,
        patterns: &[Node<'_>],
        expression: Expression<'a>,
    ) -> Result<Expression<'a>, CompileError> {
        let mut bindings = Vec::with_capacity(patterns.len());
        for pattern in patterns {
            bindings.push(self.binding_pattern(*pattern)?);
        }
        Ok(self.arrow(span, bindings, expression))
    }

    fn arrow(
        &self,
        span: Span,
        patterns: Vec<oxc_ast::ast::BindingPattern<'a>>,
        expression: Expression<'a>,
    ) -> Expression<'a> {
        let parameters = self.ast.formal_parameters(
            span,
            FormalParameterKind::ArrowFormalParameters,
            self.ast.vec_from_iter(patterns.into_iter().map(|pattern| {
                self.ast.formal_parameter(
                    span,
                    self.ast.vec(),
                    pattern,
                    None,
                    None,
                    false,
                    None,
                    false,
                    false,
                )
            })),
            None,
        );
        let body = self.ast.function_body(
            span,
            self.ast.vec(),
            self.ast
                .vec1(self.ast.statement_expression(span, expression)),
        );
        self.ast
            .expression_arrow_function(span, true, false, None, parameters, None, body)
    }
}

fn control_anchor(control: &ControlFlow<'_>) -> Option<u32> {
    let node = match control {
        ControlFlow::If(chain) => chain.branches.first()?.test,
        ControlFlow::For(loop_) => loop_.iterable,
        ControlFlow::Switch(switch) => switch.discriminant,
        ControlFlow::Try(try_) => *try_
            .body
            .renders
            .iter()
            .find(|render| render.ty() != "JSXText")?,
        _ => return None,
    };
    node.span().map(|(start, _)| start)
}

trait TemplateBlockSpan {
    fn node_span(&self) -> AuthoredSpan;
}

impl TemplateBlockSpan for TemplateBlock<'_> {
    fn node_span(&self) -> AuthoredSpan {
        let (start, end) = self.node.span().unwrap_or_default();
        AuthoredSpan { start, end }
    }
}

fn ast_span(span: AuthoredSpan) -> Span {
    Span::new(span.start, span.end)
}

fn generated_span(span: AuthoredSpan) -> Span {
    Span::new(span.start, span.start)
}

fn ast_span_of(node: Node<'_>) -> Span {
    node.span()
        .map_or(Span::default(), |(start, end)| Span::new(start, end))
}

fn identifier_name(node: Node<'_>) -> Option<&str> {
    (node.ty() == "Identifier")
        .then(|| node.str_field("name"))
        .flatten()
}

fn build_style_owner_setups<'a>(
    allocator: &'a Allocator,
    ast: AstBuilder<'a>,
    leaves: &LeafProgram<'a>,
    styles: &StyleProjection<'_>,
) -> Option<HashMap<u32, Vec<Statement<'a>>>> {
    let mut owners = HashMap::new();
    for (owner, setups) in &styles.owner_setups {
        let mut statements = Vec::new();
        for setup in setups {
            statements.extend(build_ref_setup(allocator, ast, leaves, setup)?);
        }
        owners.insert(*owner, statements);
    }
    Some(owners)
}

fn build_ref_setup<'a>(
    allocator: &'a Allocator,
    ast: AstBuilder<'a>,
    leaves: &LeafProgram<'a>,
    setup: &RefSetup<'_>,
) -> Option<Vec<Statement<'a>>> {
    let (start, end) = setup.target.span()?;
    let target = leaves.expression(allocator, AuthoredSpan { start, end })?;
    let span = Span::default();
    if is_direct_ref_target(setup.target) {
        let target = match target {
            Expression::Identifier(target) => AssignmentTarget::AssignmentTargetIdentifier(target),
            Expression::ComputedMemberExpression(target) => {
                AssignmentTarget::ComputedMemberExpression(target)
            }
            Expression::StaticMemberExpression(target) => {
                AssignmentTarget::StaticMemberExpression(target)
            }
            Expression::PrivateFieldExpression(target) => {
                AssignmentTarget::PrivateFieldExpression(target)
            }
            _ => return None,
        };
        let value = style_class_map(ast, &setup.class_map);
        return Some(vec![ast.statement_expression(
            span,
            ast.expression_assignment(span, AssignmentOperator::Assign, target, value),
        )]);
    }
    if is_callback_ref(setup.target) {
        let value = style_class_map(ast, &setup.class_map);
        return Some(vec![ast.statement_expression(
            span,
            ast.expression_call(span, target, None, ast.vec1(Argument::from(value)), false),
        )]);
    }

    let temp = setup.temp_name.as_deref()?;
    let declaration = Statement::VariableDeclaration(ast.alloc_variable_declaration(
        span,
        VariableDeclarationKind::Let,
        ast.vec1(ast.variable_declarator(
            span,
            VariableDeclarationKind::Let,
            ast.binding_pattern_binding_identifier(span, ast.str(temp)),
            None,
            Some(target),
            false,
        )),
        false,
    ));
    let function_test = ast.expression_binary(
        span,
        ast.expression_unary(
            span,
            UnaryOperator::Typeof,
            ast.expression_identifier(span, ast.str(temp)),
        ),
        BinaryOperator::StrictEquality,
        ast.expression_string_literal(span, "function", None),
    );
    let call = ast.statement_expression(
        span,
        ast.expression_call(
            span,
            ast.expression_identifier(span, ast.str(temp)),
            None,
            ast.vec1(Argument::from(style_class_map(ast, &setup.class_map))),
            false,
        ),
    );
    let object_test = ast.expression_logical(
        span,
        ast.expression_identifier(span, ast.str(temp)),
        LogicalOperator::And,
        ast.expression_binary(
            span,
            ast.expression_unary(
                span,
                UnaryOperator::Typeof,
                ast.expression_identifier(span, ast.str(temp)),
            ),
            BinaryOperator::StrictEquality,
            ast.expression_string_literal(span, "object", None),
        ),
    );
    let current_test = ast.expression_binary(
        span,
        ast.expression_string_literal(span, "current", None),
        BinaryOperator::In,
        ast.expression_identifier(span, ast.str(temp)),
    );
    let current_assignment = style_ref_member_assignment(ast, span, temp, "current", setup);
    let value_test = ast.expression_binary(
        span,
        ast.expression_string_literal(span, "value", None),
        BinaryOperator::In,
        ast.expression_identifier(span, ast.str(temp)),
    );
    let value_assignment = style_ref_member_assignment(ast, span, temp, "value", setup);
    let object_body = ast.statement_block(
        span,
        ast.vec1(ast.statement_if(
            span,
            current_test,
            current_assignment,
            Some(ast.statement_if(span, value_test, value_assignment, None)),
        )),
    );
    Some(vec![
        declaration,
        ast.statement_if(
            span,
            function_test,
            ast.statement_block(span, ast.vec1(call)),
            Some(ast.statement_if(span, object_test, object_body, None)),
        ),
    ])
}

fn style_ref_member_assignment<'a>(
    ast: AstBuilder<'a>,
    span: Span,
    temp: &str,
    property: &str,
    setup: &RefSetup<'_>,
) -> Statement<'a> {
    let target = AssignmentTarget::StaticMemberExpression(ast.alloc_static_member_expression(
        span,
        ast.expression_identifier(span, ast.str(temp)),
        ast.identifier_name(span, ast.str(property)),
        false,
    ));
    ast.statement_expression(
        span,
        ast.expression_assignment(
            span,
            AssignmentOperator::Assign,
            target,
            style_class_map(ast, &setup.class_map),
        ),
    )
}

fn style_class_map<'a>(ast: AstBuilder<'a>, entries: &[ClassMapEntry]) -> Expression<'a> {
    let properties = ast.vec_from_iter(entries.iter().map(|entry| {
        let span = Span::default();
        ast.object_property_kind_object_property(
            span,
            PropertyKind::Init,
            PropertyKey::StringLiteral(ast.alloc_string_literal(
                span,
                ast.str(&entry.class_name),
                None,
            )),
            ast.expression_string_literal(span, ast.str(&entry.value), None),
            false,
            false,
            false,
        )
    }));
    ast.expression_object(Span::default(), properties)
}

struct StyleOwnerLowerer<'a> {
    ast: AstBuilder<'a>,
    setups: HashMap<u32, Vec<Statement<'a>>>,
    function_owners: HashMap<u32, u32>,
    observed: Vec<u32>,
}

impl<'a> StyleOwnerLowerer<'a> {
    fn new(
        ast: AstBuilder<'a>,
        setups: HashMap<u32, Vec<Statement<'a>>>,
        function_owners: HashMap<u32, u32>,
    ) -> Self {
        Self {
            ast,
            setups,
            function_owners,
            observed: Vec::new(),
        }
    }

    fn complete(&self) -> bool {
        self.setups.is_empty()
    }

    fn take(&mut self, start: u32) -> Option<Vec<Statement<'a>>> {
        if let Some(setups) = self.setups.remove(&start) {
            return Some(setups);
        }
        let owner = self
            .setups
            .keys()
            .copied()
            .filter(|owner| owner.abs_diff(start) <= 2)
            .min_by_key(|owner| owner.abs_diff(start))?;
        self.setups.remove(&owner)
    }

    fn wrap(
        &self,
        span: Span,
        expression: Expression<'a>,
        setups: Vec<Statement<'a>>,
    ) -> Expression<'a> {
        let mut statements = self.ast.vec_from_iter(setups);
        statements.push(self.ast.statement_return(span, Some(expression)));
        let parameters = self.ast.formal_parameters(
            span,
            FormalParameterKind::ArrowFormalParameters,
            self.ast.vec(),
            None,
        );
        let body = self.ast.function_body(span, self.ast.vec(), statements);
        let arrow = self
            .ast
            .expression_arrow_function(span, false, false, None, parameters, None, body);
        self.ast
            .expression_call(span, arrow, None, self.ast.vec(), false)
    }
}

impl<'a> VisitMut<'a> for StyleOwnerLowerer<'a> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        let start = match expression {
            Expression::JSXElement(element) => Some(jsx_element_start(element)),
            Expression::JSXFragment(fragment) => Some(jsx_fragment_start(fragment)),
            _ => None,
        };
        self.observed.extend(start);
        if let Some(setups) = start.and_then(|start| self.take(start)) {
            let span = expression.span();
            let owned = std::mem::replace(
                expression,
                self.ast.expression_null_literal(Span::default()),
            );
            *expression = self.wrap(span, owned, setups);
        }
        walk_mut::walk_expression(self, expression);
    }

    fn visit_jsx_children(&mut self, children: &mut oxc_allocator::Vec<'a, JSXChild<'a>>) {
        let old = std::mem::replace(children, self.ast.vec());
        for child in old {
            let start = match &child {
                JSXChild::Element(element) => Some(jsx_element_start(element)),
                JSXChild::Fragment(fragment) => Some(jsx_fragment_start(fragment)),
                _ => None,
            };
            self.observed.extend(start);
            if let Some(setups) = start.and_then(|start| self.take(start)) {
                let span = child.span();
                let expression = match child {
                    JSXChild::Element(element) => Expression::JSXElement(element),
                    JSXChild::Fragment(fragment) => Expression::JSXFragment(fragment),
                    _ => unreachable!("only JSX owners are wrapped"),
                };
                children.push(
                    self.ast
                        .jsx_child_expression(span, self.wrap(span, expression, setups)),
                );
            } else {
                children.push(child);
            }
        }
        walk_mut::walk_jsx_children(self, children);
    }

    fn visit_function_body(&mut self, body: &mut FunctionBody<'a>) {
        self.observed.push(body.span.start);
        let direct = self.take(body.span.start);
        let function_owner = body
            .statements
            .last()
            .and_then(|statement| match statement {
                Statement::ReturnStatement(statement) => statement.argument.as_ref(),
                _ => None,
            })
            .map(|expression| match expression {
                Expression::JSXElement(element) => jsx_element_start(element),
                Expression::JSXFragment(fragment) => jsx_fragment_start(fragment),
                expression => first_authored_start(expression).unwrap_or(expression.span().start),
            })
            .and_then(|render| self.function_owners.get(&render).copied())
            .and_then(|owner| self.setups.remove(&owner));
        if let Some(setups) = direct.or(function_owner) {
            let insert_at = body.statements.len().saturating_sub(1);
            for (offset, setup) in setups.into_iter().enumerate() {
                body.statements.insert(insert_at + offset, setup);
            }
        }
        walk_mut::walk_function_body(self, body);
    }
}

struct LazyPatternRootAligner {
    expected: HashSet<u32>,
}

impl LazyPatternRootAligner {
    fn align(&mut self, pattern: &mut oxc_ast::ast::BindingPattern<'_>, owner: Span) {
        if !matches!(
            pattern,
            oxc_ast::ast::BindingPattern::ObjectPattern(_)
                | oxc_ast::ast::BindingPattern::ArrayPattern(_)
        ) {
            return;
        }
        let pattern_start = if pattern.span() == Span::default() {
            let mut finder = AuthoredStartFinder { start: None };
            finder.visit_binding_pattern(pattern);
            finder.start.unwrap_or_default()
        } else {
            pattern.span().start
        };
        let expected = self.expected.iter().copied().find(|expected| {
            (owner.start <= *expected && *expected <= owner.end)
                || expected.abs_diff(pattern_start) <= 2
        });
        if let Some(expected) = expected {
            self.expected.remove(&expected);
            pattern.span_mut().start = expected;
        }
    }
}

impl<'a> VisitMut<'a> for LazyPatternRootAligner {
    fn visit_function(
        &mut self,
        function: &mut oxc_ast::ast::Function<'a>,
        flags: oxc_syntax::scope::ScopeFlags,
    ) {
        for parameter in &mut function.params.items {
            self.align(&mut parameter.pattern, parameter.span);
        }
        walk_mut::walk_function(self, function, flags);
    }

    fn visit_arrow_function_expression(
        &mut self,
        arrow: &mut oxc_ast::ast::ArrowFunctionExpression<'a>,
    ) {
        for parameter in &mut arrow.params.items {
            self.align(&mut parameter.pattern, parameter.span);
        }
        walk_mut::walk_arrow_function_expression(self, arrow);
    }

    fn visit_formal_parameter(&mut self, parameter: &mut oxc_ast::ast::FormalParameter<'a>) {
        self.align(&mut parameter.pattern, parameter.span);
        walk_mut::walk_formal_parameter(self, parameter);
    }

    fn visit_variable_declarator(&mut self, declarator: &mut oxc_ast::ast::VariableDeclarator<'a>) {
        self.align(&mut declarator.id, declarator.span);
        walk_mut::walk_variable_declarator(self, declarator);
    }

    fn visit_catch_parameter(&mut self, parameter: &mut oxc_ast::ast::CatchParameter<'a>) {
        self.align(&mut parameter.pattern, parameter.span);
        walk_mut::walk_catch_parameter(self, parameter);
    }
}

struct AuthoredJsxTextSanitizer<'s> {
    source: &'s str,
}

struct GeneratedSubtreeUnspanner;

impl<'a> VisitMut<'a> for GeneratedSubtreeUnspanner {
    fn visit_span(&mut self, span: &mut Span) {
        *span = Span::default();
        walk_mut::walk_span(self, span);
    }
}

impl<'a> VisitMut<'a> for AuthoredJsxTextSanitizer<'_> {
    fn visit_jsx_text(&mut self, text: &mut oxc_ast::ast::JSXText<'a>) {
        let authored = self
            .source
            .get(text.span.start as usize..text.span.end as usize);
        let parsed = text.raw.unwrap_or(text.value);
        if authored != Some(parsed.as_str()) {
            if let Some((start, _)) = self
                .source
                .match_indices(parsed.as_str())
                .min_by_key(|(start, _)| (*start as u32).abs_diff(text.span.start))
            {
                text.span = Span::new(start as u32, (start + parsed.len()) as u32);
            } else {
                text.span = Span::default();
                text.raw = None;
            }
        }
    }
}

struct StyleScaffoldLowerer<'a, 'm> {
    ast: AstBuilder<'a>,
    map: &'m super::leaf::LeafMap,
    actions: HashMap<u32, StyleAction>,
    hashes: HashMap<u32, Vec<String>>,
}

impl<'a, 'm> StyleScaffoldLowerer<'a, 'm> {
    fn new(
        ast: AstBuilder<'a>,
        map: &'m super::leaf::LeafMap,
        styles: &StyleProjection<'_>,
    ) -> Self {
        Self {
            ast,
            map,
            actions: styles
                .actions
                .iter()
                .map(|(start, action)| (*start, action.clone()))
                .collect(),
            hashes: styles
                .element_hashes
                .iter()
                .map(|(start, hashes)| (*start, hashes.clone()))
                .collect(),
        }
    }

    fn complete(&self) -> bool {
        self.actions.is_empty() && self.hashes.is_empty()
    }

    fn action_for(&mut self, element: &JSXElement<'_>) -> Option<StyleAction> {
        self.map
            .authored_start(element.span)
            .and_then(|start| self.actions.remove(&start))
    }

    fn empty_style(element: &mut JSXElement<'a>) {
        element.children.clear();
        element.closing_element = None;
    }

    fn class_map(&self, entries: &[ClassMapEntry]) -> Expression<'a> {
        let properties = self.ast.vec_from_iter(entries.iter().map(|entry| {
            let span = Span::default();
            self.ast.object_property_kind_object_property(
                span,
                PropertyKind::Init,
                PropertyKey::StringLiteral(self.ast.alloc_string_literal(
                    span,
                    self.ast.str(&entry.class_name),
                    None,
                )),
                self.ast
                    .expression_string_literal(span, self.ast.str(&entry.value), None),
                false,
                false,
                false,
            )
        }));
        self.ast.expression_object(Span::default(), properties)
    }

    fn inject_hash(&self, element: &mut JSXElement<'a>, hash: &str) {
        let class = element
            .opening_element
            .attributes
            .iter_mut()
            .find_map(|attribute| match attribute {
                JSXAttributeItem::Attribute(attribute)
                    if matches!(
                        jsx_attribute_name(&attribute.name),
                        Some("class" | "className")
                    ) =>
                {
                    Some(attribute)
                }
                _ => None,
            });
        let Some(class) = class else {
            element
                .opening_element
                .attributes
                .push(self.ast.jsx_attribute_item_string(
                    Span::default(),
                    "class",
                    self.ast.str(hash),
                ));
            return;
        };
        match class.value.as_mut() {
            None => {
                class.value = Some(JSXAttributeValue::StringLiteral(
                    self.ast
                        .alloc_string_literal(Span::default(), self.ast.str(hash), None),
                ));
            }
            Some(JSXAttributeValue::StringLiteral(value)) => {
                value.value = self.ast.str(&format!("{} {hash}", value.value));
                value.raw = None;
            }
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                let Some(expression) = container.expression.as_expression_mut() else {
                    return;
                };
                let expression = std::mem::replace(
                    expression,
                    self.ast.expression_null_literal(Span::default()),
                );
                let empty = self.ast.str("");
                let suffix = self.ast.str(&format!(" {hash}"));
                let quasis = self.ast.vec_from_array([
                    self.ast.template_element_with_lone_surrogates(
                        Span::default(),
                        TemplateElementValue {
                            raw: empty,
                            cooked: Some(empty),
                        },
                        false,
                        false,
                    ),
                    self.ast.template_element_with_lone_surrogates(
                        Span::default(),
                        TemplateElementValue {
                            raw: suffix,
                            cooked: Some(suffix),
                        },
                        true,
                        false,
                    ),
                ]);
                container.expression = self
                    .ast
                    .expression_template_literal(Span::default(), quasis, self.ast.vec1(expression))
                    .into();
            }
            _ => {}
        }
    }
}

impl<'a> VisitMut<'a> for StyleScaffoldLowerer<'a, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        let action = match expression {
            Expression::JSXElement(element) => self.action_for(element),
            _ => None,
        };
        match action {
            Some(StyleAction::Remove) => {
                *expression = self.ast.expression_null_literal(Span::default());
                return;
            }
            Some(StyleAction::ClassMap(entries)) => {
                *expression = self.class_map(&entries);
                return;
            }
            Some(StyleAction::EmptyElement) => {
                let Expression::JSXElement(element) = expression else {
                    unreachable!("style action was selected from a JSX element");
                };
                Self::empty_style(element);
            }
            None => {}
        }
        walk_mut::walk_expression(self, expression);
    }

    fn visit_jsx_children(&mut self, children: &mut oxc_allocator::Vec<'a, JSXChild<'a>>) {
        let old = std::mem::replace(children, self.ast.vec());
        for mut child in old {
            let action = match &child {
                JSXChild::Element(element) => self.action_for(element),
                _ => None,
            };
            match action {
                Some(StyleAction::Remove) => continue,
                Some(StyleAction::ClassMap(entries)) => {
                    let expression = self.class_map(&entries);
                    children.push(self.ast.jsx_child_expression(Span::default(), expression));
                }
                Some(StyleAction::EmptyElement) => {
                    let JSXChild::Element(element) = &mut child else {
                        unreachable!("style action was selected from a JSX element");
                    };
                    Self::empty_style(element);
                    children.push(child);
                }
                None => children.push(child),
            }
        }
        walk_mut::walk_jsx_children(self, children);
    }

    fn visit_jsx_element(&mut self, element: &mut JSXElement<'a>) {
        if let Some(start) = self.map.authored_start(element.span)
            && let Some(hashes) = self.hashes.remove(&start)
        {
            self.inject_hash(element, &hashes.join(" "));
        }
        walk_mut::walk_jsx_element(self, element);
    }
}

struct LazyAssignmentScaffoldNormalizer<'m> {
    map: &'m super::leaf::LeafMap,
    patterns: HashSet<AuthoredSpan>,
}

impl<'a> VisitMut<'a> for LazyAssignmentScaffoldNormalizer<'_> {
    fn visit_statement(&mut self, statement: &mut Statement<'a>) {
        if let Statement::VariableDeclaration(declaration) = statement
            && declaration.declarations.len() == 1
        {
            let span = declaration.declarations[0].id.span();
            if let Some(authored) = self.map.authored_extent(span)
                && self.patterns.remove(&authored)
            {
                declaration.kind = VariableDeclarationKind::Const;
            }
        }
        walk_mut::walk_statement(self, statement);
    }
}

struct TemplateScaffoldReplacer<'a, 'm, 's> {
    ast: AstBuilder<'a>,
    map: &'m super::leaf::LeafMap,
    marker_prefix: &'m str,
    shorthand_names: Vec<&'s str>,
    raw_scripts: HashMap<AuthoredSpan, AuthoredSpan>,
    dynamic_spans: Vec<AuthoredSpan>,
    seen_dynamic: HashSet<usize>,
    seen_shorthand: HashSet<usize>,
    seen_raw: HashSet<AuthoredSpan>,
    source: &'s str,
}

impl<'a, 'm, 's> TemplateScaffoldReplacer<'a, 'm, 's> {
    fn new(
        ast: AstBuilder<'a>,
        map: &'m super::leaf::LeafMap,
        marker_prefix: &'m str,
        semantic: &'s SolidTsrxModule<'s>,
        source: &'s str,
    ) -> Self {
        let mut shorthand_names = Vec::new();
        let mut raw_scripts = HashMap::new();
        let mut dynamic_spans = Vec::new();
        for site in &semantic.template_sites {
            match site {
                TemplateSite::DynamicElement { origin, .. } => dynamic_spans.push(origin.span),
                TemplateSite::ShorthandAttribute { name, .. } => shorthand_names.push(*name),
                TemplateSite::RawTextScript(script) => {
                    raw_scripts.insert(script.origin.span, script.payload);
                }
                TemplateSite::StyleElement { .. } => {}
            }
        }
        Self {
            ast,
            map,
            marker_prefix,
            shorthand_names,
            raw_scripts,
            dynamic_spans,
            seen_dynamic: HashSet::new(),
            seen_shorthand: HashSet::new(),
            seen_raw: HashSet::new(),
            source,
        }
    }

    fn complete(&self) -> bool {
        self.seen_dynamic.len() == self.dynamic_spans.len()
            && self.seen_shorthand.len() == self.shorthand_names.len()
            && self.seen_raw.len() == self.raw_scripts.len()
    }
}

impl<'a> VisitMut<'a> for TemplateScaffoldReplacer<'a, '_, '_> {
    fn visit_jsx_element(&mut self, element: &mut JSXElement<'a>) {
        let authored = self.map.authored_extent(element.span);
        if let Some(payload) = authored.and_then(|span| self.raw_scripts.get(&span).copied()) {
            let content = &self.source[payload.start as usize..payload.end as usize];
            for child in &mut element.children {
                if let JSXChild::ExpressionContainer(container) = child {
                    container.expression = self
                        .ast
                        .expression_string_literal(Span::default(), self.ast.str(content), None)
                        .into();
                    self.seen_raw.insert(
                        authored.expect("raw script was selected from an authored element span"),
                    );
                    break;
                }
            }
        }

        for attribute in &mut element.opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let Some(name) = jsx_attribute_name(&attribute.name) else {
                continue;
            };
            let Some(index) = marker_index(name, self.marker_prefix, "S", true) else {
                continue;
            };
            let Some(authored_name) = self.shorthand_names.get(index) else {
                continue;
            };
            attribute.name = JSXAttributeName::Identifier(
                self.ast.alloc(
                    self.ast
                        .jsx_identifier(Span::default(), self.ast.str(authored_name)),
                ),
            );
            self.seen_shorthand.insert(index);
        }

        let dynamic = jsx_element_name(&element.opening_element.name)
            .and_then(|name| marker_index(name, self.marker_prefix, "D", false));
        if let Some(index) = dynamic {
            let dynamic_name = || {
                JSXElementName::IdentifierReference(
                    self.ast
                        .alloc_identifier_reference(Span::default(), self.ast.ident("Dynamic")),
                )
            };
            element.opening_element.name = dynamic_name();
            if let Some(closing) = &mut element.closing_element {
                closing.name = dynamic_name();
            }
            for attribute in &mut element.opening_element.attributes {
                let JSXAttributeItem::Attribute(attribute) = attribute else {
                    continue;
                };
                let Some(name) = jsx_attribute_name(&attribute.name) else {
                    continue;
                };
                if marker_index(name, self.marker_prefix, "A", true) == Some(index) {
                    attribute.name = JSXAttributeName::Identifier(
                        self.ast.alloc(
                            self.ast
                                .jsx_identifier(Span::default(), self.ast.str("component")),
                        ),
                    );
                }
            }
            element.opening_element.attributes.retain(|attribute| {
                let JSXAttributeItem::Attribute(attribute) = attribute else {
                    return true;
                };
                jsx_attribute_name(&attribute.name)
                    .and_then(|name| marker_index(name, self.marker_prefix, "Z", true))
                    != Some(index)
            });
            element.children.retain(|child| {
                let JSXChild::ExpressionContainer(container) = child else {
                    return true;
                };
                let Some(expression) = container.expression.as_expression() else {
                    return true;
                };
                let Expression::CallExpression(call) = expression else {
                    return true;
                };
                call.callee.get_identifier_reference().and_then(|callee| {
                    marker_index(callee.name.as_str(), self.marker_prefix, "C", true)
                }) != Some(index)
            });
            self.seen_dynamic.insert(index);
        }

        walk_mut::walk_jsx_element(self, element);
    }
}

fn marker_index(name: &str, prefix: &str, tag: &str, suffix: bool) -> Option<usize> {
    let digits = name.strip_prefix(prefix)?.strip_prefix(tag)?;
    let digits = if suffix {
        digits.strip_suffix('_')?
    } else {
        digits
    };
    (!digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| digits.parse().ok())
        .flatten()
}

fn jsx_element_name<'a>(name: &'a JSXElementName<'_>) -> Option<&'a str> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn jsx_attribute_name<'a>(name: &'a JSXAttributeName<'_>) -> Option<&'a str> {
    match name {
        JSXAttributeName::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

struct ScaffoldReplacer<'a> {
    ast: AstBuilder<'a>,
    expression_replacements: HashMap<String, Expression<'a>>,
    statement_replacements: HashMap<u32, Expression<'a>>,
    code_block_replacements: HashMap<u32, Expression<'a>>,
}

impl<'a> VisitMut<'a> for ScaffoldReplacer<'a> {
    fn visit_statement(&mut self, statement: &mut Statement<'a>) {
        let anchor = match statement {
            Statement::IfStatement(statement) => Some(statement.test.span()),
            Statement::ForOfStatement(statement) => Some(statement.right.span()),
            Statement::SwitchStatement(statement) => Some(statement.discriminant.span()),
            Statement::TryStatement(statement) => {
                statement
                    .block
                    .body
                    .last()
                    .and_then(|statement| match statement {
                        Statement::ExpressionStatement(statement) => {
                            Some(statement.expression.span())
                        }
                        _ => None,
                    })
            }
            _ => None,
        }
        .map(|span| span.start);
        if let Some(replacement) =
            anchor.and_then(|anchor| remove_near(&mut self.statement_replacements, anchor))
        {
            let span = replacement.span();
            *statement = self.ast.statement_expression(span, replacement);
            return;
        }
        walk_mut::walk_statement(self, statement);
    }

    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        let replacement = code_block_anchor(expression)
            .and_then(|anchor| self.code_block_replacements.remove(&anchor))
            .or_else(|| match expression {
                Expression::CallExpression(call) => try_scaffold_anchor(call)
                    .and_then(|anchor| remove_near(&mut self.statement_replacements, anchor))
                    .or_else(|| {
                        call.callee.get_identifier_reference().and_then(|callee| {
                            self.expression_replacements.remove(callee.name.as_str())
                        })
                    }),
                _ => None,
            });
        if let Some(replacement) = replacement {
            *expression = replacement;
            walk_mut::walk_expression(self, expression);
            return;
        }
        walk_mut::walk_expression(self, expression);
    }
}

fn remove_near<V>(values: &mut HashMap<u32, V>, start: u32) -> Option<V> {
    if let Some(value) = values.remove(&start) {
        return Some(value);
    }
    let key = values
        .keys()
        .copied()
        .filter(|candidate| candidate.abs_diff(start) <= 2)
        .min_by_key(|candidate| candidate.abs_diff(start))?;
    values.remove(&key)
}

struct ParserScaffoldFinder<'s> {
    prefix: &'s str,
    found: bool,
}

impl<'a> Visit<'a> for ParserScaffoldFinder<'_> {
    fn visit_identifier_reference(&mut self, identifier: &oxc_ast::ast::IdentifierReference<'a>) {
        self.found |= identifier.name.as_str().starts_with(self.prefix);
    }

    fn visit_identifier_name(&mut self, identifier: &oxc_ast::ast::IdentifierName<'a>) {
        self.found |= identifier.name.as_str().starts_with(self.prefix);
    }

    fn visit_jsx_identifier(&mut self, identifier: &oxc_ast::ast::JSXIdentifier<'a>) {
        self.found |= identifier.name.as_str().starts_with(self.prefix);
    }
}

fn try_scaffold_anchor(call: &oxc_ast::ast::CallExpression<'_>) -> Option<u32> {
    let Expression::ObjectExpression(object) = call.arguments.first()?.as_expression()? else {
        return None;
    };
    let body = object.properties.iter().find_map(|property| {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        let Expression::FunctionExpression(function) = &property.value else {
            return None;
        };
        function.body.as_ref()
    })?;
    let Statement::ExpressionStatement(statement) = body.statements.last()? else {
        return None;
    };
    Some(statement.expression.span().start)
}

fn code_block_anchor(expression: &Expression<'_>) -> Option<u32> {
    let function = match expression {
        Expression::UnaryExpression(unary) => match &unary.argument {
            Expression::FunctionExpression(function) => function,
            _ => return None,
        },
        Expression::FunctionExpression(function) => function,
        _ => return None,
    };
    if !function.r#async || !function.generator {
        return None;
    }
    let statement = function.body.as_ref()?.statements.last()?;
    let Statement::ExpressionStatement(statement) = statement else {
        return None;
    };
    let span = statement.expression.span();
    Some(span.start)
}

struct DynamicElementAnchorer<'s> {
    origins: &'s [AuthoredSpan],
}

impl<'a> VisitMut<'a> for DynamicElementAnchorer<'_> {
    fn visit_jsx_element(&mut self, element: &mut JSXElement<'a>) {
        if element.span == Span::default()
            && jsx_element_name(&element.opening_element.name) == Some("Dynamic")
        {
            let component_start = element
                .opening_element
                .attributes
                .iter()
                .find_map(|attribute| {
                    let JSXAttributeItem::Attribute(attribute) = attribute else {
                        return None;
                    };
                    if jsx_attribute_name(&attribute.name) != Some("component") {
                        return None;
                    }
                    let Some(JSXAttributeValue::ExpressionContainer(container)) =
                        attribute.value.as_ref()
                    else {
                        return None;
                    };
                    container
                        .expression
                        .as_expression()
                        .and_then(first_authored_start)
                });
            if let Some(origin) = component_start.and_then(|start| {
                self.origins
                    .iter()
                    .find(|origin| origin.start <= start && start <= origin.end)
            }) {
                element.span = generated_span(*origin);
            }
        }
        walk_mut::walk_jsx_element(self, element);
    }
}

struct FunctionCodeBlockFinalizer<'a, 'c> {
    ast: AstBuilder<'a>,
    code_blocks: &'c mut HashMap<u32, Span>,
}

impl<'a> VisitMut<'a> for FunctionCodeBlockFinalizer<'a, '_> {
    fn visit_function_body(&mut self, body: &mut FunctionBody<'a>) {
        walk_mut::walk_function_body(self, body);
        let Some(Statement::ExpressionStatement(statement)) = body.statements.last_mut() else {
            return;
        };
        let start = match &statement.expression {
            Expression::JSXElement(element) => {
                let start = jsx_element_start(element);
                (start != 0)
                    .then_some(start)
                    .or_else(|| first_authored_start(&statement.expression))
                    .unwrap_or_default()
            }
            Expression::JSXFragment(fragment) => {
                let start = jsx_fragment_start(fragment);
                (start != 0)
                    .then_some(start)
                    .or_else(|| first_authored_start(&statement.expression))
                    .unwrap_or_default()
            }
            expression => first_authored_start(expression).unwrap_or(expression.span().start),
        };
        let Some(span) = remove_near(self.code_blocks, start) else {
            return;
        };
        let expression = std::mem::replace(
            &mut statement.expression,
            self.ast.expression_null_literal(Span::default()),
        );
        *body.statements.last_mut().expect("last statement exists") =
            self.ast.statement_return(span, Some(expression));
    }
}

fn jsx_element_start(element: &JSXElement<'_>) -> u32 {
    if element.span != Span::default() {
        element.span.start
    } else {
        element.opening_element.span.start
    }
}

fn jsx_fragment_start(fragment: &oxc_ast::ast::JSXFragment<'_>) -> u32 {
    if fragment.span != Span::default() {
        fragment.span.start
    } else {
        fragment.opening_fragment.span.start
    }
}

fn first_authored_start(expression: &Expression<'_>) -> Option<u32> {
    let mut finder = AuthoredStartFinder { start: None };
    finder.visit_expression(expression);
    finder.start
}

struct AuthoredStartFinder {
    start: Option<u32>,
}

impl<'a> Visit<'a> for AuthoredStartFinder {
    fn visit_span(&mut self, span: &Span) {
        if *span != Span::default() {
            self.start = Some(self.start.map_or(span.start, |start| start.min(span.start)));
        }
        walk::walk_span(self, span);
    }
}

#[cfg(test)]
mod tests {
    use oxc_codegen::Codegen;

    use super::*;

    #[test]
    fn directly_lowers_expression_if_without_parser_scaffolds() {
        let source =
            "export const View = ({ ready }) => @if (ready) { <p>yes</p> } @else { <p>no</p> };";
        let tape = super::super::parse_tape(source, "view.tsrx").expect("TSRX tape");
        let semantic = super::super::lower_semantic(source, &tape).expect("semantic IR");
        let styles = super::super::style_projection::plan(source, "view.tsrx", &semantic)
            .unwrap_or_else(|error| panic!("styles: {}", error.message));
        let allocator = Allocator::default();
        let lowered = lower(&allocator, source, &semantic, &styles).expect("direct lowering");
        let code = Codegen::new().build(&lowered.program).code;
        assert!(code.contains("<Show"));
        assert!(!code.contains("_tsrx"));
    }
}
