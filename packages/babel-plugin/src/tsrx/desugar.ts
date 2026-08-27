/**
 * TSRX → Solid JSX desugaring.
 *
 * Walks the ESTree AST produced by `@tsrx/core` (before Solid's local
 * lazy-destructuring transform runs) and lowers every TSRX construct to Solid 2.0 builtIn
 * component JSX, in place. The result is a plain ESTree TSX program that
 * `estree-to-babel` converts for the existing JSX pipeline. BuiltIns are
 * referenced as bare identifiers (`Show`, `For`, …) so the plugin's normal
 * `builtIns` auto-import machinery resolves them against `moduleName`.
 *
 * Lowering contract (mirrored byte-for-byte by the Oxc frontend):
 * - `@{ body; render }` — expression position: `render` alone when there is no
 *   setup, otherwise `(() => { body; return render; })()`; function-body
 *   position: inline statements ending in `return render`.
 * - `@if` — `Show` for a single branch, `Switch`/`Match` for chains; `@else`
 *   becomes `fallback`.
 * - `@for (const x of expr; index i; key k)` — `For`; `key` present emits
 *   `keyed={(x) => k}`; `@empty` becomes `fallback`. RC `For` hands the
 *   callback an item *accessor* in keyed mode and an index accessor always,
 *   so reads of `x` (keyed only) and `i` rewrite to calls.
 * - `@switch` — `Switch` with one `Match when={disc === test}` per `@case`;
 *   `@default` becomes `fallback`.
 * - `@try/@pending/@catch (e, reset)` — `<Errored fallback={(e, reset) =>
 *   …}><Loading fallback={pending}>{content}</Loading></Errored>`; RC
 *   `Errored` passes an `ErrorAccessor`, so reads of `e` rewrite to calls.
 * - `<{expr}>` — `<Dynamic component={expr} …>` (deliberate adaptation from
 *   `@tsrx/solid`'s hoisted `dynamic()` factory; semantically equivalent).
 * - `<style>` — structured "not yet supported" diagnostic (deferred v1).
 */

export interface EsNode {
  type: string;
  start?: number;
  end?: number;
  loc?: unknown;
  [key: string]: unknown;
}

type SourceLocation = { start?: { line: number; column: number } };

/** Keys that are never traversed: locations, tooling metadata, and TSRX
 * keyword-span pointers that carry no semantics of their own. */
const SKIP_KEYS = new Set([
  "type",
  "loc",
  "start",
  "end",
  "range",
  "metadata",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "alternateKeyword",
  "emptyKeyword"
]);

const RENDER_ENTRY_TYPES = new Set([
  "JSXElement",
  "JSXFragment",
  "JSXText",
  "JSXCodeBlock",
  "JSXIfExpression",
  "JSXForExpression",
  "JSXSwitchExpression",
  "JSXTryExpression",
  "JSXStyleElement"
]);

const VALID_JSX_CHILD_TYPES = new Set([
  "JSXElement",
  "JSXFragment",
  "JSXText",
  "JSXExpressionContainer",
  "JSXSpreadChild"
]);

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression"
]);

function isNode(value: unknown): value is EsNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function fail(message: string, node: EsNode | null | undefined): never {
  const start = (node?.loc as SourceLocation | undefined)?.start;
  throw new SyntaxError(start ? `${message} (${start.line}:${start.column})` : message);
}

// ---------------------------------------------------------------------------
// ESTree builders (converted to Babel shapes later by estree-to-babel)
// ---------------------------------------------------------------------------

function withLoc<T extends EsNode>(node: T, src: EsNode | null | undefined): T {
  if (src) {
    if (src.start !== undefined) node.start = src.start;
    if (src.end !== undefined) node.end = src.end;
    if (src.loc !== undefined) node.loc = src.loc;
  }
  return node;
}

function ident(name: string, src?: EsNode | null): EsNode {
  return withLoc({ type: "Identifier", name }, src);
}

function jsxIdent(name: string, src?: EsNode | null): EsNode {
  return withLoc({ type: "JSXIdentifier", name }, src);
}

function jsxContainer(expression: EsNode, src?: EsNode | null): EsNode {
  return withLoc({ type: "JSXExpressionContainer", expression }, src ?? expression);
}

function jsxAttr(name: string, expression: EsNode, src?: EsNode | null): EsNode {
  return withLoc(
    {
      type: "JSXAttribute",
      name: jsxIdent(name, src),
      value: jsxContainer(expression, src ?? expression)
    },
    src ?? expression
  );
}

