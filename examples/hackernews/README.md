# HackerNews — Solid Server Components

A real HackerNews client where the server owns the markup: story lists,
threads, and user pages are server components that arrive as HTML, and the
browser gets the router and nothing else. It is
the reads half of the server-owned, request/response corner of the examples
(`todos-server` is the writes half).

Its twin, [../hackernews-spa](../hackernews-spa), is the *same application* —
same routes, same markup, same data layer — built the conventional way, with
server functions returning JSON and client components rendering everything.
Reading the two side by side is the point of this example.

```sh
pnpm dev                  # http://localhost:3004
pnpm build && pnpm start  # http://localhost:3004
```

## What a server component is

A `"use server"` function that **returns a function** is a server component.
The function's arguments are the server's inputs; the returned component's
props are the slots a client would fill, which never travel to the server (this
app has none). Each route file holds its screen's server component inside the
router's `query`, which gives the call cache identity and preloading, and
exports it as a server route:

```tsx
const getStory = query(async ({ params }: ServerRouteArgs<RouteParams<"/stories/:id">>) => {
  "use server";
  const story = await hn.getStory(params.id);
  return () => <div class="item-view">…</div>;
}, "story");

export default serverRouteComponent(getStory);
```

There is no route component and no `preload` to write. The router makes the
call from the match (the route's params, and the feeds' `page` through the
route's search schema) on navigation and on link hover alike. Navigating to
another story or feed re-calls it, and the response morphs that boundary in
place, with no remount and no fallback re-flash.

## The collapse is HTML

Collapsing a comment's replies is a native `<details>`, so the thread needs no
client code at all: `Comment` is recursive server markup, and the browser owns
the open state ([src/routes/story.tsx](./src/routes/story.tsx)). The SPA twin
renders the same `<details>`, so the markup is identical and the only
difference between the apps is what else ships.

## What to look at

**View source on a thread.** Every comment's text appears exactly once, as
markup. There is no hydration data behind it, because there is no client-side
render to feed. Compare with the same view in the SPA twin, where each comment
is present twice: once as the HTML the server painted, and again as the JSON
that produced it.

**The client bundle.** No story, comment, or list templates reach the browser:
grep the client JavaScript (`dist/client/assets/*.js`) for
`item-view-comments-header` or `comment-children` and neither is there. The
server component bodies, `Comment`, and the `hn` data layer they use are
removed from the client build; what ships is the router, the loading
boundary, and the runtime that mounts server components. (The 1,406-comment
capture stays on the server in both apps.)

**Navigation.** Hover a link and the router makes its call ahead of the click,
so most navigations land at once. When one has to wait (click the big thread
without hovering, or tab to a link and press Enter), the current page stays up
and dims until the next is ready, instead of going blank. That's
`useIsRouting()` in [src/app.tsx](./src/app.tsx), the same in both twins.

**The nav is a server component too.** It is static chrome with no reactive
input, so it renders inline at t=0, the client adopts it, and navigation
leaves it alone — no reason for that markup to ship as client templates.

**The wire.** Open devtools → network and click a feed. A server function that
returned a *function* responds as a frame stream of HTML chunks rather than
JSON, and the boundary morphs as they arrive.

## How it's wired

- [src/routes/](./src/routes) — one file per screen, each exporting its server
  component (inside `query`) as a server route. The feeds also export their
  `?page` search schema, and the thread's file holds the recursive `Comment`.
- [src/server/hn.ts](./src/server/hn.ts) — the data source. Live HN API, except
  story `30186326` ("Facebook loses users for the first time", 1,406 comments,
  14 levels deep), which is served from a capture so the big thread is
  deterministic. It begins `import "server-only"`, which fails the build if it
  is ever imported from client code.
- [src/app.tsx](./src/app.tsx) — the route table (the same as the SPA twin's),
  the loading boundary, the navigation dim, and the nav's server component.
- [vite.config.ts](./vite.config.ts) — identical to the SPA twin's but for one
  flag: `serverFunctions: { components: true }`. That flag is the entire wiring
  difference between the two apps. The turnkey `start` object generates the
  entries, the render plugin, and the document bootstrap, so nothing in `src/`
  imports the frames runtime.
- [server.js](./server.js) — a plain node server: static assets, the SSR
  handler, and the `/_server` endpoint, with negotiated brotli/gzip.
