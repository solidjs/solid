import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import type { JSXDOMExpressionsConfig, RendererName } from "./config";

export interface JSXDOMExpressionsPass {
  opts: Partial<JSXDOMExpressionsConfig>;
  skip?: boolean;
}

export interface TemplateRecord {
  id: t.Identifier;
  template: string | t.Expression | t.ArrayExpression;
  templateWithClosingTags?: string | t.Expression | t.ArrayExpression;
  isImportNode?: boolean;
  isWrapped?: boolean;
  renderer: RendererName;
}

export interface ProgramScopeData {
  imports?: Map<string, t.Identifier>;
  templates?: TemplateRecord[];
  events?: Set<string>;
  /** Row functions proven pure at compile time (DESIGN-PATCH-CHANNEL §3c):
   * single-param functions whose body is exactly one compiled template with
   * no reactive or owned work — every dynamic landed in one patchDriver on
   * the param itself. Wrapped with `rowProof` at program exit so the list
   * driver can engage without the (removed) runtime purity probe. */
  pureRows?: Set<t.ArrowFunctionExpression | t.FunctionExpression>;
}

export type BabelFileWithMetadata = {
  ast: t.File;
  metadata: {
    config?: JSXDOMExpressionsConfig;
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
  skipId?: boolean;
  toBeClosed?: Set<string>;
  parentResults?: TransformResult;
  hydratable?: boolean;
}

export type BabelPath<TNode extends t.Node = t.Node> = NodePath<TNode>;
