# `solid-ssr`

This library provides tools to help with SSR. So far it's a simple Static Generator.

This project is still in progress. Server rendering is Async and supports Suspense including lazy components. However, client side hydration only supports lazy components. Any Suspense triggering due to data fetching during rehydration will cause loading states to be entered again. Similarly while Web Components are support, the Shadow DOM isn't yet.

### To use SSR on the server:

1. Install `solid-js`, `solid-preset-solid`, and `solid-ssr`.

2. Configure babel-preset-solid with generate option 'ssr'

```json
"presets": [["solid", { "generate": "ssr", "hydratable": true }]]
```

3. Set up server application:
```js
const createServer = require("solid-ssr/server");
const server = createServer({ path: /* path to client entry*/ })

// under request handler
app.get("*", (req, res) => {
  const html = await server.render(req);
  res.send(html);
})
```

4. Use `renderToString` in client entry for SSR:

```jsx
// top of entry file, must be imported before any components
import ssr from "solid-ssr"
import { renderToString } from "solid-js/dom";

ssr(async (req) => {
  // pull url off request to handle routing
  const { url } = req;
  const string = await renderToString(() => <App />);
  return render(string);
});
```

If you want to async render wrap in `awaitSuspense`.
```jsx
// top of entry file, must be imported before any components
import ssr from "solid-ssr"
import { awaitSuspense } from "solid-js";
import { renderToString } from "solid-js/dom";

ssr(async (req) => {
  // pull url off request to handle routing
  const { url } = req;
  const string = await renderToString(awaitSuspense(() => <App />));
  return render(string);
});
```

> Remember to mark all of "solid-js", "solid-js/dom", "solid-ssr" as externals as no need to bundle these for server rendering entry.

### To rehydrate on the client:

1. Configure babel-preset-solid with generate option 'hydrate'

```json
"presets": [["solid", { "generate": "dom", "hydratable": true }]]
```

2. Use `hydrate` entry:

```jsx
import { hydrate } from "solid-js/dom";

hydrate(() => <App />, document.getElementById("main"));
```

### Static site generation:
1. Use `renderToString` in client entry for SSR:

```jsx
// top of entry file, must be imported before any components
import ssr from "solid-ssr"
import { renderToString } from "solid-js/dom";

ssr(async (req) => {
  // pull url off request to handle routing
  const { url } = req;
  const string = await renderToString(() => <App />);
  return render(string);
});
```

2. Point to file from static export file

```js
const path = require("path")
const ssg = require("solid-ssr/static");

ssg(path.resolve(__dirname, "dist"), {
  source: path.resolve(__dirname, "lib/server.js"),
  pages: ["index", "profile", "settings"]
});
```

### Example

See example folder. Runs on http://localhost:8080/.
```
lerna run build:example --stream
lerna run start:example --stream
```
You can also see basic static site generation via:
```
lerna run export:example --stream
```

Demos Async server side rendering with routing using Lazy Components and Suspense. Notice how the browser skips any initial loading state as it is prerendered. `useTransition` smooths loading of other tabs when navigating suspending the current content for 250ms before showing any fallback. The example also includes progressive hydration although there are currently no input fields to show it off. It captures input events before hydration is complete and replays them as it hydrates when safe to, to minimize uncanny valley.