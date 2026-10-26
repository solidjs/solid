/**
 * ESTree (acorn / typescript-eslint shaped, as produced by `@tsrx/core`) to
 * Babel AST conversion.
 *
 * Purely mechanical: no TSRX node may reach this pass (the desugarer lowers
 * them all first), and unknown shapes fail closed rather than producing a
 * silently wrong tree. Location info (`start`/`end`/`loc`) is preserved for
 * sourcemaps. Comments are not attached in v1 (documented limitation).
 */

import type * as t from "@babel/types";
import type { EsNode } from "./desugar";

/** ESTree/TSRX bookkeeping keys with no Babel equivalent. */
const STRIP_KEYS = new Set([
  "type",
  "start",
  "end",
  "loc",
  "range",
  "metadata",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "alternateKeyword",
  "emptyKeyword",
  "isDynamic",
  "statementType",
  "resetParam",
  "lazy",
  "directive"
]);

/** Which Babel AST shape to emit. Babel 8 keeps `typeArguments`,
 * `ImportExpression`, Identifier type-parameter names and `TSEnumBody`;
 * Babel 7 wants the older forms. Set for the length of one `toBabelFile`. */
let babel8 = false;

/** The key Babel expects for a node's type arguments. */
function typeArgsKey(): string {
  return babel8 ? "typeArguments" : "typeParameters";
}

function isNode(value: unknown): value is EsNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function fail(message: string, node: EsNode): never {
  const start = (node.loc as { start?: { line: number; column: number } } | undefined)?.start;
  throw new SyntaxError(start ? `${message} (${start.line}:${start.column})` : message);
}

function copyLoc(from: EsNode, to: Record<string, unknown>): void {
  if (from.start !== undefined) to.start = from.start;
  if (from.end !== undefined) to.end = from.end;
  if (from.loc !== undefined) to.loc = from.loc;
}

function convertValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(convertValue);
  if (isNode(value)) return convertNode(value);
  return value;
}

/** Shallow-map every kept key, renaming typescript-eslint's `typeArguments`
 * to Babel 7's `typeParameters` along the way (Babel 8 keeps the name). */
function convertGeneric(node: EsNode, overrideType?: string): EsNode {
  const out: Record<string, unknown> = { type: overrideType ?? node.type };
  copyLoc(node, out);
  for (const key of Object.keys(node)) {
    if (STRIP_KEYS.has(key)) continue;
    const outKey =
      !babel8 && key === "typeArguments" && node.typeParameters === undefined
        ? "typeParameters"
        : key;
    out[outKey] = convertValue(node[key]);
  }
  return out as EsNode;
}

/** Convert a node whose type arguments typescript-eslint spells
 * `typeParameters`, moving them to the key the target Babel expects. */
function convertTypeArgsHolder(node: EsNode, type: string): EsNode {
  const out = convertGeneric(node, type) as Record<string, unknown>;
  const args = out.typeParameters ?? out.typeArguments;
  delete out.typeParameters;
  delete out.typeArguments;
  if (args !== undefined) out[typeArgsKey()] = args;
  return out as EsNode;
}

function convertLiteral(node: EsNode): EsNode {
  const out: Record<string, unknown> = {};
  copyLoc(node, out);
  const regex = node.regex as { pattern: string; flags: string } | undefined;
  if (regex) {
    out.type = "RegExpLiteral";
    out.pattern = regex.pattern;
    out.flags = regex.flags;
    return out as EsNode;
  }
  if (node.bigint !== undefined && node.bigint !== null) {
    out.type = "BigIntLiteral";
    out.value = node.bigint;
    return out as EsNode;
  }
  const value = node.value;
  if (value === null) {
    out.type = "NullLiteral";
    return out as EsNode;
  }
  switch (typeof value) {
    case "string":
      out.type = "StringLiteral";
      break;
    case "number":
      out.type = "NumericLiteral";
      break;
    case "boolean":
      out.type = "BooleanLiteral";
      break;
    default:
      return fail(`Unsupported literal value type: ${typeof value}`, node);
  }
  out.value = value;
  if (typeof node.raw === "string") out.extra = { raw: node.raw, rawValue: value };
  return out as EsNode;
}

function extractDirectives(body: EsNode[]): { directives: EsNode[]; rest: EsNode[] } {
  const directives: EsNode[] = [];
  let i = 0;
  while (i < body.length) {
    const stmt = body[i];
    if (stmt.type !== "ExpressionStatement" || typeof stmt.directive !== "string") break;
    const expr = stmt.expression as EsNode;
    const literal: Record<string, unknown> = {
      type: "DirectiveLiteral",
      value: expr.value
    };
    copyLoc(expr, literal);
    if (typeof expr.raw === "string") literal.extra = { raw: expr.raw, rawValue: expr.value };
    const directive: Record<string, unknown> = { type: "Directive", value: literal };
    copyLoc(stmt, directive);
    directives.push(directive as EsNode);
    i++;
  }
  return { directives, rest: body.slice(i) };
}