function jsxElement(name: string, attributes: EsNode[], children: EsNode[], src: EsNode): EsNode {
  const selfClosing = children.length === 0;
  return withLoc(
    {
      type: "JSXElement",
      openingElement: withLoc(
        { type: "JSXOpeningElement", name: jsxIdent(name, src), attributes, selfClosing },
        src
      ),
      closingElement: selfClosing
        ? null
        : withLoc({ type: "JSXClosingElement", name: jsxIdent(name, src) }, src),
      children
    },
    src
  );
}

function jsxFragment(children: EsNode[], src: EsNode): EsNode {
  return withLoc(
    {
      type: "JSXFragment",
      openingFragment: withLoc({ type: "JSXOpeningFragment" }, src),
      closingFragment: withLoc({ type: "JSXClosingFragment" }, src),
      children
    },
    src
  );
}

function arrow(params: EsNode[], body: EsNode, src: EsNode): EsNode {
  return withLoc(
    {
      type: "ArrowFunctionExpression",
      id: null,
      params,
      body,
      expression: body.type !== "BlockStatement",
      async: false,
      generator: false
    },
    src
  );
}

function blockStatement(body: EsNode[], src: EsNode): EsNode {
  return withLoc({ type: "BlockStatement", body }, src);
}

function returnStatement(argument: EsNode, src: EsNode): EsNode {
  return withLoc({ type: "ReturnStatement", argument }, src);
}

function iife(statements: EsNode[], src: EsNode): EsNode {
  return withLoc(
    {
      type: "CallExpression",
      callee: arrow([], blockStatement(statements, src), src),
      arguments: [],
      optional: false
    },
    src
  );
}

function callOn(callee: EsNode, src: EsNode): EsNode {
  return withLoc({ type: "CallExpression", callee, arguments: [], optional: false }, src);
}

function strictEquals(left: EsNode, right: EsNode, src: EsNode): EsNode {
  return withLoc({ type: "BinaryExpression", operator: "===", left, right }, src);
}

function stringLiteral(value: string, src: EsNode): EsNode {
  return withLoc({ type: "Literal", value, raw: JSON.stringify(value) }, src);
}

function cloneNode<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneNode) as unknown as T;
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = cloneNode((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

function accessorLazyPattern(pattern: EsNode): EsNode {
  const clone = cloneNode(pattern);
  clone.lazy = true;
  const metadata = (clone.metadata ??= {}) as Record<string, unknown>;
  delete metadata.lazy_id;
  metadata.lazy_source_accessor = true;
  return clone;
}

function eagerPattern(pattern: EsNode): EsNode {
  const clone = cloneNode(pattern);
  clearLazy(clone);
  return clone;

  function clearLazy(node: EsNode): void {
    if (node.type === "ObjectPattern" || node.type === "ArrayPattern") node.lazy = false;
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) clearLazy(item);
      } else if (isNode(value)) {
        clearLazy(value);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main walk
// ---------------------------------------------------------------------------

export function desugarProgram(program: EsNode): EsNode {
  genericVisit(program);
  return program;
}

/** Desugars `node`, returning its replacement for expression-shaped slots. */
function transform(node: EsNode): EsNode {
  switch (node.type) {
    case "JSXCodeBlock":
      return codeBlockToExpression(node);
    case "JSXIfExpression":
      return ifToJsx(node);
    case "JSXForExpression":
      return forToJsx(node);
    case "JSXSwitchExpression":
      return switchToJsx(node);
    case "JSXTryExpression":
      return tryToJsx(node);
    case "JSXStyleElement":
      return fail(
        "TSRX scoped <style> blocks are not yet supported by the Solid TSRX frontend",
        node
      );
    case "JSXElement":
      return desugarElement(node);
    case "JSXFragment":
      (node.children as EsNode[]) && (node.children = desugarChildren(node.children as EsNode[]));
      return node;
    default:
      if (FUNCTION_TYPES.has(node.type) && isNode(node.body) && node.body.type === "JSXCodeBlock") {
        const body = node.body;
        genericVisit(node, "body");
        node.body = codeBlockToFunctionBody(body);
        if (node.type === "ArrowFunctionExpression") node.expression = false;
        return node;
      }
      genericVisit(node);
      return node;
  }
}

function genericVisit(node: EsNode, skipKey?: string): void {
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key) || key === skipKey) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (isNode(value[i])) value[i] = transform(value[i] as EsNode);
      }
    } else if (isNode(value)) {
      node[key] = transform(value);
    }
  }
}

