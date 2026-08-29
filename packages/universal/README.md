# Solid Universal

> **Solid 2.0 (Release Candidate).** In 1.x this was the `solid-js/universal` subpath; in 2.0 it's a separate `@solidjs/universal` package. The `createRenderer` returned `render` now schedules the top-level mount through the effect queue and drains it with a tail `flush()`, matching `@solidjs/web`'s deferred-mount semantics so uncaught top-level async holds the initial commit on the active transition and attaches atomically once it settles.

This contains the means to create the runtime for a custom renderer for Solid. This can enable using Solid to render to different platforms like native mobile and desktop, canvas or WebGL, or even the terminal. It relies on custom compilation from `@solidjs/babel-plugin` (or `@solidjs/compiler`) and exporting the result of `createRenderer` at a referenceable location.

## Example

### Babel

To use a custom renderer available in the (fictional) `solid-custom-dom` package you'd configure your babelrc as:

```json
{
  "plugins": [
    [
      "@solidjs/babel-plugin",
      {
        "moduleName": "solid-custom-dom",
        "generate": "universal"
      }
    ]
  ]
}
```

### Vite

To use a custom renderer available in the (fictional) `solid-custom-dom` package you'd configure your vite config as:

```js
import { defineConfig } from "vite";
import solidPlugin from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [
    solidPlugin({
      solid: {
        moduleName: "solid-custom-dom",
        generate: "universal"
      }
    })
  ]
});
```

To create a custom renderer you must implement certain methods and export (as named exports) the results. You may also want to forward `solid-js` control flow to allow them to be auto imported as well.

```js
// example custom dom renderer
import { createRenderer } from "@solidjs/universal";

const PROPERTIES = new Set(["className", "textContent"]);

export const {
  render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  applyRef,
  ref,
  // Required since patch mode became the compiler default: compiled
  // templates with pure member-read bindings import `patchDriver` from your
  // renderer module. createRenderer provides it — just re-export.
  patchDriver
} = createRenderer({
  createElement(string) {
    return document.createElement(string);
  },
  createTextNode(value) {
    return document.createTextNode(value);
  },
  replaceText(textNode, value) {
    textNode.data = value;
  },
  setProperty(node, name, value) {
    if (name === "style") Object.assign(node.style, value);
    else if (name.startsWith("on")) node[name.toLowerCase()] = value;
    else if (PROPERTIES.has(name)) node[name] = value;
    else node.setAttribute(name, value);
  },
  insertNode(parent, node, anchor) {
    parent.insertBefore(node, anchor);
  },
  isTextNode(node) {
    return node.type === 3;
  },
  removeNode(parent, node) {
    parent.removeChild(node);
  },
  getParentNode(node) {
    return node.parentNode;
  },
  getFirstChild(node) {
    return node.firstChild;
  },
  getNextSibling(node) {
    return node.nextSibling;
  }
});

// Forward Solid control flow
export { For, Repeat, Show, Switch, Match, Errored, Loading, Reveal } from "solid-js";
```

Then to consume:

```js
import { render } from "solid-custom-dom";

function App() {
  // the skies the limits
}

render(() => <App />, mountNode);
```

## TypeScript JSX

`solid-js` does not own renderer JSX types. A custom renderer package should provide its own `jsx-runtime` and `jsx-dev-runtime` type entries, then applications should point `jsxImportSource` at the renderer package:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-custom-dom"
  }
}
```

The renderer's JSX namespace should describe its own renderable node values and intrinsic elements. A minimal `solid-custom-dom/jsx-runtime.d.ts` looks like:

```ts
import type { Element as SolidElement } from "solid-js";

// Replace this with the renderer's concrete node type.
type RendererNode = { readonly type: string };

export namespace JSX {
  type Element = SolidElement | RendererNode | ArrayElement;
  interface ArrayElement extends Array<Element> {}

  interface ElementChildrenAttribute {
    children: {};
  }

  interface IntrinsicElements {
    view: { id?: string; children?: Element };
    text: { value?: string; children?: Element };
  }
}
```

The package should expose those files from `package.json`:

```json
{
  "exports": {
    "./jsx-runtime": {
      "types": "./types/jsx-runtime.d.ts",
      "default": "./dist/index.js"
    },
    "./jsx-dev-runtime": {
      "types": "./types/jsx-runtime.d.ts",
      "default": "./dist/index.js"
    }
  }
}
```

If mixing multiple JSX implementations in the same project, use per-file pragmas such as `/** @jsxImportSource solid-custom-dom */`.

Renderer packages can generate a JSX namespace from `@solidjs/web`'s `jsx-h.d.ts` source with `packages/web/scripts/jsx-sync.mjs`:

```sh
node packages/web/scripts/jsx-sync.mjs \
  --input packages/web/jsx/jsx-h.d.ts \
  --output ./types/jsx-runtime.d.ts \
  --compile \
  --element "SolidElement | RendererNode | ArrayElement" \
  --import 'import type { Element as SolidElement } from "solid-js";'
```
