# `solid-ssr`

This library provides tools to help with SSR. So far it's a simple Static Generator. But will add more tools in the future.

## solid-ssr/static

This is a simple runner that renders files and writes them to disk. It exports a single export that can be used in either CJS or ESM.

```js
renderStatic(
  PAGES.map(p => ({
    entry: pathToServer,
    output: path.join(pathToPublic, `${p}.html`),
    url: `/${p}`
  }))
);
```

Each entry expects 3 values:
* entry: path to the server entry point you will be using to render the page
* output: path to the location of the html file you wish to write
* url: the url that will be passed on the faux request object

Entry files should be async functions that return the html string in the form:
```js
export default async function(req) {
  return "<html>My Page</html>"
}
```

## Examples

Look at the examples to best understand how to use it. Important I make use of conditional export maps here in node. You need the latest version of Node 14 (or latest Node 12 but this example doesn't work in Node 12, sorry).

There are 4 examples all using the same shared source. It is an isomorphically routed tab navigation using Suspense, Lazy Components, and Data Fetching. They are just compiled differently and have slightly different server entry points.

1. ssr

Uses standard synchronous SSR. Renders what it can synchronously on the server and hydrates top level in the client. Async data is fetched and rendered in the client without hydration.

2. stream

Similar to `ssr` except using streams. Data is loaded on the server and sent along the stream so the client can render it. Again, only initial HTML is hydrated. Slightly speeds up data loading, so total page load time is reduced.

3. async

Resolves everything reactively on server before sending HTML and serialized data to the client. Whole page is hydrated, but all loading states are avoided. Total load time is similar to streaming, but time to first paint is blocked by how long it takes to load data.

4. ssg
Using async compiler configuration to statically generate pages. Removes the time it takes to render real time.

Examples run on http://localhost:8080/. To run them (in this case ssr):
```
lerna run build:example:ssr --stream
lerna run start:example:ssr --stream
```

|folder/example name|ssr|async|stream|ssg|
|--- |--- |--- |--- |--- |
|Parallels|[JAMStack]("https://jamstack.org/what-is-jamstack/")|Next/Nuxt/Sveltekit|[Marko streaming](https://tech.ebayinc.com/engineering/async-fragments-rediscovering-progressive-html-rendering-with-marko/)|Static site generators|
|When is the data queried?|Client|Server, at request time|Server, at request time|Server, at build-time|
|Render strategy|Elements outside the suspense boundary are rendered on the server and sent initially, then hydrated on the client. Everything that depends on data is in the bundle and rendered client-side|All necessary nodes are rendered on the server, then hydrated on the client. Data is serialized, sent along with the page, and reused on the client as necessary.|The page is rendered with placeholders for elements that depend on data. These are replaced with the correct nodes as more of the stream loads.|Same as async, but the rendering is done ahead of time|
|Loading indicators / suspense fallbacks|Top-level suspense fallback (the _Loading…_ span) is sent as part of the HTML. The _Loading Info…_ span is part of the Profile component, in the bundle.|None. The suspense fallback never gets shown because the suspense is resolved in the server.|Both loading indicators are included in the HTML, along with the scripts that replace them. On a slow connection, the HTML gets to the browser at the same time, and you don’t see any loading indicators.|Same as async|
|Server-side render function used|renderToString|renderToStringAsync|renderToStream (1.3)|renderToStringAsync|
