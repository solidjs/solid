declare module "@babel/plugin-syntax-jsx" {
  function jsx(): {
    manipulateOptions(opts: unknown, parserOpts: { plugins: string[] }): void;
  };
  const module: {
    default: typeof jsx;
  };
  export default module;
}

declare module "@babel/core" {
  interface BabelFileMetadata {
    config?: import("./config").JSXDOMExpressionsConfig;
  }
}

declare module "@babel/helper-module-imports" {
  import type { NodePath } from "@babel/traverse";
  import type * as t from "@babel/types";

  export function addNamed(
    path: NodePath,
    name: string,
    moduleName: string,
    opts?: { nameHint?: string }
  ): t.Identifier;
}
