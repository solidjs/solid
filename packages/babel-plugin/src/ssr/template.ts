import * as t from "@babel/types";
import { getConfig, isStatementVariableInitializer, registerImportMethod } from "../shared/utils";
import type { NodePath } from "@babel/traverse";
import type { ProgramScopeData, SkipRecord, TemplateRecord, TransformResult } from "../types";

type SSRDeclarator = t.VariableDeclarator & { id: t.LVal; init: t.Expression };

export function createTemplate(
  path: NodePath,
  result: TransformResult,
  wrap: boolean
): t.Expression {
  if (!result.template) {
    // `wrap` is true for fragment children and for mixed component children.
    // Both are VALUES — they flow to whatever hole eventually inserts them,
    // and that hole's `_$escape` covers everything reachable from the value:
    // strings, array items, and what a function (this memo) yields when the
    // resolver calls it. Escaping here as well double-escapes through
    // `<Comp>{props.children}</Comp>`. The memo exists for hydration-id
    // alignment with the client, not for escaping.
    if (wrap && result.dynamic && getConfig(path).memoWrapper) {
      return t.callExpression(
        registerImportMethod(path, getConfig(path).memoWrapper as string, undefined),
        [result.exprs[0] as t.Expression]
      );
    }
    return result.exprs[0] as t.Expression;
  }

  let template, id;

  if (!Array.isArray(result.template)) {
    template = t.stringLiteral(result.template as string);
  } else if (result.template.length === 1) {
    template = t.stringLiteral(result.template[0]);
  } else {
    const strings = result.template.map((tmpl: string) => t.stringLiteral(tmpl));
    template = t.arrayExpression(strings);
  }

  const data = path.scope.getProgramParent().data as ProgramScopeData;
  const templates = data.templates || (data.templates = []);
  const found = templates.find(tmp => {
    const candidate = tmp.template;
    if (
      typeof candidate !== "string" &&
      t.isArrayExpression(candidate) &&
      t.isArrayExpression(template)
    ) {
      return candidate.elements.every(
        (el, i) =>
          t.isStringLiteral(el) &&
          t.isStringLiteral(template.elements[i]) &&
          el.value === template.elements[i].value
      );
    }
    return typeof candidate !== "string" &&
      t.isStringLiteral(candidate) &&
      t.isStringLiteral(template)
      ? candidate.value === template.value
      : false;
  });
  if (!found) {
    id = path.scope.generateUidIdentifier("tmpl$");
    templates.push({
      id,
      template,
      templateWithClosingTags: template,
      renderer: "ssr"
    });
  } else id = found.id;

  if (result.wontEscape) {
    if (!Array.isArray(result.template) || result.template.length === 1) return id;
    else if (
      Array.isArray(result.template) &&
      result.template.length === 2 &&
      t.isCallExpression(result.templateValues?.[0]) &&
      t.isIdentifier(result.templateValues[0].callee, { name: "_$ssrHydrationKey" })
    ) {
      // remove unnecessary ssr call when only hydration key is used
      return t.binaryExpression(
        "+",
        t.binaryExpression(
          "+",
          t.memberExpression(id, t.numericLiteral(0), true),
          result.templateValues[0]
        ),
        t.memberExpression(id, t.numericLiteral(1), true)
      );
    }
  }

  const ssrCall = t.callExpression(
    registerImportMethod(path, "ssr", undefined),
    Array.isArray(result.template) && result.template.length > 1
      ? [id, ...(result.templateValues ?? [])]
      : [id]
  );

  const declarators = [...result.declarations, ...(result.postDeclarations ?? [])].filter(
    (declaration): declaration is SSRDeclarator =>
      !!declaration &&
      t.isVariableDeclarator(declaration) &&
      !!declaration.init &&
      t.isExpression(declaration.init)
  );
  if (!declarators.length) return ssrCall;

  // IIFE-free emission — declarations live outside the `ssr(...)` call to
  // save one closure allocation + one function-call frame per render.
  // Two shapes depending on JSX position:
  //
  //   - Statement positions (`return <jsx/>;`, `const x = <jsx/>;`):
  //     emit a single combined `var _v$ = init1, _v$2 = init2;`
  //     statement before the parent. `var` declarations hoist to the
  //     enclosing function so semantics match the old IIFE form.
  //
  //   - Expression positions (ternary branches, array elements, function
  //     args, logical operators): hoist bare `var _v$;` declarations to
  //     the enclosing function scope via `path.scope.push`, and emit a
  //     comma sequence expression `(_v$ = init, ssr(...))` at the JSX
  //     site. The hoist is required — JS forbids `var` declarations
  //     inside expressions — and the assignment must stay inline so its
  //     side effects fire only when the surrounding control-flow gate
  //     selects this branch.
  const isReturnArg = t.isReturnStatement(path.parent) && path.parent.argument === path.node;
  const isVarInit = isStatementVariableInitializer(path);

  if (isReturnArg || isVarInit) {
    path.getStatementParent()?.insertBefore(
      t.variableDeclaration(
        "var",
        declarators.map(d => t.variableDeclarator(d.id, d.init))
      )
    );
    return ssrCall;
  }

  for (const d of declarators) path.scope.push({ id: d.id, kind: "var" });
  return t.sequenceExpression([
    ...declarators.map(d => t.assignmentExpression("=", d.id, d.init)),
    ssrCall
  ]);
}

export function appendTemplates(path: NodePath<t.Program>, templates: TemplateRecord[]) {
  const declarators = templates.map(template => {
    return t.variableDeclarator(template.id, template.template as t.Expression);
  });
  path.node.body.unshift(t.variableDeclaration("var", declarators));
}

/**
 * The `skip` predicate of an `ssrElement` call whose static tail attributes
 * were baked into its attribute string (ssr/element.ts `createElement`):
 * `k => k === "a" || k === "b"` over the baked keys, so the spread's own
 * copies of them are never read or emitted. Hoisted to the module like a
 * template — one function per distinct key set, shared by every element that
 * bakes the same keys — so the call site allocates nothing per render.
 */
export function registerSkip(path: NodePath, keys: string[]): t.Identifier {
  const data = path.scope.getProgramParent().data as ProgramScopeData;
  const skips = data.ssrSkips || (data.ssrSkips = []);
  const key = keys.join("\0");
  const found = skips.find(s => s.key === key);
  if (found) return found.id;
  const id = path.scope.generateUidIdentifier("sk$");
  const k = t.identifier("k");
  let test: t.Expression = t.binaryExpression("===", k, t.stringLiteral(keys[0]));
  for (let i = 1; i < keys.length; i++) {
    test = t.logicalExpression("||", test, t.binaryExpression("===", k, t.stringLiteral(keys[i])));
  }
  skips.push({ key, id, predicate: t.arrowFunctionExpression([t.identifier("k")], test) });
  return id;
}

export function appendSkips(path: NodePath<t.Program>, skips: SkipRecord[]) {
  path.node.body.unshift(
    t.variableDeclaration(
      "var",
      skips.map(s => t.variableDeclarator(s.id, s.predicate))
    )
  );
}
