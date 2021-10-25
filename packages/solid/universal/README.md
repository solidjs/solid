# Solid Universal

This contains the means to create the runtime for a custom renderer for Solid. This can enable using Solid to render to different platforms like native mobile and desktop, canvas or WebGL, or even the terminal. It relies on custom compilation from `babel-preset-solid` and exporting the result of `createRenderer` at a referenceable location.

## Example

To use a custom renderer available in the (fictional) `solid-custom-dom` package you'd configure your babelrc as:
```json
{
  "presets": [
    [
      "babel-preset-solid",
      {
        "moduleName": "solid-custom-dom",
        "generate": "universal"
      }
    ]
  ]
}
```

To create a custom renderer you must implement certain methods and export (as named exports) the results. You may also want to forward `solid-js` control flow to allow them to be auto imported as well.

```js
// example custom dom renderer
import { createRenderer } from "solid-js/universal";

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
  mergeProps
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
export {
  For,
  Show,
  Suspense,
  SuspenseList,
  Switch,
  Match,
  Index,
  ErrorBoundary
} from "solid-js";
```

Then to consume:
```js
import { render } from "solid-custom-dom";

function App() {
  // the skies the limits
}

render(() => <App />, mountNode)
```

> Note: For TypeScript support of non-standard JSX you will need to provide your own types at a jsx-runtime entry on your package so that it can be set as the `jsxImportSource`. If mixing and matching different JSX implementations you will need use the per file pragmas.