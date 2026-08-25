import config from "../config";
import type * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import type { BabelHubWithMetadata, JSXDOMExpressionsPass } from "../types";

export default (path: NodePath<t.Program>, state: JSXDOMExpressionsPass) => {
  const file = (path.hub as unknown as BabelHubWithMetadata).file;
  const merged = (file.metadata.config = Object.assign({}, config, state.opts));
  const lib = merged.requireImportSource;
  if (lib) {
    const comments = file.ast.comments ?? [];
    let process = false;
    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];
      const pieces = comment.value.split("@jsxImportSource");
      if (pieces.length === 2 && pieces[1].trim() === lib) {
        process = true;
        break;
      }
    }
    if (!process) {
      state.skip = true;
      return;
    }
  }
};
