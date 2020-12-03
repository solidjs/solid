import * as t from "@babel/types";
import config from "../config";
import { filterChildren, trimWhitespace } from "./utils";
import { transformNode } from "./transform";
import { createTemplate as createTemplateDOM } from "../dom/template";
import { createTemplate as createTemplateSSR } from "../ssr/template";

export default function transformFragmentChildren(children, results) {
  const createTemplate = config.generate === "ssr" ? createTemplateSSR : createTemplateDOM,
    filteredChildren = filterChildren(children),
    singleChild = filteredChildren.length === 1,
    childNodes = filteredChildren.map(path => {
      if (t.isJSXText(path.node)) return t.stringLiteral(trimWhitespace(path.node.extra.raw));
      const child = transformNode(path, { topLevel: true, fragmentChild: true });
      return createTemplate(path, child, !singleChild);
    });
  results.exprs.push(singleChild ? childNodes[0] : t.arrayExpression(childNodes));
}
