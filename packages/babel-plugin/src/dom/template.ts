import * as t from "@babel/types";
import {
  escapeStringForTemplate,
  getConfig,
  getNumberedId,
  getRendererConfig,
  isStatementVariableInitializer,
  isStatefulDOMProperty,
  registerImportMethod,
  wrapForEffect
} from "../shared/utils";
import { setAttr } from "./element";
import type { NodePath } from "@babel/traverse";
import type { DynamicBinding, ProgramScopeData, TemplateRecord, TransformResult } from "../types";

export function createTemplate(
  path: NodePath,
  result: TransformResult,
  wrap: boolean
): t.Expression {
  const config = getConfig(path);
  if (result.id) {
    registerTemplate(path, result);
    const decl = result.decl!;
    if (
      !(result.exprs.length || result.dynamics.length || result.postExprs?.length) &&
      decl.declarations.length === 1
    ) {
      return decl.declarations[0].init as t.Expression;
    } else {
      const dynamicsStmt = wrapDynamics(path, result.dynamics);
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
      const isReturnArg = t.isReturnStatement(path.parent) && path.parent.argument === path.node;
      const isVarInit = isStatementVariableInitializer(path);

      if (isReturnArg || isVarInit) {
        path.getStatementParent()?.insertBefore(stmts as t.Statement[]);
        return result.id;
      }

      // Fallback: JSX is in a ternary branch / array element / function arg
      // / logical expression — keep the IIFE. Flattening to a sequence
      // expression here is doable but harder to read for the DOM shape
      // (mixed variable declarations + side-effecting expression statements
      // would need to be linearized into commas), and the perf delta in
      // these rarer positions is negligible.
      return t.callExpression(
        t.arrowFunctionExpression(
          [],
          t.blockStatement([...(stmts as t.Statement[]), t.returnStatement(result.id)])
        ),
        []
      );
    }
  }
  if (wrap && result.dynamic && config.memoWrapper) {
    return t.callExpression(registerImportMethod(path, config.memoWrapper, undefined), [
      result.exprs[0] as t.Expression
    ]);
  }
  return result.exprs[0] as t.Expression;
}

export function appendTemplates(path: NodePath<t.Program>, templates: TemplateRecord[]) {
  const declarators = templates.map(template => {
    const templateText = template.template as string;
    const tmpl = {
      cooked: templateText,
      raw: escapeStringForTemplate(templateText)
    };

    const flag = template.isWrapped ? 2 : template.isImportNode ? 1 : null;

    return t.variableDeclarator(
      template.id,
      t.addComment(
        t.callExpression(
          registerImportMethod(path, "template", getRendererConfig(path, "dom").moduleName),
          [
            t.templateLiteral([t.templateElement(tmpl, true)], []),
            ...(flag ? [t.numericLiteral(flag)] : [])
          ]
        ),
        "leading",
        "#__PURE__"
      )
    );
  });
  path.node.body.unshift(t.variableDeclaration("var", declarators));
}

function registerTemplate(path: NodePath, results: TransformResult) {
  const { hydratable } = getConfig(path);
  let decl;
  if (typeof results.template === "string" && results.template.length) {
    let templateDef, templateId;
    if (!results.skipTemplate) {
      const data = path.scope.getProgramParent().data as ProgramScopeData;
      const templates = data.templates || (data.templates = []);
      if ((templateDef = templates.find(t => t.template === results.template))) {
        templateId = templateDef.id;
      } else {
        templateId = path.scope.generateUidIdentifier("tmpl$");
        templates.push({
          id: templateId,
          template: results.template as string,
          templateWithClosingTags: results.templateWithClosingTags as string,
          isImportNode: results.isImportNode,
          isWrapped: results.isWrapped,
          renderer: "dom",
          // templates dedupe on markup, so the FIRST site carries the blame
          // for a validate failure (#3099) — good enough: every site with
          // this markup has the same problem
          path
        });
      }
    }
    const id = results.id!;
    decl = t.variableDeclarator(
      id,
      hydratable
        ? t.callExpression(
            registerImportMethod(path, "getNextElement", getRendererConfig(path, "dom").moduleName),
            templateId ? [templateId] : []
          )
        : t.callExpression(templateId!, [])
    );
  }
  if (decl) results.declarations.unshift(decl);
  results.decl = t.variableDeclaration("var", results.declarations as t.VariableDeclarator[]);
}

function wrapDynamics(path: NodePath, dynamics: DynamicBinding[]) {
  if (!dynamics.length) return;
  const config = getConfig(path);

  // dynamics are only queued when effectWrapper is configured (element.ts
  // guards every push), so the name is always a string here
  const effectWrapperId = registerImportMethod(path, config.effectWrapper as string, undefined);

  if (dynamics.length === 1) {
    const prevValue =
      dynamics[0].key === "class" || dynamics[0].key === "style" ? t.identifier("_$p") : undefined;

    if (
      dynamics[0].classProperty &&
      !t.isBooleanLiteral(dynamics[0].value) &&
      !t.isUnaryExpression(dynamics[0].value)
    ) {
      dynamics[0].value = t.unaryExpression("!", t.unaryExpression("!", dynamics[0].value));
    }

    const newValue = t.identifier("_v$");
    return t.expressionStatement(
      t.callExpression(effectWrapperId, [
        wrapForEffect(dynamics[0].value),
        t.arrowFunctionExpression(
          prevValue ? [newValue, prevValue] : [newValue],
          t.blockStatement([
            t.expressionStatement(
              setAttr(path, dynamics[0].elem, dynamics[0].key, newValue, {
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

  const prevId = t.identifier("_p$");

  const values: t.ObjectProperty[] = [];
  const statements: t.ExpressionStatement[] = [];
  const properties: t.Identifier[] = [];

  dynamics.forEach(({ elem, key, value, tagName, styleProperty, classProperty }, index) => {
    const propIdent = t.identifier(getNumberedId(index));
    const propMember = t.memberExpression(prevId, propIdent);
    const optionalPropMember = t.optionalMemberExpression(prevId, propIdent, false, true);

    if (classProperty && !t.isBooleanLiteral(value) && !t.isUnaryExpression(value)) {
      value = t.unaryExpression("!", t.unaryExpression("!", value));
    }

    properties.push(propIdent);
    values.push(t.objectProperty(propIdent, value));

    if (key === "class" || key === "style" || isStatefulDOMProperty(tagName, key)) {
      statements.push(
        t.expressionStatement(
          setAttr(path, elem, key, propIdent, {
            tagName,
            dynamic: true,
            prevId: optionalPropMember
          })
        )
      );
    } else {
      statements.push(
        t.expressionStatement(
          t.logicalExpression(
            "&&",
            key === "textContent"
              ? t.logicalExpression(
                  "||",
                  t.unaryExpression("!", prevId),
                  t.binaryExpression("!==", propIdent, propMember)
                )
              : t.binaryExpression("!==", propIdent, optionalPropMember),
            setAttr(path, elem, key, propIdent, {
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

  return t.expressionStatement(
    t.callExpression(effectWrapperId, [
      t.arrowFunctionExpression([], t.objectExpression(values)),
      t.arrowFunctionExpression(
        [t.objectPattern(properties.map(id => t.objectProperty(id, id, false, true))), prevId],
        t.blockStatement(statements)
      )
    ])
  );
}