// ---------------------------------------------------------------------------
// Elements and children
// ---------------------------------------------------------------------------

function desugarElement(el: EsNode): EsNode {
  const opening = el.openingElement as EsNode;
  const isDynamic = !!opening.isDynamic;
  genericVisit(opening);
  const children = desugarChildren((el.children as EsNode[]) ?? []);
  if (isDynamic) {
    const nameContainer = opening.name as EsNode;
    const componentExpr = nameContainer.expression as EsNode;
    const attributes = [
      jsxAttr("component", componentExpr, nameContainer),
      ...((opening.attributes as EsNode[]) ?? [])
    ];
    return jsxElement("Dynamic", attributes, children, el);
  }
  el.children = children;
  return el;
}

function desugarChildren(children: EsNode[]): EsNode[] {
  return children.map(child => {
    const result = transform(child);
    if (!VALID_JSX_CHILD_TYPES.has(result.type)) return jsxContainer(result, child);
    return result;
  });
}

/** Embed an expression as a JSX child: JSX stays structural, everything else
 * goes through an expression container. */
function asChild(expression: EsNode): EsNode {
  if (expression.type === "JSXElement" || expression.type === "JSXFragment") return expression;
  return jsxContainer(expression);
}

// ---------------------------------------------------------------------------
// Template blocks (implicit statement containers)
// ---------------------------------------------------------------------------

interface BlockParts {
  setup: EsNode[];
  renders: EsNode[];
}

const LOOP_TYPES = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement"
]);

/** TSRX constructs are validation boundaries: their blocks are checked when
 * they desugar, with their own construct label. `@{}` containers become
 * function bodies (IIFEs) where escaping statements are legal again. */
const ESCAPE_BOUNDARY_TYPES = new Set([
  "JSXCodeBlock",
  "JSXIfExpression",
  "JSXForExpression",
  "JSXSwitchExpression",
  "JSXTryExpression"
]);

function escapeMessage(kind: "return" | "break" | "continue", construct: string): string {
  // Match the ecosystem (@tsrx/solid) diagnostics verbatim for @if and @for.
  if (construct === "@if" || construct === "@else") {
    if (kind === "return")
      return "Return statements are not allowed inside TSRX template @if blocks. Move the return before the template output or render conditionally instead.";
    if (kind === "break")
      return "Break statements are not allowed inside TSRX template @if blocks.";
    return "Continue statements are not allowed inside TSRX template @if blocks. Filter before rendering or use conditional output instead.";
  }
  if (construct === "@for" || construct === "@empty") {
    if (kind === "return")
      return "Return statements are not allowed inside TSRX template for...of loops. Filter the iterable before rendering or use an @empty fallback for empty lists.";
    if (kind === "break")
      return "Break statements are not allowed inside TSRX template for...of loops.";
    return "Continue statements are not allowed inside TSRX template for...of loops. Filter the iterable before rendering.";
  }
  const noun = kind === "return" ? "Return" : kind === "break" ? "Break" : "Continue";
  return `${noun} statements are not allowed inside TSRX template ${construct} blocks.`;
}

/** Reject return/break/continue that would escape a template control-flow
 * block. Nested functions, loops, switches, and labels open their own escape
 * targets; nested TSRX constructs validate themselves. */
function validateNoControlFlowEscape(entries: EsNode[], construct: string): void {
  for (const entry of entries) check(entry, 0, 0, new Set());

  function check(node: EsNode, loops: number, breakables: number, labels: Set<string>): void {
    if (FUNCTION_TYPES.has(node.type) || ESCAPE_BOUNDARY_TYPES.has(node.type)) return;
    switch (node.type) {
      case "ReturnStatement":
        fail(escapeMessage("return", construct), node);
        break;
      case "BreakStatement": {
        const label = isNode(node.label) ? (node.label.name as string) : null;
        if (label ? !labels.has(label) : breakables === 0) {
          fail(escapeMessage("break", construct), node);
        }
        return;
      }
      case "ContinueStatement": {
        const label = isNode(node.label) ? (node.label.name as string) : null;
        if (label ? !labels.has(label) : loops === 0) {
          fail(escapeMessage("continue", construct), node);
        }
        return;
      }
      case "SwitchStatement": {
        if (isNode(node.discriminant)) check(node.discriminant, loops, breakables, labels);
        for (const switchCase of node.cases as EsNode[]) {
          check(switchCase, loops, breakables + 1, labels);
        }
        return;
      }
      case "LabeledStatement": {
        const withLabel = new Set(labels);
        withLabel.add((node.label as unknown as { name: string }).name);
        check(node.body as EsNode, loops, breakables, withLabel);
        return;
      }
    }
    const nextLoops = LOOP_TYPES.has(node.type) ? loops + 1 : loops;
    const nextBreakables = LOOP_TYPES.has(node.type) ? breakables + 1 : breakables;
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) check(item, nextLoops, nextBreakables, labels);
      } else if (isNode(value)) {
        check(value, nextLoops, nextBreakables, labels);
      }
    }
  }
}

