import * as t from "@babel/types";
import config from "../config";
import { transformElement as transformElementDOM } from "../dom/element";
import { createTemplate as createTemplateDOM } from "../dom/template";
import { transformElement as transformElementSSR } from "../ssr/element";
import { createTemplate as createTemplateSSR } from "../ssr/template";
import {
  getTagName,
  isComponent,
  isDynamic,
  trimWhitespace,
  transformCondition,
  isStaticExpressionContainer
} from "./utils";
import transformComponent from "./component";
import transformFragmentChildren from "./fragment";

export function transformJSX(path, { opts }) {
  Object.assign(config, opts);
  const replace = transformThis(path);
  const result = transformNode(
    path,
    t.isJSXFragment(path.node)
      ? {}
      : {
          topLevel: true
        }
  );
  const template = config.generate === "ssr" ? createTemplateSSR : createTemplateDOM;
  path.replaceWith(replace(template(path, result, false)));
}

export function transformThis(path) {
  let thisId;
  path.traverse({
    ThisExpression(path) {
      thisId || (thisId = path.scope.generateUidIdentifier("self$"));
      path.replaceWith(thisId);
    }
  });
  return node => {
    if (thisId) {
      let parent = path.getStatementParent();
      const decl = t.variableDeclaration("const", [
        t.variableDeclarator(thisId, t.thisExpression())
      ]);
      parent.insertBefore(decl);
    }
    return node;
  };
}

export function transformNode(path, info = {}) {
  const node = path.node;
  if (t.isJSXElement(node)) {
    let tagName = getTagName(node);
    if (isComponent(tagName)) return transformComponent(path);
    const element = config.generate === "ssr" ? transformElementSSR : transformElementDOM;
    return element(path, info);
  } else if (t.isJSXFragment(node)) {
    let results = { template: "", decl: [], exprs: [], dynamics: [] };
    transformFragmentChildren(path.get("children"), results);
    return results;
  } else if (t.isJSXText(node) || isStaticExpressionContainer(path)) {
    const text = trimWhitespace(
      t.isJSXExpressionContainer(node)
        ? t.isTemplateLiteral(node.expression)
          ? node.expression.quasis[0].value.raw
          : node.expression.value.toString()
        : node.extra.raw
    );
    if (!text.length) return null;
    const results = {
      template: text,
      decl: [],
      exprs: [],
      dynamics: [],
      postExprs: [],
      text: true
    };
    if (!info.skipId && config.generate !== "ssr")
      results.id = path.scope.generateUidIdentifier("el$");
    return results;
  } else if (t.isJSXExpressionContainer(node)) {
    if (t.isJSXEmptyExpression(node.expression)) return null;
    if (
      !isDynamic(path.get("expression"), {
        checkMember: true,
        checkTags: !!info.componentChild,
        native: !info.componentChild
      })
    ) {
      return { exprs: [node.expression], template: "" };
    }
    const expr =
      config.wrapConditionals &&
      (config.generate !== "ssr" || config.async) &&
      (t.isLogicalExpression(node.expression) || t.isConditionalExpression(node.expression))
        ? transformCondition(path.get("expression"))
        : !info.componentChild &&
          (config.generate !== "ssr" || info.fragmentChild) &&
          t.isCallExpression(node.expression) &&
          !t.isMemberExpression(node.expression.callee) &&
          node.expression.arguments.length === 0
        ? node.expression.callee
        : t.arrowFunctionExpression([], node.expression);
    return {
      exprs:
        expr.length > 1
          ? [
              t.callExpression(
                t.arrowFunctionExpression(
                  [],
                  t.blockStatement([expr[0], t.returnStatement(expr[1])])
                ),
                []
              )
            ]
          : [expr],
      template: "",
      dynamic: true
    };
  } else if (t.isJSXSpreadChild(node)) {
    if (
      !isDynamic(path.get("expression"), {
        checkMember: true,
        native: !info.componentChild
      })
    )
      return { exprs: [node.expression], template: "" };
    const expr = t.arrowFunctionExpression([], node.expression);
    return {
      exprs: [expr],
      template: "",
      dynamic: true
    };
  }
}
