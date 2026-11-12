import config from "../config";
import { getTagName, isInForeignContent } from "./utils";
import { lowerShow } from "./lower-show";
import type * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
import type { BabelHubWithMetadata, PluginPass } from "../types";

export default (path: NodePath<t.Program>, state: PluginPass) => {
  const file = (path.hub as unknown as BabelHubWithMetadata).file;
  const parsedMetadata = file.ast.tsrxStyle;
  if (parsedMetadata) {
    file.metadata.css = parsedMetadata.css;
    file.metadata.cssHash = parsedMetadata.cssHash;
    delete file.ast.tsrxStyle;
  }
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
  // SSR `<script>`/`<style>` render raw only in HTML. Their namespace is read
  // here, while every JSX ancestor is still in place: an outer template is
  // lowered before the JSX inside its expressions.
  if (merged.generate === "ssr")
    path.traverse({
      JSXElement(element) {
        const tagName = getTagName(element.node);
        if ((tagName === "script" || tagName === "style") && isInForeignContent(element))
          (element.node as t.JSXElement & { _foreignContent?: boolean })._foreignContent = true;
      }
    });
  if (merged.lowerShow ?? !merged.dev) lowerShow(path, merged);
};
