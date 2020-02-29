# `solid-ssr`

This library patches node environment to enable Solid's SSR. Import `solid-ssr/register` at the top of your application. Also provides `solid-ssr/jest` which is a jest environment to render solid.

See example folder. Runs on http://localhost:8080/

This project is still early days. Server rendering is Async and supports Suspense including lazy components. However, client side hydration only supports lazy components. Any Suspense triggering during rehydration will cause loading states to be entered again.

### To use SSR on the server:

1. Install `solid-js`, `solid-preset-solid`, and `solid-ssr`.

2. Configure babel-preset-solid with generate option 'ssr'

```json
"presets": [["solid", { "generate": "ssr" }]]
```

3. Set up server application:
```js
const createSSR = require("solid-ssr");
const render = createSSR({ path: /* path to client entry*/ })

// under request handler
app.get("/someurl", (req, res) => {
  const html = await render(req);
  res.send(html);
})


```

4. Use `renderToString` in client entry for SSR:

```jsx
// top of entry file, must be imported before any components
import { client } from "solid-ssr/client"
import { renderToString } from "solid-js/dom";

client(async (req) => {
  // pull url off request to handle routing
  const { url } = req;
  const string = await renderToString(() => <App />);
  return render(string);
});
```

### To rehydrate on the client:

1. Configure babel-preset-solid with generate option 'hydrate'

```json
"presets": [["solid", { "generate": "hydrate" }]]
```

2. Use `hydrate` entry:

```jsx
import { hydrate } from "solid-js/dom";

hydrate(() => <App />, document.getElementById("main"));
```
