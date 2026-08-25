import * as t from "@babel/types";
import { transformElement as transformElementDOM } from "../dom/element";
import { createTemplate as createTemplateDOM } from "../dom/template";
import { transformElement as transformElementSSR } from "../ssr/element";
import { createTemplate as createTemplateSSR } from "../ssr/template";
import { transformElement as transformElementUniversal } from "../universal/element";
import { createTemplate as createTemplateUniversal } from "../universal/template";
import {
  getTagName,
  isComponent,
  isDynamic,
  trimWhitespace,
  transformCondition,
  getStaticExpression,
  escapeHTML,
  getConfig,
  transformSpecialCaseAttributes,
  renameElementKey
} from "./utils";
import { DOMWithState } from "../../../web/src/constants.js";
import transformComponent from "./component";
import transformFragmentChildren from "./fragment";
import type { NodePath } from "@babel/traverse";
import type { JSXDOMExpressionsConfig, RendererConfig } from "../config";
import type {
  BabelPath,
  JSXDOMExpressionsPass,
  JSXNode,
  TransformInfo,
  TransformNodeResult,
  TransformResult
} from "../types";

type FunctionParentScope = ReturnType<NodePath["scope"]["getFunctionParent"]>;
type TransformConditionStatements = [t.VariableDeclaration, t.ArrowFunctionExpression];

function isTransformConditionStatements(
  expr: t.Expression | TransformConditionStatements
): expr is TransformConditionStatements {
  return Array.isArray(expr);
}