function toBlockBody(node: EsNode): EsNode[] {
  return node.type === "BlockStatement" ? (node.body as EsNode[]) : [node];
}

/** Split a template block into leading setup statements and trailing render
 * output nodes. Setup is desugared here; renders are desugared by callers
 * (their lowering depends on the position they land in). When `construct` is
 * given, escaping control flow (return/break/continue) is rejected first. */
function blockToParts(entries: EsNode[], construct?: string): BlockParts {
  if (construct) validateNoControlFlowEscape(entries, construct);
  const setup: EsNode[] = [];
  const renders: EsNode[] = [];
  for (const entry of entries) {
    if (RENDER_ENTRY_TYPES.has(entry.type)) {
      if (entry.type === "JSXText" && /^\s*$/.test(String(entry.value))) continue;
      renders.push(entry);
    } else {
      if (renders.length > 0) {
        fail("Statements may not follow the rendered output inside a TSRX template block", entry);
      }
      setup.push(transform(entry));
    }
  }
  return { setup, renders };
}

function renderNodeToExpression(node: EsNode): EsNode {
  const result = transform(node);
  if (result.type === "JSXText") return stringLiteral(String(result.value), result);
  return result;
}

/** Combine desugared render nodes into one expression (fragment for
 * siblings). Returns null when the block rendered nothing. */
function rendersToExpression(renders: EsNode[], src: EsNode): EsNode | null {
  if (renders.length === 0) return null;
  if (renders.length === 1) return renderNodeToExpression(renders[0]);
  return jsxFragment(
    renders.map(render => {
      const result = transform(render);
      if (!VALID_JSX_CHILD_TYPES.has(result.type)) return jsxContainer(result, render);
      return result;
    }),
    src
  );
}

/** Lower a whole template block to a single expression. Returns null only for
 * a fully empty block; a block with setup but no render is an error. */
function blockToExpression(blockNode: EsNode, context: string): EsNode | null {
  const parts = blockToParts(toBlockBody(blockNode), context);
  const renderExpr = rendersToExpression(parts.renders, blockNode);
  if (parts.setup.length === 0) return renderExpr;
  if (!renderExpr) {
    fail(`A TSRX ${context} block with setup statements must end with rendered output`, blockNode);
  }
  return iife([...parts.setup, returnStatement(renderExpr, blockNode)], blockNode);
}

// ---------------------------------------------------------------------------
// @{} statement containers
// ---------------------------------------------------------------------------

function codeBlockToExpression(cb: EsNode): EsNode {
  const setup = (cb.body as EsNode[]).map(transform);
  if (!isNode(cb.render)) {
    fail("A TSRX statement container is missing its rendered output node", cb);
  }
  const renderExpr = renderNodeToExpression(cb.render);
  if (setup.length === 0) return renderExpr;
  return iife([...setup, returnStatement(renderExpr, cb)], cb);
}

function codeBlockToFunctionBody(cb: EsNode): EsNode {
  const setup = (cb.body as EsNode[]).map(transform);
  if (!isNode(cb.render)) {
    fail("A TSRX statement container is missing its rendered output node", cb);
  }
  const renderExpr = renderNodeToExpression(cb.render);
  return blockStatement([...setup, returnStatement(renderExpr, cb)], cb);
}

// ---------------------------------------------------------------------------
// @if — Show / Switch+Match
// ---------------------------------------------------------------------------

