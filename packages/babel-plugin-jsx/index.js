"use strict";

var SyntaxJSX = require("@babel/plugin-syntax-jsx");
var t$2 = require("@babel/types");
var helperModuleImports = require("@babel/helper-module-imports");
var htmlEntities = require("html-entities");

function _interopNamespaceDefault(e) {
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== "default") {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(
          n,
          k,
          d.get
            ? d
            : {
                enumerable: true,
                get: function () {
                  return e[k];
                }
              }
        );
      }
    });
  }
  n.default = e;
  return Object.freeze(n);
}

var t__namespace = /*#__PURE__*/ _interopNamespaceDefault(t$2);

/**
 * Flags
 *
 * - 1 - Stateful property - value derives from reactive state
 * - 2 - Locked to property - value not specially treated
 */
const DOMWithState = {
  INPUT: { value: 1, defaultValue: 2, checked: 1, defaultChecked: 2 },
  SELECT: { value: 1 },
  OPTION: { value: 1, selected: 1, defaultSelected: 2 },
  TEXTAREA: { value: 1, defaultValue: 2 },
  VIDEO: { muted: 1, defaultMuted: 2 },
  AUDIO: { muted: 1, defaultMuted: 2 }
};

const ChildProperties = /*#__PURE__*/ new Set([
  "innerHTML",
  "textContent",
  "innerText",
  "children"
]);

// list of Element events that will be delegated
const DelegatedEvents = /*#__PURE__*/ new Set([
  "beforeinput",
  "click",
  "dblclick",
  "contextmenu",
  "focusin",
  "focusout",
  "input",
  "keydown",
  "keyup",
  "mousedown",
  "mousemove",
  "mouseout",
  "mouseover",
  "mouseup",
  "pointerdown",
  "pointermove",
  "pointerout",
  "pointerover",
  "pointerup",
  "touchend",
  "touchmove",
  "touchstart"
]);

const SVGElements = /*#__PURE__*/ new Set([
  // "a",
  "altGlyph",
  "altGlyphDef",
  "altGlyphItem",
  "animate",
  "animateColor",
  "animateMotion",
  "animateTransform",
  "circle",
  "clipPath",
  "color-profile",
  "cursor",
  "defs",
  "desc",
  "ellipse",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "filter",
  "font",
  "font-face",
  "font-face-format",
  "font-face-name",
  "font-face-src",
  "font-face-uri",
  "foreignObject",
  "g",
  "glyph",
  "glyphRef",
  "hkern",
  "image",
  "line",
  "linearGradient",
  "marker",
  "mask",
  "metadata",
  "missing-glyph",
  "mpath",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialGradient",
  "rect",
  // "script",
  "set",
  "stop",
  // "style",
  "svg",
  "switch",
  "symbol",
  "text",
  "textPath",
  // "title",
  "tref",
  "tspan",
  "use",
  "view",
  "vkern"
]);

const MathMLElements = /*#__PURE__*/ new Set([
  "annotation",
  "annotation-xml",
  "maction",
  "math",
  "menclose",
  "merror",
  "mfenced",
  "mfrac",
  "mi",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mprescripts",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "semantics"
]);

const Namespaces = {
  svg: "http://www.w3.org/2000/svg",
  mathml: "http://www.w3.org/1998/Math/MathML",
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace"
};

const VoidElements = /*#__PURE__*/ new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

const reservedNameSpaces = new Set(["prop"]);

const nonSpreadNameSpaces = new Set(["prop"]);

function getConfig(path) {
  return path.hub.file.metadata.config;
}

const getRendererConfig = (path, renderer) => {
  const config = getConfig(path);
  return config?.renderers?.find(r => r.name === renderer) ?? config;
};

function registerImportMethod(path, name, moduleName) {
  const data = path.scope.getProgramParent().data;
  const imports = data.imports || (data.imports = new Map());
  moduleName = moduleName || getConfig(path).moduleName;
  if (!imports.has(`${moduleName}:${name}`)) {
    let id = helperModuleImports.addNamed(path, name, moduleName, {
      nameHint: `_$${name}`
    });
    imports.set(`${moduleName}:${name}`, id);
    return id;
  } else {
    let iden = imports.get(`${moduleName}:${name}`);
    // the cloning is required to play well with babel-preset-env which is
    // transpiling import as we add them and using the same identifier causes
    // problems with the multiple identifiers of the same thing
    return t__namespace.cloneNode(iden);
  }
}

function jsxElementNameToString(node) {
  if (t__namespace.isJSXMemberExpression(node)) {
    return `${jsxElementNameToString(node.object)}.${node.property.name}`;
  }
  if (t__namespace.isJSXIdentifier(node) || t__namespace.isIdentifier(node)) {
    return node.name;
  }
  return `${node.namespace.name}:${node.name.name}`;
}

function getTagName(tag) {
  const jsxName = tag.openingElement.name;
  return jsxElementNameToString(jsxName);
}

function isComponent(tagName) {
  return (
    (tagName[0] && tagName[0].toLowerCase() !== tagName[0]) ||
    tagName.includes(".") ||
    /[^a-zA-Z]/.test(tagName[0])
  );
}

function hasStaticMarker(object, path) {
  if (!object) return false;
  if (
    object.leadingComments &&
    object.leadingComments[0] &&
    object.leadingComments[0].value.trim() === getConfig(path).staticMarker
  )
    return true;
  if (object.expression && typeof object.expression === "object")
    return hasStaticMarker(object.expression, path);
}

function isDynamic(path, { checkMember, checkTags, checkCallExpressions = true }) {
  const config = getConfig(path);
  const expr = path.node;
  if (t__namespace.isFunction(expr)) return false;
  if (
    expr.leadingComments &&
    expr.leadingComments[0] &&
    expr.leadingComments[0].value.trim() === config.staticMarker
  ) {
    return false;
  }

  if (
    checkCallExpressions &&
    (t__namespace.isCallExpression(expr) ||
      t__namespace.isOptionalCallExpression(expr) ||
      t__namespace.isTaggedTemplateExpression(expr))
  ) {
    return true;
  }

  if (t__namespace.isMemberExpression(expr)) {
    // Do not assume property access on namespaced imports as dynamic.
    const object = path.get("object").node;

    if (
      t__namespace.isIdentifier(object) &&
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
    t__namespace.isOptionalMemberExpression(expr) ||
    t__namespace.isSpreadElement(expr) ||
    (t__namespace.isBinaryExpression(expr) && expr.operator === "in")
  ) {
    return true;
  }

  if (
    checkTags &&
    (t__namespace.isJSXElement(expr) || (t__namespace.isJSXFragment(expr) && expr.children.length))
  ) {
    return true;
  }

  let dynamic;
  const visitor = {
    Function(p) {
      if (t__namespace.isObjectMethod(p.node) && p.node.computed) {
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
      (dynamic = true) && p.stop();
    },
    OptionalMemberExpression(p) {
      (dynamic = true) && p.stop();
    },
    SpreadElement(p) {
      (dynamic = true) && p.stop();
    },
    BinaryExpression(p) {
      p.node.operator === "in" && (dynamic = true) && p.stop();
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

function getStaticExpression(path) {
  const node = path.node;
  let value, type;
  return (
    t__namespace.isJSXExpressionContainer(node) &&
    t__namespace.isJSXElement(path.parent) &&
    !isComponent(getTagName(path.parent)) &&
    !t__namespace.isSequenceExpression(node.expression) &&
    (value = path.get("expression").evaluate().value) !== undefined &&
    ((type = typeof value) === "string" || type === "number") &&
    value
  );
}

// remove unnecessary JSX Text nodes
function filterChildren(children) {
  return children.filter(
    ({ node: child }) =>
      !(
        t__namespace.isJSXExpressionContainer(child) &&
        t__namespace.isJSXEmptyExpression(child.expression)
      ) &&
      (!t__namespace.isJSXText(child) || !/^[\r\n]\s*$/.test(child.extra?.raw ?? ""))
  );
}

function checkLength(children) {
  let i = 0;
  children.forEach(path => {
    const child = path.node;
    !(
      t__namespace.isJSXExpressionContainer(child) &&
      t__namespace.isJSXEmptyExpression(child.expression)
    ) &&
      (!t__namespace.isJSXText(child) ||
        !/^\s*$/.test(child.extra?.raw ?? "") ||
        /^ *$/.test(child.extra?.raw ?? "")) &&
      i++;
  });
  return i > 1;
}

function trimWhitespace(text) {
  text = text.replace(/\r/g, "");
  if (/\n/g.test(text)) {
    text = text
      .split("\n")
      .map((text, i) => (i ? text.replace(/^\s*/g, "") : text))
      .filter(s => !/^\s*$/.test(s))
      .join(" ");
  }
  return text.replace(/\s+/g, " ");
}

function toEventName(name) {
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

function canReturnHydratableChild(node) {
  if (
    t__namespace.isTSNonNullExpression(node) ||
    t__namespace.isTSAsExpression(node) ||
    t__namespace.isTSSatisfiesExpression(node)
  )
    return canReturnHydratableChild(node.expression);
  if (
    t__namespace.isJSXElement(node) ||
    t__namespace.isJSXFragment(node) ||
    t__namespace.isCallExpression(node)
  )
    return true;
  if (t__namespace.isMemberExpression(node) || t__namespace.isOptionalMemberExpression(node)) {
    return !node.computed && t__namespace.isIdentifier(node.property, { name: "children" });
  }
  if (t__namespace.isConditionalExpression(node)) {
    return canReturnHydratableChild(node.consequent) || canReturnHydratableChild(node.alternate);
  }
  return t__namespace.isLogicalExpression(node) && canReturnHydratableChild(node.right);
}

function canChildSlotAllocateIds(node) {
  if (node.isJSXElement() || node.isJSXFragment()) return true;
  if (node.isJSXSpreadChild()) return true;
  return node.isJSXExpressionContainer() && canReturnHydratableChild(node.node.expression);
}

function wrappedByText(list, startIndex) {
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
function isBooleanExpression(node) {
  return (
    (t__namespace.isBinaryExpression(node) && BOOLEAN_BINARY_OPS.has(node.operator)) ||
    (t__namespace.isUnaryExpression(node) && node.operator === "!")
  );
}

function transformCondition(path, inline) {
  const config = getConfig(path);
  let expr = path.node;
  // memoWrapper: false compiles memo-less — inline memos collapse to plain
  // thunks and the hoisted declaration keeps its bare arrow.
  const memo = config.memoWrapper
    ? registerImportMethod(path, config.memoWrapper, undefined)
    : undefined;
  let dTest, cond, id;
  if (
    t__namespace.isConditionalExpression(expr) &&
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
        cond = t__namespace.unaryExpression(
          "!",
          t__namespace.unaryExpression("!", cond, true),
          true
        );
      id = inline
        ? memo
          ? t__namespace.callExpression(memo, [t__namespace.arrowFunctionExpression([], cond)])
          : t__namespace.arrowFunctionExpression([], cond)
        : path.scope.generateUidIdentifier("_c$");
      expr.test = t__namespace.callExpression(id, []);
      if (
        t__namespace.isConditionalExpression(expr.consequent) ||
        t__namespace.isLogicalExpression(expr.consequent)
      ) {
        expr.consequent = transformCondition(path.get("consequent"), true).body;
      }
      if (
        t__namespace.isConditionalExpression(expr.alternate) ||
        t__namespace.isLogicalExpression(expr.alternate)
      ) {
        expr.alternate = transformCondition(path.get("alternate"), true).body;
      }
    }
  } else if (t__namespace.isLogicalExpression(expr)) {
    let nextPath = path;
    // handle top-level or, ie cond && <A/> || <B/>
    while (
      nextPath.node.operator !== "&&" &&
      t__namespace.isLogicalExpression(nextPath.node.left)
    ) {
      nextPath = nextPath.get("left");
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
      if (!boolLeft)
        cond = t__namespace.unaryExpression(
          "!",
          t__namespace.unaryExpression("!", cond, true),
          true
        );
      id = inline
        ? memo
          ? t__namespace.callExpression(memo, [t__namespace.arrowFunctionExpression([], cond)])
          : t__namespace.arrowFunctionExpression([], cond)
        : path.scope.generateUidIdentifier("_c$");
      if (boolLeft) {
        nextPath.node.left = t__namespace.callExpression(id, []);
      } else {
        const alternate = t__namespace.cloneNode(nextPath.node.left, true);
        nextPath.replaceWith(
          t__namespace.conditionalExpression(
            t__namespace.callExpression(id, []),
            nextPath.node.right,
            alternate
          )
        );
        // replaceWith swaps the node out of the tree; when the `&&` was the
        // top-level expression the local reference is stale.
        expr = path.node;
      }
    }
  }
  if (dTest && !inline && cond && id) {
    const statements = [
      t__namespace.variableDeclaration("var", [
        t__namespace.variableDeclarator(
          id,
          memo
            ? t__namespace.callExpression(memo, [t__namespace.arrowFunctionExpression([], cond)])
            : t__namespace.arrowFunctionExpression([], cond)
        )
      ]),
      t__namespace.arrowFunctionExpression([], expr)
    ];

    return statements;
  }
  return t__namespace.arrowFunctionExpression([], expr);
}

function escapeHTML(s, attr) {
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

function convertJSXIdentifier(node) {
  if (t__namespace.isJSXIdentifier(node)) {
    if (t__namespace.isValidIdentifier(node.name)) {
      const identifier = node;
      identifier.type = "Identifier";
      return identifier;
    } else {
      return t__namespace.stringLiteral(node.name);
    }
  } else if (t__namespace.isJSXMemberExpression(node)) {
    return t__namespace.memberExpression(
      convertJSXIdentifier(node.object),
      convertJSXIdentifier(node.property)
    );
  }

  return t__namespace.stringLiteral(`${node.namespace.name}:${node.name.name}`);
}

function canNativeSpread(key, { checkNameSpaces } = {}) {
  if (checkNameSpaces && key.includes(":") && nonSpreadNameSpaces.has(key.split(":")[0]))
    return false;
  // TODO: figure out how to detect definitely function ref
  if (key === "ref") return false;
  return true;
}

function inlineCallExpression(node) {
  return t__namespace.isCallExpression(node) &&
    !node.arguments.length &&
    !t__namespace.isCallExpression(node.callee) &&
    !t__namespace.isMemberExpression(node.callee)
    ? node.callee
    : t__namespace.arrowFunctionExpression([], node);
}

// Like inlineCallExpression, but only unwraps IIFEs — never a bare identifier
// call. Used for the first argument of a two-arg effect, where the reactive
// system passes the previous value into the compute function and a bare
// identifier callee would leak that prev into user-authored accessors.
function wrapForEffect(node) {
  return t__namespace.isCallExpression(node) &&
    !node.arguments.length &&
    (t__namespace.isArrowFunctionExpression(node.callee) ||
      t__namespace.isFunctionExpression(node.callee))
    ? node.callee
    : t__namespace.arrowFunctionExpression([], node);
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

function getNumberedId(num) {
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

function escapeStringForTemplate(str) {
  return str.replace(/[{\\`\n\t\b\f\v\r\u2028\u2029]/g, ch => templateEscapes.get(ch));
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

function evaluateAndInline(value, valueNode) {
  if (t__namespace.isJSXExpressionContainer(value)) {
    evaluateAndInline(value.expression, valueNode.get("expression"));
  } else if (t__namespace.isObjectProperty(value)) {
    evaluateAndInline(value.value, valueNode.get("value"));
  } else if (
    t__namespace.isStringLiteral(value) ||
    t__namespace.isNumericLiteral(value) ||
    t__namespace.isBooleanLiteral(value) ||
    t__namespace.isNullLiteral(value)
  );
  else if (t__namespace.isObjectExpression(value)) {
    const properties = value.properties;
    const propertiesNode = valueNode.get("properties");
    for (let i = 0; i < properties.length; i++) {
      evaluateAndInline(properties[i], propertiesNode[i]);
    }
  } else {
    const r = valueNode.evaluate();
    if (r.confident) {
      if (typeof r.value === "string") {
        valueNode.replaceWith(t__namespace.stringLiteral(r.value));
      } else if (typeof r.value === "number") {
        valueNode.replaceWith(t__namespace.numericLiteral(r.value));
      } else if (typeof r.value === "boolean") {
        valueNode.replaceWith(t__namespace.booleanLiteral(r.value));
      }
    }
  }
}

function getAttributeNamed(path, name) {
  return path
    .get("openingElement")
    .get("attributes")
    .find(attr => {
      if (attr.isJSXAttribute()) {
        const key = t__namespace.isJSXNamespacedName(attr.node.name)
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
function renameElementKey(path, ssr) {
  const attr = getAttributeNamed(path, "$key");
  if (!attr) return;
  if (ssr) renameAttribute(attr, "_key");
  else attr.remove();
}

function renameAttribute(attr, name) {
  const original = attr.node.name;
  const [ns, propName] = name.split(":");
  if (propName) {
    attr
      .get("name")
      .replaceWith(
        t__namespace.inherits(
          t__namespace.jsxNamespacedName(
            t__namespace.jsxIdentifier(ns),
            t__namespace.jsxIdentifier(propName)
          ),
          original
        )
      );
  } else {
    attr.get("name").replaceWith(t__namespace.inherits(t__namespace.jsxIdentifier(name), original));
  }
}

function transformSpecialCaseAttributes(path, tagName, isSSR) {
  tagName = tagName.toUpperCase();
  const transforms = [];

  let hasOrHadAttribute = {};

  for (const propName in DOMWithState[tagName]) {
    const attr = getAttributeNamed(path, propName);
    if (attr) {
      hasOrHadAttribute[propName] = true;
      transforms.push({ propName, attr: attr });
    }
  }

  for (const { propName, attr } of transforms) {
    const value =
      attr.node.value == null
        ? t__namespace.booleanLiteral(true)
        : t__namespace.cloneNode(
            t__namespace.isJSXExpressionContainer(attr.node.value)
              ? attr.node.value.expression
              : attr.node.value
          );

    const isDefault =
      propName.includes("default") ||
      !hasOrHadAttribute["default" + propName[0].toUpperCase() + propName.slice(1)];

    const defaultAttrName = propName.replace("default", "").toLowerCase();

    const isLiteral =
      t__namespace.isStringLiteral(value) ||
      t__namespace.isNumericLiteral(value) ||
      t__namespace.isBooleanLiteral(value) ||
      t__namespace.isNullLiteral(value);

    if (
      isDefault &&
      tagName === "TEXTAREA" &&
      defaultAttrName === "value" &&
      !t__namespace.isNullLiteral(value) &&
      // Only fold into children when SSR (HTML output needs the text content)
      // or when the value is a static literal (template-inlined HTML attribute
      // on parse). For dynamic DOM, prop:* survives the textarea "dirty" flag
      // and preserves any user-supplied children.
      (isSSR || isLiteral)
    ) {
      let child;
      if (t__namespace.isStringLiteral(value)) {
        child = t__namespace.jsxText(value.value);
        // filterChildren reads child.extra.raw for JSXText nodes
        child.extra = { raw: value.value, rawValue: value.value };
      } else {
        child = t__namespace.jsxExpressionContainer(value);
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

function isDOMWithState(tagName, propName) {
  if (!tagName) return undefined;
  tagName = tagName.toUpperCase();

  if (propName.includes("prop:")) {
    propName = propName.replace("prop:", "");
  }

  return DOMWithState[tagName]?.[propName];
}

function isStatefulDOMProperty(tagName, propName) {
  return isDOMWithState(tagName, propName) === 1;
}

function isLockedDOMProperty(tagName, propName) {
  return !!isDOMWithState(tagName, propName);
}

const InlineElements = [
  "a",
  "abbr",
  "acronym",
  "b",
  "bdi",
  "bdo",
  "big",
  "br",
  "button",
  "canvas",
  "cite",
  "code",
  "data",
  "datalist",
  "del",
  "dfn",
  "em",
  "embed",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "map",
  "mark",
  "meter",
  "noscript",
  "object",
  "output",
  "picture",
  "progress",
  "q",
  "ruby",
  "s",
  "samp",
  "script",
  "select",
  "slot",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "svg",
  "template",
  "textarea",
  "time",
  "u",
  "tt",
  "var",
  "video"
];

const BlockElements = [
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul"
];

const t$1 = t__namespace;

function isNamedAttribute(attribute, name) {
  return (
    t$1.isJSXAttribute(attribute.node) &&
    t$1.isJSXIdentifier(attribute.node.name) &&
    attribute.node.name.name === name
  );
}

/**
 * Whether an element participates in the element-claim contract: `a[href]`
 * and `form[action]` (attribute present in any form, or a spread that may
 * carry it). Compiled output claims these at creation via `claimElement` so
 * consumers (e.g. a router's link-state layer) can track them without
 * per-element components or observers. Dormant at runtime until a consumer
 * registers.
 */
function isClaimTarget(node) {
  const tagName = getTagName(node);
  const attrName = tagName === "a" ? "href" : tagName === "form" ? "action" : undefined;
  if (!attrName) return false;
  return node.openingElement.attributes.some(
    attr =>
      t$1.isJSXSpreadAttribute(attr) ||
      (t$1.isJSXAttribute(attr) && t$1.isJSXIdentifier(attr.name) && attr.name.name === attrName)
  );
}

const alwaysClose = [
  "title",
  "style",
  "a",
  "strong",
  "small",
  "b",
  "u",
  "i",
  "em",
  "s",
  "code",
  "object",
  "table",
  "button",
  "textarea",
  "select",
  "iframe",
  "script",
  "noscript",
  "template",
  "fieldset"
];

function transformElement$3(path, info = {}) {
  let tagName = getTagName(path.node);

  path
    .get("openingElement")
    .get("attributes")
    .forEach(attr => {
      if (t$1.isJSXAttribute(attr.node)) evaluateAndInline(attr.node.value, attr.get("value"));
    });

  let isWrapped = false;
  let wrapperTag = "";
  if (info.topLevel) {
    /**
     * XML handling.
     *
     * 1. XML partials are wrapped into their "owner" tag <svg>/<math>
     * 2. "xmlns" attribute is also used to know if a tag needs to be wrapped. For example `<a
     *    xmlns="http://www.w3.org/2000/svg"/>` becomes `<svg><a/></svg>`
     * 3. "xmlns" attribute is not needed by the browser and removed to make templates smaller
     */
    const xmlnsAttr = getAttributeNamed(path, "xmlns");

    // svg and math tags are already wrapped
    if (tagName !== "svg" && tagName !== "math") {
      const xmlnsValue = xmlnsAttr?.node.value;
      const xmlns = t__namespace.isJSXExpressionContainer(xmlnsValue)
        ? xmlnsValue.expression.value
        : t__namespace.isStringLiteral(xmlnsValue)
          ? xmlnsValue.value
          : undefined;

      if (SVGElements.has(tagName) || xmlns === Namespaces.svg) {
        isWrapped = true;
        wrapperTag = "svg";
        xmlnsAttr && xmlnsAttr.remove();
      } else if (MathMLElements.has(tagName) || xmlns === Namespaces.mathml) {
        isWrapped = true;
        wrapperTag = "math";
        xmlnsAttr && xmlnsAttr.remove();
      }
    } else {
      xmlnsAttr && xmlnsAttr.remove();
    }
  }

  let config = getConfig(path),
    voidTag = VoidElements.has(tagName),
    hasCustomElement =
      tagName.indexOf("-") > -1 ||
      path
        .get("openingElement")
        .get("attributes")
        .some(
          a =>
            t$1.isJSXAttribute(a.node) &&
            !t$1.isJSXNamespacedName(a.node.name) &&
            a.node.name.name === "is"
        ),
    isImportNode =
      hasCustomElement ||
      ((tagName === "img" || tagName === "iframe") &&
        path
          .get("openingElement")
          .get("attributes")
          .some(
            a =>
              t$1.isJSXAttribute(a.node) &&
              !t$1.isJSXNamespacedName(a.node.name) &&
              a.node.name.name === "loading"
          )),
    results = {
      template: `<${tagName}`,
      templateWithClosingTags: `<${tagName}`,
      declarations: [],
      exprs: [],
      dynamics: [],
      postExprs: [],
      isImportNode,
      isWrapped,
      tagName,
      renderer: "dom",
      skipTemplate: false
    };

  if (!config.inlineStyles) {
    path
      .get("openingElement")
      .get("attributes")
      .forEach(a => {
        if (
          t$1.isJSXAttribute(a.node) &&
          !t$1.isJSXNamespacedName(a.node.name) &&
          a.node.name.name === "style"
        ) {
          let value =
            t$1.isJSXExpressionContainer(a.node.value) &&
            !t$1.isJSXEmptyExpression(a.node.value.expression)
              ? a.node.value.expression
              : t$1.isStringLiteral(a.node.value)
                ? a.node.value
                : null;
          if (t$1.isStringLiteral(value)) {
            // jsx attribute value is a sting that may takes more than one line
            value = t$1.templateLiteral(
              [t$1.templateElement({ raw: value.value, cooked: value.value })],
              []
            );
          }
          if (value)
            a.get("value").replaceWith(
              t$1.jSXExpressionContainer(
                t$1.callExpression(t$1.arrowFunctionExpression([], value), [])
              )
            );
        }
      });
  }

  path
    .get("openingElement")
    .get("attributes")
    .some(a => {
      if (
        t$1.isJSXAttribute(a.node) &&
        !t$1.isJSXNamespacedName(a.node.name) &&
        a.node.name.name === "_hk"
      ) {
        a.remove();
        let filename = "";
        try {
          filename = path.scope.getProgramParent().path.hub.file?.opts?.filename || "";
        } catch (e) {}

        console.log(
          "\n" +
            path
              .buildCodeFrameError(
                `"_hk" attribute found in template, which could potentially cause hydration miss-matches. Usually happens when copying and pasting Solid SSRed code into JSX. Please remove the attribute from the JSX. \n\n${filename}\n`
              )
              .toString()
        );
      }
    });
  if (config.hydratable && (tagName === "html" || tagName === "head" || tagName === "body")) {
    results.skipTemplate = true;
  }
  if (wrapperTag !== "") {
    results.template = `<${wrapperTag}>` + results.template;
    results.templateWithClosingTags = `<${wrapperTag}>` + results.templateWithClosingTags;
  }
  if (!info.skipId) {
    results.id = path.scope.generateUidIdentifier("el$");
  }
  // Claim contract: a[href] / form[action] elements are claimed at creation
  // so registered consumers (e.g. a router's link-state layer) see them.
  // detectExpressions forces the id chain, so claim targets always have one.
  // Emitted ahead of the attribute expressions — writes to the claimed
  // attribute recheck through the runtime's setAttribute, so order stays
  // correct either way, but "claim at creation" reads first.
  if (results.id && isClaimTarget(path.node)) {
    results.exprs.push(
      t$1.expressionStatement(
        t$1.callExpression(
          registerImportMethod(path, "claimElement", getRendererConfig(path, "dom").moduleName),
          [results.id]
        )
      )
    );
  }
  transformAttributes$2(path, results);
  if (config.contextToCustomElements && (tagName === "slot" || hasCustomElement)) {
    contextToCustomElement(path, results);
  }
  results.template += ">";
  results.templateWithClosingTags += ">";
  if (!voidTag) {
    // always close tags can still be skipped if they have no closing parents and are the last element
    const toBeClosed =
      !info.lastElement ||
      !config.omitLastClosingTag ||
      (info.toBeClosed && (!config.omitNestedClosingTags || info.toBeClosed.has(tagName)));
    if (toBeClosed) {
      results.toBeClosed = new Set(info.toBeClosed || alwaysClose);
      results.toBeClosed.add(tagName);
      if (InlineElements.includes(tagName)) BlockElements.forEach(i => results.toBeClosed.add(i));
    } else results.toBeClosed = info.toBeClosed;
    if (tagName !== "noscript") transformChildren$2(path, results, config);
    if (toBeClosed) results.template += `</${tagName}>`;
    results.templateWithClosingTags += `</${tagName}>`;
  }
  if (info.topLevel && config.hydratable && results.hasHydratableEvent) {
    let runHydrationEvents = registerImportMethod(
      path,
      "runHydrationEvents",
      getRendererConfig(path, "dom").moduleName
    );
    results.postExprs.push(t$1.expressionStatement(t$1.callExpression(runHydrationEvents, [])));
  }
  if (wrapperTag !== "") {
    results.template += `</${wrapperTag}>`;
    results.templateWithClosingTags += `</${wrapperTag}>`;
  }
  return results;
}

function setAttr$2(
  path,
  elem,
  name,
  value,
  { dynamic, prevId, tagName, styleProperty, classProperty } = {}
) {
  // pull out namespace
  const config = getConfig(path);
  let parts, namespace;
  if ((parts = name.split(":")) && parts[1] && reservedNameSpaces.has(parts[0])) {
    name = parts[1];
    namespace = parts[0];
  }

  // `styleProperty` and `classProperty` are set only for properties extracted
  // by the `style={{...}}` / `class={{...}}` splitters — never for user-written
  // `style:foo` / `class:foo`, which fall through to literal attributes.
  if (styleProperty) {
    if (parts && parts[1] && parts[0] === "style") name = parts[1];
    return t$1.callExpression(
      registerImportMethod(path, "setStyleProperty", getRendererConfig(path, "dom").moduleName),
      [
        elem,
        t$1.stringLiteral(name),
        t$1.isAssignmentExpression(value) && t$1.isIdentifier(value.left) ? value.right : value
      ]
    );
  }

  if (classProperty) {
    if (parts && parts[1] && parts[0] === "class") name = parts[1];
    return t$1.callExpression(
      t$1.memberExpression(
        t$1.memberExpression(elem, t$1.identifier("classList")),
        t$1.identifier("toggle")
      ),
      [
        t$1.stringLiteral(name),
        dynamic ? value : t$1.unaryExpression("!", t$1.unaryExpression("!", value))
      ]
    );
  }

  if (name === "style") {
    return t$1.callExpression(
      registerImportMethod(path, "style", getRendererConfig(path, "dom").moduleName),
      prevId ? [elem, value, prevId] : [elem, value]
    );
  }

  if (name === "class") {
    return t$1.callExpression(
      registerImportMethod(path, "className", getRendererConfig(path, "dom").moduleName),
      prevId ? [elem, value, prevId] : [elem, value]
    );
  }

  if (dynamic && name === "textContent") {
    if (config.hydratable) {
      return t$1.callExpression(registerImportMethod(path, "setProperty"), [
        elem,
        t$1.stringLiteral("data"),
        value
      ]);
    }
    return t$1.assignmentExpression("=", t$1.memberExpression(elem, t$1.identifier("data")), value);
  }

  const isChildProp = ChildProperties.has(name);
  const isLocked = isLockedDOMProperty(tagName, name);

  if (isChildProp || namespace === "prop" || isLocked) {
    if (config.hydratable && namespace !== "prop" && !isLocked) {
      return t$1.callExpression(registerImportMethod(path, "setProperty"), [
        elem,
        t$1.stringLiteral(name),
        value
      ]);
    }

    const assignment = t$1.assignmentExpression(
      "=",
      t$1.memberExpression(elem, t$1.identifier(name)),
      value
    );
    // handle select/options... TODO: consider other ways in the future
    // TODO: there may be a race condition here
    if (name === "value" && tagName === "select") {
      return t$1.logicalExpression(
        "||",
        t$1.callExpression(t$1.identifier("queueMicrotask"), [
          t$1.arrowFunctionExpression([], assignment)
        ]),
        assignment
      );
    }
    if (
      (name === "value" || name === "defaultValue") &&
      (tagName === "input" || tagName === "textarea") &&
      !t$1.isStringLiteral(value) &&
      !t$1.isNumericLiteral(value)
    ) {
      // prevents undefined on input/textarea.value/defaultValue, fallback to empty string
      return t$1.assignmentExpression(
        "=",
        t$1.memberExpression(elem, t$1.identifier(name)),
        t$1.logicalExpression("??", value, t$1.stringLiteral(""))
      );
    }
    return assignment;
  }

  const ns = name.indexOf(":") > -1 && Namespaces[name.split(":")[0]];
  if (ns) {
    return t$1.callExpression(
      registerImportMethod(path, "setAttributeNS", getRendererConfig(path, "dom").moduleName),
      [elem, t$1.stringLiteral(ns), t$1.stringLiteral(name), value]
    );
  } else {
    return t$1.callExpression(
      registerImportMethod(path, "setAttribute", getRendererConfig(path, "dom").moduleName),
      [elem, t$1.stringLiteral(name), value]
    );
  }
}

function detectResolvableEventHandler(attribute, handler) {
  while (t$1.isIdentifier(handler)) {
    const lookup = attribute.scope.getBinding(handler.name);
    if (lookup) {
      if (t$1.isVariableDeclarator(lookup.path.node)) {
        handler = lookup.path.node.init;
      } else if (t$1.isFunctionDeclaration(lookup.path.node)) {
        return true;
      } else return false;
    } else return false;
  }
  return t$1.isFunction(handler);
}

function transformAttributes$2(path, results) {
  let elem = results.id,
    hasHydratableEvent = false,
    children,
    spreadExpr,
    attributes = path.get("openingElement").get("attributes");
  const tagName = getTagName(path.node),
    hasChildren = path.node.children.length > 0,
    config = getConfig(path);

  // preprocess spreads
  if (attributes.some(attribute => t$1.isJSXSpreadAttribute(attribute.node))) {
    [attributes, spreadExpr] = processSpreads$1(path, attributes, {
      elem,
      hasChildren
    });
    path.get("openingElement").set(
      "attributes",
      attributes.map(a => a.node)
    );
    //NOTE: can't be checked at compile time so add to compiled output
    hasHydratableEvent = true;
  } else {
    const seenAttributes = {};
    const duplicates = [];
    path
      .get("openingElement")
      .get("attributes")
      .forEach(attr => {
        if (!t$1.isJSXAttribute(attr.node)) return;
        const key = t$1.isJSXNamespacedName(attr.node.name)
          ? `${attr.node.name.namespace.name}:${attr.node.name.name.name}`
          : attr.node.name.name;

        if (key !== "ref" && seenAttributes[key]) {
          duplicates.push(seenAttributes[key]);
        }
        seenAttributes[key] = attr;
      });
    for (const duplicate of duplicates) {
      duplicate.remove();
    }
  }

  /**
   * Inline styles
   *
   * 1. When string
   * 2. When is an object, the key is a string, and value is string/numeric
   * 3. Remove properties from object when value is undefined/null
   * 4. When `value.evaluate().confident`
   *
   * Also, when `key` is computed value is also `value.evaluate().confident`
   */

  attributes = path.get("openingElement").get("attributes");

  const styleAttributes = attributes.filter(a => isNamedAttribute(a, "style"));
  if (styleAttributes.length > 0) {
    let inlinedStyle = "";

    for (let i = 0; i < styleAttributes.length; i++) {
      const attr = styleAttributes[i];

      let value = attr.node.value;

      if (t$1.isJSXExpressionContainer(value)) {
        value = value.expression;
      }

      if (t$1.isStringLiteral(value)) {
        inlinedStyle += `${value.value.replace(/;$/, "")};`;
        attr.remove();
      } else if (t$1.isObjectExpression(value)) {
        const styleObject = value;
        const properties = styleObject.properties;
        const propertiesNode = attr.get("value").get("expression").get("properties");
        const toRemoveProperty = [];
        for (let i = 0; i < properties.length; i++) {
          const property = properties[i];

          if (!t$1.isObjectProperty(property)) continue;
          if (property.computed) {
            /* { [computed]: `${1+1}px` } => { [computed]: `2px` } */
            const r = propertiesNode[i].get("value").evaluate();
            if (r.confident && (typeof r.value === "string" || typeof r.value === "number")) {
              property.value = t$1.inherits(t$1.stringLiteral(`${r.value}`), property.value);
            }
            // computed cannot be inlined - maybe can be evaluated but this is pretty rare
            continue;
          }

          {
            const key = t$1.isIdentifier(property.key) ? property.key.name : property.key.value;
            if (t$1.isStringLiteral(property.value) || t$1.isNumericLiteral(property.value)) {
              inlinedStyle += `${key}:${property.value.value};`;
              toRemoveProperty.push(property);
            } else if (
              (t$1.isIdentifier(property.value) && property.value.name === "undefined") ||
              t$1.isNullLiteral(property.value)
            ) {
              toRemoveProperty.push(property);
            } else {
              const r = propertiesNode[i].get("value").evaluate();
              if (r.confident && (typeof r.value === "string" || typeof r.value === "number")) {
                inlinedStyle += `${key}:${r.value};`;
                toRemoveProperty.push(property);
              }
            }
          }
        }
        for (const remove of toRemoveProperty) {
          styleObject.properties.splice(styleObject.properties.indexOf(remove), 1);
        }
        if (styleObject.properties.length === 0) {
          attr.remove();
        }
      }
    }

    if (inlinedStyle !== "") {
      const styleAttribute = t$1.jsxAttribute(
        t$1.jsxIdentifier("style"),
        t$1.stringLiteral(inlinedStyle.replace(/;$/, ""))
      );
      path.get("openingElement").node.attributes.push(styleAttribute);
    }
  }

  // Split remaining `style={{...}}` object props out into individual attributes
  // marked `_styleProperty` so they compile to `setStyleProperty()` calls. The
  // marker keeps user-written `style:foo` literal (no marker, no special
  // handling).
  const styleObjectAttribute = path
    .get("openingElement")
    .get("attributes")
    .find(a => {
      if (!isNamedAttribute(a, "style")) return false;
      const value = a.node.value;
      return (
        t$1.isJSXExpressionContainer(value) &&
        t$1.isObjectExpression(value.expression) &&
        !value.expression.properties.some(p => t$1.isSpreadElement(p))
      );
    });
  if (styleObjectAttribute) {
    const styleValue = styleObjectAttribute.node.value;

    let i = 0,
      leading = styleValue.expression.leadingComments;
    styleValue.expression.properties.slice().forEach((p, index) => {
      if (!t$1.isObjectProperty(p)) return;
      if (!p.computed) {
        if (leading) p.value.leadingComments = leading;
        const newAttr = t$1.jsxAttribute(
          t$1.jsxNamespacedName(
            t$1.jsxIdentifier("style"),
            t$1.jsxIdentifier(t$1.isIdentifier(p.key) ? p.key.name : String(p.key.value))
          ),
          t$1.jsxExpressionContainer(p.value)
        );
        newAttr._styleProperty = true;
        path
          .get("openingElement")
          .node.attributes.splice(Number(styleObjectAttribute.key) + ++i, 0, newAttr);
        styleValue.expression.properties.splice(index - i - 1, 1);
      }
    });
    if (!styleValue.expression.properties.length)
      path.get("openingElement").node.attributes.splice(Number(styleObjectAttribute.key), 1);
  }

  // preprocess leading static classes in fixed-shape class arrays
  attributes = path.get("openingElement").get("attributes");
  const classArrayAttribute = attributes.find(
    a =>
      isNamedAttribute(a, "class") &&
      t$1.isJSXExpressionContainer(a.node.value) &&
      t$1.isArrayExpression(a.node.value.expression)
  );
  if (classArrayAttribute) {
    const classArrayValue = classArrayAttribute.node.value;

    const elements = classArrayValue.expression.elements;
    let i = 0,
      staticClasses = [];
    while (t$1.isStringLiteral(elements[i])) {
      staticClasses.push(elements[i].value);
      i++;
    }
    const dynamicClassElement = elements[i];
    const staticClassSet = new Set(
      staticClasses.flatMap(className => trimWhitespace(className).split(/\s+/).filter(Boolean))
    );
    if (
      staticClasses.length &&
      i === elements.length - 1 &&
      t$1.isObjectExpression(dynamicClassElement) &&
      !dynamicClassElement.properties.some(
        p =>
          t$1.isSpreadElement(p) ||
          p.computed ||
          (t$1.isStringLiteral(p.key) &&
            (p.key.value.includes(" ") || p.key.value.includes(":"))) ||
          staticClassSet.has(t$1.isIdentifier(p.key) ? p.key.name : String(p.key.value))
      )
    ) {
      classArrayAttribute.node.value = t$1.stringLiteral(staticClasses.join(" "));
      path
        .get("openingElement")
        .node.attributes.splice(
          Number(classArrayAttribute.key) + 1,
          0,
          t$1.jsxAttribute(
            t$1.jsxIdentifier("class"),
            t$1.jsxExpressionContainer(dynamicClassElement)
          )
        );
    }
  }

  // preprocess optimal class objects
  attributes = path.get("openingElement").get("attributes");
  const classListAttribute = attributes.find(
    a =>
      isNamedAttribute(a, "class") &&
      t$1.isJSXExpressionContainer(a.node.value) &&
      t$1.isObjectExpression(a.node.value.expression) &&
      !a.node.value.expression.properties.some(
        p =>
          t$1.isSpreadElement(p) ||
          p.computed ||
          (t$1.isStringLiteral(p.key) && (p.key.value.includes(" ") || p.key.value.includes(":")))
      )
  );
  if (classListAttribute) {
    const classListValue = classListAttribute.node.value;

    let i = 0,
      leading = classListValue.expression.leadingComments,
      classListProperties = classListAttribute.get("value").get("expression").get("properties");
    classListProperties.slice().forEach((propPath, index) => {
      const p = propPath.node;
      if (!t$1.isObjectProperty(p)) return;
      const { confident, value: computed } = propPath.get("value").evaluate();
      if (leading) p.value.leadingComments = leading;
      if (!confident) {
        const newAttr = t$1.jsxAttribute(
          t$1.jsxNamespacedName(
            t$1.jsxIdentifier("class"),
            t$1.jsxIdentifier(t$1.isIdentifier(p.key) ? p.key.name : String(p.key.value))
          ),
          t$1.jsxExpressionContainer(p.value)
        );
        newAttr._classProperty = true;
        path
          .get("openingElement")
          .node.attributes.splice(Number(classListAttribute.key) + ++i, 0, newAttr);
      } else if (computed) {
        path
          .get("openingElement")
          .node.attributes.splice(
            Number(classListAttribute.key) + ++i,
            0,
            t$1.jsxAttribute(
              t$1.jsxIdentifier("class"),
              t$1.stringLiteral(t$1.isIdentifier(p.key) ? p.key.name : String(p.key.value))
            )
          );
      }
      classListProperties.splice(index - i - 1, 1);
    });
    if (!classListProperties.length)
      path.get("openingElement").node.attributes.splice(Number(classListAttribute.key), 1);
  }

  // combine class properties
  attributes = path.get("openingElement").get("attributes");
  const classAttributes = attributes.filter(a => isNamedAttribute(a, "class"));
  if (classAttributes.length > 1) {
    const first = classAttributes[0].node,
      values = [],
      quasis = [t$1.templateElement({ raw: "" })];
    for (let i = 0; i < classAttributes.length; i++) {
      const attr = classAttributes[i].node,
        isLast = i === classAttributes.length - 1;
      if (!t$1.isJSXExpressionContainer(attr.value)) {
        const prev = quasis.pop();
        quasis.push(
          t$1.templateElement({
            raw: (prev ? prev.value.raw : "") + `${attr.value.value}` + (isLast ? "" : " ")
          })
        );
      } else {
        values.push(t$1.logicalExpression("||", attr.value.expression, t$1.stringLiteral("")));
        quasis.push(t$1.templateElement({ raw: isLast ? "" : " " }));
      }
      i && attributes.splice(attributes.indexOf(classAttributes[i]), 1);
    }
    if (values.length)
      first.value = t$1.jsxExpressionContainer(t$1.templateLiteral(quasis, values));
    else first.value = t$1.stringLiteral(quasis[0].value.raw);
  }
  path.get("openingElement").set(
    "attributes",
    attributes.map(a => a.node)
  );

  let needsSpacing = true;

  // scoped because of `needsSpacing`
  function inlineAttributeOnTemplate(key, results, value) {
    results.template += `${needsSpacing ? " " : ""}${key}`;

    if (!value) {
      needsSpacing = true;
      return;
    }

    let text = String(value.value);
    let needsQuoting = !config.omitQuotes;

    if (key === "style" || key === "class") {
      text = trimWhitespace(text);
      if (key === "style") {
        text = text.replace(/; /g, ";").replace(/: /g, ":");
      }
    }

    if (!text.length) {
      needsSpacing = true;
      results.template += ``;
      return;
    }

    for (let i = 0, len = text.length; i < len; i++) {
      let char = text[i];

      if (
        char === "'" ||
        char === '"' ||
        char === " " ||
        char === "\t" ||
        char === "\n" ||
        char === "\r" ||
        char === "`" ||
        char === "=" ||
        char === "<" ||
        char === ">"
      ) {
        needsQuoting = true;
      }
    }

    if (needsQuoting) {
      needsSpacing = !config.omitAttributeSpacing;
      results.template += `="${escapeHTML(text, true)}"`;
    } else {
      needsSpacing = true;
      results.template += `=${escapeHTML(text, true)}`;
    }
  }

  path
    .get("openingElement")
    .get("attributes")
    .forEach(attribute => {
      if (!t$1.isJSXAttribute(attribute.node)) return;
      const node = attribute.node;
      const isStyleProperty = node._styleProperty === true;
      const isClassProperty = node._classProperty === true;
      let value = node.value,
        key = t$1.isJSXNamespacedName(node.name)
          ? `${node.name.namespace.name}:${node.name.name.name}`
          : node.name.name,
        reservedNameSpace =
          isStyleProperty ||
          isClassProperty ||
          (t$1.isJSXNamespacedName(node.name) && reservedNameSpaces.has(node.name.namespace.name));
      if (t$1.isJSXExpressionContainer(value)) {
        const evaluated = attribute.get("value").get("expression").evaluate().value;
        let type;
        if (
          evaluated !== undefined &&
          ((type = typeof evaluated) === "string" || type === "number")
        ) {
          if (type === "number" && key.startsWith("prop:")) {
            value = t$1.jsxExpressionContainer(t$1.numericLiteral(evaluated));
          } else value = t$1.stringLiteral(String(evaluated));
        }
      }
      if (
        t$1.isJSXNamespacedName(node.name) &&
        reservedNameSpace &&
        !t$1.isJSXExpressionContainer(value)
      ) {
        node.value = value = t$1.jsxExpressionContainer(value || t$1.jsxEmptyExpression());
      }
      if (
        t$1.isJSXExpressionContainer(value) &&
        (reservedNameSpace ||
          !(
            t$1.isStringLiteral(value.expression) ||
            t$1.isNumericLiteral(value.expression) ||
            t$1.isBooleanLiteral(value.expression)
          ))
      ) {
        if (t$1.isJSXEmptyExpression(value.expression)) return;
        if (key === "ref") {
          // Normalize expressions for non-null and type-as
          while (
            t$1.isTSNonNullExpression(value.expression) ||
            t$1.isTSAsExpression(value.expression)
          ) {
            value.expression = value.expression.expression;
          }
          let binding,
            isConstant =
              t$1.isIdentifier(value.expression) &&
              (binding = path.scope.getBinding(value.expression.name)) &&
              (binding.kind === "const" || binding.kind === "module");
          if (!isConstant && t$1.isLVal(value.expression)) {
            const refIdentifier = path.scope.generateUidIdentifier("_ref$");
            results.exprs.unshift(
              t$1.variableDeclaration("var", [
                t$1.variableDeclarator(refIdentifier, value.expression)
              ]),
              t$1.expressionStatement(
                t$1.conditionalExpression(
                  t$1.logicalExpression(
                    "||",
                    t$1.binaryExpression(
                      "===",
                      t$1.unaryExpression("typeof", refIdentifier),
                      t$1.stringLiteral("function")
                    ),
                    t$1.callExpression(
                      t$1.memberExpression(t$1.identifier("Array"), t$1.identifier("isArray")),
                      [refIdentifier]
                    )
                  ),
                  t$1.callExpression(
                    registerImportMethod(path, "ref", getRendererConfig(path, "dom").moduleName),
                    [t$1.arrowFunctionExpression([], refIdentifier), elem]
                  ),
                  t$1.assignmentExpression("=", value.expression, elem)
                )
              )
            );
          } else if (
            isConstant ||
            t$1.isFunction(value.expression) ||
            t$1.isArrayExpression(value.expression)
          ) {
            results.exprs.unshift(
              t$1.expressionStatement(
                t$1.callExpression(
                  registerImportMethod(path, "ref", getRendererConfig(path, "dom").moduleName),
                  [t$1.arrowFunctionExpression([], value.expression), elem]
                )
              )
            );
          } else {
            const refIdentifier = path.scope.generateUidIdentifier("_ref$");
            results.exprs.unshift(
              t$1.variableDeclaration("var", [
                t$1.variableDeclarator(refIdentifier, value.expression)
              ]),
              t$1.expressionStatement(
                t$1.logicalExpression(
                  "&&",
                  t$1.logicalExpression(
                    "||",
                    t$1.binaryExpression(
                      "===",
                      t$1.unaryExpression("typeof", refIdentifier),
                      t$1.stringLiteral("function")
                    ),
                    t$1.callExpression(
                      t$1.memberExpression(t$1.identifier("Array"), t$1.identifier("isArray")),
                      [refIdentifier]
                    )
                  ),
                  t$1.callExpression(
                    registerImportMethod(path, "ref", getRendererConfig(path, "dom").moduleName),
                    [t$1.arrowFunctionExpression([], refIdentifier), elem]
                  )
                )
              )
            );
          }
        } else if (key === "children") {
          children = value;
        } else if (key.startsWith("on")) {
          const ev = toEventName(key);
          if (
            config.delegateEvents &&
            (DelegatedEvents.has(ev) || config.delegatedEvents.indexOf(ev) !== -1)
          ) {
            // can only hydrate delegated events
            hasHydratableEvent = true;
            const programData = attribute.scope.getProgramParent().data;
            const events = programData.events || (programData.events = new Set());
            events.add(ev);
            let handler = value.expression;
            const resolveable = detectResolvableEventHandler(attribute, handler);
            if (t$1.isArrayExpression(handler)) {
              if (handler.elements.length > 1) {
                results.exprs.unshift(
                  t$1.expressionStatement(
                    t$1.assignmentExpression(
                      "=",
                      t$1.memberExpression(elem, t$1.identifier(`$$${ev}Data`)),
                      handler.elements[1]
                    )
                  )
                );
              }
              handler = handler.elements[0];
              results.exprs.unshift(
                t$1.expressionStatement(
                  t$1.assignmentExpression(
                    "=",
                    t$1.memberExpression(elem, t$1.identifier(`$$${ev}`)),
                    handler
                  )
                )
              );
            } else if (t$1.isFunction(handler) || resolveable) {
              results.exprs.unshift(
                t$1.expressionStatement(
                  t$1.assignmentExpression(
                    "=",
                    t$1.memberExpression(elem, t$1.identifier(`$$${ev}`)),
                    handler
                  )
                )
              );
            } else {
              results.exprs.unshift(
                t$1.expressionStatement(
                  t$1.callExpression(
                    registerImportMethod(
                      path,
                      "addEvent",
                      getRendererConfig(path, "dom").moduleName
                    ),
                    [elem, t$1.stringLiteral(ev), handler, t$1.booleanLiteral(true)]
                  )
                )
              );
            }
          } else {
            let handler = value.expression;
            const resolveable = detectResolvableEventHandler(attribute, handler);
            if (t$1.isArrayExpression(handler)) {
              if (handler.elements.length > 1) {
                handler = t$1.arrowFunctionExpression(
                  [t$1.identifier("e")],
                  t$1.callExpression(handler.elements[0], [
                    handler.elements[1],
                    t$1.identifier("e")
                  ])
                );
              } else handler = handler.elements[0];
              results.exprs.unshift(
                t$1.expressionStatement(
                  t$1.callExpression(
                    t$1.memberExpression(elem, t$1.identifier("addEventListener")),
                    [t$1.stringLiteral(ev), handler]
                  )
                )
              );
            } else if (t$1.isFunction(handler) || resolveable) {
              results.exprs.unshift(
                t$1.expressionStatement(
                  t$1.callExpression(
                    t$1.memberExpression(elem, t$1.identifier("addEventListener")),
                    [t$1.stringLiteral(ev), handler]
                  )
                )
              );
            } else {
              results.exprs.unshift(
                t$1.expressionStatement(
                  t$1.callExpression(
                    registerImportMethod(
                      path,
                      "addEvent",
                      getRendererConfig(path, "dom").moduleName
                    ),
                    [elem, t$1.stringLiteral(ev), handler]
                  )
                )
              );
            }
          }
        } else if (
          config.effectWrapper &&
          (isDynamic(attribute.get("value").get("expression"), {
            checkMember: true
          }) ||
            ((key === "class" || key === "style") &&
              !attribute.get("value").get("expression").evaluate().confident &&
              !hasStaticMarker(value, path)))
        ) {
          // own effect
          let nextElem = elem;
          if (key === "textContent") {
            nextElem = attribute.scope.generateUidIdentifier("el$");
            children = t$1.jsxText(" ");
            children.extra = { raw: " ", rawValue: " " };
            results.declarations.push(
              t$1.variableDeclarator(
                nextElem,
                t$1.memberExpression(elem, t$1.identifier("firstChild"))
              )
            );
          }
          results.dynamics.push({
            elem: nextElem,
            key,
            value: value.expression,
            tagName,
            styleProperty: isStyleProperty,
            classProperty: isClassProperty
          });
        } else {
          results.exprs.push(
            t$1.expressionStatement(
              setAttr$2(attribute, elem, key, value.expression, {
                tagName,
                styleProperty: isStyleProperty,
                classProperty: isClassProperty
              })
            )
          );
        }
      } else {
        if (config.hydratable && key === "$ServerOnly") {
          results.skipTemplate = true;
          return;
        }
        let staticValue = value;
        if (t$1.isJSXExpressionContainer(value)) {
          if (t$1.isJSXEmptyExpression(value.expression)) return;
          staticValue = value.expression;
        }

        // Native `children` is child content, not a DOM property and not an
        // HTML attribute. Promote it so the child pass can template-inline
        // statics or `insert()` dynamics — same as writing `{value}` as a child.
        if (key === "children") {
          if (!hasChildren && !VoidElements.has(tagName) && staticValue) {
            children = t$1.isJSXExpressionContainer(value)
              ? value
              : t$1.jsxExpressionContainer(staticValue);
          }
          return;
        }

        // boolean as `<el attr={true | false}/>`, not as `<el attr={"true" | "false"}/>`
        // `<el attr={true}/>` becomes `<el attr/>`
        // `<el attr={false}/>` becomes `<el/>`
        const booleanLiteral = t$1.isBooleanLiteral(staticValue) ? staticValue : undefined;
        if (booleanLiteral) {
          if (booleanLiteral.value === true) {
            results.template += `${needsSpacing ? " " : ""}${key}`;
            needsSpacing = true;
          }
          return;
        }

        // properties
        if (staticValue && ChildProperties.has(key)) {
          results.exprs.push(
            t$1.expressionStatement(setAttr$2(attribute, elem, key, staticValue, { tagName }))
          );
        } else {
          inlineAttributeOnTemplate(key, results, staticValue);
        }
      }
    });
  if (!hasChildren && children) {
    path.node.children.push(children);
  }
  if (spreadExpr) results.exprs.push(...(Array.isArray(spreadExpr) ? spreadExpr : [spreadExpr]));

  results.hasHydratableEvent = results.hasHydratableEvent || hasHydratableEvent;
}

// Children that compile to `insert()` calls and contribute no markup of their
// own: dynamic expression containers, components, and spread children. Mirrors
// the `!child.id && child.exprs.length` count in transformChildren.
function countDynamicSlots(children) {
  let count = 0;
  for (const child of children) {
    const node = child.node;
    if (
      t$1.isJSXText(node) ||
      (t$1.isJSXExpressionContainer(node) && getStaticExpression(child) !== false) ||
      (t$1.isJSXElement(node) && !isComponent(getTagName(node)))
    )
      continue;
    count++;
  }
  return count;
}

function findLastElement(children, hydratable) {
  let lastElement = -1,
    tagName;
  // Counterpart of transformChildren's per-slot markers: with two or more
  // dynamic slots under this parent (CSR only), a trailing dynamic child
  // appends a dedicated `<!>` placeholder to the template, so an earlier
  // element may not omit its closing tag — the still-open element would
  // swallow the placeholder as a child while the generated
  // firstChild/nextSibling walk expects it as a sibling.
  const perSlotMarkers = !hydratable && countDynamicSlots(children) > 1;
  for (let i = children.length - 1; i >= 0; i--) {
    const node = children[i].node;
    if (
      hydratable ||
      t$1.isJSXText(node) ||
      (t$1.isJSXExpressionContainer(node) && getStaticExpression(children[i]) !== false) ||
      (t$1.isJSXElement(node) && (tagName = getTagName(node)) && !isComponent(tagName))
    ) {
      lastElement = i;
      break;
    }
    // This trailing dynamic slot will emit a per-slot placeholder after any
    // preceding element's markup: nothing here may omit its closing tag.
    if (perSlotMarkers) break;
  }
  return lastElement;
}

function transformChildren$2(path, results, config) {
  let tempPath = (results.id && results.id.name) || "",
    tagName = getTagName(path.node),
    childPostExprs = [],
    i = 0;
  const filteredChildren = filterChildren(path.get("children")),
    lastElement = findLastElement(filteredChildren, config.hydratable),
    childNodes = filteredChildren.reduce((memo, child, index) => {
      if (child.isJSXFragment()) {
        throw new Error(
          `Fragments can only be used top level in JSX. Not used under a <${tagName}>.`
        );
      }
      const transformed = transformNode(child, {
        toBeClosed: results.toBeClosed,
        lastElement: index === lastElement,
        skipId: !results.id || !detectExpressions(filteredChildren, index, config)
      });
      if (!transformed) return memo;
      transformed.allocatesIds = config.hydratable && canChildSlotAllocateIds(child);
      const i = memo.length;
      if (transformed.text && i && memo[i - 1].text) {
        memo[i - 1].template = `${memo[i - 1].template}${transformed.template}`;
        memo[i - 1].templateWithClosingTags +=
          transformed.templateWithClosingTags || transformed.template;
      } else memo.push(transformed);
      return memo;
    }, []);

  // Dynamic slots under this parent (children compiled to `insert()` calls).
  // With two or more, slots may not share an insertion marker: the marker is
  // also the runtime's ownership tag ($$SLOT), and adoption only re-tags when
  // the marker is truthy — shared or null markers let one slot's cleanup
  // destroy a node that migrated to its neighbor (solidjs/solid#2830).
  const dynamicSlots = childNodes.reduce((n, c) => (c && !c.id && c.exprs.length ? n + 1 : n), 0);

  childNodes.forEach((child, index) => {
    if (!child) return;
    if (child.tagName && child.renderer !== "dom") {
      throw new Error(`<${child.tagName}> is not supported in <${tagName}>.
      Wrap the usage with a component that would render this element, eg. Canvas`);
    }

    results.template += child.template;
    results.templateWithClosingTags += child.templateWithClosingTags || child.template;
    results.isImportNode = results.isImportNode || child.isImportNode;
    results.isWrapped = results.isWrapped || child.isWrapped;

    if (child.id) {
      let walkExpr;
      if (config.hydratable && tagName === "html") {
        const getNextMatch = registerImportMethod(
          path,
          "getNextMatch",
          getRendererConfig(path, "dom").moduleName
        );
        const walk = t$1.memberExpression(
          t$1.identifier(tempPath),
          t$1.identifier(i === 0 ? "firstChild" : "nextSibling")
        );
        walkExpr = t$1.callExpression(getNextMatch, [walk, t$1.stringLiteral(child.tagName)]);
      } else if (config.dev && config.hydratable && child.tagName) {
        const helperName = i === 0 ? "getFirstChild" : "getNextSibling";
        const helper = registerImportMethod(
          path,
          helperName,
          getRendererConfig(path, "dom").moduleName
        );
        walkExpr = t$1.callExpression(helper, [
          t$1.identifier(tempPath),
          t$1.stringLiteral(child.tagName)
        ]);
      } else {
        walkExpr = t$1.memberExpression(
          t$1.identifier(tempPath),
          t$1.identifier(i === 0 ? "firstChild" : "nextSibling")
        );
      }
      results.declarations.push(t$1.variableDeclarator(child.id, walkExpr));
      results.declarations.push(...child.declarations);
      results.exprs.push(...child.exprs);
      results.dynamics.push(...child.dynamics);
      childPostExprs.push(...(child.postExprs || []));
      results.hasHydratableEvent = results.hasHydratableEvent || child.hasHydratableEvent;
      results.isImportNode = results.isImportNode || child.isImportNode;
      results.isWrapped = results.isWrapped || child.isWrapped;
      tempPath = child.id.name;
      i++;
    } else if (child.exprs.length) {
      let insert = registerImportMethod(path, "insert", getRendererConfig(path, "dom").moduleName);
      const multi = checkLength(filteredChildren),
        markers = config.hydratable && multi,
        // CSR counterpart of the hydratable per-slot markers: when this parent
        // hosts multiple dynamic slots, each gets its own truthy marker — the
        // immediately following sibling when it has a reference, otherwise a
        // dedicated `<!>` placeholder.
        perSlot = !markers && dynamicSlots > 1;
      // Mirror of the ssr generate's `scope()` wrap: deferred holes that can
      // allocate hydration ids get their own owner scope (insert makes the
      // outer render effect non-transparent for tagged accessors). Keyed off
      // `dynamic` so both generates decide identically for the same source.
      if (child.allocatesIds && child.dynamic) {
        let expr = child.exprs[0];
        // The shared transform simplifies `{sig()}` to the bare getter `sig`;
        // rewrap so tagging the scope doesn't mutate the user's function.
        if (!t$1.isFunction(expr) && !(t$1.isCallExpression(expr) && t$1.isFunction(expr.callee))) {
          expr = t$1.arrowFunctionExpression([], t$1.callExpression(expr, []));
        }
        child.exprs[0] = t$1.callExpression(
          registerImportMethod(path, "scope", getRendererConfig(path, "dom").moduleName),
          [expr]
        );
      }
      // boxed by textNodes
      if (markers || perSlot || wrappedByText(childNodes, index)) {
        let exprId;
        let contentId;
        if (markers) tempPath = createPlaceholder(path, results, tempPath, i++, "$")[0].name;
        // Ride the immediately following sibling's reference when it exists —
        // unless the slot is boxed by text, where a placeholder is structurally
        // required to keep the surrounding template text nodes from merging.
        if (perSlot && !wrappedByText(childNodes, index)) {
          exprId = (childNodes[index + 1] && childNodes[index + 1].id) || undefined;
        }
        if (!exprId) {
          [exprId, contentId] = createPlaceholder(path, results, tempPath, i++, markers ? "/" : "");
          tempPath = exprId.name;
        }
        const args = contentId
          ? [results.id, child.exprs[0], exprId, contentId]
          : [results.id, child.exprs[0], exprId];

        results.exprs.push(t$1.expressionStatement(t$1.callExpression(insert, args)));
      } else if (multi) {
        results.exprs.push(
          t$1.expressionStatement(
            t$1.callExpression(insert, [
              results.id,
              child.exprs[0],
              nextChild$1(childNodes, index) || t$1.nullLiteral()
            ])
          )
        );
      } else {
        results.exprs.push(
          t$1.expressionStatement(t$1.callExpression(insert, [results.id, child.exprs[0]]))
        );
      }
    }
  });
  results.postExprs.unshift(...childPostExprs);
}

function createPlaceholder(path, results, tempPath, i, char) {
  const exprId = path.scope.generateUidIdentifier("el$"),
    config = getConfig(path);
  let contentId;
  results.template += `<!${char}>`;
  results.templateWithClosingTags += `<!${char}>`;
  if (config.hydratable && char === "/") {
    contentId = path.scope.generateUidIdentifier("co$");
    results.declarations.push(
      t$1.variableDeclarator(
        t$1.arrayPattern([exprId, contentId]),
        t$1.callExpression(
          registerImportMethod(path, "getNextMarker", getRendererConfig(path, "dom").moduleName),
          [t$1.memberExpression(t$1.identifier(tempPath), t$1.identifier("nextSibling"))]
        )
      )
    );
  } else
    results.declarations.push(
      t$1.variableDeclarator(
        exprId,
        t$1.memberExpression(
          t$1.identifier(tempPath),
          t$1.identifier(i === 0 ? "firstChild" : "nextSibling")
        )
      )
    );
  return [exprId, contentId];
}

function nextChild$1(children, index) {
  return children[index + 1] && (children[index + 1].id || nextChild$1(children, index + 1));
}

// reduce unnecessary refs
function detectExpressions(children, index, config) {
  if (children[index - 1]) {
    const node = children[index - 1].node;
    if (
      t$1.isJSXExpressionContainer(node) &&
      !t$1.isJSXEmptyExpression(node.expression) &&
      getStaticExpression(children[index - 1]) === false
    )
      return true;
    let tagName;
    if (t$1.isJSXElement(node) && (tagName = getTagName(node)) && isComponent(tagName)) return true;
  }
  for (let i = index; i < children.length; i++) {
    const child = children[i].node;
    if (t$1.isJSXExpressionContainer(child)) {
      if (!t$1.isJSXEmptyExpression(child.expression) && getStaticExpression(children[i]) === false)
        return true;
    } else if (t$1.isJSXElement(child)) {
      const tagName = getTagName(child);
      if (isComponent(tagName)) return true;
      if (
        config.contextToCustomElements &&
        (tagName === "slot" ||
          tagName.indexOf("-") > -1 ||
          child.openingElement.attributes.some(
            a => t$1.isJSXAttribute(a) && !t$1.isJSXNamespacedName(a.name) && a.name.name === "is"
          ))
      )
        return true;
      // claim targets (a[href] / form[action]) need an element reference
      // even when fully static — the emitted claimElement call walks to them
      if (isClaimTarget(child)) return true;
      if (
        child.openingElement.attributes.some(
          attr =>
            t$1.isJSXSpreadAttribute(attr) ||
            (t$1.isJSXIdentifier(attr.name) &&
              ["textContent", "innerHTML", "innerText"].includes(attr.name.name)) ||
            // inlineStyles: false rewrites every style value into an IIFE
            // expression, so even literal styles compile to dynamic
            // bindings that need an element reference.
            (!config.inlineStyles &&
              t$1.isJSXIdentifier(attr.name) &&
              attr.name.name === "style" &&
              (t$1.isStringLiteral(attr.value) ||
                (t$1.isJSXExpressionContainer(attr.value) &&
                  !t$1.isJSXEmptyExpression(attr.value.expression)))) ||
            (t$1.isJSXNamespacedName(attr.name) && attr.name.namespace.name === "prop") ||
            (t$1.isJSXExpressionContainer(attr.value) &&
              !(
                t$1.isStringLiteral(attr.value.expression) ||
                t$1.isNumericLiteral(attr.value.expression)
              ))
        )
      )
        return true;
      const nextChildren = filterChildren(children[i].get("children"));
      if (nextChildren.length) if (detectExpressions(nextChildren, 0, config)) return true;
    }
  }
}

function contextToCustomElement(path, results) {
  if (!results.id) return;
  results.exprs.push(
    t$1.expressionStatement(
      t$1.assignmentExpression(
        "=",
        t$1.memberExpression(results.id, t$1.identifier("_$owner")),
        t$1.callExpression(
          registerImportMethod(path, "getOwner", getRendererConfig(path, "dom").moduleName),
          []
        )
      )
    )
  );
}

function processSpreads$1(path, attributes, { elem, hasChildren }) {
  const config = getConfig(path);
  const tagName = getTagName(path.node);

  // TODO: skip but collect the names of any properties after the last spread to not overwrite them
  const filteredAttributes = [];
  const spreadArgs = [];
  let runningObject = [];
  let dynamicSpread = false;
  attributes.forEach(attribute => {
    const node = attribute.node;
    const key =
      !t$1.isJSXSpreadAttribute(node) &&
      (t$1.isJSXNamespacedName(node.name)
        ? `${node.name.namespace.name}:${node.name.name.name}`
        : node.name.name);
    if (t$1.isJSXSpreadAttribute(node)) {
      const isStatic =
        node.innerComments &&
        node.innerComments[0] &&
        node.innerComments[0].value.trim() === config.staticMarker;

      if (runningObject.length) {
        spreadArgs.push(t$1.objectExpression(runningObject));
        runningObject = [];
      }

      const s =
        isDynamic(attribute.get("argument"), {
          checkMember: true
        }) && (dynamicSpread = true)
          ? inlineCallExpression(node.argument)
          : node.argument;

      spreadArgs.push(isStatic ? t$1.objectExpression([t$1.spreadElement(s)]) : s);
    } else if (key && key !== "ref") {
      const value = node.value;
      const isContainer = t$1.isJSXExpressionContainer(value);
      const expression =
        isContainer && !t$1.isJSXEmptyExpression(value.expression) ? value.expression : undefined;
      const dynamic =
        isContainer && isDynamic(attribute.get("value").get("expression"), { checkMember: true });
      const normalized = isLockedDOMProperty(tagName, key) ? key.replace(/^prop:/, "") : key;
      if (dynamic) {
        const id = isLockedDOMProperty(tagName, key)
          ? t$1.identifier(normalized)
          : convertJSXIdentifier(node.name);

        // No condition memo here (unlike children/component props): attribute
        // values are primitives, assignProp dedupes writes against prevProps,
        // and the ssr generate emits the bare expression — a client-only memo
        // allocates a hydration id the server never did, drifting every id
        // after it (#2959).
        runningObject.push(
          t$1.objectMethod(
            "get",
            id,
            [],
            t$1.blockStatement([t$1.returnStatement(expression)]),
            !t$1.isValidIdentifier(normalized)
          )
        );
      } else {
        runningObject.push(
          t$1.objectProperty(
            t$1.stringLiteral(normalized),
            isContainer ? expression : node.value || t$1.booleanLiteral(true)
          )
        );
      }
    } else filteredAttributes.push(attribute);
  });

  if (runningObject.length) {
    spreadArgs.push(t$1.objectExpression(runningObject));
  }

  const props =
    spreadArgs.length === 1 && !dynamicSpread
      ? spreadArgs[0]
      : t$1.callExpression(registerImportMethod(path, "mergeProps"), spreadArgs);

  return [
    filteredAttributes,
    t$1.expressionStatement(
      t$1.callExpression(
        registerImportMethod(path, "spread", getRendererConfig(path, "dom").moduleName),
        [elem, props, t$1.booleanLiteral(hasChildren)]
      )
    )
  ];
}

/**
 * Patch-mode eligibility + emission (DESIGN-PATCH-CHANNEL.md, PR-C).
 *
 * A template scope qualifies for patch mode when EVERY dynamic binding's
 * value is a pure expression over member reads of ONE stable subject
 * identifier (Tier 1: bare member chains; Tier 2: ternary/binary/logical/
 * template-literal/unary compositions of Tier-1 reads and literals).
 * Anything else — calls, assignments, functions, foreign identifiers —
 * disqualifies the SCOPE (per-binding islands remain future work; v1 is
 * all-or-nothing per template scope, matching the fixture shape).
 *
 * Emission (dual driver, shared body):
 *
 *   _$patchDriver(subject, (_n$, _p$, _f$) => {
 *     let _v$;
 *     if (_f$ || (_v$ = <expr(_n$)>) !== <expr(_p$)>) <setAttr(..., _v$)>;
 *     ...
 *   });
 *
 * The runtime driver registers on the store's patch channel when the
 * subject is a patchable record, else falls back to a tracked force-mode
 * effect running the same body (reads through the subject track; force
 * short-circuits every compare, so `prev` is never dereferenced there).
 * Semantics are therefore IDENTICAL either way; patch mode only changes
 * who dispatches.
 */

// Node types allowed inside an eligible binding expression (Tier 1+2).
function isEligibleExpr(node, subject) {
  switch (node.type) {
    case "Identifier":
      return node.name === subject || node.name === "undefined";
    case "MemberExpression": {
      const m = node;
      if (m.computed) {
        if (!t__namespace.isStringLiteral(m.property) && !t__namespace.isNumericLiteral(m.property))
          return false;
      } else if (!t__namespace.isIdentifier(m.property)) {
        return false;
      }
      return isEligibleExpr(m.object, subject);
    }
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "BigIntLiteral":
      return true;
    case "ConditionalExpression": {
      const c = node;
      return (
        isEligibleExpr(c.test, subject) &&
        isEligibleExpr(c.consequent, subject) &&
        isEligibleExpr(c.alternate, subject)
      );
    }
    case "BinaryExpression": {
      const b = node;
      if (b.operator === "in" || b.operator === "instanceof") return false;
      return isEligibleExpr(b.left, subject) && isEligibleExpr(b.right, subject);
    }
    case "LogicalExpression": {
      const l = node;
      return isEligibleExpr(l.left, subject) && isEligibleExpr(l.right, subject);
    }
    case "UnaryExpression": {
      const u = node;
      if (u.operator === "delete" || u.operator === "throw") return false;
      return isEligibleExpr(u.argument, subject);
    }
    case "TemplateLiteral":
      return node.expressions.every(e =>
        t__namespace.isExpression(e) ? isEligibleExpr(e, subject) : false
      );
    case "ParenthesizedExpression":
      return isEligibleExpr(node.expression, subject);
    default:
      return false;
  }
}

/** Find the single subject: the root identifier of the FIRST member chain
 * encountered. Every other read must root at the same name. */
function findSubject(node) {
  switch (node.type) {
    case "MemberExpression":
      return findSubject(node.object);
    case "Identifier":
      return node.name === "undefined" ? null : node.name;
    case "ConditionalExpression":
      return findSubject(node.test) ?? findSubject(node.consequent) ?? findSubject(node.alternate);

    case "BinaryExpression":
    case "LogicalExpression":
      return findSubject(node.left) ?? findSubject(node.right);

    case "UnaryExpression":
      return findSubject(node.argument);
    case "TemplateLiteral": {
      for (const e of node.expressions) {
        const s = findSubject(e);
        if (s) return s;
      }
      return null;
    }
    case "ParenthesizedExpression":
      return findSubject(node.expression);
    default:
      return null;
  }
}

/** Analyze a template scope's dynamic binding values. Returns the subject
 * when EVERY value is an eligible pure expression over it, else null. */
function analyzePatchEligibility(values) {
  if (values.length === 0) return null;
  let subject = null;
  for (const v of values) {
    const s = findSubject(v);
    if (s === null) return null; // static-only binding: no dispatch source
    if (subject === null) subject = s;
    else if (subject !== s) return null; // multi-subject: Q3 territory, bail in v1
  }
  if (subject === null) return null;
  for (const v of values) {
    if (!isEligibleExpr(v, subject)) return null;
  }
  return { subject };
}

/** Clone `expr` substituting the subject identifier with `replacement`.
 * Safe because eligibility rejected functions/shadowing constructs. */
function substituteSubject(expr, subject, replacement) {
  const clone = t__namespace.cloneNode(expr, true);
  const rewrite = node => {
    if (t__namespace.isIdentifier(node) && node.name === subject)
      return t__namespace.cloneNode(replacement);
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] && typeof value[i].type === "string") value[i] = rewrite(value[i]);
        }
      } else if (value && typeof value.type === "string") {
        // Never rewrite non-computed member PROPERTY positions.
        if (t__namespace.isMemberExpression(node) && key === "property" && !node.computed) continue;
        node[key] = rewrite(value);
      }
    }
    return node;
  };
  return rewrite(clone);
}

function createTemplate$2(path, result, wrap) {
  const config = getConfig(path);
  if (result.id) {
    registerTemplate(path, result);
    const decl = result.decl;
    if (
      !(result.exprs.length || result.dynamics.length || result.postExprs?.length) &&
      decl.declarations.length === 1
    ) {
      // Static single-root template: a candidate row function returning it is
      // trivially pure (no reactive work at all).
      if (config.patchDriver) recordPureRow(path, result, null);
      return decl.declarations[0].init;
    } else {
      const patched = config.patchDriver ? wrapPatchMode(path, result.dynamics) : undefined;
      const dynamicsStmt = patched ? patched.stmt : wrapDynamics$1(path, result.dynamics);
      if (config.patchDriver && (result.dynamics.length === 0 || patched)) {
        recordPureRow(path, result, patched ? patched.subject : null);
      }
      const stmts = [
        decl,
        ...result.exprs,
        ...(dynamicsStmt ? [dynamicsStmt] : []),
        ...(result.postExprs || [])
      ];

      // In statement position (`return <jsx/>;`, `const x = <jsx/>;`),
      // emit flat statements before the parent instead of wrapping in an
      // IIFE — saves one closure allocation + one function-call frame
      // per render. The DOM emission interleaves variable declarations
      // with side-effecting statements (insert / effect / postExprs), so
      // each `var` stays in place; `var` is function-scoped + hoisted,
      // so the bindings remain visible throughout the surrounding
      // function.
      const isReturnArg =
        t__namespace.isReturnStatement(path.parent) && path.parent.argument === path.node;
      const isVarInit =
        t__namespace.isVariableDeclarator(path.parent) && path.parent.init === path.node;

      if (isReturnArg || isVarInit) {
        path.getStatementParent()?.insertBefore(stmts);
        return result.id;
      }

      // Fallback: JSX is in a ternary branch / array element / function arg
      // / logical expression — keep the IIFE. Flattening to a sequence
      // expression here is doable but harder to read for the DOM shape
      // (mixed variable declarations + side-effecting expression statements
      // would need to be linearized into commas), and the perf delta in
      // these rarer positions is negligible.
      return t__namespace.callExpression(
        t__namespace.arrowFunctionExpression(
          [],
          t__namespace.blockStatement([...stmts, t__namespace.returnStatement(result.id)])
        ),
        []
      );
    }
  }
  if (wrap && result.dynamic && config.memoWrapper) {
    return t__namespace.callExpression(registerImportMethod(path, config.memoWrapper, undefined), [
      result.exprs[0]
    ]);
  }
  return result.exprs[0];
}

function appendTemplates$1(path, templates) {
  const declarators = templates.map(template => {
    const templateText = template.template;
    const tmpl = {
      cooked: templateText,
      raw: escapeStringForTemplate(templateText)
    };

    const flag = template.isWrapped ? 2 : template.isImportNode ? 1 : null;

    return t__namespace.variableDeclarator(
      template.id,
      t__namespace.addComment(
        t__namespace.callExpression(
          registerImportMethod(path, "template", getRendererConfig(path, "dom").moduleName),
          [
            t__namespace.templateLiteral([t__namespace.templateElement(tmpl, true)], []),
            ...(flag ? [t__namespace.numericLiteral(flag)] : [])
          ]
        ),
        "leading",
        "#__PURE__"
      )
    );
  });
  path.node.body.unshift(t__namespace.variableDeclaration("var", declarators));
}

function registerTemplate(path, results) {
  const { hydratable } = getConfig(path);
  let decl;
  if (typeof results.template === "string" && results.template.length) {
    let templateDef, templateId;
    if (!results.skipTemplate) {
      const data = path.scope.getProgramParent().data;
      const templates = data.templates || (data.templates = []);
      if ((templateDef = templates.find(t => t.template === results.template))) {
        templateId = templateDef.id;
      } else {
        templateId = path.scope.generateUidIdentifier("tmpl$");
        templates.push({
          id: templateId,
          template: results.template,
          templateWithClosingTags: results.templateWithClosingTags,
          isImportNode: results.isImportNode,
          isWrapped: results.isWrapped,
          renderer: "dom"
        });
      }
    }
    const id = results.id;
    decl = t__namespace.variableDeclarator(
      id,
      hydratable
        ? t__namespace.callExpression(
            registerImportMethod(path, "getNextElement", getRendererConfig(path, "dom").moduleName),
            templateId ? [templateId] : []
          )
        : t__namespace.callExpression(templateId, [])
    );
  }
  if (decl) results.declarations.unshift(decl);
  results.decl = t__namespace.variableDeclaration("var", results.declarations);
}

/**
 * Row-proof analysis (DESIGN-PATCH-CHANNEL §3c). A function qualifies as a
 * PURE ROW — buildable with no per-row owner, so the patch-mode list driver
 * may engage — when ALL of:
 *
 *  - it is a single-parameter function (plain Identifier param, not
 *    destructured; not async/generator) whose body is exactly this compiled
 *    template: an expression body, or a block whose ONLY statement returns
 *    it (checked before the flat-statement emission inserts our own);
 *  - the template has a single root element (`result.id` — fragments never
 *    reach here) and emitted NO reactive or owned work: dynamics either
 *    absent or all landed in ONE patchDriver body, and `result.exprs` holds
 *    only inert DOM wiring (member-target assignments like `_el$.$$click =
 *    fn` / `_el$.style.cssText = v`, and `_el$.addEventListener(...)`) —
 *    any `insert`/`createComponent`/`memo`/`use`/ref/spread emission is a
 *    call or conditional shape and fails the walk (default-deny);
 *  - the patch subject IS the row parameter. A pure template patching an
 *    OUTER subject would register once per created row on a long-lived
 *    record with no per-row disposal — the foreign-subject leak the runtime
 *    probe never caught.
 *
 * Handler/attribute VALUE expressions may be arbitrary user code: stamped
 * rows are only ever built for real mounts (never speculatively), so their
 * evaluation timing is identical to the classic path. Event handlers are
 * not reactive bindings — values evaluate exactly once at build — so the
 * only ownership divergence is a factory creating owned work in value
 * position (`onClick={makeHandler(row)}` calling onCleanup), which is not
 * a supported pattern (owned work belongs in effects/refs; ruled
 * non-responsibility). Denying evaluation-position calls would cost
 * legitimate currying to guard it; instead the runtime dev-asserts that a
 * stamped row's build attaches nothing to the list owner.
 *
 * Qualifying functions are recorded and wrapped with `rowProof` at program
 * exit (postprocess) — the stamp travels with the function object, so
 * extracted row functions prove at their DEFINITION site and work across
 * modules, which the runtime probe could never see.
 */
function recordPureRow(path, result, subject) {
  const parent = path.parentPath;
  if (!parent) return;
  let fn;
  if (
    (t__namespace.isArrowFunctionExpression(parent.node) ||
      t__namespace.isFunctionExpression(parent.node)) &&
    parent.node.body === path.node
  ) {
    fn = parent.node;
  } else if (
    t__namespace.isReturnStatement(parent.node) &&
    parent.node.argument === path.node &&
    parent.parentPath &&
    t__namespace.isBlockStatement(parent.parentPath.node) &&
    parent.parentPath.node.body.length === 1 &&
    parent.parentPath.parentPath &&
    (t__namespace.isArrowFunctionExpression(parent.parentPath.parentPath.node) ||
      t__namespace.isFunctionExpression(parent.parentPath.parentPath.node)) &&
    parent.parentPath.parentPath.node.body === parent.parentPath.node
  ) {
    fn = parent.parentPath.parentPath.node;
  }
  if (!fn || fn.async || fn.generator) return;
  if (fn.params.length !== 1 || !t__namespace.isIdentifier(fn.params[0])) return;
  const param = fn.params[0].name;
  if (subject !== null && subject !== param) return;

  const isLocalMemberTarget = n => {
    if (!t__namespace.isMemberExpression(n) || n.computed) return false;
    let obj = n.object;
    while (t__namespace.isMemberExpression(obj) && !obj.computed) obj = obj.object;
    return t__namespace.isIdentifier(obj);
  };
  for (const stmt of result.exprs) {
    if (!t__namespace.isExpressionStatement(stmt)) return;
    const e = stmt.expression;
    if (t__namespace.isAssignmentExpression(e) && e.operator === "=" && isLocalMemberTarget(e.left))
      continue;
    if (
      t__namespace.isCallExpression(e) &&
      t__namespace.isMemberExpression(e.callee) &&
      !e.callee.computed &&
      t__namespace.isIdentifier(e.callee.property) &&
      e.callee.property.name === "addEventListener"
    )
      continue;
    return;
  }
  if (result.postExprs?.length) {
    const data = path.scope.getProgramParent().data;
    const moduleName = getRendererConfig(path, "dom").moduleName;
    const rheUid = data.imports?.get(`${moduleName}:runHydrationEvents`);
    for (const stmt of result.postExprs) {
      if (
        !t__namespace.isExpressionStatement(stmt) ||
        !t__namespace.isCallExpression(stmt.expression) ||
        !t__namespace.isIdentifier(stmt.expression.callee) ||
        !rheUid ||
        stmt.expression.callee.name !== rheUid.name
      )
        return;
    }
  }

  const data = path.scope.getProgramParent().data;
  (data.pureRows || (data.pureRows = new Set())).add(fn);
}

/** Patch-mode emission (shared/patch.ts): one compiled body doing inline
 * compares + setAttr writes, handed to the runtime driver which registers
 * on the store patch channel (patchable subject) or falls back to a
 * tracked force-mode effect running the SAME body. Returns undefined when
 * the scope is ineligible — caller falls through to the effect shapes.
 * The subject rides along for row-proof analysis (recordPureRow). */
function wrapPatchMode(path, dynamics) {
  const config = getConfig(path);
  if (dynamics.length === 0) return;
  const eligibility = analyzePatchEligibility(dynamics.map(d => d.value));
  if (!eligibility) return;
  const subject = eligibility.subject;
  // The subject must be a stable local binding (not reassigned): row params
  // and const destructures qualify; anything else falls back to effects.
  const binding = path.scope.getBinding(subject);
  if (!binding || !binding.constant) return;
  // Fixed `$`-suffixed locals, matching wrapDynamics' `_v$`/`_p$` convention
  // (and byte-parity with the Oxc compiler's emission): substitution only
  // rewrites subject references, so nothing else in an eligible expression
  // can collide with these.
  const nId = t__namespace.identifier("_n$");
  const pId = t__namespace.identifier("_p$");
  const fId = t__namespace.identifier("_f$");
  const stmts = [];
  let vIndex = 0;
  for (const d of dynamics) {
    let value = d.value;
    if (
      d.classProperty &&
      !t__namespace.isBooleanLiteral(value) &&
      !t__namespace.isUnaryExpression(value)
    ) {
      value = t__namespace.unaryExpression("!", t__namespace.unaryExpression("!", value));
    }
    const vId = t__namespace.identifier(++vIndex === 1 ? "_v$" : `_v$${vIndex}`);
    stmts.push(
      t__namespace.variableDeclaration("const", [
        t__namespace.variableDeclarator(vId, substituteSubject(value, subject, nId))
      ])
    );
    stmts.push(
      t__namespace.ifStatement(
        t__namespace.logicalExpression(
          "||",
          t__namespace.cloneNode(fId),
          t__namespace.binaryExpression(
            "!==",
            t__namespace.cloneNode(vId),
            substituteSubject(value, subject, pId)
          )
        ),
        t__namespace.expressionStatement(
          setAttr$2(path, d.elem, d.key, t__namespace.cloneNode(vId), {
            tagName: d.tagName,
            dynamic: true,
            styleProperty: d.styleProperty,
            classProperty: d.classProperty
          })
        )
      )
    );
  }
  const driverId = registerImportMethod(path, config.patchDriver, undefined);
  return {
    stmt: t__namespace.expressionStatement(
      t__namespace.callExpression(driverId, [
        t__namespace.identifier(subject),
        t__namespace.arrowFunctionExpression([nId, pId, fId], t__namespace.blockStatement(stmts))
      ])
    ),
    subject
  };
}

function wrapDynamics$1(path, dynamics) {
  if (!dynamics.length) return;
  const config = getConfig(path);

  // dynamics are only queued when effectWrapper is configured (element.ts
  // guards every push), so the name is always a string here
  const effectWrapperId = registerImportMethod(path, config.effectWrapper, undefined);

  if (dynamics.length === 1) {
    const prevValue =
      dynamics[0].key === "class" || dynamics[0].key === "style"
        ? t__namespace.identifier("_$p")
        : undefined;

    if (
      dynamics[0].classProperty &&
      !t__namespace.isBooleanLiteral(dynamics[0].value) &&
      !t__namespace.isUnaryExpression(dynamics[0].value)
    ) {
      dynamics[0].value = t__namespace.unaryExpression(
        "!",
        t__namespace.unaryExpression("!", dynamics[0].value)
      );
    }

    const newValue = t__namespace.identifier("_v$");
    return t__namespace.expressionStatement(
      t__namespace.callExpression(effectWrapperId, [
        wrapForEffect(dynamics[0].value),
        t__namespace.arrowFunctionExpression(
          prevValue ? [newValue, prevValue] : [newValue],
          t__namespace.blockStatement([
            t__namespace.expressionStatement(
              setAttr$2(path, dynamics[0].elem, dynamics[0].key, newValue, {
                tagName: dynamics[0].tagName,
                dynamic: true,
                prevId: prevValue,
                styleProperty: dynamics[0].styleProperty,
                classProperty: dynamics[0].classProperty
              })
            )
          ])
        )
      ])
    );
  }

  const prevId = t__namespace.identifier("_p$");

  const values = [];
  const statements = [];
  const properties = [];

  dynamics.forEach(({ elem, key, value, tagName, styleProperty, classProperty }, index) => {
    const propIdent = t__namespace.identifier(getNumberedId(index));
    const propMember = t__namespace.memberExpression(prevId, propIdent);
    const optionalPropMember = t__namespace.optionalMemberExpression(
      prevId,
      propIdent,
      false,
      true
    );

    if (
      classProperty &&
      !t__namespace.isBooleanLiteral(value) &&
      !t__namespace.isUnaryExpression(value)
    ) {
      value = t__namespace.unaryExpression("!", t__namespace.unaryExpression("!", value));
    }

    properties.push(propIdent);
    values.push(t__namespace.objectProperty(propIdent, value));

    if (key === "class" || key === "style" || isStatefulDOMProperty(tagName, key)) {
      statements.push(
        t__namespace.expressionStatement(
          setAttr$2(path, elem, key, propIdent, {
            tagName,
            dynamic: true,
            prevId: optionalPropMember
          })
        )
      );
    } else {
      statements.push(
        t__namespace.expressionStatement(
          t__namespace.logicalExpression(
            "&&",
            key === "textContent"
              ? t__namespace.logicalExpression(
                  "||",
                  t__namespace.unaryExpression("!", prevId),
                  t__namespace.binaryExpression("!==", propIdent, propMember)
                )
              : t__namespace.binaryExpression("!==", propIdent, optionalPropMember),
            setAttr$2(path, elem, key, propIdent, {
              tagName,
              dynamic: true,
              styleProperty,
              classProperty
            })
          )
        )
      );
    }
  });

  return t__namespace.expressionStatement(
    t__namespace.callExpression(effectWrapperId, [
      t__namespace.arrowFunctionExpression([], t__namespace.objectExpression(values)),
      t__namespace.arrowFunctionExpression(
        [
          t__namespace.objectPattern(
            properties.map(id => t__namespace.objectProperty(id, id, false, true))
          ),
          prevId
        ],
        t__namespace.blockStatement(statements)
      )
    ])
  );
}

const t = t__namespace;

function appendToTemplate(template, value) {
  let array;
  if (Array.isArray(value)) {
    [value, ...array] = value;
  }
  template[template.length - 1] += value;
  if (array && array.length) template.push.apply(template, array);
}

function hoistExpression(path, results, expr, { group, post } = {}) {
  // Each dynamic gets a temp `_v$N` variable that's later assigned + passed
  // to `ssr(_tmpl, _v$N, …)`. The temp-var indirection is a V8 call-site
  // IC stability tactic: when `ssr()` always sees stable `Identifier`
  // references at its argument positions (rather than mixed call
  // expressions / arrow literals / string results inlined directly), the
  // call site stays specialized. Inlining destabilizes the IC and
  // measurably regresses throughput.
  //
  // Evaluation ordering is preserved by JS left-to-right semantics — the
  // temp var exists solely for IC stability.
  const variable = path.scope.generateUidIdentifier("v$");
  post
    ? results.postDeclarations.push(t.variableDeclarator(variable, expr))
    : results.declarations.push(t.variableDeclarator(variable, expr));
  // `group: true` marks the entry eligible for `groupAttributeClosures`.
  // `post` entries live in a separate declaration bucket and never group.
  if (group && !post) {
    if (!results.groupable) results.groupable = new Set();
    results.groupable.add(variable.name);
  }
  return variable;
}

// Coalesce contiguous runs of >=2 groupable templateValues entries into
// `_$ssrGroup(() => [...bodies], N)`, repeated N times in the `ssr(...)`
// arg list. Inserts/children break a run, so child isolation is preserved.
function groupAttributeClosures(path, results) {
  const groupable = results.groupable;
  if (!groupable || groupable.size < 2) return;
  const tv = results.templateValues;

  const runs = [];
  let runStart = -1;
  let runIds = [];
  for (let i = 0; i <= tv.length; i++) {
    const v = i < tv.length ? tv[i] : null;
    if (v && t__namespace.isIdentifier(v) && groupable.has(v.name)) {
      if (runStart === -1) {
        runStart = i;
        runIds = [];
      }
      runIds.push(v.name);
    } else if (runStart !== -1) {
      if (runIds.length >= 2) runs.push({ start: runStart, end: i, ids: runIds });
      runStart = -1;
      runIds = [];
    }
  }
  if (!runs.length) return;

  // Name → declarator index. Consumed slots are nulled in place (kept
  // stable for the whole pass, then filtered at the end).
  const declMap = new Map();
  for (let i = 0; i < results.declarations.length; i++) {
    const d = results.declarations[i];
    if (d && t__namespace.isIdentifier(d.id)) declMap.set(d.id.name, i);
  }

  // Reverse so `tv.splice` for earlier runs doesn't shift later indices.
  for (let r = runs.length - 1; r >= 0; r--) {
    const run = runs[r];
    const bodies = [];
    let firstIdx = -1;
    for (let k = 0; k < run.ids.length; k++) {
      const di = declMap.get(run.ids[k]);
      const init = results.declarations[di].init;
      // Arrow w/ expression body → inline its body. Anything else
      // (bare identifier, `_$escape(/*@static*/ x)`, …) gets dropped in
      // as-is; the runtime's type dispatch handles both fn and value slots.
      bodies.push(
        t__namespace.isArrowFunctionExpression(init) && !t__namespace.isBlockStatement(init.body)
          ? init.body
          : init
      );
      if (k === 0) firstIdx = di;
      else results.declarations[di] = null;
    }

    if (firstIdx < 0) continue;
    const groupId = path.scope.generateUidIdentifier("g$");
    const groupInit = t.callExpression(registerImportMethod(path, "ssrGroup"), [
      t.arrowFunctionExpression([], t.arrayExpression(bodies)),
      t.numericLiteral(bodies.length)
    ]);
    results.declarations[firstIdx] = t.variableDeclarator(groupId, groupInit);

    const replacements = new Array(run.ids.length);
    for (let k = 0; k < run.ids.length; k++) replacements[k] = t.cloneNode(groupId);
    tv.splice(run.start, run.end - run.start, ...replacements);
  }

  results.declarations = results.declarations.filter(d => d !== null);
}

// One marker statement per program: `_$ssrSelectValues();` after imports.
const selectValuesMarked = new WeakSet();
function registerSelectValues(path) {
  const program = path.findParent(p => t.isProgram(p.node));
  if (selectValuesMarked.has(program.node)) return;
  selectValuesMarked.add(program.node);
  const marker = registerImportMethod(path, "ssrSelectValues", undefined);
  program.unshiftContainer("body", t.expressionStatement(t.callExpression(marker, [])));
}

function transformElement$2(path, info = {}) {
  const tagName = getTagName(path.node);

  path
    .get("openingElement")
    .get("attributes")
    .forEach(attr => {
      if (t.isJSXAttribute(attr.node)) evaluateAndInline(attr.node.value, attr.get("value"));
    });

  const config = getConfig(path);
  if (tagName === "script" || tagName === "style") path.doNotEscape = true;

  // A `<select value=…>` (or a spread that could carry one) opts this module
  // into the runtime's SSR select-value resolution pass. The pass is a
  // full-output scan — the flag keeps every app that never binds a select
  // value from paying it on any render (see resolveSSRSelectValues).
  if (
    tagName === "select" &&
    path.node.openingElement.attributes.some(
      a =>
        t.isJSXSpreadAttribute(a) ||
        (t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === "value")
    )
  )
    registerSelectValues(path);

  // contains spread attributes
  if (path.node.openingElement.attributes.some(a => t.isJSXSpreadAttribute(a)))
    return createElement(path, { ...info, ...config });

  // Duplicate same-named attributes on the same element resolve to the
  // last value (matching DOM-mode and JSX spread semantics). Strip the
  // earlier occurrences before the rest of the SSR transform runs.
  {
    const seenAttributes = {};
    const duplicates = [];
    path
      .get("openingElement")
      .get("attributes")
      .forEach(attr => {
        if (!t.isJSXAttribute(attr.node)) return;
        const key = t.isJSXNamespacedName(attr.node.name)
          ? `${attr.node.name.namespace.name}:${attr.node.name.name.name}`
          : attr.node.name.name;

        if (key !== "ref" && seenAttributes[key]) {
          duplicates.push(seenAttributes[key]);
        }
        seenAttributes[key] = attr;
      });
    for (const duplicate of duplicates) {
      duplicate.remove();
    }
  }

  const voidTag = VoidElements.has(tagName),
    results = {
      template: [`<${tagName}`],
      templateValues: [],
      declarations: [],
      postDeclarations: [],
      exprs: [],
      dynamics: info.parentResults?.dynamics || [],
      tagName,
      wontEscape: path.node.wontEscape,
      renderer: "ssr",
      groupId: info.parentResults?.groupId
    };

  if (info.topLevel && config.hydratable) {
    results.template.push("");
    results.templateValues.push(
      hoistExpression(
        path,
        results,
        t.callExpression(registerImportMethod(path, "ssrHydrationKey"), [])
      )
    );
  }
  transformAttributes$1(path, results, { ...config, ...info });
  appendToTemplate(results.template, ">");
  if (!voidTag) {
    transformChildren$1(path, results, { ...config, ...info });
    appendToTemplate(results.template, `</${tagName}>`);
  }
  // Run grouping once at the top-level element so contiguous closures
  // across nested elements can collapse into a single grouped function.
  if (info.topLevel) groupAttributeClosures(path, results);
  return results;
}

function setAttr$1(tagName, attribute, results, name, value, isDynamic, isBoolean) {
  // strip out namespaces for now, everything at this point is an attribute
  let parts;
  if ((parts = name.split(":")) && parts[1] && reservedNameSpaces.has(parts[0])) {
    name = parts[1];
  }

  let attr = t.callExpression(registerImportMethod(attribute, "ssrAttribute"), [
    t.stringLiteral(name),
    value
  ]);
  if (isDynamic) {
    attr = t.arrowFunctionExpression([], attr);

    const post = isStatefulDOMProperty(tagName, name);

    results.templateValues.push(
      hoistExpression(attribute, results, attr, {
        group: true,
        post
      })
    );
    results.template.push("");
  } else {
    results.templateValues.push(attr);
    results.template.push("");
  }
}

function escapeExpression(
  path,
  expression,

  attr,
  escapeLiterals
) {
  if (!expression) return expression;
  if (
    t.isStringLiteral(expression) ||
    t.isNumericLiteral(expression) ||
    (t.isTemplateLiteral(expression) && expression.expressions.length === 0)
  ) {
    if (escapeLiterals) {
      if (t.isStringLiteral(expression)) return t.stringLiteral(escapeHTML(expression.value, attr));
      else if (t.isTemplateLiteral(expression))
        return t.stringLiteral(escapeHTML(expression.quasis[0].value.raw, attr));
    }
    return expression;
  } else if (t.isFunction(expression)) {
    if (t.isBlockStatement(expression.body)) {
      expression.body.body = expression.body.body.map(e => {
        if (t.isReturnStatement(e))
          e.argument = escapeExpression(path, e.argument, attr, escapeLiterals);
        return e;
      });
    } else expression.body = escapeExpression(path, expression.body, attr, escapeLiterals);

    return expression;
  } else if (t.isTemplateLiteral(expression)) {
    // Interpolations are escaped recursively. The static quasis are not —
    // `url("${x}")` would otherwise leave a raw `"` inside style="..." /
    // attr="...". Escape those parts at compile time when this expression
    // is landing in an attribute.
    if (attr) escapeTemplateQuasis(expression, true);
    expression.expressions = expression.expressions.map(e =>
      escapeExpression(path, e, attr, escapeLiterals)
    );
    return expression;
  } else if (t.isUnaryExpression(expression)) {
    return expression;
  } else if (t.isBinaryExpression(expression)) {
    expression.left = escapeExpression(path, expression.left, attr, escapeLiterals);
    expression.right = escapeExpression(path, expression.right, attr, escapeLiterals);
    return expression;
  } else if (t.isConditionalExpression(expression)) {
    expression.consequent = escapeExpression(path, expression.consequent, attr, escapeLiterals);
    expression.alternate = escapeExpression(path, expression.alternate, attr, escapeLiterals);
    return expression;
  } else if (t.isLogicalExpression(expression)) {
    // Preserve the cheaper short-circuit path for && while escaping the
    // selected result of || and ?? as a whole.
    if (expression.operator === "&&") {
      expression.right = escapeExpression(path, expression.right, attr, escapeLiterals);
      return expression;
    }
  } else if (t.isCallExpression(expression) && t.isFunction(expression.callee)) {
    if (t.isBlockStatement(expression.callee.body)) {
      expression.callee.body.body = expression.callee.body.body.map(e => {
        if (t.isReturnStatement(e))
          e.argument = escapeExpression(path, e.argument, attr, escapeLiterals);
        return e;
      });
    } else
      expression.callee.body = escapeExpression(path, expression.callee.body, attr, escapeLiterals);
    return expression;
  } else if (t.isJSXElement(expression) && !isComponent(getTagName(expression))) {
    expression.wontEscape = true;
    return expression;
  } else if (t.isJSXFragment(expression) && fragmentWillSelfEscape(expression)) {
    // The fragment will later be transformed into a runtime value the
    // `escape` helper passes through unchanged — either a memoized
    // accessor function or an `_$ssr(...)` SSRNode object (see
    // `fragmentWillSelfEscape`). Wrapping it in another `_$escape(...)`
    // here would be a guaranteed no-op, so leave the fragment in place
    // and let the later traversal emit the inner form directly.
    return expression;
  }

  return t.callExpression(
    registerImportMethod(path, "escape"),
    [expression].concat(attr ? [t.booleanLiteral(true)] : [])
  );
}

function escapeTemplateQuasis(expression, attr) {
  for (const quasi of expression.quasis) {
    const src = quasi.value.cooked != null ? quasi.value.cooked : quasi.value.raw;
    const escaped = escapeHTML(src, attr);
    if (typeof escaped !== "string" || escaped === src) continue;
    quasi.value.cooked = escaped;
    // Codegen prints `raw`. Re-escape template delimiters so `&quot;` etc.
    // stay literal text.
    quasi.value.raw = escaped.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  }
}

// Predicts whether a JSXFragment AST will compile to a single runtime
// value for which the outer `_$escape(...)` wrap is a no-op. Must stay
// conservative: any shape this returns `true` for must, when later
// transformed, produce a self-escaping (or escape-immune) runtime value.
// When in doubt, return false so the outer `_$escape` wrap is kept.
//
// Recognized single-significant-child shapes:
//   A. `<>{memberOrCall}</>` — a `JSXExpressionContainer` whose
//      expression matches the top-level subset of
//      `isDynamic({ checkMember: true })` (member access, call, tagged
//      template, optional variants, `in` checks). `createTemplate`
//      emits `_$memo(() => _$escape(expr))`; the memo returns a
//      function accessor at runtime and `escape(fn)` is a pass-through.
//      Nested-dynamic shapes (conditional/logical carrying dynamic
//      sub-expressions) are excluded — confirming them needs the full
//      `isDynamic` traversal and a missed optimization costs only one
//      runtime no-op call.
//   B. `<><native /></>` — a single native (non-component) JSXElement.
//      `createTemplate` emits `_$ssr(_tmpl$N, …)`, which returns an
//      SSRNode object; `escape(object)` is a pass-through.
function fragmentWillSelfEscape(fragment) {
  let only = null;
  for (const c of fragment.children) {
    if (t.isJSXText(c)) {
      if (trimWhitespace(c.extra?.raw ?? "").length === 0) continue;
      return false;
    }
    if (t__namespace.isJSXExpressionContainer(c) && t__namespace.isJSXEmptyExpression(c.expression))
      continue;
    if (only !== null) return false;
    if (t__namespace.isJSXElement(c) || t__namespace.isJSXExpressionContainer(c)) only = c;
    else return false;
  }
  if (!only) return false;
  if (t__namespace.isJSXExpressionContainer(only)) {
    const expr = only.expression;
    if (t__namespace.isJSXEmptyExpression(expr)) return false;
    return (
      t.isCallExpression(expr) ||
      t.isOptionalCallExpression(expr) ||
      t.isTaggedTemplateExpression(expr) ||
      t.isMemberExpression(expr) ||
      t.isOptionalMemberExpression(expr) ||
      (t__namespace.isBinaryExpression(expr) && expr.operator === "in")
    );
  }
  if (t__namespace.isJSXElement(only)) return !isComponent(getTagName(only));
  return false;
}

function normalizeAttributes(path) {
  const attributes = path.get("openingElement").get("attributes");
  const classAttributes = attributes.filter(
    a => t.isJSXAttribute(a.node) && t.isJSXIdentifier(a.node.name, { name: "class" })
  );
  // combine class propertoes
  if (classAttributes.length > 1) {
    const first = classAttributes[0].node,
      values = [],
      quasis = [t.templateElement({ raw: "" })];
    for (let i = 0; i < classAttributes.length; i++) {
      const attr = classAttributes[i].node,
        isLast = i === classAttributes.length - 1;
      if (!t.isJSXExpressionContainer(attr.value)) {
        const prev = quasis.pop();
        quasis.push(
          t.templateElement({
            raw: (prev ? prev.value.raw : "") + `${attr.value.value}` + (isLast ? "" : " ")
          })
        );
      } else {
        let expr = attr.value.expression;
        if (t.isJSXEmptyExpression(expr)) continue;
        if (attr.name.name === "class") {
          if (t.isObjectExpression(expr) && !expr.properties.some(p => t.isSpreadElement(p))) {
            transformClasslistObject(path, expr, values, quasis);
            if (!isLast) quasis[quasis.length - 1].value.raw += " ";
            i && attributes.splice(attributes.indexOf(classAttributes[i]), 1);
            continue;
          }
          expr = t.callExpression(registerImportMethod(path, "ssrClassName"), [expr]);
        }
        values.push(t.logicalExpression("||", expr, t.stringLiteral("")));
        quasis.push(t.templateElement({ raw: isLast ? "" : " " }));
      }
      i && attributes.splice(attributes.indexOf(classAttributes[i]), 1);
    }
    first.name = t.jsxIdentifier("class");
    first.value = t.jsxExpressionContainer(t.templateLiteral(quasis, values));
  }
  return attributes;
}

function transformAttributes$1(path, results, info) {
  const tagName = getTagName(path.node);

  const hasChildren = path.node.children.length > 0,
    attributes = normalizeAttributes(path);
  let children;
  // Server-components claims: ref/on* positions on server-rendered
  // intrinsics collect here and emit as one guarded whole-attribute hole
  // (` _bnd="..."` or "") after the loop. Evaluation is gated on the render
  // context's claims flag so plain SSR never runs the expressions.
  const claims = [];

  attributes.forEach(attribute => {
    if (!t.isJSXAttribute(attribute.node)) return;
    const node = attribute.node;

    let value = node.value,
      key = t.isJSXNamespacedName(node.name)
        ? `${node.name.namespace.name}:${node.name.name.name}`
        : node.name.name,
      reservedNameSpace =
        t.isJSXNamespacedName(node.name) && reservedNameSpaces.has(node.name.namespace.name);
    if (
      ((t.isJSXNamespacedName(node.name) && reservedNameSpace) || ChildProperties.has(key)) &&
      !t.isJSXExpressionContainer(value)
    ) {
      node.value = value = t.jsxExpressionContainer(value || t.jsxEmptyExpression());
    }

    if (
      t.isJSXExpressionContainer(value) &&
      (reservedNameSpace ||
        ChildProperties.has(key) ||
        !(
          t.isStringLiteral(value.expression) ||
          t.isNumericLiteral(value.expression) ||
          t.isBooleanLiteral(value.expression)
        ))
    ) {
      if (t.isJSXEmptyExpression(value.expression)) return;
      if (key === "ref") {
        if (info.serverComponents) {
          claims.push(["ref", value.expression]);
          return;
        }
        results.declarations.push(
          t.variableDeclarator(path.scope.generateUidIdentifier("_ref$"), value.expression)
        );
        return;
      }
      if (key.startsWith("prop:")) return;
      if (key.startsWith("on")) {
        // Capture-phase variants can't ride delegation; v1 drops them as
        // before. `on:x` keeps the raw name, `onXxx` lowercases — the same
        // event-name derivation as the client runtime.
        if (info.serverComponents && !key.startsWith("oncapture:")) {
          const pos = key.startsWith("on:") ? key.slice(3) : key.slice(2).toLowerCase();
          if (pos) claims.push([pos, value.expression]);
        }
        return;
      }
      if (ChildProperties.has(key)) {
        if (key === "children" && VoidElements.has(tagName)) return;
        if (info.hydratable && key === "textContent" && value && value.expression) {
          const comments = value.expression.leadingComments;
          value.expression = t.logicalExpression("||", value.expression, t.stringLiteral(" "));
          comments && (value.expression.leadingComments = comments);
        }
        if (key === "innerHTML") path.doNotEscape = true;
        // textContent groups with attributes; innerHTML stays opaque.
        if (key === "textContent") value._groupableTextContent = true;
        // innerHTML/textContent/innerText redirects travel the child pipeline,
        // but their values are opaque content (an HTML/text string), never
        // id-allocating JSX — and the client applies them as plain prop
        // effects with no owner. Flag them so transformChildren skips the
        // _$scope wrap a call-shaped value would otherwise get: the scope
        // reserves a hydration child id the client never allocates, shifting
        // every keyed sibling after it (#3015). The `children` attribute stays
        // eligible — it is a real insert on the client and scopes there too.
        if (key !== "children") value._childProperty = true;
        children = value;
      } else {
        const isDynamicValue = isDynamic(attribute.get("value").get("expression"), {
          checkMember: true,
          checkTags: true
        });
        let doEscape = true;
        let isBoolean =
          t.isBooleanLiteral(value) ||
          (t.isJSXExpressionContainer(value) && t.isBooleanLiteral(value.expression));
        if (isBoolean) doEscape = false;
        if (key === "style") {
          if (
            t.isJSXExpressionContainer(value) &&
            t.isObjectExpression(value.expression) &&
            !value.expression.properties.some(p => t.isSpreadElement(p))
          ) {
            if (value.expression.properties.length === 0) {
              return;
            }
            const props = value.expression.properties.flatMap((p, i) => {
              if (t.isSpreadElement(p) || t.isObjectMethod(p)) return [];
              if (p.computed) {
                // Computed keys are user-controlled at runtime; wrap with
                // `_$escape(..., true)` so ssrStyleProperty can stay a pure
                // string concat helper (literal-key path is already safe).
                const escape = registerImportMethod(path, "escape");
                return t.callExpression(registerImportMethod(path, "ssrStyleProperty"), [
                  t.binaryExpression(
                    "+",
                    t.callExpression(escape, [p.key, t.booleanLiteral(true)]),
                    t.stringLiteral(":")
                  ),
                  escapeExpression(path, p.value, true, true)
                ]);
              }
              return t.callExpression(registerImportMethod(path, "ssrStyleProperty"), [
                t.stringLiteral(
                  (i ? ";" : "") + (t.isIdentifier(p.key) ? p.key.name : p.key.value) + ":"
                ),
                escapeExpression(path, p.value, true, true)
              ]);
            });

            let res = props[0];
            for (let i = 1; i < props.length; i++) {
              res = t.binaryExpression("+", res, props[i]);
            }
            value.expression = res;
          } else {
            value.expression = t.callExpression(registerImportMethod(path, "ssrStyle"), [
              value.expression
            ]);
          }
          doEscape = false;
        }
        if (key === "class") {
          if (
            t.isObjectExpression(value.expression) &&
            !value.expression.properties.some(p => t.isSpreadElement(p))
          ) {
            const values = [],
              quasis = [t.templateElement({ raw: "" })];
            transformClasslistObject(path, value.expression, values, quasis);
            if (!values.length) value.expression = t.stringLiteral(quasis[0].value.raw);
            else if (values.length === 1 && !quasis[0].value.raw && !quasis[1].value.raw) {
              value.expression = values[0];
            } else value.expression = t.templateLiteral(quasis, values);
          } else {
            value.expression = t.callExpression(registerImportMethod(path, "ssrClassName"), [
              value.expression
            ]);
          }
          key = "class";
          doEscape = false;
        }
        if (doEscape) value.expression = escapeExpression(path, value.expression, true);
        const expression = value.expression;

        if (!(doEscape || isBoolean) || t.isLiteral(expression)) {
          if (isBoolean) {
            t.isBooleanLiteral(expression) &&
              expression.value === true &&
              appendToTemplate(results.template, ` ${key}`);
            return;
          }
          appendToTemplate(results.template, ` ${key}="`);
          results.template.push(`"`);
          if (isDynamicValue) {
            results.templateValues.push(
              hoistExpression(path, results, inlineCallExpression(expression), {
                group: true
              })
            );
          } else results.templateValues.push(expression);
        } else setAttr$1(tagName, attribute, results, key, expression, isDynamicValue);
      }
    } else {
      if (key === "$ServerOnly") return;
      let staticValue = value;
      if (t.isJSXExpressionContainer(value)) {
        if (t.isJSXEmptyExpression(value.expression)) return;
        staticValue = value.expression;
      }
      const booleanLiteral = t.isBooleanLiteral(staticValue) ? staticValue : undefined;
      const isBoolean = !!booleanLiteral;
      if (booleanLiteral && !booleanLiteral.value) return;
      appendToTemplate(results.template, ` ${key}`);
      if (!staticValue) return;
      let text = isBoolean ? "" : staticValue.value;
      if (key === "style" || key === "class") {
        text = trimWhitespace(String(text));
        if (key === "style") {
          text = text.replace(/; /g, ";").replace(/: /g, ":");
        }
      }

      appendToTemplate(
        results.template,
        // `String(text)` is needed, as text.length will mess up `attr=10>` becomes `attr>` without it
        String(text) === "" ? `` : `="${escapeHTML(text, true)}"`
      );
    }
  });
  if (claims.length) {
    // Duplicate event keys were already last-wins-stripped above; `ref` is
    // exempt from that pass (client semantics fire every ref), so multiple
    // refs merge into an array value.
    const byPos = new Map();
    for (const [pos, expr] of claims) {
      let list = byPos.get(pos);
      if (!list) byPos.set(pos, (list = []));
      list.push(expr);
    }
    const map = t.objectExpression(
      [...byPos].map(([pos, exprs]) =>
        t.objectProperty(
          t.stringLiteral(pos),
          exprs.length === 1 ? exprs[0] : t.arrayExpression(exprs)
        )
      )
    );
    // `_$sharedConfig.context && _$sharedConfig.context.claims
    //    ? _$ssrClaim({...}) : ""`
    // — the claims flag is only set inside a server component's render
    // scope (and cleared inside suppressed fill windows), so ordinary SSR
    // pays the property reads and never evaluates the expressions.
    const sharedConfigId = registerImportMethod(path, "sharedConfig");
    const contextRead = () =>
      t.memberExpression(t.cloneNode(sharedConfigId), t.identifier("context"));
    const guarded = t.conditionalExpression(
      t.logicalExpression(
        "&&",
        contextRead(),
        t.memberExpression(contextRead(), t.identifier("claims"))
      ),
      t.callExpression(registerImportMethod(path, "ssrClaim"), [map]),
      t.stringLiteral("")
    );
    results.template.push("");
    results.templateValues.push(hoistExpression(path, results, guarded));
  }
  if (!hasChildren && children) {
    path.node.children.push(children);
  }
}

function transformClasslistObject(path, expr, values, quasis) {
  expr.properties.forEach((prop, i) => {
    if (t.isSpreadElement(prop) || t.isObjectMethod(prop)) return;
    const isLast = expr.properties.length - 1 === i;
    let key;
    if (t.isIdentifier(prop.key) && !prop.computed) key = t.stringLiteral(prop.key.name);
    else if (prop.computed) {
      key = t.callExpression(registerImportMethod(path, "escape"), [
        prop.key,
        t.booleanLiteral(true)
      ]);
    } else key = t.stringLiteral(escapeHTML(prop.key.value));
    if (t.isBooleanLiteral(prop.value)) {
      if (prop.value.value === true) {
        if (!prop.computed) {
          const prev = quasis.pop();
          quasis.push(
            t.templateElement({
              raw:
                (prev ? prev.value.raw : "") + (i ? " " : "") + `${key.value}` + (isLast ? "" : " ")
            })
          );
        } else {
          values.push(key);
          quasis.push(t.templateElement({ raw: isLast ? "" : " " }));
        }
      }
    } else {
      values.push(t.conditionalExpression(prop.value, key, t.stringLiteral("")));
      quasis.push(t.templateElement({ raw: isLast ? "" : " " }));
    }
  });
}

function transformChildren$1(path, results, { hydratable }) {
  const doNotEscape = path.doNotEscape;
  const tagName = getTagName(path.node);
  const filteredChildren = filterChildren(path.get("children"));
  const multi = checkLength(filteredChildren),
    markers = hydratable && multi;
  filteredChildren.forEach(node => {
    if (node.isJSXFragment()) {
      throw new Error(
        `Fragments can only be used top level in JSX. Not used under a <${tagName}>.`
      );
    }
    const allocatesIds = hydratable && !node.node._childProperty && canChildSlotAllocateIds(node);
    const child = transformNode(node, { doNotEscape, parentResults: results });
    if (!child) return;
    appendToTemplate(results.template, child.template);
    results.templateValues.push.apply(results.templateValues, child.templateValues || []);
    child.declarations && results.declarations.push(...child.declarations);
    child.postDeclarations && results.postDeclarations.push(...child.postDeclarations);
    if (child.groupable) {
      if (!results.groupable) results.groupable = new Set();
      for (const name of child.groupable) results.groupable.add(name);
    }
    results.groupId ||= child.groupId;
    if (child.exprs.length) {
      if (!doNotEscape && !child.spreadElement)
        child.exprs[0] = escapeExpression(path, child.exprs[0]);

      // textContent flows through here as a synthesized child; flag it
      // for grouping (see `transformAttributes`).
      const hoistOpts = node.node._groupableTextContent ? { group: true } : undefined;
      // Deferred holes that can allocate hydration ids evaluate under their
      // own owner scope so retry timing can't skew sibling ids (mirrors the
      // dom generate's `scope()` wrap around the matching insert accessor).
      // Keyed off `dynamic` so both generates decide identically.
      let expr = child.exprs[0];
      if (allocatesIds && child.dynamic) {
        expr = t.callExpression(registerImportMethod(path, "scope"), [expr]);
      }

      // boxed by textNodes
      if (markers && !child.spreadElement) {
        appendToTemplate(results.template, `<!--$-->`);
        results.template.push("");
        results.templateValues.push(hoistExpression(path, results, expr, hoistOpts));
        appendToTemplate(results.template, `<!--/-->`);
      } else {
        results.template.push("");
        results.templateValues.push(hoistExpression(path, results, expr, hoistOpts));
      }
    }
  });
}

function createElement(path, { topLevel, hydratable }) {
  const tagName = getTagName(path.node),
    config = getConfig(path),
    attributes = normalizeAttributes(path),
    doNotEscape = path.doNotEscape;

  const filteredChildren = filterChildren(path.get("children")),
    multi = checkLength(filteredChildren),
    markers = hydratable && multi,
    childNodes = filteredChildren.reduce((memo, path) => {
      if (t.isJSXText(path.node)) {
        const v = htmlEntities.decode(trimWhitespace(path.node.extra?.raw ?? ""));
        if (v.length) memo.push(t.stringLiteral(v));
      } else {
        if (path.isJSXFragment()) {
          throw new Error(
            `Fragments can only be used top level in JSX. Not used under a <${tagName}>.`
          );
        }
        const allocatesIds = hydratable && canChildSlotAllocateIds(path);
        const child = transformNode(path);
        if (!child) return memo;
        if (markers && child.exprs.length && !child.spreadElement)
          memo.push(t.stringLiteral("<!--$-->"));
        if (child.exprs.length && !doNotEscape && !child.spreadElement)
          child.exprs[0] = escapeExpression(path, child.exprs[0]);
        // Deferred holes that can allocate hydration ids evaluate under their
        // own owner scope, exactly like `transformChildren` does for the
        // template path. Spread elements render through `ssrElement` instead
        // of a template, but their children holes still need the wrap — the
        // dom generate scope()s the matching insert accessor regardless of
        // spread, so skipping it here desyncs every hydration id that follows
        // the hole.
        if (child.exprs.length && allocatesIds && child.dynamic) {
          child.exprs[0] = t.callExpression(registerImportMethod(path, "scope"), [child.exprs[0]]);
        }
        memo.push(getCreateTemplate(config, path, child)(path, child, false));
        if (markers && child.exprs.length && !child.spreadElement)
          memo.push(t.stringLiteral("<!--/-->"));
      }
      return memo;
    }, []);

  let props;
  if (attributes.length === 1 && t.isJSXSpreadAttribute(attributes[0].node)) {
    props = [attributes[0].node.argument];
  } else {
    props = [];
    let runningObject = [],
      dynamicSpread = false,
      hasChildren = path.node.children.length > 0;

    attributes.forEach(attribute => {
      const node = attribute.node;
      if (t.isJSXSpreadAttribute(node)) {
        if (runningObject.length) {
          props.push(t.objectExpression(runningObject));
          runningObject = [];
        }
        props.push(
          isDynamic(attribute.get("argument"), {
            checkMember: true
          }) && (dynamicSpread = true)
            ? inlineCallExpression(node.argument)
            : node.argument
        );
      } else if (t.isJSXAttribute(node)) {
        const value = node.value || t.booleanLiteral(true),
          id = convertJSXIdentifier(node.name),
          key = t.isJSXNamespacedName(node.name)
            ? `${node.name.namespace.name}:${node.name.name.name}`
            : node.name.name;

        if (hasChildren && key === "children") return;
        if (key === "ref") return;
        if (key.startsWith("prop:") || key.startsWith("on")) return;
        if (t.isJSXExpressionContainer(value)) {
          if (t.isJSXEmptyExpression(value.expression)) return;
          const expression = value.expression;
          if (
            isDynamic(attribute.get("value").get("expression"), {
              checkMember: true,
              checkTags: true
            })
          ) {
            runningObject.push(
              t.objectMethod(
                "get",
                id,
                [],
                t.blockStatement([t.returnStatement(expression)]),
                !t.isValidIdentifier(key)
              )
            );
          } else runningObject.push(t.objectProperty(id, expression));
        } else runningObject.push(t.objectProperty(id, value));
      }
    });

    if (runningObject.length || !props.length) props.push(t.objectExpression(runningObject));

    if (props.length > 1 || dynamicSpread) {
      let merged = t.callExpression(registerImportMethod(path, "mergeProps"), props);
      // Defer the merge behind a thunk when hydratable: `mergeProps` with a
      // function source creates a memo, which consumes a hydration child id.
      // Evaluated in argument position it would run before `ssrElement`
      // allocates the element's own id, while the client claims the element
      // (getNextElement) before applying the spread — shifting the element's
      // id by one and leaving it unclaimed. `ssrElement` resolves function
      // props after allocating the hydration key, matching the client order.
      if (hydratable) merged = t.arrowFunctionExpression([], merged);
      props = [merged];
    }
  }

  const exprs = [
    t.callExpression(registerImportMethod(path, "ssrElement"), [
      t.stringLiteral(tagName),
      props[0],
      childNodes.length
        ? hydratable
          ? t.arrowFunctionExpression(
              [],
              childNodes.length === 1 ? childNodes[0] : t.arrayExpression(childNodes)
            )
          : childNodes.length === 1
            ? childNodes[0]
            : t.arrayExpression(childNodes)
        : t.identifier("undefined"),
      t.booleanLiteral(Boolean(topLevel && config.hydratable))
    ])
  ];

  return { exprs, template: "", declarations: [], dynamics: [], spreadElement: true };
}

// Wrap the *inner* value of a fragment-child accessor with `_$escape` so that
// hostile string values returned from reactive accessors cannot be
// concatenated raw into the SSR output. Element-child expressions already get
// this treatment via `escapeExpression` in `ssr/element.js`; fragment
// children reach SSR via a different code path and would otherwise skip the
// escape step.
//
// `expr` is the first entry of `result.exprs` produced by `transformNode`
// for a `JSXExpressionContainer`. It is either:
//   - an arrow function `() => X` (default case)
//   - a bare callee (`fnRef`, emitted when the expression is `fnRef()` with
//     no args — see the JSXExpressionContainer branch in shared/transform.js)
//   - the result of `transformCondition(..., inline=true)`, which also
//     returns an arrow function
// For arrows with an expression body we rewrite in place; for anything else
// we conservatively wrap in a new arrow that calls and escapes.
function wrapFragmentChildWithEscape(path, expr) {
  const escape = registerImportMethod(path, "escape", undefined);
  if (t__namespace.isArrowFunctionExpression(expr) && !t__namespace.isBlockStatement(expr.body)) {
    expr.body = t__namespace.callExpression(escape, [expr.body]);
    return expr;
  }
  return t__namespace.arrowFunctionExpression(
    [],
    t__namespace.callExpression(escape, [t__namespace.callExpression(expr, [])])
  );
}

function createTemplate$1(path, result, wrap) {
  if (!result.template) {
    if (wrap && result.dynamic && getConfig(path).memoWrapper) {
      // wontEscape is set on JSXElement children whose compiled form is
      // already a safe SSR node (e.g. `_$ssr(...)` call). Wrapping those in
      // escape would be a no-op at runtime but obscures intent — skip it.
      const inner = result.wontEscape
        ? result.exprs[0]
        : wrapFragmentChildWithEscape(path, result.exprs[0]);
      return t__namespace.callExpression(
        registerImportMethod(path, getConfig(path).memoWrapper, undefined),
        [inner]
      );
    }
    return result.exprs[0];
  }

  let template, id;

  if (!Array.isArray(result.template)) {
    template = t__namespace.stringLiteral(result.template);
  } else if (result.template.length === 1) {
    template = t__namespace.stringLiteral(result.template[0]);
  } else {
    const strings = result.template.map(tmpl => t__namespace.stringLiteral(tmpl));
    template = t__namespace.arrayExpression(strings);
  }

  const data = path.scope.getProgramParent().data;
  const templates = data.templates || (data.templates = []);
  const found = templates.find(tmp => {
    const candidate = tmp.template;
    if (
      typeof candidate !== "string" &&
      t__namespace.isArrayExpression(candidate) &&
      t__namespace.isArrayExpression(template)
    ) {
      return candidate.elements.every(
        (el, i) =>
          t__namespace.isStringLiteral(el) &&
          t__namespace.isStringLiteral(template.elements[i]) &&
          el.value === template.elements[i].value
      );
    }
    return typeof candidate !== "string" &&
      t__namespace.isStringLiteral(candidate) &&
      t__namespace.isStringLiteral(template)
      ? candidate.value === template.value
      : false;
  });
  if (!found) {
    id = path.scope.generateUidIdentifier("tmpl$");
    templates.push({
      id,
      template,
      templateWithClosingTags: template,
      renderer: "ssr"
    });
  } else id = found.id;

  if (result.wontEscape) {
    if (!Array.isArray(result.template) || result.template.length === 1) return id;
    else if (
      Array.isArray(result.template) &&
      result.template.length === 2 &&
      t__namespace.isCallExpression(result.templateValues?.[0]) &&
      t__namespace.isIdentifier(result.templateValues[0].callee, { name: "_$ssrHydrationKey" })
    ) {
      // remove unnecessary ssr call when only hydration key is used
      return t__namespace.binaryExpression(
        "+",
        t__namespace.binaryExpression(
          "+",
          t__namespace.memberExpression(id, t__namespace.numericLiteral(0), true),
          result.templateValues[0]
        ),
        t__namespace.memberExpression(id, t__namespace.numericLiteral(1), true)
      );
    }
  }

  const ssrCall = t__namespace.callExpression(
    registerImportMethod(path, "ssr", undefined),
    Array.isArray(result.template) && result.template.length > 1
      ? [id, ...(result.templateValues ?? [])]
      : [id]
  );

  const declarators = [...result.declarations, ...(result.postDeclarations ?? [])].filter(
    declaration =>
      !!declaration &&
      t__namespace.isVariableDeclarator(declaration) &&
      !!declaration.init &&
      t__namespace.isExpression(declaration.init)
  );
  if (!declarators.length) return ssrCall;

  // IIFE-free emission — declarations live outside the `ssr(...)` call to
  // save one closure allocation + one function-call frame per render.
  // Two shapes depending on JSX position:
  //
  //   - Statement positions (`return <jsx/>;`, `const x = <jsx/>;`):
  //     emit a single combined `var _v$ = init1, _v$2 = init2;`
  //     statement before the parent. `var` declarations hoist to the
  //     enclosing function so semantics match the old IIFE form.
  //
  //   - Expression positions (ternary branches, array elements, function
  //     args, logical operators): hoist bare `var _v$;` declarations to
  //     the enclosing function scope via `path.scope.push`, and emit a
  //     comma sequence expression `(_v$ = init, ssr(...))` at the JSX
  //     site. The hoist is required — JS forbids `var` declarations
  //     inside expressions — and the assignment must stay inline so its
  //     side effects fire only when the surrounding control-flow gate
  //     selects this branch.
  const isReturnArg =
    t__namespace.isReturnStatement(path.parent) && path.parent.argument === path.node;
  const isVarInit =
    t__namespace.isVariableDeclarator(path.parent) && path.parent.init === path.node;

  if (isReturnArg || isVarInit) {
    path.getStatementParent()?.insertBefore(
      t__namespace.variableDeclaration(
        "var",
        declarators.map(d => t__namespace.variableDeclarator(d.id, d.init))
      )
    );
    return ssrCall;
  }

  for (const d of declarators) path.scope.push({ id: d.id, kind: "var" });
  return t__namespace.sequenceExpression([
    ...declarators.map(d => t__namespace.assignmentExpression("=", d.id, d.init)),
    ssrCall
  ]);
}

function appendTemplates(path, templates) {
  const declarators = templates.map(template => {
    return t__namespace.variableDeclarator(template.id, template.template);
  });
  path.node.body.unshift(t__namespace.variableDeclaration("var", declarators));
}

function transformElement$1(path, info = {}) {
  path
    .get("openingElement")
    .get("attributes")
    .forEach(attr => {
      if (t__namespace.isJSXAttribute(attr.node))
        evaluateAndInline(attr.node.value, attr.get("value"));
    });

  let tagName = getTagName(path.node),
    results = {
      template: "",
      id: path.scope.generateUidIdentifier("el$"),
      declarations: [],
      exprs: [],
      dynamics: [],
      postExprs: [],
      tagName,
      renderer: "universal"
    };

  const initProps = transformAttributes(path, results);
  const createElementArgs = [t__namespace.stringLiteral(tagName)];
  if (initProps.length) createElementArgs.push(t__namespace.objectExpression(initProps));
  results.declarations.push(
    t__namespace.variableDeclarator(
      results.id,
      t__namespace.callExpression(
        registerImportMethod(
          path,
          "createElement",
          getRendererConfig(path, "universal").moduleName
        ),
        createElementArgs
      )
    )
  );
  transformChildren(path, results);

  return results;
}

function transformAttributes(path, results) {
  let children, spreadExpr;
  let attributes = path.get("openingElement").get("attributes");
  const initProps = [];
  const elem = results.id,
    hasChildren = path.node.children.length > 0,
    config = getConfig(path),
    hasSpread = attributes.some(attribute => t__namespace.isJSXSpreadAttribute(attribute.node));

  // preprocess spreads
  if (hasSpread) {
    [attributes, spreadExpr] = processSpreads(path, attributes, {
      elem,
      hasChildren,
      wrapConditionals: config.wrapConditionals
    });
    path.get("openingElement").set(
      "attributes",
      attributes.map(a => a.node)
    );
  }

  path
    .get("openingElement")
    .get("attributes")
    .forEach(attribute => {
      const node = attribute.node;
      if (t__namespace.isJSXSpreadAttribute(node)) return;

      let value = node.value,
        key = t__namespace.isJSXNamespacedName(node.name)
          ? `${node.name.namespace.name}:${node.name.name.name}`
          : node.name.name;
      if (t__namespace.isJSXExpressionContainer(value)) {
        if (key === "ref") {
          // Normalize expressions for non-null and type-as
          while (
            t__namespace.isTSNonNullExpression(value.expression) ||
            t__namespace.isTSAsExpression(value.expression)
          ) {
            value.expression = value.expression.expression;
          }
          let binding,
            isConstant =
              t__namespace.isIdentifier(value.expression) &&
              (binding = path.scope.getBinding(value.expression.name)) &&
              (binding.kind === "const" || binding.kind === "module");
          if (!isConstant && t__namespace.isLVal(value.expression)) {
            const refIdentifier = path.scope.generateUidIdentifier("_ref$");
            results.exprs.unshift(
              t__namespace.variableDeclaration("var", [
                t__namespace.variableDeclarator(refIdentifier, value.expression)
              ]),
              t__namespace.expressionStatement(
                t__namespace.conditionalExpression(
                  t__namespace.logicalExpression(
                    "||",
                    t__namespace.binaryExpression(
                      "===",
                      t__namespace.unaryExpression("typeof", refIdentifier),
                      t__namespace.stringLiteral("function")
                    ),
                    t__namespace.callExpression(
                      t__namespace.memberExpression(
                        t__namespace.identifier("Array"),
                        t__namespace.identifier("isArray")
                      ),
                      [refIdentifier]
                    )
                  ),
                  t__namespace.callExpression(
                    registerImportMethod(
                      path,
                      "ref",
                      getRendererConfig(path, "universal").moduleName
                    ),
                    [t__namespace.arrowFunctionExpression([], refIdentifier), elem]
                  ),
                  t__namespace.assignmentExpression("=", value.expression, elem)
                )
              )
            );
          } else if (
            isConstant ||
            t__namespace.isFunction(value.expression) ||
            t__namespace.isArrayExpression(value.expression)
          ) {
            results.exprs.unshift(
              t__namespace.expressionStatement(
                t__namespace.callExpression(
                  registerImportMethod(
                    path,
                    "ref",
                    getRendererConfig(path, "universal").moduleName
                  ),
                  [t__namespace.arrowFunctionExpression([], value.expression), elem]
                )
              )
            );
          } else {
            const refIdentifier = path.scope.generateUidIdentifier("_ref$");
            results.exprs.unshift(
              t__namespace.variableDeclaration("var", [
                t__namespace.variableDeclarator(refIdentifier, value.expression)
              ]),
              t__namespace.expressionStatement(
                t__namespace.logicalExpression(
                  "&&",
                  t__namespace.logicalExpression(
                    "||",
                    t__namespace.binaryExpression(
                      "===",
                      t__namespace.unaryExpression("typeof", refIdentifier),
                      t__namespace.stringLiteral("function")
                    ),
                    t__namespace.callExpression(
                      t__namespace.memberExpression(
                        t__namespace.identifier("Array"),
                        t__namespace.identifier("isArray")
                      ),
                      [refIdentifier]
                    )
                  ),
                  t__namespace.callExpression(
                    registerImportMethod(
                      path,
                      "ref",
                      getRendererConfig(path, "universal").moduleName
                    ),
                    [t__namespace.arrowFunctionExpression([], refIdentifier), elem]
                  )
                )
              )
            );
          }
        } else if (key === "children") {
          if (!hasChildren) children = value;
        } else if (
          config.effectWrapper &&
          isDynamic(attribute.get("value").get("expression"), {
            checkMember: true
          })
        ) {
          results.dynamics.push({ elem, key, value: value.expression });
        } else {
          addStaticAttr(attribute, results, initProps, elem, key, value.expression, hasSpread);
        }
      } else if (key === "children") {
        if (!hasChildren) {
          children = t__namespace.isJSXExpressionContainer(value)
            ? value
            : t__namespace.jsxExpressionContainer(value || t__namespace.booleanLiteral(true));
        }
      } else {
        addStaticAttr(attribute, results, initProps, elem, key, value, hasSpread);
      }
    });
  if (spreadExpr) results.exprs.push(spreadExpr);
  if (!hasChildren && children) {
    path.node.children.push(children);
  }
  return initProps;
}

function addStaticAttr(path, results, initProps, elem, key, value, hasSpread) {
  if (!value) value = t__namespace.booleanLiteral(true);
  if (hasSpread) {
    results.exprs.push(t__namespace.expressionStatement(setAttr(path, elem, key, value)));
  } else {
    initProps.push(
      t__namespace.objectProperty(
        t__namespace.isValidIdentifier(key)
          ? t__namespace.identifier(key)
          : t__namespace.stringLiteral(key),
        value
      )
    );
  }
}

function setAttr(path, elem, name, value, { prevId } = {}) {
  if (!value) value = t__namespace.booleanLiteral(true);
  const args = prevId
    ? [elem, t__namespace.stringLiteral(name), value, prevId]
    : [elem, t__namespace.stringLiteral(name), value];
  return t__namespace.callExpression(
    registerImportMethod(path, "setProp", getRendererConfig(path, "universal").moduleName),
    args
  );
}

function transformChildren(path, results) {
  const filteredChildren = filterChildren(path.get("children")),
    multi = checkLength(filteredChildren),
    childNodes = filteredChildren
      .map(path => transformNode(path))
      .reduce((memo, child) => {
        if (!child) return memo;
        const i = memo.length;
        if (child.text && i && memo[i - 1].text) {
          memo[i - 1].template = `${memo[i - 1].template}${child.template}`;
          memo[i - 1].templateWithClosingTags =
            `${memo[i - 1].templateWithClosingTags || memo[i - 1].template}${child.templateWithClosingTags || child.template}`;
        } else memo.push(child);
        return memo;
      }, []);

  const appends = [];
  childNodes.forEach((child, index) => {
    if (!child) return;
    if (child.tagName && child.renderer !== "universal") {
      throw new Error(`<${child.tagName}> is not supported in <${getTagName(path.node)}>.
        Wrap the usage with a component that would render this element, eg. Canvas`);
    }
    if (child.id) {
      let insertNode = registerImportMethod(
        path,
        "insertNode",
        getRendererConfig(path, "universal").moduleName
      );
      let insert = child.id;
      if (child.text) {
        const childTemplate = child.template;
        let createTextNode = registerImportMethod(
          path,
          "createTextNode",
          getRendererConfig(path, "universal").moduleName
        );
        if (multi) {
          results.declarations.push(
            t__namespace.variableDeclarator(
              child.id,
              t__namespace.callExpression(createTextNode, [
                t__namespace.templateLiteral(
                  [t__namespace.templateElement({ raw: escapeStringForTemplate(childTemplate) })],
                  []
                )
              ])
            )
          );
        } else
          insert = t__namespace.callExpression(createTextNode, [
            t__namespace.templateLiteral(
              [t__namespace.templateElement({ raw: escapeStringForTemplate(childTemplate) })],
              []
            )
          ]);
      }
      appends.push(
        t__namespace.expressionStatement(
          t__namespace.callExpression(insertNode, [results.id, insert])
        )
      );
      results.declarations.push(...child.declarations);
      results.exprs.push(...child.exprs);
      results.dynamics.push(...child.dynamics);
    } else if (child.exprs.length) {
      let insert = registerImportMethod(
        path,
        "insert",
        getRendererConfig(path, "universal").moduleName
      );
      if (multi) {
        results.exprs.push(
          t__namespace.expressionStatement(
            t__namespace.callExpression(insert, [
              results.id,
              child.exprs[0],
              nextChild(childNodes, index) || t__namespace.nullLiteral()
            ])
          )
        );
      } else {
        results.exprs.push(
          t__namespace.expressionStatement(
            t__namespace.callExpression(insert, [results.id, child.exprs[0]])
          )
        );
      }
    }
  });
  results.exprs.unshift(...appends);
}

function nextChild(children, index) {
  return children[index + 1] && (children[index + 1].id || nextChild(children, index + 1));
}

function processSpreads(path, attributes, { elem, hasChildren, wrapConditionals }) {
  // TODO: skip but collect the names of any properties after the last spread to not overwrite them
  const filteredAttributes = [];
  const spreadArgs = [];
  let runningObject = [];
  let dynamicSpread = false;
  let firstSpread = false;
  attributes.forEach(attribute => {
    const node = attribute.node;
    const key = t__namespace.isJSXSpreadAttribute(node)
      ? undefined
      : t__namespace.isJSXNamespacedName(node.name)
        ? `${node.name.namespace.name}:${node.name.name.name}`
        : node.name.name;
    if (t__namespace.isJSXSpreadAttribute(node)) {
      firstSpread = true;
      if (runningObject.length) {
        spreadArgs.push(t__namespace.objectExpression(runningObject));
        runningObject = [];
      }
      spreadArgs.push(
        isDynamic(attribute.get("argument"), {
          checkMember: true
        }) && (dynamicSpread = true)
          ? t__namespace.isCallExpression(node.argument) &&
            !node.argument.arguments.length &&
            !t__namespace.isCallExpression(node.argument.callee) &&
            !t__namespace.isMemberExpression(node.argument.callee)
            ? node.argument.callee
            : t__namespace.arrowFunctionExpression([], node.argument)
          : node.argument
      );
    } else if (
      (firstSpread ||
        (t__namespace.isJSXExpressionContainer(node.value) &&
          isDynamic(attribute.get("value").get("expression"), { checkMember: true }))) &&
      key &&
      canNativeSpread(key, { checkNameSpaces: true })
    ) {
      const isContainer = t__namespace.isJSXExpressionContainer(node.value);
      const dynamic =
        isContainer && isDynamic(attribute.get("value").get("expression"), { checkMember: true });
      if (dynamic) {
        const id = convertJSXIdentifier(node.name);
        const expression = node.value.expression;
        // Unlike the dom generate (#2959), keep the condition memo here:
        // universal has no hydration ids to drift, and custom-renderer prop
        // values can be arbitrarily expensive — truthiness insulation pays.
        let expr =
          wrapConditionals &&
          (t__namespace.isLogicalExpression(expression) ||
            t__namespace.isConditionalExpression(expression))
            ? transformCondition(attribute.get("value").get("expression"), true)
            : t__namespace.arrowFunctionExpression([], expression);

        runningObject.push(
          t__namespace.objectMethod(
            "get",
            id,
            [],
            t__namespace.blockStatement([t__namespace.returnStatement(expr.body)]),
            !t__namespace.isValidIdentifier(key)
          )
        );
      } else {
        runningObject.push(
          t__namespace.objectProperty(
            t__namespace.stringLiteral(key),
            isContainer ? node.value.expression : node.value || t__namespace.booleanLiteral(true)
          )
        );
      }
    } else filteredAttributes.push(attribute);
  });

  if (runningObject.length) {
    spreadArgs.push(t__namespace.objectExpression(runningObject));
  }

  const props =
    spreadArgs.length === 1 && !dynamicSpread
      ? spreadArgs[0]
      : t__namespace.callExpression(registerImportMethod(path, "mergeProps"), spreadArgs);

  return [
    filteredAttributes,
    t__namespace.expressionStatement(
      t__namespace.callExpression(
        registerImportMethod(path, "spread", getRendererConfig(path, "universal").moduleName),
        [elem, props, t__namespace.booleanLiteral(hasChildren)]
      )
    )
  ];
}

function createTemplate(path, result, wrap) {
  const config = getConfig(path);
  if (result.id) {
    result.decl = t__namespace.variableDeclaration("var", result.declarations);
    if (
      !(result.exprs.length || result.dynamics.length || result.postExprs?.length) &&
      result.decl.declarations.length === 1
    ) {
      return result.decl.declarations[0].init;
    } else {
      const dynamicsStmt = wrapDynamics(path, result.dynamics);
      const stmts = [
        result.decl,
        ...result.exprs,
        ...(dynamicsStmt ? [dynamicsStmt] : []),
        ...(result.postExprs || [])
      ];

      // Statement-position optimization — see `dom/template.js` for the
      // rationale and predicate semantics.
      const isReturnArg =
        t__namespace.isReturnStatement(path.parent) && path.parent.argument === path.node;
      const isVarInit =
        t__namespace.isVariableDeclarator(path.parent) && path.parent.init === path.node;

      if (isReturnArg || isVarInit) {
        path.getStatementParent()?.insertBefore(stmts);
        return result.id;
      }

      // Fallback: keep the IIFE for ternary branches / array elements /
      // function args / logical expressions where lifting would change
      // observable evaluation semantics.
      return t__namespace.callExpression(
        t__namespace.arrowFunctionExpression(
          [],
          t__namespace.blockStatement([...stmts, t__namespace.returnStatement(result.id)])
        ),
        []
      );
    }
  }
  if (wrap && result.dynamic && config.memoWrapper) {
    return t__namespace.callExpression(registerImportMethod(path, config.memoWrapper, undefined), [
      result.exprs[0]
    ]);
  }
  return result.exprs[0];
}

function wrapDynamics(path, dynamics) {
  if (!dynamics.length) return;
  const config = getConfig(path);

  // dynamics are only queued when effectWrapper is configured (element.ts
  // guards every push), so the name is always a string here
  const effectWrapperId = registerImportMethod(path, config.effectWrapper, undefined);

  if (dynamics.length === 1) {
    const prevValue = t__namespace.identifier("_$p");
    const newValue = t__namespace.identifier("_v$");

    return t__namespace.expressionStatement(
      t__namespace.callExpression(effectWrapperId, [
        wrapForEffect(dynamics[0].value),
        t__namespace.arrowFunctionExpression(
          [newValue, prevValue],
          t__namespace.blockStatement([
            t__namespace.expressionStatement(
              setAttr(path, dynamics[0].elem, dynamics[0].key, newValue, {
                prevId: prevValue
              })
            )
          ])
        )
      ])
    );
  }

  const prevId = t__namespace.identifier("_p$");

  const values = [];
  const statements = [];
  const properties = [];

  dynamics.forEach(({ elem, key, value }, index) => {
    const propIdent = t__namespace.identifier(getNumberedId(index));
    t__namespace.memberExpression(prevId, propIdent);
    const optionalPropMember = t__namespace.optionalMemberExpression(
      prevId,
      propIdent,
      false,
      true
    );

    properties.push(propIdent);
    values.push(t__namespace.objectProperty(propIdent, value));

    statements.push(
      t__namespace.expressionStatement(
        t__namespace.logicalExpression(
          "&&",
          t__namespace.binaryExpression("!==", propIdent, optionalPropMember),
          setAttr(path, elem, key, propIdent, { prevId: optionalPropMember })
        )
      )
    );
  });

  return t__namespace.expressionStatement(
    t__namespace.callExpression(effectWrapperId, [
      t__namespace.arrowFunctionExpression([], t__namespace.objectExpression(values)),
      t__namespace.arrowFunctionExpression(
        [
          t__namespace.objectPattern(
            properties.map(id => t__namespace.objectProperty(id, id, false, true))
          ),
          prevId
        ],
        t__namespace.blockStatement(statements)
      )
    ])
  );
}

function isSimpleOptionalMemberExpression(expression) {
  return (
    t__namespace.isOptionalMemberExpression(expression) &&
    !expression.computed &&
    t__namespace.isIdentifier(expression.object) &&
    t__namespace.isIdentifier(expression.property)
  );
}

function convertComponentIdentifier(node) {
  if (t__namespace.isJSXIdentifier(node)) {
    if (node.name === "this") return t__namespace.thisExpression();
    if (t__namespace.isValidIdentifier(node.name)) {
      const identifier = node;
      identifier.type = "Identifier";
      return identifier;
    } else return t__namespace.stringLiteral(node.name);
  } else if (t__namespace.isJSXMemberExpression(node)) {
    const prop = convertComponentIdentifier(node.property);
    const computed = t__namespace.isStringLiteral(prop);
    return t__namespace.memberExpression(convertComponentIdentifier(node.object), prop, computed);
  }

  return t__namespace.stringLiteral(`${node.namespace.name}:${node.name.name}`);
}

function transformComponent(path) {
  let exprs = [],
    config = getConfig(path),
    tagId = convertComponentIdentifier(path.node.openingElement.name),
    props = [],
    runningObject = [],
    dynamicSpread = false,
    hasChildren = path.node.children.length > 0;

  if (
    t__namespace.isIdentifier(tagId) &&
    config.builtIns.indexOf(tagId.name) > -1 &&
    !path.scope.hasBinding(tagId.name)
  ) {
    const newTagId = registerImportMethod(path, tagId.name);
    tagId.name = newTagId.name;
  }

  path
    .get("openingElement")
    .get("attributes")
    .forEach(attribute => {
      const node = attribute.node;
      if (t__namespace.isJSXSpreadAttribute(node)) {
        if (runningObject.length) {
          props.push(t__namespace.objectExpression(runningObject));
          runningObject = [];
        }
        props.push(
          isDynamic(attribute.get("argument"), {
            checkMember: true
          }) && (dynamicSpread = true)
            ? t__namespace.isCallExpression(node.argument) &&
              !node.argument.arguments.length &&
              !t__namespace.isCallExpression(node.argument.callee) &&
              !t__namespace.isMemberExpression(node.argument.callee)
              ? node.argument.callee
              : t__namespace.arrowFunctionExpression([], node.argument)
            : node.argument
        );
      } else if (t__namespace.isJSXAttribute(node)) {
        // handle weird babel bug around HTML entities
        const value =
            (t__namespace.isStringLiteral(node.value)
              ? t__namespace.stringLiteral(node.value.value)
              : node.value) || t__namespace.booleanLiteral(true),
          id = convertJSXIdentifier(node.name),
          key = t__namespace.isIdentifier(id) ? id.name : id.value;
        if (hasChildren && key === "children") return;
        if (t__namespace.isJSXExpressionContainer(value)) {
          if (key === "ref") {
            // Normalize expressions for non-null and type-as
            while (
              t__namespace.isTSNonNullExpression(value.expression) ||
              t__namespace.isTSAsExpression(value.expression) ||
              t__namespace.isTSSatisfiesExpression(value.expression)
            ) {
              value.expression = value.expression.expression;
            }
            let binding,
              isConstant =
                t__namespace.isIdentifier(value.expression) &&
                (binding = path.scope.getBinding(value.expression.name)) &&
                (binding.kind === "const" || binding.kind === "module");
            if (!isConstant && t__namespace.isLVal(value.expression)) {
              const refIdentifier = path.scope.generateUidIdentifier("_ref$");
              runningObject.push(
                t__namespace.objectMethod(
                  "method",
                  t__namespace.identifier("ref"),
                  [t__namespace.identifier("r$")],
                  t__namespace.blockStatement([
                    t__namespace.variableDeclaration("var", [
                      t__namespace.variableDeclarator(refIdentifier, value.expression)
                    ]),
                    t__namespace.expressionStatement(
                      t__namespace.conditionalExpression(
                        t__namespace.logicalExpression(
                          "||",
                          t__namespace.binaryExpression(
                            "===",
                            t__namespace.unaryExpression("typeof", refIdentifier),
                            t__namespace.stringLiteral("function")
                          ),
                          t__namespace.callExpression(
                            t__namespace.memberExpression(
                              t__namespace.identifier("Array"),
                              t__namespace.identifier("isArray")
                            ),
                            [refIdentifier]
                          )
                        ),
                        t__namespace.callExpression(registerImportMethod(path, "applyRef"), [
                          refIdentifier,
                          t__namespace.identifier("r$")
                        ]),
                        t__namespace.assignmentExpression(
                          "=",
                          value.expression,
                          t__namespace.identifier("r$")
                        )
                      )
                    )
                  ])
                )
              );
            } else if (!isConstant && isSimpleOptionalMemberExpression(value.expression)) {
              const refIdentifier = path.scope.generateUidIdentifier("_ref$");
              const object = value.expression.object;
              const property = value.expression.property;
              runningObject.push(
                t__namespace.objectMethod(
                  "method",
                  t__namespace.identifier("ref"),
                  [t__namespace.identifier("r$")],
                  t__namespace.blockStatement([
                    t__namespace.variableDeclaration("var", [
                      t__namespace.variableDeclarator(refIdentifier, value.expression)
                    ]),
                    t__namespace.expressionStatement(
                      t__namespace.conditionalExpression(
                        t__namespace.logicalExpression(
                          "||",
                          t__namespace.binaryExpression(
                            "===",
                            t__namespace.unaryExpression("typeof", refIdentifier),
                            t__namespace.stringLiteral("function")
                          ),
                          t__namespace.callExpression(
                            t__namespace.memberExpression(
                              t__namespace.identifier("Array"),
                              t__namespace.identifier("isArray")
                            ),
                            [refIdentifier]
                          )
                        ),
                        t__namespace.callExpression(registerImportMethod(path, "applyRef"), [
                          refIdentifier,
                          t__namespace.identifier("r$")
                        ]),
                        t__namespace.logicalExpression(
                          "&&",
                          t__namespace.unaryExpression(
                            "!",
                            t__namespace.unaryExpression("!", t__namespace.identifier(object.name))
                          ),
                          t__namespace.assignmentExpression(
                            "=",
                            t__namespace.memberExpression(
                              t__namespace.identifier(object.name),
                              t__namespace.identifier(property.name)
                            ),
                            t__namespace.identifier("r$")
                          )
                        )
                      )
                    )
                  ])
                )
              );
            } else if (
              isConstant ||
              t__namespace.isFunction(value.expression) ||
              t__namespace.isArrayExpression(value.expression)
            ) {
              runningObject.push(
                t__namespace.objectProperty(t__namespace.identifier("ref"), value.expression)
              );
            } else if (t__namespace.isCallExpression(value.expression)) {
              const refIdentifier = path.scope.generateUidIdentifier("_ref$");
              exprs.push(
                t__namespace.variableDeclaration("var", [
                  t__namespace.variableDeclarator(refIdentifier, value.expression)
                ])
              );
              runningObject.push(
                t__namespace.objectMethod(
                  "method",
                  t__namespace.identifier("ref"),
                  [t__namespace.identifier("r$")],
                  t__namespace.blockStatement([
                    t__namespace.expressionStatement(
                      t__namespace.logicalExpression(
                        "&&",
                        t__namespace.logicalExpression(
                          "||",
                          t__namespace.binaryExpression(
                            "===",
                            t__namespace.unaryExpression("typeof", refIdentifier),
                            t__namespace.stringLiteral("function")
                          ),
                          t__namespace.callExpression(
                            t__namespace.memberExpression(
                              t__namespace.identifier("Array"),
                              t__namespace.identifier("isArray")
                            ),
                            [refIdentifier]
                          )
                        ),
                        t__namespace.callExpression(registerImportMethod(path, "applyRef"), [
                          refIdentifier,
                          t__namespace.identifier("r$")
                        ])
                      )
                    )
                  ])
                )
              );
            }
          } else if (
            isDynamic(attribute.get("value").get("expression"), {
              checkMember: true,
              checkTags: true
            })
          ) {
            // No ssr gate: the condition memo must exist on BOTH generates —
            // the server sync memo allocates an owner id just like the
            // client's, so skipping it server-side drifts every hydration id
            // the prop's branch content allocates (#2959, component flavor).
            // Matches the children-conditional wrap above (transform.ts).
            if (
              config.wrapConditionals &&
              (t__namespace.isLogicalExpression(value.expression) ||
                t__namespace.isConditionalExpression(value.expression))
            ) {
              const expr = transformCondition(attribute.get("value").get("expression"), true);

              runningObject.push(
                t__namespace.objectMethod(
                  "get",
                  id,
                  [],
                  t__namespace.blockStatement([t__namespace.returnStatement(expr.body)]),
                  !t__namespace.isValidIdentifier(key)
                )
              );
            } else if (
              t__namespace.isCallExpression(value.expression) &&
              t__namespace.isArrowFunctionExpression(value.expression.callee) &&
              value.expression.callee.params.length === 0
            ) {
              const callee = value.expression.callee;
              const body = t__namespace.isBlockStatement(callee.body)
                ? callee.body
                : t__namespace.blockStatement([t__namespace.returnStatement(callee.body)]);

              runningObject.push(
                t__namespace.objectMethod("get", id, [], body, !t__namespace.isValidIdentifier(key))
              );
            } else {
              runningObject.push(
                t__namespace.objectMethod(
                  "get",
                  id,
                  [],
                  t__namespace.blockStatement([t__namespace.returnStatement(value.expression)]),
                  !t__namespace.isValidIdentifier(key)
                )
              );
            }
          } else runningObject.push(t__namespace.objectProperty(id, value.expression));
        } else runningObject.push(t__namespace.objectProperty(id, value));
      }
    });

  const childResult = transformComponentChildren(path.get("children"), config);
  if (childResult) {
    if (childResult[1]) {
      const body =
        t__namespace.isCallExpression(childResult[0]) &&
        t__namespace.isFunction(childResult[0].arguments[0])
          ? childResult[0].arguments[0].body
          : t__namespace.isFunction(childResult[0])
            ? childResult[0].body
            : childResult[0];
      runningObject.push(
        t__namespace.objectMethod(
          "get",
          t__namespace.identifier("children"),
          [],
          t__namespace.isExpression(body)
            ? t__namespace.blockStatement([t__namespace.returnStatement(body)])
            : body
        )
      );
    } else
      runningObject.push(
        t__namespace.objectProperty(t__namespace.identifier("children"), childResult[0])
      );
  }
  if (runningObject.length || !props.length)
    props.push(t__namespace.objectExpression(runningObject));

  if (props.length > 1 || dynamicSpread) {
    props = [t__namespace.callExpression(registerImportMethod(path, "mergeProps"), props)];
  }
  const componentArgs = [tagId, props[0]];
  // SSR's `createComponent` is literally `Comp(props || {})`. Since the
  // compiler always emits a real `props[0]` object expression above (see the
  // `props.push(t.objectExpression(runningObject))` line), the `|| {}` fallback
  // never fires in compiled output. Inline to a direct `Comp(props)` call to
  // drop one function-call frame per component invocation. (DOM/dev modes
  // keep the wrapper since it does real work — `untrack`, dev metadata.)
  if (getConfig(path).generate === "ssr") {
    exprs.push(t__namespace.callExpression(tagId, [props[0]]));
  } else {
    exprs.push(
      t__namespace.callExpression(registerImportMethod(path, "createComponent"), componentArgs)
    );
  }

  // handle hoisting conditionals
  if (exprs.length > 1) {
    const ret = exprs.pop();
    exprs = [
      t__namespace.callExpression(
        t__namespace.arrowFunctionExpression(
          [],
          t__namespace.blockStatement([...exprs, t__namespace.returnStatement(ret)])
        ),
        []
      )
    ];
  }
  return { exprs, template: "", component: true, declarations: [], dynamics: [] };
}

function transformComponentChildren(children, config) {
  const filteredChildren = filterChildren(children);
  if (!filteredChildren.length) return;
  let dynamic = false;
  let pathNodes = [];

  let transformedChildren = filteredChildren.reduce((memo, path) => {
    if (t__namespace.isJSXText(path.node)) {
      const v = htmlEntities.decode(trimWhitespace(path.node.extra?.raw ?? ""));
      if (v.length) {
        pathNodes.push(path.node);
        memo.push(t__namespace.stringLiteral(v));
      }
    } else {
      const child = transformNode(path, {
        topLevel: true,
        componentChild: true,
        lastElement: true
      });
      if (!child) return memo;
      dynamic = dynamic || !!child.dynamic;
      if (
        config.generate === "ssr" &&
        !config.memoWrapper &&
        filteredChildren.length > 1 &&
        child.dynamic &&
        t__namespace.isFunction(child.exprs[0])
      ) {
        child.exprs[0] = child.exprs[0].body;
      }
      pathNodes.push(path.node);
      memo.push(getCreateTemplate(config, path, child)(path, child, filteredChildren.length > 1));
    }
    return memo;
  }, []);

  if (Array.isArray(transformedChildren) && transformedChildren.length === 1) {
    transformedChildren = transformedChildren[0];
    if (
      !t__namespace.isJSXExpressionContainer(pathNodes[0]) &&
      !t__namespace.isJSXSpreadChild(pathNodes[0]) &&
      !t__namespace.isJSXText(pathNodes[0])
    ) {
      transformedChildren =
        t__namespace.isCallExpression(transformedChildren) &&
        !transformedChildren.arguments.length &&
        !t__namespace.isIdentifier(transformedChildren.callee)
          ? transformedChildren.callee
          : t__namespace.arrowFunctionExpression([], transformedChildren);
      dynamic = true;
    }
  } else if (Array.isArray(transformedChildren)) {
    transformedChildren = t__namespace.arrowFunctionExpression(
      [],
      t__namespace.arrayExpression(transformedChildren)
    );
    dynamic = true;
  }
  return [transformedChildren, dynamic];
}

function transformFragmentChildren(children, results, config) {
  const filteredChildren = filterChildren(children),
    childNodes = filteredChildren.reduce((memo, path) => {
      if (t__namespace.isJSXText(path.node)) {
        const v = htmlEntities.decode(trimWhitespace(path.node.extra?.raw ?? ""));
        if (v.length) memo.push(t__namespace.stringLiteral(v));
      } else {
        const child = transformNode(path, {
          topLevel: true,
          fragmentChild: true,
          lastElement: true
        });
        if (child) memo.push(getCreateTemplate(config, path, child)(path, child, true));
      }
      return memo;
    }, []);
  results.exprs.push(
    childNodes.length === 1 ? childNodes[0] : t__namespace.arrayExpression(childNodes)
  );
}

function isTransformConditionStatements(expr) {
  return Array.isArray(expr);
}

function transformJSX(path, state) {
  if (state.skip) return;

  const config = getConfig(path);

  const replace = transformThis(path);

  // Pre-pass: normalize stateful DOM attributes (value/defaultValue/checked/etc)
  // BEFORE transformNode runs so the parent's detectExpressions sees the
  // resulting `prop:*` attributes and reserves an element id when needed.
  // Decide per-element which renderer it will go to (mirrors transformElement),
  // so dynamic mode (generate: "dynamic" + renderers: [{ name: "dom", ... }])
  // is handled correctly.
  const visit = p => {
    const tagName = getTagName(p.node);
    if (isComponent(tagName)) return;
    if (!DOMWithState[tagName.toUpperCase()]) return;
    const tagRenderer = (config.renderers ?? []).find(r => r.elements.includes(tagName));
    const willBeDOM = tagRenderer?.name === "dom" || config.generate === "dom";
    const willBeSSR = !willBeDOM && config.generate === "ssr";
    if (!willBeDOM && !willBeSSR) return;
    transformSpecialCaseAttributes(p, tagName, willBeSSR);
  };
  if (t__namespace.isJSXElement(path.node)) visit(path);
  path.traverse({ JSXElement: visit });

  const result = transformNode(
    path,
    t__namespace.isJSXFragment(path.node)
      ? {}
      : {
          topLevel: true,
          lastElement: true
        }
  );

  if (!result) return;
  const template = getCreateTemplate(config, path, result);

  path.replaceWith(replace(template(path, result, false)));

  path.traverse({
    enter(path) {
      if (
        path.node.leadingComments &&
        path.node.leadingComments[0] &&
        path.node.leadingComments[0].value.trim() === config.staticMarker
      ) {
        path.node.leadingComments.shift();
      }
    }
  });
}

function getTargetFunctionParent(path, parent) {
  let current = path.scope.getFunctionParent();
  if (!current) return current;
  while (current !== parent && current.path.isArrowFunctionExpression()) {
    current = current.path.parentPath.scope.getFunctionParent();
    if (!current) return current;
  }
  return current;
}

function transformThis(path) {
  const parent = path.scope.getFunctionParent();
  let thisId, inserted;
  path.traverse({
    ThisExpression(path) {
      const current = getTargetFunctionParent(path, parent);
      if (current === parent) {
        thisId || (thisId = path.scope.generateUidIdentifier("self$"));
        path.replaceWith(thisId);
      }
    },
    JSXElement(path) {
      let source = path.get("openingElement").get("name");
      while (source.isJSXMemberExpression()) {
        source = source.get("object");
      }
      if (source.isJSXIdentifier() && source.node.name === "this") {
        const current = getTargetFunctionParent(path, parent);
        if (current === parent) {
          thisId || (thisId = path.scope.generateUidIdentifier("self$"));
          source.replaceWith(t__namespace.jsxIdentifier(thisId.name));

          if (path.node.closingElement) {
            path.node.closingElement.name = path.node.openingElement.name;
          }
        }
      }
    }
  });
  if (thisId && parent && parent.block.type === "ClassMethod") {
    path
      .getStatementParent()
      ?.insertBefore(
        t__namespace.variableDeclaration("const", [
          t__namespace.variableDeclarator(thisId, t__namespace.thisExpression())
        ])
      );
    inserted = true;
  }
  return node => {
    if (thisId && !inserted) {
      if (!parent || parent.block.type === "ClassMethod") {
        const decl = t__namespace.variableDeclaration("const", [
          t__namespace.variableDeclarator(thisId, t__namespace.thisExpression())
        ]);
        if (parent) {
          const stmt = path.getStatementParent();
          stmt?.insertBefore(decl);
        } else {
          return t__namespace.callExpression(
            t__namespace.arrowFunctionExpression(
              [],
              t__namespace.blockStatement([decl, t__namespace.returnStatement(node)])
            ),
            []
          );
        }
      } else {
        parent.push({
          id: thisId,
          init: t__namespace.thisExpression(),
          kind: "const"
        });
      }
    }
    return node;
  };
}

function transformNode(path, info = {}) {
  const config = getConfig(path);
  const node = path.node;
  let staticValue;
  if (t__namespace.isJSXElement(node)) {
    return transformElement(config, path, info);
  } else if (t__namespace.isJSXFragment(node)) {
    let results = { template: "", declarations: [], exprs: [], dynamics: [] };
    // <><div /><Component /></>
    transformFragmentChildren(path.get("children"), results, config);
    return results;
  } else if (t__namespace.isJSXText(node) || (staticValue = getStaticExpression(path)) !== false) {
    const text =
      staticValue !== undefined
        ? info.doNotEscape
          ? String(staticValue)
          : escapeHTML(String(staticValue))
        : trimWhitespace(node.extra?.raw ?? "");
    if (!text.length) return null;
    const results = {
      template: text,
      declarations: [],
      exprs: [],
      dynamics: [],
      postExprs: [],
      text: true
    };
    if (!info.skipId && config.generate !== "ssr")
      results.id = path.scope.generateUidIdentifier("el$");
    return results;
  } else if (t__namespace.isJSXExpressionContainer(node)) {
    if (t__namespace.isJSXEmptyExpression(node.expression)) return null;
    if (
      !isDynamic(path.get("expression"), {
        checkMember: true,
        checkTags: !!info.componentChild,
        native: !info.componentChild
      })
    ) {
      return { exprs: [node.expression], template: "", declarations: [], dynamics: [] };
    }
    const expr =
      config.wrapConditionals &&
      (t__namespace.isLogicalExpression(node.expression) ||
        t__namespace.isConditionalExpression(node.expression))
        ? transformCondition(path.get("expression"), info.componentChild || info.fragmentChild)
        : !info.componentChild &&
            (config.generate !== "ssr" || info.fragmentChild) &&
            t__namespace.isCallExpression(node.expression) &&
            !t__namespace.isCallExpression(node.expression.callee) &&
            !t__namespace.isMemberExpression(node.expression.callee) &&
            node.expression.arguments.length === 0
          ? node.expression.callee
          : t__namespace.arrowFunctionExpression([], node.expression);
    return {
      exprs: isTransformConditionStatements(expr)
        ? [
            t__namespace.callExpression(
              t__namespace.arrowFunctionExpression(
                [],
                t__namespace.blockStatement([expr[0], t__namespace.returnStatement(expr[1])])
              ),
              []
            )
          ]
        : [expr],
      template: "",
      declarations: [],
      dynamics: [],
      dynamic: true
    };
  } else if (t__namespace.isJSXSpreadChild(node)) {
    if (
      !isDynamic(path.get("expression"), {
        checkMember: true,
        native: !info.componentChild
      })
    )
      return { exprs: [node.expression], template: "", declarations: [], dynamics: [] };
    const expr = t__namespace.arrowFunctionExpression([], node.expression);
    return {
      exprs: [expr],
      template: "",
      declarations: [],
      dynamics: [],
      dynamic: true
    };
  }
}

function getCreateTemplate(config, path, result) {
  if ((result.tagName && result.renderer === "dom") || config.generate === "dom") {
    return createTemplate$2;
  }

  if (result.renderer === "ssr" || config.generate === "ssr") {
    return createTemplate$1;
  }

  return createTemplate;
}

function transformElement(config, path, info = {}) {
  const node = path.node;
  let tagName = getTagName(node);
  // <Component ...></Component>
  if (isComponent(tagName)) return transformComponent(path);

  // <div ...></div>
  // const element = getTransformElemet(config, path, tagName);

  const tagRenderer = (config.renderers ?? []).find(renderer =>
    renderer.elements.includes(tagName)
  );

  if (tagRenderer?.name === "dom" || getConfig(path).generate === "dom") {
    renameElementKey(path, false);
    return transformElement$3(path, info);
  }

  if (getConfig(path).generate === "ssr") {
    renameElementKey(path, true);
    return transformElement$2(path, info);
  }

  return transformElement$1(path, info);
}

const UNDEFINED_CODE_POINTS = new Set([
  65534, 65535, 131070, 131071, 196606, 196607, 262142, 262143, 327678, 327679, 393214, 393215,
  458750, 458751, 524286, 524287, 589822, 589823, 655358, 655359, 720894, 720895, 786430, 786431,
  851966, 851967, 917502, 917503, 983038, 983039, 1048574, 1048575, 1114110, 1114111
]);
const REPLACEMENT_CHARACTER = "\uFFFD";
var CODE_POINTS;
(function (CODE_POINTS) {
  CODE_POINTS[(CODE_POINTS["EOF"] = -1)] = "EOF";
  CODE_POINTS[(CODE_POINTS["NULL"] = 0)] = "NULL";
  CODE_POINTS[(CODE_POINTS["TABULATION"] = 9)] = "TABULATION";
  CODE_POINTS[(CODE_POINTS["CARRIAGE_RETURN"] = 13)] = "CARRIAGE_RETURN";
  CODE_POINTS[(CODE_POINTS["LINE_FEED"] = 10)] = "LINE_FEED";
  CODE_POINTS[(CODE_POINTS["FORM_FEED"] = 12)] = "FORM_FEED";
  CODE_POINTS[(CODE_POINTS["SPACE"] = 32)] = "SPACE";
  CODE_POINTS[(CODE_POINTS["EXCLAMATION_MARK"] = 33)] = "EXCLAMATION_MARK";
  CODE_POINTS[(CODE_POINTS["QUOTATION_MARK"] = 34)] = "QUOTATION_MARK";
  CODE_POINTS[(CODE_POINTS["AMPERSAND"] = 38)] = "AMPERSAND";
  CODE_POINTS[(CODE_POINTS["APOSTROPHE"] = 39)] = "APOSTROPHE";
  CODE_POINTS[(CODE_POINTS["HYPHEN_MINUS"] = 45)] = "HYPHEN_MINUS";
  CODE_POINTS[(CODE_POINTS["SOLIDUS"] = 47)] = "SOLIDUS";
  CODE_POINTS[(CODE_POINTS["DIGIT_0"] = 48)] = "DIGIT_0";
  CODE_POINTS[(CODE_POINTS["DIGIT_9"] = 57)] = "DIGIT_9";
  CODE_POINTS[(CODE_POINTS["SEMICOLON"] = 59)] = "SEMICOLON";
  CODE_POINTS[(CODE_POINTS["LESS_THAN_SIGN"] = 60)] = "LESS_THAN_SIGN";
  CODE_POINTS[(CODE_POINTS["EQUALS_SIGN"] = 61)] = "EQUALS_SIGN";
  CODE_POINTS[(CODE_POINTS["GREATER_THAN_SIGN"] = 62)] = "GREATER_THAN_SIGN";
  CODE_POINTS[(CODE_POINTS["QUESTION_MARK"] = 63)] = "QUESTION_MARK";
  CODE_POINTS[(CODE_POINTS["LATIN_CAPITAL_A"] = 65)] = "LATIN_CAPITAL_A";
  CODE_POINTS[(CODE_POINTS["LATIN_CAPITAL_Z"] = 90)] = "LATIN_CAPITAL_Z";
  CODE_POINTS[(CODE_POINTS["RIGHT_SQUARE_BRACKET"] = 93)] = "RIGHT_SQUARE_BRACKET";
  CODE_POINTS[(CODE_POINTS["GRAVE_ACCENT"] = 96)] = "GRAVE_ACCENT";
  CODE_POINTS[(CODE_POINTS["LATIN_SMALL_A"] = 97)] = "LATIN_SMALL_A";
  CODE_POINTS[(CODE_POINTS["LATIN_SMALL_Z"] = 122)] = "LATIN_SMALL_Z";
})(CODE_POINTS || (CODE_POINTS = {}));
const SEQUENCES = {
  DASH_DASH: "--",
  CDATA_START: "[CDATA[",
  DOCTYPE: "doctype",
  SCRIPT: "script",
  PUBLIC: "public",
  SYSTEM: "system"
};
//Surrogates
function isSurrogate(cp) {
  return cp >= 55296 && cp <= 57343;
}
function isSurrogatePair(cp) {
  return cp >= 56320 && cp <= 57343;
}
function getSurrogatePairCodePoint(cp1, cp2) {
  return (cp1 - 55296) * 1024 + 9216 + cp2;
}
//NOTE: excluding NULL and ASCII whitespace
function isControlCodePoint(cp) {
  return (
    (cp !== 0x20 &&
      cp !== 0x0a &&
      cp !== 0x0d &&
      cp !== 0x09 &&
      cp !== 0x0c &&
      cp >= 0x01 &&
      cp <= 0x1f) ||
    (cp >= 0x7f && cp <= 0x9f)
  );
}
function isUndefinedCodePoint(cp) {
  return (cp >= 64976 && cp <= 65007) || UNDEFINED_CODE_POINTS.has(cp);
}

var ERR;
(function (ERR) {
  ERR["controlCharacterInInputStream"] = "control-character-in-input-stream";
  ERR["noncharacterInInputStream"] = "noncharacter-in-input-stream";
  ERR["surrogateInInputStream"] = "surrogate-in-input-stream";
  ERR["nonVoidHtmlElementStartTagWithTrailingSolidus"] =
    "non-void-html-element-start-tag-with-trailing-solidus";
  ERR["endTagWithAttributes"] = "end-tag-with-attributes";
  ERR["endTagWithTrailingSolidus"] = "end-tag-with-trailing-solidus";
  ERR["unexpectedSolidusInTag"] = "unexpected-solidus-in-tag";
  ERR["unexpectedNullCharacter"] = "unexpected-null-character";
  ERR["unexpectedQuestionMarkInsteadOfTagName"] = "unexpected-question-mark-instead-of-tag-name";
  ERR["invalidFirstCharacterOfTagName"] = "invalid-first-character-of-tag-name";
  ERR["unexpectedEqualsSignBeforeAttributeName"] = "unexpected-equals-sign-before-attribute-name";
  ERR["missingEndTagName"] = "missing-end-tag-name";
  ERR["unexpectedCharacterInAttributeName"] = "unexpected-character-in-attribute-name";
  ERR["unknownNamedCharacterReference"] = "unknown-named-character-reference";
  ERR["missingSemicolonAfterCharacterReference"] = "missing-semicolon-after-character-reference";
  ERR["unexpectedCharacterAfterDoctypeSystemIdentifier"] =
    "unexpected-character-after-doctype-system-identifier";
  ERR["unexpectedCharacterInUnquotedAttributeValue"] =
    "unexpected-character-in-unquoted-attribute-value";
  ERR["eofBeforeTagName"] = "eof-before-tag-name";
  ERR["eofInTag"] = "eof-in-tag";
  ERR["missingAttributeValue"] = "missing-attribute-value";
  ERR["missingWhitespaceBetweenAttributes"] = "missing-whitespace-between-attributes";
  ERR["missingWhitespaceAfterDoctypePublicKeyword"] =
    "missing-whitespace-after-doctype-public-keyword";
  ERR["missingWhitespaceBetweenDoctypePublicAndSystemIdentifiers"] =
    "missing-whitespace-between-doctype-public-and-system-identifiers";
  ERR["missingWhitespaceAfterDoctypeSystemKeyword"] =
    "missing-whitespace-after-doctype-system-keyword";
  ERR["missingQuoteBeforeDoctypePublicIdentifier"] =
    "missing-quote-before-doctype-public-identifier";
  ERR["missingQuoteBeforeDoctypeSystemIdentifier"] =
    "missing-quote-before-doctype-system-identifier";
  ERR["missingDoctypePublicIdentifier"] = "missing-doctype-public-identifier";
  ERR["missingDoctypeSystemIdentifier"] = "missing-doctype-system-identifier";
  ERR["abruptDoctypePublicIdentifier"] = "abrupt-doctype-public-identifier";
  ERR["abruptDoctypeSystemIdentifier"] = "abrupt-doctype-system-identifier";
  ERR["cdataInHtmlContent"] = "cdata-in-html-content";
  ERR["incorrectlyOpenedComment"] = "incorrectly-opened-comment";
  ERR["eofInScriptHtmlCommentLikeText"] = "eof-in-script-html-comment-like-text";
  ERR["eofInDoctype"] = "eof-in-doctype";
  ERR["nestedComment"] = "nested-comment";
  ERR["abruptClosingOfEmptyComment"] = "abrupt-closing-of-empty-comment";
  ERR["eofInComment"] = "eof-in-comment";
  ERR["incorrectlyClosedComment"] = "incorrectly-closed-comment";
  ERR["eofInCdata"] = "eof-in-cdata";
  ERR["absenceOfDigitsInNumericCharacterReference"] =
    "absence-of-digits-in-numeric-character-reference";
  ERR["nullCharacterReference"] = "null-character-reference";
  ERR["surrogateCharacterReference"] = "surrogate-character-reference";
  ERR["characterReferenceOutsideUnicodeRange"] = "character-reference-outside-unicode-range";
  ERR["controlCharacterReference"] = "control-character-reference";
  ERR["noncharacterCharacterReference"] = "noncharacter-character-reference";
  ERR["missingWhitespaceBeforeDoctypeName"] = "missing-whitespace-before-doctype-name";
  ERR["missingDoctypeName"] = "missing-doctype-name";
  ERR["invalidCharacterSequenceAfterDoctypeName"] = "invalid-character-sequence-after-doctype-name";
  ERR["duplicateAttribute"] = "duplicate-attribute";
  ERR["nonConformingDoctype"] = "non-conforming-doctype";
  ERR["missingDoctype"] = "missing-doctype";
  ERR["misplacedDoctype"] = "misplaced-doctype";
  ERR["endTagWithoutMatchingOpenElement"] = "end-tag-without-matching-open-element";
  ERR["closingOfElementWithOpenChildElements"] = "closing-of-element-with-open-child-elements";
  ERR["disallowedContentInNoscriptInHead"] = "disallowed-content-in-noscript-in-head";
  ERR["openElementsLeftAfterEof"] = "open-elements-left-after-eof";
  ERR["abandonedHeadElementChild"] = "abandoned-head-element-child";
  ERR["misplacedStartTagForHeadElement"] = "misplaced-start-tag-for-head-element";
  ERR["nestedNoscriptInHead"] = "nested-noscript-in-head";
  ERR["eofInElementThatCanContainOnlyText"] = "eof-in-element-that-can-contain-only-text";
})(ERR || (ERR = {}));

//Const
const DEFAULT_BUFFER_WATERLINE = 1 << 16;
//Preprocessor
//NOTE: HTML input preprocessing
//(see: http://www.whatwg.org/specs/web-apps/current-work/multipage/parsing.html#preprocessing-the-input-stream)
class Preprocessor {
  constructor(handler) {
    this.handler = handler;
    this.html = "";
    this.pos = -1;
    // NOTE: Initial `lastGapPos` is -2, to ensure `col` on initialisation is 0
    this.lastGapPos = -2;
    this.gapStack = [];
    this.skipNextNewLine = false;
    this.lastChunkWritten = false;
    this.endOfChunkHit = false;
    this.bufferWaterline = DEFAULT_BUFFER_WATERLINE;
    this.isEol = false;
    this.lineStartPos = 0;
    this.droppedBufferSize = 0;
    this.line = 1;
    //NOTE: avoid reporting errors twice on advance/retreat
    this.lastErrOffset = -1;
  }
  /** The column on the current line. If we just saw a gap (eg. a surrogate pair), return the index before. */
  get col() {
    return this.pos - this.lineStartPos + Number(this.lastGapPos !== this.pos);
  }
  get offset() {
    return this.droppedBufferSize + this.pos;
  }
  getError(code, cpOffset) {
    const { line, col, offset } = this;
    const startCol = col + cpOffset;
    const startOffset = offset + cpOffset;
    return {
      code,
      startLine: line,
      endLine: line,
      startCol,
      endCol: startCol,
      startOffset,
      endOffset: startOffset
    };
  }
  _err(code) {
    if (this.handler.onParseError && this.lastErrOffset !== this.offset) {
      this.lastErrOffset = this.offset;
      this.handler.onParseError(this.getError(code, 0));
    }
  }
  _addGap() {
    this.gapStack.push(this.lastGapPos);
    this.lastGapPos = this.pos;
  }
  _processSurrogate(cp) {
    //NOTE: try to peek a surrogate pair
    if (this.pos !== this.html.length - 1) {
      const nextCp = this.html.charCodeAt(this.pos + 1);
      if (isSurrogatePair(nextCp)) {
        //NOTE: we have a surrogate pair. Peek pair character and recalculate code point.
        this.pos++;
        //NOTE: add a gap that should be avoided during retreat
        this._addGap();
        return getSurrogatePairCodePoint(cp, nextCp);
      }
    }
    //NOTE: we are at the end of a chunk, therefore we can't infer the surrogate pair yet.
    else if (!this.lastChunkWritten) {
      this.endOfChunkHit = true;
      return CODE_POINTS.EOF;
    }
    //NOTE: isolated surrogate
    this._err(ERR.surrogateInInputStream);
    return cp;
  }
  willDropParsedChunk() {
    return this.pos > this.bufferWaterline;
  }
  dropParsedChunk() {
    if (this.willDropParsedChunk()) {
      this.html = this.html.substring(this.pos);
      this.lineStartPos -= this.pos;
      this.droppedBufferSize += this.pos;
      this.pos = 0;
      this.lastGapPos = -2;
      this.gapStack.length = 0;
    }
  }
  write(chunk, isLastChunk) {
    if (this.html.length > 0) {
      this.html += chunk;
    } else {
      this.html = chunk;
    }
    this.endOfChunkHit = false;
    this.lastChunkWritten = isLastChunk;
  }
  insertHtmlAtCurrentPos(chunk) {
    this.html = this.html.substring(0, this.pos + 1) + chunk + this.html.substring(this.pos + 1);
    this.endOfChunkHit = false;
  }
  startsWith(pattern, caseSensitive) {
    // Check if our buffer has enough characters
    if (this.pos + pattern.length > this.html.length) {
      this.endOfChunkHit = !this.lastChunkWritten;
      return false;
    }
    if (caseSensitive) {
      return this.html.startsWith(pattern, this.pos);
    }
    for (let i = 0; i < pattern.length; i++) {
      const cp = this.html.charCodeAt(this.pos + i) | 0x20;
      if (cp !== pattern.charCodeAt(i)) {
        return false;
      }
    }
    return true;
  }
  peek(offset) {
    const pos = this.pos + offset;
    if (pos >= this.html.length) {
      this.endOfChunkHit = !this.lastChunkWritten;
      return CODE_POINTS.EOF;
    }
    const code = this.html.charCodeAt(pos);
    return code === CODE_POINTS.CARRIAGE_RETURN ? CODE_POINTS.LINE_FEED : code;
  }
  advance() {
    this.pos++;
    //NOTE: LF should be in the last column of the line
    if (this.isEol) {
      this.isEol = false;
      this.line++;
      this.lineStartPos = this.pos;
    }
    if (this.pos >= this.html.length) {
      this.endOfChunkHit = !this.lastChunkWritten;
      return CODE_POINTS.EOF;
    }
    let cp = this.html.charCodeAt(this.pos);
    //NOTE: all U+000D CARRIAGE RETURN (CR) characters must be converted to U+000A LINE FEED (LF) characters
    if (cp === CODE_POINTS.CARRIAGE_RETURN) {
      this.isEol = true;
      this.skipNextNewLine = true;
      return CODE_POINTS.LINE_FEED;
    }
    //NOTE: any U+000A LINE FEED (LF) characters that immediately follow a U+000D CARRIAGE RETURN (CR) character
    //must be ignored.
    if (cp === CODE_POINTS.LINE_FEED) {
      this.isEol = true;
      if (this.skipNextNewLine) {
        // `line` will be bumped again in the recursive call.
        this.line--;
        this.skipNextNewLine = false;
        this._addGap();
        return this.advance();
      }
    }
    this.skipNextNewLine = false;
    if (isSurrogate(cp)) {
      cp = this._processSurrogate(cp);
    }
    //OPTIMIZATION: first check if code point is in the common allowed
    //range (ASCII alphanumeric, whitespaces, big chunk of BMP)
    //before going into detailed performance cost validation.
    const isCommonValidRange =
      this.handler.onParseError === null ||
      (cp > 0x1f && cp < 0x7f) ||
      cp === CODE_POINTS.LINE_FEED ||
      cp === CODE_POINTS.CARRIAGE_RETURN ||
      (cp > 0x9f && cp < 64976);
    if (!isCommonValidRange) {
      this._checkForProblematicCharacters(cp);
    }
    return cp;
  }
  _checkForProblematicCharacters(cp) {
    if (isControlCodePoint(cp)) {
      this._err(ERR.controlCharacterInInputStream);
    } else if (isUndefinedCodePoint(cp)) {
      this._err(ERR.noncharacterInInputStream);
    }
  }
  retreat(count) {
    this.pos -= count;
    while (this.pos < this.lastGapPos) {
      this.lastGapPos = this.gapStack.pop();
      this.pos--;
    }
    this.isEol = false;
  }
}

var TokenType;
(function (TokenType) {
  TokenType[(TokenType["CHARACTER"] = 0)] = "CHARACTER";
  TokenType[(TokenType["NULL_CHARACTER"] = 1)] = "NULL_CHARACTER";
  TokenType[(TokenType["WHITESPACE_CHARACTER"] = 2)] = "WHITESPACE_CHARACTER";
  TokenType[(TokenType["START_TAG"] = 3)] = "START_TAG";
  TokenType[(TokenType["END_TAG"] = 4)] = "END_TAG";
  TokenType[(TokenType["COMMENT"] = 5)] = "COMMENT";
  TokenType[(TokenType["DOCTYPE"] = 6)] = "DOCTYPE";
  TokenType[(TokenType["EOF"] = 7)] = "EOF";
  TokenType[(TokenType["HIBERNATION"] = 8)] = "HIBERNATION";
})(TokenType || (TokenType = {}));
function getTokenAttr(token, attrName) {
  for (let i = token.attrs.length - 1; i >= 0; i--) {
    if (token.attrs[i].name === attrName) {
      return token.attrs[i].value;
    }
  }
  return null;
}

// Generated using scripts/write-decode-map.ts
const htmlDecodeTree = /* #__PURE__ */ new Uint16Array(
  // prettier-ignore
  /* #__PURE__ */ "\u1d41<\xd5\u0131\u028a\u049d\u057b\u05d0\u0675\u06de\u07a2\u07d6\u080f\u0a4a\u0a91\u0da1\u0e6d\u0f09\u0f26\u10ca\u1228\u12e1\u1415\u149d\u14c3\u14df\u1525\0\0\0\0\0\0\u156b\u16cd\u198d\u1c12\u1ddd\u1f7e\u2060\u21b0\u228d\u23c0\u23fb\u2442\u2824\u2912\u2d08\u2e48\u2fce\u3016\u32ba\u3639\u37ac\u38fe\u3a28\u3a71\u3ae0\u3b2e\u0800EMabcfglmnoprstu\\bfms\x7f\x84\x8b\x90\x95\x98\xa6\xb3\xb9\xc8\xcflig\u803b\xc6\u40c6P\u803b&\u4026cute\u803b\xc1\u40c1reve;\u4102\u0100iyx}rc\u803b\xc2\u40c2;\u4410r;\uc000\ud835\udd04rave\u803b\xc0\u40c0pha;\u4391acr;\u4100d;\u6a53\u0100gp\x9d\xa1on;\u4104f;\uc000\ud835\udd38plyFunction;\u6061ing\u803b\xc5\u40c5\u0100cs\xbe\xc3r;\uc000\ud835\udc9cign;\u6254ilde\u803b\xc3\u40c3ml\u803b\xc4\u40c4\u0400aceforsu\xe5\xfb\xfe\u0117\u011c\u0122\u0127\u012a\u0100cr\xea\xf2kslash;\u6216\u0176\xf6\xf8;\u6ae7ed;\u6306y;\u4411\u0180crt\u0105\u010b\u0114ause;\u6235noullis;\u612ca;\u4392r;\uc000\ud835\udd05pf;\uc000\ud835\udd39eve;\u42d8c\xf2\u0113mpeq;\u624e\u0700HOacdefhilorsu\u014d\u0151\u0156\u0180\u019e\u01a2\u01b5\u01b7\u01ba\u01dc\u0215\u0273\u0278\u027ecy;\u4427PY\u803b\xa9\u40a9\u0180cpy\u015d\u0162\u017aute;\u4106\u0100;i\u0167\u0168\u62d2talDifferentialD;\u6145leys;\u612d\u0200aeio\u0189\u018e\u0194\u0198ron;\u410cdil\u803b\xc7\u40c7rc;\u4108nint;\u6230ot;\u410a\u0100dn\u01a7\u01adilla;\u40b8terDot;\u40b7\xf2\u017fi;\u43a7rcle\u0200DMPT\u01c7\u01cb\u01d1\u01d6ot;\u6299inus;\u6296lus;\u6295imes;\u6297o\u0100cs\u01e2\u01f8kwiseContourIntegral;\u6232eCurly\u0100DQ\u0203\u020foubleQuote;\u601duote;\u6019\u0200lnpu\u021e\u0228\u0247\u0255on\u0100;e\u0225\u0226\u6237;\u6a74\u0180git\u022f\u0236\u023aruent;\u6261nt;\u622fourIntegral;\u622e\u0100fr\u024c\u024e;\u6102oduct;\u6210nterClockwiseContourIntegral;\u6233oss;\u6a2fcr;\uc000\ud835\udc9ep\u0100;C\u0284\u0285\u62d3ap;\u624d\u0580DJSZacefios\u02a0\u02ac\u02b0\u02b4\u02b8\u02cb\u02d7\u02e1\u02e6\u0333\u048d\u0100;o\u0179\u02a5trahd;\u6911cy;\u4402cy;\u4405cy;\u440f\u0180grs\u02bf\u02c4\u02c7ger;\u6021r;\u61a1hv;\u6ae4\u0100ay\u02d0\u02d5ron;\u410e;\u4414l\u0100;t\u02dd\u02de\u6207a;\u4394r;\uc000\ud835\udd07\u0100af\u02eb\u0327\u0100cm\u02f0\u0322ritical\u0200ADGT\u0300\u0306\u0316\u031ccute;\u40b4o\u0174\u030b\u030d;\u42d9bleAcute;\u42ddrave;\u4060ilde;\u42dcond;\u62c4ferentialD;\u6146\u0470\u033d\0\0\0\u0342\u0354\0\u0405f;\uc000\ud835\udd3b\u0180;DE\u0348\u0349\u034d\u40a8ot;\u60dcqual;\u6250ble\u0300CDLRUV\u0363\u0372\u0382\u03cf\u03e2\u03f8ontourIntegra\xec\u0239o\u0274\u0379\0\0\u037b\xbb\u0349nArrow;\u61d3\u0100eo\u0387\u03a4ft\u0180ART\u0390\u0396\u03a1rrow;\u61d0ightArrow;\u61d4e\xe5\u02cang\u0100LR\u03ab\u03c4eft\u0100AR\u03b3\u03b9rrow;\u67f8ightArrow;\u67faightArrow;\u67f9ight\u0100AT\u03d8\u03derrow;\u61d2ee;\u62a8p\u0241\u03e9\0\0\u03efrrow;\u61d1ownArrow;\u61d5erticalBar;\u6225n\u0300ABLRTa\u0412\u042a\u0430\u045e\u047f\u037crrow\u0180;BU\u041d\u041e\u0422\u6193ar;\u6913pArrow;\u61f5reve;\u4311eft\u02d2\u043a\0\u0446\0\u0450ightVector;\u6950eeVector;\u695eector\u0100;B\u0459\u045a\u61bdar;\u6956ight\u01d4\u0467\0\u0471eeVector;\u695fector\u0100;B\u047a\u047b\u61c1ar;\u6957ee\u0100;A\u0486\u0487\u62a4rrow;\u61a7\u0100ct\u0492\u0497r;\uc000\ud835\udc9frok;\u4110\u0800NTacdfglmopqstux\u04bd\u04c0\u04c4\u04cb\u04de\u04e2\u04e7\u04ee\u04f5\u0521\u052f\u0536\u0552\u055d\u0560\u0565G;\u414aH\u803b\xd0\u40d0cute\u803b\xc9\u40c9\u0180aiy\u04d2\u04d7\u04dcron;\u411arc\u803b\xca\u40ca;\u442dot;\u4116r;\uc000\ud835\udd08rave\u803b\xc8\u40c8ement;\u6208\u0100ap\u04fa\u04fecr;\u4112ty\u0253\u0506\0\0\u0512mallSquare;\u65fberySmallSquare;\u65ab\u0100gp\u0526\u052aon;\u4118f;\uc000\ud835\udd3csilon;\u4395u\u0100ai\u053c\u0549l\u0100;T\u0542\u0543\u6a75ilde;\u6242librium;\u61cc\u0100ci\u0557\u055ar;\u6130m;\u6a73a;\u4397ml\u803b\xcb\u40cb\u0100ip\u056a\u056fsts;\u6203onentialE;\u6147\u0280cfios\u0585\u0588\u058d\u05b2\u05ccy;\u4424r;\uc000\ud835\udd09lled\u0253\u0597\0\0\u05a3mallSquare;\u65fcerySmallSquare;\u65aa\u0370\u05ba\0\u05bf\0\0\u05c4f;\uc000\ud835\udd3dAll;\u6200riertrf;\u6131c\xf2\u05cb\u0600JTabcdfgorst\u05e8\u05ec\u05ef\u05fa\u0600\u0612\u0616\u061b\u061d\u0623\u066c\u0672cy;\u4403\u803b>\u403emma\u0100;d\u05f7\u05f8\u4393;\u43dcreve;\u411e\u0180eiy\u0607\u060c\u0610dil;\u4122rc;\u411c;\u4413ot;\u4120r;\uc000\ud835\udd0a;\u62d9pf;\uc000\ud835\udd3eeater\u0300EFGLST\u0635\u0644\u064e\u0656\u065b\u0666qual\u0100;L\u063e\u063f\u6265ess;\u62dbullEqual;\u6267reater;\u6aa2ess;\u6277lantEqual;\u6a7eilde;\u6273cr;\uc000\ud835\udca2;\u626b\u0400Aacfiosu\u0685\u068b\u0696\u069b\u069e\u06aa\u06be\u06caRDcy;\u442a\u0100ct\u0690\u0694ek;\u42c7;\u405eirc;\u4124r;\u610clbertSpace;\u610b\u01f0\u06af\0\u06b2f;\u610dizontalLine;\u6500\u0100ct\u06c3\u06c5\xf2\u06a9rok;\u4126mp\u0144\u06d0\u06d8ownHum\xf0\u012fqual;\u624f\u0700EJOacdfgmnostu\u06fa\u06fe\u0703\u0707\u070e\u071a\u071e\u0721\u0728\u0744\u0778\u078b\u078f\u0795cy;\u4415lig;\u4132cy;\u4401cute\u803b\xcd\u40cd\u0100iy\u0713\u0718rc\u803b\xce\u40ce;\u4418ot;\u4130r;\u6111rave\u803b\xcc\u40cc\u0180;ap\u0720\u072f\u073f\u0100cg\u0734\u0737r;\u412ainaryI;\u6148lie\xf3\u03dd\u01f4\u0749\0\u0762\u0100;e\u074d\u074e\u622c\u0100gr\u0753\u0758ral;\u622bsection;\u62c2isible\u0100CT\u076c\u0772omma;\u6063imes;\u6062\u0180gpt\u077f\u0783\u0788on;\u412ef;\uc000\ud835\udd40a;\u4399cr;\u6110ilde;\u4128\u01eb\u079a\0\u079ecy;\u4406l\u803b\xcf\u40cf\u0280cfosu\u07ac\u07b7\u07bc\u07c2\u07d0\u0100iy\u07b1\u07b5rc;\u4134;\u4419r;\uc000\ud835\udd0dpf;\uc000\ud835\udd41\u01e3\u07c7\0\u07ccr;\uc000\ud835\udca5rcy;\u4408kcy;\u4404\u0380HJacfos\u07e4\u07e8\u07ec\u07f1\u07fd\u0802\u0808cy;\u4425cy;\u440cppa;\u439a\u0100ey\u07f6\u07fbdil;\u4136;\u441ar;\uc000\ud835\udd0epf;\uc000\ud835\udd42cr;\uc000\ud835\udca6\u0580JTaceflmost\u0825\u0829\u082c\u0850\u0863\u09b3\u09b8\u09c7\u09cd\u0a37\u0a47cy;\u4409\u803b<\u403c\u0280cmnpr\u0837\u083c\u0841\u0844\u084dute;\u4139bda;\u439bg;\u67ealacetrf;\u6112r;\u619e\u0180aey\u0857\u085c\u0861ron;\u413ddil;\u413b;\u441b\u0100fs\u0868\u0970t\u0500ACDFRTUVar\u087e\u08a9\u08b1\u08e0\u08e6\u08fc\u092f\u095b\u0390\u096a\u0100nr\u0883\u088fgleBracket;\u67e8row\u0180;BR\u0899\u089a\u089e\u6190ar;\u61e4ightArrow;\u61c6eiling;\u6308o\u01f5\u08b7\0\u08c3bleBracket;\u67e6n\u01d4\u08c8\0\u08d2eeVector;\u6961ector\u0100;B\u08db\u08dc\u61c3ar;\u6959loor;\u630aight\u0100AV\u08ef\u08f5rrow;\u6194ector;\u694e\u0100er\u0901\u0917e\u0180;AV\u0909\u090a\u0910\u62a3rrow;\u61a4ector;\u695aiangle\u0180;BE\u0924\u0925\u0929\u62b2ar;\u69cfqual;\u62b4p\u0180DTV\u0937\u0942\u094cownVector;\u6951eeVector;\u6960ector\u0100;B\u0956\u0957\u61bfar;\u6958ector\u0100;B\u0965\u0966\u61bcar;\u6952ight\xe1\u039cs\u0300EFGLST\u097e\u098b\u0995\u099d\u09a2\u09adqualGreater;\u62daullEqual;\u6266reater;\u6276ess;\u6aa1lantEqual;\u6a7dilde;\u6272r;\uc000\ud835\udd0f\u0100;e\u09bd\u09be\u62d8ftarrow;\u61daidot;\u413f\u0180npw\u09d4\u0a16\u0a1bg\u0200LRlr\u09de\u09f7\u0a02\u0a10eft\u0100AR\u09e6\u09ecrrow;\u67f5ightArrow;\u67f7ightArrow;\u67f6eft\u0100ar\u03b3\u0a0aight\xe1\u03bfight\xe1\u03caf;\uc000\ud835\udd43er\u0100LR\u0a22\u0a2ceftArrow;\u6199ightArrow;\u6198\u0180cht\u0a3e\u0a40\u0a42\xf2\u084c;\u61b0rok;\u4141;\u626a\u0400acefiosu\u0a5a\u0a5d\u0a60\u0a77\u0a7c\u0a85\u0a8b\u0a8ep;\u6905y;\u441c\u0100dl\u0a65\u0a6fiumSpace;\u605flintrf;\u6133r;\uc000\ud835\udd10nusPlus;\u6213pf;\uc000\ud835\udd44c\xf2\u0a76;\u439c\u0480Jacefostu\u0aa3\u0aa7\u0aad\u0ac0\u0b14\u0b19\u0d91\u0d97\u0d9ecy;\u440acute;\u4143\u0180aey\u0ab4\u0ab9\u0aberon;\u4147dil;\u4145;\u441d\u0180gsw\u0ac7\u0af0\u0b0eative\u0180MTV\u0ad3\u0adf\u0ae8ediumSpace;\u600bhi\u0100cn\u0ae6\u0ad8\xeb\u0ad9eryThi\xee\u0ad9ted\u0100GL\u0af8\u0b06reaterGreate\xf2\u0673essLes\xf3\u0a48Line;\u400ar;\uc000\ud835\udd11\u0200Bnpt\u0b22\u0b28\u0b37\u0b3areak;\u6060BreakingSpace;\u40a0f;\u6115\u0680;CDEGHLNPRSTV\u0b55\u0b56\u0b6a\u0b7c\u0ba1\u0beb\u0c04\u0c5e\u0c84\u0ca6\u0cd8\u0d61\u0d85\u6aec\u0100ou\u0b5b\u0b64ngruent;\u6262pCap;\u626doubleVerticalBar;\u6226\u0180lqx\u0b83\u0b8a\u0b9bement;\u6209ual\u0100;T\u0b92\u0b93\u6260ilde;\uc000\u2242\u0338ists;\u6204reater\u0380;EFGLST\u0bb6\u0bb7\u0bbd\u0bc9\u0bd3\u0bd8\u0be5\u626fqual;\u6271ullEqual;\uc000\u2267\u0338reater;\uc000\u226b\u0338ess;\u6279lantEqual;\uc000\u2a7e\u0338ilde;\u6275ump\u0144\u0bf2\u0bfdownHump;\uc000\u224e\u0338qual;\uc000\u224f\u0338e\u0100fs\u0c0a\u0c27tTriangle\u0180;BE\u0c1a\u0c1b\u0c21\u62eaar;\uc000\u29cf\u0338qual;\u62ecs\u0300;EGLST\u0c35\u0c36\u0c3c\u0c44\u0c4b\u0c58\u626equal;\u6270reater;\u6278ess;\uc000\u226a\u0338lantEqual;\uc000\u2a7d\u0338ilde;\u6274ested\u0100GL\u0c68\u0c79reaterGreater;\uc000\u2aa2\u0338essLess;\uc000\u2aa1\u0338recedes\u0180;ES\u0c92\u0c93\u0c9b\u6280qual;\uc000\u2aaf\u0338lantEqual;\u62e0\u0100ei\u0cab\u0cb9verseElement;\u620cghtTriangle\u0180;BE\u0ccb\u0ccc\u0cd2\u62ebar;\uc000\u29d0\u0338qual;\u62ed\u0100qu\u0cdd\u0d0cuareSu\u0100bp\u0ce8\u0cf9set\u0100;E\u0cf0\u0cf3\uc000\u228f\u0338qual;\u62e2erset\u0100;E\u0d03\u0d06\uc000\u2290\u0338qual;\u62e3\u0180bcp\u0d13\u0d24\u0d4eset\u0100;E\u0d1b\u0d1e\uc000\u2282\u20d2qual;\u6288ceeds\u0200;EST\u0d32\u0d33\u0d3b\u0d46\u6281qual;\uc000\u2ab0\u0338lantEqual;\u62e1ilde;\uc000\u227f\u0338erset\u0100;E\u0d58\u0d5b\uc000\u2283\u20d2qual;\u6289ilde\u0200;EFT\u0d6e\u0d6f\u0d75\u0d7f\u6241qual;\u6244ullEqual;\u6247ilde;\u6249erticalBar;\u6224cr;\uc000\ud835\udca9ilde\u803b\xd1\u40d1;\u439d\u0700Eacdfgmoprstuv\u0dbd\u0dc2\u0dc9\u0dd5\u0ddb\u0de0\u0de7\u0dfc\u0e02\u0e20\u0e22\u0e32\u0e3f\u0e44lig;\u4152cute\u803b\xd3\u40d3\u0100iy\u0dce\u0dd3rc\u803b\xd4\u40d4;\u441eblac;\u4150r;\uc000\ud835\udd12rave\u803b\xd2\u40d2\u0180aei\u0dee\u0df2\u0df6cr;\u414cga;\u43a9cron;\u439fpf;\uc000\ud835\udd46enCurly\u0100DQ\u0e0e\u0e1aoubleQuote;\u601cuote;\u6018;\u6a54\u0100cl\u0e27\u0e2cr;\uc000\ud835\udcaaash\u803b\xd8\u40d8i\u016c\u0e37\u0e3cde\u803b\xd5\u40d5es;\u6a37ml\u803b\xd6\u40d6er\u0100BP\u0e4b\u0e60\u0100ar\u0e50\u0e53r;\u603eac\u0100ek\u0e5a\u0e5c;\u63deet;\u63b4arenthesis;\u63dc\u0480acfhilors\u0e7f\u0e87\u0e8a\u0e8f\u0e92\u0e94\u0e9d\u0eb0\u0efcrtialD;\u6202y;\u441fr;\uc000\ud835\udd13i;\u43a6;\u43a0usMinus;\u40b1\u0100ip\u0ea2\u0eadncareplan\xe5\u069df;\u6119\u0200;eio\u0eb9\u0eba\u0ee0\u0ee4\u6abbcedes\u0200;EST\u0ec8\u0ec9\u0ecf\u0eda\u627aqual;\u6aaflantEqual;\u627cilde;\u627eme;\u6033\u0100dp\u0ee9\u0eeeuct;\u620fortion\u0100;a\u0225\u0ef9l;\u621d\u0100ci\u0f01\u0f06r;\uc000\ud835\udcab;\u43a8\u0200Ufos\u0f11\u0f16\u0f1b\u0f1fOT\u803b\"\u4022r;\uc000\ud835\udd14pf;\u611acr;\uc000\ud835\udcac\u0600BEacefhiorsu\u0f3e\u0f43\u0f47\u0f60\u0f73\u0fa7\u0faa\u0fad\u1096\u10a9\u10b4\u10bearr;\u6910G\u803b\xae\u40ae\u0180cnr\u0f4e\u0f53\u0f56ute;\u4154g;\u67ebr\u0100;t\u0f5c\u0f5d\u61a0l;\u6916\u0180aey\u0f67\u0f6c\u0f71ron;\u4158dil;\u4156;\u4420\u0100;v\u0f78\u0f79\u611cerse\u0100EU\u0f82\u0f99\u0100lq\u0f87\u0f8eement;\u620builibrium;\u61cbpEquilibrium;\u696fr\xbb\u0f79o;\u43a1ght\u0400ACDFTUVa\u0fc1\u0feb\u0ff3\u1022\u1028\u105b\u1087\u03d8\u0100nr\u0fc6\u0fd2gleBracket;\u67e9row\u0180;BL\u0fdc\u0fdd\u0fe1\u6192ar;\u61e5eftArrow;\u61c4eiling;\u6309o\u01f5\u0ff9\0\u1005bleBracket;\u67e7n\u01d4\u100a\0\u1014eeVector;\u695dector\u0100;B\u101d\u101e\u61c2ar;\u6955loor;\u630b\u0100er\u102d\u1043e\u0180;AV\u1035\u1036\u103c\u62a2rrow;\u61a6ector;\u695biangle\u0180;BE\u1050\u1051\u1055\u62b3ar;\u69d0qual;\u62b5p\u0180DTV\u1063\u106e\u1078ownVector;\u694feeVector;\u695cector\u0100;B\u1082\u1083\u61bear;\u6954ector\u0100;B\u1091\u1092\u61c0ar;\u6953\u0100pu\u109b\u109ef;\u611dndImplies;\u6970ightarrow;\u61db\u0100ch\u10b9\u10bcr;\u611b;\u61b1leDelayed;\u69f4\u0680HOacfhimoqstu\u10e4\u10f1\u10f7\u10fd\u1119\u111e\u1151\u1156\u1161\u1167\u11b5\u11bb\u11bf\u0100Cc\u10e9\u10eeHcy;\u4429y;\u4428FTcy;\u442ccute;\u415a\u0280;aeiy\u1108\u1109\u110e\u1113\u1117\u6abcron;\u4160dil;\u415erc;\u415c;\u4421r;\uc000\ud835\udd16ort\u0200DLRU\u112a\u1134\u113e\u1149ownArrow\xbb\u041eeftArrow\xbb\u089aightArrow\xbb\u0fddpArrow;\u6191gma;\u43a3allCircle;\u6218pf;\uc000\ud835\udd4a\u0272\u116d\0\0\u1170t;\u621aare\u0200;ISU\u117b\u117c\u1189\u11af\u65a1ntersection;\u6293u\u0100bp\u118f\u119eset\u0100;E\u1197\u1198\u628fqual;\u6291erset\u0100;E\u11a8\u11a9\u6290qual;\u6292nion;\u6294cr;\uc000\ud835\udcaear;\u62c6\u0200bcmp\u11c8\u11db\u1209\u120b\u0100;s\u11cd\u11ce\u62d0et\u0100;E\u11cd\u11d5qual;\u6286\u0100ch\u11e0\u1205eeds\u0200;EST\u11ed\u11ee\u11f4\u11ff\u627bqual;\u6ab0lantEqual;\u627dilde;\u627fTh\xe1\u0f8c;\u6211\u0180;es\u1212\u1213\u1223\u62d1rset\u0100;E\u121c\u121d\u6283qual;\u6287et\xbb\u1213\u0580HRSacfhiors\u123e\u1244\u1249\u1255\u125e\u1271\u1276\u129f\u12c2\u12c8\u12d1ORN\u803b\xde\u40deADE;\u6122\u0100Hc\u124e\u1252cy;\u440by;\u4426\u0100bu\u125a\u125c;\u4009;\u43a4\u0180aey\u1265\u126a\u126fron;\u4164dil;\u4162;\u4422r;\uc000\ud835\udd17\u0100ei\u127b\u1289\u01f2\u1280\0\u1287efore;\u6234a;\u4398\u0100cn\u128e\u1298kSpace;\uc000\u205f\u200aSpace;\u6009lde\u0200;EFT\u12ab\u12ac\u12b2\u12bc\u623cqual;\u6243ullEqual;\u6245ilde;\u6248pf;\uc000\ud835\udd4bipleDot;\u60db\u0100ct\u12d6\u12dbr;\uc000\ud835\udcafrok;\u4166\u0ae1\u12f7\u130e\u131a\u1326\0\u132c\u1331\0\0\0\0\0\u1338\u133d\u1377\u1385\0\u13ff\u1404\u140a\u1410\u0100cr\u12fb\u1301ute\u803b\xda\u40dar\u0100;o\u1307\u1308\u619fcir;\u6949r\u01e3\u1313\0\u1316y;\u440eve;\u416c\u0100iy\u131e\u1323rc\u803b\xdb\u40db;\u4423blac;\u4170r;\uc000\ud835\udd18rave\u803b\xd9\u40d9acr;\u416a\u0100di\u1341\u1369er\u0100BP\u1348\u135d\u0100ar\u134d\u1350r;\u405fac\u0100ek\u1357\u1359;\u63dfet;\u63b5arenthesis;\u63ddon\u0100;P\u1370\u1371\u62c3lus;\u628e\u0100gp\u137b\u137fon;\u4172f;\uc000\ud835\udd4c\u0400ADETadps\u1395\u13ae\u13b8\u13c4\u03e8\u13d2\u13d7\u13f3rrow\u0180;BD\u1150\u13a0\u13a4ar;\u6912ownArrow;\u61c5ownArrow;\u6195quilibrium;\u696eee\u0100;A\u13cb\u13cc\u62a5rrow;\u61a5own\xe1\u03f3er\u0100LR\u13de\u13e8eftArrow;\u6196ightArrow;\u6197i\u0100;l\u13f9\u13fa\u43d2on;\u43a5ing;\u416ecr;\uc000\ud835\udcb0ilde;\u4168ml\u803b\xdc\u40dc\u0480Dbcdefosv\u1427\u142c\u1430\u1433\u143e\u1485\u148a\u1490\u1496ash;\u62abar;\u6aeby;\u4412ash\u0100;l\u143b\u143c\u62a9;\u6ae6\u0100er\u1443\u1445;\u62c1\u0180bty\u144c\u1450\u147aar;\u6016\u0100;i\u144f\u1455cal\u0200BLST\u1461\u1465\u146a\u1474ar;\u6223ine;\u407ceparator;\u6758ilde;\u6240ThinSpace;\u600ar;\uc000\ud835\udd19pf;\uc000\ud835\udd4dcr;\uc000\ud835\udcb1dash;\u62aa\u0280cefos\u14a7\u14ac\u14b1\u14b6\u14bcirc;\u4174dge;\u62c0r;\uc000\ud835\udd1apf;\uc000\ud835\udd4ecr;\uc000\ud835\udcb2\u0200fios\u14cb\u14d0\u14d2\u14d8r;\uc000\ud835\udd1b;\u439epf;\uc000\ud835\udd4fcr;\uc000\ud835\udcb3\u0480AIUacfosu\u14f1\u14f5\u14f9\u14fd\u1504\u150f\u1514\u151a\u1520cy;\u442fcy;\u4407cy;\u442ecute\u803b\xdd\u40dd\u0100iy\u1509\u150drc;\u4176;\u442br;\uc000\ud835\udd1cpf;\uc000\ud835\udd50cr;\uc000\ud835\udcb4ml;\u4178\u0400Hacdefos\u1535\u1539\u153f\u154b\u154f\u155d\u1560\u1564cy;\u4416cute;\u4179\u0100ay\u1544\u1549ron;\u417d;\u4417ot;\u417b\u01f2\u1554\0\u155boWidt\xe8\u0ad9a;\u4396r;\u6128pf;\u6124cr;\uc000\ud835\udcb5\u0be1\u1583\u158a\u1590\0\u15b0\u15b6\u15bf\0\0\0\0\u15c6\u15db\u15eb\u165f\u166d\0\u1695\u169b\u16b2\u16b9\0\u16becute\u803b\xe1\u40e1reve;\u4103\u0300;Ediuy\u159c\u159d\u15a1\u15a3\u15a8\u15ad\u623e;\uc000\u223e\u0333;\u623frc\u803b\xe2\u40e2te\u80bb\xb4\u0306;\u4430lig\u803b\xe6\u40e6\u0100;r\xb2\u15ba;\uc000\ud835\udd1erave\u803b\xe0\u40e0\u0100ep\u15ca\u15d6\u0100fp\u15cf\u15d4sym;\u6135\xe8\u15d3ha;\u43b1\u0100ap\u15dfc\u0100cl\u15e4\u15e7r;\u4101g;\u6a3f\u0264\u15f0\0\0\u160a\u0280;adsv\u15fa\u15fb\u15ff\u1601\u1607\u6227nd;\u6a55;\u6a5clope;\u6a58;\u6a5a\u0380;elmrsz\u1618\u1619\u161b\u161e\u163f\u164f\u1659\u6220;\u69a4e\xbb\u1619sd\u0100;a\u1625\u1626\u6221\u0461\u1630\u1632\u1634\u1636\u1638\u163a\u163c\u163e;\u69a8;\u69a9;\u69aa;\u69ab;\u69ac;\u69ad;\u69ae;\u69aft\u0100;v\u1645\u1646\u621fb\u0100;d\u164c\u164d\u62be;\u699d\u0100pt\u1654\u1657h;\u6222\xbb\xb9arr;\u637c\u0100gp\u1663\u1667on;\u4105f;\uc000\ud835\udd52\u0380;Eaeiop\u12c1\u167b\u167d\u1682\u1684\u1687\u168a;\u6a70cir;\u6a6f;\u624ad;\u624bs;\u4027rox\u0100;e\u12c1\u1692\xf1\u1683ing\u803b\xe5\u40e5\u0180cty\u16a1\u16a6\u16a8r;\uc000\ud835\udcb6;\u402amp\u0100;e\u12c1\u16af\xf1\u0288ilde\u803b\xe3\u40e3ml\u803b\xe4\u40e4\u0100ci\u16c2\u16c8onin\xf4\u0272nt;\u6a11\u0800Nabcdefiklnoprsu\u16ed\u16f1\u1730\u173c\u1743\u1748\u1778\u177d\u17e0\u17e6\u1839\u1850\u170d\u193d\u1948\u1970ot;\u6aed\u0100cr\u16f6\u171ek\u0200ceps\u1700\u1705\u170d\u1713ong;\u624cpsilon;\u43f6rime;\u6035im\u0100;e\u171a\u171b\u623dq;\u62cd\u0176\u1722\u1726ee;\u62bded\u0100;g\u172c\u172d\u6305e\xbb\u172drk\u0100;t\u135c\u1737brk;\u63b6\u0100oy\u1701\u1741;\u4431quo;\u601e\u0280cmprt\u1753\u175b\u1761\u1764\u1768aus\u0100;e\u010a\u0109ptyv;\u69b0s\xe9\u170cno\xf5\u0113\u0180ahw\u176f\u1771\u1773;\u43b2;\u6136een;\u626cr;\uc000\ud835\udd1fg\u0380costuvw\u178d\u179d\u17b3\u17c1\u17d5\u17db\u17de\u0180aiu\u1794\u1796\u179a\xf0\u0760rc;\u65efp\xbb\u1371\u0180dpt\u17a4\u17a8\u17adot;\u6a00lus;\u6a01imes;\u6a02\u0271\u17b9\0\0\u17becup;\u6a06ar;\u6605riangle\u0100du\u17cd\u17d2own;\u65bdp;\u65b3plus;\u6a04e\xe5\u1444\xe5\u14adarow;\u690d\u0180ako\u17ed\u1826\u1835\u0100cn\u17f2\u1823k\u0180lst\u17fa\u05ab\u1802ozenge;\u69ebriangle\u0200;dlr\u1812\u1813\u1818\u181d\u65b4own;\u65beeft;\u65c2ight;\u65b8k;\u6423\u01b1\u182b\0\u1833\u01b2\u182f\0\u1831;\u6592;\u65914;\u6593ck;\u6588\u0100eo\u183e\u184d\u0100;q\u1843\u1846\uc000=\u20e5uiv;\uc000\u2261\u20e5t;\u6310\u0200ptwx\u1859\u185e\u1867\u186cf;\uc000\ud835\udd53\u0100;t\u13cb\u1863om\xbb\u13cctie;\u62c8\u0600DHUVbdhmptuv\u1885\u1896\u18aa\u18bb\u18d7\u18db\u18ec\u18ff\u1905\u190a\u1910\u1921\u0200LRlr\u188e\u1890\u1892\u1894;\u6557;\u6554;\u6556;\u6553\u0280;DUdu\u18a1\u18a2\u18a4\u18a6\u18a8\u6550;\u6566;\u6569;\u6564;\u6567\u0200LRlr\u18b3\u18b5\u18b7\u18b9;\u655d;\u655a;\u655c;\u6559\u0380;HLRhlr\u18ca\u18cb\u18cd\u18cf\u18d1\u18d3\u18d5\u6551;\u656c;\u6563;\u6560;\u656b;\u6562;\u655fox;\u69c9\u0200LRlr\u18e4\u18e6\u18e8\u18ea;\u6555;\u6552;\u6510;\u650c\u0280;DUdu\u06bd\u18f7\u18f9\u18fb\u18fd;\u6565;\u6568;\u652c;\u6534inus;\u629flus;\u629eimes;\u62a0\u0200LRlr\u1919\u191b\u191d\u191f;\u655b;\u6558;\u6518;\u6514\u0380;HLRhlr\u1930\u1931\u1933\u1935\u1937\u1939\u193b\u6502;\u656a;\u6561;\u655e;\u653c;\u6524;\u651c\u0100ev\u0123\u1942bar\u803b\xa6\u40a6\u0200ceio\u1951\u1956\u195a\u1960r;\uc000\ud835\udcb7mi;\u604fm\u0100;e\u171a\u171cl\u0180;bh\u1968\u1969\u196b\u405c;\u69c5sub;\u67c8\u016c\u1974\u197el\u0100;e\u1979\u197a\u6022t\xbb\u197ap\u0180;Ee\u012f\u1985\u1987;\u6aae\u0100;q\u06dc\u06db\u0ce1\u19a7\0\u19e8\u1a11\u1a15\u1a32\0\u1a37\u1a50\0\0\u1ab4\0\0\u1ac1\0\0\u1b21\u1b2e\u1b4d\u1b52\0\u1bfd\0\u1c0c\u0180cpr\u19ad\u19b2\u19ddute;\u4107\u0300;abcds\u19bf\u19c0\u19c4\u19ca\u19d5\u19d9\u6229nd;\u6a44rcup;\u6a49\u0100au\u19cf\u19d2p;\u6a4bp;\u6a47ot;\u6a40;\uc000\u2229\ufe00\u0100eo\u19e2\u19e5t;\u6041\xee\u0693\u0200aeiu\u19f0\u19fb\u1a01\u1a05\u01f0\u19f5\0\u19f8s;\u6a4don;\u410ddil\u803b\xe7\u40e7rc;\u4109ps\u0100;s\u1a0c\u1a0d\u6a4cm;\u6a50ot;\u410b\u0180dmn\u1a1b\u1a20\u1a26il\u80bb\xb8\u01adptyv;\u69b2t\u8100\xa2;e\u1a2d\u1a2e\u40a2r\xe4\u01b2r;\uc000\ud835\udd20\u0180cei\u1a3d\u1a40\u1a4dy;\u4447ck\u0100;m\u1a47\u1a48\u6713ark\xbb\u1a48;\u43c7r\u0380;Ecefms\u1a5f\u1a60\u1a62\u1a6b\u1aa4\u1aaa\u1aae\u65cb;\u69c3\u0180;el\u1a69\u1a6a\u1a6d\u42c6q;\u6257e\u0261\u1a74\0\0\u1a88rrow\u0100lr\u1a7c\u1a81eft;\u61baight;\u61bb\u0280RSacd\u1a92\u1a94\u1a96\u1a9a\u1a9f\xbb\u0f47;\u64c8st;\u629birc;\u629aash;\u629dnint;\u6a10id;\u6aefcir;\u69c2ubs\u0100;u\u1abb\u1abc\u6663it\xbb\u1abc\u02ec\u1ac7\u1ad4\u1afa\0\u1b0aon\u0100;e\u1acd\u1ace\u403a\u0100;q\xc7\xc6\u026d\u1ad9\0\0\u1ae2a\u0100;t\u1ade\u1adf\u402c;\u4040\u0180;fl\u1ae8\u1ae9\u1aeb\u6201\xee\u1160e\u0100mx\u1af1\u1af6ent\xbb\u1ae9e\xf3\u024d\u01e7\u1afe\0\u1b07\u0100;d\u12bb\u1b02ot;\u6a6dn\xf4\u0246\u0180fry\u1b10\u1b14\u1b17;\uc000\ud835\udd54o\xe4\u0254\u8100\xa9;s\u0155\u1b1dr;\u6117\u0100ao\u1b25\u1b29rr;\u61b5ss;\u6717\u0100cu\u1b32\u1b37r;\uc000\ud835\udcb8\u0100bp\u1b3c\u1b44\u0100;e\u1b41\u1b42\u6acf;\u6ad1\u0100;e\u1b49\u1b4a\u6ad0;\u6ad2dot;\u62ef\u0380delprvw\u1b60\u1b6c\u1b77\u1b82\u1bac\u1bd4\u1bf9arr\u0100lr\u1b68\u1b6a;\u6938;\u6935\u0270\u1b72\0\0\u1b75r;\u62dec;\u62dfarr\u0100;p\u1b7f\u1b80\u61b6;\u693d\u0300;bcdos\u1b8f\u1b90\u1b96\u1ba1\u1ba5\u1ba8\u622arcap;\u6a48\u0100au\u1b9b\u1b9ep;\u6a46p;\u6a4aot;\u628dr;\u6a45;\uc000\u222a\ufe00\u0200alrv\u1bb5\u1bbf\u1bde\u1be3rr\u0100;m\u1bbc\u1bbd\u61b7;\u693cy\u0180evw\u1bc7\u1bd4\u1bd8q\u0270\u1bce\0\0\u1bd2re\xe3\u1b73u\xe3\u1b75ee;\u62ceedge;\u62cfen\u803b\xa4\u40a4earrow\u0100lr\u1bee\u1bf3eft\xbb\u1b80ight\xbb\u1bbde\xe4\u1bdd\u0100ci\u1c01\u1c07onin\xf4\u01f7nt;\u6231lcty;\u632d\u0980AHabcdefhijlorstuwz\u1c38\u1c3b\u1c3f\u1c5d\u1c69\u1c75\u1c8a\u1c9e\u1cac\u1cb7\u1cfb\u1cff\u1d0d\u1d7b\u1d91\u1dab\u1dbb\u1dc6\u1dcdr\xf2\u0381ar;\u6965\u0200glrs\u1c48\u1c4d\u1c52\u1c54ger;\u6020eth;\u6138\xf2\u1133h\u0100;v\u1c5a\u1c5b\u6010\xbb\u090a\u016b\u1c61\u1c67arow;\u690fa\xe3\u0315\u0100ay\u1c6e\u1c73ron;\u410f;\u4434\u0180;ao\u0332\u1c7c\u1c84\u0100gr\u02bf\u1c81r;\u61catseq;\u6a77\u0180glm\u1c91\u1c94\u1c98\u803b\xb0\u40b0ta;\u43b4ptyv;\u69b1\u0100ir\u1ca3\u1ca8sht;\u697f;\uc000\ud835\udd21ar\u0100lr\u1cb3\u1cb5\xbb\u08dc\xbb\u101e\u0280aegsv\u1cc2\u0378\u1cd6\u1cdc\u1ce0m\u0180;os\u0326\u1cca\u1cd4nd\u0100;s\u0326\u1cd1uit;\u6666amma;\u43ddin;\u62f2\u0180;io\u1ce7\u1ce8\u1cf8\u40f7de\u8100\xf7;o\u1ce7\u1cf0ntimes;\u62c7n\xf8\u1cf7cy;\u4452c\u026f\u1d06\0\0\u1d0arn;\u631eop;\u630d\u0280lptuw\u1d18\u1d1d\u1d22\u1d49\u1d55lar;\u4024f;\uc000\ud835\udd55\u0280;emps\u030b\u1d2d\u1d37\u1d3d\u1d42q\u0100;d\u0352\u1d33ot;\u6251inus;\u6238lus;\u6214quare;\u62a1blebarwedg\xe5\xfan\u0180adh\u112e\u1d5d\u1d67ownarrow\xf3\u1c83arpoon\u0100lr\u1d72\u1d76ef\xf4\u1cb4igh\xf4\u1cb6\u0162\u1d7f\u1d85karo\xf7\u0f42\u026f\u1d8a\0\0\u1d8ern;\u631fop;\u630c\u0180cot\u1d98\u1da3\u1da6\u0100ry\u1d9d\u1da1;\uc000\ud835\udcb9;\u4455l;\u69f6rok;\u4111\u0100dr\u1db0\u1db4ot;\u62f1i\u0100;f\u1dba\u1816\u65bf\u0100ah\u1dc0\u1dc3r\xf2\u0429a\xf2\u0fa6angle;\u69a6\u0100ci\u1dd2\u1dd5y;\u445fgrarr;\u67ff\u0900Dacdefglmnopqrstux\u1e01\u1e09\u1e19\u1e38\u0578\u1e3c\u1e49\u1e61\u1e7e\u1ea5\u1eaf\u1ebd\u1ee1\u1f2a\u1f37\u1f44\u1f4e\u1f5a\u0100Do\u1e06\u1d34o\xf4\u1c89\u0100cs\u1e0e\u1e14ute\u803b\xe9\u40e9ter;\u6a6e\u0200aioy\u1e22\u1e27\u1e31\u1e36ron;\u411br\u0100;c\u1e2d\u1e2e\u6256\u803b\xea\u40ealon;\u6255;\u444dot;\u4117\u0100Dr\u1e41\u1e45ot;\u6252;\uc000\ud835\udd22\u0180;rs\u1e50\u1e51\u1e57\u6a9aave\u803b\xe8\u40e8\u0100;d\u1e5c\u1e5d\u6a96ot;\u6a98\u0200;ils\u1e6a\u1e6b\u1e72\u1e74\u6a99nters;\u63e7;\u6113\u0100;d\u1e79\u1e7a\u6a95ot;\u6a97\u0180aps\u1e85\u1e89\u1e97cr;\u4113ty\u0180;sv\u1e92\u1e93\u1e95\u6205et\xbb\u1e93p\u01001;\u1e9d\u1ea4\u0133\u1ea1\u1ea3;\u6004;\u6005\u6003\u0100gs\u1eaa\u1eac;\u414bp;\u6002\u0100gp\u1eb4\u1eb8on;\u4119f;\uc000\ud835\udd56\u0180als\u1ec4\u1ece\u1ed2r\u0100;s\u1eca\u1ecb\u62d5l;\u69e3us;\u6a71i\u0180;lv\u1eda\u1edb\u1edf\u43b5on\xbb\u1edb;\u43f5\u0200csuv\u1eea\u1ef3\u1f0b\u1f23\u0100io\u1eef\u1e31rc\xbb\u1e2e\u0269\u1ef9\0\0\u1efb\xed\u0548ant\u0100gl\u1f02\u1f06tr\xbb\u1e5dess\xbb\u1e7a\u0180aei\u1f12\u1f16\u1f1als;\u403dst;\u625fv\u0100;D\u0235\u1f20D;\u6a78parsl;\u69e5\u0100Da\u1f2f\u1f33ot;\u6253rr;\u6971\u0180cdi\u1f3e\u1f41\u1ef8r;\u612fo\xf4\u0352\u0100ah\u1f49\u1f4b;\u43b7\u803b\xf0\u40f0\u0100mr\u1f53\u1f57l\u803b\xeb\u40ebo;\u60ac\u0180cip\u1f61\u1f64\u1f67l;\u4021s\xf4\u056e\u0100eo\u1f6c\u1f74ctatio\xee\u0559nential\xe5\u0579\u09e1\u1f92\0\u1f9e\0\u1fa1\u1fa7\0\0\u1fc6\u1fcc\0\u1fd3\0\u1fe6\u1fea\u2000\0\u2008\u205allingdotse\xf1\u1e44y;\u4444male;\u6640\u0180ilr\u1fad\u1fb3\u1fc1lig;\u8000\ufb03\u0269\u1fb9\0\0\u1fbdg;\u8000\ufb00ig;\u8000\ufb04;\uc000\ud835\udd23lig;\u8000\ufb01lig;\uc000fj\u0180alt\u1fd9\u1fdc\u1fe1t;\u666dig;\u8000\ufb02ns;\u65b1of;\u4192\u01f0\u1fee\0\u1ff3f;\uc000\ud835\udd57\u0100ak\u05bf\u1ff7\u0100;v\u1ffc\u1ffd\u62d4;\u6ad9artint;\u6a0d\u0100ao\u200c\u2055\u0100cs\u2011\u2052\u03b1\u201a\u2030\u2038\u2045\u2048\0\u2050\u03b2\u2022\u2025\u2027\u202a\u202c\0\u202e\u803b\xbd\u40bd;\u6153\u803b\xbc\u40bc;\u6155;\u6159;\u615b\u01b3\u2034\0\u2036;\u6154;\u6156\u02b4\u203e\u2041\0\0\u2043\u803b\xbe\u40be;\u6157;\u615c5;\u6158\u01b6\u204c\0\u204e;\u615a;\u615d8;\u615el;\u6044wn;\u6322cr;\uc000\ud835\udcbb\u0880Eabcdefgijlnorstv\u2082\u2089\u209f\u20a5\u20b0\u20b4\u20f0\u20f5\u20fa\u20ff\u2103\u2112\u2138\u0317\u213e\u2152\u219e\u0100;l\u064d\u2087;\u6a8c\u0180cmp\u2090\u2095\u209dute;\u41f5ma\u0100;d\u209c\u1cda\u43b3;\u6a86reve;\u411f\u0100iy\u20aa\u20aerc;\u411d;\u4433ot;\u4121\u0200;lqs\u063e\u0642\u20bd\u20c9\u0180;qs\u063e\u064c\u20c4lan\xf4\u0665\u0200;cdl\u0665\u20d2\u20d5\u20e5c;\u6aa9ot\u0100;o\u20dc\u20dd\u6a80\u0100;l\u20e2\u20e3\u6a82;\u6a84\u0100;e\u20ea\u20ed\uc000\u22db\ufe00s;\u6a94r;\uc000\ud835\udd24\u0100;g\u0673\u061bmel;\u6137cy;\u4453\u0200;Eaj\u065a\u210c\u210e\u2110;\u6a92;\u6aa5;\u6aa4\u0200Eaes\u211b\u211d\u2129\u2134;\u6269p\u0100;p\u2123\u2124\u6a8arox\xbb\u2124\u0100;q\u212e\u212f\u6a88\u0100;q\u212e\u211bim;\u62e7pf;\uc000\ud835\udd58\u0100ci\u2143\u2146r;\u610am\u0180;el\u066b\u214e\u2150;\u6a8e;\u6a90\u8300>;cdlqr\u05ee\u2160\u216a\u216e\u2173\u2179\u0100ci\u2165\u2167;\u6aa7r;\u6a7aot;\u62d7Par;\u6995uest;\u6a7c\u0280adels\u2184\u216a\u2190\u0656\u219b\u01f0\u2189\0\u218epro\xf8\u209er;\u6978q\u0100lq\u063f\u2196les\xf3\u2088i\xed\u066b\u0100en\u21a3\u21adrtneqq;\uc000\u2269\ufe00\xc5\u21aa\u0500Aabcefkosy\u21c4\u21c7\u21f1\u21f5\u21fa\u2218\u221d\u222f\u2268\u227dr\xf2\u03a0\u0200ilmr\u21d0\u21d4\u21d7\u21dbrs\xf0\u1484f\xbb\u2024il\xf4\u06a9\u0100dr\u21e0\u21e4cy;\u444a\u0180;cw\u08f4\u21eb\u21efir;\u6948;\u61adar;\u610firc;\u4125\u0180alr\u2201\u220e\u2213rts\u0100;u\u2209\u220a\u6665it\xbb\u220alip;\u6026con;\u62b9r;\uc000\ud835\udd25s\u0100ew\u2223\u2229arow;\u6925arow;\u6926\u0280amopr\u223a\u223e\u2243\u225e\u2263rr;\u61fftht;\u623bk\u0100lr\u2249\u2253eftarrow;\u61a9ightarrow;\u61aaf;\uc000\ud835\udd59bar;\u6015\u0180clt\u226f\u2274\u2278r;\uc000\ud835\udcbdas\xe8\u21f4rok;\u4127\u0100bp\u2282\u2287ull;\u6043hen\xbb\u1c5b\u0ae1\u22a3\0\u22aa\0\u22b8\u22c5\u22ce\0\u22d5\u22f3\0\0\u22f8\u2322\u2367\u2362\u237f\0\u2386\u23aa\u23b4cute\u803b\xed\u40ed\u0180;iy\u0771\u22b0\u22b5rc\u803b\xee\u40ee;\u4438\u0100cx\u22bc\u22bfy;\u4435cl\u803b\xa1\u40a1\u0100fr\u039f\u22c9;\uc000\ud835\udd26rave\u803b\xec\u40ec\u0200;ino\u073e\u22dd\u22e9\u22ee\u0100in\u22e2\u22e6nt;\u6a0ct;\u622dfin;\u69dcta;\u6129lig;\u4133\u0180aop\u22fe\u231a\u231d\u0180cgt\u2305\u2308\u2317r;\u412b\u0180elp\u071f\u230f\u2313in\xe5\u078ear\xf4\u0720h;\u4131f;\u62b7ed;\u41b5\u0280;cfot\u04f4\u232c\u2331\u233d\u2341are;\u6105in\u0100;t\u2338\u2339\u621eie;\u69dddo\xf4\u2319\u0280;celp\u0757\u234c\u2350\u235b\u2361al;\u62ba\u0100gr\u2355\u2359er\xf3\u1563\xe3\u234darhk;\u6a17rod;\u6a3c\u0200cgpt\u236f\u2372\u2376\u237by;\u4451on;\u412ff;\uc000\ud835\udd5aa;\u43b9uest\u803b\xbf\u40bf\u0100ci\u238a\u238fr;\uc000\ud835\udcben\u0280;Edsv\u04f4\u239b\u239d\u23a1\u04f3;\u62f9ot;\u62f5\u0100;v\u23a6\u23a7\u62f4;\u62f3\u0100;i\u0777\u23aelde;\u4129\u01eb\u23b8\0\u23bccy;\u4456l\u803b\xef\u40ef\u0300cfmosu\u23cc\u23d7\u23dc\u23e1\u23e7\u23f5\u0100iy\u23d1\u23d5rc;\u4135;\u4439r;\uc000\ud835\udd27ath;\u4237pf;\uc000\ud835\udd5b\u01e3\u23ec\0\u23f1r;\uc000\ud835\udcbfrcy;\u4458kcy;\u4454\u0400acfghjos\u240b\u2416\u2422\u2427\u242d\u2431\u2435\u243bppa\u0100;v\u2413\u2414\u43ba;\u43f0\u0100ey\u241b\u2420dil;\u4137;\u443ar;\uc000\ud835\udd28reen;\u4138cy;\u4445cy;\u445cpf;\uc000\ud835\udd5ccr;\uc000\ud835\udcc0\u0b80ABEHabcdefghjlmnoprstuv\u2470\u2481\u2486\u248d\u2491\u250e\u253d\u255a\u2580\u264e\u265e\u2665\u2679\u267d\u269a\u26b2\u26d8\u275d\u2768\u278b\u27c0\u2801\u2812\u0180art\u2477\u247a\u247cr\xf2\u09c6\xf2\u0395ail;\u691barr;\u690e\u0100;g\u0994\u248b;\u6a8bar;\u6962\u0963\u24a5\0\u24aa\0\u24b1\0\0\0\0\0\u24b5\u24ba\0\u24c6\u24c8\u24cd\0\u24f9ute;\u413amptyv;\u69b4ra\xee\u084cbda;\u43bbg\u0180;dl\u088e\u24c1\u24c3;\u6991\xe5\u088e;\u6a85uo\u803b\xab\u40abr\u0400;bfhlpst\u0899\u24de\u24e6\u24e9\u24eb\u24ee\u24f1\u24f5\u0100;f\u089d\u24e3s;\u691fs;\u691d\xeb\u2252p;\u61abl;\u6939im;\u6973l;\u61a2\u0180;ae\u24ff\u2500\u2504\u6aabil;\u6919\u0100;s\u2509\u250a\u6aad;\uc000\u2aad\ufe00\u0180abr\u2515\u2519\u251drr;\u690crk;\u6772\u0100ak\u2522\u252cc\u0100ek\u2528\u252a;\u407b;\u405b\u0100es\u2531\u2533;\u698bl\u0100du\u2539\u253b;\u698f;\u698d\u0200aeuy\u2546\u254b\u2556\u2558ron;\u413e\u0100di\u2550\u2554il;\u413c\xec\u08b0\xe2\u2529;\u443b\u0200cqrs\u2563\u2566\u256d\u257da;\u6936uo\u0100;r\u0e19\u1746\u0100du\u2572\u2577har;\u6967shar;\u694bh;\u61b2\u0280;fgqs\u258b\u258c\u0989\u25f3\u25ff\u6264t\u0280ahlrt\u2598\u25a4\u25b7\u25c2\u25e8rrow\u0100;t\u0899\u25a1a\xe9\u24f6arpoon\u0100du\u25af\u25b4own\xbb\u045ap\xbb\u0966eftarrows;\u61c7ight\u0180ahs\u25cd\u25d6\u25derrow\u0100;s\u08f4\u08a7arpoon\xf3\u0f98quigarro\xf7\u21f0hreetimes;\u62cb\u0180;qs\u258b\u0993\u25falan\xf4\u09ac\u0280;cdgs\u09ac\u260a\u260d\u261d\u2628c;\u6aa8ot\u0100;o\u2614\u2615\u6a7f\u0100;r\u261a\u261b\u6a81;\u6a83\u0100;e\u2622\u2625\uc000\u22da\ufe00s;\u6a93\u0280adegs\u2633\u2639\u263d\u2649\u264bppro\xf8\u24c6ot;\u62d6q\u0100gq\u2643\u2645\xf4\u0989gt\xf2\u248c\xf4\u099bi\xed\u09b2\u0180ilr\u2655\u08e1\u265asht;\u697c;\uc000\ud835\udd29\u0100;E\u099c\u2663;\u6a91\u0161\u2669\u2676r\u0100du\u25b2\u266e\u0100;l\u0965\u2673;\u696alk;\u6584cy;\u4459\u0280;acht\u0a48\u2688\u268b\u2691\u2696r\xf2\u25c1orne\xf2\u1d08ard;\u696bri;\u65fa\u0100io\u269f\u26a4dot;\u4140ust\u0100;a\u26ac\u26ad\u63b0che\xbb\u26ad\u0200Eaes\u26bb\u26bd\u26c9\u26d4;\u6268p\u0100;p\u26c3\u26c4\u6a89rox\xbb\u26c4\u0100;q\u26ce\u26cf\u6a87\u0100;q\u26ce\u26bbim;\u62e6\u0400abnoptwz\u26e9\u26f4\u26f7\u271a\u272f\u2741\u2747\u2750\u0100nr\u26ee\u26f1g;\u67ecr;\u61fdr\xeb\u08c1g\u0180lmr\u26ff\u270d\u2714eft\u0100ar\u09e6\u2707ight\xe1\u09f2apsto;\u67fcight\xe1\u09fdparrow\u0100lr\u2725\u2729ef\xf4\u24edight;\u61ac\u0180afl\u2736\u2739\u273dr;\u6985;\uc000\ud835\udd5dus;\u6a2dimes;\u6a34\u0161\u274b\u274fst;\u6217\xe1\u134e\u0180;ef\u2757\u2758\u1800\u65cange\xbb\u2758ar\u0100;l\u2764\u2765\u4028t;\u6993\u0280achmt\u2773\u2776\u277c\u2785\u2787r\xf2\u08a8orne\xf2\u1d8car\u0100;d\u0f98\u2783;\u696d;\u600eri;\u62bf\u0300achiqt\u2798\u279d\u0a40\u27a2\u27ae\u27bbquo;\u6039r;\uc000\ud835\udcc1m\u0180;eg\u09b2\u27aa\u27ac;\u6a8d;\u6a8f\u0100bu\u252a\u27b3o\u0100;r\u0e1f\u27b9;\u601arok;\u4142\u8400<;cdhilqr\u082b\u27d2\u2639\u27dc\u27e0\u27e5\u27ea\u27f0\u0100ci\u27d7\u27d9;\u6aa6r;\u6a79re\xe5\u25f2mes;\u62c9arr;\u6976uest;\u6a7b\u0100Pi\u27f5\u27f9ar;\u6996\u0180;ef\u2800\u092d\u181b\u65c3r\u0100du\u2807\u280dshar;\u694ahar;\u6966\u0100en\u2817\u2821rtneqq;\uc000\u2268\ufe00\xc5\u281e\u0700Dacdefhilnopsu\u2840\u2845\u2882\u288e\u2893\u28a0\u28a5\u28a8\u28da\u28e2\u28e4\u0a83\u28f3\u2902Dot;\u623a\u0200clpr\u284e\u2852\u2863\u287dr\u803b\xaf\u40af\u0100et\u2857\u2859;\u6642\u0100;e\u285e\u285f\u6720se\xbb\u285f\u0100;s\u103b\u2868to\u0200;dlu\u103b\u2873\u2877\u287bow\xee\u048cef\xf4\u090f\xf0\u13d1ker;\u65ae\u0100oy\u2887\u288cmma;\u6a29;\u443cash;\u6014asuredangle\xbb\u1626r;\uc000\ud835\udd2ao;\u6127\u0180cdn\u28af\u28b4\u28c9ro\u803b\xb5\u40b5\u0200;acd\u1464\u28bd\u28c0\u28c4s\xf4\u16a7ir;\u6af0ot\u80bb\xb7\u01b5us\u0180;bd\u28d2\u1903\u28d3\u6212\u0100;u\u1d3c\u28d8;\u6a2a\u0163\u28de\u28e1p;\u6adb\xf2\u2212\xf0\u0a81\u0100dp\u28e9\u28eeels;\u62a7f;\uc000\ud835\udd5e\u0100ct\u28f8\u28fdr;\uc000\ud835\udcc2pos\xbb\u159d\u0180;lm\u2909\u290a\u290d\u43bctimap;\u62b8\u0c00GLRVabcdefghijlmoprstuvw\u2942\u2953\u297e\u2989\u2998\u29da\u29e9\u2a15\u2a1a\u2a58\u2a5d\u2a83\u2a95\u2aa4\u2aa8\u2b04\u2b07\u2b44\u2b7f\u2bae\u2c34\u2c67\u2c7c\u2ce9\u0100gt\u2947\u294b;\uc000\u22d9\u0338\u0100;v\u2950\u0bcf\uc000\u226b\u20d2\u0180elt\u295a\u2972\u2976ft\u0100ar\u2961\u2967rrow;\u61cdightarrow;\u61ce;\uc000\u22d8\u0338\u0100;v\u297b\u0c47\uc000\u226a\u20d2ightarrow;\u61cf\u0100Dd\u298e\u2993ash;\u62afash;\u62ae\u0280bcnpt\u29a3\u29a7\u29ac\u29b1\u29ccla\xbb\u02deute;\u4144g;\uc000\u2220\u20d2\u0280;Eiop\u0d84\u29bc\u29c0\u29c5\u29c8;\uc000\u2a70\u0338d;\uc000\u224b\u0338s;\u4149ro\xf8\u0d84ur\u0100;a\u29d3\u29d4\u666el\u0100;s\u29d3\u0b38\u01f3\u29df\0\u29e3p\u80bb\xa0\u0b37mp\u0100;e\u0bf9\u0c00\u0280aeouy\u29f4\u29fe\u2a03\u2a10\u2a13\u01f0\u29f9\0\u29fb;\u6a43on;\u4148dil;\u4146ng\u0100;d\u0d7e\u2a0aot;\uc000\u2a6d\u0338p;\u6a42;\u443dash;\u6013\u0380;Aadqsx\u0b92\u2a29\u2a2d\u2a3b\u2a41\u2a45\u2a50rr;\u61d7r\u0100hr\u2a33\u2a36k;\u6924\u0100;o\u13f2\u13f0ot;\uc000\u2250\u0338ui\xf6\u0b63\u0100ei\u2a4a\u2a4ear;\u6928\xed\u0b98ist\u0100;s\u0ba0\u0b9fr;\uc000\ud835\udd2b\u0200Eest\u0bc5\u2a66\u2a79\u2a7c\u0180;qs\u0bbc\u2a6d\u0be1\u0180;qs\u0bbc\u0bc5\u2a74lan\xf4\u0be2i\xed\u0bea\u0100;r\u0bb6\u2a81\xbb\u0bb7\u0180Aap\u2a8a\u2a8d\u2a91r\xf2\u2971rr;\u61aear;\u6af2\u0180;sv\u0f8d\u2a9c\u0f8c\u0100;d\u2aa1\u2aa2\u62fc;\u62facy;\u445a\u0380AEadest\u2ab7\u2aba\u2abe\u2ac2\u2ac5\u2af6\u2af9r\xf2\u2966;\uc000\u2266\u0338rr;\u619ar;\u6025\u0200;fqs\u0c3b\u2ace\u2ae3\u2aeft\u0100ar\u2ad4\u2ad9rro\xf7\u2ac1ightarro\xf7\u2a90\u0180;qs\u0c3b\u2aba\u2aealan\xf4\u0c55\u0100;s\u0c55\u2af4\xbb\u0c36i\xed\u0c5d\u0100;r\u0c35\u2afei\u0100;e\u0c1a\u0c25i\xe4\u0d90\u0100pt\u2b0c\u2b11f;\uc000\ud835\udd5f\u8180\xac;in\u2b19\u2b1a\u2b36\u40acn\u0200;Edv\u0b89\u2b24\u2b28\u2b2e;\uc000\u22f9\u0338ot;\uc000\u22f5\u0338\u01e1\u0b89\u2b33\u2b35;\u62f7;\u62f6i\u0100;v\u0cb8\u2b3c\u01e1\u0cb8\u2b41\u2b43;\u62fe;\u62fd\u0180aor\u2b4b\u2b63\u2b69r\u0200;ast\u0b7b\u2b55\u2b5a\u2b5flle\xec\u0b7bl;\uc000\u2afd\u20e5;\uc000\u2202\u0338lint;\u6a14\u0180;ce\u0c92\u2b70\u2b73u\xe5\u0ca5\u0100;c\u0c98\u2b78\u0100;e\u0c92\u2b7d\xf1\u0c98\u0200Aait\u2b88\u2b8b\u2b9d\u2ba7r\xf2\u2988rr\u0180;cw\u2b94\u2b95\u2b99\u619b;\uc000\u2933\u0338;\uc000\u219d\u0338ghtarrow\xbb\u2b95ri\u0100;e\u0ccb\u0cd6\u0380chimpqu\u2bbd\u2bcd\u2bd9\u2b04\u0b78\u2be4\u2bef\u0200;cer\u0d32\u2bc6\u0d37\u2bc9u\xe5\u0d45;\uc000\ud835\udcc3ort\u026d\u2b05\0\0\u2bd6ar\xe1\u2b56m\u0100;e\u0d6e\u2bdf\u0100;q\u0d74\u0d73su\u0100bp\u2beb\u2bed\xe5\u0cf8\xe5\u0d0b\u0180bcp\u2bf6\u2c11\u2c19\u0200;Ees\u2bff\u2c00\u0d22\u2c04\u6284;\uc000\u2ac5\u0338et\u0100;e\u0d1b\u2c0bq\u0100;q\u0d23\u2c00c\u0100;e\u0d32\u2c17\xf1\u0d38\u0200;Ees\u2c22\u2c23\u0d5f\u2c27\u6285;\uc000\u2ac6\u0338et\u0100;e\u0d58\u2c2eq\u0100;q\u0d60\u2c23\u0200gilr\u2c3d\u2c3f\u2c45\u2c47\xec\u0bd7lde\u803b\xf1\u40f1\xe7\u0c43iangle\u0100lr\u2c52\u2c5ceft\u0100;e\u0c1a\u2c5a\xf1\u0c26ight\u0100;e\u0ccb\u2c65\xf1\u0cd7\u0100;m\u2c6c\u2c6d\u43bd\u0180;es\u2c74\u2c75\u2c79\u4023ro;\u6116p;\u6007\u0480DHadgilrs\u2c8f\u2c94\u2c99\u2c9e\u2ca3\u2cb0\u2cb6\u2cd3\u2ce3ash;\u62adarr;\u6904p;\uc000\u224d\u20d2ash;\u62ac\u0100et\u2ca8\u2cac;\uc000\u2265\u20d2;\uc000>\u20d2nfin;\u69de\u0180Aet\u2cbd\u2cc1\u2cc5rr;\u6902;\uc000\u2264\u20d2\u0100;r\u2cca\u2ccd\uc000<\u20d2ie;\uc000\u22b4\u20d2\u0100At\u2cd8\u2cdcrr;\u6903rie;\uc000\u22b5\u20d2im;\uc000\u223c\u20d2\u0180Aan\u2cf0\u2cf4\u2d02rr;\u61d6r\u0100hr\u2cfa\u2cfdk;\u6923\u0100;o\u13e7\u13e5ear;\u6927\u1253\u1a95\0\0\0\0\0\0\0\0\0\0\0\0\0\u2d2d\0\u2d38\u2d48\u2d60\u2d65\u2d72\u2d84\u1b07\0\0\u2d8d\u2dab\0\u2dc8\u2dce\0\u2ddc\u2e19\u2e2b\u2e3e\u2e43\u0100cs\u2d31\u1a97ute\u803b\xf3\u40f3\u0100iy\u2d3c\u2d45r\u0100;c\u1a9e\u2d42\u803b\xf4\u40f4;\u443e\u0280abios\u1aa0\u2d52\u2d57\u01c8\u2d5alac;\u4151v;\u6a38old;\u69bclig;\u4153\u0100cr\u2d69\u2d6dir;\u69bf;\uc000\ud835\udd2c\u036f\u2d79\0\0\u2d7c\0\u2d82n;\u42dbave\u803b\xf2\u40f2;\u69c1\u0100bm\u2d88\u0df4ar;\u69b5\u0200acit\u2d95\u2d98\u2da5\u2da8r\xf2\u1a80\u0100ir\u2d9d\u2da0r;\u69beoss;\u69bbn\xe5\u0e52;\u69c0\u0180aei\u2db1\u2db5\u2db9cr;\u414dga;\u43c9\u0180cdn\u2dc0\u2dc5\u01cdron;\u43bf;\u69b6pf;\uc000\ud835\udd60\u0180ael\u2dd4\u2dd7\u01d2r;\u69b7rp;\u69b9\u0380;adiosv\u2dea\u2deb\u2dee\u2e08\u2e0d\u2e10\u2e16\u6228r\xf2\u1a86\u0200;efm\u2df7\u2df8\u2e02\u2e05\u6a5dr\u0100;o\u2dfe\u2dff\u6134f\xbb\u2dff\u803b\xaa\u40aa\u803b\xba\u40bagof;\u62b6r;\u6a56lope;\u6a57;\u6a5b\u0180clo\u2e1f\u2e21\u2e27\xf2\u2e01ash\u803b\xf8\u40f8l;\u6298i\u016c\u2e2f\u2e34de\u803b\xf5\u40f5es\u0100;a\u01db\u2e3as;\u6a36ml\u803b\xf6\u40f6bar;\u633d\u0ae1\u2e5e\0\u2e7d\0\u2e80\u2e9d\0\u2ea2\u2eb9\0\0\u2ecb\u0e9c\0\u2f13\0\0\u2f2b\u2fbc\0\u2fc8r\u0200;ast\u0403\u2e67\u2e72\u0e85\u8100\xb6;l\u2e6d\u2e6e\u40b6le\xec\u0403\u0269\u2e78\0\0\u2e7bm;\u6af3;\u6afdy;\u443fr\u0280cimpt\u2e8b\u2e8f\u2e93\u1865\u2e97nt;\u4025od;\u402eil;\u6030enk;\u6031r;\uc000\ud835\udd2d\u0180imo\u2ea8\u2eb0\u2eb4\u0100;v\u2ead\u2eae\u43c6;\u43d5ma\xf4\u0a76ne;\u660e\u0180;tv\u2ebf\u2ec0\u2ec8\u43c0chfork\xbb\u1ffd;\u43d6\u0100au\u2ecf\u2edfn\u0100ck\u2ed5\u2eddk\u0100;h\u21f4\u2edb;\u610e\xf6\u21f4s\u0480;abcdemst\u2ef3\u2ef4\u1908\u2ef9\u2efd\u2f04\u2f06\u2f0a\u2f0e\u402bcir;\u6a23ir;\u6a22\u0100ou\u1d40\u2f02;\u6a25;\u6a72n\u80bb\xb1\u0e9dim;\u6a26wo;\u6a27\u0180ipu\u2f19\u2f20\u2f25ntint;\u6a15f;\uc000\ud835\udd61nd\u803b\xa3\u40a3\u0500;Eaceinosu\u0ec8\u2f3f\u2f41\u2f44\u2f47\u2f81\u2f89\u2f92\u2f7e\u2fb6;\u6ab3p;\u6ab7u\xe5\u0ed9\u0100;c\u0ece\u2f4c\u0300;acens\u0ec8\u2f59\u2f5f\u2f66\u2f68\u2f7eppro\xf8\u2f43urlye\xf1\u0ed9\xf1\u0ece\u0180aes\u2f6f\u2f76\u2f7approx;\u6ab9qq;\u6ab5im;\u62e8i\xed\u0edfme\u0100;s\u2f88\u0eae\u6032\u0180Eas\u2f78\u2f90\u2f7a\xf0\u2f75\u0180dfp\u0eec\u2f99\u2faf\u0180als\u2fa0\u2fa5\u2faalar;\u632eine;\u6312urf;\u6313\u0100;t\u0efb\u2fb4\xef\u0efbrel;\u62b0\u0100ci\u2fc0\u2fc5r;\uc000\ud835\udcc5;\u43c8ncsp;\u6008\u0300fiopsu\u2fda\u22e2\u2fdf\u2fe5\u2feb\u2ff1r;\uc000\ud835\udd2epf;\uc000\ud835\udd62rime;\u6057cr;\uc000\ud835\udcc6\u0180aeo\u2ff8\u3009\u3013t\u0100ei\u2ffe\u3005rnion\xf3\u06b0nt;\u6a16st\u0100;e\u3010\u3011\u403f\xf1\u1f19\xf4\u0f14\u0a80ABHabcdefhilmnoprstux\u3040\u3051\u3055\u3059\u30e0\u310e\u312b\u3147\u3162\u3172\u318e\u3206\u3215\u3224\u3229\u3258\u326e\u3272\u3290\u32b0\u32b7\u0180art\u3047\u304a\u304cr\xf2\u10b3\xf2\u03ddail;\u691car\xf2\u1c65ar;\u6964\u0380cdenqrt\u3068\u3075\u3078\u307f\u308f\u3094\u30cc\u0100eu\u306d\u3071;\uc000\u223d\u0331te;\u4155i\xe3\u116emptyv;\u69b3g\u0200;del\u0fd1\u3089\u308b\u308d;\u6992;\u69a5\xe5\u0fd1uo\u803b\xbb\u40bbr\u0580;abcfhlpstw\u0fdc\u30ac\u30af\u30b7\u30b9\u30bc\u30be\u30c0\u30c3\u30c7\u30cap;\u6975\u0100;f\u0fe0\u30b4s;\u6920;\u6933s;\u691e\xeb\u225d\xf0\u272el;\u6945im;\u6974l;\u61a3;\u619d\u0100ai\u30d1\u30d5il;\u691ao\u0100;n\u30db\u30dc\u6236al\xf3\u0f1e\u0180abr\u30e7\u30ea\u30eer\xf2\u17e5rk;\u6773\u0100ak\u30f3\u30fdc\u0100ek\u30f9\u30fb;\u407d;\u405d\u0100es\u3102\u3104;\u698cl\u0100du\u310a\u310c;\u698e;\u6990\u0200aeuy\u3117\u311c\u3127\u3129ron;\u4159\u0100di\u3121\u3125il;\u4157\xec\u0ff2\xe2\u30fa;\u4440\u0200clqs\u3134\u3137\u313d\u3144a;\u6937dhar;\u6969uo\u0100;r\u020e\u020dh;\u61b3\u0180acg\u314e\u315f\u0f44l\u0200;ips\u0f78\u3158\u315b\u109cn\xe5\u10bbar\xf4\u0fa9t;\u65ad\u0180ilr\u3169\u1023\u316esht;\u697d;\uc000\ud835\udd2f\u0100ao\u3177\u3186r\u0100du\u317d\u317f\xbb\u047b\u0100;l\u1091\u3184;\u696c\u0100;v\u318b\u318c\u43c1;\u43f1\u0180gns\u3195\u31f9\u31fcht\u0300ahlrst\u31a4\u31b0\u31c2\u31d8\u31e4\u31eerrow\u0100;t\u0fdc\u31ada\xe9\u30c8arpoon\u0100du\u31bb\u31bfow\xee\u317ep\xbb\u1092eft\u0100ah\u31ca\u31d0rrow\xf3\u0feaarpoon\xf3\u0551ightarrows;\u61c9quigarro\xf7\u30cbhreetimes;\u62ccg;\u42daingdotse\xf1\u1f32\u0180ahm\u320d\u3210\u3213r\xf2\u0feaa\xf2\u0551;\u600foust\u0100;a\u321e\u321f\u63b1che\xbb\u321fmid;\u6aee\u0200abpt\u3232\u323d\u3240\u3252\u0100nr\u3237\u323ag;\u67edr;\u61fer\xeb\u1003\u0180afl\u3247\u324a\u324er;\u6986;\uc000\ud835\udd63us;\u6a2eimes;\u6a35\u0100ap\u325d\u3267r\u0100;g\u3263\u3264\u4029t;\u6994olint;\u6a12ar\xf2\u31e3\u0200achq\u327b\u3280\u10bc\u3285quo;\u603ar;\uc000\ud835\udcc7\u0100bu\u30fb\u328ao\u0100;r\u0214\u0213\u0180hir\u3297\u329b\u32a0re\xe5\u31f8mes;\u62cai\u0200;efl\u32aa\u1059\u1821\u32ab\u65b9tri;\u69celuhar;\u6968;\u611e\u0d61\u32d5\u32db\u32df\u332c\u3338\u3371\0\u337a\u33a4\0\0\u33ec\u33f0\0\u3428\u3448\u345a\u34ad\u34b1\u34ca\u34f1\0\u3616\0\0\u3633cute;\u415bqu\xef\u27ba\u0500;Eaceinpsy\u11ed\u32f3\u32f5\u32ff\u3302\u330b\u330f\u331f\u3326\u3329;\u6ab4\u01f0\u32fa\0\u32fc;\u6ab8on;\u4161u\xe5\u11fe\u0100;d\u11f3\u3307il;\u415frc;\u415d\u0180Eas\u3316\u3318\u331b;\u6ab6p;\u6abaim;\u62e9olint;\u6a13i\xed\u1204;\u4441ot\u0180;be\u3334\u1d47\u3335\u62c5;\u6a66\u0380Aacmstx\u3346\u334a\u3357\u335b\u335e\u3363\u336drr;\u61d8r\u0100hr\u3350\u3352\xeb\u2228\u0100;o\u0a36\u0a34t\u803b\xa7\u40a7i;\u403bwar;\u6929m\u0100in\u3369\xf0nu\xf3\xf1t;\u6736r\u0100;o\u3376\u2055\uc000\ud835\udd30\u0200acoy\u3382\u3386\u3391\u33a0rp;\u666f\u0100hy\u338b\u338fcy;\u4449;\u4448rt\u026d\u3399\0\0\u339ci\xe4\u1464ara\xec\u2e6f\u803b\xad\u40ad\u0100gm\u33a8\u33b4ma\u0180;fv\u33b1\u33b2\u33b2\u43c3;\u43c2\u0400;deglnpr\u12ab\u33c5\u33c9\u33ce\u33d6\u33de\u33e1\u33e6ot;\u6a6a\u0100;q\u12b1\u12b0\u0100;E\u33d3\u33d4\u6a9e;\u6aa0\u0100;E\u33db\u33dc\u6a9d;\u6a9fe;\u6246lus;\u6a24arr;\u6972ar\xf2\u113d\u0200aeit\u33f8\u3408\u340f\u3417\u0100ls\u33fd\u3404lsetm\xe9\u336ahp;\u6a33parsl;\u69e4\u0100dl\u1463\u3414e;\u6323\u0100;e\u341c\u341d\u6aaa\u0100;s\u3422\u3423\u6aac;\uc000\u2aac\ufe00\u0180flp\u342e\u3433\u3442tcy;\u444c\u0100;b\u3438\u3439\u402f\u0100;a\u343e\u343f\u69c4r;\u633ff;\uc000\ud835\udd64a\u0100dr\u344d\u0402es\u0100;u\u3454\u3455\u6660it\xbb\u3455\u0180csu\u3460\u3479\u349f\u0100au\u3465\u346fp\u0100;s\u1188\u346b;\uc000\u2293\ufe00p\u0100;s\u11b4\u3475;\uc000\u2294\ufe00u\u0100bp\u347f\u348f\u0180;es\u1197\u119c\u3486et\u0100;e\u1197\u348d\xf1\u119d\u0180;es\u11a8\u11ad\u3496et\u0100;e\u11a8\u349d\xf1\u11ae\u0180;af\u117b\u34a6\u05b0r\u0165\u34ab\u05b1\xbb\u117car\xf2\u1148\u0200cemt\u34b9\u34be\u34c2\u34c5r;\uc000\ud835\udcc8tm\xee\xf1i\xec\u3415ar\xe6\u11be\u0100ar\u34ce\u34d5r\u0100;f\u34d4\u17bf\u6606\u0100an\u34da\u34edight\u0100ep\u34e3\u34eapsilo\xee\u1ee0h\xe9\u2eafs\xbb\u2852\u0280bcmnp\u34fb\u355e\u1209\u358b\u358e\u0480;Edemnprs\u350e\u350f\u3511\u3515\u351e\u3523\u352c\u3531\u3536\u6282;\u6ac5ot;\u6abd\u0100;d\u11da\u351aot;\u6ac3ult;\u6ac1\u0100Ee\u3528\u352a;\u6acb;\u628alus;\u6abfarr;\u6979\u0180eiu\u353d\u3552\u3555t\u0180;en\u350e\u3545\u354bq\u0100;q\u11da\u350feq\u0100;q\u352b\u3528m;\u6ac7\u0100bp\u355a\u355c;\u6ad5;\u6ad3c\u0300;acens\u11ed\u356c\u3572\u3579\u357b\u3326ppro\xf8\u32faurlye\xf1\u11fe\xf1\u11f3\u0180aes\u3582\u3588\u331bppro\xf8\u331aq\xf1\u3317g;\u666a\u0680123;Edehlmnps\u35a9\u35ac\u35af\u121c\u35b2\u35b4\u35c0\u35c9\u35d5\u35da\u35df\u35e8\u35ed\u803b\xb9\u40b9\u803b\xb2\u40b2\u803b\xb3\u40b3;\u6ac6\u0100os\u35b9\u35bct;\u6abeub;\u6ad8\u0100;d\u1222\u35c5ot;\u6ac4s\u0100ou\u35cf\u35d2l;\u67c9b;\u6ad7arr;\u697bult;\u6ac2\u0100Ee\u35e4\u35e6;\u6acc;\u628blus;\u6ac0\u0180eiu\u35f4\u3609\u360ct\u0180;en\u121c\u35fc\u3602q\u0100;q\u1222\u35b2eq\u0100;q\u35e7\u35e4m;\u6ac8\u0100bp\u3611\u3613;\u6ad4;\u6ad6\u0180Aan\u361c\u3620\u362drr;\u61d9r\u0100hr\u3626\u3628\xeb\u222e\u0100;o\u0a2b\u0a29war;\u692alig\u803b\xdf\u40df\u0be1\u3651\u365d\u3660\u12ce\u3673\u3679\0\u367e\u36c2\0\0\0\0\0\u36db\u3703\0\u3709\u376c\0\0\0\u3787\u0272\u3656\0\0\u365bget;\u6316;\u43c4r\xeb\u0e5f\u0180aey\u3666\u366b\u3670ron;\u4165dil;\u4163;\u4442lrec;\u6315r;\uc000\ud835\udd31\u0200eiko\u3686\u369d\u36b5\u36bc\u01f2\u368b\0\u3691e\u01004f\u1284\u1281a\u0180;sv\u3698\u3699\u369b\u43b8ym;\u43d1\u0100cn\u36a2\u36b2k\u0100as\u36a8\u36aeppro\xf8\u12c1im\xbb\u12acs\xf0\u129e\u0100as\u36ba\u36ae\xf0\u12c1rn\u803b\xfe\u40fe\u01ec\u031f\u36c6\u22e7es\u8180\xd7;bd\u36cf\u36d0\u36d8\u40d7\u0100;a\u190f\u36d5r;\u6a31;\u6a30\u0180eps\u36e1\u36e3\u3700\xe1\u2a4d\u0200;bcf\u0486\u36ec\u36f0\u36f4ot;\u6336ir;\u6af1\u0100;o\u36f9\u36fc\uc000\ud835\udd65rk;\u6ada\xe1\u3362rime;\u6034\u0180aip\u370f\u3712\u3764d\xe5\u1248\u0380adempst\u3721\u374d\u3740\u3751\u3757\u375c\u375fngle\u0280;dlqr\u3730\u3731\u3736\u3740\u3742\u65b5own\xbb\u1dbbeft\u0100;e\u2800\u373e\xf1\u092e;\u625cight\u0100;e\u32aa\u374b\xf1\u105aot;\u65ecinus;\u6a3alus;\u6a39b;\u69cdime;\u6a3bezium;\u63e2\u0180cht\u3772\u377d\u3781\u0100ry\u3777\u377b;\uc000\ud835\udcc9;\u4446cy;\u445brok;\u4167\u0100io\u378b\u378ex\xf4\u1777head\u0100lr\u3797\u37a0eftarro\xf7\u084fightarrow\xbb\u0f5d\u0900AHabcdfghlmoprstuw\u37d0\u37d3\u37d7\u37e4\u37f0\u37fc\u380e\u381c\u3823\u3834\u3851\u385d\u386b\u38a9\u38cc\u38d2\u38ea\u38f6r\xf2\u03edar;\u6963\u0100cr\u37dc\u37e2ute\u803b\xfa\u40fa\xf2\u1150r\u01e3\u37ea\0\u37edy;\u445eve;\u416d\u0100iy\u37f5\u37farc\u803b\xfb\u40fb;\u4443\u0180abh\u3803\u3806\u380br\xf2\u13adlac;\u4171a\xf2\u13c3\u0100ir\u3813\u3818sht;\u697e;\uc000\ud835\udd32rave\u803b\xf9\u40f9\u0161\u3827\u3831r\u0100lr\u382c\u382e\xbb\u0957\xbb\u1083lk;\u6580\u0100ct\u3839\u384d\u026f\u383f\0\0\u384arn\u0100;e\u3845\u3846\u631cr\xbb\u3846op;\u630fri;\u65f8\u0100al\u3856\u385acr;\u416b\u80bb\xa8\u0349\u0100gp\u3862\u3866on;\u4173f;\uc000\ud835\udd66\u0300adhlsu\u114b\u3878\u387d\u1372\u3891\u38a0own\xe1\u13b3arpoon\u0100lr\u3888\u388cef\xf4\u382digh\xf4\u382fi\u0180;hl\u3899\u389a\u389c\u43c5\xbb\u13faon\xbb\u389aparrows;\u61c8\u0180cit\u38b0\u38c4\u38c8\u026f\u38b6\0\0\u38c1rn\u0100;e\u38bc\u38bd\u631dr\xbb\u38bdop;\u630eng;\u416fri;\u65f9cr;\uc000\ud835\udcca\u0180dir\u38d9\u38dd\u38e2ot;\u62f0lde;\u4169i\u0100;f\u3730\u38e8\xbb\u1813\u0100am\u38ef\u38f2r\xf2\u38a8l\u803b\xfc\u40fcangle;\u69a7\u0780ABDacdeflnoprsz\u391c\u391f\u3929\u392d\u39b5\u39b8\u39bd\u39df\u39e4\u39e8\u39f3\u39f9\u39fd\u3a01\u3a20r\xf2\u03f7ar\u0100;v\u3926\u3927\u6ae8;\u6ae9as\xe8\u03e1\u0100nr\u3932\u3937grt;\u699c\u0380eknprst\u34e3\u3946\u394b\u3952\u395d\u3964\u3996app\xe1\u2415othin\xe7\u1e96\u0180hir\u34eb\u2ec8\u3959op\xf4\u2fb5\u0100;h\u13b7\u3962\xef\u318d\u0100iu\u3969\u396dgm\xe1\u33b3\u0100bp\u3972\u3984setneq\u0100;q\u397d\u3980\uc000\u228a\ufe00;\uc000\u2acb\ufe00setneq\u0100;q\u398f\u3992\uc000\u228b\ufe00;\uc000\u2acc\ufe00\u0100hr\u399b\u399fet\xe1\u369ciangle\u0100lr\u39aa\u39afeft\xbb\u0925ight\xbb\u1051y;\u4432ash\xbb\u1036\u0180elr\u39c4\u39d2\u39d7\u0180;be\u2dea\u39cb\u39cfar;\u62bbq;\u625alip;\u62ee\u0100bt\u39dc\u1468a\xf2\u1469r;\uc000\ud835\udd33tr\xe9\u39aesu\u0100bp\u39ef\u39f1\xbb\u0d1c\xbb\u0d59pf;\uc000\ud835\udd67ro\xf0\u0efbtr\xe9\u39b4\u0100cu\u3a06\u3a0br;\uc000\ud835\udccb\u0100bp\u3a10\u3a18n\u0100Ee\u3980\u3a16\xbb\u397en\u0100Ee\u3992\u3a1e\xbb\u3990igzag;\u699a\u0380cefoprs\u3a36\u3a3b\u3a56\u3a5b\u3a54\u3a61\u3a6airc;\u4175\u0100di\u3a40\u3a51\u0100bg\u3a45\u3a49ar;\u6a5fe\u0100;q\u15fa\u3a4f;\u6259erp;\u6118r;\uc000\ud835\udd34pf;\uc000\ud835\udd68\u0100;e\u1479\u3a66at\xe8\u1479cr;\uc000\ud835\udccc\u0ae3\u178e\u3a87\0\u3a8b\0\u3a90\u3a9b\0\0\u3a9d\u3aa8\u3aab\u3aaf\0\0\u3ac3\u3ace\0\u3ad8\u17dc\u17dftr\xe9\u17d1r;\uc000\ud835\udd35\u0100Aa\u3a94\u3a97r\xf2\u03c3r\xf2\u09f6;\u43be\u0100Aa\u3aa1\u3aa4r\xf2\u03b8r\xf2\u09eba\xf0\u2713is;\u62fb\u0180dpt\u17a4\u3ab5\u3abe\u0100fl\u3aba\u17a9;\uc000\ud835\udd69im\xe5\u17b2\u0100Aa\u3ac7\u3acar\xf2\u03cer\xf2\u0a01\u0100cq\u3ad2\u17b8r;\uc000\ud835\udccd\u0100pt\u17d6\u3adcr\xe9\u17d4\u0400acefiosu\u3af0\u3afd\u3b08\u3b0c\u3b11\u3b15\u3b1b\u3b21c\u0100uy\u3af6\u3afbte\u803b\xfd\u40fd;\u444f\u0100iy\u3b02\u3b06rc;\u4177;\u444bn\u803b\xa5\u40a5r;\uc000\ud835\udd36cy;\u4457pf;\uc000\ud835\udd6acr;\uc000\ud835\udcce\u0100cm\u3b26\u3b29y;\u444el\u803b\xff\u40ff\u0500acdefhiosw\u3b42\u3b48\u3b54\u3b58\u3b64\u3b69\u3b6d\u3b74\u3b7a\u3b80cute;\u417a\u0100ay\u3b4d\u3b52ron;\u417e;\u4437ot;\u417c\u0100et\u3b5d\u3b61tr\xe6\u155fa;\u43b6r;\uc000\ud835\udd37cy;\u4436grarr;\u61ddpf;\uc000\ud835\udd6bcr;\uc000\ud835\udccf\u0100jn\u3b85\u3b87;\u600dj;\u600c".
  split("").
  map((c) => c.charCodeAt(0))
);

// Adapted from https://github.com/mathiasbynens/he/blob/36afe179392226cf1b6ccdb16ebbb7a5a844d93a/src/he.js#L106-L134
const decodeMap = new Map([
  [0, 65533],
  // C1 Unicode control character reference replacements
  [128, 8364],
  [130, 8218],
  [131, 402],
  [132, 8222],
  [133, 8230],
  [134, 8224],
  [135, 8225],
  [136, 710],
  [137, 8240],
  [138, 352],
  [139, 8249],
  [140, 338],
  [142, 381],
  [145, 8216],
  [146, 8217],
  [147, 8220],
  [148, 8221],
  [149, 8226],
  [150, 8211],
  [151, 8212],
  [152, 732],
  [153, 8482],
  [154, 353],
  [155, 8250],
  [156, 339],
  [158, 382],
  [159, 376]
]);
/**
 * Replace the given code point with a replacement character if it is a
 * surrogate or is outside the valid range. Otherwise return the code
 * point unchanged.
 */
function replaceCodePoint(codePoint) {
  var _a;
  if ((codePoint >= 55296 && codePoint <= 57343) || codePoint > 1114111) {
    return 65533;
  }
  return (_a = decodeMap.get(codePoint)) !== null && _a !== void 0 ? _a : codePoint;
}

var CharCodes;
(function (CharCodes) {
  CharCodes[(CharCodes["NUM"] = 35)] = "NUM";
  CharCodes[(CharCodes["SEMI"] = 59)] = "SEMI";
  CharCodes[(CharCodes["EQUALS"] = 61)] = "EQUALS";
  CharCodes[(CharCodes["ZERO"] = 48)] = "ZERO";
  CharCodes[(CharCodes["NINE"] = 57)] = "NINE";
  CharCodes[(CharCodes["LOWER_A"] = 97)] = "LOWER_A";
  CharCodes[(CharCodes["LOWER_F"] = 102)] = "LOWER_F";
  CharCodes[(CharCodes["LOWER_X"] = 120)] = "LOWER_X";
  CharCodes[(CharCodes["LOWER_Z"] = 122)] = "LOWER_Z";
  CharCodes[(CharCodes["UPPER_A"] = 65)] = "UPPER_A";
  CharCodes[(CharCodes["UPPER_F"] = 70)] = "UPPER_F";
  CharCodes[(CharCodes["UPPER_Z"] = 90)] = "UPPER_Z";
})(CharCodes || (CharCodes = {}));
/** Bit that needs to be set to convert an upper case ASCII character to lower case */
const TO_LOWER_BIT = 32;
var BinTrieFlags;
(function (BinTrieFlags) {
  BinTrieFlags[(BinTrieFlags["VALUE_LENGTH"] = 49152)] = "VALUE_LENGTH";
  BinTrieFlags[(BinTrieFlags["BRANCH_LENGTH"] = 16256)] = "BRANCH_LENGTH";
  BinTrieFlags[(BinTrieFlags["JUMP_TABLE"] = 127)] = "JUMP_TABLE";
})(BinTrieFlags || (BinTrieFlags = {}));
function isNumber(code) {
  return code >= CharCodes.ZERO && code <= CharCodes.NINE;
}
function isHexadecimalCharacter(code) {
  return (
    (code >= CharCodes.UPPER_A && code <= CharCodes.UPPER_F) ||
    (code >= CharCodes.LOWER_A && code <= CharCodes.LOWER_F)
  );
}
function isAsciiAlphaNumeric$1(code) {
  return (
    (code >= CharCodes.UPPER_A && code <= CharCodes.UPPER_Z) ||
    (code >= CharCodes.LOWER_A && code <= CharCodes.LOWER_Z) ||
    isNumber(code)
  );
}
/**
 * Checks if the given character is a valid end character for an entity in an attribute.
 *
 * Attribute values that aren't terminated properly aren't parsed, and shouldn't lead to a parser error.
 * See the example in https://html.spec.whatwg.org/multipage/parsing.html#named-character-reference-state
 */
function isEntityInAttributeInvalidEnd(code) {
  return code === CharCodes.EQUALS || isAsciiAlphaNumeric$1(code);
}
var EntityDecoderState;
(function (EntityDecoderState) {
  EntityDecoderState[(EntityDecoderState["EntityStart"] = 0)] = "EntityStart";
  EntityDecoderState[(EntityDecoderState["NumericStart"] = 1)] = "NumericStart";
  EntityDecoderState[(EntityDecoderState["NumericDecimal"] = 2)] = "NumericDecimal";
  EntityDecoderState[(EntityDecoderState["NumericHex"] = 3)] = "NumericHex";
  EntityDecoderState[(EntityDecoderState["NamedEntity"] = 4)] = "NamedEntity";
})(EntityDecoderState || (EntityDecoderState = {}));
var DecodingMode;
(function (DecodingMode) {
  /** Entities in text nodes that can end with any character. */
  DecodingMode[(DecodingMode["Legacy"] = 0)] = "Legacy";
  /** Only allow entities terminated with a semicolon. */
  DecodingMode[(DecodingMode["Strict"] = 1)] = "Strict";
  /** Entities in attributes have limitations on ending characters. */
  DecodingMode[(DecodingMode["Attribute"] = 2)] = "Attribute";
})(DecodingMode || (DecodingMode = {}));
/**
 * Token decoder with support of writing partial entities.
 */
class EntityDecoder {
  constructor(
    /** The tree used to decode entities. */
    decodeTree,
    /**
     * The function that is called when a codepoint is decoded.
     *
     * For multi-byte named entities, this will be called multiple times,
     * with the second codepoint, and the same `consumed` value.
     *
     * @param codepoint The decoded codepoint.
     * @param consumed The number of bytes consumed by the decoder.
     */
    emitCodePoint,
    /** An object that is used to produce errors. */
    errors
  ) {
    this.decodeTree = decodeTree;
    this.emitCodePoint = emitCodePoint;
    this.errors = errors;
    /** The current state of the decoder. */
    this.state = EntityDecoderState.EntityStart;
    /** Characters that were consumed while parsing an entity. */
    this.consumed = 1;
    /**
     * The result of the entity.
     *
     * Either the result index of a numeric entity, or the codepoint of a
     * numeric entity.
     */
    this.result = 0;
    /** The current index in the decode tree. */
    this.treeIndex = 0;
    /** The number of characters that were consumed in excess. */
    this.excess = 1;
    /** The mode in which the decoder is operating. */
    this.decodeMode = DecodingMode.Strict;
  }
  /** Resets the instance to make it reusable. */
  startEntity(decodeMode) {
    this.decodeMode = decodeMode;
    this.state = EntityDecoderState.EntityStart;
    this.result = 0;
    this.treeIndex = 0;
    this.excess = 1;
    this.consumed = 1;
  }
  /**
   * Write an entity to the decoder. This can be called multiple times with partial entities.
   * If the entity is incomplete, the decoder will return -1.
   *
   * Mirrors the implementation of `getDecoder`, but with the ability to stop decoding if the
   * entity is incomplete, and resume when the next string is written.
   *
   * @param input The string containing the entity (or a continuation of the entity).
   * @param offset The offset at which the entity begins. Should be 0 if this is not the first call.
   * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
   */
  write(input, offset) {
    switch (this.state) {
      case EntityDecoderState.EntityStart: {
        if (input.charCodeAt(offset) === CharCodes.NUM) {
          this.state = EntityDecoderState.NumericStart;
          this.consumed += 1;
          return this.stateNumericStart(input, offset + 1);
        }
        this.state = EntityDecoderState.NamedEntity;
        return this.stateNamedEntity(input, offset);
      }
      case EntityDecoderState.NumericStart: {
        return this.stateNumericStart(input, offset);
      }
      case EntityDecoderState.NumericDecimal: {
        return this.stateNumericDecimal(input, offset);
      }
      case EntityDecoderState.NumericHex: {
        return this.stateNumericHex(input, offset);
      }
      case EntityDecoderState.NamedEntity: {
        return this.stateNamedEntity(input, offset);
      }
    }
  }
  /**
   * Switches between the numeric decimal and hexadecimal states.
   *
   * Equivalent to the `Numeric character reference state` in the HTML spec.
   *
   * @param input The string containing the entity (or a continuation of the entity).
   * @param offset The current offset.
   * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
   */
  stateNumericStart(input, offset) {
    if (offset >= input.length) {
      return -1;
    }
    if ((input.charCodeAt(offset) | TO_LOWER_BIT) === CharCodes.LOWER_X) {
      this.state = EntityDecoderState.NumericHex;
      this.consumed += 1;
      return this.stateNumericHex(input, offset + 1);
    }
    this.state = EntityDecoderState.NumericDecimal;
    return this.stateNumericDecimal(input, offset);
  }
  addToNumericResult(input, start, end, base) {
    if (start !== end) {
      const digitCount = end - start;
      this.result =
        this.result * Math.pow(base, digitCount) +
        Number.parseInt(input.substr(start, digitCount), base);
      this.consumed += digitCount;
    }
  }
  /**
   * Parses a hexadecimal numeric entity.
   *
   * Equivalent to the `Hexademical character reference state` in the HTML spec.
   *
   * @param input The string containing the entity (or a continuation of the entity).
   * @param offset The current offset.
   * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
   */
  stateNumericHex(input, offset) {
    const startIndex = offset;
    while (offset < input.length) {
      const char = input.charCodeAt(offset);
      if (isNumber(char) || isHexadecimalCharacter(char)) {
        offset += 1;
      } else {
        this.addToNumericResult(input, startIndex, offset, 16);
        return this.emitNumericEntity(char, 3);
      }
    }
    this.addToNumericResult(input, startIndex, offset, 16);
    return -1;
  }
  /**
   * Parses a decimal numeric entity.
   *
   * Equivalent to the `Decimal character reference state` in the HTML spec.
   *
   * @param input The string containing the entity (or a continuation of the entity).
   * @param offset The current offset.
   * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
   */
  stateNumericDecimal(input, offset) {
    const startIndex = offset;
    while (offset < input.length) {
      const char = input.charCodeAt(offset);
      if (isNumber(char)) {
        offset += 1;
      } else {
        this.addToNumericResult(input, startIndex, offset, 10);
        return this.emitNumericEntity(char, 2);
      }
    }
    this.addToNumericResult(input, startIndex, offset, 10);
    return -1;
  }
  /**
   * Validate and emit a numeric entity.
   *
   * Implements the logic from the `Hexademical character reference start
   * state` and `Numeric character reference end state` in the HTML spec.
   *
   * @param lastCp The last code point of the entity. Used to see if the
   *               entity was terminated with a semicolon.
   * @param expectedLength The minimum number of characters that should be
   *                       consumed. Used to validate that at least one digit
   *                       was consumed.
   * @returns The number of characters that were consumed.
   */
  emitNumericEntity(lastCp, expectedLength) {
    var _a;
    // Ensure we consumed at least one digit.
    if (this.consumed <= expectedLength) {
      (_a = this.errors) === null || _a === void 0
        ? void 0
        : _a.absenceOfDigitsInNumericCharacterReference(this.consumed);
      return 0;
    }
    // Figure out if this is a legit end of the entity
    if (lastCp === CharCodes.SEMI) {
      this.consumed += 1;
    } else if (this.decodeMode === DecodingMode.Strict) {
      return 0;
    }
    this.emitCodePoint(replaceCodePoint(this.result), this.consumed);
    if (this.errors) {
      if (lastCp !== CharCodes.SEMI) {
        this.errors.missingSemicolonAfterCharacterReference();
      }
      this.errors.validateNumericCharacterReference(this.result);
    }
    return this.consumed;
  }
  /**
   * Parses a named entity.
   *
   * Equivalent to the `Named character reference state` in the HTML spec.
   *
   * @param input The string containing the entity (or a continuation of the entity).
   * @param offset The current offset.
   * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
   */
  stateNamedEntity(input, offset) {
    const { decodeTree } = this;
    let current = decodeTree[this.treeIndex];
    // The mask is the number of bytes of the value, including the current byte.
    let valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
    for (; offset < input.length; offset++, this.excess++) {
      const char = input.charCodeAt(offset);
      this.treeIndex = determineBranch(
        decodeTree,
        current,
        this.treeIndex + Math.max(1, valueLength),
        char
      );
      if (this.treeIndex < 0) {
        return this.result === 0 ||
          // If we are parsing an attribute
          (this.decodeMode === DecodingMode.Attribute &&
            // We shouldn't have consumed any characters after the entity,
            (valueLength === 0 ||
              // And there should be no invalid characters.
              isEntityInAttributeInvalidEnd(char)))
          ? 0
          : this.emitNotTerminatedNamedEntity();
      }
      current = decodeTree[this.treeIndex];
      valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
      // If the branch is a value, store it and continue
      if (valueLength !== 0) {
        // If the entity is terminated by a semicolon, we are done.
        if (char === CharCodes.SEMI) {
          return this.emitNamedEntityData(this.treeIndex, valueLength, this.consumed + this.excess);
        }
        // If we encounter a non-terminated (legacy) entity while parsing strictly, then ignore it.
        if (this.decodeMode !== DecodingMode.Strict) {
          this.result = this.treeIndex;
          this.consumed += this.excess;
          this.excess = 0;
        }
      }
    }
    return -1;
  }
  /**
   * Emit a named entity that was not terminated with a semicolon.
   *
   * @returns The number of characters consumed.
   */
  emitNotTerminatedNamedEntity() {
    var _a;
    const { result, decodeTree } = this;
    const valueLength = (decodeTree[result] & BinTrieFlags.VALUE_LENGTH) >> 14;
    this.emitNamedEntityData(result, valueLength, this.consumed);
    (_a = this.errors) === null || _a === void 0
      ? void 0
      : _a.missingSemicolonAfterCharacterReference();
    return this.consumed;
  }
  /**
   * Emit a named entity.
   *
   * @param result The index of the entity in the decode tree.
   * @param valueLength The number of bytes in the entity.
   * @param consumed The number of characters consumed.
   *
   * @returns The number of characters consumed.
   */
  emitNamedEntityData(result, valueLength, consumed) {
    const { decodeTree } = this;
    this.emitCodePoint(
      valueLength === 1 ? decodeTree[result] & ~BinTrieFlags.VALUE_LENGTH : decodeTree[result + 1],
      consumed
    );
    if (valueLength === 3) {
      // For multi-byte values, we need to emit the second byte.
      this.emitCodePoint(decodeTree[result + 2], consumed);
    }
    return consumed;
  }
  /**
   * Signal to the parser that the end of the input was reached.
   *
   * Remaining data will be emitted and relevant errors will be produced.
   *
   * @returns The number of characters consumed.
   */
  end() {
    var _a;
    switch (this.state) {
      case EntityDecoderState.NamedEntity: {
        // Emit a named entity if we have one.
        return this.result !== 0 &&
          (this.decodeMode !== DecodingMode.Attribute || this.result === this.treeIndex)
          ? this.emitNotTerminatedNamedEntity()
          : 0;
      }
      // Otherwise, emit a numeric entity if we have one.
      case EntityDecoderState.NumericDecimal: {
        return this.emitNumericEntity(0, 2);
      }
      case EntityDecoderState.NumericHex: {
        return this.emitNumericEntity(0, 3);
      }
      case EntityDecoderState.NumericStart: {
        (_a = this.errors) === null || _a === void 0
          ? void 0
          : _a.absenceOfDigitsInNumericCharacterReference(this.consumed);
        return 0;
      }
      case EntityDecoderState.EntityStart: {
        // Return 0 if we have no entity.
        return 0;
      }
    }
  }
}
/**
 * Determines the branch of the current node that is taken given the current
 * character. This function is used to traverse the trie.
 *
 * @param decodeTree The trie.
 * @param current The current node.
 * @param nodeIdx The index right after the current node and its value.
 * @param char The current character.
 * @returns The index of the next node, or -1 if no branch is taken.
 */
function determineBranch(decodeTree, current, nodeIndex, char) {
  const branchCount = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
  const jumpOffset = current & BinTrieFlags.JUMP_TABLE;
  // Case 1: Single branch encoded in jump offset
  if (branchCount === 0) {
    return jumpOffset !== 0 && char === jumpOffset ? nodeIndex : -1;
  }
  // Case 2: Multiple branches encoded in jump table
  if (jumpOffset) {
    const value = char - jumpOffset;
    return value < 0 || value >= branchCount ? -1 : decodeTree[nodeIndex + value] - 1;
  }
  // Case 3: Multiple branches encoded in dictionary
  // Binary search for the character.
  let lo = nodeIndex;
  let hi = lo + branchCount - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midValue = decodeTree[mid];
    if (midValue < char) {
      lo = mid + 1;
    } else if (midValue > char) {
      hi = mid - 1;
    } else {
      return decodeTree[mid + branchCount];
    }
  }
  return -1;
}

/** All valid namespaces in HTML. */
var NS;
(function (NS) {
  NS["HTML"] = "http://www.w3.org/1999/xhtml";
  NS["MATHML"] = "http://www.w3.org/1998/Math/MathML";
  NS["SVG"] = "http://www.w3.org/2000/svg";
  NS["XLINK"] = "http://www.w3.org/1999/xlink";
  NS["XML"] = "http://www.w3.org/XML/1998/namespace";
  NS["XMLNS"] = "http://www.w3.org/2000/xmlns/";
})(NS || (NS = {}));
var ATTRS;
(function (ATTRS) {
  ATTRS["TYPE"] = "type";
  ATTRS["ACTION"] = "action";
  ATTRS["ENCODING"] = "encoding";
  ATTRS["PROMPT"] = "prompt";
  ATTRS["NAME"] = "name";
  ATTRS["COLOR"] = "color";
  ATTRS["FACE"] = "face";
  ATTRS["SIZE"] = "size";
})(ATTRS || (ATTRS = {}));
/**
 * The mode of the document.
 *
 * @see {@link https://dom.spec.whatwg.org/#concept-document-limited-quirks}
 */
var DOCUMENT_MODE;
(function (DOCUMENT_MODE) {
  DOCUMENT_MODE["NO_QUIRKS"] = "no-quirks";
  DOCUMENT_MODE["QUIRKS"] = "quirks";
  DOCUMENT_MODE["LIMITED_QUIRKS"] = "limited-quirks";
})(DOCUMENT_MODE || (DOCUMENT_MODE = {}));
var TAG_NAMES;
(function (TAG_NAMES) {
  TAG_NAMES["A"] = "a";
  TAG_NAMES["ADDRESS"] = "address";
  TAG_NAMES["ANNOTATION_XML"] = "annotation-xml";
  TAG_NAMES["APPLET"] = "applet";
  TAG_NAMES["AREA"] = "area";
  TAG_NAMES["ARTICLE"] = "article";
  TAG_NAMES["ASIDE"] = "aside";
  TAG_NAMES["B"] = "b";
  TAG_NAMES["BASE"] = "base";
  TAG_NAMES["BASEFONT"] = "basefont";
  TAG_NAMES["BGSOUND"] = "bgsound";
  TAG_NAMES["BIG"] = "big";
  TAG_NAMES["BLOCKQUOTE"] = "blockquote";
  TAG_NAMES["BODY"] = "body";
  TAG_NAMES["BR"] = "br";
  TAG_NAMES["BUTTON"] = "button";
  TAG_NAMES["CAPTION"] = "caption";
  TAG_NAMES["CENTER"] = "center";
  TAG_NAMES["CODE"] = "code";
  TAG_NAMES["COL"] = "col";
  TAG_NAMES["COLGROUP"] = "colgroup";
  TAG_NAMES["DD"] = "dd";
  TAG_NAMES["DESC"] = "desc";
  TAG_NAMES["DETAILS"] = "details";
  TAG_NAMES["DIALOG"] = "dialog";
  TAG_NAMES["DIR"] = "dir";
  TAG_NAMES["DIV"] = "div";
  TAG_NAMES["DL"] = "dl";
  TAG_NAMES["DT"] = "dt";
  TAG_NAMES["EM"] = "em";
  TAG_NAMES["EMBED"] = "embed";
  TAG_NAMES["FIELDSET"] = "fieldset";
  TAG_NAMES["FIGCAPTION"] = "figcaption";
  TAG_NAMES["FIGURE"] = "figure";
  TAG_NAMES["FONT"] = "font";
  TAG_NAMES["FOOTER"] = "footer";
  TAG_NAMES["FOREIGN_OBJECT"] = "foreignObject";
  TAG_NAMES["FORM"] = "form";
  TAG_NAMES["FRAME"] = "frame";
  TAG_NAMES["FRAMESET"] = "frameset";
  TAG_NAMES["H1"] = "h1";
  TAG_NAMES["H2"] = "h2";
  TAG_NAMES["H3"] = "h3";
  TAG_NAMES["H4"] = "h4";
  TAG_NAMES["H5"] = "h5";
  TAG_NAMES["H6"] = "h6";
  TAG_NAMES["HEAD"] = "head";
  TAG_NAMES["HEADER"] = "header";
  TAG_NAMES["HGROUP"] = "hgroup";
  TAG_NAMES["HR"] = "hr";
  TAG_NAMES["HTML"] = "html";
  TAG_NAMES["I"] = "i";
  TAG_NAMES["IMG"] = "img";
  TAG_NAMES["IMAGE"] = "image";
  TAG_NAMES["INPUT"] = "input";
  TAG_NAMES["IFRAME"] = "iframe";
  TAG_NAMES["KEYGEN"] = "keygen";
  TAG_NAMES["LABEL"] = "label";
  TAG_NAMES["LI"] = "li";
  TAG_NAMES["LINK"] = "link";
  TAG_NAMES["LISTING"] = "listing";
  TAG_NAMES["MAIN"] = "main";
  TAG_NAMES["MALIGNMARK"] = "malignmark";
  TAG_NAMES["MARQUEE"] = "marquee";
  TAG_NAMES["MATH"] = "math";
  TAG_NAMES["MENU"] = "menu";
  TAG_NAMES["META"] = "meta";
  TAG_NAMES["MGLYPH"] = "mglyph";
  TAG_NAMES["MI"] = "mi";
  TAG_NAMES["MO"] = "mo";
  TAG_NAMES["MN"] = "mn";
  TAG_NAMES["MS"] = "ms";
  TAG_NAMES["MTEXT"] = "mtext";
  TAG_NAMES["NAV"] = "nav";
  TAG_NAMES["NOBR"] = "nobr";
  TAG_NAMES["NOFRAMES"] = "noframes";
  TAG_NAMES["NOEMBED"] = "noembed";
  TAG_NAMES["NOSCRIPT"] = "noscript";
  TAG_NAMES["OBJECT"] = "object";
  TAG_NAMES["OL"] = "ol";
  TAG_NAMES["OPTGROUP"] = "optgroup";
  TAG_NAMES["OPTION"] = "option";
  TAG_NAMES["P"] = "p";
  TAG_NAMES["PARAM"] = "param";
  TAG_NAMES["PLAINTEXT"] = "plaintext";
  TAG_NAMES["PRE"] = "pre";
  TAG_NAMES["RB"] = "rb";
  TAG_NAMES["RP"] = "rp";
  TAG_NAMES["RT"] = "rt";
  TAG_NAMES["RTC"] = "rtc";
  TAG_NAMES["RUBY"] = "ruby";
  TAG_NAMES["S"] = "s";
  TAG_NAMES["SCRIPT"] = "script";
  TAG_NAMES["SEARCH"] = "search";
  TAG_NAMES["SECTION"] = "section";
  TAG_NAMES["SELECT"] = "select";
  TAG_NAMES["SOURCE"] = "source";
  TAG_NAMES["SMALL"] = "small";
  TAG_NAMES["SPAN"] = "span";
  TAG_NAMES["STRIKE"] = "strike";
  TAG_NAMES["STRONG"] = "strong";
  TAG_NAMES["STYLE"] = "style";
  TAG_NAMES["SUB"] = "sub";
  TAG_NAMES["SUMMARY"] = "summary";
  TAG_NAMES["SUP"] = "sup";
  TAG_NAMES["TABLE"] = "table";
  TAG_NAMES["TBODY"] = "tbody";
  TAG_NAMES["TEMPLATE"] = "template";
  TAG_NAMES["TEXTAREA"] = "textarea";
  TAG_NAMES["TFOOT"] = "tfoot";
  TAG_NAMES["TD"] = "td";
  TAG_NAMES["TH"] = "th";
  TAG_NAMES["THEAD"] = "thead";
  TAG_NAMES["TITLE"] = "title";
  TAG_NAMES["TR"] = "tr";
  TAG_NAMES["TRACK"] = "track";
  TAG_NAMES["TT"] = "tt";
  TAG_NAMES["U"] = "u";
  TAG_NAMES["UL"] = "ul";
  TAG_NAMES["SVG"] = "svg";
  TAG_NAMES["VAR"] = "var";
  TAG_NAMES["WBR"] = "wbr";
  TAG_NAMES["XMP"] = "xmp";
})(TAG_NAMES || (TAG_NAMES = {}));
/**
 * Tag IDs are numeric IDs for known tag names.
 *
 * We use tag IDs to improve the performance of tag name comparisons.
 */
var TAG_ID;
(function (TAG_ID) {
  TAG_ID[(TAG_ID["UNKNOWN"] = 0)] = "UNKNOWN";
  TAG_ID[(TAG_ID["A"] = 1)] = "A";
  TAG_ID[(TAG_ID["ADDRESS"] = 2)] = "ADDRESS";
  TAG_ID[(TAG_ID["ANNOTATION_XML"] = 3)] = "ANNOTATION_XML";
  TAG_ID[(TAG_ID["APPLET"] = 4)] = "APPLET";
  TAG_ID[(TAG_ID["AREA"] = 5)] = "AREA";
  TAG_ID[(TAG_ID["ARTICLE"] = 6)] = "ARTICLE";
  TAG_ID[(TAG_ID["ASIDE"] = 7)] = "ASIDE";
  TAG_ID[(TAG_ID["B"] = 8)] = "B";
  TAG_ID[(TAG_ID["BASE"] = 9)] = "BASE";
  TAG_ID[(TAG_ID["BASEFONT"] = 10)] = "BASEFONT";
  TAG_ID[(TAG_ID["BGSOUND"] = 11)] = "BGSOUND";
  TAG_ID[(TAG_ID["BIG"] = 12)] = "BIG";
  TAG_ID[(TAG_ID["BLOCKQUOTE"] = 13)] = "BLOCKQUOTE";
  TAG_ID[(TAG_ID["BODY"] = 14)] = "BODY";
  TAG_ID[(TAG_ID["BR"] = 15)] = "BR";
  TAG_ID[(TAG_ID["BUTTON"] = 16)] = "BUTTON";
  TAG_ID[(TAG_ID["CAPTION"] = 17)] = "CAPTION";
  TAG_ID[(TAG_ID["CENTER"] = 18)] = "CENTER";
  TAG_ID[(TAG_ID["CODE"] = 19)] = "CODE";
  TAG_ID[(TAG_ID["COL"] = 20)] = "COL";
  TAG_ID[(TAG_ID["COLGROUP"] = 21)] = "COLGROUP";
  TAG_ID[(TAG_ID["DD"] = 22)] = "DD";
  TAG_ID[(TAG_ID["DESC"] = 23)] = "DESC";
  TAG_ID[(TAG_ID["DETAILS"] = 24)] = "DETAILS";
  TAG_ID[(TAG_ID["DIALOG"] = 25)] = "DIALOG";
  TAG_ID[(TAG_ID["DIR"] = 26)] = "DIR";
  TAG_ID[(TAG_ID["DIV"] = 27)] = "DIV";
  TAG_ID[(TAG_ID["DL"] = 28)] = "DL";
  TAG_ID[(TAG_ID["DT"] = 29)] = "DT";
  TAG_ID[(TAG_ID["EM"] = 30)] = "EM";
  TAG_ID[(TAG_ID["EMBED"] = 31)] = "EMBED";
  TAG_ID[(TAG_ID["FIELDSET"] = 32)] = "FIELDSET";
  TAG_ID[(TAG_ID["FIGCAPTION"] = 33)] = "FIGCAPTION";
  TAG_ID[(TAG_ID["FIGURE"] = 34)] = "FIGURE";
  TAG_ID[(TAG_ID["FONT"] = 35)] = "FONT";
  TAG_ID[(TAG_ID["FOOTER"] = 36)] = "FOOTER";
  TAG_ID[(TAG_ID["FOREIGN_OBJECT"] = 37)] = "FOREIGN_OBJECT";
  TAG_ID[(TAG_ID["FORM"] = 38)] = "FORM";
  TAG_ID[(TAG_ID["FRAME"] = 39)] = "FRAME";
  TAG_ID[(TAG_ID["FRAMESET"] = 40)] = "FRAMESET";
  TAG_ID[(TAG_ID["H1"] = 41)] = "H1";
  TAG_ID[(TAG_ID["H2"] = 42)] = "H2";
  TAG_ID[(TAG_ID["H3"] = 43)] = "H3";
  TAG_ID[(TAG_ID["H4"] = 44)] = "H4";
  TAG_ID[(TAG_ID["H5"] = 45)] = "H5";
  TAG_ID[(TAG_ID["H6"] = 46)] = "H6";
  TAG_ID[(TAG_ID["HEAD"] = 47)] = "HEAD";
  TAG_ID[(TAG_ID["HEADER"] = 48)] = "HEADER";
  TAG_ID[(TAG_ID["HGROUP"] = 49)] = "HGROUP";
  TAG_ID[(TAG_ID["HR"] = 50)] = "HR";
  TAG_ID[(TAG_ID["HTML"] = 51)] = "HTML";
  TAG_ID[(TAG_ID["I"] = 52)] = "I";
  TAG_ID[(TAG_ID["IMG"] = 53)] = "IMG";
  TAG_ID[(TAG_ID["IMAGE"] = 54)] = "IMAGE";
  TAG_ID[(TAG_ID["INPUT"] = 55)] = "INPUT";
  TAG_ID[(TAG_ID["IFRAME"] = 56)] = "IFRAME";
  TAG_ID[(TAG_ID["KEYGEN"] = 57)] = "KEYGEN";
  TAG_ID[(TAG_ID["LABEL"] = 58)] = "LABEL";
  TAG_ID[(TAG_ID["LI"] = 59)] = "LI";
  TAG_ID[(TAG_ID["LINK"] = 60)] = "LINK";
  TAG_ID[(TAG_ID["LISTING"] = 61)] = "LISTING";
  TAG_ID[(TAG_ID["MAIN"] = 62)] = "MAIN";
  TAG_ID[(TAG_ID["MALIGNMARK"] = 63)] = "MALIGNMARK";
  TAG_ID[(TAG_ID["MARQUEE"] = 64)] = "MARQUEE";
  TAG_ID[(TAG_ID["MATH"] = 65)] = "MATH";
  TAG_ID[(TAG_ID["MENU"] = 66)] = "MENU";
  TAG_ID[(TAG_ID["META"] = 67)] = "META";
  TAG_ID[(TAG_ID["MGLYPH"] = 68)] = "MGLYPH";
  TAG_ID[(TAG_ID["MI"] = 69)] = "MI";
  TAG_ID[(TAG_ID["MO"] = 70)] = "MO";
  TAG_ID[(TAG_ID["MN"] = 71)] = "MN";
  TAG_ID[(TAG_ID["MS"] = 72)] = "MS";
  TAG_ID[(TAG_ID["MTEXT"] = 73)] = "MTEXT";
  TAG_ID[(TAG_ID["NAV"] = 74)] = "NAV";
  TAG_ID[(TAG_ID["NOBR"] = 75)] = "NOBR";
  TAG_ID[(TAG_ID["NOFRAMES"] = 76)] = "NOFRAMES";
  TAG_ID[(TAG_ID["NOEMBED"] = 77)] = "NOEMBED";
  TAG_ID[(TAG_ID["NOSCRIPT"] = 78)] = "NOSCRIPT";
  TAG_ID[(TAG_ID["OBJECT"] = 79)] = "OBJECT";
  TAG_ID[(TAG_ID["OL"] = 80)] = "OL";
  TAG_ID[(TAG_ID["OPTGROUP"] = 81)] = "OPTGROUP";
  TAG_ID[(TAG_ID["OPTION"] = 82)] = "OPTION";
  TAG_ID[(TAG_ID["P"] = 83)] = "P";
  TAG_ID[(TAG_ID["PARAM"] = 84)] = "PARAM";
  TAG_ID[(TAG_ID["PLAINTEXT"] = 85)] = "PLAINTEXT";
  TAG_ID[(TAG_ID["PRE"] = 86)] = "PRE";
  TAG_ID[(TAG_ID["RB"] = 87)] = "RB";
  TAG_ID[(TAG_ID["RP"] = 88)] = "RP";
  TAG_ID[(TAG_ID["RT"] = 89)] = "RT";
  TAG_ID[(TAG_ID["RTC"] = 90)] = "RTC";
  TAG_ID[(TAG_ID["RUBY"] = 91)] = "RUBY";
  TAG_ID[(TAG_ID["S"] = 92)] = "S";
  TAG_ID[(TAG_ID["SCRIPT"] = 93)] = "SCRIPT";
  TAG_ID[(TAG_ID["SEARCH"] = 94)] = "SEARCH";
  TAG_ID[(TAG_ID["SECTION"] = 95)] = "SECTION";
  TAG_ID[(TAG_ID["SELECT"] = 96)] = "SELECT";
  TAG_ID[(TAG_ID["SOURCE"] = 97)] = "SOURCE";
  TAG_ID[(TAG_ID["SMALL"] = 98)] = "SMALL";
  TAG_ID[(TAG_ID["SPAN"] = 99)] = "SPAN";
  TAG_ID[(TAG_ID["STRIKE"] = 100)] = "STRIKE";
  TAG_ID[(TAG_ID["STRONG"] = 101)] = "STRONG";
  TAG_ID[(TAG_ID["STYLE"] = 102)] = "STYLE";
  TAG_ID[(TAG_ID["SUB"] = 103)] = "SUB";
  TAG_ID[(TAG_ID["SUMMARY"] = 104)] = "SUMMARY";
  TAG_ID[(TAG_ID["SUP"] = 105)] = "SUP";
  TAG_ID[(TAG_ID["TABLE"] = 106)] = "TABLE";
  TAG_ID[(TAG_ID["TBODY"] = 107)] = "TBODY";
  TAG_ID[(TAG_ID["TEMPLATE"] = 108)] = "TEMPLATE";
  TAG_ID[(TAG_ID["TEXTAREA"] = 109)] = "TEXTAREA";
  TAG_ID[(TAG_ID["TFOOT"] = 110)] = "TFOOT";
  TAG_ID[(TAG_ID["TD"] = 111)] = "TD";
  TAG_ID[(TAG_ID["TH"] = 112)] = "TH";
  TAG_ID[(TAG_ID["THEAD"] = 113)] = "THEAD";
  TAG_ID[(TAG_ID["TITLE"] = 114)] = "TITLE";
  TAG_ID[(TAG_ID["TR"] = 115)] = "TR";
  TAG_ID[(TAG_ID["TRACK"] = 116)] = "TRACK";
  TAG_ID[(TAG_ID["TT"] = 117)] = "TT";
  TAG_ID[(TAG_ID["U"] = 118)] = "U";
  TAG_ID[(TAG_ID["UL"] = 119)] = "UL";
  TAG_ID[(TAG_ID["SVG"] = 120)] = "SVG";
  TAG_ID[(TAG_ID["VAR"] = 121)] = "VAR";
  TAG_ID[(TAG_ID["WBR"] = 122)] = "WBR";
  TAG_ID[(TAG_ID["XMP"] = 123)] = "XMP";
})(TAG_ID || (TAG_ID = {}));
const TAG_NAME_TO_ID = new Map([
  [TAG_NAMES.A, TAG_ID.A],
  [TAG_NAMES.ADDRESS, TAG_ID.ADDRESS],
  [TAG_NAMES.ANNOTATION_XML, TAG_ID.ANNOTATION_XML],
  [TAG_NAMES.APPLET, TAG_ID.APPLET],
  [TAG_NAMES.AREA, TAG_ID.AREA],
  [TAG_NAMES.ARTICLE, TAG_ID.ARTICLE],
  [TAG_NAMES.ASIDE, TAG_ID.ASIDE],
  [TAG_NAMES.B, TAG_ID.B],
  [TAG_NAMES.BASE, TAG_ID.BASE],
  [TAG_NAMES.BASEFONT, TAG_ID.BASEFONT],
  [TAG_NAMES.BGSOUND, TAG_ID.BGSOUND],
  [TAG_NAMES.BIG, TAG_ID.BIG],
  [TAG_NAMES.BLOCKQUOTE, TAG_ID.BLOCKQUOTE],
  [TAG_NAMES.BODY, TAG_ID.BODY],
  [TAG_NAMES.BR, TAG_ID.BR],
  [TAG_NAMES.BUTTON, TAG_ID.BUTTON],
  [TAG_NAMES.CAPTION, TAG_ID.CAPTION],
  [TAG_NAMES.CENTER, TAG_ID.CENTER],
  [TAG_NAMES.CODE, TAG_ID.CODE],
  [TAG_NAMES.COL, TAG_ID.COL],
  [TAG_NAMES.COLGROUP, TAG_ID.COLGROUP],
  [TAG_NAMES.DD, TAG_ID.DD],
  [TAG_NAMES.DESC, TAG_ID.DESC],
  [TAG_NAMES.DETAILS, TAG_ID.DETAILS],
  [TAG_NAMES.DIALOG, TAG_ID.DIALOG],
  [TAG_NAMES.DIR, TAG_ID.DIR],
  [TAG_NAMES.DIV, TAG_ID.DIV],
  [TAG_NAMES.DL, TAG_ID.DL],
  [TAG_NAMES.DT, TAG_ID.DT],
  [TAG_NAMES.EM, TAG_ID.EM],
  [TAG_NAMES.EMBED, TAG_ID.EMBED],
  [TAG_NAMES.FIELDSET, TAG_ID.FIELDSET],
  [TAG_NAMES.FIGCAPTION, TAG_ID.FIGCAPTION],
  [TAG_NAMES.FIGURE, TAG_ID.FIGURE],
  [TAG_NAMES.FONT, TAG_ID.FONT],
  [TAG_NAMES.FOOTER, TAG_ID.FOOTER],
  [TAG_NAMES.FOREIGN_OBJECT, TAG_ID.FOREIGN_OBJECT],
  [TAG_NAMES.FORM, TAG_ID.FORM],
  [TAG_NAMES.FRAME, TAG_ID.FRAME],
  [TAG_NAMES.FRAMESET, TAG_ID.FRAMESET],
  [TAG_NAMES.H1, TAG_ID.H1],
  [TAG_NAMES.H2, TAG_ID.H2],
  [TAG_NAMES.H3, TAG_ID.H3],
  [TAG_NAMES.H4, TAG_ID.H4],
  [TAG_NAMES.H5, TAG_ID.H5],
  [TAG_NAMES.H6, TAG_ID.H6],
  [TAG_NAMES.HEAD, TAG_ID.HEAD],
  [TAG_NAMES.HEADER, TAG_ID.HEADER],
  [TAG_NAMES.HGROUP, TAG_ID.HGROUP],
  [TAG_NAMES.HR, TAG_ID.HR],
  [TAG_NAMES.HTML, TAG_ID.HTML],
  [TAG_NAMES.I, TAG_ID.I],
  [TAG_NAMES.IMG, TAG_ID.IMG],
  [TAG_NAMES.IMAGE, TAG_ID.IMAGE],
  [TAG_NAMES.INPUT, TAG_ID.INPUT],
  [TAG_NAMES.IFRAME, TAG_ID.IFRAME],
  [TAG_NAMES.KEYGEN, TAG_ID.KEYGEN],
  [TAG_NAMES.LABEL, TAG_ID.LABEL],
  [TAG_NAMES.LI, TAG_ID.LI],
  [TAG_NAMES.LINK, TAG_ID.LINK],
  [TAG_NAMES.LISTING, TAG_ID.LISTING],
  [TAG_NAMES.MAIN, TAG_ID.MAIN],
  [TAG_NAMES.MALIGNMARK, TAG_ID.MALIGNMARK],
  [TAG_NAMES.MARQUEE, TAG_ID.MARQUEE],
  [TAG_NAMES.MATH, TAG_ID.MATH],
  [TAG_NAMES.MENU, TAG_ID.MENU],
  [TAG_NAMES.META, TAG_ID.META],
  [TAG_NAMES.MGLYPH, TAG_ID.MGLYPH],
  [TAG_NAMES.MI, TAG_ID.MI],
  [TAG_NAMES.MO, TAG_ID.MO],
  [TAG_NAMES.MN, TAG_ID.MN],
  [TAG_NAMES.MS, TAG_ID.MS],
  [TAG_NAMES.MTEXT, TAG_ID.MTEXT],
  [TAG_NAMES.NAV, TAG_ID.NAV],
  [TAG_NAMES.NOBR, TAG_ID.NOBR],
  [TAG_NAMES.NOFRAMES, TAG_ID.NOFRAMES],
  [TAG_NAMES.NOEMBED, TAG_ID.NOEMBED],
  [TAG_NAMES.NOSCRIPT, TAG_ID.NOSCRIPT],
  [TAG_NAMES.OBJECT, TAG_ID.OBJECT],
  [TAG_NAMES.OL, TAG_ID.OL],
  [TAG_NAMES.OPTGROUP, TAG_ID.OPTGROUP],
  [TAG_NAMES.OPTION, TAG_ID.OPTION],
  [TAG_NAMES.P, TAG_ID.P],
  [TAG_NAMES.PARAM, TAG_ID.PARAM],
  [TAG_NAMES.PLAINTEXT, TAG_ID.PLAINTEXT],
  [TAG_NAMES.PRE, TAG_ID.PRE],
  [TAG_NAMES.RB, TAG_ID.RB],
  [TAG_NAMES.RP, TAG_ID.RP],
  [TAG_NAMES.RT, TAG_ID.RT],
  [TAG_NAMES.RTC, TAG_ID.RTC],
  [TAG_NAMES.RUBY, TAG_ID.RUBY],
  [TAG_NAMES.S, TAG_ID.S],
  [TAG_NAMES.SCRIPT, TAG_ID.SCRIPT],
  [TAG_NAMES.SEARCH, TAG_ID.SEARCH],
  [TAG_NAMES.SECTION, TAG_ID.SECTION],
  [TAG_NAMES.SELECT, TAG_ID.SELECT],
  [TAG_NAMES.SOURCE, TAG_ID.SOURCE],
  [TAG_NAMES.SMALL, TAG_ID.SMALL],
  [TAG_NAMES.SPAN, TAG_ID.SPAN],
  [TAG_NAMES.STRIKE, TAG_ID.STRIKE],
  [TAG_NAMES.STRONG, TAG_ID.STRONG],
  [TAG_NAMES.STYLE, TAG_ID.STYLE],
  [TAG_NAMES.SUB, TAG_ID.SUB],
  [TAG_NAMES.SUMMARY, TAG_ID.SUMMARY],
  [TAG_NAMES.SUP, TAG_ID.SUP],
  [TAG_NAMES.TABLE, TAG_ID.TABLE],
  [TAG_NAMES.TBODY, TAG_ID.TBODY],
  [TAG_NAMES.TEMPLATE, TAG_ID.TEMPLATE],
  [TAG_NAMES.TEXTAREA, TAG_ID.TEXTAREA],
  [TAG_NAMES.TFOOT, TAG_ID.TFOOT],
  [TAG_NAMES.TD, TAG_ID.TD],
  [TAG_NAMES.TH, TAG_ID.TH],
  [TAG_NAMES.THEAD, TAG_ID.THEAD],
  [TAG_NAMES.TITLE, TAG_ID.TITLE],
  [TAG_NAMES.TR, TAG_ID.TR],
  [TAG_NAMES.TRACK, TAG_ID.TRACK],
  [TAG_NAMES.TT, TAG_ID.TT],
  [TAG_NAMES.U, TAG_ID.U],
  [TAG_NAMES.UL, TAG_ID.UL],
  [TAG_NAMES.SVG, TAG_ID.SVG],
  [TAG_NAMES.VAR, TAG_ID.VAR],
  [TAG_NAMES.WBR, TAG_ID.WBR],
  [TAG_NAMES.XMP, TAG_ID.XMP]
]);
function getTagID(tagName) {
  var _a;
  return (_a = TAG_NAME_TO_ID.get(tagName)) !== null && _a !== void 0 ? _a : TAG_ID.UNKNOWN;
}
const $ = TAG_ID;
const SPECIAL_ELEMENTS = {
  [NS.HTML]: new Set([
    $.ADDRESS,
    $.APPLET,
    $.AREA,
    $.ARTICLE,
    $.ASIDE,
    $.BASE,
    $.BASEFONT,
    $.BGSOUND,
    $.BLOCKQUOTE,
    $.BODY,
    $.BR,
    $.BUTTON,
    $.CAPTION,
    $.CENTER,
    $.COL,
    $.COLGROUP,
    $.DD,
    $.DETAILS,
    $.DIR,
    $.DIV,
    $.DL,
    $.DT,
    $.EMBED,
    $.FIELDSET,
    $.FIGCAPTION,
    $.FIGURE,
    $.FOOTER,
    $.FORM,
    $.FRAME,
    $.FRAMESET,
    $.H1,
    $.H2,
    $.H3,
    $.H4,
    $.H5,
    $.H6,
    $.HEAD,
    $.HEADER,
    $.HGROUP,
    $.HR,
    $.HTML,
    $.IFRAME,
    $.IMG,
    $.INPUT,
    $.LI,
    $.LINK,
    $.LISTING,
    $.MAIN,
    $.MARQUEE,
    $.MENU,
    $.META,
    $.NAV,
    $.NOEMBED,
    $.NOFRAMES,
    $.NOSCRIPT,
    $.OBJECT,
    $.OL,
    $.P,
    $.PARAM,
    $.PLAINTEXT,
    $.PRE,
    $.SCRIPT,
    $.SECTION,
    $.SELECT,
    $.SOURCE,
    $.STYLE,
    $.SUMMARY,
    $.TABLE,
    $.TBODY,
    $.TD,
    $.TEMPLATE,
    $.TEXTAREA,
    $.TFOOT,
    $.TH,
    $.THEAD,
    $.TITLE,
    $.TR,
    $.TRACK,
    $.UL,
    $.WBR,
    $.XMP
  ]),
  [NS.MATHML]: new Set([$.MI, $.MO, $.MN, $.MS, $.MTEXT, $.ANNOTATION_XML]),
  [NS.SVG]: new Set([$.TITLE, $.FOREIGN_OBJECT, $.DESC]),
  [NS.XLINK]: new Set(),
  [NS.XML]: new Set(),
  [NS.XMLNS]: new Set()
};
const NUMBERED_HEADERS = new Set([$.H1, $.H2, $.H3, $.H4, $.H5, $.H6]);
const UNESCAPED_TEXT = new Set([
  TAG_NAMES.STYLE,
  TAG_NAMES.SCRIPT,
  TAG_NAMES.XMP,
  TAG_NAMES.IFRAME,
  TAG_NAMES.NOEMBED,
  TAG_NAMES.NOFRAMES,
  TAG_NAMES.PLAINTEXT
]);
function hasUnescapedText(tn, scriptingEnabled) {
  return UNESCAPED_TEXT.has(tn) || (scriptingEnabled && tn === TAG_NAMES.NOSCRIPT);
}

//States
var State;
(function (State) {
  State[(State["DATA"] = 0)] = "DATA";
  State[(State["RCDATA"] = 1)] = "RCDATA";
  State[(State["RAWTEXT"] = 2)] = "RAWTEXT";
  State[(State["SCRIPT_DATA"] = 3)] = "SCRIPT_DATA";
  State[(State["PLAINTEXT"] = 4)] = "PLAINTEXT";
  State[(State["TAG_OPEN"] = 5)] = "TAG_OPEN";
  State[(State["END_TAG_OPEN"] = 6)] = "END_TAG_OPEN";
  State[(State["TAG_NAME"] = 7)] = "TAG_NAME";
  State[(State["RCDATA_LESS_THAN_SIGN"] = 8)] = "RCDATA_LESS_THAN_SIGN";
  State[(State["RCDATA_END_TAG_OPEN"] = 9)] = "RCDATA_END_TAG_OPEN";
  State[(State["RCDATA_END_TAG_NAME"] = 10)] = "RCDATA_END_TAG_NAME";
  State[(State["RAWTEXT_LESS_THAN_SIGN"] = 11)] = "RAWTEXT_LESS_THAN_SIGN";
  State[(State["RAWTEXT_END_TAG_OPEN"] = 12)] = "RAWTEXT_END_TAG_OPEN";
  State[(State["RAWTEXT_END_TAG_NAME"] = 13)] = "RAWTEXT_END_TAG_NAME";
  State[(State["SCRIPT_DATA_LESS_THAN_SIGN"] = 14)] = "SCRIPT_DATA_LESS_THAN_SIGN";
  State[(State["SCRIPT_DATA_END_TAG_OPEN"] = 15)] = "SCRIPT_DATA_END_TAG_OPEN";
  State[(State["SCRIPT_DATA_END_TAG_NAME"] = 16)] = "SCRIPT_DATA_END_TAG_NAME";
  State[(State["SCRIPT_DATA_ESCAPE_START"] = 17)] = "SCRIPT_DATA_ESCAPE_START";
  State[(State["SCRIPT_DATA_ESCAPE_START_DASH"] = 18)] = "SCRIPT_DATA_ESCAPE_START_DASH";
  State[(State["SCRIPT_DATA_ESCAPED"] = 19)] = "SCRIPT_DATA_ESCAPED";
  State[(State["SCRIPT_DATA_ESCAPED_DASH"] = 20)] = "SCRIPT_DATA_ESCAPED_DASH";
  State[(State["SCRIPT_DATA_ESCAPED_DASH_DASH"] = 21)] = "SCRIPT_DATA_ESCAPED_DASH_DASH";
  State[(State["SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN"] = 22)] = "SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN";
  State[(State["SCRIPT_DATA_ESCAPED_END_TAG_OPEN"] = 23)] = "SCRIPT_DATA_ESCAPED_END_TAG_OPEN";
  State[(State["SCRIPT_DATA_ESCAPED_END_TAG_NAME"] = 24)] = "SCRIPT_DATA_ESCAPED_END_TAG_NAME";
  State[(State["SCRIPT_DATA_DOUBLE_ESCAPE_START"] = 25)] = "SCRIPT_DATA_DOUBLE_ESCAPE_START";
  State[(State["SCRIPT_DATA_DOUBLE_ESCAPED"] = 26)] = "SCRIPT_DATA_DOUBLE_ESCAPED";
  State[(State["SCRIPT_DATA_DOUBLE_ESCAPED_DASH"] = 27)] = "SCRIPT_DATA_DOUBLE_ESCAPED_DASH";
  State[(State["SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH"] = 28)] =
    "SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH";
  State[(State["SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN"] = 29)] =
    "SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN";
  State[(State["SCRIPT_DATA_DOUBLE_ESCAPE_END"] = 30)] = "SCRIPT_DATA_DOUBLE_ESCAPE_END";
  State[(State["BEFORE_ATTRIBUTE_NAME"] = 31)] = "BEFORE_ATTRIBUTE_NAME";
  State[(State["ATTRIBUTE_NAME"] = 32)] = "ATTRIBUTE_NAME";
  State[(State["AFTER_ATTRIBUTE_NAME"] = 33)] = "AFTER_ATTRIBUTE_NAME";
  State[(State["BEFORE_ATTRIBUTE_VALUE"] = 34)] = "BEFORE_ATTRIBUTE_VALUE";
  State[(State["ATTRIBUTE_VALUE_DOUBLE_QUOTED"] = 35)] = "ATTRIBUTE_VALUE_DOUBLE_QUOTED";
  State[(State["ATTRIBUTE_VALUE_SINGLE_QUOTED"] = 36)] = "ATTRIBUTE_VALUE_SINGLE_QUOTED";
  State[(State["ATTRIBUTE_VALUE_UNQUOTED"] = 37)] = "ATTRIBUTE_VALUE_UNQUOTED";
  State[(State["AFTER_ATTRIBUTE_VALUE_QUOTED"] = 38)] = "AFTER_ATTRIBUTE_VALUE_QUOTED";
  State[(State["SELF_CLOSING_START_TAG"] = 39)] = "SELF_CLOSING_START_TAG";
  State[(State["BOGUS_COMMENT"] = 40)] = "BOGUS_COMMENT";
  State[(State["MARKUP_DECLARATION_OPEN"] = 41)] = "MARKUP_DECLARATION_OPEN";
  State[(State["COMMENT_START"] = 42)] = "COMMENT_START";
  State[(State["COMMENT_START_DASH"] = 43)] = "COMMENT_START_DASH";
  State[(State["COMMENT"] = 44)] = "COMMENT";
  State[(State["COMMENT_LESS_THAN_SIGN"] = 45)] = "COMMENT_LESS_THAN_SIGN";
  State[(State["COMMENT_LESS_THAN_SIGN_BANG"] = 46)] = "COMMENT_LESS_THAN_SIGN_BANG";
  State[(State["COMMENT_LESS_THAN_SIGN_BANG_DASH"] = 47)] = "COMMENT_LESS_THAN_SIGN_BANG_DASH";
  State[(State["COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH"] = 48)] =
    "COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH";
  State[(State["COMMENT_END_DASH"] = 49)] = "COMMENT_END_DASH";
  State[(State["COMMENT_END"] = 50)] = "COMMENT_END";
  State[(State["COMMENT_END_BANG"] = 51)] = "COMMENT_END_BANG";
  State[(State["DOCTYPE"] = 52)] = "DOCTYPE";
  State[(State["BEFORE_DOCTYPE_NAME"] = 53)] = "BEFORE_DOCTYPE_NAME";
  State[(State["DOCTYPE_NAME"] = 54)] = "DOCTYPE_NAME";
  State[(State["AFTER_DOCTYPE_NAME"] = 55)] = "AFTER_DOCTYPE_NAME";
  State[(State["AFTER_DOCTYPE_PUBLIC_KEYWORD"] = 56)] = "AFTER_DOCTYPE_PUBLIC_KEYWORD";
  State[(State["BEFORE_DOCTYPE_PUBLIC_IDENTIFIER"] = 57)] = "BEFORE_DOCTYPE_PUBLIC_IDENTIFIER";
  State[(State["DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED"] = 58)] =
    "DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED";
  State[(State["DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED"] = 59)] =
    "DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED";
  State[(State["AFTER_DOCTYPE_PUBLIC_IDENTIFIER"] = 60)] = "AFTER_DOCTYPE_PUBLIC_IDENTIFIER";
  State[(State["BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS"] = 61)] =
    "BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS";
  State[(State["AFTER_DOCTYPE_SYSTEM_KEYWORD"] = 62)] = "AFTER_DOCTYPE_SYSTEM_KEYWORD";
  State[(State["BEFORE_DOCTYPE_SYSTEM_IDENTIFIER"] = 63)] = "BEFORE_DOCTYPE_SYSTEM_IDENTIFIER";
  State[(State["DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED"] = 64)] =
    "DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED";
  State[(State["DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED"] = 65)] =
    "DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED";
  State[(State["AFTER_DOCTYPE_SYSTEM_IDENTIFIER"] = 66)] = "AFTER_DOCTYPE_SYSTEM_IDENTIFIER";
  State[(State["BOGUS_DOCTYPE"] = 67)] = "BOGUS_DOCTYPE";
  State[(State["CDATA_SECTION"] = 68)] = "CDATA_SECTION";
  State[(State["CDATA_SECTION_BRACKET"] = 69)] = "CDATA_SECTION_BRACKET";
  State[(State["CDATA_SECTION_END"] = 70)] = "CDATA_SECTION_END";
  State[(State["CHARACTER_REFERENCE"] = 71)] = "CHARACTER_REFERENCE";
  State[(State["AMBIGUOUS_AMPERSAND"] = 72)] = "AMBIGUOUS_AMPERSAND";
})(State || (State = {}));
//Tokenizer initial states for different modes
const TokenizerMode = {
  DATA: State.DATA,
  RCDATA: State.RCDATA,
  RAWTEXT: State.RAWTEXT,
  SCRIPT_DATA: State.SCRIPT_DATA,
  PLAINTEXT: State.PLAINTEXT,
  CDATA_SECTION: State.CDATA_SECTION
};
//Utils
//OPTIMIZATION: these utility functions should not be moved out of this module. V8 Crankshaft will not inline
//this functions if they will be situated in another module due to context switch.
//Always perform inlining check before modifying this functions ('node --trace-inlining').
function isAsciiDigit(cp) {
  return cp >= CODE_POINTS.DIGIT_0 && cp <= CODE_POINTS.DIGIT_9;
}
function isAsciiUpper(cp) {
  return cp >= CODE_POINTS.LATIN_CAPITAL_A && cp <= CODE_POINTS.LATIN_CAPITAL_Z;
}
function isAsciiLower(cp) {
  return cp >= CODE_POINTS.LATIN_SMALL_A && cp <= CODE_POINTS.LATIN_SMALL_Z;
}
function isAsciiLetter(cp) {
  return isAsciiLower(cp) || isAsciiUpper(cp);
}
function isAsciiAlphaNumeric(cp) {
  return isAsciiLetter(cp) || isAsciiDigit(cp);
}
function toAsciiLower(cp) {
  return cp + 32;
}
function isWhitespace(cp) {
  return (
    cp === CODE_POINTS.SPACE ||
    cp === CODE_POINTS.LINE_FEED ||
    cp === CODE_POINTS.TABULATION ||
    cp === CODE_POINTS.FORM_FEED
  );
}
function isScriptDataDoubleEscapeSequenceEnd(cp) {
  return isWhitespace(cp) || cp === CODE_POINTS.SOLIDUS || cp === CODE_POINTS.GREATER_THAN_SIGN;
}
function getErrorForNumericCharacterReference(code) {
  if (code === CODE_POINTS.NULL) {
    return ERR.nullCharacterReference;
  } else if (code > 1114111) {
    return ERR.characterReferenceOutsideUnicodeRange;
  } else if (isSurrogate(code)) {
    return ERR.surrogateCharacterReference;
  } else if (isUndefinedCodePoint(code)) {
    return ERR.noncharacterCharacterReference;
  } else if (isControlCodePoint(code) || code === CODE_POINTS.CARRIAGE_RETURN) {
    return ERR.controlCharacterReference;
  }
  return null;
}
//Tokenizer
class Tokenizer {
  constructor(options, handler) {
    this.options = options;
    this.handler = handler;
    this.paused = false;
    /** Ensures that the parsing loop isn't run multiple times at once. */
    this.inLoop = false;
    /**
     * Indicates that the current adjusted node exists, is not an element in the HTML namespace,
     * and that it is not an integration point for either MathML or HTML.
     *
     * @see {@link https://html.spec.whatwg.org/multipage/parsing.html#tree-construction}
     */
    this.inForeignNode = false;
    this.lastStartTagName = "";
    this.active = false;
    this.state = State.DATA;
    this.returnState = State.DATA;
    this.entityStartPos = 0;
    this.consumedAfterSnapshot = -1;
    this.currentCharacterToken = null;
    this.currentToken = null;
    this.currentAttr = { name: "", value: "" };
    this.preprocessor = new Preprocessor(handler);
    this.currentLocation = this.getCurrentLocation(-1);
    this.entityDecoder = new EntityDecoder(
      htmlDecodeTree,
      (cp, consumed) => {
        // Note: Set `pos` _before_ flushing, as flushing might drop
        // the current chunk and invalidate `entityStartPos`.
        this.preprocessor.pos = this.entityStartPos + consumed - 1;
        this._flushCodePointConsumedAsCharacterReference(cp);
      },
      handler.onParseError
        ? {
            missingSemicolonAfterCharacterReference: () => {
              this._err(ERR.missingSemicolonAfterCharacterReference, 1);
            },
            absenceOfDigitsInNumericCharacterReference: consumed => {
              this._err(
                ERR.absenceOfDigitsInNumericCharacterReference,
                this.entityStartPos - this.preprocessor.pos + consumed
              );
            },
            validateNumericCharacterReference: code => {
              const error = getErrorForNumericCharacterReference(code);
              if (error) this._err(error, 1);
            }
          }
        : undefined
    );
  }
  //Errors
  _err(code, cpOffset = 0) {
    var _a, _b;
    (_b = (_a = this.handler).onParseError) === null || _b === void 0
      ? void 0
      : _b.call(_a, this.preprocessor.getError(code, cpOffset));
  }
  // NOTE: `offset` may never run across line boundaries.
  getCurrentLocation(offset) {
    if (!this.options.sourceCodeLocationInfo) {
      return null;
    }
    return {
      startLine: this.preprocessor.line,
      startCol: this.preprocessor.col - offset,
      startOffset: this.preprocessor.offset - offset,
      endLine: -1,
      endCol: -1,
      endOffset: -1
    };
  }
  _runParsingLoop() {
    if (this.inLoop) return;
    this.inLoop = true;
    while (this.active && !this.paused) {
      this.consumedAfterSnapshot = 0;
      const cp = this._consume();
      if (!this._ensureHibernation()) {
        this._callState(cp);
      }
    }
    this.inLoop = false;
  }
  //API
  pause() {
    this.paused = true;
  }
  resume(writeCallback) {
    if (!this.paused) {
      throw new Error("Parser was already resumed");
    }
    this.paused = false;
    // Necessary for synchronous resume.
    if (this.inLoop) return;
    this._runParsingLoop();
    if (!this.paused) {
      writeCallback === null || writeCallback === void 0 ? void 0 : writeCallback();
    }
  }
  write(chunk, isLastChunk, writeCallback) {
    this.active = true;
    this.preprocessor.write(chunk, isLastChunk);
    this._runParsingLoop();
    if (!this.paused) {
      writeCallback === null || writeCallback === void 0 ? void 0 : writeCallback();
    }
  }
  insertHtmlAtCurrentPos(chunk) {
    this.active = true;
    this.preprocessor.insertHtmlAtCurrentPos(chunk);
    this._runParsingLoop();
  }
  //Hibernation
  _ensureHibernation() {
    if (this.preprocessor.endOfChunkHit) {
      this.preprocessor.retreat(this.consumedAfterSnapshot);
      this.consumedAfterSnapshot = 0;
      this.active = false;
      return true;
    }
    return false;
  }
  //Consumption
  _consume() {
    this.consumedAfterSnapshot++;
    return this.preprocessor.advance();
  }
  _advanceBy(count) {
    this.consumedAfterSnapshot += count;
    for (let i = 0; i < count; i++) {
      this.preprocessor.advance();
    }
  }
  _consumeSequenceIfMatch(pattern, caseSensitive) {
    if (this.preprocessor.startsWith(pattern, caseSensitive)) {
      // We will already have consumed one character before calling this method.
      this._advanceBy(pattern.length - 1);
      return true;
    }
    return false;
  }
  //Token creation
  _createStartTagToken() {
    this.currentToken = {
      type: TokenType.START_TAG,
      tagName: "",
      tagID: TAG_ID.UNKNOWN,
      selfClosing: false,
      ackSelfClosing: false,
      attrs: [],
      location: this.getCurrentLocation(1)
    };
  }
  _createEndTagToken() {
    this.currentToken = {
      type: TokenType.END_TAG,
      tagName: "",
      tagID: TAG_ID.UNKNOWN,
      selfClosing: false,
      ackSelfClosing: false,
      attrs: [],
      location: this.getCurrentLocation(2)
    };
  }
  _createCommentToken(offset) {
    this.currentToken = {
      type: TokenType.COMMENT,
      data: "",
      location: this.getCurrentLocation(offset)
    };
  }
  _createDoctypeToken(initialName) {
    this.currentToken = {
      type: TokenType.DOCTYPE,
      name: initialName,
      forceQuirks: false,
      publicId: null,
      systemId: null,
      location: this.currentLocation
    };
  }
  _createCharacterToken(type, chars) {
    this.currentCharacterToken = {
      type,
      chars,
      location: this.currentLocation
    };
  }
  //Tag attributes
  _createAttr(attrNameFirstCh) {
    this.currentAttr = {
      name: attrNameFirstCh,
      value: ""
    };
    this.currentLocation = this.getCurrentLocation(0);
  }
  _leaveAttrName() {
    var _a;
    var _b;
    const token = this.currentToken;
    if (getTokenAttr(token, this.currentAttr.name) === null) {
      token.attrs.push(this.currentAttr);
      if (token.location && this.currentLocation) {
        const attrLocations =
          (_a = (_b = token.location).attrs) !== null && _a !== void 0
            ? _a
            : (_b.attrs = Object.create(null));
        attrLocations[this.currentAttr.name] = this.currentLocation;
        // Set end location
        this._leaveAttrValue();
      }
    } else {
      this._err(ERR.duplicateAttribute);
    }
  }
  _leaveAttrValue() {
    if (this.currentLocation) {
      this.currentLocation.endLine = this.preprocessor.line;
      this.currentLocation.endCol = this.preprocessor.col;
      this.currentLocation.endOffset = this.preprocessor.offset;
    }
  }
  //Token emission
  prepareToken(ct) {
    this._emitCurrentCharacterToken(ct.location);
    this.currentToken = null;
    if (ct.location) {
      ct.location.endLine = this.preprocessor.line;
      ct.location.endCol = this.preprocessor.col + 1;
      ct.location.endOffset = this.preprocessor.offset + 1;
    }
    this.currentLocation = this.getCurrentLocation(-1);
  }
  emitCurrentTagToken() {
    const ct = this.currentToken;
    this.prepareToken(ct);
    ct.tagID = getTagID(ct.tagName);
    if (ct.type === TokenType.START_TAG) {
      this.lastStartTagName = ct.tagName;
      this.handler.onStartTag(ct);
    } else {
      if (ct.attrs.length > 0) {
        this._err(ERR.endTagWithAttributes);
      }
      if (ct.selfClosing) {
        this._err(ERR.endTagWithTrailingSolidus);
      }
      this.handler.onEndTag(ct);
    }
    this.preprocessor.dropParsedChunk();
  }
  emitCurrentComment(ct) {
    this.prepareToken(ct);
    this.handler.onComment(ct);
    this.preprocessor.dropParsedChunk();
  }
  emitCurrentDoctype(ct) {
    this.prepareToken(ct);
    this.handler.onDoctype(ct);
    this.preprocessor.dropParsedChunk();
  }
  _emitCurrentCharacterToken(nextLocation) {
    if (this.currentCharacterToken) {
      //NOTE: if we have a pending character token, make it's end location equal to the
      //current token's start location.
      if (nextLocation && this.currentCharacterToken.location) {
        this.currentCharacterToken.location.endLine = nextLocation.startLine;
        this.currentCharacterToken.location.endCol = nextLocation.startCol;
        this.currentCharacterToken.location.endOffset = nextLocation.startOffset;
      }
      switch (this.currentCharacterToken.type) {
        case TokenType.CHARACTER: {
          this.handler.onCharacter(this.currentCharacterToken);
          break;
        }
        case TokenType.NULL_CHARACTER: {
          this.handler.onNullCharacter(this.currentCharacterToken);
          break;
        }
        case TokenType.WHITESPACE_CHARACTER: {
          this.handler.onWhitespaceCharacter(this.currentCharacterToken);
          break;
        }
      }
      this.currentCharacterToken = null;
    }
  }
  _emitEOFToken() {
    const location = this.getCurrentLocation(0);
    if (location) {
      location.endLine = location.startLine;
      location.endCol = location.startCol;
      location.endOffset = location.startOffset;
    }
    this._emitCurrentCharacterToken(location);
    this.handler.onEof({ type: TokenType.EOF, location });
    this.active = false;
  }
  //Characters emission
  //OPTIMIZATION: The specification uses only one type of character token (one token per character).
  //This causes a huge memory overhead and a lot of unnecessary parser loops. parse5 uses 3 groups of characters.
  //If we have a sequence of characters that belong to the same group, the parser can process it
  //as a single solid character token.
  //So, there are 3 types of character tokens in parse5:
  //1)TokenType.NULL_CHARACTER - \u0000-character sequences (e.g. '\u0000\u0000\u0000')
  //2)TokenType.WHITESPACE_CHARACTER - any whitespace/new-line character sequences (e.g. '\n  \r\t   \f')
  //3)TokenType.CHARACTER - any character sequence which don't belong to groups 1 and 2 (e.g. 'abcdef1234@@#$%^')
  _appendCharToCurrentCharacterToken(type, ch) {
    if (this.currentCharacterToken) {
      if (this.currentCharacterToken.type === type) {
        this.currentCharacterToken.chars += ch;
        return;
      } else {
        this.currentLocation = this.getCurrentLocation(0);
        this._emitCurrentCharacterToken(this.currentLocation);
        this.preprocessor.dropParsedChunk();
      }
    }
    this._createCharacterToken(type, ch);
  }
  _emitCodePoint(cp) {
    const type = isWhitespace(cp)
      ? TokenType.WHITESPACE_CHARACTER
      : cp === CODE_POINTS.NULL
        ? TokenType.NULL_CHARACTER
        : TokenType.CHARACTER;
    this._appendCharToCurrentCharacterToken(type, String.fromCodePoint(cp));
  }
  //NOTE: used when we emit characters explicitly.
  //This is always for non-whitespace and non-null characters, which allows us to avoid additional checks.
  _emitChars(ch) {
    this._appendCharToCurrentCharacterToken(TokenType.CHARACTER, ch);
  }
  // Character reference helpers
  _startCharacterReference() {
    this.returnState = this.state;
    this.state = State.CHARACTER_REFERENCE;
    this.entityStartPos = this.preprocessor.pos;
    this.entityDecoder.startEntity(
      this._isCharacterReferenceInAttribute() ? DecodingMode.Attribute : DecodingMode.Legacy
    );
  }
  _isCharacterReferenceInAttribute() {
    return (
      this.returnState === State.ATTRIBUTE_VALUE_DOUBLE_QUOTED ||
      this.returnState === State.ATTRIBUTE_VALUE_SINGLE_QUOTED ||
      this.returnState === State.ATTRIBUTE_VALUE_UNQUOTED
    );
  }
  _flushCodePointConsumedAsCharacterReference(cp) {
    if (this._isCharacterReferenceInAttribute()) {
      this.currentAttr.value += String.fromCodePoint(cp);
    } else {
      this._emitCodePoint(cp);
    }
  }
  // Calling states this way turns out to be much faster than any other approach.
  _callState(cp) {
    switch (this.state) {
      case State.DATA: {
        this._stateData(cp);
        break;
      }
      case State.RCDATA: {
        this._stateRcdata(cp);
        break;
      }
      case State.RAWTEXT: {
        this._stateRawtext(cp);
        break;
      }
      case State.SCRIPT_DATA: {
        this._stateScriptData(cp);
        break;
      }
      case State.PLAINTEXT: {
        this._statePlaintext(cp);
        break;
      }
      case State.TAG_OPEN: {
        this._stateTagOpen(cp);
        break;
      }
      case State.END_TAG_OPEN: {
        this._stateEndTagOpen(cp);
        break;
      }
      case State.TAG_NAME: {
        this._stateTagName(cp);
        break;
      }
      case State.RCDATA_LESS_THAN_SIGN: {
        this._stateRcdataLessThanSign(cp);
        break;
      }
      case State.RCDATA_END_TAG_OPEN: {
        this._stateRcdataEndTagOpen(cp);
        break;
      }
      case State.RCDATA_END_TAG_NAME: {
        this._stateRcdataEndTagName(cp);
        break;
      }
      case State.RAWTEXT_LESS_THAN_SIGN: {
        this._stateRawtextLessThanSign(cp);
        break;
      }
      case State.RAWTEXT_END_TAG_OPEN: {
        this._stateRawtextEndTagOpen(cp);
        break;
      }
      case State.RAWTEXT_END_TAG_NAME: {
        this._stateRawtextEndTagName(cp);
        break;
      }
      case State.SCRIPT_DATA_LESS_THAN_SIGN: {
        this._stateScriptDataLessThanSign(cp);
        break;
      }
      case State.SCRIPT_DATA_END_TAG_OPEN: {
        this._stateScriptDataEndTagOpen(cp);
        break;
      }
      case State.SCRIPT_DATA_END_TAG_NAME: {
        this._stateScriptDataEndTagName(cp);
        break;
      }
      case State.SCRIPT_DATA_ESCAPE_START: {
        this._stateScriptDataEscapeStart(cp);
        break;
      }
      case State.SCRIPT_DATA_ESCAPE_START_DASH: {
        this._stateScriptDataEscapeStartDash(cp);
        break;
      }
      case State.SCRIPT_DATA_ESCAPED: {
        this._stateScriptDataEscaped(cp);
        break;
      }
      case State.SCRIPT_DATA_ESCAPED_DASH: {
        this._stateScriptDataEscapedDash(cp);
        break;
      }
      case State.SCRIPT_DATA_ESCAPED_DASH_DASH: {
        this._stateScriptDataEscapedDashDash(cp);
        break;
      }
      case State.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN: {
        this._stateScriptDataEscapedLessThanSign(cp);
        break;
      }
      case State.SCRIPT_DATA_ESCAPED_END_TAG_OPEN: {
        this._stateScriptDataEscapedEndTagOpen(cp);
        break;
      }
      case State.SCRIPT_DATA_ESCAPED_END_TAG_NAME: {
        this._stateScriptDataEscapedEndTagName(cp);
        break;
      }
      case State.SCRIPT_DATA_DOUBLE_ESCAPE_START: {
        this._stateScriptDataDoubleEscapeStart(cp);
        break;
      }
      case State.SCRIPT_DATA_DOUBLE_ESCAPED: {
        this._stateScriptDataDoubleEscaped(cp);
        break;
      }
      case State.SCRIPT_DATA_DOUBLE_ESCAPED_DASH: {
        this._stateScriptDataDoubleEscapedDash(cp);
        break;
      }
      case State.SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH: {
        this._stateScriptDataDoubleEscapedDashDash(cp);
        break;
      }
      case State.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN: {
        this._stateScriptDataDoubleEscapedLessThanSign(cp);
        break;
      }
      case State.SCRIPT_DATA_DOUBLE_ESCAPE_END: {
        this._stateScriptDataDoubleEscapeEnd(cp);
        break;
      }
      case State.BEFORE_ATTRIBUTE_NAME: {
        this._stateBeforeAttributeName(cp);
        break;
      }
      case State.ATTRIBUTE_NAME: {
        this._stateAttributeName(cp);
        break;
      }
      case State.AFTER_ATTRIBUTE_NAME: {
        this._stateAfterAttributeName(cp);
        break;
      }
      case State.BEFORE_ATTRIBUTE_VALUE: {
        this._stateBeforeAttributeValue(cp);
        break;
      }
      case State.ATTRIBUTE_VALUE_DOUBLE_QUOTED: {
        this._stateAttributeValueDoubleQuoted(cp);
        break;
      }
      case State.ATTRIBUTE_VALUE_SINGLE_QUOTED: {
        this._stateAttributeValueSingleQuoted(cp);
        break;
      }
      case State.ATTRIBUTE_VALUE_UNQUOTED: {
        this._stateAttributeValueUnquoted(cp);
        break;
      }
      case State.AFTER_ATTRIBUTE_VALUE_QUOTED: {
        this._stateAfterAttributeValueQuoted(cp);
        break;
      }
      case State.SELF_CLOSING_START_TAG: {
        this._stateSelfClosingStartTag(cp);
        break;
      }
      case State.BOGUS_COMMENT: {
        this._stateBogusComment(cp);
        break;
      }
      case State.MARKUP_DECLARATION_OPEN: {
        this._stateMarkupDeclarationOpen(cp);
        break;
      }
      case State.COMMENT_START: {
        this._stateCommentStart(cp);
        break;
      }
      case State.COMMENT_START_DASH: {
        this._stateCommentStartDash(cp);
        break;
      }
      case State.COMMENT: {
        this._stateComment(cp);
        break;
      }
      case State.COMMENT_LESS_THAN_SIGN: {
        this._stateCommentLessThanSign(cp);
        break;
      }
      case State.COMMENT_LESS_THAN_SIGN_BANG: {
        this._stateCommentLessThanSignBang(cp);
        break;
      }
      case State.COMMENT_LESS_THAN_SIGN_BANG_DASH: {
        this._stateCommentLessThanSignBangDash(cp);
        break;
      }
      case State.COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH: {
        this._stateCommentLessThanSignBangDashDash(cp);
        break;
      }
      case State.COMMENT_END_DASH: {
        this._stateCommentEndDash(cp);
        break;
      }
      case State.COMMENT_END: {
        this._stateCommentEnd(cp);
        break;
      }
      case State.COMMENT_END_BANG: {
        this._stateCommentEndBang(cp);
        break;
      }
      case State.DOCTYPE: {
        this._stateDoctype(cp);
        break;
      }
      case State.BEFORE_DOCTYPE_NAME: {
        this._stateBeforeDoctypeName(cp);
        break;
      }
      case State.DOCTYPE_NAME: {
        this._stateDoctypeName(cp);
        break;
      }
      case State.AFTER_DOCTYPE_NAME: {
        this._stateAfterDoctypeName(cp);
        break;
      }
      case State.AFTER_DOCTYPE_PUBLIC_KEYWORD: {
        this._stateAfterDoctypePublicKeyword(cp);
        break;
      }
      case State.BEFORE_DOCTYPE_PUBLIC_IDENTIFIER: {
        this._stateBeforeDoctypePublicIdentifier(cp);
        break;
      }
      case State.DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED: {
        this._stateDoctypePublicIdentifierDoubleQuoted(cp);
        break;
      }
      case State.DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED: {
        this._stateDoctypePublicIdentifierSingleQuoted(cp);
        break;
      }
      case State.AFTER_DOCTYPE_PUBLIC_IDENTIFIER: {
        this._stateAfterDoctypePublicIdentifier(cp);
        break;
      }
      case State.BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS: {
        this._stateBetweenDoctypePublicAndSystemIdentifiers(cp);
        break;
      }
      case State.AFTER_DOCTYPE_SYSTEM_KEYWORD: {
        this._stateAfterDoctypeSystemKeyword(cp);
        break;
      }
      case State.BEFORE_DOCTYPE_SYSTEM_IDENTIFIER: {
        this._stateBeforeDoctypeSystemIdentifier(cp);
        break;
      }
      case State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED: {
        this._stateDoctypeSystemIdentifierDoubleQuoted(cp);
        break;
      }
      case State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED: {
        this._stateDoctypeSystemIdentifierSingleQuoted(cp);
        break;
      }
      case State.AFTER_DOCTYPE_SYSTEM_IDENTIFIER: {
        this._stateAfterDoctypeSystemIdentifier(cp);
        break;
      }
      case State.BOGUS_DOCTYPE: {
        this._stateBogusDoctype(cp);
        break;
      }
      case State.CDATA_SECTION: {
        this._stateCdataSection(cp);
        break;
      }
      case State.CDATA_SECTION_BRACKET: {
        this._stateCdataSectionBracket(cp);
        break;
      }
      case State.CDATA_SECTION_END: {
        this._stateCdataSectionEnd(cp);
        break;
      }
      case State.CHARACTER_REFERENCE: {
        this._stateCharacterReference();
        break;
      }
      case State.AMBIGUOUS_AMPERSAND: {
        this._stateAmbiguousAmpersand(cp);
        break;
      }
      default: {
        throw new Error("Unknown state");
      }
    }
  }
  // State machine
  // Data state
  //------------------------------------------------------------------
  _stateData(cp) {
    switch (cp) {
      case CODE_POINTS.LESS_THAN_SIGN: {
        this.state = State.TAG_OPEN;
        break;
      }
      case CODE_POINTS.AMPERSAND: {
        this._startCharacterReference();
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this._emitCodePoint(cp);
        break;
      }
      case CODE_POINTS.EOF: {
        this._emitEOFToken();
        break;
      }
      default: {
        this._emitCodePoint(cp);
      }
    }
  }
  //  RCDATA state
  //------------------------------------------------------------------
  _stateRcdata(cp) {
    switch (cp) {
      case CODE_POINTS.AMPERSAND: {
        this._startCharacterReference();
        break;
      }
      case CODE_POINTS.LESS_THAN_SIGN: {
        this.state = State.RCDATA_LESS_THAN_SIGN;
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this._emitChars(REPLACEMENT_CHARACTER);
        break;
      }
      case CODE_POINTS.EOF: {
        this._emitEOFToken();
        break;
      }
      default: {
        this._emitCodePoint(cp);
      }
    }
  }
  // RAWTEXT state
  //------------------------------------------------------------------
  _stateRawtext(cp) {
    switch (cp) {
      case CODE_POINTS.LESS_THAN_SIGN: {
        this.state = State.RAWTEXT_LESS_THAN_SIGN;
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this._emitChars(REPLACEMENT_CHARACTER);
        break;
      }
      case CODE_POINTS.EOF: {
        this._emitEOFToken();
        break;
      }
      default: {
        this._emitCodePoint(cp);
      }
    }
  }
  // Script data state
  //------------------------------------------------------------------
  _stateScriptData(cp) {
    switch (cp) {
      case CODE_POINTS.LESS_THAN_SIGN: {
        this.state = State.SCRIPT_DATA_LESS_THAN_SIGN;
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this._emitChars(REPLACEMENT_CHARACTER);
        break;
      }
      case CODE_POINTS.EOF: {
        this._emitEOFToken();
        break;
      }
      default: {
        this._emitCodePoint(cp);
      }
    }
  }
  // PLAINTEXT state
  //------------------------------------------------------------------
  _statePlaintext(cp) {
    switch (cp) {
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this._emitChars(REPLACEMENT_CHARACTER);
        break;
      }
      case CODE_POINTS.EOF: {
        this._emitEOFToken();
        break;
      }
      default: {
        this._emitCodePoint(cp);
      }
    }
  }
  // Tag open state
  //------------------------------------------------------------------
  _stateTagOpen(cp) {
    if (isAsciiLetter(cp)) {
      this._createStartTagToken();
      this.state = State.TAG_NAME;
      this._stateTagName(cp);
    } else
      switch (cp) {
        case CODE_POINTS.EXCLAMATION_MARK: {
          this.state = State.MARKUP_DECLARATION_OPEN;
          break;
        }
        case CODE_POINTS.SOLIDUS: {
          this.state = State.END_TAG_OPEN;
          break;
        }
        case CODE_POINTS.QUESTION_MARK: {
          this._err(ERR.unexpectedQuestionMarkInsteadOfTagName);
          this._createCommentToken(1);
          this.state = State.BOGUS_COMMENT;
          this._stateBogusComment(cp);
          break;
        }
        case CODE_POINTS.EOF: {
          this._err(ERR.eofBeforeTagName);
          this._emitChars("<");
          this._emitEOFToken();
          break;
        }
        default: {
          this._err(ERR.invalidFirstCharacterOfTagName);
          this._emitChars("<");
          this.state = State.DATA;
          this._stateData(cp);
        }
      }
  }
  // End tag open state
  //------------------------------------------------------------------
  _stateEndTagOpen(cp) {
    if (isAsciiLetter(cp)) {
      this._createEndTagToken();
      this.state = State.TAG_NAME;
      this._stateTagName(cp);
    } else
      switch (cp) {
        case CODE_POINTS.GREATER_THAN_SIGN: {
          this._err(ERR.missingEndTagName);
          this.state = State.DATA;
          break;
        }
        case CODE_POINTS.EOF: {
          this._err(ERR.eofBeforeTagName);
          this._emitChars("</");
          this._emitEOFToken();
          break;
        }
        default: {
          this._err(ERR.invalidFirstCharacterOfTagName);
          this._createCommentToken(2);
          this.state = State.BOGUS_COMMENT;
          this._stateBogusComment(cp);
        }
      }
  }
  // Tag name state
  //------------------------------------------------------------------
  _stateTagName(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        this.state = State.BEFORE_ATTRIBUTE_NAME;
        break;
      }
      case CODE_POINTS.SOLIDUS: {
        this.state = State.SELF_CLOSING_START_TAG;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.state = State.DATA;
        this.emitCurrentTagToken();
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        token.tagName += REPLACEMENT_CHARACTER;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInTag);
        this._emitEOFToken();
        break;
      }
      default: {
        token.tagName += String.fromCodePoint(isAsciiUpper(cp) ? toAsciiLower(cp) : cp);
      }
    }
  }
  // RCDATA less-than sign state
  //------------------------------------------------------------------
  _stateRcdataLessThanSign(cp) {
    if (cp === CODE_POINTS.SOLIDUS) {
      this.state = State.RCDATA_END_TAG_OPEN;
    } else {
      this._emitChars("<");
      this.state = State.RCDATA;
      this._stateRcdata(cp);
    }
  }
  // RCDATA end tag open state
  //------------------------------------------------------------------
  _stateRcdataEndTagOpen(cp) {
    if (isAsciiLetter(cp)) {
      this.state = State.RCDATA_END_TAG_NAME;
      this._stateRcdataEndTagName(cp);
    } else {
      this._emitChars("</");
      this.state = State.RCDATA;
      this._stateRcdata(cp);
    }
  }
  handleSpecialEndTag(_cp) {
    if (!this.preprocessor.startsWith(this.lastStartTagName, false)) {
      return !this._ensureHibernation();
    }
    this._createEndTagToken();
    const token = this.currentToken;
    token.tagName = this.lastStartTagName;
    const cp = this.preprocessor.peek(this.lastStartTagName.length);
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        this._advanceBy(this.lastStartTagName.length);
        this.state = State.BEFORE_ATTRIBUTE_NAME;
        return false;
      }
      case CODE_POINTS.SOLIDUS: {
        this._advanceBy(this.lastStartTagName.length);
        this.state = State.SELF_CLOSING_START_TAG;
        return false;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._advanceBy(this.lastStartTagName.length);
        this.emitCurrentTagToken();
        this.state = State.DATA;
        return false;
      }
      default: {
        return !this._ensureHibernation();
      }
    }
  }
  // RCDATA end tag name state
  //------------------------------------------------------------------
  _stateRcdataEndTagName(cp) {
    if (this.handleSpecialEndTag(cp)) {
      this._emitChars("</");
      this.state = State.RCDATA;
      this._stateRcdata(cp);
    }
  }
  // RAWTEXT less-than sign state
  //------------------------------------------------------------------
  _stateRawtextLessThanSign(cp) {
    if (cp === CODE_POINTS.SOLIDUS) {
      this.state = State.RAWTEXT_END_TAG_OPEN;
    } else {
      this._emitChars("<");
      this.state = State.RAWTEXT;
      this._stateRawtext(cp);
    }
  }
  // RAWTEXT end tag open state
  //------------------------------------------------------------------
  _stateRawtextEndTagOpen(cp) {
    if (isAsciiLetter(cp)) {
      this.state = State.RAWTEXT_END_TAG_NAME;
      this._stateRawtextEndTagName(cp);
    } else {
      this._emitChars("</");
      this.state = State.RAWTEXT;
      this._stateRawtext(cp);
    }
  }
  // RAWTEXT end tag name state
  //------------------------------------------------------------------
  _stateRawtextEndTagName(cp) {
    if (this.handleSpecialEndTag(cp)) {
      this._emitChars("</");
      this.state = State.RAWTEXT;
      this._stateRawtext(cp);
    }
  }
  // Script data less-than sign state
  //------------------------------------------------------------------
  _stateScriptDataLessThanSign(cp) {
    switch (cp) {
      case CODE_POINTS.SOLIDUS: {
        this.state = State.SCRIPT_DATA_END_TAG_OPEN;
        break;
      }
      case CODE_POINTS.EXCLAMATION_MARK: {
        this.state = State.SCRIPT_DATA_ESCAPE_START;
        this._emitChars("<!");
        break;
      }
      default: {
        this._emitChars("<");
        this.state = State.SCRIPT_DATA;
        this._stateScriptData(cp);
      }
    }
  }
  // Script data end tag open state
  //------------------------------------------------------------------
  _stateScriptDataEndTagOpen(cp) {
    if (isAsciiLetter(cp)) {
      this.state = State.SCRIPT_DATA_END_TAG_NAME;
      this._stateScriptDataEndTagName(cp);
    } else {
      this._emitChars("</");
      this.state = State.SCRIPT_DATA;
      this._stateScriptData(cp);
    }
  }
  // Script data end tag name state
  //------------------------------------------------------------------
  _stateScriptDataEndTagName(cp) {
    if (this.handleSpecialEndTag(cp)) {
      this._emitChars("</");
      this.state = State.SCRIPT_DATA;
      this._stateScriptData(cp);
    }
  }
  // Script data escape start state
  //------------------------------------------------------------------
  _stateScriptDataEscapeStart(cp) {
    if (cp === CODE_POINTS.HYPHEN_MINUS) {
      this.state = State.SCRIPT_DATA_ESCAPE_START_DASH;
      this._emitChars("-");
    } else {
      this.state = State.SCRIPT_DATA;
      this._stateScriptData(cp);
    }
  }
  // Script data escape start dash state
  //------------------------------------------------------------------
  _stateScriptDataEscapeStartDash(cp) {
    if (cp === CODE_POINTS.HYPHEN_MINUS) {
      this.state = State.SCRIPT_DATA_ESCAPED_DASH_DASH;
      this._emitChars("-");
    } else {
      this.state = State.SCRIPT_DATA;
      this._stateScriptData(cp);
    }
  }
  // Script data escaped state
  //------------------------------------------------------------------
  _stateScriptDataEscaped(cp) {
    switch (cp) {
      case CODE_POINTS.HYPHEN_MINUS: {
        this.state = State.SCRIPT_DATA_ESCAPED_DASH;
        this._emitChars("-");
        break;
      }
      case CODE_POINTS.LESS_THAN_SIGN: {
        this.state = State.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN;
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this._emitChars(REPLACEMENT_CHARACTER);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInScriptHtmlCommentLikeText);
        this._emitEOFToken();
        break;
      }
      default: {
        this._emitCodePoint(cp);
      }
    }
  }
  // Script data escaped dash state
  //------------------------------------------------------------------
  _stateScriptDataEscapedDash(cp) {
    switch (cp) {
      case CODE_POINTS.HYPHEN_MINUS: {
        this.state = State.SCRIPT_DATA_ESCAPED_DASH_DASH;
        this._emitChars("-");
        break;
      }
      case CODE_POINTS.LESS_THAN_SIGN: {
        this.state = State.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN;
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this.state = State.SCRIPT_DATA_ESCAPED;
        this._emitChars(REPLACEMENT_CHARACTER);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInScriptHtmlCommentLikeText);
        this._emitEOFToken();
        break;
      }
      default: {
        this.state = State.SCRIPT_DATA_ESCAPED;
        this._emitCodePoint(cp);
      }
    }
  }
  // Script data escaped dash dash state
  //------------------------------------------------------------------
  _stateScriptDataEscapedDashDash(cp) {
    switch (cp) {
      case CODE_POINTS.HYPHEN_MINUS: {
        this._emitChars("-");
        break;
      }
      case CODE_POINTS.LESS_THAN_SIGN: {
        this.state = State.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.state = State.SCRIPT_DATA;
        this._emitChars(">");
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this.state = State.SCRIPT_DATA_ESCAPED;
        this._emitChars(REPLACEMENT_CHARACTER);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInScriptHtmlCommentLikeText);
        this._emitEOFToken();
        break;
      }
      default: {
        this.state = State.SCRIPT_DATA_ESCAPED;
        this._emitCodePoint(cp);
      }
    }
  }
  // Script data escaped less-than sign state
  //------------------------------------------------------------------
  _stateScriptDataEscapedLessThanSign(cp) {
    if (cp === CODE_POINTS.SOLIDUS) {
      this.state = State.SCRIPT_DATA_ESCAPED_END_TAG_OPEN;
    } else if (isAsciiLetter(cp)) {
      this._emitChars("<");
      this.state = State.SCRIPT_DATA_DOUBLE_ESCAPE_START;
      this._stateScriptDataDoubleEscapeStart(cp);
    } else {
      this._emitChars("<");
      this.state = State.SCRIPT_DATA_ESCAPED;
      this._stateScriptDataEscaped(cp);
    }
  }
  // Script data escaped end tag open state
  //------------------------------------------------------------------
  _stateScriptDataEscapedEndTagOpen(cp) {
    if (isAsciiLetter(cp)) {
      this.state = State.SCRIPT_DATA_ESCAPED_END_TAG_NAME;
      this._stateScriptDataEscapedEndTagName(cp);
    } else {
      this._emitChars("</");
      this.state = State.SCRIPT_DATA_ESCAPED;
      this._stateScriptDataEscaped(cp);
    }
  }
  // Script data escaped end tag name state
  //------------------------------------------------------------------
  _stateScriptDataEscapedEndTagName(cp) {
    if (this.handleSpecialEndTag(cp)) {
      this._emitChars("</");
      this.state = State.SCRIPT_DATA_ESCAPED;
      this._stateScriptDataEscaped(cp);
    }
  }
  // Script data double escape start state
  //------------------------------------------------------------------
  _stateScriptDataDoubleEscapeStart(cp) {
    if (
      this.preprocessor.startsWith(SEQUENCES.SCRIPT, false) &&
      isScriptDataDoubleEscapeSequenceEnd(this.preprocessor.peek(SEQUENCES.SCRIPT.length))
    ) {
      this._emitCodePoint(cp);
      for (let i = 0; i < SEQUENCES.SCRIPT.length; i++) {
        this._emitCodePoint(this._consume());
      }
      this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
    } else if (!this._ensureHibernation()) {
      this.state = State.SCRIPT_DATA_ESCAPED;
      this._stateScriptDataEscaped(cp);
    }
  }
  // Script data double escaped state
  //------------------------------------------------------------------
  _stateScriptDataDoubleEscaped(cp) {
    switch (cp) {
      case CODE_POINTS.HYPHEN_MINUS: {
        this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED_DASH;
        this._emitChars("-");
        break;
      }
      case CODE_POINTS.LESS_THAN_SIGN: {
        this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN;
        this._emitChars("<");
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this._emitChars(REPLACEMENT_CHARACTER);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInScriptHtmlCommentLikeText);
        this._emitEOFToken();
        break;
      }
      default: {
        this._emitCodePoint(cp);
      }
    }
  }
  // Script data double escaped dash state
  //------------------------------------------------------------------
  _stateScriptDataDoubleEscapedDash(cp) {
    switch (cp) {
      case CODE_POINTS.HYPHEN_MINUS: {
        this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH;
        this._emitChars("-");
        break;
      }
      case CODE_POINTS.LESS_THAN_SIGN: {
        this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN;
        this._emitChars("<");
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
        this._emitChars(REPLACEMENT_CHARACTER);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInScriptHtmlCommentLikeText);
        this._emitEOFToken();
        break;
      }
      default: {
        this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
        this._emitCodePoint(cp);
      }
    }
  }
  // Script data double escaped dash dash state
  //------------------------------------------------------------------
  _stateScriptDataDoubleEscapedDashDash(cp) {
    switch (cp) {
      case CODE_POINTS.HYPHEN_MINUS: {
        this._emitChars("-");
        break;
      }
      case CODE_POINTS.LESS_THAN_SIGN: {
        this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN;
        this._emitChars("<");
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.state = State.SCRIPT_DATA;
        this._emitChars(">");
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
        this._emitChars(REPLACEMENT_CHARACTER);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInScriptHtmlCommentLikeText);
        this._emitEOFToken();
        break;
      }
      default: {
        this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
        this._emitCodePoint(cp);
      }
    }
  }
  // Script data double escaped less-than sign state
  //------------------------------------------------------------------
  _stateScriptDataDoubleEscapedLessThanSign(cp) {
    if (cp === CODE_POINTS.SOLIDUS) {
      this.state = State.SCRIPT_DATA_DOUBLE_ESCAPE_END;
      this._emitChars("/");
    } else {
      this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
      this._stateScriptDataDoubleEscaped(cp);
    }
  }
  // Script data double escape end state
  //------------------------------------------------------------------
  _stateScriptDataDoubleEscapeEnd(cp) {
    if (
      this.preprocessor.startsWith(SEQUENCES.SCRIPT, false) &&
      isScriptDataDoubleEscapeSequenceEnd(this.preprocessor.peek(SEQUENCES.SCRIPT.length))
    ) {
      this._emitCodePoint(cp);
      for (let i = 0; i < SEQUENCES.SCRIPT.length; i++) {
        this._emitCodePoint(this._consume());
      }
      this.state = State.SCRIPT_DATA_ESCAPED;
    } else if (!this._ensureHibernation()) {
      this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
      this._stateScriptDataDoubleEscaped(cp);
    }
  }
  // Before attribute name state
  //------------------------------------------------------------------
  _stateBeforeAttributeName(cp) {
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        // Ignore whitespace
        break;
      }
      case CODE_POINTS.SOLIDUS:
      case CODE_POINTS.GREATER_THAN_SIGN:
      case CODE_POINTS.EOF: {
        this.state = State.AFTER_ATTRIBUTE_NAME;
        this._stateAfterAttributeName(cp);
        break;
      }
      case CODE_POINTS.EQUALS_SIGN: {
        this._err(ERR.unexpectedEqualsSignBeforeAttributeName);
        this._createAttr("=");
        this.state = State.ATTRIBUTE_NAME;
        break;
      }
      default: {
        this._createAttr("");
        this.state = State.ATTRIBUTE_NAME;
        this._stateAttributeName(cp);
      }
    }
  }
  // Attribute name state
  //------------------------------------------------------------------
  _stateAttributeName(cp) {
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED:
      case CODE_POINTS.SOLIDUS:
      case CODE_POINTS.GREATER_THAN_SIGN:
      case CODE_POINTS.EOF: {
        this._leaveAttrName();
        this.state = State.AFTER_ATTRIBUTE_NAME;
        this._stateAfterAttributeName(cp);
        break;
      }
      case CODE_POINTS.EQUALS_SIGN: {
        this._leaveAttrName();
        this.state = State.BEFORE_ATTRIBUTE_VALUE;
        break;
      }
      case CODE_POINTS.QUOTATION_MARK:
      case CODE_POINTS.APOSTROPHE:
      case CODE_POINTS.LESS_THAN_SIGN: {
        this._err(ERR.unexpectedCharacterInAttributeName);
        this.currentAttr.name += String.fromCodePoint(cp);
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this.currentAttr.name += REPLACEMENT_CHARACTER;
        break;
      }
      default: {
        this.currentAttr.name += String.fromCodePoint(isAsciiUpper(cp) ? toAsciiLower(cp) : cp);
      }
    }
  }
  // After attribute name state
  //------------------------------------------------------------------
  _stateAfterAttributeName(cp) {
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        // Ignore whitespace
        break;
      }
      case CODE_POINTS.SOLIDUS: {
        this.state = State.SELF_CLOSING_START_TAG;
        break;
      }
      case CODE_POINTS.EQUALS_SIGN: {
        this.state = State.BEFORE_ATTRIBUTE_VALUE;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.state = State.DATA;
        this.emitCurrentTagToken();
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInTag);
        this._emitEOFToken();
        break;
      }
      default: {
        this._createAttr("");
        this.state = State.ATTRIBUTE_NAME;
        this._stateAttributeName(cp);
      }
    }
  }
  // Before attribute value state
  //------------------------------------------------------------------
  _stateBeforeAttributeValue(cp) {
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        // Ignore whitespace
        break;
      }
      case CODE_POINTS.QUOTATION_MARK: {
        this.state = State.ATTRIBUTE_VALUE_DOUBLE_QUOTED;
        break;
      }
      case CODE_POINTS.APOSTROPHE: {
        this.state = State.ATTRIBUTE_VALUE_SINGLE_QUOTED;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._err(ERR.missingAttributeValue);
        this.state = State.DATA;
        this.emitCurrentTagToken();
        break;
      }
      default: {
        this.state = State.ATTRIBUTE_VALUE_UNQUOTED;
        this._stateAttributeValueUnquoted(cp);
      }
    }
  }
  // Attribute value (double-quoted) state
  //------------------------------------------------------------------
  _stateAttributeValueDoubleQuoted(cp) {
    switch (cp) {
      case CODE_POINTS.QUOTATION_MARK: {
        this.state = State.AFTER_ATTRIBUTE_VALUE_QUOTED;
        break;
      }
      case CODE_POINTS.AMPERSAND: {
        this._startCharacterReference();
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this.currentAttr.value += REPLACEMENT_CHARACTER;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInTag);
        this._emitEOFToken();
        break;
      }
      default: {
        this.currentAttr.value += String.fromCodePoint(cp);
      }
    }
  }
  // Attribute value (single-quoted) state
  //------------------------------------------------------------------
  _stateAttributeValueSingleQuoted(cp) {
    switch (cp) {
      case CODE_POINTS.APOSTROPHE: {
        this.state = State.AFTER_ATTRIBUTE_VALUE_QUOTED;
        break;
      }
      case CODE_POINTS.AMPERSAND: {
        this._startCharacterReference();
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this.currentAttr.value += REPLACEMENT_CHARACTER;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInTag);
        this._emitEOFToken();
        break;
      }
      default: {
        this.currentAttr.value += String.fromCodePoint(cp);
      }
    }
  }
  // Attribute value (unquoted) state
  //------------------------------------------------------------------
  _stateAttributeValueUnquoted(cp) {
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        this._leaveAttrValue();
        this.state = State.BEFORE_ATTRIBUTE_NAME;
        break;
      }
      case CODE_POINTS.AMPERSAND: {
        this._startCharacterReference();
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._leaveAttrValue();
        this.state = State.DATA;
        this.emitCurrentTagToken();
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        this.currentAttr.value += REPLACEMENT_CHARACTER;
        break;
      }
      case CODE_POINTS.QUOTATION_MARK:
      case CODE_POINTS.APOSTROPHE:
      case CODE_POINTS.LESS_THAN_SIGN:
      case CODE_POINTS.EQUALS_SIGN:
      case CODE_POINTS.GRAVE_ACCENT: {
        this._err(ERR.unexpectedCharacterInUnquotedAttributeValue);
        this.currentAttr.value += String.fromCodePoint(cp);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInTag);
        this._emitEOFToken();
        break;
      }
      default: {
        this.currentAttr.value += String.fromCodePoint(cp);
      }
    }
  }
  // After attribute value (quoted) state
  //------------------------------------------------------------------
  _stateAfterAttributeValueQuoted(cp) {
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        this._leaveAttrValue();
        this.state = State.BEFORE_ATTRIBUTE_NAME;
        break;
      }
      case CODE_POINTS.SOLIDUS: {
        this._leaveAttrValue();
        this.state = State.SELF_CLOSING_START_TAG;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._leaveAttrValue();
        this.state = State.DATA;
        this.emitCurrentTagToken();
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInTag);
        this._emitEOFToken();
        break;
      }
      default: {
        this._err(ERR.missingWhitespaceBetweenAttributes);
        this.state = State.BEFORE_ATTRIBUTE_NAME;
        this._stateBeforeAttributeName(cp);
      }
    }
  }
  // Self-closing start tag state
  //------------------------------------------------------------------
  _stateSelfClosingStartTag(cp) {
    switch (cp) {
      case CODE_POINTS.GREATER_THAN_SIGN: {
        const token = this.currentToken;
        token.selfClosing = true;
        this.state = State.DATA;
        this.emitCurrentTagToken();
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInTag);
        this._emitEOFToken();
        break;
      }
      default: {
        this._err(ERR.unexpectedSolidusInTag);
        this.state = State.BEFORE_ATTRIBUTE_NAME;
        this._stateBeforeAttributeName(cp);
      }
    }
  }
  // Bogus comment state
  //------------------------------------------------------------------
  _stateBogusComment(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.state = State.DATA;
        this.emitCurrentComment(token);
        break;
      }
      case CODE_POINTS.EOF: {
        this.emitCurrentComment(token);
        this._emitEOFToken();
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        token.data += REPLACEMENT_CHARACTER;
        break;
      }
      default: {
        token.data += String.fromCodePoint(cp);
      }
    }
  }
  // Markup declaration open state
  //------------------------------------------------------------------
  _stateMarkupDeclarationOpen(cp) {
    if (this._consumeSequenceIfMatch(SEQUENCES.DASH_DASH, true)) {
      this._createCommentToken(SEQUENCES.DASH_DASH.length + 1);
      this.state = State.COMMENT_START;
    } else if (this._consumeSequenceIfMatch(SEQUENCES.DOCTYPE, false)) {
      // NOTE: Doctypes tokens are created without fixed offsets. We keep track of the moment a doctype *might* start here.
      this.currentLocation = this.getCurrentLocation(SEQUENCES.DOCTYPE.length + 1);
      this.state = State.DOCTYPE;
    } else if (this._consumeSequenceIfMatch(SEQUENCES.CDATA_START, true)) {
      if (this.inForeignNode) {
        this.state = State.CDATA_SECTION;
      } else {
        this._err(ERR.cdataInHtmlContent);
        this._createCommentToken(SEQUENCES.CDATA_START.length + 1);
        this.currentToken.data = "[CDATA[";
        this.state = State.BOGUS_COMMENT;
      }
    }
    //NOTE: Sequence lookups can be abrupted by hibernation. In that case, lookup
    //results are no longer valid and we will need to start over.
    else if (!this._ensureHibernation()) {
      this._err(ERR.incorrectlyOpenedComment);
      this._createCommentToken(2);
      this.state = State.BOGUS_COMMENT;
      this._stateBogusComment(cp);
    }
  }
  // Comment start state
  //------------------------------------------------------------------
  _stateCommentStart(cp) {
    switch (cp) {
      case CODE_POINTS.HYPHEN_MINUS: {
        this.state = State.COMMENT_START_DASH;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._err(ERR.abruptClosingOfEmptyComment);
        this.state = State.DATA;
        const token = this.currentToken;
        this.emitCurrentComment(token);
        break;
      }
      default: {
        this.state = State.COMMENT;
        this._stateComment(cp);
      }
    }
  }
  // Comment start dash state
  //------------------------------------------------------------------
  _stateCommentStartDash(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.HYPHEN_MINUS: {
        this.state = State.COMMENT_END;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._err(ERR.abruptClosingOfEmptyComment);
        this.state = State.DATA;
        this.emitCurrentComment(token);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInComment);
        this.emitCurrentComment(token);
        this._emitEOFToken();
        break;
      }
      default: {
        token.data += "-";
        this.state = State.COMMENT;
        this._stateComment(cp);
      }
    }
  }
  // Comment state
  //------------------------------------------------------------------
  _stateComment(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.HYPHEN_MINUS: {
        this.state = State.COMMENT_END_DASH;
        break;
      }
      case CODE_POINTS.LESS_THAN_SIGN: {
        token.data += "<";
        this.state = State.COMMENT_LESS_THAN_SIGN;
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        token.data += REPLACEMENT_CHARACTER;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInComment);
        this.emitCurrentComment(token);
        this._emitEOFToken();
        break;
      }
      default: {
        token.data += String.fromCodePoint(cp);
      }
    }
  }
  // Comment less-than sign state
  //------------------------------------------------------------------
  _stateCommentLessThanSign(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.EXCLAMATION_MARK: {
        token.data += "!";
        this.state = State.COMMENT_LESS_THAN_SIGN_BANG;
        break;
      }
      case CODE_POINTS.LESS_THAN_SIGN: {
        token.data += "<";
        break;
      }
      default: {
        this.state = State.COMMENT;
        this._stateComment(cp);
      }
    }
  }
  // Comment less-than sign bang state
  //------------------------------------------------------------------
  _stateCommentLessThanSignBang(cp) {
    if (cp === CODE_POINTS.HYPHEN_MINUS) {
      this.state = State.COMMENT_LESS_THAN_SIGN_BANG_DASH;
    } else {
      this.state = State.COMMENT;
      this._stateComment(cp);
    }
  }
  // Comment less-than sign bang dash state
  //------------------------------------------------------------------
  _stateCommentLessThanSignBangDash(cp) {
    if (cp === CODE_POINTS.HYPHEN_MINUS) {
      this.state = State.COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH;
    } else {
      this.state = State.COMMENT_END_DASH;
      this._stateCommentEndDash(cp);
    }
  }
  // Comment less-than sign bang dash dash state
  //------------------------------------------------------------------
  _stateCommentLessThanSignBangDashDash(cp) {
    if (cp !== CODE_POINTS.GREATER_THAN_SIGN && cp !== CODE_POINTS.EOF) {
      this._err(ERR.nestedComment);
    }
    this.state = State.COMMENT_END;
    this._stateCommentEnd(cp);
  }
  // Comment end dash state
  //------------------------------------------------------------------
  _stateCommentEndDash(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.HYPHEN_MINUS: {
        this.state = State.COMMENT_END;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInComment);
        this.emitCurrentComment(token);
        this._emitEOFToken();
        break;
      }
      default: {
        token.data += "-";
        this.state = State.COMMENT;
        this._stateComment(cp);
      }
    }
  }
  // Comment end state
  //------------------------------------------------------------------
  _stateCommentEnd(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.state = State.DATA;
        this.emitCurrentComment(token);
        break;
      }
      case CODE_POINTS.EXCLAMATION_MARK: {
        this.state = State.COMMENT_END_BANG;
        break;
      }
      case CODE_POINTS.HYPHEN_MINUS: {
        token.data += "-";
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInComment);
        this.emitCurrentComment(token);
        this._emitEOFToken();
        break;
      }
      default: {
        token.data += "--";
        this.state = State.COMMENT;
        this._stateComment(cp);
      }
    }
  }
  // Comment end bang state
  //------------------------------------------------------------------
  _stateCommentEndBang(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.HYPHEN_MINUS: {
        token.data += "--!";
        this.state = State.COMMENT_END_DASH;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._err(ERR.incorrectlyClosedComment);
        this.state = State.DATA;
        this.emitCurrentComment(token);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInComment);
        this.emitCurrentComment(token);
        this._emitEOFToken();
        break;
      }
      default: {
        token.data += "--!";
        this.state = State.COMMENT;
        this._stateComment(cp);
      }
    }
  }
  // DOCTYPE state
  //------------------------------------------------------------------
  _stateDoctype(cp) {
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        this.state = State.BEFORE_DOCTYPE_NAME;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.state = State.BEFORE_DOCTYPE_NAME;
        this._stateBeforeDoctypeName(cp);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        this._createDoctypeToken(null);
        const token = this.currentToken;
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        this._err(ERR.missingWhitespaceBeforeDoctypeName);
        this.state = State.BEFORE_DOCTYPE_NAME;
        this._stateBeforeDoctypeName(cp);
      }
    }
  }
  // Before DOCTYPE name state
  //------------------------------------------------------------------
  _stateBeforeDoctypeName(cp) {
    if (isAsciiUpper(cp)) {
      this._createDoctypeToken(String.fromCharCode(toAsciiLower(cp)));
      this.state = State.DOCTYPE_NAME;
    } else
      switch (cp) {
        case CODE_POINTS.SPACE:
        case CODE_POINTS.LINE_FEED:
        case CODE_POINTS.TABULATION:
        case CODE_POINTS.FORM_FEED: {
          // Ignore whitespace
          break;
        }
        case CODE_POINTS.NULL: {
          this._err(ERR.unexpectedNullCharacter);
          this._createDoctypeToken(REPLACEMENT_CHARACTER);
          this.state = State.DOCTYPE_NAME;
          break;
        }
        case CODE_POINTS.GREATER_THAN_SIGN: {
          this._err(ERR.missingDoctypeName);
          this._createDoctypeToken(null);
          const token = this.currentToken;
          token.forceQuirks = true;
          this.emitCurrentDoctype(token);
          this.state = State.DATA;
          break;
        }
        case CODE_POINTS.EOF: {
          this._err(ERR.eofInDoctype);
          this._createDoctypeToken(null);
          const token = this.currentToken;
          token.forceQuirks = true;
          this.emitCurrentDoctype(token);
          this._emitEOFToken();
          break;
        }
        default: {
          this._createDoctypeToken(String.fromCodePoint(cp));
          this.state = State.DOCTYPE_NAME;
        }
      }
  }
  // DOCTYPE name state
  //------------------------------------------------------------------
  _stateDoctypeName(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        this.state = State.AFTER_DOCTYPE_NAME;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.state = State.DATA;
        this.emitCurrentDoctype(token);
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        token.name += REPLACEMENT_CHARACTER;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        token.name += String.fromCodePoint(isAsciiUpper(cp) ? toAsciiLower(cp) : cp);
      }
    }
  }
  // After DOCTYPE name state
  //------------------------------------------------------------------
  _stateAfterDoctypeName(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        // Ignore whitespace
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.state = State.DATA;
        this.emitCurrentDoctype(token);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        if (this._consumeSequenceIfMatch(SEQUENCES.PUBLIC, false)) {
          this.state = State.AFTER_DOCTYPE_PUBLIC_KEYWORD;
        } else if (this._consumeSequenceIfMatch(SEQUENCES.SYSTEM, false)) {
          this.state = State.AFTER_DOCTYPE_SYSTEM_KEYWORD;
        }
        //NOTE: sequence lookup can be abrupted by hibernation. In that case lookup
        //results are no longer valid and we will need to start over.
        else if (!this._ensureHibernation()) {
          this._err(ERR.invalidCharacterSequenceAfterDoctypeName);
          token.forceQuirks = true;
          this.state = State.BOGUS_DOCTYPE;
          this._stateBogusDoctype(cp);
        }
      }
    }
  }
  // After DOCTYPE public keyword state
  //------------------------------------------------------------------
  _stateAfterDoctypePublicKeyword(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        this.state = State.BEFORE_DOCTYPE_PUBLIC_IDENTIFIER;
        break;
      }
      case CODE_POINTS.QUOTATION_MARK: {
        this._err(ERR.missingWhitespaceAfterDoctypePublicKeyword);
        token.publicId = "";
        this.state = State.DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED;
        break;
      }
      case CODE_POINTS.APOSTROPHE: {
        this._err(ERR.missingWhitespaceAfterDoctypePublicKeyword);
        token.publicId = "";
        this.state = State.DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._err(ERR.missingDoctypePublicIdentifier);
        token.forceQuirks = true;
        this.state = State.DATA;
        this.emitCurrentDoctype(token);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        this._err(ERR.missingQuoteBeforeDoctypePublicIdentifier);
        token.forceQuirks = true;
        this.state = State.BOGUS_DOCTYPE;
        this._stateBogusDoctype(cp);
      }
    }
  }
  // Before DOCTYPE public identifier state
  //------------------------------------------------------------------
  _stateBeforeDoctypePublicIdentifier(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        // Ignore whitespace
        break;
      }
      case CODE_POINTS.QUOTATION_MARK: {
        token.publicId = "";
        this.state = State.DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED;
        break;
      }
      case CODE_POINTS.APOSTROPHE: {
        token.publicId = "";
        this.state = State.DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._err(ERR.missingDoctypePublicIdentifier);
        token.forceQuirks = true;
        this.state = State.DATA;
        this.emitCurrentDoctype(token);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        this._err(ERR.missingQuoteBeforeDoctypePublicIdentifier);
        token.forceQuirks = true;
        this.state = State.BOGUS_DOCTYPE;
        this._stateBogusDoctype(cp);
      }
    }
  }
  // DOCTYPE public identifier (double-quoted) state
  //------------------------------------------------------------------
  _stateDoctypePublicIdentifierDoubleQuoted(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.QUOTATION_MARK: {
        this.state = State.AFTER_DOCTYPE_PUBLIC_IDENTIFIER;
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        token.publicId += REPLACEMENT_CHARACTER;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._err(ERR.abruptDoctypePublicIdentifier);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this.state = State.DATA;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        token.publicId += String.fromCodePoint(cp);
      }
    }
  }
  // DOCTYPE public identifier (single-quoted) state
  //------------------------------------------------------------------
  _stateDoctypePublicIdentifierSingleQuoted(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.APOSTROPHE: {
        this.state = State.AFTER_DOCTYPE_PUBLIC_IDENTIFIER;
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        token.publicId += REPLACEMENT_CHARACTER;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._err(ERR.abruptDoctypePublicIdentifier);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this.state = State.DATA;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        token.publicId += String.fromCodePoint(cp);
      }
    }
  }
  // After DOCTYPE public identifier state
  //------------------------------------------------------------------
  _stateAfterDoctypePublicIdentifier(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        this.state = State.BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.state = State.DATA;
        this.emitCurrentDoctype(token);
        break;
      }
      case CODE_POINTS.QUOTATION_MARK: {
        this._err(ERR.missingWhitespaceBetweenDoctypePublicAndSystemIdentifiers);
        token.systemId = "";
        this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED;
        break;
      }
      case CODE_POINTS.APOSTROPHE: {
        this._err(ERR.missingWhitespaceBetweenDoctypePublicAndSystemIdentifiers);
        token.systemId = "";
        this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        this._err(ERR.missingQuoteBeforeDoctypeSystemIdentifier);
        token.forceQuirks = true;
        this.state = State.BOGUS_DOCTYPE;
        this._stateBogusDoctype(cp);
      }
    }
  }
  // Between DOCTYPE public and system identifiers state
  //------------------------------------------------------------------
  _stateBetweenDoctypePublicAndSystemIdentifiers(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        // Ignore whitespace
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.emitCurrentDoctype(token);
        this.state = State.DATA;
        break;
      }
      case CODE_POINTS.QUOTATION_MARK: {
        token.systemId = "";
        this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED;
        break;
      }
      case CODE_POINTS.APOSTROPHE: {
        token.systemId = "";
        this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        this._err(ERR.missingQuoteBeforeDoctypeSystemIdentifier);
        token.forceQuirks = true;
        this.state = State.BOGUS_DOCTYPE;
        this._stateBogusDoctype(cp);
      }
    }
  }
  // After DOCTYPE system keyword state
  //------------------------------------------------------------------
  _stateAfterDoctypeSystemKeyword(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        this.state = State.BEFORE_DOCTYPE_SYSTEM_IDENTIFIER;
        break;
      }
      case CODE_POINTS.QUOTATION_MARK: {
        this._err(ERR.missingWhitespaceAfterDoctypeSystemKeyword);
        token.systemId = "";
        this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED;
        break;
      }
      case CODE_POINTS.APOSTROPHE: {
        this._err(ERR.missingWhitespaceAfterDoctypeSystemKeyword);
        token.systemId = "";
        this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._err(ERR.missingDoctypeSystemIdentifier);
        token.forceQuirks = true;
        this.state = State.DATA;
        this.emitCurrentDoctype(token);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        this._err(ERR.missingQuoteBeforeDoctypeSystemIdentifier);
        token.forceQuirks = true;
        this.state = State.BOGUS_DOCTYPE;
        this._stateBogusDoctype(cp);
      }
    }
  }
  // Before DOCTYPE system identifier state
  //------------------------------------------------------------------
  _stateBeforeDoctypeSystemIdentifier(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        // Ignore whitespace
        break;
      }
      case CODE_POINTS.QUOTATION_MARK: {
        token.systemId = "";
        this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED;
        break;
      }
      case CODE_POINTS.APOSTROPHE: {
        token.systemId = "";
        this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._err(ERR.missingDoctypeSystemIdentifier);
        token.forceQuirks = true;
        this.state = State.DATA;
        this.emitCurrentDoctype(token);
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        this._err(ERR.missingQuoteBeforeDoctypeSystemIdentifier);
        token.forceQuirks = true;
        this.state = State.BOGUS_DOCTYPE;
        this._stateBogusDoctype(cp);
      }
    }
  }
  // DOCTYPE system identifier (double-quoted) state
  //------------------------------------------------------------------
  _stateDoctypeSystemIdentifierDoubleQuoted(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.QUOTATION_MARK: {
        this.state = State.AFTER_DOCTYPE_SYSTEM_IDENTIFIER;
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        token.systemId += REPLACEMENT_CHARACTER;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._err(ERR.abruptDoctypeSystemIdentifier);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this.state = State.DATA;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        token.systemId += String.fromCodePoint(cp);
      }
    }
  }
  // DOCTYPE system identifier (single-quoted) state
  //------------------------------------------------------------------
  _stateDoctypeSystemIdentifierSingleQuoted(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.APOSTROPHE: {
        this.state = State.AFTER_DOCTYPE_SYSTEM_IDENTIFIER;
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        token.systemId += REPLACEMENT_CHARACTER;
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this._err(ERR.abruptDoctypeSystemIdentifier);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this.state = State.DATA;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        token.systemId += String.fromCodePoint(cp);
      }
    }
  }
  // After DOCTYPE system identifier state
  //------------------------------------------------------------------
  _stateAfterDoctypeSystemIdentifier(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.SPACE:
      case CODE_POINTS.LINE_FEED:
      case CODE_POINTS.TABULATION:
      case CODE_POINTS.FORM_FEED: {
        // Ignore whitespace
        break;
      }
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.emitCurrentDoctype(token);
        this.state = State.DATA;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInDoctype);
        token.forceQuirks = true;
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      default: {
        this._err(ERR.unexpectedCharacterAfterDoctypeSystemIdentifier);
        this.state = State.BOGUS_DOCTYPE;
        this._stateBogusDoctype(cp);
      }
    }
  }
  // Bogus DOCTYPE state
  //------------------------------------------------------------------
  _stateBogusDoctype(cp) {
    const token = this.currentToken;
    switch (cp) {
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.emitCurrentDoctype(token);
        this.state = State.DATA;
        break;
      }
      case CODE_POINTS.NULL: {
        this._err(ERR.unexpectedNullCharacter);
        break;
      }
      case CODE_POINTS.EOF: {
        this.emitCurrentDoctype(token);
        this._emitEOFToken();
        break;
      }
      // Do nothing
    }
  }
  // CDATA section state
  //------------------------------------------------------------------
  _stateCdataSection(cp) {
    switch (cp) {
      case CODE_POINTS.RIGHT_SQUARE_BRACKET: {
        this.state = State.CDATA_SECTION_BRACKET;
        break;
      }
      case CODE_POINTS.EOF: {
        this._err(ERR.eofInCdata);
        this._emitEOFToken();
        break;
      }
      default: {
        this._emitCodePoint(cp);
      }
    }
  }
  // CDATA section bracket state
  //------------------------------------------------------------------
  _stateCdataSectionBracket(cp) {
    if (cp === CODE_POINTS.RIGHT_SQUARE_BRACKET) {
      this.state = State.CDATA_SECTION_END;
    } else {
      this._emitChars("]");
      this.state = State.CDATA_SECTION;
      this._stateCdataSection(cp);
    }
  }
  // CDATA section end state
  //------------------------------------------------------------------
  _stateCdataSectionEnd(cp) {
    switch (cp) {
      case CODE_POINTS.GREATER_THAN_SIGN: {
        this.state = State.DATA;
        break;
      }
      case CODE_POINTS.RIGHT_SQUARE_BRACKET: {
        this._emitChars("]");
        break;
      }
      default: {
        this._emitChars("]]");
        this.state = State.CDATA_SECTION;
        this._stateCdataSection(cp);
      }
    }
  }
  // Character reference state
  //------------------------------------------------------------------
  _stateCharacterReference() {
    let length = this.entityDecoder.write(this.preprocessor.html, this.preprocessor.pos);
    if (length < 0) {
      if (this.preprocessor.lastChunkWritten) {
        length = this.entityDecoder.end();
      } else {
        // Wait for the rest of the entity.
        this.active = false;
        // Mark the entire buffer as read.
        this.preprocessor.pos = this.preprocessor.html.length - 1;
        this.consumedAfterSnapshot = 0;
        this.preprocessor.endOfChunkHit = true;
        return;
      }
    }
    if (length === 0) {
      // This was not a valid entity. Go back to the beginning, and
      // figure out what to do.
      this.preprocessor.pos = this.entityStartPos;
      this._flushCodePointConsumedAsCharacterReference(CODE_POINTS.AMPERSAND);
      this.state =
        !this._isCharacterReferenceInAttribute() && isAsciiAlphaNumeric(this.preprocessor.peek(1))
          ? State.AMBIGUOUS_AMPERSAND
          : this.returnState;
    } else {
      // We successfully parsed an entity. Switch to the return state.
      this.state = this.returnState;
    }
  }
  // Ambiguos ampersand state
  //------------------------------------------------------------------
  _stateAmbiguousAmpersand(cp) {
    if (isAsciiAlphaNumeric(cp)) {
      this._flushCodePointConsumedAsCharacterReference(cp);
    } else {
      if (cp === CODE_POINTS.SEMICOLON) {
        this._err(ERR.unknownNamedCharacterReference);
      }
      this.state = this.returnState;
      this._callState(cp);
    }
  }
}

//Element utils
const IMPLICIT_END_TAG_REQUIRED = new Set([
  TAG_ID.DD,
  TAG_ID.DT,
  TAG_ID.LI,
  TAG_ID.OPTGROUP,
  TAG_ID.OPTION,
  TAG_ID.P,
  TAG_ID.RB,
  TAG_ID.RP,
  TAG_ID.RT,
  TAG_ID.RTC
]);
const IMPLICIT_END_TAG_REQUIRED_THOROUGHLY = new Set([
  ...IMPLICIT_END_TAG_REQUIRED,
  TAG_ID.CAPTION,
  TAG_ID.COLGROUP,
  TAG_ID.TBODY,
  TAG_ID.TD,
  TAG_ID.TFOOT,
  TAG_ID.TH,
  TAG_ID.THEAD,
  TAG_ID.TR
]);
const SCOPING_ELEMENTS_HTML = new Set([
  TAG_ID.APPLET,
  TAG_ID.CAPTION,
  TAG_ID.HTML,
  TAG_ID.MARQUEE,
  TAG_ID.OBJECT,
  TAG_ID.TABLE,
  TAG_ID.TD,
  TAG_ID.TEMPLATE,
  TAG_ID.TH
]);
const SCOPING_ELEMENTS_HTML_LIST = new Set([...SCOPING_ELEMENTS_HTML, TAG_ID.OL, TAG_ID.UL]);
const SCOPING_ELEMENTS_HTML_BUTTON = new Set([...SCOPING_ELEMENTS_HTML, TAG_ID.BUTTON]);
const SCOPING_ELEMENTS_MATHML = new Set([
  TAG_ID.ANNOTATION_XML,
  TAG_ID.MI,
  TAG_ID.MN,
  TAG_ID.MO,
  TAG_ID.MS,
  TAG_ID.MTEXT
]);
const SCOPING_ELEMENTS_SVG = new Set([TAG_ID.DESC, TAG_ID.FOREIGN_OBJECT, TAG_ID.TITLE]);
const TABLE_ROW_CONTEXT = new Set([TAG_ID.TR, TAG_ID.TEMPLATE, TAG_ID.HTML]);
const TABLE_BODY_CONTEXT = new Set([
  TAG_ID.TBODY,
  TAG_ID.TFOOT,
  TAG_ID.THEAD,
  TAG_ID.TEMPLATE,
  TAG_ID.HTML
]);
const TABLE_CONTEXT = new Set([TAG_ID.TABLE, TAG_ID.TEMPLATE, TAG_ID.HTML]);
const TABLE_CELLS = new Set([TAG_ID.TD, TAG_ID.TH]);
//Stack of open elements
class OpenElementStack {
  get currentTmplContentOrNode() {
    return this._isInTemplate() ? this.treeAdapter.getTemplateContent(this.current) : this.current;
  }
  constructor(document, treeAdapter, handler) {
    this.treeAdapter = treeAdapter;
    this.handler = handler;
    this.items = [];
    this.tagIDs = [];
    this.stackTop = -1;
    this.tmplCount = 0;
    this.currentTagId = TAG_ID.UNKNOWN;
    this.current = document;
  }
  //Index of element
  _indexOf(element) {
    return this.items.lastIndexOf(element, this.stackTop);
  }
  //Update current element
  _isInTemplate() {
    return (
      this.currentTagId === TAG_ID.TEMPLATE &&
      this.treeAdapter.getNamespaceURI(this.current) === NS.HTML
    );
  }
  _updateCurrentElement() {
    this.current = this.items[this.stackTop];
    this.currentTagId = this.tagIDs[this.stackTop];
  }
  //Mutations
  push(element, tagID) {
    this.stackTop++;
    this.items[this.stackTop] = element;
    this.current = element;
    this.tagIDs[this.stackTop] = tagID;
    this.currentTagId = tagID;
    if (this._isInTemplate()) {
      this.tmplCount++;
    }
    this.handler.onItemPush(element, tagID, true);
  }
  pop() {
    const popped = this.current;
    if (this.tmplCount > 0 && this._isInTemplate()) {
      this.tmplCount--;
    }
    this.stackTop--;
    this._updateCurrentElement();
    this.handler.onItemPop(popped, true);
  }
  replace(oldElement, newElement) {
    const idx = this._indexOf(oldElement);
    this.items[idx] = newElement;
    if (idx === this.stackTop) {
      this.current = newElement;
    }
  }
  insertAfter(referenceElement, newElement, newElementID) {
    const insertionIdx = this._indexOf(referenceElement) + 1;
    this.items.splice(insertionIdx, 0, newElement);
    this.tagIDs.splice(insertionIdx, 0, newElementID);
    this.stackTop++;
    if (insertionIdx === this.stackTop) {
      this._updateCurrentElement();
    }
    if (this.current && this.currentTagId !== undefined) {
      this.handler.onItemPush(this.current, this.currentTagId, insertionIdx === this.stackTop);
    }
  }
  popUntilTagNamePopped(tagName) {
    let targetIdx = this.stackTop + 1;
    do {
      targetIdx = this.tagIDs.lastIndexOf(tagName, targetIdx - 1);
    } while (targetIdx > 0 && this.treeAdapter.getNamespaceURI(this.items[targetIdx]) !== NS.HTML);
    this.shortenToLength(Math.max(targetIdx, 0));
  }
  shortenToLength(idx) {
    while (this.stackTop >= idx) {
      const popped = this.current;
      if (this.tmplCount > 0 && this._isInTemplate()) {
        this.tmplCount -= 1;
      }
      this.stackTop--;
      this._updateCurrentElement();
      this.handler.onItemPop(popped, this.stackTop < idx);
    }
  }
  popUntilElementPopped(element) {
    const idx = this._indexOf(element);
    this.shortenToLength(Math.max(idx, 0));
  }
  popUntilPopped(tagNames, targetNS) {
    const idx = this._indexOfTagNames(tagNames, targetNS);
    this.shortenToLength(Math.max(idx, 0));
  }
  popUntilNumberedHeaderPopped() {
    this.popUntilPopped(NUMBERED_HEADERS, NS.HTML);
  }
  popUntilTableCellPopped() {
    this.popUntilPopped(TABLE_CELLS, NS.HTML);
  }
  popAllUpToHtmlElement() {
    //NOTE: here we assume that the root <html> element is always first in the open element stack, so
    //we perform this fast stack clean up.
    this.tmplCount = 0;
    this.shortenToLength(1);
  }
  _indexOfTagNames(tagNames, namespace) {
    for (let i = this.stackTop; i >= 0; i--) {
      if (
        tagNames.has(this.tagIDs[i]) &&
        this.treeAdapter.getNamespaceURI(this.items[i]) === namespace
      ) {
        return i;
      }
    }
    return -1;
  }
  clearBackTo(tagNames, targetNS) {
    const idx = this._indexOfTagNames(tagNames, targetNS);
    this.shortenToLength(idx + 1);
  }
  clearBackToTableContext() {
    this.clearBackTo(TABLE_CONTEXT, NS.HTML);
  }
  clearBackToTableBodyContext() {
    this.clearBackTo(TABLE_BODY_CONTEXT, NS.HTML);
  }
  clearBackToTableRowContext() {
    this.clearBackTo(TABLE_ROW_CONTEXT, NS.HTML);
  }
  remove(element) {
    const idx = this._indexOf(element);
    if (idx >= 0) {
      if (idx === this.stackTop) {
        this.pop();
      } else {
        this.items.splice(idx, 1);
        this.tagIDs.splice(idx, 1);
        this.stackTop--;
        this._updateCurrentElement();
        this.handler.onItemPop(element, false);
      }
    }
  }
  //Search
  tryPeekProperlyNestedBodyElement() {
    //Properly nested <body> element (should be second element in stack).
    return this.stackTop >= 1 && this.tagIDs[1] === TAG_ID.BODY ? this.items[1] : null;
  }
  contains(element) {
    return this._indexOf(element) > -1;
  }
  getCommonAncestor(element) {
    const elementIdx = this._indexOf(element) - 1;
    return elementIdx >= 0 ? this.items[elementIdx] : null;
  }
  isRootHtmlElementCurrent() {
    return this.stackTop === 0 && this.tagIDs[0] === TAG_ID.HTML;
  }
  //Element in scope
  hasInDynamicScope(tagName, htmlScope) {
    for (let i = this.stackTop; i >= 0; i--) {
      const tn = this.tagIDs[i];
      switch (this.treeAdapter.getNamespaceURI(this.items[i])) {
        case NS.HTML: {
          if (tn === tagName) return true;
          if (htmlScope.has(tn)) return false;
          break;
        }
        case NS.SVG: {
          if (SCOPING_ELEMENTS_SVG.has(tn)) return false;
          break;
        }
        case NS.MATHML: {
          if (SCOPING_ELEMENTS_MATHML.has(tn)) return false;
          break;
        }
      }
    }
    return true;
  }
  hasInScope(tagName) {
    return this.hasInDynamicScope(tagName, SCOPING_ELEMENTS_HTML);
  }
  hasInListItemScope(tagName) {
    return this.hasInDynamicScope(tagName, SCOPING_ELEMENTS_HTML_LIST);
  }
  hasInButtonScope(tagName) {
    return this.hasInDynamicScope(tagName, SCOPING_ELEMENTS_HTML_BUTTON);
  }
  hasNumberedHeaderInScope() {
    for (let i = this.stackTop; i >= 0; i--) {
      const tn = this.tagIDs[i];
      switch (this.treeAdapter.getNamespaceURI(this.items[i])) {
        case NS.HTML: {
          if (NUMBERED_HEADERS.has(tn)) return true;
          if (SCOPING_ELEMENTS_HTML.has(tn)) return false;
          break;
        }
        case NS.SVG: {
          if (SCOPING_ELEMENTS_SVG.has(tn)) return false;
          break;
        }
        case NS.MATHML: {
          if (SCOPING_ELEMENTS_MATHML.has(tn)) return false;
          break;
        }
      }
    }
    return true;
  }
  hasInTableScope(tagName) {
    for (let i = this.stackTop; i >= 0; i--) {
      if (this.treeAdapter.getNamespaceURI(this.items[i]) !== NS.HTML) {
        continue;
      }
      switch (this.tagIDs[i]) {
        case tagName: {
          return true;
        }
        case TAG_ID.TABLE:
        case TAG_ID.HTML: {
          return false;
        }
      }
    }
    return true;
  }
  hasTableBodyContextInTableScope() {
    for (let i = this.stackTop; i >= 0; i--) {
      if (this.treeAdapter.getNamespaceURI(this.items[i]) !== NS.HTML) {
        continue;
      }
      switch (this.tagIDs[i]) {
        case TAG_ID.TBODY:
        case TAG_ID.THEAD:
        case TAG_ID.TFOOT: {
          return true;
        }
        case TAG_ID.TABLE:
        case TAG_ID.HTML: {
          return false;
        }
      }
    }
    return true;
  }
  hasInSelectScope(tagName) {
    for (let i = this.stackTop; i >= 0; i--) {
      if (this.treeAdapter.getNamespaceURI(this.items[i]) !== NS.HTML) {
        continue;
      }
      switch (this.tagIDs[i]) {
        case tagName: {
          return true;
        }
        case TAG_ID.OPTION:
        case TAG_ID.OPTGROUP: {
          break;
        }
        default: {
          return false;
        }
      }
    }
    return true;
  }
  //Implied end tags
  generateImpliedEndTags() {
    while (this.currentTagId !== undefined && IMPLICIT_END_TAG_REQUIRED.has(this.currentTagId)) {
      this.pop();
    }
  }
  generateImpliedEndTagsThoroughly() {
    while (
      this.currentTagId !== undefined &&
      IMPLICIT_END_TAG_REQUIRED_THOROUGHLY.has(this.currentTagId)
    ) {
      this.pop();
    }
  }
  generateImpliedEndTagsWithExclusion(exclusionId) {
    while (
      this.currentTagId !== undefined &&
      this.currentTagId !== exclusionId &&
      IMPLICIT_END_TAG_REQUIRED_THOROUGHLY.has(this.currentTagId)
    ) {
      this.pop();
    }
  }
}

//Const
const NOAH_ARK_CAPACITY = 3;
var EntryType;
(function (EntryType) {
  EntryType[(EntryType["Marker"] = 0)] = "Marker";
  EntryType[(EntryType["Element"] = 1)] = "Element";
})(EntryType || (EntryType = {}));
const MARKER = { type: EntryType.Marker };
//List of formatting elements
class FormattingElementList {
  constructor(treeAdapter) {
    this.treeAdapter = treeAdapter;
    this.entries = [];
    this.bookmark = null;
  }
  //Noah Ark's condition
  //OPTIMIZATION: at first we try to find possible candidates for exclusion using
  //lightweight heuristics without thorough attributes check.
  _getNoahArkConditionCandidates(newElement, neAttrs) {
    const candidates = [];
    const neAttrsLength = neAttrs.length;
    const neTagName = this.treeAdapter.getTagName(newElement);
    const neNamespaceURI = this.treeAdapter.getNamespaceURI(newElement);
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (entry.type === EntryType.Marker) {
        break;
      }
      const { element } = entry;
      if (
        this.treeAdapter.getTagName(element) === neTagName &&
        this.treeAdapter.getNamespaceURI(element) === neNamespaceURI
      ) {
        const elementAttrs = this.treeAdapter.getAttrList(element);
        if (elementAttrs.length === neAttrsLength) {
          candidates.push({ idx: i, attrs: elementAttrs });
        }
      }
    }
    return candidates;
  }
  _ensureNoahArkCondition(newElement) {
    if (this.entries.length < NOAH_ARK_CAPACITY) return;
    const neAttrs = this.treeAdapter.getAttrList(newElement);
    const candidates = this._getNoahArkConditionCandidates(newElement, neAttrs);
    if (candidates.length < NOAH_ARK_CAPACITY) return;
    //NOTE: build attrs map for the new element, so we can perform fast lookups
    const neAttrsMap = new Map(neAttrs.map(neAttr => [neAttr.name, neAttr.value]));
    let validCandidates = 0;
    //NOTE: remove bottommost candidates, until Noah's Ark condition will not be met
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      // We know that `candidate.attrs.length === neAttrs.length`
      if (candidate.attrs.every(cAttr => neAttrsMap.get(cAttr.name) === cAttr.value)) {
        validCandidates += 1;
        if (validCandidates >= NOAH_ARK_CAPACITY) {
          this.entries.splice(candidate.idx, 1);
        }
      }
    }
  }
  //Mutations
  insertMarker() {
    this.entries.unshift(MARKER);
  }
  pushElement(element, token) {
    this._ensureNoahArkCondition(element);
    this.entries.unshift({
      type: EntryType.Element,
      element,
      token
    });
  }
  insertElementAfterBookmark(element, token) {
    const bookmarkIdx = this.entries.indexOf(this.bookmark);
    this.entries.splice(bookmarkIdx, 0, {
      type: EntryType.Element,
      element,
      token
    });
  }
  removeEntry(entry) {
    const entryIndex = this.entries.indexOf(entry);
    if (entryIndex !== -1) {
      this.entries.splice(entryIndex, 1);
    }
  }
  /**
   * Clears the list of formatting elements up to the last marker.
   *
   * @see https://html.spec.whatwg.org/multipage/parsing.html#clear-the-list-of-active-formatting-elements-up-to-the-last-marker
   */
  clearToLastMarker() {
    const markerIdx = this.entries.indexOf(MARKER);
    if (markerIdx === -1) {
      this.entries.length = 0;
    } else {
      this.entries.splice(0, markerIdx + 1);
    }
  }
  //Search
  getElementEntryInScopeWithTagName(tagName) {
    const entry = this.entries.find(
      entry =>
        entry.type === EntryType.Marker || this.treeAdapter.getTagName(entry.element) === tagName
    );
    return entry && entry.type === EntryType.Element ? entry : null;
  }
  getElementEntry(element) {
    return this.entries.find(
      entry => entry.type === EntryType.Element && entry.element === element
    );
  }
}

const defaultTreeAdapter = {
  //Node construction
  createDocument() {
    return {
      nodeName: "#document",
      mode: DOCUMENT_MODE.NO_QUIRKS,
      childNodes: []
    };
  },
  createDocumentFragment() {
    return {
      nodeName: "#document-fragment",
      childNodes: []
    };
  },
  createElement(tagName, namespaceURI, attrs) {
    return {
      nodeName: tagName,
      tagName,
      attrs,
      namespaceURI,
      childNodes: [],
      parentNode: null
    };
  },
  createCommentNode(data) {
    return {
      nodeName: "#comment",
      data,
      parentNode: null
    };
  },
  createTextNode(value) {
    return {
      nodeName: "#text",
      value,
      parentNode: null
    };
  },
  //Tree mutation
  appendChild(parentNode, newNode) {
    parentNode.childNodes.push(newNode);
    newNode.parentNode = parentNode;
  },
  insertBefore(parentNode, newNode, referenceNode) {
    const insertionIdx = parentNode.childNodes.indexOf(referenceNode);
    parentNode.childNodes.splice(insertionIdx, 0, newNode);
    newNode.parentNode = parentNode;
  },
  setTemplateContent(templateElement, contentElement) {
    templateElement.content = contentElement;
  },
  getTemplateContent(templateElement) {
    return templateElement.content;
  },
  setDocumentType(document, name, publicId, systemId) {
    const doctypeNode = document.childNodes.find(node => node.nodeName === "#documentType");
    if (doctypeNode) {
      doctypeNode.name = name;
      doctypeNode.publicId = publicId;
      doctypeNode.systemId = systemId;
    } else {
      const node = {
        nodeName: "#documentType",
        name,
        publicId,
        systemId,
        parentNode: null
      };
      defaultTreeAdapter.appendChild(document, node);
    }
  },
  setDocumentMode(document, mode) {
    document.mode = mode;
  },
  getDocumentMode(document) {
    return document.mode;
  },
  detachNode(node) {
    if (node.parentNode) {
      const idx = node.parentNode.childNodes.indexOf(node);
      node.parentNode.childNodes.splice(idx, 1);
      node.parentNode = null;
    }
  },
  insertText(parentNode, text) {
    if (parentNode.childNodes.length > 0) {
      const prevNode = parentNode.childNodes[parentNode.childNodes.length - 1];
      if (defaultTreeAdapter.isTextNode(prevNode)) {
        prevNode.value += text;
        return;
      }
    }
    defaultTreeAdapter.appendChild(parentNode, defaultTreeAdapter.createTextNode(text));
  },
  insertTextBefore(parentNode, text, referenceNode) {
    const prevNode = parentNode.childNodes[parentNode.childNodes.indexOf(referenceNode) - 1];
    if (prevNode && defaultTreeAdapter.isTextNode(prevNode)) {
      prevNode.value += text;
    } else {
      defaultTreeAdapter.insertBefore(
        parentNode,
        defaultTreeAdapter.createTextNode(text),
        referenceNode
      );
    }
  },
  adoptAttributes(recipient, attrs) {
    const recipientAttrsMap = new Set(recipient.attrs.map(attr => attr.name));
    for (let j = 0; j < attrs.length; j++) {
      if (!recipientAttrsMap.has(attrs[j].name)) {
        recipient.attrs.push(attrs[j]);
      }
    }
  },
  //Tree traversing
  getFirstChild(node) {
    return node.childNodes[0];
  },
  getChildNodes(node) {
    return node.childNodes;
  },
  getParentNode(node) {
    return node.parentNode;
  },
  getAttrList(element) {
    return element.attrs;
  },
  //Node data
  getTagName(element) {
    return element.tagName;
  },
  getNamespaceURI(element) {
    return element.namespaceURI;
  },
  getTextNodeContent(textNode) {
    return textNode.value;
  },
  getCommentNodeContent(commentNode) {
    return commentNode.data;
  },
  getDocumentTypeNodeName(doctypeNode) {
    return doctypeNode.name;
  },
  getDocumentTypeNodePublicId(doctypeNode) {
    return doctypeNode.publicId;
  },
  getDocumentTypeNodeSystemId(doctypeNode) {
    return doctypeNode.systemId;
  },
  //Node types
  isTextNode(node) {
    return node.nodeName === "#text";
  },
  isCommentNode(node) {
    return node.nodeName === "#comment";
  },
  isDocumentTypeNode(node) {
    return node.nodeName === "#documentType";
  },
  isElementNode(node) {
    return Object.prototype.hasOwnProperty.call(node, "tagName");
  },
  // Source code location
  setNodeSourceCodeLocation(node, location) {
    node.sourceCodeLocation = location;
  },
  getNodeSourceCodeLocation(node) {
    return node.sourceCodeLocation;
  },
  updateNodeSourceCodeLocation(node, endLocation) {
    node.sourceCodeLocation = { ...node.sourceCodeLocation, ...endLocation };
  }
};

//Const
const VALID_DOCTYPE_NAME = "html";
const VALID_SYSTEM_ID = "about:legacy-compat";
const QUIRKS_MODE_SYSTEM_ID = "http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd";
const QUIRKS_MODE_PUBLIC_ID_PREFIXES = [
  "+//silmaril//dtd html pro v0r11 19970101//",
  "-//as//dtd html 3.0 aswedit + extensions//",
  "-//advasoft ltd//dtd html 3.0 aswedit + extensions//",
  "-//ietf//dtd html 2.0 level 1//",
  "-//ietf//dtd html 2.0 level 2//",
  "-//ietf//dtd html 2.0 strict level 1//",
  "-//ietf//dtd html 2.0 strict level 2//",
  "-//ietf//dtd html 2.0 strict//",
  "-//ietf//dtd html 2.0//",
  "-//ietf//dtd html 2.1e//",
  "-//ietf//dtd html 3.0//",
  "-//ietf//dtd html 3.2 final//",
  "-//ietf//dtd html 3.2//",
  "-//ietf//dtd html 3//",
  "-//ietf//dtd html level 0//",
  "-//ietf//dtd html level 1//",
  "-//ietf//dtd html level 2//",
  "-//ietf//dtd html level 3//",
  "-//ietf//dtd html strict level 0//",
  "-//ietf//dtd html strict level 1//",
  "-//ietf//dtd html strict level 2//",
  "-//ietf//dtd html strict level 3//",
  "-//ietf//dtd html strict//",
  "-//ietf//dtd html//",
  "-//metrius//dtd metrius presentational//",
  "-//microsoft//dtd internet explorer 2.0 html strict//",
  "-//microsoft//dtd internet explorer 2.0 html//",
  "-//microsoft//dtd internet explorer 2.0 tables//",
  "-//microsoft//dtd internet explorer 3.0 html strict//",
  "-//microsoft//dtd internet explorer 3.0 html//",
  "-//microsoft//dtd internet explorer 3.0 tables//",
  "-//netscape comm. corp.//dtd html//",
  "-//netscape comm. corp.//dtd strict html//",
  "-//o'reilly and associates//dtd html 2.0//",
  "-//o'reilly and associates//dtd html extended 1.0//",
  "-//o'reilly and associates//dtd html extended relaxed 1.0//",
  "-//sq//dtd html 2.0 hotmetal + extensions//",
  "-//softquad software//dtd hotmetal pro 6.0::19990601::extensions to html 4.0//",
  "-//softquad//dtd hotmetal pro 4.0::19971010::extensions to html 4.0//",
  "-//spyglass//dtd html 2.0 extended//",
  "-//sun microsystems corp.//dtd hotjava html//",
  "-//sun microsystems corp.//dtd hotjava strict html//",
  "-//w3c//dtd html 3 1995-03-24//",
  "-//w3c//dtd html 3.2 draft//",
  "-//w3c//dtd html 3.2 final//",
  "-//w3c//dtd html 3.2//",
  "-//w3c//dtd html 3.2s draft//",
  "-//w3c//dtd html 4.0 frameset//",
  "-//w3c//dtd html 4.0 transitional//",
  "-//w3c//dtd html experimental 19960712//",
  "-//w3c//dtd html experimental 970421//",
  "-//w3c//dtd w3 html//",
  "-//w3o//dtd w3 html 3.0//",
  "-//webtechs//dtd mozilla html 2.0//",
  "-//webtechs//dtd mozilla html//"
];

const QUIRKS_MODE_NO_SYSTEM_ID_PUBLIC_ID_PREFIXES = [
  ...QUIRKS_MODE_PUBLIC_ID_PREFIXES,
  "-//w3c//dtd html 4.01 frameset//",
  "-//w3c//dtd html 4.01 transitional//"
];

const QUIRKS_MODE_PUBLIC_IDS = new Set([
  "-//w3o//dtd w3 html strict 3.0//en//",
  "-/w3c/dtd html 4.0 transitional/en",
  "html"
]);
const LIMITED_QUIRKS_PUBLIC_ID_PREFIXES = [
  "-//w3c//dtd xhtml 1.0 frameset//",
  "-//w3c//dtd xhtml 1.0 transitional//"
];
const LIMITED_QUIRKS_WITH_SYSTEM_ID_PUBLIC_ID_PREFIXES = [
  ...LIMITED_QUIRKS_PUBLIC_ID_PREFIXES,
  "-//w3c//dtd html 4.01 frameset//",
  "-//w3c//dtd html 4.01 transitional//"
];

//Utils
function hasPrefix(publicId, prefixes) {
  return prefixes.some(prefix => publicId.startsWith(prefix));
}
//API
function isConforming(token) {
  return (
    token.name === VALID_DOCTYPE_NAME &&
    token.publicId === null &&
    (token.systemId === null || token.systemId === VALID_SYSTEM_ID)
  );
}
function getDocumentMode(token) {
  if (token.name !== VALID_DOCTYPE_NAME) {
    return DOCUMENT_MODE.QUIRKS;
  }
  const { systemId } = token;
  if (systemId && systemId.toLowerCase() === QUIRKS_MODE_SYSTEM_ID) {
    return DOCUMENT_MODE.QUIRKS;
  }
  let { publicId } = token;
  if (publicId !== null) {
    publicId = publicId.toLowerCase();
    if (QUIRKS_MODE_PUBLIC_IDS.has(publicId)) {
      return DOCUMENT_MODE.QUIRKS;
    }
    let prefixes =
      systemId === null
        ? QUIRKS_MODE_NO_SYSTEM_ID_PUBLIC_ID_PREFIXES
        : QUIRKS_MODE_PUBLIC_ID_PREFIXES;
    if (hasPrefix(publicId, prefixes)) {
      return DOCUMENT_MODE.QUIRKS;
    }
    prefixes =
      systemId === null
        ? LIMITED_QUIRKS_PUBLIC_ID_PREFIXES
        : LIMITED_QUIRKS_WITH_SYSTEM_ID_PUBLIC_ID_PREFIXES;
    if (hasPrefix(publicId, prefixes)) {
      return DOCUMENT_MODE.LIMITED_QUIRKS;
    }
  }
  return DOCUMENT_MODE.NO_QUIRKS;
}

//MIME types
const MIME_TYPES = {
  TEXT_HTML: "text/html",
  APPLICATION_XML: "application/xhtml+xml"
};
//Attributes
const DEFINITION_URL_ATTR = "definitionurl";
const ADJUSTED_DEFINITION_URL_ATTR = "definitionURL";
const SVG_ATTRS_ADJUSTMENT_MAP = new Map(
  [
    "attributeName",
    "attributeType",
    "baseFrequency",
    "baseProfile",
    "calcMode",
    "clipPathUnits",
    "diffuseConstant",
    "edgeMode",
    "filterUnits",
    "glyphRef",
    "gradientTransform",
    "gradientUnits",
    "kernelMatrix",
    "kernelUnitLength",
    "keyPoints",
    "keySplines",
    "keyTimes",
    "lengthAdjust",
    "limitingConeAngle",
    "markerHeight",
    "markerUnits",
    "markerWidth",
    "maskContentUnits",
    "maskUnits",
    "numOctaves",
    "pathLength",
    "patternContentUnits",
    "patternTransform",
    "patternUnits",
    "pointsAtX",
    "pointsAtY",
    "pointsAtZ",
    "preserveAlpha",
    "preserveAspectRatio",
    "primitiveUnits",
    "refX",
    "refY",
    "repeatCount",
    "repeatDur",
    "requiredExtensions",
    "requiredFeatures",
    "specularConstant",
    "specularExponent",
    "spreadMethod",
    "startOffset",
    "stdDeviation",
    "stitchTiles",
    "surfaceScale",
    "systemLanguage",
    "tableValues",
    "targetX",
    "targetY",
    "textLength",
    "viewBox",
    "viewTarget",
    "xChannelSelector",
    "yChannelSelector",
    "zoomAndPan"
  ].map(attr => [attr.toLowerCase(), attr])
);
const XML_ATTRS_ADJUSTMENT_MAP = new Map([
  ["xlink:actuate", { prefix: "xlink", name: "actuate", namespace: NS.XLINK }],
  ["xlink:arcrole", { prefix: "xlink", name: "arcrole", namespace: NS.XLINK }],
  ["xlink:href", { prefix: "xlink", name: "href", namespace: NS.XLINK }],
  ["xlink:role", { prefix: "xlink", name: "role", namespace: NS.XLINK }],
  ["xlink:show", { prefix: "xlink", name: "show", namespace: NS.XLINK }],
  ["xlink:title", { prefix: "xlink", name: "title", namespace: NS.XLINK }],
  ["xlink:type", { prefix: "xlink", name: "type", namespace: NS.XLINK }],
  ["xml:lang", { prefix: "xml", name: "lang", namespace: NS.XML }],
  ["xml:space", { prefix: "xml", name: "space", namespace: NS.XML }],
  ["xmlns", { prefix: "", name: "xmlns", namespace: NS.XMLNS }],
  ["xmlns:xlink", { prefix: "xmlns", name: "xlink", namespace: NS.XMLNS }]
]);
//SVG tag names adjustment map
const SVG_TAG_NAMES_ADJUSTMENT_MAP = new Map(
  [
    "altGlyph",
    "altGlyphDef",
    "altGlyphItem",
    "animateColor",
    "animateMotion",
    "animateTransform",
    "clipPath",
    "feBlend",
    "feColorMatrix",
    "feComponentTransfer",
    "feComposite",
    "feConvolveMatrix",
    "feDiffuseLighting",
    "feDisplacementMap",
    "feDistantLight",
    "feFlood",
    "feFuncA",
    "feFuncB",
    "feFuncG",
    "feFuncR",
    "feGaussianBlur",
    "feImage",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
    "fePointLight",
    "feSpecularLighting",
    "feSpotLight",
    "feTile",
    "feTurbulence",
    "foreignObject",
    "glyphRef",
    "linearGradient",
    "radialGradient",
    "textPath"
  ].map(tn => [tn.toLowerCase(), tn])
);
//Tags that causes exit from foreign content
const EXITS_FOREIGN_CONTENT = new Set([
  TAG_ID.B,
  TAG_ID.BIG,
  TAG_ID.BLOCKQUOTE,
  TAG_ID.BODY,
  TAG_ID.BR,
  TAG_ID.CENTER,
  TAG_ID.CODE,
  TAG_ID.DD,
  TAG_ID.DIV,
  TAG_ID.DL,
  TAG_ID.DT,
  TAG_ID.EM,
  TAG_ID.EMBED,
  TAG_ID.H1,
  TAG_ID.H2,
  TAG_ID.H3,
  TAG_ID.H4,
  TAG_ID.H5,
  TAG_ID.H6,
  TAG_ID.HEAD,
  TAG_ID.HR,
  TAG_ID.I,
  TAG_ID.IMG,
  TAG_ID.LI,
  TAG_ID.LISTING,
  TAG_ID.MENU,
  TAG_ID.META,
  TAG_ID.NOBR,
  TAG_ID.OL,
  TAG_ID.P,
  TAG_ID.PRE,
  TAG_ID.RUBY,
  TAG_ID.S,
  TAG_ID.SMALL,
  TAG_ID.SPAN,
  TAG_ID.STRONG,
  TAG_ID.STRIKE,
  TAG_ID.SUB,
  TAG_ID.SUP,
  TAG_ID.TABLE,
  TAG_ID.TT,
  TAG_ID.U,
  TAG_ID.UL,
  TAG_ID.VAR
]);
//Check exit from foreign content
function causesExit(startTagToken) {
  const tn = startTagToken.tagID;
  const isFontWithAttrs =
    tn === TAG_ID.FONT &&
    startTagToken.attrs.some(
      ({ name }) => name === ATTRS.COLOR || name === ATTRS.SIZE || name === ATTRS.FACE
    );
  return isFontWithAttrs || EXITS_FOREIGN_CONTENT.has(tn);
}
//Token adjustments
function adjustTokenMathMLAttrs(token) {
  for (let i = 0; i < token.attrs.length; i++) {
    if (token.attrs[i].name === DEFINITION_URL_ATTR) {
      token.attrs[i].name = ADJUSTED_DEFINITION_URL_ATTR;
      break;
    }
  }
}
function adjustTokenSVGAttrs(token) {
  for (let i = 0; i < token.attrs.length; i++) {
    const adjustedAttrName = SVG_ATTRS_ADJUSTMENT_MAP.get(token.attrs[i].name);
    if (adjustedAttrName != null) {
      token.attrs[i].name = adjustedAttrName;
    }
  }
}
function adjustTokenXMLAttrs(token) {
  for (let i = 0; i < token.attrs.length; i++) {
    const adjustedAttrEntry = XML_ATTRS_ADJUSTMENT_MAP.get(token.attrs[i].name);
    if (adjustedAttrEntry) {
      token.attrs[i].prefix = adjustedAttrEntry.prefix;
      token.attrs[i].name = adjustedAttrEntry.name;
      token.attrs[i].namespace = adjustedAttrEntry.namespace;
    }
  }
}
function adjustTokenSVGTagName(token) {
  const adjustedTagName = SVG_TAG_NAMES_ADJUSTMENT_MAP.get(token.tagName);
  if (adjustedTagName != null) {
    token.tagName = adjustedTagName;
    token.tagID = getTagID(token.tagName);
  }
}
//Integration points
function isMathMLTextIntegrationPoint(tn, ns) {
  return (
    ns === NS.MATHML &&
    (tn === TAG_ID.MI ||
      tn === TAG_ID.MO ||
      tn === TAG_ID.MN ||
      tn === TAG_ID.MS ||
      tn === TAG_ID.MTEXT)
  );
}
function isHtmlIntegrationPoint(tn, ns, attrs) {
  if (ns === NS.MATHML && tn === TAG_ID.ANNOTATION_XML) {
    for (let i = 0; i < attrs.length; i++) {
      if (attrs[i].name === ATTRS.ENCODING) {
        const value = attrs[i].value.toLowerCase();
        return value === MIME_TYPES.TEXT_HTML || value === MIME_TYPES.APPLICATION_XML;
      }
    }
  }
  return (
    ns === NS.SVG && (tn === TAG_ID.FOREIGN_OBJECT || tn === TAG_ID.DESC || tn === TAG_ID.TITLE)
  );
}
function isIntegrationPoint(tn, ns, attrs, foreignNS) {
  return (
    ((!foreignNS || foreignNS === NS.HTML) && isHtmlIntegrationPoint(tn, ns, attrs)) ||
    ((!foreignNS || foreignNS === NS.MATHML) && isMathMLTextIntegrationPoint(tn, ns))
  );
}

//Misc constants
const HIDDEN_INPUT_TYPE = "hidden";
//Adoption agency loops iteration count
const AA_OUTER_LOOP_ITER = 8;
const AA_INNER_LOOP_ITER = 3;
//Insertion modes
var InsertionMode;
(function (InsertionMode) {
  InsertionMode[(InsertionMode["INITIAL"] = 0)] = "INITIAL";
  InsertionMode[(InsertionMode["BEFORE_HTML"] = 1)] = "BEFORE_HTML";
  InsertionMode[(InsertionMode["BEFORE_HEAD"] = 2)] = "BEFORE_HEAD";
  InsertionMode[(InsertionMode["IN_HEAD"] = 3)] = "IN_HEAD";
  InsertionMode[(InsertionMode["IN_HEAD_NO_SCRIPT"] = 4)] = "IN_HEAD_NO_SCRIPT";
  InsertionMode[(InsertionMode["AFTER_HEAD"] = 5)] = "AFTER_HEAD";
  InsertionMode[(InsertionMode["IN_BODY"] = 6)] = "IN_BODY";
  InsertionMode[(InsertionMode["TEXT"] = 7)] = "TEXT";
  InsertionMode[(InsertionMode["IN_TABLE"] = 8)] = "IN_TABLE";
  InsertionMode[(InsertionMode["IN_TABLE_TEXT"] = 9)] = "IN_TABLE_TEXT";
  InsertionMode[(InsertionMode["IN_CAPTION"] = 10)] = "IN_CAPTION";
  InsertionMode[(InsertionMode["IN_COLUMN_GROUP"] = 11)] = "IN_COLUMN_GROUP";
  InsertionMode[(InsertionMode["IN_TABLE_BODY"] = 12)] = "IN_TABLE_BODY";
  InsertionMode[(InsertionMode["IN_ROW"] = 13)] = "IN_ROW";
  InsertionMode[(InsertionMode["IN_CELL"] = 14)] = "IN_CELL";
  InsertionMode[(InsertionMode["IN_SELECT"] = 15)] = "IN_SELECT";
  InsertionMode[(InsertionMode["IN_SELECT_IN_TABLE"] = 16)] = "IN_SELECT_IN_TABLE";
  InsertionMode[(InsertionMode["IN_TEMPLATE"] = 17)] = "IN_TEMPLATE";
  InsertionMode[(InsertionMode["AFTER_BODY"] = 18)] = "AFTER_BODY";
  InsertionMode[(InsertionMode["IN_FRAMESET"] = 19)] = "IN_FRAMESET";
  InsertionMode[(InsertionMode["AFTER_FRAMESET"] = 20)] = "AFTER_FRAMESET";
  InsertionMode[(InsertionMode["AFTER_AFTER_BODY"] = 21)] = "AFTER_AFTER_BODY";
  InsertionMode[(InsertionMode["AFTER_AFTER_FRAMESET"] = 22)] = "AFTER_AFTER_FRAMESET";
})(InsertionMode || (InsertionMode = {}));
const BASE_LOC = {
  startLine: -1,
  startCol: -1,
  startOffset: -1,
  endLine: -1,
  endCol: -1,
  endOffset: -1
};
const TABLE_STRUCTURE_TAGS = new Set([
  TAG_ID.TABLE,
  TAG_ID.TBODY,
  TAG_ID.TFOOT,
  TAG_ID.THEAD,
  TAG_ID.TR
]);
const defaultParserOptions = {
  scriptingEnabled: true,
  sourceCodeLocationInfo: false,
  treeAdapter: defaultTreeAdapter,
  onParseError: null
};
//Parser
class Parser {
  constructor(
    options,
    document,
    /** @internal */
    fragmentContext = null,
    /** @internal */
    scriptHandler = null
  ) {
    this.fragmentContext = fragmentContext;
    this.scriptHandler = scriptHandler;
    this.currentToken = null;
    this.stopped = false;
    /** @internal */
    this.insertionMode = InsertionMode.INITIAL;
    /** @internal */
    this.originalInsertionMode = InsertionMode.INITIAL;
    /** @internal */
    this.headElement = null;
    /** @internal */
    this.formElement = null;
    /** Indicates that the current node is not an element in the HTML namespace */
    this.currentNotInHTML = false;
    /**
     * The template insertion mode stack is maintained from the left.
     * Ie. the topmost element will always have index 0.
     *
     * @internal
     */
    this.tmplInsertionModeStack = [];
    /** @internal */
    this.pendingCharacterTokens = [];
    /** @internal */
    this.hasNonWhitespacePendingCharacterToken = false;
    /** @internal */
    this.framesetOk = true;
    /** @internal */
    this.skipNextNewLine = false;
    /** @internal */
    this.fosterParentingEnabled = false;
    this.options = {
      ...defaultParserOptions,
      ...options
    };
    this.treeAdapter = this.options.treeAdapter;
    this.onParseError = this.options.onParseError;
    // Always enable location info if we report parse errors.
    if (this.onParseError) {
      this.options.sourceCodeLocationInfo = true;
    }
    this.document =
      document !== null && document !== void 0 ? document : this.treeAdapter.createDocument();
    this.tokenizer = new Tokenizer(this.options, this);
    this.activeFormattingElements = new FormattingElementList(this.treeAdapter);
    this.fragmentContextID = fragmentContext
      ? getTagID(this.treeAdapter.getTagName(fragmentContext))
      : TAG_ID.UNKNOWN;
    this._setContextModes(
      fragmentContext !== null && fragmentContext !== void 0 ? fragmentContext : this.document,
      this.fragmentContextID
    );
    this.openElements = new OpenElementStack(this.document, this.treeAdapter, this);
  }
  // API
  static parse(html, options) {
    const parser = new this(options);
    parser.tokenizer.write(html, true);
    return parser.document;
  }
  static getFragmentParser(fragmentContext, options) {
    const opts = {
      ...defaultParserOptions,
      ...options
    };
    //NOTE: use a <template> element as the fragment context if no context element was provided,
    //so we will parse in a "forgiving" manner
    fragmentContext !== null && fragmentContext !== void 0
      ? fragmentContext
      : (fragmentContext = opts.treeAdapter.createElement(TAG_NAMES.TEMPLATE, NS.HTML, []));
    //NOTE: create a fake element which will be used as the `document` for fragment parsing.
    //This is important for jsdom, where a new `document` cannot be created. This led to
    //fragment parsing messing with the main `document`.
    const documentMock = opts.treeAdapter.createElement("documentmock", NS.HTML, []);
    const parser = new this(opts, documentMock, fragmentContext);
    if (parser.fragmentContextID === TAG_ID.TEMPLATE) {
      parser.tmplInsertionModeStack.unshift(InsertionMode.IN_TEMPLATE);
    }
    parser._initTokenizerForFragmentParsing();
    parser._insertFakeRootElement();
    parser._resetInsertionMode();
    parser._findFormInFragmentContext();
    return parser;
  }
  getFragment() {
    const rootElement = this.treeAdapter.getFirstChild(this.document);
    const fragment = this.treeAdapter.createDocumentFragment();
    this._adoptNodes(rootElement, fragment);
    return fragment;
  }
  //Errors
  /** @internal */
  _err(token, code, beforeToken) {
    var _a;
    if (!this.onParseError) return;
    const loc = (_a = token.location) !== null && _a !== void 0 ? _a : BASE_LOC;
    const err = {
      code,
      startLine: loc.startLine,
      startCol: loc.startCol,
      startOffset: loc.startOffset,
      endLine: beforeToken ? loc.startLine : loc.endLine,
      endCol: beforeToken ? loc.startCol : loc.endCol,
      endOffset: beforeToken ? loc.startOffset : loc.endOffset
    };
    this.onParseError(err);
  }
  //Stack events
  /** @internal */
  onItemPush(node, tid, isTop) {
    var _a, _b;
    (_b = (_a = this.treeAdapter).onItemPush) === null || _b === void 0
      ? void 0
      : _b.call(_a, node);
    if (isTop && this.openElements.stackTop > 0) this._setContextModes(node, tid);
  }
  /** @internal */
  onItemPop(node, isTop) {
    var _a, _b;
    if (this.options.sourceCodeLocationInfo) {
      this._setEndLocation(node, this.currentToken);
    }
    (_b = (_a = this.treeAdapter).onItemPop) === null || _b === void 0
      ? void 0
      : _b.call(_a, node, this.openElements.current);
    if (isTop) {
      let current;
      let currentTagId;
      if (this.openElements.stackTop === 0 && this.fragmentContext) {
        current = this.fragmentContext;
        currentTagId = this.fragmentContextID;
      } else {
        ({ current, currentTagId } = this.openElements);
      }
      this._setContextModes(current, currentTagId);
    }
  }
  _setContextModes(current, tid) {
    const isHTML =
      current === this.document ||
      (current && this.treeAdapter.getNamespaceURI(current) === NS.HTML);
    this.currentNotInHTML = !isHTML;
    this.tokenizer.inForeignNode =
      !isHTML &&
      current !== undefined &&
      tid !== undefined &&
      !this._isIntegrationPoint(tid, current);
  }
  /** @protected */
  _switchToTextParsing(currentToken, nextTokenizerState) {
    this._insertElement(currentToken, NS.HTML);
    this.tokenizer.state = nextTokenizerState;
    this.originalInsertionMode = this.insertionMode;
    this.insertionMode = InsertionMode.TEXT;
  }
  switchToPlaintextParsing() {
    this.insertionMode = InsertionMode.TEXT;
    this.originalInsertionMode = InsertionMode.IN_BODY;
    this.tokenizer.state = TokenizerMode.PLAINTEXT;
  }
  //Fragment parsing
  /** @protected */
  _getAdjustedCurrentElement() {
    return this.openElements.stackTop === 0 && this.fragmentContext
      ? this.fragmentContext
      : this.openElements.current;
  }
  /** @protected */
  _findFormInFragmentContext() {
    let node = this.fragmentContext;
    while (node) {
      if (this.treeAdapter.getTagName(node) === TAG_NAMES.FORM) {
        this.formElement = node;
        break;
      }
      node = this.treeAdapter.getParentNode(node);
    }
  }
  _initTokenizerForFragmentParsing() {
    if (
      !this.fragmentContext ||
      this.treeAdapter.getNamespaceURI(this.fragmentContext) !== NS.HTML
    ) {
      return;
    }
    switch (this.fragmentContextID) {
      case TAG_ID.TITLE:
      case TAG_ID.TEXTAREA: {
        this.tokenizer.state = TokenizerMode.RCDATA;
        break;
      }
      case TAG_ID.STYLE:
      case TAG_ID.XMP:
      case TAG_ID.IFRAME:
      case TAG_ID.NOEMBED:
      case TAG_ID.NOFRAMES:
      case TAG_ID.NOSCRIPT: {
        this.tokenizer.state = TokenizerMode.RAWTEXT;
        break;
      }
      case TAG_ID.SCRIPT: {
        this.tokenizer.state = TokenizerMode.SCRIPT_DATA;
        break;
      }
      case TAG_ID.PLAINTEXT: {
        this.tokenizer.state = TokenizerMode.PLAINTEXT;
        break;
      }
      // Do nothing
    }
  }
  //Tree mutation
  /** @protected */
  _setDocumentType(token) {
    const name = token.name || "";
    const publicId = token.publicId || "";
    const systemId = token.systemId || "";
    this.treeAdapter.setDocumentType(this.document, name, publicId, systemId);
    if (token.location) {
      const documentChildren = this.treeAdapter.getChildNodes(this.document);
      const docTypeNode = documentChildren.find(node => this.treeAdapter.isDocumentTypeNode(node));
      if (docTypeNode) {
        this.treeAdapter.setNodeSourceCodeLocation(docTypeNode, token.location);
      }
    }
  }
  /** @protected */
  _attachElementToTree(element, location) {
    if (this.options.sourceCodeLocationInfo) {
      const loc = location && {
        ...location,
        startTag: location
      };
      this.treeAdapter.setNodeSourceCodeLocation(element, loc);
    }
    if (this._shouldFosterParentOnInsertion()) {
      this._fosterParentElement(element);
    } else {
      const parent = this.openElements.currentTmplContentOrNode;
      this.treeAdapter.appendChild(
        parent !== null && parent !== void 0 ? parent : this.document,
        element
      );
    }
  }
  /**
   * For self-closing tags. Add an element to the tree, but skip adding it
   * to the stack.
   */
  /** @protected */
  _appendElement(token, namespaceURI) {
    const element = this.treeAdapter.createElement(token.tagName, namespaceURI, token.attrs);
    this._attachElementToTree(element, token.location);
  }
  /** @protected */
  _insertElement(token, namespaceURI) {
    const element = this.treeAdapter.createElement(token.tagName, namespaceURI, token.attrs);
    this._attachElementToTree(element, token.location);
    this.openElements.push(element, token.tagID);
  }
  /** @protected */
  _insertFakeElement(tagName, tagID) {
    const element = this.treeAdapter.createElement(tagName, NS.HTML, []);
    this._attachElementToTree(element, null);
    this.openElements.push(element, tagID);
  }
  /** @protected */
  _insertTemplate(token) {
    const tmpl = this.treeAdapter.createElement(token.tagName, NS.HTML, token.attrs);
    const content = this.treeAdapter.createDocumentFragment();
    this.treeAdapter.setTemplateContent(tmpl, content);
    this._attachElementToTree(tmpl, token.location);
    this.openElements.push(tmpl, token.tagID);
    if (this.options.sourceCodeLocationInfo)
      this.treeAdapter.setNodeSourceCodeLocation(content, null);
  }
  /** @protected */
  _insertFakeRootElement() {
    const element = this.treeAdapter.createElement(TAG_NAMES.HTML, NS.HTML, []);
    if (this.options.sourceCodeLocationInfo)
      this.treeAdapter.setNodeSourceCodeLocation(element, null);
    this.treeAdapter.appendChild(this.openElements.current, element);
    this.openElements.push(element, TAG_ID.HTML);
  }
  /** @protected */
  _appendCommentNode(token, parent) {
    const commentNode = this.treeAdapter.createCommentNode(token.data);
    this.treeAdapter.appendChild(parent, commentNode);
    if (this.options.sourceCodeLocationInfo) {
      this.treeAdapter.setNodeSourceCodeLocation(commentNode, token.location);
    }
  }
  /** @protected */
  _insertCharacters(token) {
    let parent;
    let beforeElement;
    if (this._shouldFosterParentOnInsertion()) {
      ({ parent, beforeElement } = this._findFosterParentingLocation());
      if (beforeElement) {
        this.treeAdapter.insertTextBefore(parent, token.chars, beforeElement);
      } else {
        this.treeAdapter.insertText(parent, token.chars);
      }
    } else {
      parent = this.openElements.currentTmplContentOrNode;
      this.treeAdapter.insertText(parent, token.chars);
    }
    if (!token.location) return;
    const siblings = this.treeAdapter.getChildNodes(parent);
    const textNodeIdx = beforeElement ? siblings.lastIndexOf(beforeElement) : siblings.length;
    const textNode = siblings[textNodeIdx - 1];
    //NOTE: if we have a location assigned by another token, then just update the end position
    const tnLoc = this.treeAdapter.getNodeSourceCodeLocation(textNode);
    if (tnLoc) {
      const { endLine, endCol, endOffset } = token.location;
      this.treeAdapter.updateNodeSourceCodeLocation(textNode, { endLine, endCol, endOffset });
    } else if (this.options.sourceCodeLocationInfo) {
      this.treeAdapter.setNodeSourceCodeLocation(textNode, token.location);
    }
  }
  /** @protected */
  _adoptNodes(donor, recipient) {
    for (
      let child = this.treeAdapter.getFirstChild(donor);
      child;
      child = this.treeAdapter.getFirstChild(donor)
    ) {
      this.treeAdapter.detachNode(child);
      this.treeAdapter.appendChild(recipient, child);
    }
  }
  /** @protected */
  _setEndLocation(element, closingToken) {
    if (this.treeAdapter.getNodeSourceCodeLocation(element) && closingToken.location) {
      const ctLoc = closingToken.location;
      const tn = this.treeAdapter.getTagName(element);
      const endLoc =
        // NOTE: For cases like <p> <p> </p> - First 'p' closes without a closing
        // tag and for cases like <td> <p> </td> - 'p' closes without a closing tag.
        closingToken.type === TokenType.END_TAG && tn === closingToken.tagName
          ? {
              endTag: { ...ctLoc },
              endLine: ctLoc.endLine,
              endCol: ctLoc.endCol,
              endOffset: ctLoc.endOffset
            }
          : {
              endLine: ctLoc.startLine,
              endCol: ctLoc.startCol,
              endOffset: ctLoc.startOffset
            };
      this.treeAdapter.updateNodeSourceCodeLocation(element, endLoc);
    }
  }
  //Token processing
  shouldProcessStartTagTokenInForeignContent(token) {
    // Check that neither current === document, or ns === NS.HTML
    if (!this.currentNotInHTML) return false;
    let current;
    let currentTagId;
    if (this.openElements.stackTop === 0 && this.fragmentContext) {
      current = this.fragmentContext;
      currentTagId = this.fragmentContextID;
    } else {
      ({ current, currentTagId } = this.openElements);
    }
    if (
      token.tagID === TAG_ID.SVG &&
      this.treeAdapter.getTagName(current) === TAG_NAMES.ANNOTATION_XML &&
      this.treeAdapter.getNamespaceURI(current) === NS.MATHML
    ) {
      return false;
    }
    return (
      // Check that `current` is not an integration point for HTML or MathML elements.
      this.tokenizer.inForeignNode ||
      // If it _is_ an integration point, then we might have to check that it is not an HTML
      // integration point.
      ((token.tagID === TAG_ID.MGLYPH || token.tagID === TAG_ID.MALIGNMARK) &&
        currentTagId !== undefined &&
        !this._isIntegrationPoint(currentTagId, current, NS.HTML))
    );
  }
  /** @protected */
  _processToken(token) {
    switch (token.type) {
      case TokenType.CHARACTER: {
        this.onCharacter(token);
        break;
      }
      case TokenType.NULL_CHARACTER: {
        this.onNullCharacter(token);
        break;
      }
      case TokenType.COMMENT: {
        this.onComment(token);
        break;
      }
      case TokenType.DOCTYPE: {
        this.onDoctype(token);
        break;
      }
      case TokenType.START_TAG: {
        this._processStartTag(token);
        break;
      }
      case TokenType.END_TAG: {
        this.onEndTag(token);
        break;
      }
      case TokenType.EOF: {
        this.onEof(token);
        break;
      }
      case TokenType.WHITESPACE_CHARACTER: {
        this.onWhitespaceCharacter(token);
        break;
      }
    }
  }
  //Integration points
  /** @protected */
  _isIntegrationPoint(tid, element, foreignNS) {
    const ns = this.treeAdapter.getNamespaceURI(element);
    const attrs = this.treeAdapter.getAttrList(element);
    return isIntegrationPoint(tid, ns, attrs, foreignNS);
  }
  //Active formatting elements reconstruction
  /** @protected */
  _reconstructActiveFormattingElements() {
    const listLength = this.activeFormattingElements.entries.length;
    if (listLength) {
      const endIndex = this.activeFormattingElements.entries.findIndex(
        entry => entry.type === EntryType.Marker || this.openElements.contains(entry.element)
      );
      const unopenIdx = endIndex === -1 ? listLength - 1 : endIndex - 1;
      for (let i = unopenIdx; i >= 0; i--) {
        const entry = this.activeFormattingElements.entries[i];
        this._insertElement(entry.token, this.treeAdapter.getNamespaceURI(entry.element));
        entry.element = this.openElements.current;
      }
    }
  }
  //Close elements
  /** @protected */
  _closeTableCell() {
    this.openElements.generateImpliedEndTags();
    this.openElements.popUntilTableCellPopped();
    this.activeFormattingElements.clearToLastMarker();
    this.insertionMode = InsertionMode.IN_ROW;
  }
  /** @protected */
  _closePElement() {
    this.openElements.generateImpliedEndTagsWithExclusion(TAG_ID.P);
    this.openElements.popUntilTagNamePopped(TAG_ID.P);
  }
  //Insertion modes
  /** @protected */
  _resetInsertionMode() {
    for (let i = this.openElements.stackTop; i >= 0; i--) {
      //Insertion mode reset map
      switch (
        i === 0 && this.fragmentContext ? this.fragmentContextID : this.openElements.tagIDs[i]
      ) {
        case TAG_ID.TR: {
          this.insertionMode = InsertionMode.IN_ROW;
          return;
        }
        case TAG_ID.TBODY:
        case TAG_ID.THEAD:
        case TAG_ID.TFOOT: {
          this.insertionMode = InsertionMode.IN_TABLE_BODY;
          return;
        }
        case TAG_ID.CAPTION: {
          this.insertionMode = InsertionMode.IN_CAPTION;
          return;
        }
        case TAG_ID.COLGROUP: {
          this.insertionMode = InsertionMode.IN_COLUMN_GROUP;
          return;
        }
        case TAG_ID.TABLE: {
          this.insertionMode = InsertionMode.IN_TABLE;
          return;
        }
        case TAG_ID.BODY: {
          this.insertionMode = InsertionMode.IN_BODY;
          return;
        }
        case TAG_ID.FRAMESET: {
          this.insertionMode = InsertionMode.IN_FRAMESET;
          return;
        }
        case TAG_ID.SELECT: {
          this._resetInsertionModeForSelect(i);
          return;
        }
        case TAG_ID.TEMPLATE: {
          this.insertionMode = this.tmplInsertionModeStack[0];
          return;
        }
        case TAG_ID.HTML: {
          this.insertionMode = this.headElement
            ? InsertionMode.AFTER_HEAD
            : InsertionMode.BEFORE_HEAD;
          return;
        }
        case TAG_ID.TD:
        case TAG_ID.TH: {
          if (i > 0) {
            this.insertionMode = InsertionMode.IN_CELL;
            return;
          }
          break;
        }
        case TAG_ID.HEAD: {
          if (i > 0) {
            this.insertionMode = InsertionMode.IN_HEAD;
            return;
          }
          break;
        }
      }
    }
    this.insertionMode = InsertionMode.IN_BODY;
  }
  /** @protected */
  _resetInsertionModeForSelect(selectIdx) {
    if (selectIdx > 0) {
      for (let i = selectIdx - 1; i > 0; i--) {
        const tn = this.openElements.tagIDs[i];
        if (tn === TAG_ID.TEMPLATE) {
          break;
        } else if (tn === TAG_ID.TABLE) {
          this.insertionMode = InsertionMode.IN_SELECT_IN_TABLE;
          return;
        }
      }
    }
    this.insertionMode = InsertionMode.IN_SELECT;
  }
  //Foster parenting
  /** @protected */
  _isElementCausesFosterParenting(tn) {
    return TABLE_STRUCTURE_TAGS.has(tn);
  }
  /** @protected */
  _shouldFosterParentOnInsertion() {
    return (
      this.fosterParentingEnabled &&
      this.openElements.currentTagId !== undefined &&
      this._isElementCausesFosterParenting(this.openElements.currentTagId)
    );
  }
  /** @protected */
  _findFosterParentingLocation() {
    for (let i = this.openElements.stackTop; i >= 0; i--) {
      const openElement = this.openElements.items[i];
      switch (this.openElements.tagIDs[i]) {
        case TAG_ID.TEMPLATE: {
          if (this.treeAdapter.getNamespaceURI(openElement) === NS.HTML) {
            return {
              parent: this.treeAdapter.getTemplateContent(openElement),
              beforeElement: null
            };
          }
          break;
        }
        case TAG_ID.TABLE: {
          const parent = this.treeAdapter.getParentNode(openElement);
          if (parent) {
            return { parent, beforeElement: openElement };
          }
          return { parent: this.openElements.items[i - 1], beforeElement: null };
        }
        // Do nothing
      }
    }
    return { parent: this.openElements.items[0], beforeElement: null };
  }
  /** @protected */
  _fosterParentElement(element) {
    const location = this._findFosterParentingLocation();
    if (location.beforeElement) {
      this.treeAdapter.insertBefore(location.parent, element, location.beforeElement);
    } else {
      this.treeAdapter.appendChild(location.parent, element);
    }
  }
  //Special elements
  /** @protected */
  _isSpecialElement(element, id) {
    const ns = this.treeAdapter.getNamespaceURI(element);
    return SPECIAL_ELEMENTS[ns].has(id);
  }
  /** @internal */
  onCharacter(token) {
    this.skipNextNewLine = false;
    if (this.tokenizer.inForeignNode) {
      characterInForeignContent(this, token);
      return;
    }
    switch (this.insertionMode) {
      case InsertionMode.INITIAL: {
        tokenInInitialMode(this, token);
        break;
      }
      case InsertionMode.BEFORE_HTML: {
        tokenBeforeHtml(this, token);
        break;
      }
      case InsertionMode.BEFORE_HEAD: {
        tokenBeforeHead(this, token);
        break;
      }
      case InsertionMode.IN_HEAD: {
        tokenInHead(this, token);
        break;
      }
      case InsertionMode.IN_HEAD_NO_SCRIPT: {
        tokenInHeadNoScript(this, token);
        break;
      }
      case InsertionMode.AFTER_HEAD: {
        tokenAfterHead(this, token);
        break;
      }
      case InsertionMode.IN_BODY:
      case InsertionMode.IN_CAPTION:
      case InsertionMode.IN_CELL:
      case InsertionMode.IN_TEMPLATE: {
        characterInBody(this, token);
        break;
      }
      case InsertionMode.TEXT:
      case InsertionMode.IN_SELECT:
      case InsertionMode.IN_SELECT_IN_TABLE: {
        this._insertCharacters(token);
        break;
      }
      case InsertionMode.IN_TABLE:
      case InsertionMode.IN_TABLE_BODY:
      case InsertionMode.IN_ROW: {
        characterInTable(this, token);
        break;
      }
      case InsertionMode.IN_TABLE_TEXT: {
        characterInTableText(this, token);
        break;
      }
      case InsertionMode.IN_COLUMN_GROUP: {
        tokenInColumnGroup(this, token);
        break;
      }
      case InsertionMode.AFTER_BODY: {
        tokenAfterBody(this, token);
        break;
      }
      case InsertionMode.AFTER_AFTER_BODY: {
        tokenAfterAfterBody(this, token);
        break;
      }
      // Do nothing
    }
  }
  /** @internal */
  onNullCharacter(token) {
    this.skipNextNewLine = false;
    if (this.tokenizer.inForeignNode) {
      nullCharacterInForeignContent(this, token);
      return;
    }
    switch (this.insertionMode) {
      case InsertionMode.INITIAL: {
        tokenInInitialMode(this, token);
        break;
      }
      case InsertionMode.BEFORE_HTML: {
        tokenBeforeHtml(this, token);
        break;
      }
      case InsertionMode.BEFORE_HEAD: {
        tokenBeforeHead(this, token);
        break;
      }
      case InsertionMode.IN_HEAD: {
        tokenInHead(this, token);
        break;
      }
      case InsertionMode.IN_HEAD_NO_SCRIPT: {
        tokenInHeadNoScript(this, token);
        break;
      }
      case InsertionMode.AFTER_HEAD: {
        tokenAfterHead(this, token);
        break;
      }
      case InsertionMode.TEXT: {
        this._insertCharacters(token);
        break;
      }
      case InsertionMode.IN_TABLE:
      case InsertionMode.IN_TABLE_BODY:
      case InsertionMode.IN_ROW: {
        characterInTable(this, token);
        break;
      }
      case InsertionMode.IN_COLUMN_GROUP: {
        tokenInColumnGroup(this, token);
        break;
      }
      case InsertionMode.AFTER_BODY: {
        tokenAfterBody(this, token);
        break;
      }
      case InsertionMode.AFTER_AFTER_BODY: {
        tokenAfterAfterBody(this, token);
        break;
      }
      // Do nothing
    }
  }
  /** @internal */
  onComment(token) {
    this.skipNextNewLine = false;
    if (this.currentNotInHTML) {
      appendComment(this, token);
      return;
    }
    switch (this.insertionMode) {
      case InsertionMode.INITIAL:
      case InsertionMode.BEFORE_HTML:
      case InsertionMode.BEFORE_HEAD:
      case InsertionMode.IN_HEAD:
      case InsertionMode.IN_HEAD_NO_SCRIPT:
      case InsertionMode.AFTER_HEAD:
      case InsertionMode.IN_BODY:
      case InsertionMode.IN_TABLE:
      case InsertionMode.IN_CAPTION:
      case InsertionMode.IN_COLUMN_GROUP:
      case InsertionMode.IN_TABLE_BODY:
      case InsertionMode.IN_ROW:
      case InsertionMode.IN_CELL:
      case InsertionMode.IN_SELECT:
      case InsertionMode.IN_SELECT_IN_TABLE:
      case InsertionMode.IN_TEMPLATE:
      case InsertionMode.IN_FRAMESET:
      case InsertionMode.AFTER_FRAMESET: {
        appendComment(this, token);
        break;
      }
      case InsertionMode.IN_TABLE_TEXT: {
        tokenInTableText(this, token);
        break;
      }
      case InsertionMode.AFTER_BODY: {
        appendCommentToRootHtmlElement(this, token);
        break;
      }
      case InsertionMode.AFTER_AFTER_BODY:
      case InsertionMode.AFTER_AFTER_FRAMESET: {
        appendCommentToDocument(this, token);
        break;
      }
      // Do nothing
    }
  }
  /** @internal */
  onDoctype(token) {
    this.skipNextNewLine = false;
    switch (this.insertionMode) {
      case InsertionMode.INITIAL: {
        doctypeInInitialMode(this, token);
        break;
      }
      case InsertionMode.BEFORE_HEAD:
      case InsertionMode.IN_HEAD:
      case InsertionMode.IN_HEAD_NO_SCRIPT:
      case InsertionMode.AFTER_HEAD: {
        this._err(token, ERR.misplacedDoctype);
        break;
      }
      case InsertionMode.IN_TABLE_TEXT: {
        tokenInTableText(this, token);
        break;
      }
      // Do nothing
    }
  }
  /** @internal */
  onStartTag(token) {
    this.skipNextNewLine = false;
    this.currentToken = token;
    this._processStartTag(token);
    if (token.selfClosing && !token.ackSelfClosing) {
      this._err(token, ERR.nonVoidHtmlElementStartTagWithTrailingSolidus);
    }
  }
  /**
   * Processes a given start tag.
   *
   * `onStartTag` checks if a self-closing tag was recognized. When a token
   * is moved inbetween multiple insertion modes, this check for self-closing
   * could lead to false positives. To avoid this, `_processStartTag` is used
   * for nested calls.
   *
   * @param token The token to process.
   * @protected
   */
  _processStartTag(token) {
    if (this.shouldProcessStartTagTokenInForeignContent(token)) {
      startTagInForeignContent(this, token);
    } else {
      this._startTagOutsideForeignContent(token);
    }
  }
  /** @protected */
  _startTagOutsideForeignContent(token) {
    switch (this.insertionMode) {
      case InsertionMode.INITIAL: {
        tokenInInitialMode(this, token);
        break;
      }
      case InsertionMode.BEFORE_HTML: {
        startTagBeforeHtml(this, token);
        break;
      }
      case InsertionMode.BEFORE_HEAD: {
        startTagBeforeHead(this, token);
        break;
      }
      case InsertionMode.IN_HEAD: {
        startTagInHead(this, token);
        break;
      }
      case InsertionMode.IN_HEAD_NO_SCRIPT: {
        startTagInHeadNoScript(this, token);
        break;
      }
      case InsertionMode.AFTER_HEAD: {
        startTagAfterHead(this, token);
        break;
      }
      case InsertionMode.IN_BODY: {
        startTagInBody(this, token);
        break;
      }
      case InsertionMode.IN_TABLE: {
        startTagInTable(this, token);
        break;
      }
      case InsertionMode.IN_TABLE_TEXT: {
        tokenInTableText(this, token);
        break;
      }
      case InsertionMode.IN_CAPTION: {
        startTagInCaption(this, token);
        break;
      }
      case InsertionMode.IN_COLUMN_GROUP: {
        startTagInColumnGroup(this, token);
        break;
      }
      case InsertionMode.IN_TABLE_BODY: {
        startTagInTableBody(this, token);
        break;
      }
      case InsertionMode.IN_ROW: {
        startTagInRow(this, token);
        break;
      }
      case InsertionMode.IN_CELL: {
        startTagInCell(this, token);
        break;
      }
      case InsertionMode.IN_SELECT: {
        startTagInSelect(this, token);
        break;
      }
      case InsertionMode.IN_SELECT_IN_TABLE: {
        startTagInSelectInTable(this, token);
        break;
      }
      case InsertionMode.IN_TEMPLATE: {
        startTagInTemplate(this, token);
        break;
      }
      case InsertionMode.AFTER_BODY: {
        startTagAfterBody(this, token);
        break;
      }
      case InsertionMode.IN_FRAMESET: {
        startTagInFrameset(this, token);
        break;
      }
      case InsertionMode.AFTER_FRAMESET: {
        startTagAfterFrameset(this, token);
        break;
      }
      case InsertionMode.AFTER_AFTER_BODY: {
        startTagAfterAfterBody(this, token);
        break;
      }
      case InsertionMode.AFTER_AFTER_FRAMESET: {
        startTagAfterAfterFrameset(this, token);
        break;
      }
      // Do nothing
    }
  }
  /** @internal */
  onEndTag(token) {
    this.skipNextNewLine = false;
    this.currentToken = token;
    if (this.currentNotInHTML) {
      endTagInForeignContent(this, token);
    } else {
      this._endTagOutsideForeignContent(token);
    }
  }
  /** @protected */
  _endTagOutsideForeignContent(token) {
    switch (this.insertionMode) {
      case InsertionMode.INITIAL: {
        tokenInInitialMode(this, token);
        break;
      }
      case InsertionMode.BEFORE_HTML: {
        endTagBeforeHtml(this, token);
        break;
      }
      case InsertionMode.BEFORE_HEAD: {
        endTagBeforeHead(this, token);
        break;
      }
      case InsertionMode.IN_HEAD: {
        endTagInHead(this, token);
        break;
      }
      case InsertionMode.IN_HEAD_NO_SCRIPT: {
        endTagInHeadNoScript(this, token);
        break;
      }
      case InsertionMode.AFTER_HEAD: {
        endTagAfterHead(this, token);
        break;
      }
      case InsertionMode.IN_BODY: {
        endTagInBody(this, token);
        break;
      }
      case InsertionMode.TEXT: {
        endTagInText(this, token);
        break;
      }
      case InsertionMode.IN_TABLE: {
        endTagInTable(this, token);
        break;
      }
      case InsertionMode.IN_TABLE_TEXT: {
        tokenInTableText(this, token);
        break;
      }
      case InsertionMode.IN_CAPTION: {
        endTagInCaption(this, token);
        break;
      }
      case InsertionMode.IN_COLUMN_GROUP: {
        endTagInColumnGroup(this, token);
        break;
      }
      case InsertionMode.IN_TABLE_BODY: {
        endTagInTableBody(this, token);
        break;
      }
      case InsertionMode.IN_ROW: {
        endTagInRow(this, token);
        break;
      }
      case InsertionMode.IN_CELL: {
        endTagInCell(this, token);
        break;
      }
      case InsertionMode.IN_SELECT: {
        endTagInSelect(this, token);
        break;
      }
      case InsertionMode.IN_SELECT_IN_TABLE: {
        endTagInSelectInTable(this, token);
        break;
      }
      case InsertionMode.IN_TEMPLATE: {
        endTagInTemplate(this, token);
        break;
      }
      case InsertionMode.AFTER_BODY: {
        endTagAfterBody(this, token);
        break;
      }
      case InsertionMode.IN_FRAMESET: {
        endTagInFrameset(this, token);
        break;
      }
      case InsertionMode.AFTER_FRAMESET: {
        endTagAfterFrameset(this, token);
        break;
      }
      case InsertionMode.AFTER_AFTER_BODY: {
        tokenAfterAfterBody(this, token);
        break;
      }
      // Do nothing
    }
  }
  /** @internal */
  onEof(token) {
    switch (this.insertionMode) {
      case InsertionMode.INITIAL: {
        tokenInInitialMode(this, token);
        break;
      }
      case InsertionMode.BEFORE_HTML: {
        tokenBeforeHtml(this, token);
        break;
      }
      case InsertionMode.BEFORE_HEAD: {
        tokenBeforeHead(this, token);
        break;
      }
      case InsertionMode.IN_HEAD: {
        tokenInHead(this, token);
        break;
      }
      case InsertionMode.IN_HEAD_NO_SCRIPT: {
        tokenInHeadNoScript(this, token);
        break;
      }
      case InsertionMode.AFTER_HEAD: {
        tokenAfterHead(this, token);
        break;
      }
      case InsertionMode.IN_BODY:
      case InsertionMode.IN_TABLE:
      case InsertionMode.IN_CAPTION:
      case InsertionMode.IN_COLUMN_GROUP:
      case InsertionMode.IN_TABLE_BODY:
      case InsertionMode.IN_ROW:
      case InsertionMode.IN_CELL:
      case InsertionMode.IN_SELECT:
      case InsertionMode.IN_SELECT_IN_TABLE: {
        eofInBody(this, token);
        break;
      }
      case InsertionMode.TEXT: {
        eofInText(this, token);
        break;
      }
      case InsertionMode.IN_TABLE_TEXT: {
        tokenInTableText(this, token);
        break;
      }
      case InsertionMode.IN_TEMPLATE: {
        eofInTemplate(this, token);
        break;
      }
      case InsertionMode.AFTER_BODY:
      case InsertionMode.IN_FRAMESET:
      case InsertionMode.AFTER_FRAMESET:
      case InsertionMode.AFTER_AFTER_BODY:
      case InsertionMode.AFTER_AFTER_FRAMESET: {
        stopParsing(this, token);
        break;
      }
      // Do nothing
    }
  }
  /** @internal */
  onWhitespaceCharacter(token) {
    if (this.skipNextNewLine) {
      this.skipNextNewLine = false;
      if (token.chars.charCodeAt(0) === CODE_POINTS.LINE_FEED) {
        if (token.chars.length === 1) {
          return;
        }
        token.chars = token.chars.substr(1);
      }
    }
    if (this.tokenizer.inForeignNode) {
      this._insertCharacters(token);
      return;
    }
    switch (this.insertionMode) {
      case InsertionMode.IN_HEAD:
      case InsertionMode.IN_HEAD_NO_SCRIPT:
      case InsertionMode.AFTER_HEAD:
      case InsertionMode.TEXT:
      case InsertionMode.IN_COLUMN_GROUP:
      case InsertionMode.IN_SELECT:
      case InsertionMode.IN_SELECT_IN_TABLE:
      case InsertionMode.IN_FRAMESET:
      case InsertionMode.AFTER_FRAMESET: {
        this._insertCharacters(token);
        break;
      }
      case InsertionMode.IN_BODY:
      case InsertionMode.IN_CAPTION:
      case InsertionMode.IN_CELL:
      case InsertionMode.IN_TEMPLATE:
      case InsertionMode.AFTER_BODY:
      case InsertionMode.AFTER_AFTER_BODY:
      case InsertionMode.AFTER_AFTER_FRAMESET: {
        whitespaceCharacterInBody(this, token);
        break;
      }
      case InsertionMode.IN_TABLE:
      case InsertionMode.IN_TABLE_BODY:
      case InsertionMode.IN_ROW: {
        characterInTable(this, token);
        break;
      }
      case InsertionMode.IN_TABLE_TEXT: {
        whitespaceCharacterInTableText(this, token);
        break;
      }
      // Do nothing
    }
  }
}
//Adoption agency algorithm
//(see: http://www.whatwg.org/specs/web-apps/current-work/multipage/tree-construction.html#adoptionAgency)
//------------------------------------------------------------------
//Steps 5-8 of the algorithm
function aaObtainFormattingElementEntry(p, token) {
  let formattingElementEntry = p.activeFormattingElements.getElementEntryInScopeWithTagName(
    token.tagName
  );
  if (formattingElementEntry) {
    if (!p.openElements.contains(formattingElementEntry.element)) {
      p.activeFormattingElements.removeEntry(formattingElementEntry);
      formattingElementEntry = null;
    } else if (!p.openElements.hasInScope(token.tagID)) {
      formattingElementEntry = null;
    }
  } else {
    genericEndTagInBody(p, token);
  }
  return formattingElementEntry;
}
//Steps 9 and 10 of the algorithm
function aaObtainFurthestBlock(p, formattingElementEntry) {
  let furthestBlock = null;
  let idx = p.openElements.stackTop;
  for (; idx >= 0; idx--) {
    const element = p.openElements.items[idx];
    if (element === formattingElementEntry.element) {
      break;
    }
    if (p._isSpecialElement(element, p.openElements.tagIDs[idx])) {
      furthestBlock = element;
    }
  }
  if (!furthestBlock) {
    p.openElements.shortenToLength(Math.max(idx, 0));
    p.activeFormattingElements.removeEntry(formattingElementEntry);
  }
  return furthestBlock;
}
//Step 13 of the algorithm
function aaInnerLoop(p, furthestBlock, formattingElement) {
  let lastElement = furthestBlock;
  let nextElement = p.openElements.getCommonAncestor(furthestBlock);
  for (
    let i = 0, element = nextElement;
    element !== formattingElement;
    i++, element = nextElement
  ) {
    //NOTE: store the next element for the next loop iteration (it may be deleted from the stack by step 9.5)
    nextElement = p.openElements.getCommonAncestor(element);
    const elementEntry = p.activeFormattingElements.getElementEntry(element);
    const counterOverflow = elementEntry && i >= AA_INNER_LOOP_ITER;
    const shouldRemoveFromOpenElements = !elementEntry || counterOverflow;
    if (shouldRemoveFromOpenElements) {
      if (counterOverflow) {
        p.activeFormattingElements.removeEntry(elementEntry);
      }
      p.openElements.remove(element);
    } else {
      element = aaRecreateElementFromEntry(p, elementEntry);
      if (lastElement === furthestBlock) {
        p.activeFormattingElements.bookmark = elementEntry;
      }
      p.treeAdapter.detachNode(lastElement);
      p.treeAdapter.appendChild(element, lastElement);
      lastElement = element;
    }
  }
  return lastElement;
}
//Step 13.7 of the algorithm
function aaRecreateElementFromEntry(p, elementEntry) {
  const ns = p.treeAdapter.getNamespaceURI(elementEntry.element);
  const newElement = p.treeAdapter.createElement(
    elementEntry.token.tagName,
    ns,
    elementEntry.token.attrs
  );
  p.openElements.replace(elementEntry.element, newElement);
  elementEntry.element = newElement;
  return newElement;
}
//Step 14 of the algorithm
function aaInsertLastNodeInCommonAncestor(p, commonAncestor, lastElement) {
  const tn = p.treeAdapter.getTagName(commonAncestor);
  const tid = getTagID(tn);
  if (p._isElementCausesFosterParenting(tid)) {
    p._fosterParentElement(lastElement);
  } else {
    const ns = p.treeAdapter.getNamespaceURI(commonAncestor);
    if (tid === TAG_ID.TEMPLATE && ns === NS.HTML) {
      commonAncestor = p.treeAdapter.getTemplateContent(commonAncestor);
    }
    p.treeAdapter.appendChild(commonAncestor, lastElement);
  }
}
//Steps 15-19 of the algorithm
function aaReplaceFormattingElement(p, furthestBlock, formattingElementEntry) {
  const ns = p.treeAdapter.getNamespaceURI(formattingElementEntry.element);
  const { token } = formattingElementEntry;
  const newElement = p.treeAdapter.createElement(token.tagName, ns, token.attrs);
  p._adoptNodes(furthestBlock, newElement);
  p.treeAdapter.appendChild(furthestBlock, newElement);
  p.activeFormattingElements.insertElementAfterBookmark(newElement, token);
  p.activeFormattingElements.removeEntry(formattingElementEntry);
  p.openElements.remove(formattingElementEntry.element);
  p.openElements.insertAfter(furthestBlock, newElement, token.tagID);
}
//Algorithm entry point
function callAdoptionAgency(p, token) {
  for (let i = 0; i < AA_OUTER_LOOP_ITER; i++) {
    const formattingElementEntry = aaObtainFormattingElementEntry(p, token);
    if (!formattingElementEntry) {
      break;
    }
    const furthestBlock = aaObtainFurthestBlock(p, formattingElementEntry);
    if (!furthestBlock) {
      break;
    }
    p.activeFormattingElements.bookmark = formattingElementEntry;
    const lastElement = aaInnerLoop(p, furthestBlock, formattingElementEntry.element);
    const commonAncestor = p.openElements.getCommonAncestor(formattingElementEntry.element);
    p.treeAdapter.detachNode(lastElement);
    if (commonAncestor) aaInsertLastNodeInCommonAncestor(p, commonAncestor, lastElement);
    aaReplaceFormattingElement(p, furthestBlock, formattingElementEntry);
  }
}
//Generic token handlers
//------------------------------------------------------------------
function appendComment(p, token) {
  p._appendCommentNode(token, p.openElements.currentTmplContentOrNode);
}
function appendCommentToRootHtmlElement(p, token) {
  p._appendCommentNode(token, p.openElements.items[0]);
}
function appendCommentToDocument(p, token) {
  p._appendCommentNode(token, p.document);
}
function stopParsing(p, token) {
  p.stopped = true;
  // NOTE: Set end locations for elements that remain on the open element stack.
  if (token.location) {
    // NOTE: If we are not in a fragment, `html` and `body` will stay on the stack.
    // This is a problem, as we might overwrite their end position here.
    const target = p.fragmentContext ? 0 : 2;
    for (let i = p.openElements.stackTop; i >= target; i--) {
      p._setEndLocation(p.openElements.items[i], token);
    }
    // Handle `html` and `body`
    if (!p.fragmentContext && p.openElements.stackTop >= 0) {
      const htmlElement = p.openElements.items[0];
      const htmlLocation = p.treeAdapter.getNodeSourceCodeLocation(htmlElement);
      if (htmlLocation && !htmlLocation.endTag) {
        p._setEndLocation(htmlElement, token);
        if (p.openElements.stackTop >= 1) {
          const bodyElement = p.openElements.items[1];
          const bodyLocation = p.treeAdapter.getNodeSourceCodeLocation(bodyElement);
          if (bodyLocation && !bodyLocation.endTag) {
            p._setEndLocation(bodyElement, token);
          }
        }
      }
    }
  }
}
// The "initial" insertion mode
//------------------------------------------------------------------
function doctypeInInitialMode(p, token) {
  p._setDocumentType(token);
  const mode = token.forceQuirks ? DOCUMENT_MODE.QUIRKS : getDocumentMode(token);
  if (!isConforming(token)) {
    p._err(token, ERR.nonConformingDoctype);
  }
  p.treeAdapter.setDocumentMode(p.document, mode);
  p.insertionMode = InsertionMode.BEFORE_HTML;
}
function tokenInInitialMode(p, token) {
  p._err(token, ERR.missingDoctype, true);
  p.treeAdapter.setDocumentMode(p.document, DOCUMENT_MODE.QUIRKS);
  p.insertionMode = InsertionMode.BEFORE_HTML;
  p._processToken(token);
}
// The "before html" insertion mode
//------------------------------------------------------------------
function startTagBeforeHtml(p, token) {
  if (token.tagID === TAG_ID.HTML) {
    p._insertElement(token, NS.HTML);
    p.insertionMode = InsertionMode.BEFORE_HEAD;
  } else {
    tokenBeforeHtml(p, token);
  }
}
function endTagBeforeHtml(p, token) {
  const tn = token.tagID;
  if (tn === TAG_ID.HTML || tn === TAG_ID.HEAD || tn === TAG_ID.BODY || tn === TAG_ID.BR) {
    tokenBeforeHtml(p, token);
  }
}
function tokenBeforeHtml(p, token) {
  p._insertFakeRootElement();
  p.insertionMode = InsertionMode.BEFORE_HEAD;
  p._processToken(token);
}
// The "before head" insertion mode
//------------------------------------------------------------------
function startTagBeforeHead(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.HEAD: {
      p._insertElement(token, NS.HTML);
      p.headElement = p.openElements.current;
      p.insertionMode = InsertionMode.IN_HEAD;
      break;
    }
    default: {
      tokenBeforeHead(p, token);
    }
  }
}
function endTagBeforeHead(p, token) {
  const tn = token.tagID;
  if (tn === TAG_ID.HEAD || tn === TAG_ID.BODY || tn === TAG_ID.HTML || tn === TAG_ID.BR) {
    tokenBeforeHead(p, token);
  } else {
    p._err(token, ERR.endTagWithoutMatchingOpenElement);
  }
}
function tokenBeforeHead(p, token) {
  p._insertFakeElement(TAG_NAMES.HEAD, TAG_ID.HEAD);
  p.headElement = p.openElements.current;
  p.insertionMode = InsertionMode.IN_HEAD;
  p._processToken(token);
}
// The "in head" insertion mode
//------------------------------------------------------------------
function startTagInHead(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.BASE:
    case TAG_ID.BASEFONT:
    case TAG_ID.BGSOUND:
    case TAG_ID.LINK:
    case TAG_ID.META: {
      p._appendElement(token, NS.HTML);
      token.ackSelfClosing = true;
      break;
    }
    case TAG_ID.TITLE: {
      p._switchToTextParsing(token, TokenizerMode.RCDATA);
      break;
    }
    case TAG_ID.NOSCRIPT: {
      if (p.options.scriptingEnabled) {
        p._switchToTextParsing(token, TokenizerMode.RAWTEXT);
      } else {
        p._insertElement(token, NS.HTML);
        p.insertionMode = InsertionMode.IN_HEAD_NO_SCRIPT;
      }
      break;
    }
    case TAG_ID.NOFRAMES:
    case TAG_ID.STYLE: {
      p._switchToTextParsing(token, TokenizerMode.RAWTEXT);
      break;
    }
    case TAG_ID.SCRIPT: {
      p._switchToTextParsing(token, TokenizerMode.SCRIPT_DATA);
      break;
    }
    case TAG_ID.TEMPLATE: {
      p._insertTemplate(token);
      p.activeFormattingElements.insertMarker();
      p.framesetOk = false;
      p.insertionMode = InsertionMode.IN_TEMPLATE;
      p.tmplInsertionModeStack.unshift(InsertionMode.IN_TEMPLATE);
      break;
    }
    case TAG_ID.HEAD: {
      p._err(token, ERR.misplacedStartTagForHeadElement);
      break;
    }
    default: {
      tokenInHead(p, token);
    }
  }
}
function endTagInHead(p, token) {
  switch (token.tagID) {
    case TAG_ID.HEAD: {
      p.openElements.pop();
      p.insertionMode = InsertionMode.AFTER_HEAD;
      break;
    }
    case TAG_ID.BODY:
    case TAG_ID.BR:
    case TAG_ID.HTML: {
      tokenInHead(p, token);
      break;
    }
    case TAG_ID.TEMPLATE: {
      templateEndTagInHead(p, token);
      break;
    }
    default: {
      p._err(token, ERR.endTagWithoutMatchingOpenElement);
    }
  }
}
function templateEndTagInHead(p, token) {
  if (p.openElements.tmplCount > 0) {
    p.openElements.generateImpliedEndTagsThoroughly();
    if (p.openElements.currentTagId !== TAG_ID.TEMPLATE) {
      p._err(token, ERR.closingOfElementWithOpenChildElements);
    }
    p.openElements.popUntilTagNamePopped(TAG_ID.TEMPLATE);
    p.activeFormattingElements.clearToLastMarker();
    p.tmplInsertionModeStack.shift();
    p._resetInsertionMode();
  } else {
    p._err(token, ERR.endTagWithoutMatchingOpenElement);
  }
}
function tokenInHead(p, token) {
  p.openElements.pop();
  p.insertionMode = InsertionMode.AFTER_HEAD;
  p._processToken(token);
}
// The "in head no script" insertion mode
//------------------------------------------------------------------
function startTagInHeadNoScript(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.BASEFONT:
    case TAG_ID.BGSOUND:
    case TAG_ID.HEAD:
    case TAG_ID.LINK:
    case TAG_ID.META:
    case TAG_ID.NOFRAMES:
    case TAG_ID.STYLE: {
      startTagInHead(p, token);
      break;
    }
    case TAG_ID.NOSCRIPT: {
      p._err(token, ERR.nestedNoscriptInHead);
      break;
    }
    default: {
      tokenInHeadNoScript(p, token);
    }
  }
}
function endTagInHeadNoScript(p, token) {
  switch (token.tagID) {
    case TAG_ID.NOSCRIPT: {
      p.openElements.pop();
      p.insertionMode = InsertionMode.IN_HEAD;
      break;
    }
    case TAG_ID.BR: {
      tokenInHeadNoScript(p, token);
      break;
    }
    default: {
      p._err(token, ERR.endTagWithoutMatchingOpenElement);
    }
  }
}
function tokenInHeadNoScript(p, token) {
  const errCode =
    token.type === TokenType.EOF
      ? ERR.openElementsLeftAfterEof
      : ERR.disallowedContentInNoscriptInHead;
  p._err(token, errCode);
  p.openElements.pop();
  p.insertionMode = InsertionMode.IN_HEAD;
  p._processToken(token);
}
// The "after head" insertion mode
//------------------------------------------------------------------
function startTagAfterHead(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.BODY: {
      p._insertElement(token, NS.HTML);
      p.framesetOk = false;
      p.insertionMode = InsertionMode.IN_BODY;
      break;
    }
    case TAG_ID.FRAMESET: {
      p._insertElement(token, NS.HTML);
      p.insertionMode = InsertionMode.IN_FRAMESET;
      break;
    }
    case TAG_ID.BASE:
    case TAG_ID.BASEFONT:
    case TAG_ID.BGSOUND:
    case TAG_ID.LINK:
    case TAG_ID.META:
    case TAG_ID.NOFRAMES:
    case TAG_ID.SCRIPT:
    case TAG_ID.STYLE:
    case TAG_ID.TEMPLATE:
    case TAG_ID.TITLE: {
      p._err(token, ERR.abandonedHeadElementChild);
      p.openElements.push(p.headElement, TAG_ID.HEAD);
      startTagInHead(p, token);
      p.openElements.remove(p.headElement);
      break;
    }
    case TAG_ID.HEAD: {
      p._err(token, ERR.misplacedStartTagForHeadElement);
      break;
    }
    default: {
      tokenAfterHead(p, token);
    }
  }
}
function endTagAfterHead(p, token) {
  switch (token.tagID) {
    case TAG_ID.BODY:
    case TAG_ID.HTML:
    case TAG_ID.BR: {
      tokenAfterHead(p, token);
      break;
    }
    case TAG_ID.TEMPLATE: {
      templateEndTagInHead(p, token);
      break;
    }
    default: {
      p._err(token, ERR.endTagWithoutMatchingOpenElement);
    }
  }
}
function tokenAfterHead(p, token) {
  p._insertFakeElement(TAG_NAMES.BODY, TAG_ID.BODY);
  p.insertionMode = InsertionMode.IN_BODY;
  modeInBody(p, token);
}
// The "in body" insertion mode
//------------------------------------------------------------------
function modeInBody(p, token) {
  switch (token.type) {
    case TokenType.CHARACTER: {
      characterInBody(p, token);
      break;
    }
    case TokenType.WHITESPACE_CHARACTER: {
      whitespaceCharacterInBody(p, token);
      break;
    }
    case TokenType.COMMENT: {
      appendComment(p, token);
      break;
    }
    case TokenType.START_TAG: {
      startTagInBody(p, token);
      break;
    }
    case TokenType.END_TAG: {
      endTagInBody(p, token);
      break;
    }
    case TokenType.EOF: {
      eofInBody(p, token);
      break;
    }
    // Do nothing
  }
}
function whitespaceCharacterInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._insertCharacters(token);
}
function characterInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._insertCharacters(token);
  p.framesetOk = false;
}
function htmlStartTagInBody(p, token) {
  if (p.openElements.tmplCount === 0) {
    p.treeAdapter.adoptAttributes(p.openElements.items[0], token.attrs);
  }
}
function bodyStartTagInBody(p, token) {
  const bodyElement = p.openElements.tryPeekProperlyNestedBodyElement();
  if (bodyElement && p.openElements.tmplCount === 0) {
    p.framesetOk = false;
    p.treeAdapter.adoptAttributes(bodyElement, token.attrs);
  }
}
function framesetStartTagInBody(p, token) {
  const bodyElement = p.openElements.tryPeekProperlyNestedBodyElement();
  if (p.framesetOk && bodyElement) {
    p.treeAdapter.detachNode(bodyElement);
    p.openElements.popAllUpToHtmlElement();
    p._insertElement(token, NS.HTML);
    p.insertionMode = InsertionMode.IN_FRAMESET;
  }
}
function addressStartTagInBody(p, token) {
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  p._insertElement(token, NS.HTML);
}
function numberedHeaderStartTagInBody(p, token) {
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  if (
    p.openElements.currentTagId !== undefined &&
    NUMBERED_HEADERS.has(p.openElements.currentTagId)
  ) {
    p.openElements.pop();
  }
  p._insertElement(token, NS.HTML);
}
function preStartTagInBody(p, token) {
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  p._insertElement(token, NS.HTML);
  //NOTE: If the next token is a U+000A LINE FEED (LF) character token, then ignore that token and move
  //on to the next one. (Newlines at the start of pre blocks are ignored as an authoring convenience.)
  p.skipNextNewLine = true;
  p.framesetOk = false;
}
function formStartTagInBody(p, token) {
  const inTemplate = p.openElements.tmplCount > 0;
  if (!p.formElement || inTemplate) {
    if (p.openElements.hasInButtonScope(TAG_ID.P)) {
      p._closePElement();
    }
    p._insertElement(token, NS.HTML);
    if (!inTemplate) {
      p.formElement = p.openElements.current;
    }
  }
}
function listItemStartTagInBody(p, token) {
  p.framesetOk = false;
  const tn = token.tagID;
  for (let i = p.openElements.stackTop; i >= 0; i--) {
    const elementId = p.openElements.tagIDs[i];
    if (
      (tn === TAG_ID.LI && elementId === TAG_ID.LI) ||
      ((tn === TAG_ID.DD || tn === TAG_ID.DT) &&
        (elementId === TAG_ID.DD || elementId === TAG_ID.DT))
    ) {
      p.openElements.generateImpliedEndTagsWithExclusion(elementId);
      p.openElements.popUntilTagNamePopped(elementId);
      break;
    }
    if (
      elementId !== TAG_ID.ADDRESS &&
      elementId !== TAG_ID.DIV &&
      elementId !== TAG_ID.P &&
      p._isSpecialElement(p.openElements.items[i], elementId)
    ) {
      break;
    }
  }
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  p._insertElement(token, NS.HTML);
}
function plaintextStartTagInBody(p, token) {
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  p._insertElement(token, NS.HTML);
  p.tokenizer.state = TokenizerMode.PLAINTEXT;
}
function buttonStartTagInBody(p, token) {
  if (p.openElements.hasInScope(TAG_ID.BUTTON)) {
    p.openElements.generateImpliedEndTags();
    p.openElements.popUntilTagNamePopped(TAG_ID.BUTTON);
  }
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
  p.framesetOk = false;
}
function aStartTagInBody(p, token) {
  const activeElementEntry = p.activeFormattingElements.getElementEntryInScopeWithTagName(
    TAG_NAMES.A
  );
  if (activeElementEntry) {
    callAdoptionAgency(p, token);
    p.openElements.remove(activeElementEntry.element);
    p.activeFormattingElements.removeEntry(activeElementEntry);
  }
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
  p.activeFormattingElements.pushElement(p.openElements.current, token);
}
function bStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
  p.activeFormattingElements.pushElement(p.openElements.current, token);
}
function nobrStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  if (p.openElements.hasInScope(TAG_ID.NOBR)) {
    callAdoptionAgency(p, token);
    p._reconstructActiveFormattingElements();
  }
  p._insertElement(token, NS.HTML);
  p.activeFormattingElements.pushElement(p.openElements.current, token);
}
function appletStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
  p.activeFormattingElements.insertMarker();
  p.framesetOk = false;
}
function tableStartTagInBody(p, token) {
  if (
    p.treeAdapter.getDocumentMode(p.document) !== DOCUMENT_MODE.QUIRKS &&
    p.openElements.hasInButtonScope(TAG_ID.P)
  ) {
    p._closePElement();
  }
  p._insertElement(token, NS.HTML);
  p.framesetOk = false;
  p.insertionMode = InsertionMode.IN_TABLE;
}
function areaStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._appendElement(token, NS.HTML);
  p.framesetOk = false;
  token.ackSelfClosing = true;
}
function isHiddenInput(token) {
  const inputType = getTokenAttr(token, ATTRS.TYPE);
  return inputType != null && inputType.toLowerCase() === HIDDEN_INPUT_TYPE;
}
function inputStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._appendElement(token, NS.HTML);
  if (!isHiddenInput(token)) {
    p.framesetOk = false;
  }
  token.ackSelfClosing = true;
}
function paramStartTagInBody(p, token) {
  p._appendElement(token, NS.HTML);
  token.ackSelfClosing = true;
}
function hrStartTagInBody(p, token) {
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  p._appendElement(token, NS.HTML);
  p.framesetOk = false;
  token.ackSelfClosing = true;
}
function imageStartTagInBody(p, token) {
  token.tagName = TAG_NAMES.IMG;
  token.tagID = TAG_ID.IMG;
  areaStartTagInBody(p, token);
}
function textareaStartTagInBody(p, token) {
  p._insertElement(token, NS.HTML);
  //NOTE: If the next token is a U+000A LINE FEED (LF) character token, then ignore that token and move
  //on to the next one. (Newlines at the start of textarea elements are ignored as an authoring convenience.)
  p.skipNextNewLine = true;
  p.tokenizer.state = TokenizerMode.RCDATA;
  p.originalInsertionMode = p.insertionMode;
  p.framesetOk = false;
  p.insertionMode = InsertionMode.TEXT;
}
function xmpStartTagInBody(p, token) {
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  p._reconstructActiveFormattingElements();
  p.framesetOk = false;
  p._switchToTextParsing(token, TokenizerMode.RAWTEXT);
}
function iframeStartTagInBody(p, token) {
  p.framesetOk = false;
  p._switchToTextParsing(token, TokenizerMode.RAWTEXT);
}
//NOTE: here we assume that we always act as a user agent with enabled plugins/frames, so we parse
//<noembed>/<noframes> as rawtext.
function rawTextStartTagInBody(p, token) {
  p._switchToTextParsing(token, TokenizerMode.RAWTEXT);
}
function selectStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
  p.framesetOk = false;
  p.insertionMode =
    p.insertionMode === InsertionMode.IN_TABLE ||
    p.insertionMode === InsertionMode.IN_CAPTION ||
    p.insertionMode === InsertionMode.IN_TABLE_BODY ||
    p.insertionMode === InsertionMode.IN_ROW ||
    p.insertionMode === InsertionMode.IN_CELL
      ? InsertionMode.IN_SELECT_IN_TABLE
      : InsertionMode.IN_SELECT;
}
function optgroupStartTagInBody(p, token) {
  if (p.openElements.currentTagId === TAG_ID.OPTION) {
    p.openElements.pop();
  }
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
}
function rbStartTagInBody(p, token) {
  if (p.openElements.hasInScope(TAG_ID.RUBY)) {
    p.openElements.generateImpliedEndTags();
  }
  p._insertElement(token, NS.HTML);
}
function rtStartTagInBody(p, token) {
  if (p.openElements.hasInScope(TAG_ID.RUBY)) {
    p.openElements.generateImpliedEndTagsWithExclusion(TAG_ID.RTC);
  }
  p._insertElement(token, NS.HTML);
}
function mathStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  adjustTokenMathMLAttrs(token);
  adjustTokenXMLAttrs(token);
  if (token.selfClosing) {
    p._appendElement(token, NS.MATHML);
  } else {
    p._insertElement(token, NS.MATHML);
  }
  token.ackSelfClosing = true;
}
function svgStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  adjustTokenSVGAttrs(token);
  adjustTokenXMLAttrs(token);
  if (token.selfClosing) {
    p._appendElement(token, NS.SVG);
  } else {
    p._insertElement(token, NS.SVG);
  }
  token.ackSelfClosing = true;
}
function genericStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
}
function startTagInBody(p, token) {
  switch (token.tagID) {
    case TAG_ID.I:
    case TAG_ID.S:
    case TAG_ID.B:
    case TAG_ID.U:
    case TAG_ID.EM:
    case TAG_ID.TT:
    case TAG_ID.BIG:
    case TAG_ID.CODE:
    case TAG_ID.FONT:
    case TAG_ID.SMALL:
    case TAG_ID.STRIKE:
    case TAG_ID.STRONG: {
      bStartTagInBody(p, token);
      break;
    }
    case TAG_ID.A: {
      aStartTagInBody(p, token);
      break;
    }
    case TAG_ID.H1:
    case TAG_ID.H2:
    case TAG_ID.H3:
    case TAG_ID.H4:
    case TAG_ID.H5:
    case TAG_ID.H6: {
      numberedHeaderStartTagInBody(p, token);
      break;
    }
    case TAG_ID.P:
    case TAG_ID.DL:
    case TAG_ID.OL:
    case TAG_ID.UL:
    case TAG_ID.DIV:
    case TAG_ID.DIR:
    case TAG_ID.NAV:
    case TAG_ID.MAIN:
    case TAG_ID.MENU:
    case TAG_ID.ASIDE:
    case TAG_ID.CENTER:
    case TAG_ID.FIGURE:
    case TAG_ID.FOOTER:
    case TAG_ID.HEADER:
    case TAG_ID.HGROUP:
    case TAG_ID.DIALOG:
    case TAG_ID.DETAILS:
    case TAG_ID.ADDRESS:
    case TAG_ID.ARTICLE:
    case TAG_ID.SEARCH:
    case TAG_ID.SECTION:
    case TAG_ID.SUMMARY:
    case TAG_ID.FIELDSET:
    case TAG_ID.BLOCKQUOTE:
    case TAG_ID.FIGCAPTION: {
      addressStartTagInBody(p, token);
      break;
    }
    case TAG_ID.LI:
    case TAG_ID.DD:
    case TAG_ID.DT: {
      listItemStartTagInBody(p, token);
      break;
    }
    case TAG_ID.BR:
    case TAG_ID.IMG:
    case TAG_ID.WBR:
    case TAG_ID.AREA:
    case TAG_ID.EMBED:
    case TAG_ID.KEYGEN: {
      areaStartTagInBody(p, token);
      break;
    }
    case TAG_ID.HR: {
      hrStartTagInBody(p, token);
      break;
    }
    case TAG_ID.RB:
    case TAG_ID.RTC: {
      rbStartTagInBody(p, token);
      break;
    }
    case TAG_ID.RT:
    case TAG_ID.RP: {
      rtStartTagInBody(p, token);
      break;
    }
    case TAG_ID.PRE:
    case TAG_ID.LISTING: {
      preStartTagInBody(p, token);
      break;
    }
    case TAG_ID.XMP: {
      xmpStartTagInBody(p, token);
      break;
    }
    case TAG_ID.SVG: {
      svgStartTagInBody(p, token);
      break;
    }
    case TAG_ID.HTML: {
      htmlStartTagInBody(p, token);
      break;
    }
    case TAG_ID.BASE:
    case TAG_ID.LINK:
    case TAG_ID.META:
    case TAG_ID.STYLE:
    case TAG_ID.TITLE:
    case TAG_ID.SCRIPT:
    case TAG_ID.BGSOUND:
    case TAG_ID.BASEFONT:
    case TAG_ID.TEMPLATE: {
      startTagInHead(p, token);
      break;
    }
    case TAG_ID.BODY: {
      bodyStartTagInBody(p, token);
      break;
    }
    case TAG_ID.FORM: {
      formStartTagInBody(p, token);
      break;
    }
    case TAG_ID.NOBR: {
      nobrStartTagInBody(p, token);
      break;
    }
    case TAG_ID.MATH: {
      mathStartTagInBody(p, token);
      break;
    }
    case TAG_ID.TABLE: {
      tableStartTagInBody(p, token);
      break;
    }
    case TAG_ID.INPUT: {
      inputStartTagInBody(p, token);
      break;
    }
    case TAG_ID.PARAM:
    case TAG_ID.TRACK:
    case TAG_ID.SOURCE: {
      paramStartTagInBody(p, token);
      break;
    }
    case TAG_ID.IMAGE: {
      imageStartTagInBody(p, token);
      break;
    }
    case TAG_ID.BUTTON: {
      buttonStartTagInBody(p, token);
      break;
    }
    case TAG_ID.APPLET:
    case TAG_ID.OBJECT:
    case TAG_ID.MARQUEE: {
      appletStartTagInBody(p, token);
      break;
    }
    case TAG_ID.IFRAME: {
      iframeStartTagInBody(p, token);
      break;
    }
    case TAG_ID.SELECT: {
      selectStartTagInBody(p, token);
      break;
    }
    case TAG_ID.OPTION:
    case TAG_ID.OPTGROUP: {
      optgroupStartTagInBody(p, token);
      break;
    }
    case TAG_ID.NOEMBED:
    case TAG_ID.NOFRAMES: {
      rawTextStartTagInBody(p, token);
      break;
    }
    case TAG_ID.FRAMESET: {
      framesetStartTagInBody(p, token);
      break;
    }
    case TAG_ID.TEXTAREA: {
      textareaStartTagInBody(p, token);
      break;
    }
    case TAG_ID.NOSCRIPT: {
      if (p.options.scriptingEnabled) {
        rawTextStartTagInBody(p, token);
      } else {
        genericStartTagInBody(p, token);
      }
      break;
    }
    case TAG_ID.PLAINTEXT: {
      plaintextStartTagInBody(p, token);
      break;
    }
    case TAG_ID.COL:
    case TAG_ID.TH:
    case TAG_ID.TD:
    case TAG_ID.TR:
    case TAG_ID.HEAD:
    case TAG_ID.FRAME:
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD:
    case TAG_ID.CAPTION:
    case TAG_ID.COLGROUP: {
      // Ignore token
      break;
    }
    default: {
      genericStartTagInBody(p, token);
    }
  }
}
function bodyEndTagInBody(p, token) {
  if (p.openElements.hasInScope(TAG_ID.BODY)) {
    p.insertionMode = InsertionMode.AFTER_BODY;
    //NOTE: <body> is never popped from the stack, so we need to updated
    //the end location explicitly.
    if (p.options.sourceCodeLocationInfo) {
      const bodyElement = p.openElements.tryPeekProperlyNestedBodyElement();
      if (bodyElement) {
        p._setEndLocation(bodyElement, token);
      }
    }
  }
}
function htmlEndTagInBody(p, token) {
  if (p.openElements.hasInScope(TAG_ID.BODY)) {
    p.insertionMode = InsertionMode.AFTER_BODY;
    endTagAfterBody(p, token);
  }
}
function addressEndTagInBody(p, token) {
  const tn = token.tagID;
  if (p.openElements.hasInScope(tn)) {
    p.openElements.generateImpliedEndTags();
    p.openElements.popUntilTagNamePopped(tn);
  }
}
function formEndTagInBody(p) {
  const inTemplate = p.openElements.tmplCount > 0;
  const { formElement } = p;
  if (!inTemplate) {
    p.formElement = null;
  }
  if ((formElement || inTemplate) && p.openElements.hasInScope(TAG_ID.FORM)) {
    p.openElements.generateImpliedEndTags();
    if (inTemplate) {
      p.openElements.popUntilTagNamePopped(TAG_ID.FORM);
    } else if (formElement) {
      p.openElements.remove(formElement);
    }
  }
}
function pEndTagInBody(p) {
  if (!p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._insertFakeElement(TAG_NAMES.P, TAG_ID.P);
  }
  p._closePElement();
}
function liEndTagInBody(p) {
  if (p.openElements.hasInListItemScope(TAG_ID.LI)) {
    p.openElements.generateImpliedEndTagsWithExclusion(TAG_ID.LI);
    p.openElements.popUntilTagNamePopped(TAG_ID.LI);
  }
}
function ddEndTagInBody(p, token) {
  const tn = token.tagID;
  if (p.openElements.hasInScope(tn)) {
    p.openElements.generateImpliedEndTagsWithExclusion(tn);
    p.openElements.popUntilTagNamePopped(tn);
  }
}
function numberedHeaderEndTagInBody(p) {
  if (p.openElements.hasNumberedHeaderInScope()) {
    p.openElements.generateImpliedEndTags();
    p.openElements.popUntilNumberedHeaderPopped();
  }
}
function appletEndTagInBody(p, token) {
  const tn = token.tagID;
  if (p.openElements.hasInScope(tn)) {
    p.openElements.generateImpliedEndTags();
    p.openElements.popUntilTagNamePopped(tn);
    p.activeFormattingElements.clearToLastMarker();
  }
}
function brEndTagInBody(p) {
  p._reconstructActiveFormattingElements();
  p._insertFakeElement(TAG_NAMES.BR, TAG_ID.BR);
  p.openElements.pop();
  p.framesetOk = false;
}
function genericEndTagInBody(p, token) {
  const tn = token.tagName;
  const tid = token.tagID;
  for (let i = p.openElements.stackTop; i > 0; i--) {
    const element = p.openElements.items[i];
    const elementId = p.openElements.tagIDs[i];
    // Compare the tag name here, as the tag might not be a known tag with an ID.
    if (tid === elementId && (tid !== TAG_ID.UNKNOWN || p.treeAdapter.getTagName(element) === tn)) {
      p.openElements.generateImpliedEndTagsWithExclusion(tid);
      if (p.openElements.stackTop >= i) p.openElements.shortenToLength(i);
      break;
    }
    if (p._isSpecialElement(element, elementId)) {
      break;
    }
  }
}
function endTagInBody(p, token) {
  switch (token.tagID) {
    case TAG_ID.A:
    case TAG_ID.B:
    case TAG_ID.I:
    case TAG_ID.S:
    case TAG_ID.U:
    case TAG_ID.EM:
    case TAG_ID.TT:
    case TAG_ID.BIG:
    case TAG_ID.CODE:
    case TAG_ID.FONT:
    case TAG_ID.NOBR:
    case TAG_ID.SMALL:
    case TAG_ID.STRIKE:
    case TAG_ID.STRONG: {
      callAdoptionAgency(p, token);
      break;
    }
    case TAG_ID.P: {
      pEndTagInBody(p);
      break;
    }
    case TAG_ID.DL:
    case TAG_ID.UL:
    case TAG_ID.OL:
    case TAG_ID.DIR:
    case TAG_ID.DIV:
    case TAG_ID.NAV:
    case TAG_ID.PRE:
    case TAG_ID.MAIN:
    case TAG_ID.MENU:
    case TAG_ID.ASIDE:
    case TAG_ID.BUTTON:
    case TAG_ID.CENTER:
    case TAG_ID.FIGURE:
    case TAG_ID.FOOTER:
    case TAG_ID.HEADER:
    case TAG_ID.HGROUP:
    case TAG_ID.DIALOG:
    case TAG_ID.ADDRESS:
    case TAG_ID.ARTICLE:
    case TAG_ID.DETAILS:
    case TAG_ID.SEARCH:
    case TAG_ID.SECTION:
    case TAG_ID.SUMMARY:
    case TAG_ID.LISTING:
    case TAG_ID.FIELDSET:
    case TAG_ID.BLOCKQUOTE:
    case TAG_ID.FIGCAPTION: {
      addressEndTagInBody(p, token);
      break;
    }
    case TAG_ID.LI: {
      liEndTagInBody(p);
      break;
    }
    case TAG_ID.DD:
    case TAG_ID.DT: {
      ddEndTagInBody(p, token);
      break;
    }
    case TAG_ID.H1:
    case TAG_ID.H2:
    case TAG_ID.H3:
    case TAG_ID.H4:
    case TAG_ID.H5:
    case TAG_ID.H6: {
      numberedHeaderEndTagInBody(p);
      break;
    }
    case TAG_ID.BR: {
      brEndTagInBody(p);
      break;
    }
    case TAG_ID.BODY: {
      bodyEndTagInBody(p, token);
      break;
    }
    case TAG_ID.HTML: {
      htmlEndTagInBody(p, token);
      break;
    }
    case TAG_ID.FORM: {
      formEndTagInBody(p);
      break;
    }
    case TAG_ID.APPLET:
    case TAG_ID.OBJECT:
    case TAG_ID.MARQUEE: {
      appletEndTagInBody(p, token);
      break;
    }
    case TAG_ID.TEMPLATE: {
      templateEndTagInHead(p, token);
      break;
    }
    default: {
      genericEndTagInBody(p, token);
    }
  }
}
function eofInBody(p, token) {
  if (p.tmplInsertionModeStack.length > 0) {
    eofInTemplate(p, token);
  } else {
    stopParsing(p, token);
  }
}
// The "text" insertion mode
//------------------------------------------------------------------
function endTagInText(p, token) {
  var _a;
  if (token.tagID === TAG_ID.SCRIPT) {
    (_a = p.scriptHandler) === null || _a === void 0 ? void 0 : _a.call(p, p.openElements.current);
  }
  p.openElements.pop();
  p.insertionMode = p.originalInsertionMode;
}
function eofInText(p, token) {
  p._err(token, ERR.eofInElementThatCanContainOnlyText);
  p.openElements.pop();
  p.insertionMode = p.originalInsertionMode;
  p.onEof(token);
}
// The "in table" insertion mode
//------------------------------------------------------------------
function characterInTable(p, token) {
  if (
    p.openElements.currentTagId !== undefined &&
    TABLE_STRUCTURE_TAGS.has(p.openElements.currentTagId)
  ) {
    p.pendingCharacterTokens.length = 0;
    p.hasNonWhitespacePendingCharacterToken = false;
    p.originalInsertionMode = p.insertionMode;
    p.insertionMode = InsertionMode.IN_TABLE_TEXT;
    switch (token.type) {
      case TokenType.CHARACTER: {
        characterInTableText(p, token);
        break;
      }
      case TokenType.WHITESPACE_CHARACTER: {
        whitespaceCharacterInTableText(p, token);
        break;
      }
      // Ignore null
    }
  } else {
    tokenInTable(p, token);
  }
}
function captionStartTagInTable(p, token) {
  p.openElements.clearBackToTableContext();
  p.activeFormattingElements.insertMarker();
  p._insertElement(token, NS.HTML);
  p.insertionMode = InsertionMode.IN_CAPTION;
}
function colgroupStartTagInTable(p, token) {
  p.openElements.clearBackToTableContext();
  p._insertElement(token, NS.HTML);
  p.insertionMode = InsertionMode.IN_COLUMN_GROUP;
}
function colStartTagInTable(p, token) {
  p.openElements.clearBackToTableContext();
  p._insertFakeElement(TAG_NAMES.COLGROUP, TAG_ID.COLGROUP);
  p.insertionMode = InsertionMode.IN_COLUMN_GROUP;
  startTagInColumnGroup(p, token);
}
function tbodyStartTagInTable(p, token) {
  p.openElements.clearBackToTableContext();
  p._insertElement(token, NS.HTML);
  p.insertionMode = InsertionMode.IN_TABLE_BODY;
}
function tdStartTagInTable(p, token) {
  p.openElements.clearBackToTableContext();
  p._insertFakeElement(TAG_NAMES.TBODY, TAG_ID.TBODY);
  p.insertionMode = InsertionMode.IN_TABLE_BODY;
  startTagInTableBody(p, token);
}
function tableStartTagInTable(p, token) {
  if (p.openElements.hasInTableScope(TAG_ID.TABLE)) {
    p.openElements.popUntilTagNamePopped(TAG_ID.TABLE);
    p._resetInsertionMode();
    p._processStartTag(token);
  }
}
function inputStartTagInTable(p, token) {
  if (isHiddenInput(token)) {
    p._appendElement(token, NS.HTML);
  } else {
    tokenInTable(p, token);
  }
  token.ackSelfClosing = true;
}
function formStartTagInTable(p, token) {
  if (!p.formElement && p.openElements.tmplCount === 0) {
    p._insertElement(token, NS.HTML);
    p.formElement = p.openElements.current;
    p.openElements.pop();
  }
}
function startTagInTable(p, token) {
  switch (token.tagID) {
    case TAG_ID.TD:
    case TAG_ID.TH:
    case TAG_ID.TR: {
      tdStartTagInTable(p, token);
      break;
    }
    case TAG_ID.STYLE:
    case TAG_ID.SCRIPT:
    case TAG_ID.TEMPLATE: {
      startTagInHead(p, token);
      break;
    }
    case TAG_ID.COL: {
      colStartTagInTable(p, token);
      break;
    }
    case TAG_ID.FORM: {
      formStartTagInTable(p, token);
      break;
    }
    case TAG_ID.TABLE: {
      tableStartTagInTable(p, token);
      break;
    }
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD: {
      tbodyStartTagInTable(p, token);
      break;
    }
    case TAG_ID.INPUT: {
      inputStartTagInTable(p, token);
      break;
    }
    case TAG_ID.CAPTION: {
      captionStartTagInTable(p, token);
      break;
    }
    case TAG_ID.COLGROUP: {
      colgroupStartTagInTable(p, token);
      break;
    }
    default: {
      tokenInTable(p, token);
    }
  }
}
function endTagInTable(p, token) {
  switch (token.tagID) {
    case TAG_ID.TABLE: {
      if (p.openElements.hasInTableScope(TAG_ID.TABLE)) {
        p.openElements.popUntilTagNamePopped(TAG_ID.TABLE);
        p._resetInsertionMode();
      }
      break;
    }
    case TAG_ID.TEMPLATE: {
      templateEndTagInHead(p, token);
      break;
    }
    case TAG_ID.BODY:
    case TAG_ID.CAPTION:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.HTML:
    case TAG_ID.TBODY:
    case TAG_ID.TD:
    case TAG_ID.TFOOT:
    case TAG_ID.TH:
    case TAG_ID.THEAD:
    case TAG_ID.TR: {
      // Ignore token
      break;
    }
    default: {
      tokenInTable(p, token);
    }
  }
}
function tokenInTable(p, token) {
  const savedFosterParentingState = p.fosterParentingEnabled;
  p.fosterParentingEnabled = true;
  // Process token in `In Body` mode
  modeInBody(p, token);
  p.fosterParentingEnabled = savedFosterParentingState;
}
// The "in table text" insertion mode
//------------------------------------------------------------------
function whitespaceCharacterInTableText(p, token) {
  p.pendingCharacterTokens.push(token);
}
function characterInTableText(p, token) {
  p.pendingCharacterTokens.push(token);
  p.hasNonWhitespacePendingCharacterToken = true;
}
function tokenInTableText(p, token) {
  let i = 0;
  if (p.hasNonWhitespacePendingCharacterToken) {
    for (; i < p.pendingCharacterTokens.length; i++) {
      tokenInTable(p, p.pendingCharacterTokens[i]);
    }
  } else {
    for (; i < p.pendingCharacterTokens.length; i++) {
      p._insertCharacters(p.pendingCharacterTokens[i]);
    }
  }
  p.insertionMode = p.originalInsertionMode;
  p._processToken(token);
}
// The "in caption" insertion mode
//------------------------------------------------------------------
const TABLE_VOID_ELEMENTS = new Set([
  TAG_ID.CAPTION,
  TAG_ID.COL,
  TAG_ID.COLGROUP,
  TAG_ID.TBODY,
  TAG_ID.TD,
  TAG_ID.TFOOT,
  TAG_ID.TH,
  TAG_ID.THEAD,
  TAG_ID.TR
]);
function startTagInCaption(p, token) {
  const tn = token.tagID;
  if (TABLE_VOID_ELEMENTS.has(tn)) {
    if (p.openElements.hasInTableScope(TAG_ID.CAPTION)) {
      p.openElements.generateImpliedEndTags();
      p.openElements.popUntilTagNamePopped(TAG_ID.CAPTION);
      p.activeFormattingElements.clearToLastMarker();
      p.insertionMode = InsertionMode.IN_TABLE;
      startTagInTable(p, token);
    }
  } else {
    startTagInBody(p, token);
  }
}
function endTagInCaption(p, token) {
  const tn = token.tagID;
  switch (tn) {
    case TAG_ID.CAPTION:
    case TAG_ID.TABLE: {
      if (p.openElements.hasInTableScope(TAG_ID.CAPTION)) {
        p.openElements.generateImpliedEndTags();
        p.openElements.popUntilTagNamePopped(TAG_ID.CAPTION);
        p.activeFormattingElements.clearToLastMarker();
        p.insertionMode = InsertionMode.IN_TABLE;
        if (tn === TAG_ID.TABLE) {
          endTagInTable(p, token);
        }
      }
      break;
    }
    case TAG_ID.BODY:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.HTML:
    case TAG_ID.TBODY:
    case TAG_ID.TD:
    case TAG_ID.TFOOT:
    case TAG_ID.TH:
    case TAG_ID.THEAD:
    case TAG_ID.TR: {
      // Ignore token
      break;
    }
    default: {
      endTagInBody(p, token);
    }
  }
}
// The "in column group" insertion mode
//------------------------------------------------------------------
function startTagInColumnGroup(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.COL: {
      p._appendElement(token, NS.HTML);
      token.ackSelfClosing = true;
      break;
    }
    case TAG_ID.TEMPLATE: {
      startTagInHead(p, token);
      break;
    }
    default: {
      tokenInColumnGroup(p, token);
    }
  }
}
function endTagInColumnGroup(p, token) {
  switch (token.tagID) {
    case TAG_ID.COLGROUP: {
      if (p.openElements.currentTagId === TAG_ID.COLGROUP) {
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE;
      }
      break;
    }
    case TAG_ID.TEMPLATE: {
      templateEndTagInHead(p, token);
      break;
    }
    case TAG_ID.COL: {
      // Ignore token
      break;
    }
    default: {
      tokenInColumnGroup(p, token);
    }
  }
}
function tokenInColumnGroup(p, token) {
  if (p.openElements.currentTagId === TAG_ID.COLGROUP) {
    p.openElements.pop();
    p.insertionMode = InsertionMode.IN_TABLE;
    p._processToken(token);
  }
}
// The "in table body" insertion mode
//------------------------------------------------------------------
function startTagInTableBody(p, token) {
  switch (token.tagID) {
    case TAG_ID.TR: {
      p.openElements.clearBackToTableBodyContext();
      p._insertElement(token, NS.HTML);
      p.insertionMode = InsertionMode.IN_ROW;
      break;
    }
    case TAG_ID.TH:
    case TAG_ID.TD: {
      p.openElements.clearBackToTableBodyContext();
      p._insertFakeElement(TAG_NAMES.TR, TAG_ID.TR);
      p.insertionMode = InsertionMode.IN_ROW;
      startTagInRow(p, token);
      break;
    }
    case TAG_ID.CAPTION:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD: {
      if (p.openElements.hasTableBodyContextInTableScope()) {
        p.openElements.clearBackToTableBodyContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE;
        startTagInTable(p, token);
      }
      break;
    }
    default: {
      startTagInTable(p, token);
    }
  }
}
function endTagInTableBody(p, token) {
  const tn = token.tagID;
  switch (token.tagID) {
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD: {
      if (p.openElements.hasInTableScope(tn)) {
        p.openElements.clearBackToTableBodyContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE;
      }
      break;
    }
    case TAG_ID.TABLE: {
      if (p.openElements.hasTableBodyContextInTableScope()) {
        p.openElements.clearBackToTableBodyContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE;
        endTagInTable(p, token);
      }
      break;
    }
    case TAG_ID.BODY:
    case TAG_ID.CAPTION:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.HTML:
    case TAG_ID.TD:
    case TAG_ID.TH:
    case TAG_ID.TR: {
      // Ignore token
      break;
    }
    default: {
      endTagInTable(p, token);
    }
  }
}
// The "in row" insertion mode
//------------------------------------------------------------------
function startTagInRow(p, token) {
  switch (token.tagID) {
    case TAG_ID.TH:
    case TAG_ID.TD: {
      p.openElements.clearBackToTableRowContext();
      p._insertElement(token, NS.HTML);
      p.insertionMode = InsertionMode.IN_CELL;
      p.activeFormattingElements.insertMarker();
      break;
    }
    case TAG_ID.CAPTION:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD:
    case TAG_ID.TR: {
      if (p.openElements.hasInTableScope(TAG_ID.TR)) {
        p.openElements.clearBackToTableRowContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE_BODY;
        startTagInTableBody(p, token);
      }
      break;
    }
    default: {
      startTagInTable(p, token);
    }
  }
}
function endTagInRow(p, token) {
  switch (token.tagID) {
    case TAG_ID.TR: {
      if (p.openElements.hasInTableScope(TAG_ID.TR)) {
        p.openElements.clearBackToTableRowContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE_BODY;
      }
      break;
    }
    case TAG_ID.TABLE: {
      if (p.openElements.hasInTableScope(TAG_ID.TR)) {
        p.openElements.clearBackToTableRowContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE_BODY;
        endTagInTableBody(p, token);
      }
      break;
    }
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD: {
      if (
        p.openElements.hasInTableScope(token.tagID) ||
        p.openElements.hasInTableScope(TAG_ID.TR)
      ) {
        p.openElements.clearBackToTableRowContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE_BODY;
        endTagInTableBody(p, token);
      }
      break;
    }
    case TAG_ID.BODY:
    case TAG_ID.CAPTION:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.HTML:
    case TAG_ID.TD:
    case TAG_ID.TH: {
      // Ignore end tag
      break;
    }
    default: {
      endTagInTable(p, token);
    }
  }
}
// The "in cell" insertion mode
//------------------------------------------------------------------
function startTagInCell(p, token) {
  const tn = token.tagID;
  if (TABLE_VOID_ELEMENTS.has(tn)) {
    if (p.openElements.hasInTableScope(TAG_ID.TD) || p.openElements.hasInTableScope(TAG_ID.TH)) {
      p._closeTableCell();
      startTagInRow(p, token);
    }
  } else {
    startTagInBody(p, token);
  }
}
function endTagInCell(p, token) {
  const tn = token.tagID;
  switch (tn) {
    case TAG_ID.TD:
    case TAG_ID.TH: {
      if (p.openElements.hasInTableScope(tn)) {
        p.openElements.generateImpliedEndTags();
        p.openElements.popUntilTagNamePopped(tn);
        p.activeFormattingElements.clearToLastMarker();
        p.insertionMode = InsertionMode.IN_ROW;
      }
      break;
    }
    case TAG_ID.TABLE:
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD:
    case TAG_ID.TR: {
      if (p.openElements.hasInTableScope(tn)) {
        p._closeTableCell();
        endTagInRow(p, token);
      }
      break;
    }
    case TAG_ID.BODY:
    case TAG_ID.CAPTION:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.HTML: {
      // Ignore token
      break;
    }
    default: {
      endTagInBody(p, token);
    }
  }
}
// The "in select" insertion mode
//------------------------------------------------------------------
function startTagInSelect(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.OPTION: {
      if (p.openElements.currentTagId === TAG_ID.OPTION) {
        p.openElements.pop();
      }
      p._insertElement(token, NS.HTML);
      break;
    }
    case TAG_ID.OPTGROUP: {
      if (p.openElements.currentTagId === TAG_ID.OPTION) {
        p.openElements.pop();
      }
      if (p.openElements.currentTagId === TAG_ID.OPTGROUP) {
        p.openElements.pop();
      }
      p._insertElement(token, NS.HTML);
      break;
    }
    case TAG_ID.HR: {
      if (p.openElements.currentTagId === TAG_ID.OPTION) {
        p.openElements.pop();
      }
      if (p.openElements.currentTagId === TAG_ID.OPTGROUP) {
        p.openElements.pop();
      }
      p._appendElement(token, NS.HTML);
      token.ackSelfClosing = true;
      break;
    }
    case TAG_ID.INPUT:
    case TAG_ID.KEYGEN:
    case TAG_ID.TEXTAREA:
    case TAG_ID.SELECT: {
      if (p.openElements.hasInSelectScope(TAG_ID.SELECT)) {
        p.openElements.popUntilTagNamePopped(TAG_ID.SELECT);
        p._resetInsertionMode();
        if (token.tagID !== TAG_ID.SELECT) {
          p._processStartTag(token);
        }
      }
      break;
    }
    case TAG_ID.SCRIPT:
    case TAG_ID.TEMPLATE: {
      startTagInHead(p, token);
      break;
    }
    // Do nothing
  }
}
function endTagInSelect(p, token) {
  switch (token.tagID) {
    case TAG_ID.OPTGROUP: {
      if (
        p.openElements.stackTop > 0 &&
        p.openElements.currentTagId === TAG_ID.OPTION &&
        p.openElements.tagIDs[p.openElements.stackTop - 1] === TAG_ID.OPTGROUP
      ) {
        p.openElements.pop();
      }
      if (p.openElements.currentTagId === TAG_ID.OPTGROUP) {
        p.openElements.pop();
      }
      break;
    }
    case TAG_ID.OPTION: {
      if (p.openElements.currentTagId === TAG_ID.OPTION) {
        p.openElements.pop();
      }
      break;
    }
    case TAG_ID.SELECT: {
      if (p.openElements.hasInSelectScope(TAG_ID.SELECT)) {
        p.openElements.popUntilTagNamePopped(TAG_ID.SELECT);
        p._resetInsertionMode();
      }
      break;
    }
    case TAG_ID.TEMPLATE: {
      templateEndTagInHead(p, token);
      break;
    }
    // Do nothing
  }
}
// The "in select in table" insertion mode
//------------------------------------------------------------------
function startTagInSelectInTable(p, token) {
  const tn = token.tagID;
  if (
    tn === TAG_ID.CAPTION ||
    tn === TAG_ID.TABLE ||
    tn === TAG_ID.TBODY ||
    tn === TAG_ID.TFOOT ||
    tn === TAG_ID.THEAD ||
    tn === TAG_ID.TR ||
    tn === TAG_ID.TD ||
    tn === TAG_ID.TH
  ) {
    p.openElements.popUntilTagNamePopped(TAG_ID.SELECT);
    p._resetInsertionMode();
    p._processStartTag(token);
  } else {
    startTagInSelect(p, token);
  }
}
function endTagInSelectInTable(p, token) {
  const tn = token.tagID;
  if (
    tn === TAG_ID.CAPTION ||
    tn === TAG_ID.TABLE ||
    tn === TAG_ID.TBODY ||
    tn === TAG_ID.TFOOT ||
    tn === TAG_ID.THEAD ||
    tn === TAG_ID.TR ||
    tn === TAG_ID.TD ||
    tn === TAG_ID.TH
  ) {
    if (p.openElements.hasInTableScope(tn)) {
      p.openElements.popUntilTagNamePopped(TAG_ID.SELECT);
      p._resetInsertionMode();
      p.onEndTag(token);
    }
  } else {
    endTagInSelect(p, token);
  }
}
// The "in template" insertion mode
//------------------------------------------------------------------
function startTagInTemplate(p, token) {
  switch (token.tagID) {
    // First, handle tags that can start without a mode change
    case TAG_ID.BASE:
    case TAG_ID.BASEFONT:
    case TAG_ID.BGSOUND:
    case TAG_ID.LINK:
    case TAG_ID.META:
    case TAG_ID.NOFRAMES:
    case TAG_ID.SCRIPT:
    case TAG_ID.STYLE:
    case TAG_ID.TEMPLATE:
    case TAG_ID.TITLE: {
      startTagInHead(p, token);
      break;
    }
    // Re-process the token in the appropriate mode
    case TAG_ID.CAPTION:
    case TAG_ID.COLGROUP:
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD: {
      p.tmplInsertionModeStack[0] = InsertionMode.IN_TABLE;
      p.insertionMode = InsertionMode.IN_TABLE;
      startTagInTable(p, token);
      break;
    }
    case TAG_ID.COL: {
      p.tmplInsertionModeStack[0] = InsertionMode.IN_COLUMN_GROUP;
      p.insertionMode = InsertionMode.IN_COLUMN_GROUP;
      startTagInColumnGroup(p, token);
      break;
    }
    case TAG_ID.TR: {
      p.tmplInsertionModeStack[0] = InsertionMode.IN_TABLE_BODY;
      p.insertionMode = InsertionMode.IN_TABLE_BODY;
      startTagInTableBody(p, token);
      break;
    }
    case TAG_ID.TD:
    case TAG_ID.TH: {
      p.tmplInsertionModeStack[0] = InsertionMode.IN_ROW;
      p.insertionMode = InsertionMode.IN_ROW;
      startTagInRow(p, token);
      break;
    }
    default: {
      p.tmplInsertionModeStack[0] = InsertionMode.IN_BODY;
      p.insertionMode = InsertionMode.IN_BODY;
      startTagInBody(p, token);
    }
  }
}
function endTagInTemplate(p, token) {
  if (token.tagID === TAG_ID.TEMPLATE) {
    templateEndTagInHead(p, token);
  }
}
function eofInTemplate(p, token) {
  if (p.openElements.tmplCount > 0) {
    p.openElements.popUntilTagNamePopped(TAG_ID.TEMPLATE);
    p.activeFormattingElements.clearToLastMarker();
    p.tmplInsertionModeStack.shift();
    p._resetInsertionMode();
    p.onEof(token);
  } else {
    stopParsing(p, token);
  }
}
// The "after body" insertion mode
//------------------------------------------------------------------
function startTagAfterBody(p, token) {
  if (token.tagID === TAG_ID.HTML) {
    startTagInBody(p, token);
  } else {
    tokenAfterBody(p, token);
  }
}
function endTagAfterBody(p, token) {
  var _a;
  if (token.tagID === TAG_ID.HTML) {
    if (!p.fragmentContext) {
      p.insertionMode = InsertionMode.AFTER_AFTER_BODY;
    }
    //NOTE: <html> is never popped from the stack, so we need to updated
    //the end location explicitly.
    if (p.options.sourceCodeLocationInfo && p.openElements.tagIDs[0] === TAG_ID.HTML) {
      p._setEndLocation(p.openElements.items[0], token);
      // Update the body element, if it doesn't have an end tag
      const bodyElement = p.openElements.items[1];
      if (
        bodyElement &&
        !((_a = p.treeAdapter.getNodeSourceCodeLocation(bodyElement)) === null || _a === void 0
          ? void 0
          : _a.endTag)
      ) {
        p._setEndLocation(bodyElement, token);
      }
    }
  } else {
    tokenAfterBody(p, token);
  }
}
function tokenAfterBody(p, token) {
  p.insertionMode = InsertionMode.IN_BODY;
  modeInBody(p, token);
}
// The "in frameset" insertion mode
//------------------------------------------------------------------
function startTagInFrameset(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.FRAMESET: {
      p._insertElement(token, NS.HTML);
      break;
    }
    case TAG_ID.FRAME: {
      p._appendElement(token, NS.HTML);
      token.ackSelfClosing = true;
      break;
    }
    case TAG_ID.NOFRAMES: {
      startTagInHead(p, token);
      break;
    }
    // Do nothing
  }
}
function endTagInFrameset(p, token) {
  if (token.tagID === TAG_ID.FRAMESET && !p.openElements.isRootHtmlElementCurrent()) {
    p.openElements.pop();
    if (!p.fragmentContext && p.openElements.currentTagId !== TAG_ID.FRAMESET) {
      p.insertionMode = InsertionMode.AFTER_FRAMESET;
    }
  }
}
// The "after frameset" insertion mode
//------------------------------------------------------------------
function startTagAfterFrameset(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.NOFRAMES: {
      startTagInHead(p, token);
      break;
    }
    // Do nothing
  }
}
function endTagAfterFrameset(p, token) {
  if (token.tagID === TAG_ID.HTML) {
    p.insertionMode = InsertionMode.AFTER_AFTER_FRAMESET;
  }
}
// The "after after body" insertion mode
//------------------------------------------------------------------
function startTagAfterAfterBody(p, token) {
  if (token.tagID === TAG_ID.HTML) {
    startTagInBody(p, token);
  } else {
    tokenAfterAfterBody(p, token);
  }
}
function tokenAfterAfterBody(p, token) {
  p.insertionMode = InsertionMode.IN_BODY;
  modeInBody(p, token);
}
// The "after after frameset" insertion mode
//------------------------------------------------------------------
function startTagAfterAfterFrameset(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.NOFRAMES: {
      startTagInHead(p, token);
      break;
    }
    // Do nothing
  }
}
// The rules for parsing tokens in foreign content
//------------------------------------------------------------------
function nullCharacterInForeignContent(p, token) {
  token.chars = REPLACEMENT_CHARACTER;
  p._insertCharacters(token);
}
function characterInForeignContent(p, token) {
  p._insertCharacters(token);
  p.framesetOk = false;
}
function popUntilHtmlOrIntegrationPoint(p) {
  while (
    p.treeAdapter.getNamespaceURI(p.openElements.current) !== NS.HTML &&
    p.openElements.currentTagId !== undefined &&
    !p._isIntegrationPoint(p.openElements.currentTagId, p.openElements.current)
  ) {
    p.openElements.pop();
  }
}
function startTagInForeignContent(p, token) {
  if (causesExit(token)) {
    popUntilHtmlOrIntegrationPoint(p);
    p._startTagOutsideForeignContent(token);
  } else {
    const current = p._getAdjustedCurrentElement();
    const currentNs = p.treeAdapter.getNamespaceURI(current);
    if (currentNs === NS.MATHML) {
      adjustTokenMathMLAttrs(token);
    } else if (currentNs === NS.SVG) {
      adjustTokenSVGTagName(token);
      adjustTokenSVGAttrs(token);
    }
    adjustTokenXMLAttrs(token);
    if (token.selfClosing) {
      p._appendElement(token, currentNs);
    } else {
      p._insertElement(token, currentNs);
    }
    token.ackSelfClosing = true;
  }
}
function endTagInForeignContent(p, token) {
  if (token.tagID === TAG_ID.P || token.tagID === TAG_ID.BR) {
    popUntilHtmlOrIntegrationPoint(p);
    p._endTagOutsideForeignContent(token);
    return;
  }
  for (let i = p.openElements.stackTop; i > 0; i--) {
    const element = p.openElements.items[i];
    if (p.treeAdapter.getNamespaceURI(element) === NS.HTML) {
      p._endTagOutsideForeignContent(token);
      break;
    }
    const tagName = p.treeAdapter.getTagName(element);
    if (tagName.toLowerCase() === token.tagName) {
      //NOTE: update the token tag name for `_setEndLocation`.
      token.tagName = tagName;
      p.openElements.shortenToLength(i);
      break;
    }
  }
}

/**
 * Creates a function that escapes all characters matched by the given regular
 * expression using the given map of characters to escape to their entities.
 *
 * @param regex Regular expression to match characters to escape.
 * @param map Map of characters to escape to their entities.
 *
 * @returns Function that escapes all characters matched by the given regular
 * expression using the given map of characters to escape to their entities.
 */
function getEscaper(regex, map) {
  return function escape(data) {
    let match;
    let lastIndex = 0;
    let result = "";
    while ((match = regex.exec(data))) {
      if (lastIndex !== match.index) {
        result += data.substring(lastIndex, match.index);
      }
      // We know that this character will be in the map.
      result += map.get(match[0].charCodeAt(0));
      // Every match will be of length 1
      lastIndex = match.index + 1;
    }
    return result + data.substring(lastIndex);
  };
}
/**
 * Encodes all characters that have to be escaped in HTML attributes,
 * following {@link https://html.spec.whatwg.org/multipage/parsing.html#escapingString}.
 *
 * @param data String to escape.
 */
const escapeAttribute = /* #__PURE__ */ getEscaper(
  /["&\u00A0]/g,
  new Map([
    [34, "&quot;"],
    [38, "&amp;"],
    [160, "&nbsp;"]
  ])
);
/**
 * Encodes all characters that have to be escaped in HTML text,
 * following {@link https://html.spec.whatwg.org/multipage/parsing.html#escapingString}.
 *
 * @param data String to escape.
 */
const escapeText = /* #__PURE__ */ getEscaper(
  /[&<>\u00A0]/g,
  new Map([
    [38, "&amp;"],
    [60, "&lt;"],
    [62, "&gt;"],
    [160, "&nbsp;"]
  ])
);

// Sets
const VOID_ELEMENTS = new Set([
  TAG_NAMES.AREA,
  TAG_NAMES.BASE,
  TAG_NAMES.BASEFONT,
  TAG_NAMES.BGSOUND,
  TAG_NAMES.BR,
  TAG_NAMES.COL,
  TAG_NAMES.EMBED,
  TAG_NAMES.FRAME,
  TAG_NAMES.HR,
  TAG_NAMES.IMG,
  TAG_NAMES.INPUT,
  TAG_NAMES.KEYGEN,
  TAG_NAMES.LINK,
  TAG_NAMES.META,
  TAG_NAMES.PARAM,
  TAG_NAMES.SOURCE,
  TAG_NAMES.TRACK,
  TAG_NAMES.WBR
]);
function isVoidElement(node, options) {
  return (
    options.treeAdapter.isElementNode(node) &&
    options.treeAdapter.getNamespaceURI(node) === NS.HTML &&
    VOID_ELEMENTS.has(options.treeAdapter.getTagName(node))
  );
}
const defaultOpts = { treeAdapter: defaultTreeAdapter, scriptingEnabled: true };
/**
 * Serializes an AST node to an HTML string.
 *
 * @example
 *
 * ```js
 * const parse5 = require('parse5');
 *
 * const document = parse5.parse('<!DOCTYPE html><html><head></head><body>Hi there!</body></html>');
 *
 * // Serializes a document.
 * const html = parse5.serialize(document);
 *
 * // Serializes the <html> element content.
 * const str = parse5.serialize(document.childNodes[1]);
 *
 * console.log(str); //> '<head></head><body>Hi there!</body>'
 * ```
 *
 * @param node Node to serialize.
 * @param options Serialization options.
 */
function serialize(node, options) {
  const opts = { ...defaultOpts, ...options };
  if (isVoidElement(node, opts)) {
    return "";
  }
  return serializeChildNodes(node, opts);
}
function serializeChildNodes(parentNode, options) {
  let html = "";
  // Get container of the child nodes
  const container =
    options.treeAdapter.isElementNode(parentNode) &&
    options.treeAdapter.getTagName(parentNode) === TAG_NAMES.TEMPLATE &&
    options.treeAdapter.getNamespaceURI(parentNode) === NS.HTML
      ? options.treeAdapter.getTemplateContent(parentNode)
      : parentNode;
  const childNodes = options.treeAdapter.getChildNodes(container);
  if (childNodes) {
    for (const currentNode of childNodes) {
      html += serializeNode(currentNode, options);
    }
  }
  return html;
}
function serializeNode(node, options) {
  if (options.treeAdapter.isElementNode(node)) {
    return serializeElement(node, options);
  }
  if (options.treeAdapter.isTextNode(node)) {
    return serializeTextNode(node, options);
  }
  if (options.treeAdapter.isCommentNode(node)) {
    return serializeCommentNode(node, options);
  }
  if (options.treeAdapter.isDocumentTypeNode(node)) {
    return serializeDocumentTypeNode(node, options);
  }
  // Return an empty string for unknown nodes
  return "";
}
function serializeElement(node, options) {
  const tn = options.treeAdapter.getTagName(node);
  return `<${tn}${serializeAttributes(node, options)}>${isVoidElement(node, options) ? "" : `${serializeChildNodes(node, options)}</${tn}>`}`;
}
function serializeAttributes(node, { treeAdapter }) {
  let html = "";
  for (const attr of treeAdapter.getAttrList(node)) {
    html += " ";
    if (attr.namespace) {
      switch (attr.namespace) {
        case NS.XML: {
          html += `xml:${attr.name}`;
          break;
        }
        case NS.XMLNS: {
          if (attr.name !== "xmlns") {
            html += "xmlns:";
          }
          html += attr.name;
          break;
        }
        case NS.XLINK: {
          html += `xlink:${attr.name}`;
          break;
        }
        default: {
          html += `${attr.prefix}:${attr.name}`;
        }
      }
    } else {
      html += attr.name;
    }
    html += `="${escapeAttribute(attr.value)}"`;
  }
  return html;
}
function serializeTextNode(node, options) {
  const { treeAdapter } = options;
  const content = treeAdapter.getTextNodeContent(node);
  const parent = treeAdapter.getParentNode(node);
  const parentTn = parent && treeAdapter.isElementNode(parent) && treeAdapter.getTagName(parent);
  return parentTn &&
    treeAdapter.getNamespaceURI(parent) === NS.HTML &&
    hasUnescapedText(parentTn, options.scriptingEnabled)
    ? content
    : escapeText(content);
}
function serializeCommentNode(node, { treeAdapter }) {
  return `<!--${treeAdapter.getCommentNodeContent(node)}-->`;
}
function serializeDocumentTypeNode(node, { treeAdapter }) {
  return `<!DOCTYPE ${treeAdapter.getDocumentTypeNodeName(node)}>`;
}

// Shorthands
/**
 * Parses an HTML string.
 *
 * @param html Input HTML string.
 * @param options Parsing options.
 * @returns Document
 *
 * @example
 *
 * ```js
 * const parse5 = require('parse5');
 *
 * const document = parse5.parse('<!DOCTYPE html><html><head></head><body>Hi there!</body></html>');
 *
 * console.log(document.childNodes[1].tagName); //> 'html'
 *```
 */
function parse(html, options) {
  return Parser.parse(html, options);
}
function parseFragment(fragmentContext, html, options) {
  if (typeof fragmentContext === "string") {
    options = html;
    html = fragmentContext;
    fragmentContext = null;
  }
  const parser = Parser.getFragmentParser(fragmentContext, options);
  parser.tokenizer.write(html, true);
  return parser.getFragment();
}

/** `bodyElement` will be used as a `context` (The place where we run `innerHTML`) */
const bodyElement = parse(`<!DOCTYPE html><html><head></head><body></body></html>`).childNodes[1]
  .childNodes[1];

function innerHTML(htmlFragment) {
  /** `htmlFragment` will be parsed as if it was set to the `bodyElement`'s `innerHTML` property. */
  const parsedFragment = parseFragment(bodyElement, htmlFragment, {});

  /** `serialize` returns back a string from the parsed nodes */
  return serialize(parsedFragment);
}

/**
 * Returns an object with information when the markup is invalid
 *
 * @param {string} html - The html string to validate
 * @returns {{
 *   html: string; // html stripped of attributives and content
 *   browser: string; // what the browser returned from evaluating `html`
 * } | null}
 */
function isInvalidMarkup(html) {
  html = html

    // normalize dom-expressions comments, so comments location are also validated
    .replaceAll("<!>", "<!---->")
    .replaceAll("<!$>", "<!--$-->")
    .replaceAll("<!/>", "<!--/-->")

    // replace text nodes
    // text nodes are problematic, think "doesn't" vs "doesn&#39;t"
    // we can detect if text nodes were moved by the browser when the `#text` moves

    // replace text nodes that isnt in between tags by `#text`
    .replace(/^[^<]+/, "#text")
    .replace(/[^>]+$/, "#text")
    // replace text nodes in between tags by `#text`
    .replace(/>[^<]+</gi, ">#text<")

    // remove attributes (the lack of quotes will make it mismatch)
    // attributes are not longer added to `templateWithClosingTags`
    // https://github.com/solidjs/solid/issues/2338
    // .replace(/<([a-z0-9-:]+)\s+[^>]+>/gi, "<$1>")

    // fix escaping, so doesnt mess up the validation
    // `&lt;script>a();&lt;/script>` -> `&lt;script&gt;a();&lt;/script&gt;`
    .replace(/&lt;([^>]+)>/gi, "&lt;$1&gt;");

  // edge cases (safe to assume they will use the partial in the right place)

  // table cells
  if (/^<(td|th)>/.test(html)) {
    html = `<table><tbody><tr>${html}</tr></tbody></table>`;
  }

  // table rows
  if (/^<tr>/.test(html)) {
    html = `<table><tbody>${html}</tbody></table>`;
  }

  // table misc
  if (/^<col>/.test(html)) {
    html = `<table><colgroup>${html}</colgroup></table>`;
  }

  // table components
  if (/^<(thead|tbody|tfoot|colgroup|caption)>/.test(html)) {
    html = `<table>${html}</table>`;
  }

  // skip when equal to:
  switch (html) {
    // empty table components
    case "<table></table>":
    case "<table><thead></thead></table>":
    case "<table><tbody></tbody></table>":
    case "<table><thead></thead><tbody></tbody></table>": {
      return;
    }
  }

  /** Parse HTML. `browser` is a string with the supposed resulting html of a real `innerHTML` call */
  const browser = innerHTML(html);

  if (html.toLowerCase() !== browser.toLowerCase()) {
    return {
      html,
      browser
    };
  }
}

// add to the top/bottom of the module.
var postprocess = (path, state) => {
  if (state.skip) return;

  const data = path.scope.data;
  const config = path.hub.file.metadata.config;
  if (!config) return;

  if (data.events) {
    path.node.body.push(
      t__namespace.expressionStatement(
        t__namespace.callExpression(
          registerImportMethod(path, "delegateEvents", getRendererConfig(path, "dom").moduleName),
          [
            t__namespace.arrayExpression(
              Array.from(data.events).map(e => t__namespace.stringLiteral(e))
            )
          ]
        )
      )
    );
  }
  if (data.templates?.length) {
    if (config.validate) {
      for (const template of data.templates) {
        const html = template.templateWithClosingTags;
        // not sure when/why this is not a string
        if (typeof html === "string") {
          const result = isInvalidMarkup(html);
          if (result) {
            const message =
              "\nThe HTML provided is malformed and will yield unexpected output when evaluated by a browser.\n";
            console.warn(message);
            console.warn("User HTML:\n", result.html);
            console.warn("Browser HTML:\n", result.browser);
            console.warn("Original HTML:\n", html);
            // throw path.buildCodeFrameError();
          }
        }
      }
    }
    let domTemplates = data.templates.filter(temp => temp.renderer === "dom");
    let ssrTemplates = data.templates.filter(temp => temp.renderer === "ssr");
    domTemplates.length > 0 && appendTemplates$1(path, domTemplates);
    ssrTemplates.length > 0 && appendTemplates(path, ssrTemplates);
  }

  // Compile-time row proofs (DESIGN-PATCH-CHANNEL §3c): wrap each function
  // recorded by recordPureRow with the runtime's `rowProof` marker so the
  // patch-mode list driver can engage on proven-pure rows — admission is
  // decided here, statically; there is no runtime purity probe. The stamp
  // travels with the function object, so extracted row functions qualify at
  // their definition site.
  if (data.pureRows?.size) {
    const rowProofId = registerImportMethod(
      path,
      "rowProof",
      getRendererConfig(path, "dom").moduleName
    );
    const pureRows = data.pureRows;
    path.traverse({
      "ArrowFunctionExpression|FunctionExpression"(fnPath) {
        if (!pureRows.has(fnPath.node)) return;
        pureRows.delete(fnPath.node);
        fnPath.replaceWith(
          t__namespace.callExpression(t__namespace.cloneNode(rowProofId), [fnPath.node])
        );
        fnPath.skip();
      }
    });
  }
};

const config = {
  moduleName: "@solidjs/web",
  generate: "dom",
  hydratable: false,
  dev: false,
  delegateEvents: true,
  delegatedEvents: [],
  builtIns: [
    "For",
    "Show",
    "Switch",
    "Match",
    "Loading",
    "Reveal",
    "Portal",
    "Repeat",
    "Dynamic",
    "Errored"
  ],

  requireImportSource: false,
  wrapConditionals: true,
  omitNestedClosingTags: false,
  omitLastClosingTag: true,
  omitQuotes: true,
  omitAttributeSpacing: true,
  contextToCustomElements: true,
  staticMarker: "@static",
  effectWrapper: "effect",
  patchDriver: false,
  memoWrapper: "memo",
  validate: true,
  inlineStyles: true,
  serverComponents: false
};

var preprocess = (path, state) => {
  const file = path.hub.file;
  const merged = (file.metadata.config = Object.assign({}, config, state.opts));
  const lib = merged.requireImportSource;
  if (lib) {
    const comments = file.ast.comments ?? [];
    let process = false;
    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];
      const pieces = comment.value.split("@jsxImportSource");
      if (pieces.length === 2 && pieces[1].trim() === lib) {
        process = true;
        break;
      }
    }
    if (!process) {
      state.skip = true;
      return;
    }
  }
};

var index = () => {
  return {
    name: "JSX DOM Expressions",
    inherits: SyntaxJSX.default,
    visitor: {
      JSXElement: transformJSX,
      JSXFragment: transformJSX,
      Program: {
        enter: preprocess,
        exit: postprocess
      }
    }
  };
};

module.exports = index;
