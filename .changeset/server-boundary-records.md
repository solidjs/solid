---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

Server boundary records on `OBSERVE.server.records` (observe/dev tiers)

- New `"boundary"` record: one per `<Loading>` boundary that waited during a server render, delivered when it settles — `{ id, at, durationMs, heldMs, passes, outcome: "settled" | "fallback" | "client" | "error", streamed, revealGroup?, ownerPath? }`, with the thrown error beside it. `id` pairs it with `SSR_RENDER_ERROR_CONTAINED`; `passes` counts render passes (a sequential chain reads as `3+`); under a `<Reveal>` group the record waits for the group's swap so `heldMs` measures how long finished content was held for its siblings. No clock is read without a listener, and the emitter folds out of prod.
- The server records channel is `OBSERVE.server.records.subscribe(type, listener)` — the server twin of `OBSERVE.attribution.subscribe(type, …)`. `OBSERVE.server.invocations` (unreleased) is renamed onto it: `subscribe("invocation", …)`. The `InvocationChannel` type is gone; `ServerRecords` is the channel's interface.
- Types now layer one augmenter per interface: `@solidjs/signals` declares `ServerObserve` empty; `solid-js` augments it with `records: ServerRecords` and `trace: ServerTrace`, declaring both; `@solidjs/web` augments those two through `"solid-js"`. `TraceSlot` in `@solidjs/web` is now an alias of `solid-js`'s `ServerTrace`. (Two augmentations of one re-exported interface through different module aliases merge order-dependently in TypeScript — one set was silently lost.)
