import * as t from "@babel/types";
import { addNamed } from "@babel/helper-module-imports";
import { DOMWithState } from "../../../web/src/constants.js";
import type { NodePath, Visitor } from "@babel/traverse";
import type { PluginConfig, RendererConfig } from "../config";
import type {
  BabelHubWithMetadata,
  DynamicOptions,
  ProgramScopeData,
  TransformResult
} from "../types";

type JSXElementName = t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName;
type StaticMarkerNode = t.Node & { expression?: unknown };
type JSXElementPath = NodePath<t.JSXElement>;
type JSXAttributePath = NodePath<t.JSXAttribute>;
type ConditionPath = NodePath<t.Expression | t.JSXEmptyExpression>;
type ExpressionArrowFunction = t.ArrowFunctionExpression & { body: t.Expression };
type TransformConditionStatements = [t.VariableDeclaration, t.ArrowFunctionExpression];
type TransformConditionResult = ExpressionArrowFunction | TransformConditionStatements;
type EvaluateAndInlineNode = t.Node | t.JSXAttribute["value"];

export const reservedNameSpaces = new Set(["prop"]);

export const nonSpreadNameSpaces = new Set(["prop"]);

export function getConfig(path: NodePath): PluginConfig {
  return (path.hub as unknown as BabelHubWithMetadata).file.metadata.config as PluginConfig;
}

export const getRendererConfig = (
  path: NodePath,
  renderer: string
): PluginConfig | RendererConfig => {
  const config = getConfig(path);
  return config?.renderers?.find(r => r.name === renderer) ?? config;
};

export function registerImportMethod(
  path: NodePath,
  name: string,
  moduleName?: string
): t.Identifier {
  const data = path.scope.getProgramParent().data as ProgramScopeData;
  const imports = data.imports || (data.imports = new Map<string, t.Identifier>());
  moduleName = moduleName || getConfig(path).moduleName;
  if (!imports.has(`${moduleName}:${name}`)) {
    let id = addNamed(path, name, moduleName, {
      nameHint: `_$${name}`
    });
    imports.set(`${moduleName}:${name}`, id);
    return id;
  } else {
    let iden = imports.get(`${moduleName}:${name}`)!;
    // the cloning is required to play well with babel-preset-env which is
    // transpiling import as we add them and using the same identifier causes
    // problems with the multiple identifiers of the same thing
    return t.cloneNode(iden);
  }
}

function jsxElementNameToString(node: JSXElementName | t.Identifier): string {
  if (t.isJSXMemberExpression(node)) {
    return `${jsxElementNameToString(node.object)}.${node.property.name}`;
  }
  if (t.isJSXIdentifier(node) || t.isIdentifier(node)) {
    return node.name;
  }
  return `${node.namespace.name}:${node.name.name}`;
}

export function tagNameToIdentifier(name: string): t.Identifier | t.MemberExpression {
  const parts = name.split(".");
  if (parts.length === 1) return t.identifier(name);
  let part;
  let base: t.Identifier | t.MemberExpression = t.identifier(parts.shift()!);
  while ((part = parts.shift())) {
    base = t.memberExpression(base, t.identifier(part)) as t.MemberExpression;
  }
  return base;
}

export function getTagName(tag: t.JSXElement): string {
  const jsxName = tag.openingElement.name;
  return jsxElementNameToString(jsxName);
}

export function isComponent(tagName: string): boolean {
  return (
    (tagName[0] && tagName[0].toLowerCase() !== tagName[0]) ||
    tagName.includes(".") ||
    /[^a-zA-Z]/.test(tagName[0])
  );
}

export function hasStaticMarker(
  object: StaticMarkerNode | null | undefined,
  path: NodePath
): boolean | undefined {
  if (!object) return false;
  if (
    object.leadingComments &&
    object.leadingComments[0] &&
    object.leadingComments[0].value.trim() === getConfig(path).staticMarker
  )
    return true;
  if (object.expression && typeof object.expression === "object")
    return hasStaticMarker(object.expression as StaticMarkerNode, path);
}

