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
import {
  analyzeRegionScope,
  isSafeResidual,
  substituteChains,
  substituteResidualSubject
} from "../shared/region";
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
      const regionStmt = config.regions ? wrapRegion(path, result.dynamics) : undefined;
      const dynamicsStmt = regionStmt ?? wrapDynamics(path, result.dynamics);
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

/** Region emission — the ENVELOPE CONTRACT (compiler audit, 2026-09-02):
 * one `_$region(subject, compute, commit, deep?)` per template scope.
 *
 * COMPUTE `(_t$, _u$, _d$)` — every binding's expression evaluates here, in
 * SOURCE ORDER, into the envelope `_t$`:
 * - eligible chains ride the raw views (`_u$` for depth-1; `_w$n` prefix
 *   locals resolved through the pending-aware step helper `_d$` for deeper
 *   steps — raw child slots go stale in the pure phase);
 * - SAFE residuals (no calls/assignments/functions — see isSafeResidual)
 *   get direct depth-1 subject reads rewritten onto `_u$`;
 * - everything else stays UNSUBSTITUTED (closes over the proxy: per-key
 *   tracked in both dispatchers), including `prop:`-sinks regardless of
 *   grammar — raw backing identity must never leak into DOM properties.
 *
 * COMMIT `(_t$, _p$, _f$)` — compares + writes ONLY. `_f$` forces every
 * write on the first run (initial `undefined` values still write), and
 * baselines advance AFTER each write (a throwing setter can't poison them).
 *
 * The runtime combinator runs the same two functions under either
 * dispatcher; declines/demotions differ only in what `_u$`/`_d$` resolve.
 * Returns undefined when the scope has no eligible subject. */
function wrapRegion(path: NodePath, dynamics: DynamicBinding[]): t.ExpressionStatement | undefined {
  if (!dynamics.length) return undefined;
  const scope = analyzeRegionScope(path, dynamics);
  if (!scope) return undefined;
  const regionId = registerImportMethod(path, "region", undefined);
  const envId = t.identifier("_t$");
  const rawId = t.identifier("_u$");
  const stepId = t.identifier("_d$");
  const prevId = t.identifier("_p$");
  const forceId = t.identifier("_f$");
  const computeStatements: t.Statement[] = [];
  const commitStatements: t.Statement[] = [];

  // Shared prefix locals for deep chains (shortest first, parents resolve
  // before children): const _w$n = _d$(<parent>, "<key>").
  const prefixVars = new Map<string, t.Identifier>();
  for (let i = 0; i < scope.deepPrefixes.length; i++) {
    const prefix = scope.deepPrefixes[i];
    const parentVar =
      prefix.length === 1 ? rawId : prefixVars.get(prefix.slice(0, -1).join("\u0000"))!;
    const v = t.identifier("_w$" + i);
    prefixVars.set(prefix.join("\u0000"), v);
    computeStatements.push(
      t.variableDeclaration("const", [
        t.variableDeclarator(
          v,
          t.callExpression(t.cloneNode(stepId), [
            t.cloneNode(parentVar),
            t.stringLiteral(prefix[prefix.length - 1])
          ])
        )
      ])
    );
  }
  const prefixVar = (key: string) => prefixVars.get(key)!;

  dynamics.forEach((d, index) => {
    let { value } = d;
    const { elem, key, tagName, styleProperty, classProperty } = d;
    if (classProperty && !t.isBooleanLiteral(value) && !t.isUnaryExpression(value)) {
      value = t.unaryExpression("!", t.unaryExpression("!", value));
    }
    // prop: sinks receive live identities — raw backing must never leak
    // through them, so they always evaluate UNSUBSTITUTED (proxy values).
    const propSink = key.startsWith("prop:");
    let envelopeExpr: t.Expression;
    if (scope.eligible[index] && !propSink) {
      envelopeExpr = substituteChains(value, scope.subject, rawId, prefixVar);
    } else if (!propSink && isSafeResidual(value)) {
      envelopeExpr = substituteResidualSubject(value, scope.subject, rawId);
    } else {
      envelopeExpr = value; // opaque: tracked through the closed-over proxy
    }
    const slot = t.identifier(getNumberedId(index));
    computeStatements.push(
      t.expressionStatement(
        t.assignmentExpression("=", t.memberExpression(t.cloneNode(envId), slot), envelopeExpr)
      )
    );

    const v = t.identifier("_v$" + index);
    const envMember = t.memberExpression(t.cloneNode(envId), t.cloneNode(slot));
    const prevMember = () => t.memberExpression(t.cloneNode(prevId), t.cloneNode(slot));
    commitStatements.push(t.variableDeclaration("let", [t.variableDeclarator(v, envMember)]));
    const changed = t.logicalExpression(
      "||",
      t.cloneNode(forceId),
      t.binaryExpression("!==", t.cloneNode(v), prevMember())
    );
    if (key === "class" || key === "style" || isStatefulDOMProperty(tagName, key)) {
      // Stateful writes consume the previous VALUE — write first, advance
      // the baseline after (a throwing setter must not poison it).
      commitStatements.push(
        t.ifStatement(
          changed,
          t.blockStatement([
            t.expressionStatement(
              setAttr(path, elem, key, t.cloneNode(v), {
                tagName,
                dynamic: true,
                prevId: prevMember()
              })
            ),
            t.expressionStatement(t.assignmentExpression("=", prevMember(), t.cloneNode(v)))
          ])
        )
      );
    } else {
      commitStatements.push(
        t.expressionStatement(
          t.logicalExpression(
            "&&",
            changed,
            t.sequenceExpression([
              setAttr(path, elem, key, t.cloneNode(v), {
                tagName,
                dynamic: true,
                styleProperty,
                classProperty
              }),
              t.assignmentExpression("=", prevMember(), t.cloneNode(v))
            ])
          )
        )
      );
    }
  });

  return t.expressionStatement(
    t.callExpression(regionId, [
      t.identifier(scope.subject),
      t.arrowFunctionExpression([envId, rawId, stepId], t.blockStatement(computeStatements)),
      t.arrowFunctionExpression([envId, prevId, forceId], t.blockStatement(commitStatements)),
      // DEEP flag: eligible chains below the subject's own keys — writes
      // bubble to the region root (see region()/bumpDeep).
      ...(scope.deepPrefixes.length ? [t.numericLiteral(1)] : [])
    ])
  );
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
