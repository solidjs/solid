import * as t from "@babel/types";
import config from "../config";
import { registerImportMethod } from "../shared/utils";
import { setAttr } from "./element";

export function createTemplate(path, result, wrap) {
  if (result.id) {
    registerTemplate(path, result);
    if (
      !(result.exprs.length || result.dynamics.length || result.postExprs.length) &&
      result.decl.declarations.length === 1
    ) {
      return result.decl.declarations[0].init;
    } else {
      return t.callExpression(
        t.arrowFunctionExpression(
          [],
          t.blockStatement([
            result.decl,
            ...result.exprs.concat(
              wrapDynamics(path, result.dynamics) || [],
              result.postExprs || []
            ),
            t.returnStatement(result.id)
          ])
        ),
        []
      );
    }
  }
  if (wrap && result.dynamic) {
    registerImportMethod(path, "memo");
    return t.callExpression(t.identifier("_$memo"), [result.exprs[0]]);
  }
  return result.exprs[0];
}

export function appendTemplates(path, templates) {
  const declarators = templates.map(template => {
    const tmpl = {
      cooked: template.template,
      raw: template.template
    };
    registerImportMethod(path, "template");
    return t.variableDeclarator(
      template.id,
      t.callExpression(
        t.identifier("_$template"),
        [
          t.templateLiteral([t.templateElement(tmpl, true)], []),
          t.numericLiteral(template.elementCount)
        ].concat(template.isSVG ? t.booleanLiteral(template.isSVG) : [])
      )
    );
  });
  path.node.body.unshift(t.variableDeclaration("const", declarators));
}

function registerTemplate(path, results) {
  const { generate, hydratable } = config;
  let decl;
  if (results.template.length) {
    const templates =
      path.scope.getProgramParent().data.templates ||
      (path.scope.getProgramParent().data.templates = []);
    let templateDef, templateId;
    if ((templateDef = templates.find(t => t.template === results.template))) {
      templateId = templateDef.id;
    } else {
      templateId = path.scope.generateUidIdentifier("tmpl$");
      templates.push({
        id: templateId,
        template: results.template,
        elementCount: results.template.split("<").length - 1,
        isSVG: results.isSVG
      });
    }
    hydratable && registerImportMethod(path, "getNextElement");
    decl = t.variableDeclarator(
      results.id,
      hydratable
        ? t.callExpression(
            t.identifier("_$getNextElement"),
            [templateId]
          )
        : t.callExpression(t.memberExpression(templateId, t.identifier("cloneNode")), [
            t.booleanLiteral(true)
          ])
    );
  }
  results.decl.unshift(decl);
  results.decl = t.variableDeclaration("const", results.decl);
}

function wrapDynamics(path, dynamics) {
  if (!dynamics.length) return;
  registerImportMethod(path, "effect");
  if (dynamics.length === 1) {
    const prevValue =
      dynamics[0].key === "classList" || dynamics[0].key === "style"
        ? t.identifier("_$p")
        : undefined;
    return t.expressionStatement(
      t.callExpression(t.identifier("_$effect"), [
        t.arrowFunctionExpression(
          prevValue ? [prevValue] : [],
          setAttr(
            path,
            dynamics[0].elem,
            dynamics[0].key,
            dynamics[0].value,
            {
              isSVG: dynamics[0].isSVG,
              isCE: dynamics[0].isCE,
              dynamic: true,
              prevId: prevValue
            }
          )
        )
      ])
    );
  }
  const decls = [],
    statements = [],
    identifiers = [],
    prevId = t.identifier("_p$");
  dynamics.forEach(({ elem, key, value, isSVG, isCE }) => {
    const identifier = path.scope.generateUidIdentifier("v$");
    identifiers.push(identifier);
    decls.push(t.variableDeclarator(identifier, value));
    if (key === "classList" || key === "style") {
      const prev = t.memberExpression(prevId, identifier);
      statements.push(
        t.expressionStatement(
          t.assignmentExpression(
            "=",
            prev,
            setAttr(path, elem, key, identifier, { isSVG, isCE, dynamic: true, prevId: prev })
          )
        )
      );
    } else {
      statements.push(
        t.expressionStatement(
          t.logicalExpression(
            "&&",
            t.binaryExpression("!==", identifier, t.memberExpression(prevId, identifier)),
            setAttr(
              path,
              elem,
              key,
              t.assignmentExpression("=", t.memberExpression(prevId, identifier), identifier),
              { isSVG, isCE, dynamic: true }
            )
          )
        )
      );
    }
  });

  return t.expressionStatement(
    t.callExpression(t.identifier("_$effect"), [
      t.arrowFunctionExpression(
        [prevId],
        t.blockStatement([
          t.variableDeclaration("const", decls),
          ...statements,
          t.returnStatement(prevId)
        ])
      ),
      t.objectExpression(identifiers.map(id => t.objectProperty(id, t.identifier("undefined"))))
    ])
  );
}