function ifToJsx(node: EsNode): EsNode {
  const branches: { test: EsNode; block: EsNode; src: EsNode }[] = [];
  let current: EsNode = node;
  let elseBlock: EsNode | null = null;
  for (;;) {
    branches.push({
      test: transform(current.test as EsNode),
      block: current.consequent as EsNode,
      src: current
    });
    const alternate = current.alternate as EsNode | null;
    if (alternate && (alternate.type === "IfStatement" || alternate.type === "JSXIfExpression")) {
      current = alternate;
    } else {
      elseBlock = alternate;
      break;
    }
  }

  const elseExpr = elseBlock ? blockToExpression(elseBlock, "@else") : null;

  if (branches.length === 1) {
    const branch = branches[0];
    const branchExpr = blockToExpression(branch.block, "@if");
    const attributes = [jsxAttr("when", branch.test, branch.src)];
    if (elseExpr) attributes.push(jsxAttr("fallback", elseExpr, elseBlock));
    return jsxElement("Show", attributes, branchExpr ? [asChild(branchExpr)] : [], node);
  }

  const matches = branches.map(branch => {
    const branchExpr = blockToExpression(branch.block, "@if");
    return jsxElement(
      "Match",
      [jsxAttr("when", branch.test, branch.src)],
      branchExpr ? [asChild(branchExpr)] : [],
      branch.src
    );
  });
  const attributes = elseExpr ? [jsxAttr("fallback", elseExpr, elseBlock)] : [];
  return jsxElement("Switch", attributes, matches, node);
}

// ---------------------------------------------------------------------------
// @for — For
// ---------------------------------------------------------------------------

function forToJsx(node: EsNode): EsNode {
  if (node.statementType !== "ForOfStatement") {
    fail(
      "@for must iterate with for...of; for...in and classic for loops are not TSRX template constructs",
      node
    );
  }
  if (node.await) {
    fail("`for await` is not supported inside Solid TSRX templates", node);
  }

  const left = node.left as EsNode;
  const pattern =
    left.type === "VariableDeclaration" ? ((left.declarations as EsNode[])[0].id as EsNode) : left;
  const each = transform(node.right as EsNode);
  const index = isNode(node.index) ? node.index : null;
  const key = isNode(node.key) ? node.key : null;

  const parts = blockToParts(toBlockBody(node.body as EsNode), "@for");
  const renderExpr = rendersToExpression(parts.renders, node.body as EsNode);
  if (!renderExpr) fail("A TSRX @for body must end with rendered output", node);

  const callbackBody =
    parts.setup.length > 0
      ? blockStatement(
          [...parts.setup, returnStatement(renderExpr, node.body as EsNode)],
          node.body as EsNode
        )
      : renderExpr;

  // RC `For` semantics: keyed mode hands the callback an item accessor, and
  // the index parameter is always an accessor — rewrite reads to calls.
  if (key && pattern.type === "Identifier")
    rewriteReadsToCalls(callbackBody, (pattern as unknown as { name: string }).name);
  if (index) rewriteReadsToCalls(callbackBody, (index as unknown as { name: string }).name);

  const callbackPattern =
    key && pattern.type !== "Identifier" ? accessorLazyPattern(pattern) : pattern;
  const params: EsNode[] = [callbackPattern];
  if (index) params.push(index);

  const attributes = [jsxAttr("each", each, node.right as EsNode)];
  if (key) {
    attributes.push(jsxAttr("keyed", arrow([eagerPattern(pattern)], transform(key), key), key));
  }
  if (isNode(node.empty)) {
    const emptyExpr = blockToExpression(node.empty, "@empty");
    if (emptyExpr) attributes.push(jsxAttr("fallback", emptyExpr, node.empty));
  }

  return jsxElement(
    "For",
    attributes,
    [jsxContainer(arrow(params, callbackBody, node), node)],
    node
  );
}

// ---------------------------------------------------------------------------
// @switch — Switch / Match
// ---------------------------------------------------------------------------