export function isDynamic(
  path: NodePath,
  { checkMember, checkTags, checkCallExpressions = true }: DynamicOptions
): boolean | undefined {
  const config = getConfig(path);
  const expr = path.node;
  if (t.isFunction(expr)) return false;
  if (
    expr.leadingComments &&
    expr.leadingComments[0] &&
    expr.leadingComments[0].value.trim() === config.staticMarker
  ) {
    return false;
  }

  if (
    checkCallExpressions &&
    (t.isCallExpression(expr) ||
      t.isOptionalCallExpression(expr) ||
      t.isTaggedTemplateExpression(expr))
  ) {
    return true;
  }

  if (checkMember && t.isMemberExpression(expr)) {
    // Do not assume property access on namespaced imports as dynamic.
    const object = path.get("object").node;

    if (
      t.isIdentifier(object) &&
      (!expr.computed ||
        !isDynamic(path.get("property"), {
          checkMember,
          checkTags,
          checkCallExpressions
        }))
    ) {
      const binding = path.scope.getBinding(object.name);

      if (binding && binding.path.isImportNamespaceSpecifier()) {
        return false;
      }
    }

    return true;
  }

  if (
    checkMember &&
    (t.isOptionalMemberExpression(expr) ||
      t.isSpreadElement(expr) ||
      (t.isBinaryExpression(expr) && expr.operator === "in"))
  ) {
    return true;
  }

  if (checkTags && (t.isJSXElement(expr) || (t.isJSXFragment(expr) && expr.children.length))) {
    return true;
  }

  let dynamic: boolean | undefined;
  const visitor: Visitor = {
    Function(p) {
      if (t.isObjectMethod(p.node) && p.node.computed) {
        dynamic = isDynamic(p.get("key"), { checkMember, checkTags, checkCallExpressions });
      }
      p.skip();
    },
    CallExpression(p) {
      checkCallExpressions && (dynamic = true) && p.stop();
    },
    OptionalCallExpression(p) {
      checkCallExpressions && (dynamic = true) && p.stop();
    },
    MemberExpression(p) {
      checkMember && (dynamic = true) && p.stop();
    },
    OptionalMemberExpression(p) {
      checkMember && (dynamic = true) && p.stop();
    },
    SpreadElement(p) {
      checkMember && (dynamic = true) && p.stop();
    },
    BinaryExpression(p) {
      checkMember && p.node.operator === "in" && (dynamic = true) && p.stop();
    },
    JSXElement(p) {
      checkTags ? (dynamic = true) && p.stop() : p.skip();
    },
    JSXFragment(p) {
      checkTags && p.node.children.length ? (dynamic = true) && p.stop() : p.skip();
    }
  };
  path.traverse(visitor);
  return dynamic;
}

export function getStaticExpression(
  path: NodePath<t.JSXExpressionContainer>
): string | number | false {
  const node = path.node;
  let value, type;
  return (
    t.isJSXExpressionContainer(node) &&
    t.isJSXElement(path.parent) &&
    !isComponent(getTagName(path.parent)) &&
    !t.isSequenceExpression(node.expression) &&
    (value = path.get("expression").evaluate().value) !== undefined &&
    ((type = typeof value) === "string" || type === "number") &&
    value
  );
}

// remove unnecessary JSX Text nodes
export function filterChildren<TPath extends NodePath>(children: TPath[]): TPath[] {
  return children.filter(
    ({ node: child }) =>
      !(t.isJSXExpressionContainer(child) && t.isJSXEmptyExpression(child.expression)) &&
      (!t.isJSXText(child) || !/^[\r\n]\s*$/.test((child.extra?.raw as string | undefined) ?? ""))
  );
}