export function transformJSX(
  path: NodePath<t.JSXElement | t.JSXFragment>,
  state: JSXDOMExpressionsPass
) {
  if (state.skip) return;

  const config = getConfig(path);

  const replace = transformThis(path);

  // Pre-pass: normalize stateful DOM attributes (value/defaultValue/checked/etc)
  // BEFORE transformNode runs so the parent's detectExpressions sees the
  // resulting `prop:*` attributes and reserves an element id when needed.
  // Decide per-element which renderer it will go to (mirrors transformElement),
  // so dynamic mode (generate: "dynamic" + renderers: [{ name: "dom", ... }])
  // is handled correctly.
  const visit = (p: NodePath<t.JSXElement>) => {
    const tagName = getTagName(p.node);
    if (isComponent(tagName)) return;
    if (!DOMWithState[tagName.toUpperCase()]) return;
    const tagRenderer = (config.renderers ?? []).find(r => r.elements.includes(tagName));
    const willBeDOM = tagRenderer?.name === "dom" || config.generate === "dom";
    const willBeSSR = !willBeDOM && config.generate === "ssr";
    if (!willBeDOM && !willBeSSR) return;
    transformSpecialCaseAttributes(p, tagName, willBeSSR);
  };
  if (t.isJSXElement(path.node)) visit(path as NodePath<t.JSXElement>);
  path.traverse({ JSXElement: visit });

  const result = transformNode(
    path,
    t.isJSXFragment(path.node)
      ? {}
      : {
          topLevel: true,
          lastElement: true
        }
  );

  if (!result) return;
  const template = getCreateTemplate(config, path, result as TransformResult);

  path.replaceWith(replace(template(path, result as TransformResult, false) as t.Expression));

  path.traverse({
    enter(path: NodePath) {
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

function getTargetFunctionParent(path: NodePath, parent: FunctionParentScope): FunctionParentScope {
  let current = path.scope.getFunctionParent();
  if (!current) return current;
  while (current !== parent && current.path.isArrowFunctionExpression()) {
    current = current.path.parentPath.scope.getFunctionParent();
    if (!current) return current;
  }
  return current;
}

export function transformThis(path: NodePath): (node: t.Expression) => t.Expression {
  const parent = path.scope.getFunctionParent();
  let thisId: t.Identifier | undefined, inserted: boolean | undefined;
  path.traverse({
    ThisExpression(path: NodePath<t.ThisExpression>) {
      const current = getTargetFunctionParent(path, parent);
      if (current === parent) {
        thisId || (thisId = path.scope.generateUidIdentifier("self$"));
        path.replaceWith(thisId);
      }
    },
    JSXElement(path: NodePath<t.JSXElement>) {
      let source = path.get("openingElement").get("name");
      while (source.isJSXMemberExpression()) {
        source = source.get("object");
      }
      if (source.isJSXIdentifier() && source.node.name === "this") {
        const current = getTargetFunctionParent(path, parent);
        if (current === parent) {
          thisId || (thisId = path.scope.generateUidIdentifier("self$"));
          source.replaceWith(t.jsxIdentifier(thisId!.name));

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
        t.variableDeclaration("const", [t.variableDeclarator(thisId, t.thisExpression())])
      );
    inserted = true;
  }
  return (node: t.Expression) => {
    if (thisId && !inserted) {
      if (!parent || parent.block.type === "ClassMethod") {
        const decl = t.variableDeclaration("const", [
          t.variableDeclarator(thisId, t.thisExpression())
        ]);
        if (parent) {
          const stmt = path.getStatementParent();
          stmt?.insertBefore(decl);
        } else {
          return t.callExpression(
            t.arrowFunctionExpression([], t.blockStatement([decl, t.returnStatement(node)])),
            []
          );
        }
      } else {
        parent.push({
          id: thisId,
          init: t.thisExpression(),
          kind: "const"
        });
      }
    }
    return node;
  };
}

export function transformNode(
  path: BabelPath<JSXNode>,
  info: TransformInfo = {}
): TransformNodeResult {
  const config = getConfig(path);
  const node = path.node;
  let staticValue: string | number | false | undefined;
  if (t.isJSXElement(node)) {
    return transformElement(config, path as BabelPath<t.JSXElement>, info);
  } else if (t.isJSXFragment(node)) {
    let results: TransformResult = { template: "", declarations: [], exprs: [], dynamics: [] };
    // <><div /><Component /></>
    transformFragmentChildren(path.get("children"), results, config);
    return results;
  } else if (
    t.isJSXText(node) ||
    (staticValue = getStaticExpression(path as BabelPath<t.JSXExpressionContainer>)) !== false
  ) {
    const text: string =
      staticValue !== undefined
        ? info.doNotEscape
          ? String(staticValue)
          : (escapeHTML(String(staticValue)) as string)
        : trimWhitespace((node.extra?.raw as string | undefined) ?? "");
    if (!(text as string).length) return null;
    const results: TransformResult = {
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
  } else if (t.isJSXExpressionContainer(node)) {
    if (t.isJSXEmptyExpression(node.expression)) return null;
    if (
      !isDynamic(path.get("expression"), {
        checkMember: true,
        checkTags: !!info.componentChild,
        native: !info.componentChild
      })
    ) {
      return { exprs: [node.expression], template: "", declarations: [], dynamics: [] };
    }
    const expr: t.Expression | TransformConditionStatements =
      config.wrapConditionals &&
      (t.isLogicalExpression(node.expression) || t.isConditionalExpression(node.expression))
        ? transformCondition(path.get("expression"), info.componentChild || info.fragmentChild)
        : !info.componentChild &&
            (config.generate !== "ssr" || info.fragmentChild) &&
            t.isCallExpression(node.expression) &&
            !t.isCallExpression(node.expression.callee) &&
            !t.isMemberExpression(node.expression.callee) &&
            node.expression.arguments.length === 0
          ? (node.expression.callee as t.Expression)
          : t.arrowFunctionExpression([], node.expression);
    return {
      exprs: isTransformConditionStatements(expr)
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
      declarations: [],
      dynamics: [],
      dynamic: true
    };
  } else if (t.isJSXSpreadChild(node)) {
    if (
      !isDynamic(path.get("expression"), {
        checkMember: true,
        native: !info.componentChild
      })
    )
      return { exprs: [node.expression], template: "", declarations: [], dynamics: [] };
    const expr = t.arrowFunctionExpression([], node.expression);
    return {
      exprs: [expr],
      template: "",
      declarations: [],
      dynamics: [],
      dynamic: true
    };
  }
}

export function getCreateTemplate(
  config: JSXDOMExpressionsConfig,
  path: NodePath,
  result: TransformResult
) {
  if ((result.tagName && result.renderer === "dom") || config.generate === "dom") {
    return createTemplateDOM;
  }

  if (result.renderer === "ssr" || config.generate === "ssr") {
    return createTemplateSSR;
  }

  return createTemplateUniversal;
}

export function transformElement(
  config: JSXDOMExpressionsConfig,
  path: BabelPath<t.JSXElement>,
  info: TransformInfo = {}
): TransformResult {
  const node = path.node;
  let tagName = getTagName(node);
  // <Component ...></Component>
  if (isComponent(tagName)) return transformComponent(path);

  // <div ...></div>
  // const element = getTransformElemet(config, path, tagName);

  const tagRenderer = (config.renderers ?? []).find((renderer: RendererConfig) =>
    renderer.elements.includes(tagName)
  );

  if (tagRenderer?.name === "dom" || getConfig(path).generate === "dom") {
    renameElementKey(path, false);
    return transformElementDOM(path, info);
  }

  if (getConfig(path).generate === "ssr") {
    renameElementKey(path, true);
    return transformElementSSR(path, info);
  }

  return transformElementUniversal(path, info);
}
