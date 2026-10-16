import * as t from "@babel/types";
import { decode } from "html-entities";
import { filterChildren, trimWhitespace, checkLength } from "./utils";
import { transformNode, getCreateTemplate } from "./transform";
import { VoidElements } from "../../../web/src/constants.js";
import type { NodePath } from "@babel/traverse";
import type { PluginConfig } from "../config";
import type { JSXNode, TransformResult } from "../types";

type FragmentTemplate = {
  path: NodePath<JSXNode>;
  result: TransformResult;
};

function isMergeableStaticDOMTemplate(result: TransformResult, config: PluginConfig) {
  return (
    !config.hydratable &&
    result.renderer === "dom" &&
    !!result.id &&
    !!result.tagName &&
    typeof result.template === "string" &&
    !result.skipTemplate &&
    !result.isWrapped &&
    result.declarations.length === 0 &&
    result.exprs.length === 0 &&
    result.dynamics.length === 0 &&
    !result.postExprs?.length
  );
}

function closeRootTemplate(result: TransformResult) {
  const template = result.template as string;
  const close = `</${result.tagName}>`;
  return VoidElements.has(result.tagName!) || template.endsWith(close)
    ? template
    : template + close;
}

function createFragmentTemplate(templates: FragmentTemplate[], config: PluginConfig): t.Expression {
  if (templates.length === 1) {
    const { path, result } = templates[0];
    return getCreateTemplate(config, path, result)(path, result, true) as t.Expression;
  }

  const first = templates[0];
  const result: TransformResult = {
    template: templates.map(({ result }) => closeRootTemplate(result)).join(""),
    templateWithClosingTags: templates
      .map(({ result }) => result.templateWithClosingTags || result.template)
      .join(""),
    declarations: [],
    exprs: [],
    dynamics: [],
    postExprs: [],
    id: first.result.id,
    tagName: first.result.tagName,
    renderer: "dom",
    isImportNode: templates.some(({ result }) => result.isImportNode),
    isMultiRoot: true
  };
  return getCreateTemplate(config, first.path, result)(first.path, result, true) as t.Expression;
}

export default function transformFragmentChildren(
  children: NodePath<JSXNode>[],
  results: TransformResult,
  config: PluginConfig
) {
  const filteredChildren = filterChildren(children),
    childNodes: t.Expression[] = [];
  let templates: FragmentTemplate[] = [];
  const flushTemplates = () => {
    if (!templates.length) return;
    childNodes.push(createFragmentTemplate(templates, config));
    templates = [];
  };

  filteredChildren.forEach((path: NodePath<JSXNode>) => {
    if (t.isJSXText(path.node)) {
      flushTemplates();
      const v = decode(trimWhitespace((path.node.extra?.raw as string | undefined) ?? ""));
      if (v.length) childNodes.push(t.stringLiteral(v));
    } else {
      const child = transformNode(path, {
        topLevel: true,
        fragmentChild: true,
        lastElement: true
      });
      if (!child) return;
      if (isMergeableStaticDOMTemplate(child, config)) {
        templates.push({ path, result: child });
        return;
      }
      flushTemplates();
      childNodes.push(getCreateTemplate(config, path, child)(path, child, true) as t.Expression);
    }
  });
  flushTemplates();
  results.exprs.push(childNodes.length === 1 ? childNodes[0] : t.arrayExpression(childNodes));
}
