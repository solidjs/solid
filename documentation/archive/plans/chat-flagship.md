# `chat` flagship — the bottom-right corner as a product

_Drafted 2026-10-12. Handoff item 1 of
[`examples-grid-plan.md`](./examples-grid-plan.md): this plan first, then the
rebuild. Not built. The grid plan's bar and authoring layout apply unchanged
and are not restated. Design record: principles §9.5 (the `live` transport),
§9.6 (mutations through a live connection), §10 (fit; this is Q2 with Q3
annotations). Owner: Ryan._

_Status 2026-10-13: built, in the PR that adds this file. `board` was built
first (2026-10-12) and the four spikes below were run before the build. What
follows is the plan as drafted; where the build differs, this note wins._

- _**Source shape.** One watcher per thread, not one per message. A watcher
  created per row inside the list never settles (the boundary retries with a
  new pending source each pass). The thread is cut into two reads instead:
  the finished messages, and the reply being written, so a token re-sends
  only the reply._
- _**Conditions in live markup test locals.** A condition on a property
  (`{message.usage && …}`) silently stops the markup updating (#4023)._
- _**The bubble leaves by derivation** from the `seen` slot arg, with no
  `until` (spike C1). The composer's form is a router action; its write
  needs `latest()` to show at once._
- _**The composer is keyed by thread** (`$key={id}`), or a draft follows into
  the next thread (spike C2)._
- _**Spelling:** `liveQuery(live(GET(fn)), key)` (spike C2)._
- _**The sidebar** is a live server component mounted in the app shell with
  `dynamicComponent`, not a pathless layout route. C3 holds: an update to it
  leaves the open thread and its composer untouched._
- _**Messages** carry `text` and `reasoning` strings, not typed parts._
- _**D3:** both. An OpenAI-compatible adapter over `fetch` (for Ollama and
  hosted free tiers) and Claude through Anthropic's SDK, behind one
  function, with the simulated model as the default._
- _**D6:** an empty title is blocked by `required`; the returned error is
  not displayed._
- _**Not done:** C6 (the first full morph on a long thread) is unmeasured.
  Reconnect under `CHAOS_EVERY` was run in the spikes, not on the app. No
  real provider has been called: the OpenAI-compatible adapter is checked
  against a local stub, the Claude adapter only typechecks. No-JavaScript was
  checked by posting the forms, not in a browser with scripts off._

## Objective

Replace the standing streaming demo with the chat people actually build: a
thread list, threads that are durable and addressable, and generation as a
job that outlives the request that started it. The thread is a `live`
server component projecting durable state, so closing the tab costs nothing
— come back and the page is caught up in one morph — and two tabs on one
thread agree without either one owning the generation. The client owns
navigation, the composer, the optimistic bubble, the copy button and
scrolling. Markdown, highlighting, the model client and its key stay on the
server.

`board` is the twin: the same primitives with the client owning the
markup. A live thread read into an optimistic store is `board` with a
transcript instead of lists, which is why there is no `chat-spa`.

## What exists today

- **`examples/chat`** — one page, no router. Each reply is a
  `dynamicComponent(() => reply(prompt))` over a module-level `"use server"`
  file (`lib/ai.tsx`); the transcript is a client signal and dies with the
  tab. One live markup hole per reply, `progress`/`stats` as live slot args,
  `usage` as a projection across the border (the container tier's only
  example), `codeBlock` as a binding slot, and a document-face `welcome()`
  that types before JavaScript runs. Fake model only.
- **`examples/room` `/`** — the room as `live(GET(…))` returning a component,
  with the composer as a template slot the server positions
  (`<props.composer room={room} />`). Proven there and carried over here:
  reconnect is one morph with no fallback, the composer keeps its draft
  through a reconnect, the document face renders first value and the
  takeover connects once, conditional reconnect sends only changed holes.
- **Router `liveQuery(fn, key)`** (2.0.0-next.38) — one connection per key,
  GET at creation, document face renders first value, `status(...args)` for
  wire state. Its keys are neither collected for single-flight nor swept
  after a mutation: the stream is the freshness mechanism. That is what
  keeps a form's single-flight response from superseding the live thread
  (§9.5 client face, item 4) without anything in this example arranging it.
- **`serverRouteComponent(liveQuery(…))`** — supported for a server component
  whose only client position is `children`.

## The app

Two routes under one layout.

- **Layout (pathless).** The sidebar: the thread list, newest first, each
  link showing its title and a mark while a generation is running, plus a
  "New chat" link. The router marks the current link (navigation); the
  server renders the list (content). Its only client position is the outlet,
  so it is a server route: `serverRouteComponent(liveQuery(getThreads,
  "threads"))`. Live because its truth changes without this tab: another
  tab sends, a generation finishes, a title arrives.
- **`/`** — an empty thread: the composer and nothing else. Sending creates
  the thread and redirects to it (single-flight, as `notes`' create).
- **`/t/:id`** — the thread. A live server component over the durable
  thread: header (title, rename, delete), the messages, and at the tail the
  composer slot. It takes client positions beyond `children` (the composer
  template slot, the `codeBlock` binding slot), so it has a route component,
  per the router's own rule.

Per message, server markup throughout:

- **User** — the text, escaped.
- **Assistant** — the markdown rendered to HTML as it grows (one live hole,
  as today); code blocks highlighted, each with a Copy button bound through
  `codeBlock` (the one-line trivial case the grid plan protects); reasoning,
  when the model sends it, in a native `<details>` closed by default. While
  generating: a Stop form. When done: tokens and seconds as plain text on the
  message (the `usage` projection goes; a number on a finished message is
  not live state). Stopped: the partial text and "Stopped". Failed: the
  partial text, the reason, and a Retry form. The last finished assistant
  message carries Regenerate.

Every mutation is a form that works without JavaScript: send, stop,
regenerate, retry, rename, delete. With JavaScript the router submits the
same forms in place and marks the submitting one `aria-busy` (V4); pending
feedback is CSS.

Connection state is visible as an affordance the app would have anyway: a
quiet "Reconnecting…" line from `liveQuery`'s `status`, not `room`'s pill or
chaos switch. `CHAOS_EVERY` stays as a server-config dev knob with no UI.

**Out of scope.** Accounts and identity (one user; anyone at the URL),
attachments, tool use, a model picker, search, sharing, editing a sent
message, branching. Anything the model returns that is not text or
reasoning is dropped by the adapter.

## Acceptance moments

The bar names these so they get built; each is checked by hand in the
browser before the PR and listed in the README's "What to look at".

1. **Send.** The bubble is on screen in the same frame as the submit. When
   the server's row arrives the bubble goes in the same apply — never both,
   never neither (C1). The reply starts streaming under it.
2. **Leave and come back.** Close the tab mid-generation and reopen the
   URL: view source shows the reply as far as it had got; after hydration
   it is current in one morph with no fallback, and keeps streaming. (One
   full-snapshot morph, since the document face does not seed the have-list
   yet — §9.5 B4; every later reconnect is conditional.)
3. **Two tabs.** Both stream the same generation. Stop in one stops it in
   both. Rename in one retitles the header and the sidebar in both.
4. **Reconnect.** With `CHAOS_EVERY` set, nothing flashes: no fallback, the
   composer keeps its draft, a pending bubble stays pending.
5. **Failure is a fact.** A failed generation (the fake model's failure
   word, a real API error, a server restart mid-generation with the file
   driver) shows the same failed message with Retry in every tab and after
   a reload.
6. **No JavaScript.** Every form works; the reply is a snapshot that a
   reload advances. Stated in the README, not hidden.
7. **The bundle.** The client build has no `marked`, no `highlight.js`, no
   model adapter and no key name. A `check` script greps `dist/client`, as
   `hackernews`' does.

## Architecture

### Durable state — `src/server/db.ts`

`import "server-only"`, unstorage as in `notes`: memory driver by default,
`CHAT_STORAGE=fs` for a `.data/` file driver so a restart can be survived
(and moment 5's restart case seen).

```ts
interface Thread { id: string; title: string | null; createdAt: number; updatedAt: number }
interface Message {
  id: string;                 // user rows: minted by the client that sent them
  threadId: string;
  role: "user" | "assistant";
  parts: { type: "text" | "reasoning"; text: string }[];
  status: "complete" | "generating" | "stopped" | "failed";
  error?: string;             // failed: worded by the server
  usage?: { tokens: number; seconds: number };
  createdAt: number;
}
```

Watchers in `room`'s shape (`rooms.ts`): a version counter per thread and
per thread list, `changed(…, signal)` racing the request's abort so a
disconnect ends the generator now. `watchThreads()`, `watchThread(id)` —
which yields when membership or status changes, not per token — and
`watchMessage(id)`, which yields per write. The split is so a token re-renders
one message's hole and nothing else on the page.

Not `room`'s loop verbatim: it yields and then waits without looking again,
so a write that lands while the consumer holds the previous value is missed
until the next one (found building `board`, 2026-10-12). Here that is a
reply stalled one write behind. After a yield, re-check the version before
waiting, as `examples/board/src/server/db.ts` does. The spikes off `room`
take the same fix on the spike branch.

A user row's id is the client's (as `room`'s `send`): the bubble and the row
carry the same id, a retried send of a row that landed is a no-op, and the
echo can be named (moment 1).

### Generation as a job — `src/server/generations.ts`

`import "server-only"`. A module-level registry, `Map<messageId,
AbortController>`, owned by no request. `start(threadId, messageId)` runs
the model over the thread's history and writes parts to `db` as they arrive,
coalesced to at most one write per ~50 ms (a real model outruns a markdown
re-render per token); finishing sets `complete` and `usage`, an abort sets
`stopped`, a throw sets `failed` with a server-worded reason. `stop(id)`
aborts. The send action writes the user row and an empty `generating`
assistant row, calls `start`, and returns — the generation outlives it
(C5). At module load, `db` rows still `generating` with no registry entry
become `failed: "Interrupted by a server restart"`: an orphan is a fact,
not a hang.

Two tabs, one job: the job writes, watchers re-yield, every open render
morphs. Nothing in the job knows about connections. This is §9.6 (A), the
feed echo, and nothing here needs (B) or (C).

### The model — `src/server/model.ts`

`import "server-only"`. One interface, `stream(history, signal) →
AsyncIterable<{ type: "text" | "reasoning"; delta: string }>`, two
adapters: a real one over `fetch` when the key is set, and today's fake
(no length or structure known up front) when it is not. The fake keeps its
canned answers, gains reasoning on one of them, and fails mid-stream on a
documented word. The key is read here and nowhere else.

### Markdown — `src/server/markdown.ts`

`import "server-only"`. `segmentsOf` and `closePartial` move from
`lib/ai.tsx` unchanged, with `marked` and `highlight.js`. Heavy and
server-only, so behind the marker rather than inline in the route file.

### Thread route — `src/routes/thread.tsx`

The screen in one file, per the authoring layout:

```ts
const getThread = liveQuery(async (id: string) => {
  "use server";
  return (props: { composer: ComposerSlot; codeBlock: CodeBlockSlot }) => { … };
}, "thread");
```

(Or `liveQuery(live(GET(…)), "thread")` — C2 decides the spelling.) Inside: the header with the rename and delete forms; `<For>` over
`watchThread(id)`; an `AssistantMessage` helper reading `watchMessage(id)`
through a memo into the one live hole; the Stop / Regenerate / Retry forms;
and at the tail `<props.composer threadId={id} seen={userIds()} />`, where
`userIds()` is a memo over the thread's user-row ids — a live slot arg, the
authoritative view the composer's `until` reads. The route component mounts
`dynamicComponent(() => getThread(params.id))` with the composer and
`codeBlock` fills inline. The actions that only this screen's forms post
(`stopGeneration`, `regenerate`, `renameThread`, `deleteThread`) are inline
here; `deleteThread` redirects to `/`.

### The composer — `src/components/composer.tsx`

A client component, because both routes render it and it is Q4: a draft,
Enter-to-send, autosize, pending rows. It is the template slot's fill on
`/t/:id` and a plain child on `/`. Its form posts `sendMessage` with the
id it minted as a hidden field; `sendMessage` lives in this file (a mixed
file; no marker), creates the thread when there is no `threadId` and
redirects to it.

The optimism, all in this one component:

```ts
const send = action(function* (form: FormData) {
  const id = mintId();
  setOutbox(o => o.push({ id, text }));        // the bubble, now
  yield sendMessage(props.threadId, form);
  yield until(() => props.seen.includes(id), { timeout: 15_000 });
});
```

Pending rows render from the outbox, above the form, inside the slot — which
is the tail of the transcript, so the bubble sits where the row will land.
The outbox write reverts with the action; a rejection or a timeout leaves
the draft in the field and the reason beside it (§9.6 (A): a rejected send
is rare and its message generic). Because the composer is positioned by
the server and keyed by position, a reconnect keeps its draft and its
outbox (proved by `room`).

### Layout route — `src/routes/layout.tsx`

`getThreads` inline: a `liveQuery` server component rendering the sidebar
around `props.children`, mounted with `serverRouteComponent`. No client
code. Titles: the first line of the first prompt, trimmed, set when the
thread is created; no second model call (D5).

### Files

```text
src/
  app.tsx  router.tsx  server-config.ts  types.ts  Document.tsx  app.css
  routes/      layout.tsx  home.tsx  thread.tsx
  components/  composer.tsx
  server/      db.ts  generations.ts  model.ts  markdown.ts   (each: import "server-only")
```

`router.tsx` holds the route table and passes the Router to the flight
collector in `server-config.ts`, as `notes` does; `server-config.ts` also
keeps the `CHAOS_EVERY` knob from `room`. HTTP/2 in dev via
`@vitejs/plugin-basic-ssl`, as `room`: two live connections per tab
(sidebar, thread), and more with tabs open.

## What leaves, and what loses its example

- **From `chat`:** the module-level `"use server"` file, `welcome()` and the
  document face that types before JavaScript (a live-declared component's
  document face is first value by design, §9.5 B3; reload mid-generation is
  the moment now), `progress`/`stats` slot args and the per-arg pending
  promise, the `usage` projection.
- **From `room` `/`:** absorbed — live server component, composer slot,
  reconnect, takeover. Presence goes to `board` with `/live`. `room` is
  deleted when both flagships exist (grid plan, Handoff 3).
- **Mechanisms left without an example, flagged:** the container tier
  (principles §10.5; its home is a follow-up in the grid plan), a promise
  face as a slot arg, document-face live holes (Stage 4) for an undeclared
  source. Each is evidence for §10.5, not a feature to add back here.

## Verification items (gate the build)

- **C1 — Echo and settlement in one apply.** The user row (in the thread's
  `<For>`) and the composer slot's `seen` record come from one server
  commit; the client must apply both in one transition so the bubble never
  overlaps or gaps the row. The live-stream counterpart of V2. If it fails,
  that is a frames finding, not an example workaround.
- **C2 — `liveQuery` server component with client positions, from a route
  component.** First, the declaration: `liveQuery` is documented for a
  producer that yields successive values, and its connect treats a
  non-iterable answer as one yield; a component whose render streams is the
  nested-async case `live` claims (§9.5). Confirm `liveQuery(fn, key)` over a
  component-returning `"use server"` function gets the response-lifetime
  loop — or that the spelling is `liveQuery(live(GET(fn)), key)`, which the
  router's `onstatus` forwarding already anticipates — and use whichever
  holds in both the thread and the layout. Then: template and binding fills
  in place; post-hydration takeover delivers into the adopted instance;
  navigating `/t/a` → `/t/b` closes the old channel and mounts the new one
  under the route's `Loading` without flashing the layout.
- **C3 — Live layout route.** `serverRouteComponent(liveQuery(…))` as a
  pathless layout: a re-yield (a new title) morphs the sidebar and leaves
  the outlet's instance mounted — the composer's draft is in it.
- **C4 — Claimed forms in live frame content.** V3 holds for frames;
  confirm it across live re-renders: a Stop form morphed mid-submission
  keeps its bound action and its `aria-busy`.
- **C5 — A job outlives its request.** Nothing in the server-function
  runtime disposes work started from an action that has returned, and
  nothing warns about it (the job writes `db`, never a signal, so
  `SERVER_WRITE` should not fire). Confirm on both the dev and prod
  surfaces.
- **C6 — The cost of moment 2.** Measure the full-snapshot morph after
  adoption on a long thread. This is the measurement §10.5 asks for before
  building document-face ledger seeding; `chat` is a better subject than
  `room`.

## Spikes (planned 2026-10-12, not built)

`board` was built first (decided 2026-10-12). C1, C2, C4 and C5 were checked
as throwaway changes to `examples/room`, so that a failure starts
its framework work while `board` proceeds. One scratch branch, never merged; each result
is recorded against its item above as holds or fails, with what was seen.
A failure is filed as a gap in the grid plan, not worked around. C3 and C6
need the app and wait for it.

In this order, since each builds on the one before:

1. **C5 — job outlives request.** No UI. Add `startJob(room)` to
   `sources.ts`: it starts a module-level loop that posts a row every
   500 ms ten times, and returns at once. Call it from the composer. Pass:
   rows keep arriving after the call's response has closed; closing the
   tab mid-job and reopening shows the later rows; no warning in the
   server log. Run on `pnpm dev` and on `pnpm build && pnpm start`.
   _Holds (2026-10-13, a throwaway branch, `next` at
   `1365d31a2`, Chromium, the room's `/` page). The call answered in under
   10 ms; rows then arrived one every 500 ms for five seconds, on `pnpm dev`
   and on `pnpm build && pnpm start` alike. Leaving the page after two rows
   and returning six seconds later showed all ten. Nothing warned in the
   server log._
2. **C2 — `liveQuery` over a component with client positions.** Wrap
   `roomPanel` both ways (`liveQuery(fn, "room")` over a plain
   component-returning function, and `liveQuery(live(GET(fn)), "room")`),
   move the room from `?room=` to a `/r/:room` param route, and mount it
   from the route component with the composer fill. Pass, for whichever
   spelling holds: the render stays live (a post from a second tab morphs
   in); the composer fill is in place and keeps its draft; view source has
   the transcript and the network tab shows one connection after
   hydration; `/r/lobby` → `/r/design` closes the first stream and opens
   the second without the header flashing; `status()` reports a chaos
   reconnect.
   _Holds for `liveQuery(live(GET(fn)), key)`; the plain `liveQuery(fn, key)`
   spelling is not the live loop (2026-10-13, a throwaway branch,
   `next` at `1365d31a2`, Chromium, `/r/:room`). With the nested spelling:
   the document carries the transcript and completes; after hydration
   `status()` reads `connected`; a post lands as a morph that keeps the
   panel, the composer input and its draft; `/r/lobby` → `/r/design` aborts
   the first stream and opens the second with the header's element kept and
   no fallback shown; with `CHAOS_EVERY=2500` the render number climbs every
   2.5 s with no fallback, posts still arrive and the draft stays. With the
   plain spelling the page renders and posts still morph in, but `status()`
   reads `closed` from the start and the chaos knob never touches the
   response (the render number never changes), so it is an undeclared
   streaming answer: no reconnect was observed because no death could be
   forced. Use the nested spelling in the thread and the layout._

   _Found on the way: the composer slot is keyed by position, so a draft
   typed in one room is still in the field after navigating to another. In
   `chat` that would carry a draft from one thread into the next. The
   composer has to be keyed by thread id, or keep its drafts by id._
3. **C4 — claimed form across a live morph.** In `room-panel.tsx` render
   `<form action={clearRoom.with(room)}>` where `clearRoom` waits two
   seconds. Submit it, and post from a second tab while it is pending so
   the panel morphs. Pass: the form keeps `aria-busy` for the whole
   submission, the action's client half ran (a `console.log` before its
   first `yield`), and the same button works again afterwards. Repeat with
   `CHAOS_EVERY=1000`.
   _Holds (2026-10-13, a throwaway branch, `next` at `1365d31a2`,
   Chromium, dev server). A server-rendered
   `<form action={clearRoom.with(room)}>` inside the live panel, its action
   taking two seconds. Sampled every 200 ms: the form carried
   `aria-busy="true"` for the whole submission while two posts morphed the
   panel around it, it was the same element throughout, the router
   submitted it in place (no navigation), and a second submission worked
   the same way. With `CHAOS_EVERY=1000` the panel re-rendered twice during
   the submission and the result was the same. Checked by the attribute
   and the outcome; the action here has no client-side generator, so "its
   client half ran" was not checked separately._
4. **C1 — echo and settlement in one apply.** On top of 2: the panel
   passes `seen={ids()}` (a memo over the transcript's ids) to the
   composer slot; the composer gets the outbox and
   `yield until(() => props.seen.includes(id))`. Add 300 ms to `send` so
   the pending state is visible. A `MutationObserver` on the panel logs,
   at every callback, how many elements carry the sent id. Pass: the count
   is 1 at every observation from submit to settle — never 2 (bubble and
   row) and never 0 — over twenty sends, and again under `CHAOS_EVERY`.

   _Does not hold as written; holds with one change (2026-10-13,
   a throwaway branch, `next` at `1365d31a2`, Chromium, dev server,
   20 sends per run, `send` delayed 300 ms). The bubble and the server's row
   carry the same `data-id`; a `MutationObserver` recorded how many elements
   had it._

   - _As planned (the bubble leaves only when the action settles after
     `until(() => props.seen.includes(id))`): 20 of 20 went
     bubble → **row and bubble** → row. The `seen` arg reaches the composer
     at the same time as the row (measured 0.4–2 ms before the observer saw
     the row), but the bubble leaves 1–2 ms after it, in a later task — a
     microtask loop of 20,000 turns did not outlast it. Never neither._
   - _With the outbox also filtered by `seen`
     (`outbox.filter(m => !props.seen.includes(m.id))`): 20 of 20 went
     bubble → none → row, and the none state was gone within the same task,
     so nothing can paint in between._
   - _With `CHAOS_EVERY=1500`, 12 sends each: every send landed and no
     bubble was left behind. As planned, 9 of 12 showed both across a task
     and 3 swapped within one; filtered, 12 of 12 swapped within one._

   _Not established: whether a frame is ever painted with both. The browser
   pane was hidden during these runs, so frame sampling was not reliable.
   The finding for the runtime is that an action's optimistic state is
   released a task later than the data its `until` was waiting for. For
   `chat`: derive the bubble's visibility from `seen` and keep the `until`
   for the action's failure and timeout._

## Decisions (open)

- **D1 — Composer as a server-positioned template slot** (recommended:
  `until` reads `props.seen` in the same component, and draft survival is
  already proved) or a client component beside the thread, which needs the
  thread's ids shared out of a fill — a §9.2.3 ergonomics finding to raise
  rather than code around.
- **D2 — Sidebar live** (recommended: titles and running marks change
  without this tab) or a bounded `query` refreshed by this tab's mutations.
  Live costs a second connection per tab.
- **D3 — The real adapter's API.** Anthropic's Messages API, or the
  OpenAI-compatible chat-completions shape (one adapter reaches many hosted
  and local models). One adapter either way; the env names follow the
  choice.
- **D4 — Storage default.** Memory with file opt-in (recommended: matches
  `notes`, nothing to clean up) or file by default.
- **D5 — Titles.** First line of the first prompt (recommended: no second
  model call, nothing to fail) or a model-generated title after the first
  reply, which is what products do and is a second job per thread.
- **D6 — Rename's rejection.** §9.6 (A): `required maxlength` on the field
  and a returned `{ error }` read through `useSubmissions` (recommended;
  rare and generic), or (B): the header as a bounded sibling address whose
  single-flight response renders the error — which would take the title out
  of the live render and lose moment 3's rename.

## Build order

Each step is a commit that runs.

1. `server/` — db, watchers, generations, fake adapter, orphan
   reconciliation. Checked by a script, with no UI: start, stop, fail,
   restart.
2. Thread route — live server component, markdown, Copy, Stop, the composer
   slot sending without optimism. C2, C4, C5.
3. Optimism — outbox, `until` on `seen`. C1.
4. Layout and `/` — live sidebar, create-and-redirect, titles, rename,
   delete, regenerate, retry. C3.
5. The real adapter (D3).
6. README — coordinate, twin, the moments; `check` script; C6 measured and
   recorded here. The grid plan's `chat` entry and Handoff item 1 updated.

Not part of this plan: `room`'s deletion (waits for `board`), anything
under G1/G2/V5.

## Public API

None expected. A step that needs a framework change stops and records it
as a gap in the grid plan, as the grid plan's rule requires.
