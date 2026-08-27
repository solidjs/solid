import config from "../config";
import type * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import type { BabelHubWithMetadata, PluginPass } from "../types";

export default (path: NodePath<t.Program>, state: PluginPass) => {
  const file = (path.hub as unknown as BabelHubWithMetadata).file;
  const merged = (file.metadata.config = Object.assign({}, config, state.opts));
  // Boolean opt-in parity with the native loader: `patchDriver: true` means
  // the default import name (downstream code uses the value AS the name).
  if ((merged.patchDriver as unknown) === true) merged.patchDriver = "patchDriver";
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
