# `solid-ssr`

This library provides tools to help with SSR. So far it's a simple Static Generator. This project is still in progress.

Look at the examples to best understand how to use it. Important I make use of conditional export maps here in node. You need the latest version of Node 14 (works in latest Node 12 too but this example doesn't, sorry).

### Examples

There are 4 examples all using the same shared source. It is an isomorphically routed tab navigation using Suspense, Lazy Components, and Data Fetching. They are just compiled differently and have slightly different server entry points.

1. ssr

Uses standard synchronous SSR. Renders what it can synchronously on the server and hydrates top level in the client. Async data is fetcbed and rendered in the client without hydration.

2. stream

Similar to `ssr` except using streams. Data is loaded on the server and sent along the stream so the client can render it. Again only initial HTML is hydrated. Slightly speeds up data loading, so total page load time is reduced.

3. async

Resolves everything reactively on server before sending HTML and serialized data to the client. Whole page is hydrated, but all loading states are avoided. Total load time is similar to streaming, but time to first paint is blocked by how long it takes to load data.

4. ssg

Using async compiler configuration to statically generate pages. Removes the time it takes to render real time.

Examples run on http://localhost:8080/. To run them (in this case ssr):
```
lerna run build:example:ssr --stream
lerna run start:example:ssr --stream
```