export function checkLength(children: NodePath[]): boolean {
  let i = 0;
  children.forEach(path => {
    const child = path.node;
    !(t.isJSXExpressionContainer(child) && t.isJSXEmptyExpression(child.expression)) &&
      (!t.isJSXText(child) ||
        !/^\s*$/.test((child.extra?.raw as string | undefined) ?? "") ||
        /^ *$/.test((child.extra?.raw as string | undefined) ?? "")) &&
      i++;
  });
  return i > 1;
}

export function trimWhitespace(text: string): string {
  text = text.replace(/\r/g, "");
  if (/\n/g.test(text)) {
    text = text
      .split("\n")
      .map((text, i) => (i ? text.replace(/^\s*/g, "") : text))
      .filter((s: string) => !/^\s*$/.test(s))
      .join(" ");
  }
  return text.replace(/\s+/g, " ");
}

export function toEventName(name: string): string {
  return name.slice(2).toLowerCase();
}

// === Hole-scope predicates (shared by dom + ssr generates) ===
//
// A dynamic element child ("hole") whose evaluation can allocate hydration
// ids (create hydratable elements, run components, register memos) gets its
// own owner scope so server and client allocate identical ids regardless of
// WHEN the hole evaluates (eager, deferred by async, or re-run). Both
// generates must agree exactly on which holes qualify, so the predicates
// live here.

function canReturnHydratableChild(node: t.Node): boolean {
  if (t.isTSNonNullExpression(node) || t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node))
    return canReturnHydratableChild(node.expression);
  if (t.isJSXElement(node) || t.isJSXFragment(node) || t.isCallExpression(node)) return true;
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    return !node.computed && t.isIdentifier(node.property, { name: "children" });
  }
  if (t.isConditionalExpression(node)) {
    return canReturnHydratableChild(node.consequent) || canReturnHydratableChild(node.alternate);
  }
  return t.isLogicalExpression(node) && canReturnHydratableChild(node.right);
}

export function canChildSlotAllocateIds(node: NodePath): boolean {
  if (node.isJSXElement() || node.isJSXFragment()) return true;
  if (node.isJSXSpreadChild()) return true;
  return node.isJSXExpressionContainer() && canReturnHydratableChild(node.node.expression);
}

export function wrappedByText(list: TransformResult[], startIndex: number): boolean {
  let index = startIndex,
    wrapped;
  while (--index >= 0) {
    const node = list[index];
    if (!node) continue;
    if (node.text) {
      wrapped = true;
      break;
    }
    if (node.id) return false;
  }
  if (!wrapped) return false;
  index = startIndex;
  while (++index < list.length) {
    const node = list[index];
    if (!node) continue;
    if (node.text) return true;
    if (node.id) return false;
  }
  return false;
}

const BOOLEAN_BINARY_OPS = new Set([
  "==",
  "!=",
  "===",
  "!==",
  "<",
  ">",
  "<=",
  ">=",
  "instanceof",
  "in"
]);

// Statically guaranteed to evaluate to a boolean: the memoized value IS the
// expression's value (`false` is the only falsy boolean), so no `!!` coercion
// is needed and the `&&` wrap can keep the logical form instead of the
// value-preserving ternary (no second evaluation of the left).
function isBooleanExpression(node: t.Expression): boolean {
  return (
    (t.isBinaryExpression(node) && BOOLEAN_BINARY_OPS.has(node.operator)) ||
    (t.isUnaryExpression(node) && node.operator === "!")
  );
}

