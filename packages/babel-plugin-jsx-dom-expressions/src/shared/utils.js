import * as t from "@babel/types";
import { addNamed } from "@babel/helper-module-imports";
import config from "../config";

export const reservedNameSpaces = new Set(["class", "on", "style", "use", "prop", "attr"]);

export function registerImportMethod(path, name) {
  const imports =
    path.scope.getProgramParent().data.imports ||
    (path.scope.getProgramParent().data.imports = new Set());
  if (!imports.has(name)) {
    addNamed(path, name, config.moduleName, {
      nameHint: `_$${name}`
    });
    imports.add(name);
  }
}

function jsxElementNameToString(node) {
  if (t.isJSXMemberExpression(node)) {
    return `${jsxElementNameToString(node.object)}.${node.property.name}`;
  }
  if (t.isJSXIdentifier(node)) {
    return node.name;
  }
  return `${node.namespace.name}:${node.name.name}`;
}

export function tagNameToIdentifier(name) {
  const parts = name.split(".");
  if (parts.length === 1) return t.identifier(name);
  let part;
  let base = t.identifier(parts.shift());
  while ((part = parts.shift())) {
    base = t.memberExpression(base, t.identifier(part));
  }
  return base;
}

export function getTagName(tag) {
  const jsxName = tag.openingElement.name;
  return jsxElementNameToString(jsxName);
}

export function isComponent(tagName) {
  return (
    (tagName[0] && tagName[0].toLowerCase() !== tagName[0]) ||
    tagName.includes(".") ||
    /[^a-zA-Z]/.test(tagName[0])
  );
}

export function isDynamic(path, { checkMember, checkTags, checkCallExpressions = true, native }) {
  if (config.generate === "ssr" && !config.async && native) {
    checkMember = false;
    checkCallExpressions = false;
  }
  const expr = path.node;
  if (t.isFunction(expr)) return false;
  if (
    expr.leadingComments &&
    expr.leadingComments[0] &&
    expr.leadingComments[0].value.trim() === config.staticMarker
  ) {
    expr.leadingComments.shift();
    return false;
  }
  if (
    (checkCallExpressions && t.isCallExpression(expr)) ||
    (checkMember && t.isMemberExpression(expr)) ||
    (checkTags && (t.isJSXElement(expr) || t.isJSXFragment(expr)))
  )
    return true;

  let dynamic;
  path.traverse({
    Function(p) {
      p.skip();
    },
    CallExpression(p) {
      checkCallExpressions && (dynamic = true) && p.stop();
    },
    MemberExpression(p) {
      checkMember && (dynamic = true) && p.stop();
    },
    JSXElement(p) {
      checkTags ? (dynamic = true) && p.stop() : p.skip();
    },
    JSXFragment(p) {
      checkTags ? (dynamic = true) && p.stop() : p.skip();
    }
  });
  return dynamic;
}

export function isStaticExpressionContainer(path) {
  const node = path.node;
  return (
    t.isJSXExpressionContainer(node) &&
    t.isJSXElement(path.parent) &&
    !isComponent(getTagName(path.parent)) &&
    (t.isStringLiteral(node.expression) ||
      t.isNumericLiteral(node.expression) ||
      (t.isTemplateLiteral(node.expression) && node.expression.expressions.length === 0))
  );
}

// remove unnecessary JSX Text nodes
export function filterChildren(children, loose) {
  return children.filter(
    ({ node: child }) =>
      !(t.isJSXExpressionContainer(child) && t.isJSXEmptyExpression(child.expression)) &&
      (!t.isJSXText(child) ||
        (loose ? !/^[\r\n]\s*$/.test(child.extra.raw) : !/^\s*$/.test(child.extra.raw)))
  );
}

export function checkLength(children) {
  let i = 0;
  children.forEach(path => {
    const child = path.node;
    !(t.isJSXExpressionContainer(child) && t.isJSXEmptyExpression(child.expression)) &&
      (!t.isJSXText(child) || !/^\s*$/.test(child.extra.raw)) &&
      i++;
  });
  return i > 1;
}

export function trimWhitespace(text) {
  text = text.replace(/\r/g, "");
  if (/\n/g.test(text)) {
    text = text
      .split("\n")
      .map((t, i) => (i ? t.replace(/^\s*/g, "") : t))
      .filter(s => !/^\s*$/.test(s))
      .join(" ");
  }
  return text.replace(/\s+/g, " ");
}

export function toEventName(name) {
  return name.slice(2).toLowerCase();
}

export function toAttributeName(name) {
  return name.replace(/([A-Z])/g, g => `-${g[0].toLowerCase()}`);
}

export function toPropertyName(name) {
  return name.toLowerCase().replace(/-([a-z])/g, (_, w) => w.toUpperCase());
}

export function transformCondition(path, deep) {
  const expr = path.node;
  registerImportMethod(path, "memo");
  let dTest, cond, id;
  if (
    t.isConditionalExpression(expr) &&
    (isDynamic(path.get("consequent"), {
      checkTags: true
    }) ||
      isDynamic(path.get("alternate"), { checkTags: true }))
  ) {
    dTest = isDynamic(path.get("test"), { checkMember: true });
    if (dTest) {
      cond = expr.test;
      id = path.scope.generateUidIdentifier("_c$");
      if (!t.isBinaryExpression(cond))
        cond = t.unaryExpression("!", t.unaryExpression("!", cond, true), true);
      expr.test = t.callExpression(id, []);
      if (t.isConditionalExpression(expr.consequent) || t.isLogicalExpression(expr.consequent)) {
        expr.consequent = transformCondition(path.get("consequent"), true);
      }
      if (t.isConditionalExpression(expr.alternate) || t.isLogicalExpression(expr.alternate)) {
        expr.alternate = transformCondition(path.get("alternate"), true);
      }
    }
  } else if (t.isLogicalExpression(expr)) {
    let nextPath = path;
    // handle top-level or, ie cond && <A/> || <B/>
    if (expr.operator === "||" && t.isLogicalExpression(expr.left)) {
      nextPath = nextPath.get("left");
    }
    isDynamic(nextPath.get("right"), { checkTags: true }) &&
      (dTest = isDynamic(nextPath.get("left"), {
        checkMember: true
      }));
    if (dTest) {
      cond = nextPath.node.left;
      id = path.scope.generateUidIdentifier("_c$");
      if (expr.operator !== "||" && !t.isBinaryExpression(cond))
        cond = t.unaryExpression("!", t.unaryExpression("!", cond, true), true);
      nextPath.node.left = t.callExpression(id, []);
    }
  }
  if (dTest) {
    const statements = [
      t.variableDeclaration("const", [
        t.variableDeclarator(
          id,
          t.callExpression(t.identifier("_$memo"), [
            t.arrowFunctionExpression([], cond),
            t.booleanLiteral(true)
          ])
        )
      ]),
      t.arrowFunctionExpression([], expr)
    ];
    return deep
      ? t.callExpression(
          t.arrowFunctionExpression(
            [],
            t.blockStatement([statements[0], t.returnStatement(statements[1])])
          ),
          []
        )
      : statements;
  }
  return deep ? expr : t.arrowFunctionExpression([], expr);
}

export function escapeHTML(s, attr) {
  if (typeof s !== "string") return s;
  const delim = attr ? '"' : "<";
  const escDelim = attr ? "&quot;" : "&lt;";
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
