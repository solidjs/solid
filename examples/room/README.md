# Room — Live Server Functions

A shared room built on **`live` server functions**, on two pages that share
one declaration:

- **`/live`** — presence, the transcript, and the room card are _standing
  answers_ of **data**: each tab holds them open as one event-stream response
  each and renders them in the browser.
- **`/`** — the room is one live **server component**: presence and the
  transcript rendered on the server, arriving as markup that keeps changing,
  over one connection; the composer is a client slot inside it.

A chaos switch kills every connection so the reconnect path is visible on
both. Where [../chat](../chat) shows server-rendered markup that keeps
changing after it arrives, this example is about liveness having **one
declaration, one loop, and one status surface** across data and markup.

```sh
pnpm dev                       # https://localhost:3010/  (self-signed cert)
HTTPS=0 pnpm dev               # http://localhost:3010/   (HTTP/1.1 — see below)
CHAOS_EVERY=2500 pnpm dev      # the server ends every live response after 2.5s
pnpm build && pnpm start       # production harness (HTTP/1.1)
```

Open either page in **two tabs** — each browser tab is its own member
(identity is minted per tab in `sessionStorage`), so presence moves as you
open and close them.

## `/` — the room as a live server component

[src/lib/room-panel.tsx](./src/lib/room-panel.tsx) is a server function that
answers with a **component**, declared exactly like the data sources:
`live(GET(async (room, me) => { "use server"; return props => <…/> }))`. The
page ([src/routes/home.tsx](./src/routes/home.tsx)) mounts it with
`dynamic(() => roomPanel(room, me))` once the tab has an identity — `dynamic`
is a memo, and a `live` reference's answer is an async iterable it pumps like
any other.

- **The render is the connection.** The component reads the same in-memory
  watchers `/live`'s sources read, through memos; every change re-renders the
  panel on the server and the browser **morphs** it. Joining is the render:
  `onCleanup(join(room, me))` — this tab is a member while its panel's
  response is open, and the request's abort (tab closed, navigated away)
  disposes the render, which is the leave.
- **Death is a reconnect, not a fallback.** _Kill every connection_ and the
  loop reconnects the same binding: the pill cycles
  `connected → reconnecting → connected`, the render number climbs (a fresh
  render on the server), and nothing else moves — no `<Loading>` fallback, no
  re-mount, and the **composer keeps its draft**: it is a client slot the
  server positions (`<props.composer room={room} />`), keyed by position so a
  morph keeps its instance.
- **Posting answers nothing.** `send` is a plain mutation; the row reaches
  this tab and every other as **markup**, through each one's open render.
- **Call-driven face.** The panel mounts after the page is up (the client's
  call is the connection). The document face — the room in the initial HTML,
  adopted by hydration, the loop reconnecting from there — is Stage 8 B3.

## `/live` — the panels, and what each one is

All of it is in [src/lib/sources.ts](./src/lib/sources.ts) (the wire) and
[src/routes/live.tsx](./src/routes/live.tsx) (the reads). Every read is a
plain `createMemo` or derived store over a server function — nothing
fetches, nothing polls.

- **Presence** — `live(GET(async function*))`, read through a memo. **Joining
  is the connection**: the generator calls `join()` on connect and `leave()`
  in its `finally`, so a tab is a member for exactly as long as its response
  is open. The document render watches with `me: null` (identity is the
  browser's); the post-hydration takeover is the connection that actually
  joins.
- **Transcript** — the same standing shape read through a
  `createOptimisticStore`: every yield is the whole transcript, reconciled by
  `id`, so `<For>` keeps the rows that didn't change. Posting is an `action`
  acknowledged by the **stream, not the mutation**: the row appears at once
  (an optimistic write keyed with the id the server will echo), `send` runs,
  and the action holds with `until(() => messages.some(m => m.id === id))` —
  read against the authoritative view, so the tab's own optimistic row can't
  satisfy it — until the transcript carries the post. No refetch anywhere;
  the echo reaches every tab, this one included, through the open stream. A
  rejected send or no echo within the timeout reverts the row and leaves the
  reason beside the composer.
- **Room card** — `live(GET(async () => ({ members: Promise, activity:
asyncGenerator })))`, a **nested-async answer**. `live` claims the _whole
  response_: it is alive until both the promise and the bounded activity
  stream have settled (that is _completion_ → `closed`); a death before then
  reconnects and re-yields a fresh object — watch the connection number and
  the ticks start over. Child memos read into the answer; on the server the
  serializer reads the same nested sources to ship them, and both go through
  one shared pump.
- **Summary** — `GET(async function*)`, **undeclared** and slow. A death here
  is an _error_, not a reconnect — `<Errored>` catches it and _Regenerate_ is
  an explicit new call. `ssrSource: "client"` so the first run is already over
  the wire and killable.
- **Archive** — a slow plain `GET`. Its four seconds are what the presence
  pill up top does _not_ wait for: the shell's live sources take over when the
  root pass ends, this boundary lands whenever it lands (D8).

## The chaos switch

**Kill every connection** (and the dev-only `POST /__chaos/drop` behind it,
in [vite.config.ts](./vite.config.ts)) destroys the socket of every open
server-function response — the way a proxy timeout, a redeploy, or a dropped
radio would. Declared `live` sources read it as a death and reconnect with
their position; the undeclared summary rejects. The status pill shows the
`connected → reconnecting → connected` cycle (wired through the iterable's
`onstatus` hook — see [src/components/status-pill.tsx](./src/components/status-pill.tsx)).

`CHAOS_EVERY=<ms>` does the same on a timer from the server side (the
`chaosReconnectEvery` dev option in
[src/server-config.ts](./src/server-config.ts)): every live response ends
after that many milliseconds as a dying connection would, so the reconnect
path runs continuously without a network to break. Set it below four seconds
and the room card never completes — you watch it re-yield forever.

## HTTP/2 is the precondition

A live source holds a connection open, and browsers allow only **six
connections per origin under HTTP/1.1**. This page holds seven (presence +
transcript + card for the current room, plus one presence watcher per room in
the directory), so it _needs_ HTTP/2. The dev server speaks it when
`server.https` is set — the default here, with a self-signed cert from
`@vitejs/plugin-basic-ssl`.

Run `HTTPS=0 pnpm dev` to serve over HTTP/1.1 and watch it break: past five
open live connections the runtime prints a console warning naming them, and
the seventh request queues behind the others. The production harness
(`server.js`) is plain HTTP/1.1 too — real deployments terminate HTTP/2 at the
edge.

## What to look at

- **View source** on `/live`: presence, the transcript, and the card each
  render their first value into the initial document, then hand off. The
  connection is the client's.
- The room state ([src/lib/rooms.ts](./src/lib/rooms.ts)) is a plain in-memory
  module imported only from `"use server"` functions — grep the client bundle
  for `watchMembers` and it isn't there.