export function transformCondition(path: ConditionPath, inline: true): ExpressionArrowFunction;
export function transformCondition(
  path: ConditionPath,
  inline: boolean | undefined
): ExpressionArrowFunction | TransformConditionStatements;
export function transformCondition(
  path: ConditionPath,
  inline?: false
): ExpressionArrowFunction | TransformConditionStatements;
export function transformCondition(
  path: ConditionPath,
  inline?: boolean
): TransformConditionResult {
  const config = getConfig(path);
  let expr = path.node as t.Expression;
  // memoWrapper: false compiles memo-less — inline memos collapse to plain
  // thunks and the hoisted declaration keeps its bare arrow.
  const memo = config.memoWrapper
    ? registerImportMethod(path, config.memoWrapper, undefined)
    : undefined;
  let dTest: boolean | undefined,
    cond: t.Expression | undefined,
    id: t.Expression | t.Identifier | undefined;
  if (
    t.isConditionalExpression(expr) &&
    (isDynamic(path.get("consequent"), {
      checkTags: true,
      checkMember: true
    }) ||
      isDynamic(path.get("alternate"), { checkTags: true, checkMember: true }))
  ) {
    dTest = isDynamic(path.get("test"), { checkMember: true });
    if (dTest) {
      cond = expr.test;
      if (!isBooleanExpression(cond))
        cond = t.unaryExpression("!", t.unaryExpression("!", cond, true), true);
      id = inline
        ? memo
          ? t.callExpression(memo, [t.arrowFunctionExpression([], cond)])
          : t.arrowFunctionExpression([], cond)
        : path.scope.generateUidIdentifier("_c$");
      expr.test = t.callExpression(id, []);
      if (t.isConditionalExpression(expr.consequent) || t.isLogicalExpression(expr.consequent)) {
        expr.consequent = transformCondition(path.get("consequent") as ConditionPath, true).body;
      }
      if (t.isConditionalExpression(expr.alternate) || t.isLogicalExpression(expr.alternate)) {
        expr.alternate = transformCondition(path.get("alternate") as ConditionPath, true).body;
      }
    }
  } else if (t.isLogicalExpression(expr)) {
    let nextPath = path as NodePath<t.LogicalExpression>;
    // handle top-level or, ie cond && <A/> || <B/>
    while (nextPath.node.operator !== "&&" && t.isLogicalExpression(nextPath.node.left)) {
      nextPath = nextPath.get("left") as NodePath<t.LogicalExpression>;
    }
    nextPath.node.operator === "&&" &&
      isDynamic(nextPath.get("right"), { checkTags: true, checkMember: true }) &&
      (dTest = isDynamic(nextPath.get("left"), {
        checkMember: true
      }));
    if (dTest) {
      cond = nextPath.node.left;
      // `left && right` is exactly `left ? right : left`. Branch on the
      // memoized truthiness (so truthy-value churn never re-creates the right
      // side) but return the raw left in the alternate so the expression keeps
      // JS value semantics — `0`/`""`/`undefined` flow through instead of
      // collapsing to `false`, matching the untransformed ssr output (#532).
      // Statically boolean lefts skip the ternary: the memo's value is the
      // expression's value, so the logical form is already exact and the left
      // never evaluates twice.
      const boolLeft = isBooleanExpression(cond);
      if (!boolLeft) cond = t.unaryExpression("!", t.unaryExpression("!", cond, true), true);
      id = inline
        ? memo
          ? t.callExpression(memo, [t.arrowFunctionExpression([], cond)])
          : t.arrowFunctionExpression([], cond)
        : path.scope.generateUidIdentifier("_c$");
      if (boolLeft) {
        nextPath.node.left = t.callExpression(id, []);
      } else {
        const alternate = t.cloneNode(nextPath.node.left, true);
        nextPath.replaceWith(
          t.conditionalExpression(t.callExpression(id, []), nextPath.node.right, alternate)
        );
        // replaceWith swaps the node out of the tree; when the `&&` was the
        // top-level expression the local reference is stale.
        expr = path.node as t.Expression;
      }
    }
  }
  if (dTest && !inline && cond && id) {
    const statements: TransformConditionStatements = [
      t.variableDeclaration("var", [
        t.variableDeclarator(
          id as t.LVal,
          memo
            ? t.callExpression(memo, [t.arrowFunctionExpression([], cond)])
            : t.arrowFunctionExpression([], cond)
        )
      ]),
      t.arrowFunctionExpression([], expr)
    ];
    return statements;
  }
  return t.arrowFunctionExpression([], expr) as ExpressionArrowFunction;
}

