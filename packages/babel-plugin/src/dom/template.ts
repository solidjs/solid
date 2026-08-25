import * as t from "@babel/types";
import {
  escapeStringForTemplate,
  getConfig,
  getNumberedId,
  getRendererConfig,
  isStatefulDOMProperty,
  registerImportMethod,
  wrapForEffect
} from "../shared/utils";
import { setAttr } from "./element";
import { analyzePatchEligibility, substituteSubject } from "../shared/patch";
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
      // Static single-root template: a candidate row function returning it is
      // trivially pure (no reactive work at all).
      if (config.patchDriver) recordPureRow(path, result, null);
      return decl.declarations[0].init as t.Expression;
    } else {
      const patched = config.patchDriver ? wrapPatchMode(path, result.dynamics) : undefined;
      const dynamicsStmt = patched ? patched.stmt : wrapDynamics(path, result.dynamics);
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
      const isReturnArg = t.isReturnStatement(path.parent) && path.parent.argument === path.node;
      const isVarInit = t.isVariableDeclarator(path.parent) && path.parent.init === path.node;

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
          renderer: "dom"
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
function recordPureRow(path: NodePath, result: TransformResult, subject: string | null) {
  const parent = path.parentPath;
  if (!parent) return;
  let fn: t.ArrowFunctionExpression | t.FunctionExpression | undefined;
  if (
    (t.isArrowFunctionExpression(parent.node) || t.isFunctionExpression(parent.node)) &&
    (parent.node as t.ArrowFunctionExpression).body === path.node
  ) {
    fn = parent.node as t.ArrowFunctionExpression;
  } else if (
    t.isReturnStatement(parent.node) &&
    parent.node.argument === path.node &&
    parent.parentPath &&
    t.isBlockStatement(parent.parentPath.node) &&
    parent.parentPath.node.body.length === 1 &&
    parent.parentPath.parentPath &&
    (t.isArrowFunctionExpression(parent.parentPath.parentPath.node) ||
      t.isFunctionExpression(parent.parentPath.parentPath.node)) &&
    (parent.parentPath.parentPath.node as t.ArrowFunctionExpression).body === parent.parentPath.node
  ) {
    fn = parent.parentPath.parentPath.node as t.ArrowFunctionExpression;
  }
  if (!fn || fn.async || (fn as t.FunctionExpression).generator) return;
  if (fn.params.length !== 1 || !t.isIdentifier(fn.params[0])) return;
  const param = (fn.params[0] as t.Identifier).name;
  if (subject !== null && subject !== param) return;

  const isLocalMemberTarget = (n: t.Node): boolean => {
    if (!t.isMemberExpression(n) || n.computed) return false;
    let obj: t.Node = n.object;
    while (t.isMemberExpression(obj) && !obj.computed) obj = obj.object;
    return t.isIdentifier(obj);
  };
  for (const stmt of result.exprs) {
    if (!t.isExpressionStatement(stmt)) return;
    const e = stmt.expression;
    if (t.isAssignmentExpression(e) && e.operator === "=" && isLocalMemberTarget(e.left)) continue;
    if (
      t.isCallExpression(e) &&
      t.isMemberExpression(e.callee) &&
      !e.callee.computed &&
      t.isIdentifier(e.callee.property) &&
      e.callee.property.name === "addEventListener"
    )
      continue;
    return;
  }
  if (result.postExprs?.length) {
    const data = path.scope.getProgramParent().data as ProgramScopeData;
    const moduleName = getRendererConfig(path, "dom").moduleName;
    const rheUid = data.imports?.get(`${moduleName}:runHydrationEvents`);
    for (const stmt of result.postExprs) {
      if (
        !t.isExpressionStatement(stmt) ||
        !t.isCallExpression(stmt.expression) ||
        !t.isIdentifier(stmt.expression.callee) ||
        !rheUid ||
        stmt.expression.callee.name !== rheUid.name
      )
        return;
    }
  }

  const data = path.scope.getProgramParent().data as ProgramScopeData;
  (data.pureRows || (data.pureRows = new Set())).add(fn);
}

/** Patch-mode emission (shared/patch.ts): one compiled body doing inline
 * compares + setAttr writes, handed to the runtime driver which registers
 * on the store patch channel (patchable subject) or falls back to a
 * tracked force-mode effect running the SAME body. Returns undefined when
 * the scope is ineligible — caller falls through to the effect shapes.
 * The subject rides along for row-proof analysis (recordPureRow). */
function wrapPatchMode(
  path: NodePath,
  dynamics: DynamicBinding[]
): { stmt: t.Statement; subject: string } | undefined {
  const config = getConfig(path);
  if (dynamics.length === 0) return;
  const eligibility = analyzePatchEligibility(dynamics.map(d => d.value as t.Expression));
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
  const nId = t.identifier("_n$");
  const pId = t.identifier("_p$");
  const fId = t.identifier("_f$");
  const stmts: t.Statement[] = [];
  let vIndex = 0;
  for (const d of dynamics) {
    let value = d.value as t.Expression;
    if (d.classProperty && !t.isBooleanLiteral(value) && !t.isUnaryExpression(value)) {
      value = t.unaryExpression("!", t.unaryExpression("!", value));
    }
    const vId = t.identifier(++vIndex === 1 ? "_v$" : `_v$${vIndex}`);
    stmts.push(
      t.variableDeclaration("const", [
        t.variableDeclarator(vId, substituteSubject(value, subject, nId))
      ])
    );
    stmts.push(
      t.ifStatement(
        t.logicalExpression(
          "||",
          t.cloneNode(fId),
          t.binaryExpression("!==", t.cloneNode(vId), substituteSubject(value, subject, pId))
        ),
        t.expressionStatement(
          setAttr(path, d.elem, d.key, t.cloneNode(vId), {
            tagName: d.tagName,
            dynamic: true,
            styleProperty: d.styleProperty,
            classProperty: d.classProperty
          })
        )
      )
    );
  }
  const driverId = registerImportMethod(path, config.patchDriver as string, undefined);
  return {
    stmt: t.expressionStatement(
      t.callExpression(driverId, [
        t.identifier(subject),
        t.arrowFunctionExpression([nId, pId, fId], t.blockStatement(stmts))
      ])
    ),
    subject
  };
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
