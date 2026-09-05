import * as t from "@babel/types";
import {
  evaluateAndInline,
  getTagName,
  isDynamic,
  registerImportMethod,
  filterChildren,
  checkLength,
  getConfig,
  getRendererConfig,
  convertJSXIdentifier,
  canNativeSpread,
  transformCondition,
  escapeStringForTemplate,
  transformRefArrayLiteral
} from "../shared/utils";
import { transformNode } from "../shared/transform";
import type { BabelPath, TransformInfo, TransformResult, UniversalTransformResult } from "../types";

type JSXAttributePath = BabelPath<t.JSXAttribute | t.JSXSpreadAttribute>;

export function transformElement(
  path: BabelPath<t.JSXElement>,
  info: TransformInfo = {}
): UniversalTransformResult {
  path
    .get("openingElement")
    .get("attributes")
    .forEach((attr: JSXAttributePath) => {
      if (t.isJSXAttribute(attr.node)) evaluateAndInline(attr.node.value, attr.get("value"));
    });

  let tagName = getTagName(path.node),
    results: UniversalTransformResult = {
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
  const createElementArgs: t.Expression[] = [t.stringLiteral(tagName)];
  if (initProps.length) createElementArgs.push(t.objectExpression(initProps));
  results.declarations.push(
    t.variableDeclarator(
      results.id,
      t.callExpression(
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

function transformAttributes(
  path: BabelPath<t.JSXElement>,
  results: UniversalTransformResult
): t.ObjectProperty[] {
  let children: t.JSXExpressionContainer | undefined, spreadExpr: t.ExpressionStatement | undefined;
  let attributes = path.get("openingElement").get("attributes") as JSXAttributePath[];
  const initProps: t.ObjectProperty[] = [];
  const elem = results.id,
    hasChildren = path.node.children.length > 0,
    config = getConfig(path),
    hasSpread = attributes.some(attribute => t.isJSXSpreadAttribute(attribute.node));

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
      if (t.isJSXSpreadAttribute(node)) return;

      let value = node.value,
        key = t.isJSXNamespacedName(node.name)
          ? `${node.name.namespace.name}:${node.name.name.name}`
          : node.name.name;
      if (t.isJSXExpressionContainer(value)) {
        if (key === "ref") {
          // Normalize expressions for non-null and type-as
          while (
            t.isTSNonNullExpression(value.expression) ||
            t.isTSAsExpression(value.expression)
          ) {
            value.expression = value.expression.expression;
          }
          let binding,
            isConstant =
              t.isIdentifier(value.expression) &&
              (binding = path.scope.getBinding(value.expression.name)) &&
              (binding.kind === "const" || binding.kind === "module");
          if (!isConstant && t.isLVal(value.expression)) {
            const refIdentifier = path.scope.generateUidIdentifier("_ref$");
            results.exprs.unshift(
              t.variableDeclaration("var", [
                t.variableDeclarator(refIdentifier, value.expression as t.Expression)
              ]),
              t.expressionStatement(
                t.conditionalExpression(
                  t.logicalExpression(
                    "||",
                    t.binaryExpression(
                      "===",
                      t.unaryExpression("typeof", refIdentifier),
                      t.stringLiteral("function")
                    ),
                    t.callExpression(
                      t.memberExpression(t.identifier("Array"), t.identifier("isArray")),
                      [refIdentifier]
                    )
                  ),
                  t.callExpression(
                    registerImportMethod(
                      path,
                      "ref",
                      getRendererConfig(path, "universal").moduleName
                    ),
                    [t.arrowFunctionExpression([], refIdentifier), elem]
                  ),
                  t.assignmentExpression("=", value.expression, elem)
                )
              )
            );
          } else if (
            isConstant ||
            t.isFunction(value.expression) ||
            t.isArrayExpression(value.expression)
          ) {
            if (t.isArrayExpression(value.expression)) {
              // Bare lval elements (e.g. `ref={[elRef]}`) become callback refs
              // so the variable actually gets assigned (#3285).
              transformRefArrayLiteral(path.scope, value.expression);
            }
            results.exprs.unshift(
              t.expressionStatement(
                t.callExpression(
                  registerImportMethod(
                    path,
                    "ref",
                    getRendererConfig(path, "universal").moduleName
                  ),
                  [t.arrowFunctionExpression([], value.expression as t.Expression), elem]
                )
              )
            );
          } else {
            const refIdentifier = path.scope.generateUidIdentifier("_ref$");
            results.exprs.unshift(
              t.variableDeclaration("var", [
                t.variableDeclarator(refIdentifier, value.expression as t.Expression)
              ]),
              t.expressionStatement(
                t.logicalExpression(
                  "&&",
                  t.logicalExpression(
                    "||",
                    t.binaryExpression(
                      "===",
                      t.unaryExpression("typeof", refIdentifier),
                      t.stringLiteral("function")
                    ),
                    t.callExpression(
                      t.memberExpression(t.identifier("Array"), t.identifier("isArray")),
                      [refIdentifier]
                    )
                  ),
                  t.callExpression(
                    registerImportMethod(
                      path,
                      "ref",
                      getRendererConfig(path, "universal").moduleName
                    ),
                    [t.arrowFunctionExpression([], refIdentifier), elem]
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
          results.dynamics.push({ elem, key, value: value.expression as t.Expression });
        } else {
          addStaticAttr(
            attribute,
            results,
            initProps,
            elem,
            key,
            value.expression as t.Expression,
            hasSpread
          );
        }
      } else if (key === "children") {
        if (!hasChildren) {
          children = t.isJSXExpressionContainer(value)
            ? value
            : t.jsxExpressionContainer((value as t.Expression) || t.booleanLiteral(true));
        }
      } else {
        addStaticAttr(
          attribute,
          results,
          initProps,
          elem,
          key,
          decodedAttrValue(value) as t.Expression,
          hasSpread
        );
      }
    });
  if (spreadExpr) results.exprs.push(spreadExpr);
  if (!hasChildren && children) {
    path.node.children.push(children);
  }
  return initProps;
}

// A JSX string attribute prints its `extra.raw` — the source text, entities
// included — so `normal="Search&hellip;"` reached the host's setProp as the
// six raw characters (#3127, same class as text children). The parser
// already decoded the entities into `.value` (that decoded form is what the
// DOM generator's template parser produces and what component props receive);
// rebuild the literal so the host gets the decoded string. Only for the
// attribute's own StringLiteral: an expression container's string is a JS
// string, where `&hellip;` is six literal characters by JS semantics.
function decodedAttrValue(value: t.JSXAttribute["value"]): t.JSXAttribute["value"] {
  return t.isStringLiteral(value) ? t.stringLiteral(value.value) : value;
}

function addStaticAttr(
  path: BabelPath,
  results: UniversalTransformResult,
  initProps: t.ObjectProperty[],
  elem: t.Expression,
  key: string,
  value: t.Expression | t.JSXAttribute["value"],
  hasSpread: boolean
) {
  if (!value) value = t.booleanLiteral(true);
  if (hasSpread) {
    results.exprs.push(t.expressionStatement(setAttr(path, elem, key, value as t.Expression)));
  } else {
    initProps.push(
      t.objectProperty(
        t.isValidIdentifier(key) ? t.identifier(key) : t.stringLiteral(key),
        value as t.Expression
      )
    );
  }
}

export function setAttr(
  path: BabelPath,
  elem: t.Expression,
  name: string,
  value: t.Expression | t.JSXAttribute["value"],
  { prevId }: { prevId?: t.Expression; dynamic?: boolean } = {}
) {
  if (!value) value = t.booleanLiteral(true);
  const args = prevId
    ? ([elem, t.stringLiteral(name), value as t.Expression, prevId] as t.Expression[])
    : ([elem, t.stringLiteral(name), value as t.Expression] as t.Expression[]);
  return t.callExpression(
    registerImportMethod(path, "setProp", getRendererConfig(path, "universal").moduleName),
    args
  );
}

function transformChildren(path: BabelPath<t.JSXElement>, results: UniversalTransformResult): void {
  const filteredChildren = filterChildren(path.get("children")),
    multi = checkLength(filteredChildren),
    childNodes = filteredChildren
      // `universal: true`: this text feeds the host's createTextNode, so the
      // shared text branch must not HTML-escape it and must decode entities
      // (#3127) — element-scoped because dynamic mode mixes renderers.
      .map(path => transformNode(path, { universal: true }))
      .reduce((memo: TransformResult[], child) => {
        if (!child) return memo;
        const i = memo.length;
        if (child.text && i && memo[i - 1].text) {
          memo[i - 1].template = `${memo[i - 1].template as string}${child.template as string}`;
          memo[i - 1].templateWithClosingTags =
            `${memo[i - 1].templateWithClosingTags || memo[i - 1].template}${child.templateWithClosingTags || (child.template as string)}`;
        } else memo.push(child);
        return memo;
      }, []);

  const appends: t.ExpressionStatement[] = [];
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
      let insert: t.Expression = child.id;
      if (child.text) {
        const childTemplate = child.template as string;
        let createTextNode = registerImportMethod(
          path,
          "createTextNode",
          getRendererConfig(path, "universal").moduleName
        );
        if (multi) {
          results.declarations.push(
            t.variableDeclarator(
              child.id,
              t.callExpression(createTextNode, [
                t.templateLiteral(
                  [t.templateElement({ raw: escapeStringForTemplate(childTemplate) })],
                  []
                )
              ])
            )
          );
        } else
          insert = t.callExpression(createTextNode, [
            t.templateLiteral(
              [t.templateElement({ raw: escapeStringForTemplate(childTemplate) })],
              []
            )
          ]);
      }
      appends.push(t.expressionStatement(t.callExpression(insertNode, [results.id, insert])));
      results.declarations.push(...(child.declarations as t.VariableDeclarator[]));
      results.exprs.push(...(child.exprs as t.Statement[]));
      results.dynamics.push(...child.dynamics);
    } else if (child.exprs.length) {
      let insert = registerImportMethod(
        path,
        "insert",
        getRendererConfig(path, "universal").moduleName
      );
      if (multi) {
        results.exprs.push(
          t.expressionStatement(
            t.callExpression(insert, [
              results.id,
              child.exprs[0] as t.Expression,
              nextChild(childNodes, index) || t.nullLiteral()
            ])
          )
        );
      } else {
        results.exprs.push(
          t.expressionStatement(
            t.callExpression(insert, [results.id, child.exprs[0] as t.Expression])
          )
        );
      }
    }
  });
  results.exprs.unshift(...appends);
}

function nextChild(children: TransformResult[], index: number): t.Identifier | undefined {
  return children[index + 1] && (children[index + 1].id || nextChild(children, index + 1));
}

function processSpreads(
  path: BabelPath<t.JSXElement>,
  attributes: JSXAttributePath[],
  {
    elem,
    hasChildren,
    wrapConditionals
  }: { elem: t.Identifier; hasChildren: boolean; wrapConditionals: boolean }
): [JSXAttributePath[], t.ExpressionStatement] {
  // TODO: skip but collect the names of any properties after the last spread to not overwrite them
  const filteredAttributes: JSXAttributePath[] = [];
  const spreadArgs: t.Expression[] = [];
  let runningObject: Array<t.ObjectProperty | t.ObjectMethod> = [];
  let dynamicSpread = false;
  let firstSpread = false;
  attributes.forEach(attribute => {
    const node = attribute.node;
    const key = t.isJSXSpreadAttribute(node)
      ? undefined
      : t.isJSXNamespacedName(node.name)
        ? `${node.name.namespace.name}:${node.name.name.name}`
        : node.name.name;
    if (t.isJSXSpreadAttribute(node)) {
      firstSpread = true;
      if (runningObject.length) {
        spreadArgs.push(t.objectExpression(runningObject));
        runningObject = [];
      }
      spreadArgs.push(
        isDynamic(attribute.get("argument"), {
          checkMember: true
        }) && (dynamicSpread = true)
          ? t.isCallExpression(node.argument) &&
            !node.argument.arguments.length &&
            !t.isCallExpression(node.argument.callee) &&
            !t.isMemberExpression(node.argument.callee)
            ? (node.argument.callee as t.Expression)
            : t.arrowFunctionExpression([], node.argument)
          : (node.argument as t.Expression)
      );
    } else if (
      (firstSpread ||
        (t.isJSXExpressionContainer(node.value) &&
          isDynamic(attribute.get("value").get("expression"), { checkMember: true }))) &&
      key &&
      canNativeSpread(key, { checkNameSpaces: true })
    ) {
      const isContainer = t.isJSXExpressionContainer(node.value);
      const dynamic =
        isContainer && isDynamic(attribute.get("value").get("expression"), { checkMember: true });
      if (dynamic) {
        const id = convertJSXIdentifier(node.name);
        const expression = (node.value as t.JSXExpressionContainer).expression as t.Expression;
        // Unlike the dom generate (#2959), keep the condition memo here:
        // universal has no hydration ids to drift, and custom-renderer prop
        // values can be arbitrarily expensive — truthiness insulation pays.
        let expr: t.ArrowFunctionExpression & { body: t.Expression } =
          wrapConditionals &&
          (t.isLogicalExpression(expression) || t.isConditionalExpression(expression))
            ? transformCondition(attribute.get("value").get("expression"), true)
            : (t.arrowFunctionExpression([], expression) as t.ArrowFunctionExpression & {
                body: t.Expression;
              });
        runningObject.push(
          t.objectMethod(
            "get",
            id,
            [],
            t.blockStatement([t.returnStatement(expr.body)]),
            !t.isValidIdentifier(key)
          )
        );
      } else {
        runningObject.push(
          t.objectProperty(
            t.stringLiteral(key),
            (isContainer
              ? (node.value as t.JSXExpressionContainer).expression
              : decodedAttrValue(node.value) || t.booleanLiteral(true)) as t.Expression
          )
        );
      }
    } else filteredAttributes.push(attribute);
  });

  if (runningObject.length) {
    spreadArgs.push(t.objectExpression(runningObject));
  }

  const props =
    spreadArgs.length === 1 && !dynamicSpread
      ? spreadArgs[0]
      : t.callExpression(registerImportMethod(path, "mergeProps"), spreadArgs);

  return [
    filteredAttributes,
    t.expressionStatement(
      t.callExpression(
        registerImportMethod(path, "spread", getRendererConfig(path, "universal").moduleName),
        [elem, props, t.booleanLiteral(hasChildren)]
      )
    )
  ];
}