function switchToJsx(node: EsNode): EsNode {
  const discriminant = transform(node.discriminant as EsNode);
  const matches: EsNode[] = [];
  let fallbackExpr: EsNode | null = null;
  let fallbackSrc: EsNode | null = null;

  for (const switchCase of node.cases as EsNode[]) {
    const consequent = switchCase.consequent as EsNode[];
    const entries =
      consequent.length === 1 && consequent[0].type === "BlockStatement"
        ? (consequent[0].body as EsNode[])
        : consequent;
    const parts = blockToParts(entries, switchCase.test == null ? "@default" : "@case");
    const renderExpr = rendersToExpression(parts.renders, switchCase);
    const caseExpr =
      parts.setup.length > 0
        ? renderExpr
          ? iife([...parts.setup, returnStatement(renderExpr, switchCase)], switchCase)
          : fail(
              "A TSRX @case block with setup statements must end with rendered output",
              switchCase
            )
        : renderExpr;

    if (switchCase.test == null) {
      fallbackExpr = caseExpr;
      fallbackSrc = switchCase;
    } else {
      const when = strictEquals(
        cloneNode(discriminant),
        transform(switchCase.test as EsNode),
        switchCase
      );
      matches.push(
        jsxElement(
          "Match",
          [jsxAttr("when", when, switchCase)],
          caseExpr ? [asChild(caseExpr)] : [],
          switchCase
        )
      );
    }
  }

  const attributes = fallbackExpr ? [jsxAttr("fallback", fallbackExpr, fallbackSrc)] : [];
  return jsxElement("Switch", attributes, matches, node);
}

// ---------------------------------------------------------------------------
// @try / @pending / @catch — Errored / Loading
// ---------------------------------------------------------------------------

