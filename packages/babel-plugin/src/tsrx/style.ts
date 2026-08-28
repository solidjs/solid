import type { EsNode } from "./desugar";
import type { TsrxStyleResult } from "../types";

type StyleSheet = EsNode & { hash: string; source: string };

export interface TsrxStyleCore {
  analyzeCss(stylesheet: StyleSheet): unknown;
  pruneCss(
    stylesheet: StyleSheet,
    element: EsNode,
    styleClasses: Map<string, unknown>,
    topScopedClasses: Map<string, unknown>,
    regionHash?: string
  ): void;
  annotateWithHash(
    node: EsNode,
    hash: string,
    classAttributeName?: "class" | "className",
    preserveStyleElements?: boolean
  ): EsNode | null;
  collectStyleRefAttributes(node: EsNode): EsNode[];
  createStyleClassMap(component: EsNode, stylesheet: StyleSheet): EsNode;
  createStyleClassMapFromStylesheet(stylesheet: StyleSheet): EsNode;
  createStyleRefSetupStatements(
    refAttributes: EsNode[],
    styleMap: EsNode,
    options?: {
      allowMutableRefTarget?: boolean;
      createTempIdentifier?: () => EsNode;
    }
  ): EsNode[];
  getStyleElementStylesheet(styleElement: EsNode): StyleSheet | null;
  prepareStylesheetForRender(stylesheet: StyleSheet, isStyleExpression?: boolean): StyleSheet;
  renderCssResult(
    stylesheets: StyleSheet[],
    minify?: boolean
  ): { css: string; cssHash: string | null };
}

const SKIP_KEYS = new Set([
  "type",
  "loc",
  "start",
  "end",
  "range",
  "metadata",
  "css",
  "leadingComments",
  "trailingComments",
  "innerComments"
]);

const FUNCTION_BOUNDARIES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassDeclaration",
  "ClassExpression"
]);

function isNode(value: unknown): value is EsNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function isStyleElement(node: EsNode): boolean {
  return node.type === "JSXStyleElement";
}

function isNativeRenderRoot(node: EsNode): boolean {
  return (
    (node.type === "JSXElement" || node.type === "JSXFragment") &&
    !!(node.metadata as { native_tsrx?: boolean })?.native_tsrx
  );
}

function isNativeTsrxNode(node: EsNode | undefined): boolean {
  return (
    node?.type === "JSXCodeBlock" ||
    (!!node &&
      (node.type === "JSXElement" ||
        node.type === "JSXFragment" ||
        node.type === "JSXStyleElement") &&
      !!(node.metadata as { native_tsrx?: boolean })?.native_tsrx)
  );
}

function isStyleExpressionPosition(path: EsNode[]): boolean {
  const parent = path[path.length - 1];
  return !(
    isNativeTsrxNode(parent) ||
    parent?.type === "BlockStatement" ||
    parent?.type === "Program" ||
    parent?.type === "SwitchCase"
  );
}

function structuralChildren(node: EsNode): EsNode[] {
  switch (node.type) {
    case "JSXElement":
    case "JSXFragment":
      return ((node.children as EsNode[] | undefined) ?? []).filter(isNode);
    case "JSXCodeBlock":
      return [
        ...((node.body as EsNode[] | undefined) ?? []).filter(isNode),
        ...(isNode(node.render) ? [node.render] : [])
      ];
    case "BlockStatement":
      return ((node.body as EsNode[] | undefined) ?? []).filter(isNode);
    case "JSXIfExpression":
    case "IfStatement":
      return [node.consequent, node.alternate].filter(isNode);
    case "JSXForExpression":
      return [node.body, node.empty].filter(isNode);
    case "JSXSwitchExpression":
    case "SwitchStatement":
      return ((node.cases as EsNode[] | undefined) ?? []).flatMap(switchCase =>
        ((switchCase.consequent as EsNode[] | undefined) ?? []).filter(isNode)
      );
    case "JSXTryExpression":
    case "TryStatement":
      return [node.block, node.pending, node.handler, node.finalizer].filter(isNode);
    case "CatchClause":
      return isNode(node.body) ? [node.body] : [];
    default:
      return [];
  }
}

