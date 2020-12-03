import * as t from "@babel/types";
import { registerImportMethod } from "../shared/utils";

export function createTemplate(path, result) {
  if (!result.template) {
    return result.exprs[0];
  }

  // uncomment to optimize non-hoisted, needs more thorough testing
  // if (!config.async) {
  //   if (!Array.isArray(result.template)) return t.stringLiteral(result.template);
  //   if (result.template.length === 1) return t.stringLiteral(result.template[0]);
  //   const quasis = result.template.map(tmpl => t.TemplateElement({ raw: tmpl }));
  //   return t.TemplateLiteral(quasis, result.templateValues);
  // }

  registerImportMethod(path, "ssr");
  if (!Array.isArray(result.template))
    return t.callExpression(t.identifier(`_$ssr`), [t.stringLiteral(result.template)]);
  if (result.template.length === 1)
    return t.callExpression(t.identifier(`_$ssr`), [t.stringLiteral(result.template[0])]);
  const strings = result.template.map(tmpl => t.stringLiteral(tmpl));
  return t.callExpression(t.identifier(`_$ssr`), [
    t.arrayExpression(strings),
    ...result.templateValues
  ]);
}
