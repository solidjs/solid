import SyntaxJSX from "@babel/plugin-syntax-jsx";
import { transformJSX } from "./shared/transform";
import postprocess from "./shared/postprocess";
import preprocess from "./shared/preprocess";
import type { Visitor } from "@babel/traverse";
import type { PluginPass } from "./types";

type JSXPluginSyntax = {
  manipulateOptions(opts: unknown, parserOpts: { plugins: string[] }): void;
};

export default (): {
  name: string;
  inherits: () => JSXPluginSyntax;
  visitor: Visitor<PluginPass>;
} => {
  return {
    name: "@solidjs/babel-plugin-jsx",
    inherits: SyntaxJSX.default,
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
