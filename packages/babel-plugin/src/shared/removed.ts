import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";

/**
 * Solid 1.x attribute forms that 2.0 removed (#4187). Left alone they
 * compile into literal attributes (`<div use:tip="() => {}">`,
 * `classlist="[object Object]"`) with no diagnostic, so on native elements
 * of the web generates (`dom` / `ssr`) they are a compile error that names
 * the 2.0 replacement. Components are untouched (their props are
 * user-defined names with no compiler semantics), as is the universal
 * generate (a custom renderer's `setProp` owns its own naming), and every
 * other namespace — `prop:`, `xlink:`, `xml:`, `xmlns:`, `svg:`, … — still
 * compiles as before. The message text is mirrored in the native compiler
 * (`packages/compiler/src/shared/removed.rs`); keep the two in sync.
 */
export function removedAttributeMessage(tagName: string, key: string): string | undefined {
  if (key === "classList") {
    return (
      `\`classList\` on <${tagName}> was removed in Solid 2.0. ` +
      "Use `class` with an object or array instead: `class={{ active: isActive() }}` " +
      'or `class={["base", { active: isActive() }]}`.'
    );
  }
  const colon = key.indexOf(":");
  if (colon < 0) return;
  const namespace = key.slice(0, colon);
  const name = key.slice(colon + 1);
  const removed = `\`${key}\` on <${tagName}> uses the \`${namespace}:\` namespace, which was removed in Solid 2.0.`;
  switch (namespace) {
    case "on":
    case "oncapture":
      return (
        `${removed} Use a camelCase handler such as \`onClick={handler}\` for Solid events, ` +
        "or a `ref` callback that calls `addEventListener` for listener options or custom event names."
      );
    case "attr":
      return `${removed} Attributes are the default in 2.0: write \`${name}={value}\` (or \`prop:${name}\` to set a DOM property).`;
    case "bool":
      return `${removed} Boolean values add or remove the attribute in 2.0: write \`${name}={condition}\`.`;
    case "use":
      return (
        `${removed} Use a \`ref\` directive factory instead: \`ref={${name}(options)}\`, ` +
        `or \`ref={${name}}\` without options; arrays compose (\`ref={[a, b]}\`).`
      );
  }
}

/** Throws a code-frame error at the first removed 1.x attribute form. */
export function assertNoRemovedAttributes(path: NodePath<t.JSXElement>, tagName: string): void {
  for (const attribute of path.get("openingElement").get("attributes")) {
    if (!attribute.isJSXAttribute()) continue;
    const name = attribute.node.name;
    const key = t.isJSXNamespacedName(name)
      ? `${name.namespace.name}:${name.name.name}`
      : name.name;
    const message = removedAttributeMessage(tagName, key);
    if (message) throw attribute.buildCodeFrameError(message);
  }
}