function collectRuntimeStyleElements(value: EsNode | EsNode[], styles: EsNode[]): void {
  if (Array.isArray(value)) {
    for (const child of value) collectRuntimeStyleElements(child, styles);
    return;
  }
  if (isStyleElement(value)) {
    styles.push(value);
    return;
  }
  if (FUNCTION_BOUNDARIES.has(value.type)) return;

  if ((value.type === "JSXElement" || value.type === "JSXFragment") && isNativeRenderRoot(value)) {
    collectRuntimeStyleElements((value.children as EsNode[] | undefined) ?? [], styles);
    return;
  }
  if (value.type === "BlockStatement") {
    collectRuntimeStyleElements((value.body as EsNode[] | undefined) ?? [], styles);
    return;
  }
  if (value.type === "JSXIfExpression" || value.type === "IfStatement") {
    if (isNode(value.consequent)) collectRuntimeStyleElements(value.consequent, styles);
    if (isNode(value.alternate)) collectRuntimeStyleElements(value.alternate, styles);
    return;
  }
  // This is an intentional ownership boundary in @tsrx/core: a style directly
  // rendered by an @for body is visited later as an unowned statement style.
  if (value.type === "JSXForExpression") return;
  if (value.type === "JSXSwitchExpression" || value.type === "SwitchStatement") {
    for (const switchCase of (value.cases as EsNode[] | undefined) ?? []) {
      collectRuntimeStyleElements((switchCase.consequent as EsNode[] | undefined) ?? [], styles);
    }
    return;
  }
  if (value.type === "JSXTryExpression" || value.type === "TryStatement") {
    if (isNode(value.block)) collectRuntimeStyleElements(value.block, styles);
    const handler = isNode(value.handler) ? value.handler : undefined;
    if (handler && isNode(handler.body)) collectRuntimeStyleElements(handler.body, styles);
    if (isNode(value.finalizer)) collectRuntimeStyleElements(value.finalizer, styles);
    // `pending` is deliberately absent: core does not assign direct @pending
    // statement styles to the surrounding fragment.
  }
}

function collectPrunableElements(
  value: EsNode | EsNode[],
  elements: EsNode[],
  path: EsNode[] = []
): void {
  if (Array.isArray(value)) {
    for (const child of value) collectPrunableElements(child, elements, path);
    return;
  }
  if (FUNCTION_BOUNDARIES.has(value.type) || isStyleElement(value)) return;

  if (value.type === "JSXElement" && isNativeRenderRoot(value)) {
    const metadata = (value.metadata ??= {}) as Record<string, unknown>;
    metadata.path = path;
    elements.push(value);
  }

  const childPath = [...path, value];
  for (const child of structuralChildren(value)) {
    collectPrunableElements(child, elements, childPath);
  }
}

function annotateRuntimeValue(value: EsNode, hash: string, core: TsrxStyleCore): EsNode | null {
  if (isStyleElement(value)) return null;
  if (FUNCTION_BOUNDARIES.has(value.type)) return value;
  if (value.type === "JSXElement") {
    return core.annotateWithHash(value, hash, "class", false);
  }
  if (value.type === "JSXFragment") {
    value.children = annotateRuntimeList(
      (value.children as EsNode[] | undefined) ?? [],
      hash,
      core
    );
    return value;
  }

  mutateStructuralChildren(value, child => annotateRuntimeValue(child, hash, core));
  return value;
}

function annotateRuntimeList(values: EsNode[], hash: string, core: TsrxStyleCore): EsNode[] {
  return values
    .map(value => annotateRuntimeValue(value, hash, core))
    .filter((value): value is EsNode => value !== null);
}

