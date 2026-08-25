import SyntaxJSX from "@babel/plugin-syntax-jsx";
import { transformJSX } from "./shared/transform";
import postprocess from "./shared/postprocess";
import preprocess from "./shared/preprocess";
import type { Visitor } from "@babel/traverse";
import type { JSXDOMExpressionsPass } from "./types";

type JSXPluginSyntax = {
  manipulateOptions(opts: unknown, parserOpts: { plugins: string[] }): void;
};

export default (): {
  name: string;
  inherits: () => JSXPluginSyntax;
  visitor: Visitor<JSXDOMExpressionsPass>;
} => {
  return {
    name: "JSX DOM Expressions",
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
