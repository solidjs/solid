import * as t from "@babel/types";
import { getRendererConfig, registerImportMethod } from "./utils";
import { appendTemplates as appendTemplatesDOM } from "../dom/template";
import { appendTemplates as appendTemplatesSSR } from "../ssr/template";
import { isInvalidMarkup } from "./validate";
import type { NodePath } from "@babel/traverse";
import type { BabelHubWithMetadata, JSXDOMExpressionsPass, ProgramScopeData } from "../types";

// add to the top/bottom of the module.
export default (path: NodePath<t.Program>, state: JSXDOMExpressionsPass) => {
  if (state.skip) return;

  const data = path.scope.data as ProgramScopeData;
  const config = (path.hub as unknown as BabelHubWithMetadata).file.metadata.config;
  if (!config) return;

  if (data.events) {
    path.node.body.push(
      t.expressionStatement(
        t.callExpression(
          registerImportMethod(path, "delegateEvents", getRendererConfig(path, "dom").moduleName),
          [t.arrayExpression(Array.from(data.events).map(e => t.stringLiteral(e)))]
        )
      )
    );
  }
  if (data.templates?.length) {
    if (config.validate) {
      for (const template of data.templates) {
        const html = template.templateWithClosingTags;
        // not sure when/why this is not a string
        if (typeof html === "string") {
          const result = isInvalidMarkup(html);
          if (result) {
            const message =
              "\nThe HTML provided is malformed and will yield unexpected output when evaluated by a browser.\n";
            console.warn(message);
            console.warn("User HTML:\n", result.html);
            console.warn("Browser HTML:\n", result.browser);
            console.warn("Original HTML:\n", html);
            // throw path.buildCodeFrameError();
          }
        }
      }
    }
    let domTemplates = data.templates.filter(temp => temp.renderer === "dom");
    let ssrTemplates = data.templates.filter(temp => temp.renderer === "ssr");
    domTemplates.length > 0 && appendTemplatesDOM(path, domTemplates);
    ssrTemplates.length > 0 && appendTemplatesSSR(path, ssrTemplates);
  }

  // Compile-time row proofs (DESIGN-PATCH-CHANNEL §3c): wrap each function
  // recorded by recordPureRow with the runtime's `rowProof` marker so the
  // patch-mode list driver can engage on proven-pure rows — admission is
  // decided here, statically; there is no runtime purity probe. The stamp
  // travels with the function object, so extracted row functions qualify at
  // their definition site.
  if (data.pureRows?.size) {
    const rowProofId = registerImportMethod(
      path,
      "rowProof",
      getRendererConfig(path, "dom").moduleName
    );
    const pureRows = data.pureRows;
    path.traverse({
      "ArrowFunctionExpression|FunctionExpression"(fnPath) {
        if (!pureRows.has(fnPath.node as any)) return;
        pureRows.delete(fnPath.node as any);
        fnPath.replaceWith(
          t.callExpression(t.cloneNode(rowProofId), [fnPath.node as t.Expression])
        );
        fnPath.skip();
      }
    });
  }
};