export function escapeHTML(s: unknown, attr?: boolean): unknown {
  if (typeof s !== "string") return s;
  if (attr) {
    // Attr mode escapes `&` `"` AND `<` (compile-time statics half of the
    // runtime's ESCAPE_ATTR invariant: a raw "<select" byte sequence in SSR
    // output is always a genuine tag start — resolveSSRSelectValues
    // region-jumps on it). Amp first so entities aren't double-escaped;
    // compile-time only, so plain replaces beat pointer games.
    if (!/[&"<]/.test(s)) return s;
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }
  const delim = "<";
  const escDelim = "&lt;";
  let iDelim = s.indexOf(delim);
  let iAmp = s.indexOf("&");

  if (iDelim < 0 && iAmp < 0) return s;

  let left = 0,
    out = "";

  while (iDelim >= 0 && iAmp >= 0) {
    if (iDelim < iAmp) {
      if (left < iDelim) out += s.substring(left, iDelim);
      out += escDelim;
      left = iDelim + 1;
      iDelim = s.indexOf(delim, left);
    } else {
      if (left < iAmp) out += s.substring(left, iAmp);
      out += "&amp;";
      left = iAmp + 1;
      iAmp = s.indexOf("&", left);
    }
  }

  if (iDelim >= 0) {
    do {
      if (left < iDelim) out += s.substring(left, iDelim);
      out += escDelim;
      left = iDelim + 1;
      iDelim = s.indexOf(delim, left);
    } while (iDelim >= 0);
  } else {
    while (iAmp >= 0) {
      if (left < iAmp) out += s.substring(left, iAmp);
      out += "&amp;";
      left = iAmp + 1;
      iAmp = s.indexOf("&", left);
    }
  }

  return left < s.length ? out + s.substring(left) : out;
}

export function convertJSXIdentifier(
  node: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName
): t.Expression {
  if (t.isJSXIdentifier(node)) {
    if (t.isValidIdentifier(node.name)) {
      const identifier = node as unknown as t.Identifier;
      identifier.type = "Identifier";
      return identifier;
    } else {
      return t.stringLiteral(node.name);
    }
  } else if (t.isJSXMemberExpression(node)) {
    return t.memberExpression(
      convertJSXIdentifier(node.object),
      convertJSXIdentifier(node.property)
    );
  }

  return t.stringLiteral(`${node.namespace.name}:${node.name.name}`);
}

export function canNativeSpread(
  key: string,
  { checkNameSpaces }: { checkNameSpaces?: boolean } = {}
): boolean {
  if (checkNameSpaces && key.includes(":") && nonSpreadNameSpaces.has(key.split(":")[0]))
    return false;
  // TODO: figure out how to detect definitely function ref
  if (key === "ref") return false;
  return true;
}

export function inlineCallExpression(node: t.Expression): t.Expression {
  return t.isCallExpression(node) &&
    !node.arguments.length &&
    !t.isCallExpression(node.callee) &&
    !t.isMemberExpression(node.callee)
    ? (node.callee as t.Expression)
    : t.arrowFunctionExpression([], node);
}

// Like inlineCallExpression, but only unwraps IIFEs — never a bare identifier
// call. Used for the first argument of a two-arg effect, where the reactive
// system passes the previous value into the compute function and a bare
// identifier callee would leak that prev into user-authored accessors.
export function wrapForEffect(node: t.Expression): t.Expression {
  return t.isCallExpression(node) &&
    !node.arguments.length &&
    (t.isArrowFunctionExpression(node.callee) || t.isFunctionExpression(node.callee))
    ? node.callee
    : t.arrowFunctionExpression([], node);
}

const chars = "etaoinshrdlucwmfygpbTAOISWCBvkxjqzPHFMDRELNGUKVYJQZX_$";
const base = chars.length;

// Identifiers produced by getNumberedId are used as object shorthand
// destructuring bindings (e.g. `({ in }) => ...`), which is invalid for any
// reserved word. We shift past the natural indices that would encode to one
// so the mapping stays injective and the output is always a valid binding.
const reservedWords = [
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "let",
  "static",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "await"
];

const reservedIndices = reservedWords
  .map(word => {
    let num = 0;
    for (const ch of word) {
      const i = chars.indexOf(ch);
      if (i < 0) return -1;
      num = num * base + i;
    }
    return num;
  })
  .filter(n => n >= 0)
  .sort((a, b) => a - b);

export function getNumberedId(num: number): string {
  for (const r of reservedIndices) {
    if (r <= num) num++;
    else break;
  }

  let out = "";

  do {
    const digit = num % base;

    num = Math.floor(num / base);
    out = chars[digit] + out;
  } while (num !== 0);

  return out;
}

export function escapeStringForTemplate(str: string): string {
  return str.replace(/[{\\`\n\t\b\f\v\r\u2028\u2029]/g, ch => templateEscapes.get(ch)!);
}

const templateEscapes = new Map([
  ["{", "\\{"],
  ["`", "\\`"],
  ["\\", "\\\\"],
  ["\n", "\\n"],
  ["\t", "\\t"],
  ["\b", "\\b"],
  ["\f", "\\f"],
  ["\v", "\\v"],
  ["\r", "\\r"],
  ["\u2028", "\\u2028"],
  ["\u2029", "\\u2029"]
]);

export function evaluateAndInline(
  value: EvaluateAndInlineNode | null | undefined,
  valueNode: NodePath<EvaluateAndInlineNode>
): void {
  if (t.isJSXExpressionContainer(value)) {
    evaluateAndInline(value.expression, valueNode.get("expression"));
  } else if (t.isObjectProperty(value)) {
    evaluateAndInline(value.value, valueNode.get("value"));
  } else if (
    t.isStringLiteral(value) ||
    t.isNumericLiteral(value) ||
    t.isBooleanLiteral(value) ||
    t.isNullLiteral(value)
  ) {
    // already native literal
  } else if (t.isObjectExpression(value)) {
    const properties = value.properties;
    const propertiesNode = valueNode.get("properties");
    for (let i = 0; i < properties.length; i++) {
      evaluateAndInline(properties[i], propertiesNode[i]);
    }
  } else {
    const r = valueNode.evaluate();
    if (r.confident) {
      if (typeof r.value === "string") {
        valueNode.replaceWith(t.stringLiteral(r.value));
      } else if (typeof r.value === "number") {
        valueNode.replaceWith(t.numericLiteral(r.value));
      } else if (typeof r.value === "boolean") {
        valueNode.replaceWith(t.booleanLiteral(r.value));
      }
    }
  }
}

export function getAttributeNamed(
  path: JSXElementPath,
  name: string
): JSXAttributePath | undefined {
  return path
    .get("openingElement")
    .get("attributes")
    .find((attr): attr is JSXAttributePath => {
      if (attr.isJSXAttribute()) {
        const key = t.isJSXNamespacedName(attr.node.name)
          ? `${attr.node.name.namespace.name}:${attr.node.name.name.name}`
          : attr.node.name.name;
        return key === name;
      }
      return false;
    });
}

/**
 * `$key` on an intrinsic element is entity identity — the element-level
 * spelling of the slot-call `$key` — and it is SERVER MARKUP identity: only
 * frame content is morph-managed, so only SSR output carries it. SSR compiles
 * it away into the `_key` attribute the morph matches keyed elements by (the
 * `_hk` family — framework-owned marks, not user-visible `data-*` space); a
 * DOM compile of the same source (a hydratable twin) strips it — client-owned
 * DOM is never morphed, and a literal `$key` attribute is never intended
 * output. Components are untouched everywhere: there `$key` is slot
 * occurrence identity, a prop the runtime owns.
 */
export function renameElementKey(path: JSXElementPath, ssr: boolean): void {
  const attr = getAttributeNamed(path, "$key");
  if (!attr) return;
  if (ssr) renameAttribute(attr, "_key");
  else attr.remove();
}

function renameAttribute(attr: NodePath<t.JSXAttribute>, name: string): void {
  const original = attr.node.name;
  const [ns, propName] = name.split(":");
  if (propName) {
    attr
      .get("name")
      .replaceWith(
        t.inherits(t.jsxNamespacedName(t.jsxIdentifier(ns), t.jsxIdentifier(propName)), original)
      );
  } else {
    attr.get("name").replaceWith(t.inherits(t.jsxIdentifier(name), original));
  }
}

export function transformSpecialCaseAttributes(
  path: JSXElementPath,
  tagName: string,
  isSSR: boolean
): void {
  tagName = tagName.toUpperCase();
  const transforms: { propName: string; attr: NodePath<t.JSXAttribute> }[] = [];

  let hasOrHadAttribute: Record<string, boolean> = {};

  for (const propName in DOMWithState[tagName]) {
    const attr = getAttributeNamed(path, propName);
    if (attr) {
      hasOrHadAttribute[propName] = true;
      transforms.push({ propName, attr: attr as NodePath<t.JSXAttribute> });
    }
  }

  for (const { propName, attr } of transforms) {
    const value =
      attr.node.value == null
        ? t.booleanLiteral(true)
        : t.cloneNode(
            t.isJSXExpressionContainer(attr.node.value)
              ? attr.node.value.expression
              : attr.node.value
          );

    const isDefault =
      propName.includes("default") ||
      !hasOrHadAttribute["default" + propName[0].toUpperCase() + propName.slice(1)];

    const defaultAttrName = propName.replace("default", "").toLowerCase();

    const isLiteral =
      t.isStringLiteral(value) ||
      t.isNumericLiteral(value) ||
      t.isBooleanLiteral(value) ||
      t.isNullLiteral(value);

    if (
      isDefault &&
      tagName === "TEXTAREA" &&
      defaultAttrName === "value" &&
      !t.isNullLiteral(value) &&
      // Only fold into children when SSR (HTML output needs the text content)
      // or when the value is a static literal (template-inlined HTML attribute
      // on parse). For dynamic DOM, prop:* survives the textarea "dirty" flag
      // and preserves any user-supplied children.
      (isSSR || isLiteral)
    ) {
      let child;
      if (t.isStringLiteral(value)) {
        child = t.jsxText(value.value);
        // filterChildren reads child.extra.raw for JSXText nodes
        child.extra = { raw: value.value, rawValue: value.value };
      } else {
        child = t.jsxExpressionContainer(value);
      }
      path.node.children = [child];
      attr.remove();
    } else if (isDefault && (isLiteral || isSSR)) {
      // should inline
      if (propName !== defaultAttrName) {
        renameAttribute(attr, defaultAttrName);
      }
    } else {
      renameAttribute(attr, "prop:" + propName);
    }
  }
}

export function isDOMWithState(tagName: string | undefined, propName: string): number | undefined {
  if (!tagName) return undefined;
  tagName = tagName.toUpperCase();

  if (propName.includes("prop:")) {
    propName = propName.replace("prop:", "");
  }

  return DOMWithState[tagName]?.[propName];
}

export function isStatefulDOMProperty(tagName: string | undefined, propName: string): boolean {
  return isDOMWithState(tagName, propName) === 1;
}

export function isLockedDOMProperty(tagName: string | undefined, propName: string): boolean {
  return !!isDOMWithState(tagName, propName);
}

export function addAttribute(
  path: JSXElementPath,
  name: t.JSXIdentifier,
  value: t.JSXAttribute["value"]
): void {
  path.get("openingElement").pushContainer("attributes", t.jsxAttribute(name, value));
}
