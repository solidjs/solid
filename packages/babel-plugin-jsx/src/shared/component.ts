import * as t from "@babel/types";
import { decode } from "html-entities";
import {
  getConfig,
  isDynamic,
  registerImportMethod,
  filterChildren,
  trimWhitespace,
  transformCondition,
  convertJSXIdentifier
} from "./utils";
import { transformNode, getCreateTemplate } from "./transform";
import type { JSXDOMExpressionsConfig } from "../config";
import type { BabelPath, JSXNode, TransformResult } from "../types";

type JSXAttributePath = BabelPath<t.JSXAttribute | t.JSXSpreadAttribute>;
type ComponentTransformResult = TransformResult & {
  template: "";
  component: true;
  exprs: Array<t.Expression | t.Statement>;
};

type ComponentChildrenResult = [t.Expression, boolean] | undefined;

function isSimpleOptionalMemberExpression(
  expression: t.Expression | t.JSXEmptyExpression
): expression is t.OptionalMemberExpression & {
  object: t.Identifier;
  property: t.Identifier;
} {
  return (
    t.isOptionalMemberExpression(expression) &&
    !expression.computed &&
    t.isIdentifier(expression.object) &&
    t.isIdentifier(expression.property)
  );
}

function convertComponentIdentifier(
  node: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName
): t.Expression {
  if (t.isJSXIdentifier(node)) {
    if (node.name === "this") return t.thisExpression();
    if (t.isValidIdentifier(node.name)) {
      const identifier = node as unknown as t.Identifier;
      identifier.type = "Identifier";
      return identifier;
    } else return t.stringLiteral(node.name);
  } else if (t.isJSXMemberExpression(node)) {
    const prop = convertComponentIdentifier(node.property);
    const computed = t.isStringLiteral(prop);
    return t.memberExpression(
      convertComponentIdentifier(node.object),
      prop as t.Identifier | t.Expression,
      computed
    );
  }

  return t.stringLiteral(`${node.namespace.name}:${node.name.name}`);
}

