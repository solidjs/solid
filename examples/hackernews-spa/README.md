# HackerNews — SSR + hydration

A real HackerNews client built the conventional way: server functions return
JSON, client components render everything, and the document ships standard
hydration data. It sits in the client-owned, request/response corner of the
examples, beside `todos`.

It is the comparison twin of [../hackernews](../hackernews) — the *same
application*, with the same routes, the same markup, and the same data layer,
differing only in where the markup comes from. Reading the two side by side is
the point of both examples.

```sh
pnpm dev                  # http://localhost:3005
pnpm build && pnpm start  # http://localhost:3005
```

## What to look at

This is a *good* baseline, not a strawman: fine-grained hydration, no requests
at boot (the serialized data resumes the render), one JSON fetch per
navigation, preloading on link hover, and navigations that keep the current
page up until the next is ready.

The difference from the server-components twin is structural rather than one
of quality. View source on a thread and search for any comment's text: it is
there twice — once as the HTML the server painted, and once inside the
hydration data that produced it. That is inherent, not an oversight. The
client renders these templates itself, so it needs the data that drives them,
which also means every content component ships to the browser. The twin
carries content once and ships no content components at all.

## How it's wired

- [src/routes/](./src/routes) — one file per screen: its server function
  inside `query` (so the router can preload on hover and dedupe the call the
  route then makes, and the result lands in the hydration data), and the route
  component that renders it. Only the default component and `preload` are
  exported. The twin's route files hold the same `getStory`, returning markup
  instead of data, and none of its routes has a route component, because
  there the router makes the call.
- [src/server/hn.ts](./src/server/hn.ts) — the data source, identical to the
  twin's. Live HN API, except story `30186326` ("Facebook loses users for the
  first time", 1,406 comments, 14 levels deep), which is served from a capture
  so the big thread is deterministic. It begins `import "server-only"`, which
  fails the build if it is ever imported from client code.
- [src/components/](./src/components) — the templates: nav, story, and
  comment, whose collapse is a native `<details>`. The twin has no client
  components: its markup is server components.
- [vite.config.ts](./vite.config.ts) — the turnkey `ssr` object generates the
  entries and the serving layer, so there is no `entry-server`, `entry-client`,
  or dev-server script here. `serverFunctions` serves the `/_server` endpoint.
- [server.js](./server.js) — a plain node server: static assets, the SSR
  handler, and the `/_server` endpoint, with negotiated brotli/gzip.
