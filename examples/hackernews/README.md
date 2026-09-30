# HackerNews — Solid Server Components

A real HackerNews client where the server owns the markup: story lists,
threads, and user pages are server components that arrive as HTML, and the
browser gets the router and the few decisions only the client can make. It is
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

## Comment collapse: client state on server markup

The thread is server markup at any depth, and collapsing a comment's replies is
client state. The server component calls a **binding slot** for each comment
that has replies and puts the result's properties at positions on its own
elements ([src/routes/story.tsx](./src/routes/story.tsx)):

```tsx
const t = c.comments.length ? props.toggle({ $key: c.id }) : null;
// …
<div class={["toggle", { open: t.open }]}>
  <a onClick={t.onToggle}>{t.label}</a>
</div>
<ul class="comment-children" style={{ display: t.display }}>
  {c.comments.map(reply => <Comment comment={reply} toggle={props.toggle} />)}
</ul>
```

The client fills the slot in the same file. The fill runs once per comment, like
a component body — this is the SPA twin's `Toggle` without its markup:

```tsx
<View
  toggle={() => {
    const [open, setOpen] = createSignal(true);
    return {
      get open() { return open(); },
      get label() { return open() ? "[-]" : "[+] comments collapsed"; },
      get display() { return open() ? "block" : "none"; },
      onToggle: () => setOpen(o => !o)
    };
  }}
/>
```

There are no client components. The 1,406-comment thread has 652 comments with
replies: 652 fills, each owning a class name, a click handler, a text node and
a style property on elements the server rendered. The replies inside are server
markup again, so a subtree streams as HTML once at any depth. The state never
appears in a request, and `$key` keeps it on its comment across refetches: a
refetched thread morphs around the positions the client owns.

## What a server component is

A `"use server"` function that **returns a function** is a server component.
The function's arguments are the server's inputs; the returned component's
props are the slots the client fills, which never travel to the server. Each
route file holds its screen's server component inside the router's `query`,
which gives the call cache identity and preloading:

```tsx
const getStory = query(async (id: string) => {
  "use server";
  const story = await hn.getStory(id);
  return (props: { toggle: ToggleSlot }) => <div class="item-view">…</div>;
}, "story");
```

On the client side the only question is how the call gets made. A screen with
nothing for the client to fill — the feeds, the user page — is a server route:
the router makes the call from the match (the route's params, and the feeds'
`page` through the route's search schema), on navigation and on link hover
alike, so there is no route component and no `preload` to write:

```tsx
export default serverRouteComponent(getUser);
```

The thread has a client half, the collapse fill, so it is an ordinary route
component, and `dynamic()` over the call is its entire surface:

```tsx
const View = dynamic(() => getStory(props.params.id));
```

Either way the call is tracked, so navigating to another story or feed re-calls
it and the response morphs that boundary in place — no remount, no fallback
re-flash.

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
removed from the client build; what ships is the router, the loading fallback,
and the `toggle` fill. (The 1,406-comment capture stays on the server in both
apps.)

**The nav is a server component too.** It is static chrome with no reactive
input, so it renders inline at t=0, the client adopts it, and navigation
leaves it alone — no reason for that markup to ship as client templates.

**The wire.** Open devtools → network and click a feed. A server function that
returned a *function* responds as a frame stream of HTML chunks rather than
JSON, and the boundary morphs as they arrive.

## How it's wired

- [src/routes/](./src/routes) — one file per screen, each holding its server
  component inside `query`. The feeds and the user page export it as a server
  route (the feeds also export their `?page` search schema); the thread also
  holds the server-only recursive `Comment`, the slot's type, and the route
  component with its fill, and exports its `preload`.
- [src/server/hn.ts](./src/server/hn.ts) — the data source. Live HN API, except
  story `30186326` ("Facebook loses users for the first time", 1,406 comments,
  14 levels deep), which is served from a capture so the big thread is
  deterministic. It begins `import "server-only"`, which fails the build if it
  is ever imported from client code.
- [src/app.tsx](./src/app.tsx) — the route table (the same as the SPA twin's),
  the loading boundary, and the nav's server component.
- [vite.config.ts](./vite.config.ts) — identical to the SPA twin's but for one
  flag: `serverFunctions: { components: true }`. That flag is the entire wiring
  difference between the two apps. The turnkey `start` object generates the
  entries, the render plugin, and the document bootstrap, so nothing in `src/`
  imports the frames runtime.
- [server.js](./server.js) — a plain node server: static assets, the SSR
  handler, and the `/_server` endpoint, with negotiated brotli/gzip.
