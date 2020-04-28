# `solid-ssr`

This library provides tools to help with SSR. So far it's a simple Static Generator.

This project is still in progress. Server rendering is Async and supports Suspense including lazy components. However, client side hydration only supports lazy components. Any Suspense triggering due to data fetching during rehydration will cause loading states to be entered again. Similarly while Web Components are support, the Shadow DOM isn't yet.

### To use SSR on the server:

1. Install `solid-js`, `solid-preset-solid`, and `solid-ssr`.

2. Configure babel-preset-solid with generate option 'ssr'

```json
"presets": [["solid", { "generate": "ssr", "hydratable": true }]]
```
> Remember to mark all of "solid-js", "solid-js/dom", "solid-ssr" as externals as no need to bundle these for server rendering entry.

3. Use `renderToString` in server entry for SSR:

```jsx
import { renderToString } from "solid-js/dom";

export default async (req) => {
  // pull url off request to handle routing
  const html = await renderToString(() => <App url={req.url} />);
  return `<html><body>${html}</body></html>`;
});
```

4. Set up express application:
```js
const render = require("./lib/server"); // your server entry

// under request handler
app.get("*", (req, res) => {
  const html = await render(req);
  res.send(html);
})
```

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
Point to server entry and call pages.

```js
const path = require("path")
const ssg = require("solid-ssr/static");

ssg(path.resolve(__dirname, "dist"), {
  source: require("lib/server.js"),
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