function convertFunctionParts(fn: EsNode, out: Record<string, unknown>): void {
  out.params = convertValue(fn.params);
  out.body = convertValue(fn.body);
  out.generator = !!fn.generator;
  out.async = !!fn.async;
  if (fn.returnType !== undefined) out.returnType = convertValue(fn.returnType);
  if (fn.typeParameters !== undefined) out.typeParameters = convertValue(fn.typeParameters);
}

/** Convert an optional chain, dropping the ESTree `ChainExpression` wrapper
 * and switching member/call links to Babel's `Optional*` node types. */
function convertChainLink(node: EsNode): EsNode {
  switch (node.type) {
    case "MemberExpression": {
      const out: Record<string, unknown> = {
        type: "OptionalMemberExpression",
        object: convertChainLink(node.object as EsNode),
        property: convertValue(node.property),
        computed: !!node.computed,
        optional: !!node.optional
      };
      copyLoc(node, out);
      return out as EsNode;
    }
    case "CallExpression": {
      const out: Record<string, unknown> = {
        type: "OptionalCallExpression",
        callee: convertChainLink(node.callee as EsNode),
        arguments: convertValue(node.arguments),
        optional: !!node.optional
      };
      copyLoc(node, out);
      if (node.typeParameters !== undefined || node.typeArguments !== undefined) {
        out[typeArgsKey()] = convertValue(node.typeParameters ?? node.typeArguments);
      }
      return out as EsNode;
    }
    case "TSNonNullExpression": {
      const out: Record<string, unknown> = {
        type: "TSNonNullExpression",
        expression: convertChainLink(node.expression as EsNode)
      };
      copyLoc(node, out);
      return out as EsNode;
    }
    default:
      return convertNode(node);
  }
}