export default function transformComponent(
  path: BabelPath<t.JSXElement>
): ComponentTransformResult {
  let exprs: Array<t.Expression | t.Statement> = [],
    config = getConfig(path),
    tagId = convertComponentIdentifier(path.node.openingElement.name),
    props: t.Expression[] = [],
    runningObject: Array<t.ObjectProperty | t.ObjectMethod> = [],
    dynamicSpread = false,
    hasChildren = path.node.children.length > 0;

  if (
    t.isIdentifier(tagId) &&
    config.builtIns.indexOf(tagId.name) > -1 &&
    !path.scope.hasBinding(tagId.name)
  ) {
    const newTagId = registerImportMethod(path, tagId.name);
    tagId.name = newTagId.name;
  }

  path
    .get("openingElement")
    .get("attributes")
    .forEach((attribute: JSXAttributePath) => {
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
            ? t.isCallExpression(node.argument) &&
              !node.argument.arguments.length &&
              !t.isCallExpression(node.argument.callee) &&
              !t.isMemberExpression(node.argument.callee)
              ? (node.argument.callee as t.Expression)
              : t.arrowFunctionExpression([], node.argument)
            : (node.argument as t.Expression)
        );
      } else if (t.isJSXAttribute(node)) {
        // handle weird babel bug around HTML entities
        const value =
            (t.isStringLiteral(node.value) ? t.stringLiteral(node.value.value) : node.value) ||
            t.booleanLiteral(true),
          id = convertJSXIdentifier(node.name),
          key = t.isIdentifier(id) ? id.name : (id as t.StringLiteral).value;
        if (hasChildren && key === "children") return;
        if (t.isJSXExpressionContainer(value))
          if (key === "ref") {
            // Normalize expressions for non-null and type-as
            while (
              t.isTSNonNullExpression(value.expression) ||
              t.isTSAsExpression(value.expression) ||
              t.isTSSatisfiesExpression(value.expression)
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
              runningObject.push(
                t.objectMethod(
                  "method",
                  t.identifier("ref"),
                  [t.identifier("r$")],
                  t.blockStatement([
                    t.variableDeclaration("var", [
                      t.variableDeclarator(refIdentifier, value.expression)
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
                        t.callExpression(registerImportMethod(path, "applyRef"), [
                          refIdentifier,
                          t.identifier("r$")
                        ]),
                        t.assignmentExpression("=", value.expression, t.identifier("r$"))
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
                t.objectMethod(
                  "method",
                  t.identifier("ref"),
                  [t.identifier("r$")],
                  t.blockStatement([
                    t.variableDeclaration("var", [
                      t.variableDeclarator(refIdentifier, value.expression)
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
                        t.callExpression(registerImportMethod(path, "applyRef"), [
                          refIdentifier,
                          t.identifier("r$")
                        ]),
                        t.logicalExpression(
                          "&&",
                          t.unaryExpression("!", t.unaryExpression("!", t.identifier(object.name))),
                          t.assignmentExpression(
                            "=",
                            t.memberExpression(
                              t.identifier(object.name),
                              t.identifier(property.name)
                            ),
                            t.identifier("r$")
                          )
                        )
                      )
                    )
                  ])
                )
              );
            } else if (
              isConstant ||
              t.isFunction(value.expression) ||
              t.isArrayExpression(value.expression)
            ) {
              runningObject.push(
                t.objectProperty(t.identifier("ref"), value.expression as t.Expression)
              );
            } else if (t.isCallExpression(value.expression)) {
              const refIdentifier = path.scope.generateUidIdentifier("_ref$");
              exprs.push(
                t.variableDeclaration("var", [
                  t.variableDeclarator(refIdentifier, value.expression)
                ])
              );
              runningObject.push(
                t.objectMethod(
                  "method",
                  t.identifier("ref"),
                  [t.identifier("r$")],
                  t.blockStatement([
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
                        t.callExpression(registerImportMethod(path, "applyRef"), [
                          refIdentifier,
                          t.identifier("r$")
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
              (t.isLogicalExpression(value.expression) ||
                t.isConditionalExpression(value.expression))
            ) {
              const expr = transformCondition(attribute.get("value").get("expression"), true);

              runningObject.push(
                t.objectMethod(
                  "get",
                  id,
                  [],
                  t.blockStatement([t.returnStatement(expr.body)]),
                  !t.isValidIdentifier(key)
                )
              );
            } else if (
              t.isCallExpression(value.expression) &&
              t.isArrowFunctionExpression(value.expression.callee) &&
              value.expression.callee.params.length === 0
            ) {
              const callee = value.expression.callee;
              const body = t.isBlockStatement(callee.body)
                ? callee.body
                : t.blockStatement([t.returnStatement(callee.body)]);

              runningObject.push(t.objectMethod("get", id, [], body, !t.isValidIdentifier(key)));
            } else {
              runningObject.push(
                t.objectMethod(
                  "get",
                  id,
                  [],
                  t.blockStatement([t.returnStatement(value.expression as t.Expression)]),
                  !t.isValidIdentifier(key)
                )
              );
            }
          } else runningObject.push(t.objectProperty(id, value.expression as t.Expression));
        else runningObject.push(t.objectProperty(id, value));
      }
    });

  const childResult = transformComponentChildren(path.get("children"), config);
  if (childResult) {
    if (childResult[1]) {
      const body =
        t.isCallExpression(childResult[0]) && t.isFunction(childResult[0].arguments[0])
          ? (childResult[0].arguments[0] as t.Function).body
          : t.isFunction(childResult[0])
            ? childResult[0].body
            : childResult[0];
      runningObject.push(
        t.objectMethod(
          "get",
          t.identifier("children"),
          [],
          t.isExpression(body) ? t.blockStatement([t.returnStatement(body)]) : body
        )
      );
    } else runningObject.push(t.objectProperty(t.identifier("children"), childResult[0]));
  }
  if (runningObject.length || !props.length) props.push(t.objectExpression(runningObject));

  if (props.length > 1 || dynamicSpread) {
    props = [t.callExpression(registerImportMethod(path, "mergeProps"), props)];
  }
  const componentArgs = [tagId, props[0]];
  // SSR's `createComponent` is literally `Comp(props || {})`. Since the
  // compiler always emits a real `props[0]` object expression above (see the
  // `props.push(t.objectExpression(runningObject))` line), the `|| {}` fallback
  // never fires in compiled output. Inline to a direct `Comp(props)` call to
  // drop one function-call frame per component invocation. (DOM/dev modes
  // keep the wrapper since it does real work — `untrack`, dev metadata.)
  if (getConfig(path).generate === "ssr") {
    exprs.push(t.callExpression(tagId, [props[0]]));
  } else {
    exprs.push(t.callExpression(registerImportMethod(path, "createComponent"), componentArgs));
  }

  // handle hoisting conditionals
  if (exprs.length > 1) {
    const ret = exprs.pop();
    exprs = [
      t.callExpression(
        t.arrowFunctionExpression(
          [],
          t.blockStatement([...(exprs as t.Statement[]), t.returnStatement(ret as t.Expression)])
        ),
        []
      )
    ];
  }
  return { exprs, template: "", component: true, declarations: [], dynamics: [] };
}

function transformComponentChildren(
  children: BabelPath<JSXNode>[],
  config: JSXDOMExpressionsConfig
): ComponentChildrenResult {
  const filteredChildren = filterChildren(children);
  if (!filteredChildren.length) return;
  let dynamic = false;
  let pathNodes: t.Node[] = [];

  let transformedChildren: t.Expression | t.Expression[] = filteredChildren.reduce(
    (memo: t.Expression[], path: BabelPath<JSXNode>) => {
      if (t.isJSXText(path.node)) {
        const v = decode(trimWhitespace((path.node.extra?.raw as string | undefined) ?? ""));
        if (v.length) {
          pathNodes.push(path.node);
          memo.push(t.stringLiteral(v));
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
          t.isFunction(child.exprs[0])
        ) {
          child.exprs[0] = child.exprs[0].body;
        }
        pathNodes.push(path.node);
        memo.push(
          getCreateTemplate(config, path, child)(
            path,
            child,
            filteredChildren.length > 1
          ) as t.Expression
        );
      }
      return memo;
    },
    []
  );

  if (Array.isArray(transformedChildren) && transformedChildren.length === 1) {
    transformedChildren = transformedChildren[0];
    if (
      !t.isJSXExpressionContainer(pathNodes[0]) &&
      !t.isJSXSpreadChild(pathNodes[0]) &&
      !t.isJSXText(pathNodes[0])
    ) {
      transformedChildren =
        t.isCallExpression(transformedChildren) &&
        !transformedChildren.arguments.length &&
        !t.isIdentifier(transformedChildren.callee)
          ? (transformedChildren.callee as t.Expression)
          : t.arrowFunctionExpression([], transformedChildren);
      dynamic = true;
    }
  } else if (Array.isArray(transformedChildren)) {
    transformedChildren = t.arrowFunctionExpression([], t.arrayExpression(transformedChildren));
    dynamic = true;
  }
  return [transformedChildren as t.Expression, dynamic];
}
