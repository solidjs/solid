# Chat — Streaming Server Components

A simulated LLM chat built with **Solid Server Components**: every reply is a
server component whose markdown renders on the server and streams to the
browser as HTML, token by token. The client owns the transcript, the input,
and autoscroll — the markdown parser, the syntax highlighter, and the canned
answers never ship.

Where the HackerNews twin ([../hackernews](../hackernews)) shows markup that
*arrives and stands still*, this example is about markup that **keeps
changing after it arrives** — one generation streaming through live markup
holes, live slot arguments, and a live store, all crossing the same border.

```sh
pnpm dev                  # http://localhost:3009
pnpm build && pnpm start  # http://localhost:3009
```

Ask about **server components**, **signals**, or **markdown** — those hit the
canned answers ([src/lib/model.ts](./src/lib/model.ts), a fake model that
streams like a real one: no length or structure known up front).

## Three kinds of liveness, one border

All of it lives in [src/lib/ai.tsx](./src/lib/ai.tsx), and all of it is
written the same way — plain reactive expressions:

- **A live markup hole.** `<Message>` renders the reply's accumulated
  markdown into one `innerHTML` hole. Every yield re-renders it on the
  server; the browser morphs the message in place, mid-sentence, with no
  client component involved. One hole because a generation's structure is
  unknown — the message is the unit that grows.
- **Live slot arguments.** `progress={progress()}` and `stats={stats()}`
  cross a client position as reactive expressions: the server re-evaluates
  them per commit and the client fill's props update live. `stats` is a
  promise face that settles only when generation ends, so it is pending
  *per-arg* — the fill renders immediately and its own `<Loading>` covers
  that one read ([src/components/status.tsx](./src/components/status.tsx)).
- **A live store.** `usage={usage}` passes a whole projection across the
  border. It ships as its trace — one snapshot, then the patches the server
  records — and materializes on the client as a live read-only store.
  `<Status>` reads `props.usage.parts` like local state; each field updates
  granularly, with no re-shipping and no domain keys.

Slots render as JSX (`<props.status …/>`), never as calls: the compiler wraps
each prop in a getter, so reads defer to the slot border where the runtime
owns them.

## What to look at

**The welcome message is already typing before JavaScript runs.** The
`welcome()` reply renders into the *initial document*: generation starts with
the page, the first tokens paint through the streamed document itself, and
hydration adopts the boundary in place — zero network — and picks the
generation up mid-sentence over the `sc:live` channel. The `reply()` calls
for your own messages are the exact same component on the call-driven face.

**View source.** The reply text appears once, as finished HTML. There is no
JSON shadow of the markdown, no serialized answer text — the only data
scripts are the trace feeding the usage store.

**The client bundle.** `marked`, `highlight.js`, and the answers are
dependencies of a `"use server"` module, so the client build strips them.
Syntax-highlighted code blocks arrive as token `<span>`s styled by ~15 lines
of CSS — the grammar stays on the server.

**Streaming markdown that never flashes.** A token stream dangles inline
delimiters — `**Solid` would render literal asterisks until the closer
arrives — so [ai.tsx](./src/lib/ai.tsx)'s `closePartial` balances unfinished
emphasis and hides half-arrived links on every frame, the same smoothing real
chat UIs do. It's a render concern, so it lives beside the parser:
server-only, like everything else about the markdown.

**Autoscroll with nothing to hook.** Replies grow through server-driven
morphs — there is no client render to observe — so bottom-pinning in
[src/app.tsx](./src/app.tsx) watches the transcript's *size* with a
`ResizeObserver`, and stays pinned only while the reader is already at the
bottom.

## How it's wired

- [src/lib/model.ts](./src/lib/model.ts) — the simulated model, server-only.
  One generation, four async faces: `text` (accumulated markdown), `progress`
  (status lines), `stats` (a promise of the final numbers), `usage`
  (structured events).
- [src/lib/ai.tsx](./src/lib/ai.tsx) — the server components: `reply(prompt)`
  for each message, `welcome()` for the t=0 face, `<Message>` for the live
  hole, and the projection that becomes the client's usage store.
- [src/app.tsx](./src/app.tsx) — the whole client app: transcript state, the
  composer, autoscroll, and one `dynamic()` per reply.
- [src/components/status.tsx](./src/components/status.tsx) — the client fill
  reading all three tiers: expression args, the pending promise read, and the
  materialized store.
- [vite.config.ts](./vite.config.ts) — the same turnkey setup as the
  HackerNews twin: `start: {}` generates the entries and the document shell,
  `serverFunctions: { components: true }` is the flag that turns on server
  components.
- [server.js](./server.js) — a plain node server for the production build.
