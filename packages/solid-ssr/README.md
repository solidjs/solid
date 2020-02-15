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
3. Patch node environment at top of program:
```js
require("solid-ssr/register");
```

4. Use `renderToString` entry:

```jsx
import { renderToString } from "solid-js/dom";

const HTMLString = await renderToString(() => <App />);
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
