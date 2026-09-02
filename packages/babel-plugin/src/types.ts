import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import type { PluginConfig, RendererName } from "./config";

export interface PluginPass {
  opts: Partial<PluginConfig>;
  skip?: boolean;
}

export interface TemplateRecord {
  id: t.Identifier;
  template: string | t.Expression | t.ArrayExpression;
  templateWithClosingTags?: string | t.Expression | t.ArrayExpression;
  isImportNode?: boolean;
  isWrapped?: boolean;
  renderer: RendererName;
  /** First registration site, so `validate` failures point at the JSX (#3099). */
  path?: NodePath;
}

export interface ProgramScopeData {
  imports?: Map<string, t.Identifier>;
  templates?: TemplateRecord[];
  events?: Set<string>;
}

export interface TsrxStyleResult {
  css: string;
  cssHash: string | null;
}

export type TsrxBabelAst = t.File & {
  tsrxStyle?: TsrxStyleResult;
};

export type BabelFileWithMetadata = {
  ast: TsrxBabelAst;
  metadata: {
    config?: PluginConfig;
    css?: string;
    cssHash?: string | null;
  };
};

export type BabelHubWithMetadata = {
  file: BabelFileWithMetadata;
};

export type TemplateResult = string | string[] | t.Expression | t.ArrayExpression;
export type ResultDeclaration = t.VariableDeclarator | t.Statement | null;
export type ResultExpression = t.Expression | t.Statement;
export type ResultTemplateValue = t.Expression;
export type ResultPostDeclaration = t.VariableDeclarator;
export type ResultPostExpression = t.Statement;
export type JSXNode =
  | t.JSXElement
  | t.JSXFragment
  | t.JSXText
  | t.JSXExpressionContainer
  | t.JSXSpreadChild;

export interface TransformResult {
  template: TemplateResult;
  templateValues?: ResultTemplateValue[];
  declarations: ResultDeclaration[];
  postDeclarations?: ResultPostDeclaration[];
  exprs: ResultExpression[];
  dynamics: DynamicBinding[];
  postExprs?: ResultPostExpression[];
  decl?: t.VariableDeclaration;
  id?: t.Identifier;
  text?: boolean;
  dynamic?: boolean;
  wontEscape?: boolean;
  tagName?: string;
  renderer?: RendererName;
  isImportNode?: boolean;
  isWrapped?: boolean;
  skipTemplate?: boolean;
  templateWithClosingTags?: string;
  children?: TransformResult[];
  spreadElement?: boolean;
  groupable?: Set<string>;
  groupId?: t.Identifier;
}

export type TransformNodeResult = TransformResult | null | undefined;

export interface UniversalTransformResult extends TransformResult {
  template: "";
  id: t.Identifier;
  tagName: string;
  renderer: "universal";
  declarations: t.VariableDeclarator[];
  exprs: t.Statement[];
  postExprs: t.Statement[];
}

export interface DOMTransformResult extends TransformResult {
  template: string;
  templateWithClosingTags: string;
  tagName: string;
  renderer: "dom";
  declarations: t.VariableDeclarator[];
  exprs: t.Statement[];
  dynamics: DynamicBinding[];
  postExprs: t.Statement[];
  toBeClosed?: Set<string>;
  hasHydratableEvent?: boolean;
}

export interface SSRTransformResult extends TransformResult {
  template: string[];
  templateValues: t.Expression[];
  declarations: Array<t.VariableDeclarator | null>;
  postDeclarations: t.VariableDeclarator[];
  exprs: t.Expression[];
  renderer: "ssr";
  tagName: string;
  wontEscape?: boolean;
}

export interface DynamicBinding {
  elem: t.Expression;
  key: string;
  value: t.Expression;
  tagName?: string;
  styleProperty?: boolean;
  classProperty?: boolean;
}

export interface SetAttrOptions {
  tagName?: string;
  dynamic?: boolean;
  prevId?: t.Expression;
  styleProperty?: boolean;
  classProperty?: boolean;
}

export interface DynamicOptions {
  checkMember?: boolean;
  checkTags?: boolean;
  checkCallExpressions?: boolean;
  native?: boolean;
}

export interface TransformInfo {
  topLevel?: boolean;
  lastElement?: boolean;
  fragmentChild?: boolean;
  componentChild?: boolean;
  doNotEscape?: boolean;
  /** Child of a universal-rendered element: text feeds the host's
   * createTextNode, so it is never HTML-escaped and JSX entities decode
   * (#3127). Element-scoped because dynamic mode mixes renderers. */
  universal?: boolean;
  skipId?: boolean;
  toBeClosed?: Set<string>;
  parentResults?: TransformResult;
  hydratable?: boolean;
}

export type BabelPath<TNode extends t.Node = t.Node> = NodePath<TNode>;
