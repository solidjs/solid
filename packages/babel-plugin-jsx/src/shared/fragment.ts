import * as t from "@babel/types";
import { decode } from "html-entities";
import { filterChildren, trimWhitespace, checkLength } from "./utils";
import { transformNode, getCreateTemplate } from "./transform";
import type { NodePath } from "@babel/traverse";
import type { JSXDOMExpressionsConfig } from "../config";
import type { JSXNode, TransformResult } from "../types";

export default function transformFragmentChildren(
  children: NodePath<JSXNode>[],
  results: TransformResult,
  config: JSXDOMExpressionsConfig
) {
  const filteredChildren = filterChildren(children),
    childNodes = filteredChildren.reduce((memo: t.Expression[], path: NodePath<JSXNode>) => {
      if (t.isJSXText(path.node)) {
        const v = decode(trimWhitespace((path.node.extra?.raw as string | undefined) ?? ""));
        if (v.length) memo.push(t.stringLiteral(v));
      } else {
        const child = transformNode(path, {
          topLevel: true,
          fragmentChild: true,
          lastElement: true
        });
        if (child)
          memo.push(
            getCreateTemplate(config, path, child as TransformResult)(
              path,
              child as TransformResult,
              true
            ) as t.Expression
          );
      }
      return memo;
    }, []);
  results.exprs.push(childNodes.length === 1 ? childNodes[0] : t.arrayExpression(childNodes));
}