function mutateStructuralChildren(node: EsNode, transform: (child: EsNode) => EsNode | null): void {
  const mapList = (values: EsNode[] | undefined): EsNode[] =>
    (values ?? []).map(transform).filter((value): value is EsNode => value !== null);
  const mapSlot = (key: string): void => {
    const value = node[key];
    if (isNode(value)) node[key] = transform(value);
  };

  switch (node.type) {
    case "JSXElement":
    case "JSXFragment":
      node.children = mapList(node.children as EsNode[] | undefined);
      break;
    case "JSXCodeBlock":
      node.body = mapList(node.body as EsNode[] | undefined);
      mapSlot("render");
      break;
    case "BlockStatement":
      node.body = mapList(node.body as EsNode[] | undefined);
      break;
    case "JSXIfExpression":
    case "IfStatement":
      mapSlot("consequent");
      mapSlot("alternate");
      break;
    case "JSXForExpression":
      mapSlot("body");
      mapSlot("empty");
      break;
    case "JSXSwitchExpression":
    case "SwitchStatement":
      for (const switchCase of (node.cases as EsNode[] | undefined) ?? []) {
        switchCase.consequent = mapList(switchCase.consequent as EsNode[] | undefined);
      }
      break;
    case "JSXTryExpression":
    case "TryStatement":
      mapSlot("block");
      mapSlot("pending");
      mapSlot("handler");
      mapSlot("finalizer");
      break;
    case "CatchClause":
      mapSlot("body");
      break;
  }
}

function cleanRuntimeStyles(node: EsNode): void {
  if (FUNCTION_BOUNDARIES.has(node.type)) return;
  mutateStructuralChildren(node, child => {
    if (isStyleElement(child)) return null;
    cleanRuntimeStyles(child);
    return child;
  });
}

function withLoc<T extends EsNode>(node: T, source: EsNode): T {
  if (source.start !== undefined) node.start = source.start;
  if (source.end !== undefined) node.end = source.end;
  if (source.loc !== undefined) node.loc = source.loc;
  return node;
}

function wrapWithSetup(expression: EsNode, statements: EsNode[]): EsNode {
  const body = withLoc(
    {
      type: "BlockStatement",
      body: [...statements, withLoc({ type: "ReturnStatement", argument: expression }, expression)]
    },
    expression
  );
  const fn = withLoc(
    {
      type: "ArrowFunctionExpression",
      id: null,
      params: [],
      body,
      expression: false,
      async: false,
      generator: false
    },
    expression
  );
  return withLoc(
    { type: "CallExpression", callee: fn, arguments: [], optional: false },
    expression
  );
}

function collectIdentifierNames(node: EsNode, names: Set<string>): void {
  if (node.type === "Identifier" && typeof node.name === "string") names.add(node.name);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) collectIdentifierNames(child, names);
    } else if (isNode(value)) {
      collectIdentifierNames(value, names);
    }
  }
}

function createTempIdentifierFactory(program: EsNode): () => EsNode {
  const names = new Set<string>();
  collectIdentifierNames(program, names);
  let index = 0;
  return () => {
    let name: string;
    do {
      name = `_tsrx_style_ref_${++index}`;
    } while (names.has(name));
    names.add(name);
    return { type: "Identifier", name };
  };
}

function createEmptyStyleElement(node: EsNode): EsNode {
  const metadata = (node.metadata as { path?: EsNode[] } | undefined) ?? {};
  const cloneElementPart = (part: unknown): unknown => {
    if (!isNode(part)) return part;
    return {
      ...part,
      metadata: {
        path: [...(metadata.path ?? [])]
      }
    };
  };
  return {
    ...node,
    type: "JSXElement",
    openingElement: cloneElementPart(node.openingElement),
    closingElement: cloneElementPart(node.closingElement),
    children: []
  };
}

