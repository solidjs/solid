# Server Side Rendering

Solid handles Server rendering by compiling JSX templates to ultra efficient string appending code. This can be achieved through the babel plugin or preset by passing in `generate: "ssr"`. For both client and server you need to pass in `hydratable: true` to generate the hydration compatible code.

The `solid-js` and `solid-js/web` runtimes are swapped for non-reactive counterparts when running in a node environment. For other environments you will need to bundle the server code with conditional exports set to `node`. Most bundlers have a way of doing this. In general we also recommend using the `solid` export conditions as well as it is recommend that libraries ship their source under the `solid` export.

Building for SSR definitely takes a bit more configuration because we will be generating 2 separate bundles. The client entry should use `hydrate`:

```jsx
import { hydrate } from "solid-js/web";

hydrate(() => <App />, document);
```

_Note: It is possible to render and hydrate from the Document root. This allows us to describe our full view in JSX._

The server entry can use one of the four rendering options offered by Solid. Each produces the output and a script tag to be inserted in the head of the document.

```jsx
import {
  renderToString,
  renderToStringAsync,
  renderToNodeStream,
  renderToWebStream
} from "solid-js/web";

// Synchronous string rendering
const html = renderToString(() => <App />);

// Asynchronous string rendering
const html = await renderToStringAsync(() => <App />);

// Node Stream API
pipeToNodeWritable(App, res);

// Web Stream API (for like Cloudflare Workers)
const { readable, writable } = new TransformStream();
pipeToWritable(() => <App />, writable);
```

For your convenience `solid-js/web` exports an `isServer` flag. This is useful as most bundlers will be able to treeshake anything under this flag or imports only used by code under this flag out of your client bundle.

```jsx
import { isServer } from "solid-js/web";

if (isServer) {
  // only do this on the server
} else {
  // only do this in the browser
}
```

## Hydration Script

In order to progressively hydrate even before Solid's runtime loads, a special script needs to be inserted on the page. It can either be generated and inserted via `generateHydrationScript`or included as part of the JSX using the `<HydrationScript />` tag.

```js
import { generateHydrationScript } from "solid-js/web";

const app = renderToString(() => <App />);

const html = `
  <html lang="en">
    <head>
      <title>🔥 Solid SSR 🔥</title>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link rel="stylesheet" href="/styles.css" />
      ${generateHydrationScript()}
    </head>
    <body>${app}</body>
  </html>
`;
```

```jsx
import { HydrationScript } from "solid-js/web";

const App = () => {
  return (
    <html lang="en">
      <head>
        <title>🔥 Solid SSR 🔥</title>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="/styles.css" />
        <HydrationScript />
      </head>
      <body>{/*... rest of App*/}</body>
    </html>
  );
};
```

When hydrating from the document inserting assets that aren't available in the client run also can mess things up. Solid provides a `<NoHydration>` component whose children will work as normal on the server, but not hydrate in the browser.

```jsx
<NoHydration>
  {manifest.map(m => (
    <link rel="modulepreload" href={m.href} />
  ))}
</NoHydration>
```

## Async and Streaming SSR

These mechanisms are built on Solid's knowledge of how your application works. It does so by using Suspense and the Resource API on the server, instead of fetching ahead and then rendering. Solid fetches as it renders on the server just like it does on the client. Your code and execution patterns is written exactly the same way.

Async rendering waits until all Suspense boundaries resolve and then sends the results (or writes them to a file in the case of Static Site Generation).

Streaming starts flushing synchronous content to the browser immediately rendering your Suspense Fallbacks on the server. Then as the async data finishes on the server it sends the data over the same stream to the client to resolve Suspense where the browser finishes the job and replaces the fallback with real content.

The advantage of this approach:

- Server doesn't have to wait for Async data to respond. Assets can start loading sooner in the browser, and the user can start seeing content sooner.
- Compared to client fetching like JAMStack, data loading starts on the server immediately and doesn't have to wait for client JavaScript to load.
- All data is serialized and transported from server to client automatically.

## SSR Caveats

Solid's Isomorphic SSR solution is very powerful in that you can write your code mostly as single code base that runs similarly in both environments. However there are expectations that this puts on hydration. Mostly that the rendered view in the client is the same as it would be rendered on the server. It doesn't need to be exact in terms of text, but structurally the markup should be the same.

We use markers rendered in the server to match elements and resource locations on server. For this reason the Client and Server should have the same components. This is not typically a problem given that Solid renders the same way on client and server. But currently there is no means to render something on the server that does not get hydrated on the client. Currently, there is no way to partially hydrate a whole page, and not generate hydration markers for it. It is all or nothing. Partial Hydration is something we want to explore in the future.

## Getting Started with SSR

SSR configurations are tricky. We have a few examples in the [solid-ssr](https://github.com/solidjs/solid/blob/main/packages/solid-ssr) package.

However, a new starter is in the works [SolidStart](https://github.com/solidjs/solid-start) that aims to make this experience much smoother.

## Getting Started with Static Site Generation

[solid-ssr](https://github.com/solidjs/solid/blob/main/packages/solid-ssr) also ships with a simple utility for generating static or prerendered sites. Read the README for more information.
