# HackerNews — Solid Server Components

A real HackerNews client built with **Solid Server Components**: the story
lists, threads, and user pages are rendered on the server and arrive as HTML,
while the browser gets the router and the one component that owns state.

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
props are client positions — holes the client fills, which never travel to the
server. From [src/lib/views.tsx](./src/lib/views.tsx):

```tsx
export async function storyView(id: string) {
  const story = await getStory(id);
  return (props: { toggle: Slot }) => <div class="item-view">…</div>;
}
```

On the client side there is no server-component API at all. `dynamic()` over
the call is the entire surface ([src/routes/story.tsx](./src/routes/story.tsx)):

```tsx
const View = dynamic(() => storyView(props.params.id));
return <View toggle={p => <Toggle>{p.children}</Toggle>} />;
```

The source is tracked, so navigating to another story re-calls it and the
response morphs that boundary in place — no remount, no fallback re-flash.

## What to look at

**View source on a thread.** Every comment's text appears exactly once, as
markup. There is no hydration data behind it, because there is no client-side
render to feed. Compare with the same view in the SPA twin, where each comment
is present twice: once as the HTML the server painted, and again as the JSON
that produced it.

**The single client component in a 1,406-comment thread.**
[src/components/toggle.tsx](./src/components/toggle.tsx) owns collapse state
and nothing else. The server calls `props.toggle` for each comment that has
replies, and the replies inside it are server markup again — so a subtree
streams as HTML once at any depth, with client behavior interleaved. Collapse
state is client state: it never appears in a request, and `$key` keeps it
attached to its comment across refetches.

**The client bundle.** No story, comment, or list templates reach the browser:
grep `dist/client/` for `item-view-comments-header` and it isn't there, because
[src/lib/views.tsx](./src/lib/views.tsx) is a `"use server"` module and the
client build strips it. What *is* there is the router, the loading fallbacks,
and `Toggle` — which is why `comment-children` still appears, since the client
owns the replies list it wraps. (The 1,406-comment capture stays on the server
in both apps; `hn.ts` is server-only either way.)

**The nav is a server component too.** It is static chrome with no reactive
input, so it renders inline at t=0, the client adopts it, and navigation
leaves it alone — no reason for that markup to ship as client templates.

**The wire.** Open devtools → network and click a feed. A server function that
returned a *function* responds as a frame stream of HTML chunks rather than
JSON, and the boundary morphs as they arrive.

## How it's wired

- [src/lib/hn.ts](./src/lib/hn.ts) — the data source, server-only. Live HN API,
  except story `30186326` ("Facebook loses users for the first time", 1,406
  comments, 14 levels deep), which is served from a capture so the big thread
  is deterministic.
- [src/lib/views.tsx](./src/lib/views.tsx) — the server components. Every view
  here renders the exact markup its SPA counterpart renders in the browser.
- [src/routes/](./src/routes) — one `dynamic()` call each, no templates.
- [src/app.tsx](./src/app.tsx) — the router, the loading boundaries, and
  nothing else. There are no story, comment, or list templates on this side.
- [vite.config.ts](./vite.config.ts) — identical to the SPA twin's but for one
  flag: `serverFunctions: { components: true }`. That flag is the entire wiring
  difference between the two apps. The turnkey `ssr` object generates the
  entries, the render plugin, and the document bootstrap, so nothing in `src/`
  imports the frames runtime.
- [server.js](./server.js) — a plain node server: static assets, the SSR
  handler, and the `/_server` endpoint, with negotiated brotli/gzip.
