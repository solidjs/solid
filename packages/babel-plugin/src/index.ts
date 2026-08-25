import SyntaxJSX from "@babel/plugin-syntax-jsx";
import { transformJSX } from "./shared/transform";
import postprocess from "./shared/postprocess";
import preprocess from "./shared/preprocess";
import { isTsrxSource, parseTsrx, type SyntaxOption } from "./tsrx";
import type * as t from "@babel/types";
import type { Visitor } from "@babel/traverse";
import type { PluginPass } from "./types";

type JSXPluginSyntax = {
  manipulateOptions(opts: unknown, parserOpts: { plugins: string[] }): void;
};

type ParserOptions = { sourceFileName?: string };
type ParseFn = (code: string, parserOpts: ParserOptions) => t.File;

export default (
  _api?: unknown,
  options: { syntax?: SyntaxOption } = {}
): {
  name: string;
  inherits: () => JSXPluginSyntax;
  parserOverride: (code: string, parserOpts: ParserOptions, parse: ParseFn) => t.File;
  visitor: Visitor<PluginPass>;
} => {
  return {
    name: "@solidjs/babel-plugin",
    inherits: SyntaxJSX.default,
    parserOverride(code, parserOpts, parse) {
      if (isTsrxSource(options.syntax, parserOpts?.sourceFileName)) {
        return parseTsrx(code, parserOpts?.sourceFileName);
      }
      return parse(code, parserOpts);
    },
    visitor: {
      JSXElement: transformJSX,
      JSXFragment: transformJSX,
      Program: {
        enter: preprocess,
        exit: postprocess
      }
    }
  };
};
