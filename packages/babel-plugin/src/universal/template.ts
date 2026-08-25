import * as t from "@babel/types";
import { getConfig, getNumberedId, registerImportMethod, wrapForEffect } from "../shared/utils";
import { setAttr } from "./element";
import type { NodePath } from "@babel/traverse";
import type { DynamicBinding, TransformResult } from "../types";

export function createTemplate(
  path: NodePath,
  result: TransformResult,
  wrap: boolean
): t.Expression {
  const config = getConfig(path);
  if (result.id) {
    result.decl = t.variableDeclaration("var", result.declarations as t.VariableDeclarator[]);
    if (
      !(result.exprs.length || result.dynamics.length || result.postExprs?.length) &&
      result.decl.declarations.length === 1
    ) {
      return result.decl.declarations[0].init as t.Expression;
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
      const isReturnArg = t.isReturnStatement(path.parent) && path.parent.argument === path.node;
      const isVarInit = t.isVariableDeclarator(path.parent) && path.parent.init === path.node;

      if (isReturnArg || isVarInit) {
        path.getStatementParent()?.insertBefore(stmts as t.Statement[]);
        return result.id;
      }

      // Fallback: keep the IIFE for ternary branches / array elements /
      // function args / logical expressions where lifting would change
      // observable evaluation semantics.
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

function wrapDynamics(path: NodePath, dynamics: DynamicBinding[]) {
  if (!dynamics.length) return;
  const config = getConfig(path);

  // dynamics are only queued when effectWrapper is configured (element.ts
  // guards every push), so the name is always a string here
  const effectWrapperId = registerImportMethod(path, config.effectWrapper as string, undefined);

  if (dynamics.length === 1) {
    const prevValue = t.identifier("_$p");
    const newValue = t.identifier("_v$");

    return t.expressionStatement(
      t.callExpression(effectWrapperId, [
        wrapForEffect(dynamics[0].value),
        t.arrowFunctionExpression(
          [newValue, prevValue],
          t.blockStatement([
            t.expressionStatement(
              setAttr(path, dynamics[0].elem, dynamics[0].key, newValue, {
                dynamic: true,
                prevId: prevValue
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

  dynamics.forEach(({ elem, key, value }, index) => {
    const propIdent = t.identifier(getNumberedId(index));
    const propMember = t.memberExpression(prevId, propIdent);
    const optionalPropMember = t.optionalMemberExpression(prevId, propIdent, false, true);

    properties.push(propIdent);
    values.push(t.objectProperty(propIdent, value));

    statements.push(
      t.expressionStatement(
        t.logicalExpression(
          "&&",
          t.binaryExpression("!==", propIdent, optionalPropMember),
          setAttr(path, elem, key, propIdent, { dynamic: true, prevId: optionalPropMember })
        )
      )
    );
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
