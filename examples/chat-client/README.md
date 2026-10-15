# Chat — client-owned streaming

An AI chat the browser owns. A `"use server"` async generator streams text
deltas; the browser writes them into a store, one write per chunk, and
renders the reply from that store. It is the guide-shaped pattern most apps
will reach for, and the simple twin of [../chat](../chat), where the server
owns the markup and generation is a durable job.

```sh
pnpm dev                       # http://localhost:3012/
pnpm build && pnpm start       # production harness, http://localhost:3012/
pnpm test                      # the acceptance test (vitest, jsdom)
```

With nothing configured it talks to a simulated model, which is enough to
see everything below. [src/server/model.ts](./src/server/model.ts) marks the
ten lines where a real SDK call goes; nothing in that file reaches the
browser, because it is only ever imported from a `"use server"` body.

## The pattern

[src/chat.tsx](./src/chat.tsx) is the whole screen. Three pieces of state,
and one place that writes each:

```tsx
const [turns, setTurns] = createStore<Turn[]>([]); // the conversation so far
const [asked, setAsked] = createSignal<string>(); // the question being answered

// The reply being written: a store the server function's deltas are
// written into. Asking again re-runs this, and the previous run's iterator
// is closed through `return()`.
const answer = createProjection(
  (draft: Answer) => {
    const question = asked();
    draft.blocks = [];
    draft.done = false;
    if (question === undefined) return;
    return write(draft, [...untrack(() => snapshot(turns)), { role: "user", text: question }]);
  },
  { blocks: [], done: false }
);

async function* write(draft: Answer, history: Turn[]) {
  for await (const delta of await reply(history)) {
    append(draft.blocks, delta); // one store write: the last block's text
    yield; // lands it
  }
  draft.done = true;
}
```

`reply` is the server function ([src/server/reply.ts](./src/server/reply.ts)):

```ts
export async function* reply(history: Turn[]) {
  "use server";
  yield* model.stream(history, getRequestEvent()?.request.signal);
}
```

- **Every chunk is one store write**, to the text of the last block. The
  reply is rendered from the store with `<For each={answer.blocks}>`, keyed
  by the block objects the store keeps stable, so a chunk reaches one text
  binding and the blocks before it are never touched again. The acceptance
  test asserts exactly that (below).
- **Nothing is an effect.** A reply becomes a turn when the next question is
  asked or Stop is pressed, in the handler that does that (`keep`).
- **Stop is superseding the read.** `setAsked(undefined)` re-runs the
  projection with no question; the previous run's iterator is closed
  through `return()`, and the request goes with it (next section).
- **`<Errored>` with Retry** wraps the reply; `reset` re-renders the branch,
  which re-reads the projection and so asks again. `<Loading>` shows
  "Thinking…" until the first chunk lands.
- **Markdown** is a tiny splitter on blank lines ([src/markdown.ts](./src/markdown.ts)):
  a block is a paragraph, a fenced code block, or one bullet. No inline
  syntax, no dependency — the point is the shape, a list of blocks with
  only the last one growing.

## The cancellation contract

A client abort cancels the request. On the server, the request event's
`request.signal` fires — in dev the plugin couples it to the connection, and
[server.js](./server.js) does the same in production — and the response's
producers are torn down. **A server function that forwards that signal stops
the generation**; one that does not leaves the model running until its
stream ends on its own.

This example forwards it: `reply` hands `getRequestEvent()?.request.signal`
to the model, so Stop, a new question, and a closed tab all stop the model
where it runs. The browser side needs nothing special for that. When the
projection's iterator is closed, the client runtime aborts the fetch behind
the streamed result — closing the stream *is* the abort.

The explicit form is `invoke`, for when the caller owns the wire — a
deadline, say:

```ts
import { invoke } from "@solidjs/web/server-functions";

const control = new AbortController();
try {
  const chunks = await invoke(
    reply,
    { signal: AbortSignal.any([control.signal, AbortSignal.timeout(60_000)]) },
    history
  );
  for await (const delta of chunks) { /* … */ }
} finally {
  control.abort(); // a caller-supplied signal owns the wire: closing the
} //                  iterator no longer aborts the call by itself
```

A **durable job** — [../chat](../chat)'s shape — deliberately does *not*
forward the signal. There, sending a message starts a job the server owns,
the request returns at once, and the reply is written into storage whether
or not anyone is watching; Stop is a separate action that aborts the job.
Closing the tab loses nothing, and two tabs see the same reply. Which
contract an app wants is a product decision: this example is the
**request-scoped** one — the reply lives as long as someone is reading it.

## The acceptance test

[test/chat.test.tsx](./test/chat.test.tsx) drives the screen against the
fake model, with the server function running in-process (vitest, jsdom,
fake timers), and captures the run with `@solidjs/diagnostics`:

- `expectNoDiagnostics` — the run tripped no rule;
- `expectRerunBudget(artifact, CHUNKS, { scope: /\.children$/ })` — across
  every block, the text bindings re-ran at most once per chunk, so the
  completed blocks' never did;
- `expectRerunBudget(artifact, BLOCKS + 1, { scope: "<For>" })` — the lists
  re-ran only when something was added to them;
- `expectNoWaste` — nothing re-ran to arrive at the value it already had;

plus Stop (the stream is closed and what arrived is kept), a new question
superseding a reply, and a failed reply with Retry.

What the test does not cover is the wire: that a client abort fires
`request.signal` on the server is the runtime's contract, exercised by its
own suites. See it in dev: `CHAT_PACE=300 pnpm dev`, ask something, press
Stop, and in the network panel the `/_server` request is cancelled at that
moment — the server's side of that is `request.signal` firing in `reply`.

## Notes

- The simulated model answers every question the same way, a word at a time
  (`CHAT_PACE=<ms>` sets the gap, default 40). A question containing
  `crash` fails part-way the first time it is asked; Retry asks again.
- A failed reply is replaced by the boundary's fallback: what had arrived is
  not kept. The durable twin keeps it, as a fact about the thread.
- Not here: persistence, threads, accounts, inline markdown. Reload and the
  conversation is gone — it lives in the browser.