function convertNode(node: EsNode): EsNode {
  switch (node.type) {
    case "Program": {
      const { directives, rest } = extractDirectives(node.body as EsNode[]);
      const out: Record<string, unknown> = {
        type: "Program",
        sourceType: node.sourceType ?? "module",
        interpreter: null,
        body: rest.map(convertNode),
        directives
      };
      copyLoc(node, out);
      return out as EsNode;
    }

    case "BlockStatement": {
      const { directives, rest } = extractDirectives(node.body as EsNode[]);
      const out: Record<string, unknown> = {
        type: "BlockStatement",
        body: rest.map(convertNode),
        directives
      };
      copyLoc(node, out);
      return out as EsNode;
    }

    case "Literal":
      return convertLiteral(node);

    case "Property": {
      const kind = node.kind as string | undefined;
      if (kind === "get" || kind === "set" || node.method) {
        const fn = node.value as EsNode;
        const out: Record<string, unknown> = {
          type: "ObjectMethod",
          kind: node.method ? "method" : kind,
          key: convertValue(node.key),
          computed: !!node.computed
        };
        copyLoc(node, out);
        convertFunctionParts(fn, out);
        return out as EsNode;
      }
      const out: Record<string, unknown> = {
        type: "ObjectProperty",
        key: convertValue(node.key),
        value: convertValue(node.value),
        computed: !!node.computed,
        shorthand: !!node.shorthand
      };
      copyLoc(node, out);
      return out as EsNode;
    }

    case "MethodDefinition": {
      const fn = node.value as EsNode;
      const isPrivate = (node.key as EsNode).type === "PrivateIdentifier";
      const out: Record<string, unknown> = {
        type: isPrivate ? "ClassPrivateMethod" : "ClassMethod",
        kind: node.kind,
        key: convertValue(node.key),
        computed: !!node.computed,
        static: !!node.static
      };
      copyLoc(node, out);
      convertFunctionParts(fn, out);
      if (node.typeParameters != null && out.typeParameters === undefined) {
        out.typeParameters = convertValue(node.typeParameters);
      }
      if (node.accessibility !== undefined) out.accessibility = node.accessibility;
      if (node.override !== undefined) out.override = node.override;
      if (node.optional !== undefined) out.optional = node.optional;
      return out as EsNode;
    }

    case "PropertyDefinition": {
      const isPrivate = (node.key as EsNode).type === "PrivateIdentifier";
      const out: Record<string, unknown> = {
        type: isPrivate ? "ClassPrivateProperty" : "ClassProperty",
        key: convertValue(node.key),
        value: node.value == null ? null : convertValue(node.value),
        computed: !!node.computed,
        static: !!node.static
      };
      copyLoc(node, out);
      for (const key of [
        "typeAnnotation",
        "declare",
        "readonly",
        "accessibility",
        "optional",
        "definite",
        "override"
      ]) {
        if (node[key] !== undefined) out[key] = convertValue(node[key]);
      }
      return out as EsNode;
    }

    case "PrivateIdentifier": {
      const id: Record<string, unknown> = { type: "Identifier", name: node.name };
      copyLoc(node, id);
      const out: Record<string, unknown> = { type: "PrivateName", id };
      copyLoc(node, out);
      return out as EsNode;
    }

    case "ChainExpression":
      return convertChainLink(node.expression as EsNode);

    case "ImportExpression": {
      // `@tsrx/core` puts the options object in `arguments[0]`; acorn uses `options`.
      const options = node.options ?? (node.arguments as EsNode[] | undefined)?.[0];
      if (babel8) {
        const out: Record<string, unknown> = {
          type: "ImportExpression",
          source: convertValue(node.source),
          options: options != null ? convertValue(options) : null
        };
        if (node.phase != null) out.phase = node.phase;
        copyLoc(node, out);
        return out as EsNode;
      }
      const importCallee: Record<string, unknown> = { type: "Import" };
      copyLoc(node, importCallee);
      const args: unknown[] = [convertValue(node.source)];
      if (options != null) args.push(convertValue(options));
      const out: Record<string, unknown> = {
        type: "CallExpression",
        callee: importCallee,
        arguments: args
      };
      copyLoc(node, out);
      return out as EsNode;
    }

    case "JSXText": {
      const out: Record<string, unknown> = { type: "JSXText", value: node.value };
      copyLoc(node, out);
      if (typeof node.raw === "string") out.extra = { raw: node.raw, rawValue: node.value };
      return out as EsNode;
    }

    case "TSTypeParameter": {
      const out = convertGeneric(node) as Record<string, unknown>;
      if (babel8) {
        if (typeof out.name === "string") {
          const id: Record<string, unknown> = { type: "Identifier", name: out.name };
          copyLoc(node, id);
          out.name = id;
        }
      } else if (isNode(out.name)) out.name = (out.name as unknown as { name: string }).name;
      return out as EsNode;
    }

    case "TSInterfaceHeritage":
      return convertTypeArgsHolder(
        node,
        babel8 ? "TSInterfaceHeritage" : "TSExpressionWithTypeArguments"
      );

    // `implements` entries arrive in the pre-split typescript-eslint shape.
    case "TSExpressionWithTypeArguments":
    case "TSClassImplements":
      return convertTypeArgsHolder(
        node,
        babel8 ? "TSClassImplements" : "TSExpressionWithTypeArguments"
      );

    case "ClassDeclaration":
    case "ClassExpression": {
      const out = convertGeneric(node) as Record<string, unknown>;
      const superArgs = out.superTypeParameters ?? out.superTypeArguments;
      delete out.superTypeParameters;
      delete out.superTypeArguments;
      if (superArgs !== undefined) {
        out[babel8 ? "superTypeArguments" : "superTypeParameters"] = superArgs;
      }
      return out as EsNode;
    }

    case "TSInterfaceDeclaration": {
      const out = convertGeneric(node) as Record<string, unknown>;
      // Interface heritage can arrive in the class-implements shape.
      if (babel8 && Array.isArray(out.extends)) {
        for (const heritage of out.extends as Record<string, unknown>[]) {
          heritage.type = "TSInterfaceHeritage";
        }
      }
      return out as EsNode;
    }

    case "TSImportType": {
      const out = convertGeneric(node) as Record<string, unknown>;
      if (babel8 && out.argument !== undefined) {
        out.source = out.argument;
        delete out.argument;
      }
      return out as EsNode;
    }

    case "TSEnumDeclaration": {
      const out = convertGeneric(node) as Record<string, unknown>;
      if (babel8 && out.body === undefined) {
        const body: Record<string, unknown> = { type: "TSEnumBody", members: out.members };
        delete out.members;
        out.body = body;
      }
      return out as EsNode;
    }

    case "TSAbstractMethodDefinition":
    case "TSAbstractPropertyDefinition":
    case "TSParameterProperty":
      return fail(`Unsupported TypeScript construct in TSRX source: ${node.type}`, node);

    case "JSXCodeBlock":
    case "JSXIfExpression":
    case "JSXForExpression":
    case "JSXSwitchExpression":
    case "JSXTryExpression":
    case "JSXStyleElement":
      return fail(
        `TSRX node ${node.type} survived desugaring; this is a bug in the frontend`,
        node
      );

    default:
      return convertGeneric(node);
  }
}

export function toBabelFile(program: EsNode, babelMajor = 7): t.File {
  babel8 = babelMajor >= 8;
  try {
    const file: Record<string, unknown> = {
      type: "File",
      program: convertNode(program),
      comments: [],
      tokens: []
    };
    copyLoc(program, file);
    return file as unknown as t.File;
  } finally {
    babel8 = false;
  }
}