function prepareRuntimeStyle(
  owner: EsNode,
  style: EsNode,
  core: TsrxStyleCore,
  createTempIdentifier: () => EsNode
): { owner: EsNode; stylesheet: StyleSheet; setup: EsNode[] } {
  const stylesheet = core.getStyleElementStylesheet(style);
  if (!stylesheet) {
    throw new SyntaxError("A TSRX <style> element is missing its parsed stylesheet");
  }

  core.analyzeCss(stylesheet);
  const metadata = (owner.metadata ??= {}) as Record<string, unknown>;
  const styleClasses = new Map<string, unknown>();
  const topScopedClasses = new Map<string, unknown>();

  const elements: EsNode[] = [];
  collectPrunableElements((owner.children as EsNode[] | undefined) ?? [], elements);
  for (const element of elements) {
    core.pruneCss(stylesheet, element, styleClasses, topScopedClasses, stylesheet.hash);
  }

  const refs = core.collectStyleRefAttributes(owner);
  if (refs.length > 0) {
    for (const [name, classInfo] of topScopedClasses) {
      styleClasses.set(
        name,
        (classInfo as { selector?: unknown } | undefined)?.selector ?? classInfo
      );
    }
    for (const element of elements) {
      core.pruneCss(stylesheet, element, styleClasses, topScopedClasses, stylesheet.hash);
    }
  }
  if (topScopedClasses.size > 0) metadata.topScopedClasses = topScopedClasses;

  const setup =
    refs.length === 0
      ? []
      : core.createStyleRefSetupStatements(refs, core.createStyleClassMap(owner, stylesheet), {
          allowMutableRefTarget: true,
          createTempIdentifier
        });

  mutateStructuralChildren(owner, child => annotateRuntimeValue(child, stylesheet.hash, core));
  cleanRuntimeStyles(owner);
  return { owner, stylesheet, setup };
}

function prepareStyleOwner(
  owner: EsNode,
  core: TsrxStyleCore,
  createTempIdentifier: () => EsNode
): { owner: EsNode; stylesheet: StyleSheet; setup: EsNode[] } | null {
  const styles: EsNode[] = [];
  collectRuntimeStyleElements((owner.children as EsNode[] | undefined) ?? [], styles);
  if (styles.length > 1) {
    throw new SyntaxError("TSRX fragments can only have one style tag");
  }
  return styles.length === 1
    ? prepareRuntimeStyle(owner, styles[0], core, createTempIdentifier)
    : null;
}

export function processTsrxStyles(program: EsNode, core: TsrxStyleCore): TsrxStyleResult {
  const stylesheets: StyleSheet[] = [];
  const createTempIdentifier = createTempIdentifierFactory(program);

  const visit = (node: EsNode, path: EsNode[]): EsNode => {
    if (isStyleElement(node)) {
      if (!isStyleExpressionPosition(path)) return createEmptyStyleElement(node);
      const stylesheet = core.getStyleElementStylesheet(node);
      if (!stylesheet) {
        throw new SyntaxError("A TSRX <style> expression is missing its parsed stylesheet");
      }
      core.analyzeCss(stylesheet);
      stylesheets.push(core.prepareStylesheetForRender(stylesheet, true));
      return core.createStyleClassMapFromStylesheet(stylesheet);
    }

    if (node.type === "JSXCodeBlock" && isNode(node.render) && isNativeRenderRoot(node.render)) {
      // Core gives a code block's native element/fragment render one style
      // scope. A native element elsewhere is deliberately not an owner.
      const prepared = prepareStyleOwner(node.render, core, createTempIdentifier);
      if (prepared) {
        stylesheets.push(prepared.stylesheet);
        node.render = prepared.owner;
        node.body = [...((node.body as EsNode[] | undefined) ?? []), ...prepared.setup];
      }
    } else if (node.type === "JSXFragment" && isNativeRenderRoot(node)) {
      // Native fragments are owners in every expression/child position.
      const prepared = prepareStyleOwner(node, core, createTempIdentifier);
      if (prepared) {
        stylesheets.push(prepared.stylesheet);
        node = prepared.setup.length
          ? wrapWithSetup(prepared.owner, prepared.setup)
          : prepared.owner;
      }
    }

    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        node[key] = value.map(child => (isNode(child) ? visit(child, [...path, node]) : child));
      } else if (isNode(value)) {
        node[key] = visit(value, [...path, node]);
      }
    }
    return node;
  };

  visit(program, []);
  return core.renderCssResult(stylesheets);
}