function tryToJsx(node: EsNode): EsNode {
  if (isNode(node.finalizer)) {
    fail("@finally is not part of the TSRX template grammar", node.finalizer);
  }

  const contentExpr = blockToExpression(node.block as EsNode, "@try");
  if (!contentExpr) fail("A TSRX @try block must end with rendered output", node);

  let result = contentExpr;

  if (isNode(node.pending)) {
    const pendingExpr = blockToExpression(node.pending, "@pending");
    const attributes = pendingExpr ? [jsxAttr("fallback", pendingExpr, node.pending)] : [];
    result = jsxElement("Loading", attributes, [asChild(result)], node);
  }

  if (isNode(node.handler)) {
    const handler = node.handler;
    const param = isNode(handler.param) ? handler.param : null;
    if (
      param &&
      param.type !== "Identifier" &&
      param.type !== "ObjectPattern" &&
      param.type !== "ArrayPattern"
    ) {
      fail(
        "The @catch error binding must be an identifier, object pattern, or array pattern",
        param
      );
    }
    const resetParam = isNode(handler.resetParam) ? handler.resetParam : null;
    const errorName = param ? (param as unknown as { name: string }).name : "_e";

    const handlerExpr = blockToExpression(handler.body as EsNode, "@catch");
    if (!handlerExpr) fail("A TSRX @catch block must end with rendered output", handler);
    // RC `Errored` passes an `ErrorAccessor`: reads of the binding become calls.
    if (param) rewriteReadsToCalls(handlerExpr, errorName);

    const params: EsNode[] = [
      param && param.type !== "Identifier" ? accessorLazyPattern(param) : ident(errorName, param)
    ];
    if (resetParam)
      params.push(ident((resetParam as unknown as { name: string }).name, resetParam));

    result = jsxElement(
      "Errored",
      [jsxAttr("fallback", arrow(params, handlerExpr, handler), handler)],
      [asChild(result)],
      node
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Lazy-engine adaptation: intrinsic element names
// ---------------------------------------------------------------------------

/**
 * Older lazy-transform paths rewrote *any* JSX name matching a lazy binding —
 * including lowercase intrinsic tags (`<address>` with a lazy `address` in
 * scope became `<__lazy0.address>`), which hijacked the element into a
 * component. Per JSX semantics a single lowercase identifier tag is always
 * intrinsic, so such rewrites are unambiguously wrong. Keep this repair for
 * compatibility with trees produced by those paths; the local engine does not
 * produce the invalid rewrite.
 */
export function restoreIntrinsicJsxNames(root: EsNode): void {
  visit(root);

  function restore(owner: EsNode): void {
    const name = owner.name as EsNode | undefined;
    if (!name || name.type !== "JSXMemberExpression") return;
    const object = name.object as EsNode;
    const property = name.property as EsNode;
    if (
      object.type === "JSXIdentifier" &&
      /^__lazy\d+$/.test(object.name as string) &&
      property.type === "JSXIdentifier" &&
      /^[a-z]/.test(property.name as string)
    ) {
      owner.name = jsxIdent(property.name as string, name);
    }
  }

  function visit(node: EsNode): void {
    if (node.type === "JSXOpeningElement" || node.type === "JSXClosingElement") restore(node);
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) visit(item);
      } else if (isNode(value)) {
        visit(value);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scope-aware read → call rewriting (accessor adaptations)
// ---------------------------------------------------------------------------

/** Keys whose contents are TS type positions — never value references. */
const TYPE_KEYS = new Set([
  "typeAnnotation",
  "typeParameters",
  "typeArguments",
  "superTypeArguments",
  "returnType"
]);

function patternNames(pattern: EsNode, into: Set<string>): void {
  switch (pattern.type) {
    case "Identifier":
      into.add(pattern.name as string);
      break;
    case "ObjectPattern":
      for (const prop of pattern.properties as EsNode[]) {
        if (prop.type === "RestElement") patternNames(prop.argument as EsNode, into);
        else patternNames(prop.value as EsNode, into);
      }
      break;
    case "ArrayPattern":
      for (const el of pattern.elements as (EsNode | null)[]) {
        if (el) patternNames(el, into);
      }
      break;
    case "AssignmentPattern":
      patternNames(pattern.left as EsNode, into);
      break;
    case "RestElement":
      patternNames(pattern.argument as EsNode, into);
      break;
  }
}

function statementsShadow(statements: EsNode[], name: string): boolean {
  const names = new Set<string>();
  for (const stmt of statements) {
    if (stmt.type === "VariableDeclaration") {
      for (const decl of stmt.declarations as EsNode[]) patternNames(decl.id as EsNode, names);
    } else if (
      (stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration") &&
      isNode(stmt.id)
    ) {
      names.add((stmt.id as unknown as { name: string }).name);
    }
  }
  return names.has(name);
}

/**
 * Rewrite value reads of `name` within `root` (a plain, already-desugared
 * subtree) to zero-argument calls, respecting shadowing by function params,
 * block declarations, and catch clauses. Write targets are left untouched.
 */
export function rewriteReadsToCalls(root: EsNode, name: string): void {
  visit(root);

  function shouldReplace(value: unknown): value is EsNode {
    return isNode(value) && value.type === "Identifier" && value.name === name;
  }

  function replaceIn(container: Record<string | number, unknown>, key: string | number): void {
    const value = container[key] as EsNode;
    container[key] = callOn(value, value);
  }

  function visit(node: EsNode): void {
    if (FUNCTION_TYPES.has(node.type)) {
      const bound = new Set<string>();
      for (const param of node.params as EsNode[]) patternNames(param, bound);
      if (bound.has(name)) return;
      if (isNode(node.body)) visit(node.body);
      return;
    }
    if (node.type === "BlockStatement" || node.type === "Program") {
      if (statementsShadow(node.body as EsNode[], name)) return;
    }
    if (node.type === "CatchClause") {
      const bound = new Set<string>();
      if (isNode(node.param)) patternNames(node.param, bound);
      if (bound.has(name)) return;
    }
    if (node.type === "MetaProperty") return;

    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key) || TYPE_KEYS.has(key)) continue;
      // Labels, binding sites, and non-computed accesses are not value reads.
      if (key === "property" && node.type === "MemberExpression" && !node.computed) continue;
      if (key === "property" && node.type === "JSXMemberExpression") continue;
      if (key === "name" && (node.type === "JSXAttribute" || node.type === "JSXNamespacedName"))
        continue;
      if (key === "key" && node.type === "Property" && !node.computed) continue;
      if (key === "id" && (node.type === "VariableDeclarator" || FUNCTION_TYPES.has(node.type)))
        continue;
      if (key === "label") continue;
      if (key === "left" && node.type === "AssignmentExpression") {
        // Writes to the accessor binding are invalid anyway; skip identifier
        // targets but still walk member-expression targets.
        if (shouldReplace(node.left)) continue;
      }
      if (key === "argument" && node.type === "UpdateExpression" && shouldReplace(node.argument))
        continue;
      if (
        (key === "imported" || key === "local" || key === "exported") &&
        /Specifier$/.test(node.type)
      )
        continue;

      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (shouldReplace(item)) replaceIn(value as unknown as Record<number, unknown>, i);
          else if (isNode(item)) visit(item);
        }
      } else if (shouldReplace(value)) {
        // Object-pattern shorthand shares the key/value node: split them.
        if (node.type === "Property" && node.shorthand && key === "value") {
          node.shorthand = false;
          node.key = ident(name, value);
        }
        replaceIn(node as unknown as Record<string, unknown>, key);
      } else if (isNode(value)) {
        visit(value);
      }
    }
  }
}
