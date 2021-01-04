# solid-meta [![npm Version](https://img.shields.io/npm/v/solid-meta.svg?style=flat-square)](https://www.npmjs.org/package/solid-meta)

Asynchronous SSR-ready Document Head management for Solid based on [React Head](https://github.com/tizmagik/react-head)

## Motivation

This module allows you to define `document.head` tags anywhere in your component hierarchy. The motivations are similar to [react-helmet](https://github.com/nfl/react-helmet) in that you may only have the information for certain tags contextually deep in your component hiearchy. There are no dependencies and it should work fine with asynchronous rendering.

## Installation

```sh
npm i solid-meta
```

## How it works

1.  You wrap your App with `<MetaProvider />`
1.  From the server, you pass `tags[]` array to `<MetaProvider />`
1.  Then call `renderTags(tags)` and include in the `<head />` block of your server template
1.  To insert head tags within your app, just render one of `<Title />`, `<Meta />`, `<Style />`, `<Link />`, and `<Base />` components as often as needed.

On the server, the tags are collected in the `tags[]` array, and then on the client the server-generated tags are removed in favor of the client-rendered tags so that SPAs still work as expected (e.g. in cases where subsequent page loads need to change the head tags).

### Server setup

Wrap your app with `<MetaProvider />` on the server, using a `tags[]` array to pass down as part of your server-rendered payload. When rendered, the component mutates this array to contain the tags.

```js
import { renderToString } from 'solid-js/web';
import { MetaProvider, renderTags } from 'solid-meta';
import App from './App';

// ... within the context of a request ...

const tags = []; // mutated during render so you can include in server-rendered template later
const app = renderToString(
  <MetaProvider tags={tags}>
    <App />
  </MetaProvider>
);

res.send(`
  <!doctype html>
    <head>
      ${renderTags(tags)}
    </head>
    <body>
      <div id="root">${app}</div>
    </body>
  </html>
`);
```

### Client setup

There is nothing special required on the client, just render one of head tag components whenever you want to inject a tag in the `<head />`.

```js
import { MetaProvider, Title, Link, Meta } from 'solid-meta';

const App = () => (
  <MetaProvider>
    <div class="Home">
      <Title>Title of page</Title>
      <Link rel="canonical" href="http://solidjs.com/" />
      <Meta name="example" content="whatever" />
      // ...
    </div>
  </MetaProvider>
);
```