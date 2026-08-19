# solid-js

## 2.0.0-rc.1

### Patch Changes

- 3c68ab2: lazy() no longer caches rejected module promises: a failed chunk download retries on the next mount or preload() on the client (so Errored reset() flows work, matching the platform's re-fetch of failed dynamic imports), and a transient import failure on the server no longer poisons every subsequent SSR request for the process lifetime. Failed loads also no longer surface as unhandled rejections. (#2999)
- 62e7883: Fix blank page when an async read rejects before the SSR shell flushes under
  `Errored > Loading` (#2997). The fragment channel now owns the error once the
  boundary has registered: `<key>_fr` rejects and the client re-renders the
  subtree as fresh DOM (adopting the serialized rejection), letting the
  client-side Errored catch it — matching post-flush semantics. Previously the
  server also invoked the enclosing Errored's handler at async time; its
  rendered fallback had no consumer, and the error record it serialized at the
  boundary id made the hydrating client try to claim fallback DOM that was
  never emitted, derailing hydration into a permanently blank region. Also
  defuses the two client-side unhandled-rejection leaks in this flow (the
  serialized rejected flight consumed via its stamp, and the trace-run promise
  in `subFetch`).
- 4f84cd5: Server `createMemo` now honors the internal `transparent` (and explicit `id`) options when creating its owner, matching the client's id inheritance. Previously a transparent memo consumed a child-id slot on the server but not on the client, shifting every subsequent sibling hydration id — unclaimed DOM and dead bindings after the component (#3012).
- 8366208: Server async convergence hardening (#3003). Async reads that hand back a
  fresh promise per call (e.g. the router's `query()` cache-hit `.then()`
  wrapper) defeated the promise-stamp adoption during boundary retry
  discovery: every pass re-suspended with a new deferred, looping at
  microtask speed until the process ran out of memory. The render context now
  keeps a per-slot flight record keyed by owner id — re-creations of a slot
  join the existing in-flight deferred (one serialization per slot, ever) and
  adopt settled answers synchronously. A settled answer always resolves the
  serialized deferred even when the computing node was superseded and
  disposed, so the response stream can always close (previously a superseded
  pass's serialized deferred dangled and held the connection open forever).
  Discovery is additionally capped by a retry budget that fails the boundary
  loudly instead of looping unbounded.
- 66accfb: Flatten one async level for computations: a promise that resolves to an AsyncIterable is now consumed as the stream itself rather than settling on the iterable object. `createMemo(() => serverFn())` works directly when the async stub resolves to a stream — no `yield* await` wrapper needed. Client core (`handleAsync`) pumps the resolved stream under the original flight's identity with iterator close registered on the flight's disposal; SSR mirrors with first-yield settle, first-value lock, a tapped stream on the serialized promise channel (which client hydration adopts and flattens again), hybrid first-value-and-close, and the frame binding-ledger pump.
- 56ca647: `lazy()` and `clientOnly()` accept an `{ export }` option to select a named export of the resolved module (defaults to `default`). The export name is a call-site literal available in both bundles, so lazy hydration still resolves the component synchronously from the preloaded module — wrappers that pick an export at runtime inside the import thunk remain unsupported and now fail loudly in dev. `lazy()`'s bundler-injected `moduleUrl` moves to the third argument to make room, matching `clientOnly()`.
- 366da09: Live sources get automatic SSR policy (auto-hybrid)

  A `live()`-declared server function's iterable is branded a standing answer (every yield is the complete current value; the source re-yields current state on any invocation). SSR now detects the brand and applies the right lifecycle without any `ssrSource` declaration:
  - **Document face**: takes the first value, closes the iterator, and serializes a plain value — instead of streaming an unbounded source into a response that never closes. The brand selects hybrid under server mode whether defaulted or declared ("server" has no meaning for a standing answer).
  - **Client takeover**: the hydration adoption path's existing trace run detects the brand and arms a shared post-hydration gate — the node adopts the serialized t=0 value for the claim walk, then re-runs its compute to reconnect, serving the stale value until the first live yield lands.
  - **Stream face**: inside a server-owned frame render the scope-gated commit pump keeps the standing answer connected — the brand does not close it there.

  Declared `ssrSource: "hybrid"`/`"client"` behave as before; unbranded iterables keep their bounded-trace semantics on every path.

- 254daf8: Serialize a boundary's lazy-module map (`<id>_assets`) as a snapshot (`{ ...modules }`) instead of the live object in `commitBoundaryState`. The map can gain entries after the boundary's first serialization (a nested lazy registering post-flush), and the streaming serializer's reference dedup would re-emit the same mutated object as a back-reference to the stale first snapshot, dropping the later entries and halting lazy hydration on the client. Defense-in-depth alongside the same fix in dom-expressions' `serializeFragmentAssets`; server-only, no client bundle impact.
- Updated dependencies [a7780c7]
- Updated dependencies [57cc98b]
- Updated dependencies [fcfaf0f]
- Updated dependencies [37dc307]
- Updated dependencies [66accfb]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
- Updated dependencies [0797215]
  - @solidjs/signals@2.0.0-rc.1

## 2.0.0-rc.0

### Minor Changes

- 427dc18: Bare `ssrSource: "client"` (no `loadingValue`/`seedLoadingValue`) is now the structural form instead of a dev error: on the server the source is a final hole — reads suspend the nearest `<Loading>` boundary, which flushes its fallback with the client-continue marker (or rejects its stream fragment when the hole surfaces after registration) and hands the position to the client, which renders the content fresh after hydration. Read outside a `<Loading>` boundary it throws a real error instead of hanging the stream. The declared form is unchanged: `loadingValue`/`seedLoadingValue` renders the declared first paint on the server and stays the value-channel alternative. Also swallows the settled-rejected fragment promise at the hydration claim so rejected fragments (error finalize or client handoff) no longer surface unhandled-rejection noise.

### Patch Changes

- 667a020: Deduplicate the pre-hydration gate lifecycle shared by the ssrSource client/hybrid branches (signal, store, and effect shapes) into one helper — no behavior change, recovers ~40 B brotlied in store-carrying hydrating bundles.
- d9050a8: Hybrid async-iterable takeover for signal-shaped nodes (#2993). `ssrSource: "hybrid"` on a `createMemo`/`createSignal(fn)` async generator serializes only the server's first yield — the client is supposed to continue the iteration, but signal-shaped nodes adopted that first yield and latched there forever (stores already re-ran their generator through the shadow-draft takeover). The client now re-runs the generator once hydration adoption completes: its first yield reproduces the server value and subsequent yields apply live. Sync and promise-shaped hybrid computes keep their adopt-the-serialized-value semantics.
  - @solidjs/signals@2.0.0-rc.0

## 2.0.0-beta.34

### Patch Changes

- f14e4ec: Fix the dev-streaming SSR livelock behind beta.33's hang/OOM on lazy routes
  under layouts. With an async asset resolver (the dev-server manifest shape),
  `lazy()` armed a fresh `assetsPending` gate on every component re-creation
  even after its module and assets had settled: the per-request `_lazyAssets`
  cache memoized the resolver's PROMISE forever (each new wrap chained `.then`
  off an already-resolved promise — pending at the render memo's compute,
  settled one microtask later), and the moduleUrl-less path chained `p.then`
  per creation with the same geometry. Any pattern that re-creates the lazy
  component across suspended render passes — a route layout's outlet, or any
  recomputing parent — then threw `NotReadyError` on a gate that resolved
  immediately after, and the boundary resume loop re-rendered forever on the
  microtask queue: timers starved, hydration ids and serializer state grew
  without bound, and the dev server died on V8 heap exhaustion (~30s per
  request). The 0.50.0-next.41 retry-wrapper flattening exposed this: the old
  per-pass wrapper stacking happened to bound the loop by side effect.
  Production manifests answer synchronously and never enter the async branch,
  so only dev-mode streaming SSR was affected. Both gates now settle
  structurally: the cache entry upgrades to the resolved value when the
  resolver settles, and a re-creation after the module import settled reads
  `$$moduleUrl` synchronously instead of chaining another promise hop. This
  should ship as beta.34 promptly — beta.33's dev streaming SSR is unusable
  for lazy routes under layouts (the solid-router fullstack shape).
  - @solidjs/signals@2.0.0-beta.34

## 2.0.0-beta.33

### Minor Changes

- ce8e46b: SSR support for `loadingValue` / `seedLoadingValue` — the server flushes commit #0 and the client hydrates with it. A loading-value memo (or seeded derived store) never suspends on the server: markup renders from the loading value (the boundary never trips), the landing streams to the client as data, and the hydrating node is born committed with the same loading value, so the claim walk matches the server markup by construction; the serialized landing then closes the window on both sides right after hydration. The first-value lock generalizes to commit #0: HTML-visible reads stay at the loading value for the whole response (later renders in the same stream can't tear against already-flushed placeholder markup), and every landing after the placeholder flushed ships as data — including synchronous landings after a NotReady retry, the one exception to "sync results are never serialized". On the client, a settled serialized landing is handed to the async runtime as a thenable instead of unwrapping synchronously, so commit #0 also serves through the claim walk when the response was fully loaded before hydration began. `ssrSource: "client"` sources flush the loading value too, matching the prev-serving hydration wrapper on the client.
- 536dec5: Require a declared commit #0 for `ssrSource: "client"` (#2981). The server cannot run a client source, so the author must say what the pre-compute window renders: `loadingValue` on signal-family sources (`createMemo`, function-form `createSignal`/`createOptimistic`; an explicit `loadingValue: undefined` is a valid declaration — put the undefined in the type and branch on it), `seedLoadingValue: true` on store-family sources (`createProjection`, derived `createStore`/`createOptimisticStore`; the seed is what the window shows). Effects are exempt — nothing renders from them.

  Enforced at the type level (the bare `"client"` overloads are gone) and with a runtime error naming the fix — behind the dev flag on the client (zero production bytes; prod falls back to the previous gate behavior), always-on in the single-build server entry, where the implicit promotion would flush into markup. `Portal`'s internal client-sourced memos now declare `loadingValue: undefined` ("server renders nothing" is their honest commit #0).

### Patch Changes

- f3accb3: Container tier at the slot border (DR-2 case 3): projections passed as slot args to server components cross as bounded async traces — one snapshot, then PatchOp batches — and materialize on the client as live read-only projections. Server: the projection trace registry (`getProjectionTrace`) with a multi-consumer shared pump (one source iterator drives an append-only patch log; hydration resume and every slot crossing replay from their own cursor, snapshots captured only at stable pull boundaries). Client: `materializeContainerTrace` — a projection fed by the trace under its own root; the container reference is available synchronously, reads into it suspend until the snapshot (the fill's own `<Loading>` covers them), patch batches apply granularly, the trace's end latches the last state. The frames client installs the materializer, revives document-face `{ $tr, $ta }` marker literals at arg-read, and classifies containers FIRST and trap-safe (a pending projection's property probe throws not-ready): the slot props proxy returns the store instead of async-probing it, and the record-dedupe compare identity-tests containers through the host's `isContainer` hook.
- 8923ac6: Shrink CSR bundles by moving the hydration-phase coordination seams (`sharedConfig.isHydrationInProgress` / `sharedConfig.onHydrationEnd`) out of the `sharedConfig` object literal and into `enableHydration()`, matching the null-slot pattern every other hydration hook already follows. Declaring them in the literal retained their bodies and the hydration-phase bookkeeping they close over (`_pendingBoundaries`, `_hydrationDone`, the callback list) in every client bundle; installed by `enableHydration()` they shake out of pure-CSR builds (≈100 B brotli on the CSR size scenario, ≈80 B on the minimal-app floor). Both fields were already typed optional and documented as cross-package internal wiring; consumers treat absence as "not hydrating" — the refresh runtime already optional-chains, and `clientOnly` now falls back to a bare `queueMicrotask`, which is byte-for-byte the behavior `onHydrationEnd` itself had outside hydration.
- 3bcce84: Document-face live holes (Stage 4): `inServerComponentScope` gates live-hole arming and the iterable-memo pump to server-component render barriers on the document face, and the frames client pumps the `sc:live` channel record — one module-level reader broadcasting hole/attr ops to every adopted boundary (geometry routes; a log replay catches up boundaries that adopt after ops arrived, and call-driven streams supersede document ops).
- 23657d2: Fix signal-shaped async-iterable hydration losing buffered yields when the stream completed (or advanced multiple resolutions) before client hydration began. `normalizeIterator`'s greedy batching loop advanced `latest` unconditionally, so when the buffered backlog ended in the stream's `done` result — seroval's deserialized streams buffer it synchronously right behind the data — the loop returned `{ done: true }` and every yield after the first was discarded: the hydrated `createMemo` / `createSignal(fn)` / `createOptimistic` stayed on the first resolution forever, while the store replay path (`hydrateStoreFromAsyncIterable`) correctly applied all buffered yields under the same conditions. The batching loop now tracks the last data yield separately (mirroring the store path's `if (!r.done)` guard), delivers it as the batch's value, and hands the done result to the following pull. Replay semantics are unchanged otherwise: the buffered backlog still conflates to its latest yield in one visible update — the same final state the store path's batched patch application produces — and live post-hydration yields still apply one at a time.
- a37611e: Fix store-shaped async-iterable hydration orphaning server-rendered DOM when the stream's yields were already buffered before client hydration began (delayed client script). `hydrateStoreFromAsyncIterable` applied the buffered patch backlog synchronously inside the very pull that hydration's claim pass triggers (`Repeat` reading the projection's `length` drives it), and because a projection's draft writes stage in the store's override layer until the firewall commits, write-time snapshot capture recorded the still-uncommitted seed — not the first-yield state the SSR DOM shows — as the pre-write base. Any claim pass running after the batch then hydrated against pre-stream state (length 0), claimed nothing, and rebuilt every row fresh: the server-rendered row survived unclaimed next to a full set of duplicate client rows. The backlog is now parked until hydration completes (`onHydrationEnd` — a plain microtask when hydration has already finished), which is exactly where a live stream's yields land, so the claim pass hydrates against the SSR snapshot and reuses the server-rendered rows. Conflated-notification semantics are unchanged: every synchronously-available patch still applies in order within one pull, and observers see a single update to the final state; live post-hydration yields still apply one at a time.
- ba7560f: Loading-window integrity fixes (#2988, #2989, #2990): seed-window projections run their derive against a detached shadow of the seed so mid-flight draft writes can never tear through commit #0 (each commit point reconciles a detached snapshot; the server freezes the seed before the derive runs to match); a parked retry on an errored loading-value node no longer replaces the settled error with a NotReadyError; and the window now closes when the first answer becomes observable — direct commits close it immediately, transition-held landings keep it open until the hold commits — so no one-frame isPending pulse can leak to live observers at the landing.
- 28f7bec: Hydrating apps that never use stores no longer ship the store engine (~7 KB gz: the store, reconcile, projection, and optimistic modules). `enableHydration()` used to install a dedicated hydrated implementation per store-family primitive, which statically retained `coreStore`/`coreOptimisticStore`/`coreProjection`/`coreOptimistic` in every bundle that calls `hydrate()`. The families now share generic hydration adapters parameterized by the core implementation: `enableHydration()` installs only the adapters (which reference no store code), and each primitive wrapper passes its own core function in — so the engine rides the import the app already needs to use stores, and shakes when it doesn't. No API change and no action required: `sharedConfig.hydrating` can only become true after `enableHydration()` installs the adapters, so a hydrating store call can never miss its adapter, and with-store hydration behavior (including buffered async-iterable replay and its deferred patch backlog) is byte-for-byte the same logic, just reached through the adapter slot. The no-store hydrating size scenario drops 22.60 → 15.83 KB brotli; the with-store scenario and the CSR scenarios are unchanged within noise.
- 09e2d3b: Server support for live markup holes (Stage 3): `creationStamp()` exposes an owner-creation counter the live-holes engine uses as an impurity gate, boundary output accessors (`Loading`, error boundaries) tag `$lhSkip` so boundary machinery is never treated as a re-runnable hole, and the async-iterable memo pump acquires the response-window hold (`ctx.hold()`) so iterable-fed holes stream every value before the response closes.
- 913913a: Size pass over the loading-window (loadingValue/seedLoadingValue) client code: the unready-source parking sequence dedupes into one shared `parkLoadingWindow` helper (used by recompute's catch and handleAsync's handleError), the repeated `instanceof NotReadyError` tests in recompute's catch hoist into one boolean, and the window-clear writes at landing points become unconditional stores. The hydration entry stops precomputing the window flag per wrapper — options thread through to `readHydratedValue`, which does the check at read time. Behavior unchanged. The signals size gates ratchet for the feature itself (core floor 7.1 -> 7.35 KB, isPending 8.75 -> 9 KB, measured 7.18 / 8.84): the window support rides always-retained memo paths by construction (it's an option, not an import), so its ~110 B brotli cannot tree-shake.
- c320429: Harden the loading window across every ssrSource mode, pinned by a full parity matrix (thenable/iterator × server/hybrid/client × memo/store, in loaded and streamed replay). Two hydration fixes fell out: a fully-buffered iterator replay delivered its first yield synchronously, closing the window mid-claim (the memo replay now defers the first yield one microtask when a loading window is open, keeping sync delivery for windowless nodes whose claim needs the value); and the buffered store replay applied the first-yield snapshot synchronously at claim — correct for windowless stores where the snapshot IS what the SSR DOM shows, but a seed-window store's DOM shows the SEED, so the snapshot now parks until hydration completes alongside the patch backlog. Types learn commit #0: `loadingValue` overloads on createMemo/createSignal/createOptimistic (client and server runtimes) drop `undefined` from the accessor — including `ssrSource: "client"`, where the loading value covers the pre-compute window — and type `prev` as `T`, matching the signals core.
- 766ea30: Keep the loading window open through the `ssrSource: "client"` hydration gate. The gate's synchronous prev-return counted as the node's first real answer and closed the loading window, so the post-hydration compute — the node's actual first question — reported `isPending: true`, unlike the same source on a fresh CSR mount. The gate now returns a never-settling flight for loading-window sources (`loadingValue` / `seedLoadingValue: true`): commit #0 serves verdict-quiet until the first real flight lands, and only then does refetch work become pending-class. Signal and store families both.
- af1c71e: SSR robustness against pathological retry loops (SSR stack-overflow diagnosis amplifiers). `lazy()` now memoizes `resolveAssets(moduleUrl)` per request via an internal `HydrationContext` map — component bodies re-run on every suspended render pass, and dev-server manifest resolvers do real work per call, so re-asking multiplied that work by the retry count times every lazy() on the page (only the resolution is cached; per-boundary asset attribution is unchanged). And real errors surfacing during boundary/root-hole retries are now contained instead of escaping as unhandled rejections that kill the process: `finalizeError` routes handler-less errors through the renderer's new `failRender` seam (report via the render's `onError`, wind the render down), and `ssrHandleError` no longer masks the original error with a `NoOwnerError` when a retry pass re-pulls a hole from an ownerless flush microtask.
- ab5f83c: Promote the `transparent` option on effects to typed, documented public API. The runtime has always honored it on `createEffect`/`createRenderEffect` — a transparent node is invisible to the hydration id scheme (it inherits its parent's id instead of consuming a child slot) and its compute runs live during hydration instead of adopting the serialized server value — but the flag was absent from the published `EffectOptions` type (typed only on `MemoOptions`) and documented nowhere, forcing integrations to cast on faith (`@solidjs/router` ships `{ transparent: true } as {}` on its client-only link-state and scroll-restoration effects). It exists for client-only reactive nodes created while hydrating, which have no server-rendered counterpart and would otherwise shift every later sibling's hydration id, and it is the supported alternative to branching on hydration state, which freezes whatever the first run decided. SSR ignores the option (server-side nodes always allocate their id slot), so it is documented for nodes the server does not create. Types, JSDoc, and RFC 05 docs only — no runtime change; every size scenario is byte-identical.
- d7f95bb: Truncation sweep covers every pending registry ref, not just `_fr` boundary declarations. The #2958 sweep released hanging boundaries, but a dropped stream also strands the registry's plain serialized promises — owner-id computation values and library-keyed data refs (e.g. @solidjs/router's query channel) — as never-settling: a keyed consumer that adopted one (the router consumes one-shot and deletes the key) awaited it forever with no rejection to recover through, and a late reader adopted a promise that could never settle. At DOMContentLoaded every still-pending seroval resolver is dead (the settle scripts execute during parse), so the sweep now walks the cross-reference scope (`self.$R`) and answers per consumption state: promises already claimed out of the registry reject through their resolver (the bare promise is the only channel left to that consumer, and its `.then` chain handles errors), while entries still registered are deleted so future presence checks fall through to a fresh compute/fetch instead — rejecting those raw would land an unhandled error inside live owner-id adopters that no boundary can route (the fragment pass has already released the boundaries) and halt the reactive system, which is also why the sweep runs a macrotask after the fragment pass: boundary teardown must dispose its hydration-time adopters before the rejections land.
- Updated dependencies [b37d19a]
- Updated dependencies [ba7560f]
- Updated dependencies [521b73d]
- Updated dependencies [913913a]
- Updated dependencies [aa5b96e]
- Updated dependencies [ab5f83c]
  - @solidjs/signals@2.0.0-beta.33

## 2.0.0-beta.32

### Patch Changes

- af97611: A `<Loading>` inside a server component now reveals on document SSR (#2978). A deferred fragment whose producer ran on the SERVER has no client boundary to ever register as its claimant, so a `$df` settling after hydration completed was held forever by the held-swap policy (#2964) — fallback frozen on screen — while the frames classification gate (#2968) deferred on the very `fr.pending()` answer that hold kept true: a deadlock between two individually-correct policies. The fragment ledger now exposes the claimant contract (`_$HY.fr.claim`/`release`, the same one Loading boundaries use internally), and the frames document adoption — which owns the markup it adopts wholesale — goes on record as the claimant for every `pl-*` placeholder in its region: at adopt time, again for content revealed into the region later (an outer fragment's payload can carry a nested pending one), retiring its claims when the frame disposes. The secondary defect is fixed in the ledger itself: content whose placeholder range was removed (a refetch morphed over the region before the document delivered) can never swap, so it no longer keeps `fr.pending()` reading "in flight" for the rest of the page's life.
- dc7b5c2: Fix hydration id drift from allocation-capable prop getters in flow controls (#2976)

  A compiled conditional prop (`when={a ? x : b ? y : null}`) allocates a
  condition memo every time the getter is evaluated, under whichever node is
  reading. The server flow controls compensated for the client's internal memo
  slots with bare id burns, but evaluated the getters themselves under a
  different internal node than their client twins — so the getter's allocation
  landed in a different owner's id space on each runtime and drifted every
  hydration id assigned after it (unclaimed nodes, dead bindings).

  The server twins now evaluate each such getter inside a real node at the
  same child slot as the client: Show reads `when` through a mirrored
  conditionValue memo, Switch evaluates each Match's `when` inside per-match
  conditionValue memos under a mirrored switchFunc memo, and mapArray/repeat
  give the row id space its own owner at slot 0 with the memo at slot 1 so
  `each`/`count`/`from` getters evaluate where the client's computed node
  evaluates them (previously the allocation also shifted the row id base).
  Dynamic and boundary fallback getters were audited and already aligned. The
  compiler output is unchanged. Adds parity-harness scenarios for Show
  (dynamic + static), Switch, For, and Loading fallback ternaries.

- b6071ba: Root-level async head-tag props hold the SSR streaming shell instead of being warn-dropped (#2975 follow-up). `ssrHandleError` gains a side-effect-free probe mode (second argument) that the dom-expressions head registry uses to identify pending reads without routing real errors through the handler chain; the settled tag renders in the shell like any other root-level async content.
- 3fd0499: Server memos participate in the frame sink's binding ledger (DR-2 case 1, watched slot args). Frame renders install two hooks on the SSR context and the server reactive core now honors them; both are absent outside frame renders, where nothing changes:
  - `ctx.commit` — settle sites poke it: a promise memo resolving or rejecting, an iterator memo's first value, mutations those settles made. A server-owned render (noHydrate — the HTML is the data) serializes nothing, so without the hook these settles were invisible to the sink's commit funnel and watched slot args latched at first success.
  - `ctx.commitEpoch` — per-epoch memo caching: sync-valued memos (the sync fast path and full memos whose last result was plain) cache within one sweep and recompute when pulled after a later commit, so a watched arg's re-evaluation reads current derivations instead of the first render's cache. Async results are exempt — their values advance through their own settle machinery, and re-running them would mint new promises/iterators.
  - Iterator memos get a ledger-gated pump: in a server-owned render nothing consumes the iterator past the first value (there is no serialization tap), so when `ctx.commit` exists the core keeps pulling — each yield advances the memo's value and commits. The pump never holds the response open; completion latches the last yield. The document-SSR tapped path deliberately keeps the first-value lock: markup rendered from V1 must keep reading V1 or a mid-stream boundary retry desyncs the HTML from hydration's replay.

- Updated dependencies [1313447]
  - @solidjs/signals@2.0.0-beta.32

## 2.0.0-beta.31

### Patch Changes

- a60b288: Fix `ssrSource` on derived stores during SSR: the server `createStore` dropped the options argument entirely, so `ssrSource: "client"` sources still ran on the server (#2972) and `ssrSource: "server"` async sources were not awaited or serialized (#2971). Sync sources are unaffected: their code is the value transport, so the client re-runs them on hydrated inputs as before.
- 40b05e1: One reveal owner for streamed document fragments (DR-4): the hydration
  runtime now keeps a fragment ledger — declarations are the serializer's
  `<id>_fr` records, settlement is seroval's status marks, reveals are the
  inline script's `_$HY.v` marks — published as `_$HY.fr` ({ pending,
  subscribe }). The frames client's document adoption reads "may a boundary
  still arrive" and learns of reveals from the ledger instead of scanning the
  page for `pl-*` templates and monkey-patching `_$HY.fe`. The ledger also
  detects truncation (#2958): a declaration still unsettled when the parser
  finishes is marked rejected with a truncation error, releasing its boundary
  through the normal rejection path instead of hanging on the fallback
  forever, and letting document-adoption waiters give up and mount fresh.
- 15b512f: Accept ref array in component ref type
- Updated dependencies [0cd35f0]
  - @solidjs/signals@2.0.0-beta.31

## 2.0.0-beta.30

### Patch Changes

- 51f971b: Server-component boundaries that settle after the shell flush now mount (#2964). A boundary waiting on a pending streamed fragment registers as its claimant (`_$HY.fk`), so the fragment swap proceeds — or is held and replayed at registration — even after global hydration completes, instead of being discarded. The frames claim scope now also engages when a slot's server content is a pending fragment placeholder with no hydratable elements (a plain-text `Loading` fallback), so the deferred fragment resumes with hydration rather than falling through to a fresh client mount.
- 40af691: Own streamed-fragment reveal policy in the hydration runtime. `enableHydration()` installs `_$HY.f`, and every `$df(id)` the stream emits routes through it: swaps proceed while hydration is in progress or the fragment's boundary is on record as its claimant; unclaimed post-done arrivals are held intact and replayed the moment their boundary registers — before any of its paths read the DOM. This replaces the `markFragmentClaim`/`_$HY.fk`/`_$HY.hq` flag protocol from #2964 with a single owner, and closes a hole in it: a held swap arrives in the same chunk that settles the `<id>_fr` ref, so a boundary rendering later took the settled path (which assumes the swap already ran) and never consulted the hold queue.
- c3fa949: Update dom-expressions to 0.50.0-next.35. Pulls in: live slot props (args changes rebind the mounted slot instead of re-creating it), call-site handoff for dynamic's live mount when a server component changes arguments, streamed-fragment reveals routed through the runtime reveal policy (`_$HY.f`) so late-arriving fragments are held for their claimant instead of discarded, and the morph fix that restores displaced slot ranges into wholesale-inserted parents (regrown list rows no longer render blank after clearing a search).
  - @solidjs/signals@2.0.0-beta.30

## 2.0.0-beta.29

### Patch Changes

- 11beaf4: Context barrier at server-component render roots. A server component renders inline in the document at t=0 but standalone on every refetch and mutation region, so an app-context read that resolved a provider at t=0 would silently break on the next response. `runInServerComponentScope` rebuilds the scope owner's context record so both renders agree by construction: user context is severed (default-less `useContext` throws an error explaining the boundary; defaulted contexts read their default), providers rendered inside the server component work normally, and boundary plumbing (`ErrorContext`, `RevealGroupContext`, `NoHydrateContext`) still crosses — Loading/Errored/reveal coordination between server-component content and enclosing boundaries is intentional. Client slot positions are unaffected: they re-enter the zone owner captured outside the barrier, keeping full app context during document SSR.
- 93ea8a1: Update dom-expressions to 0.50.0-next.34. Pulls in: single-flight for frames (`frameTransformFlightResult`, flight codec, per-frame versioning and outcome chunks), per-args boundary identity with host retention so cached server-component calls re-materialize instantly and never collide across argument sets, the server-component context barrier hook, keyed slot ranges relocating correctly across parents during morphs, a frame-client size pass, and the typed `transformFlightResult` seam.
  - @solidjs/signals@2.0.0-beta.29

## 2.0.0-beta.28

### Patch Changes

- @solidjs/signals@2.0.0-beta.28

## 2.0.0-beta.27

### Patch Changes

- 76cb1aa: Fix `dynamic()` and `lazy()` gating the SSR shell flush instead of suspending into their boundary

  Both registered their source promise as a renderer-blocking promise, so the document's first flush waited on it. An enclosing `<Loading>` never rendered its fallback and a slow source stalled the entire document — a 500ms server component pushed the shell from 27ms to 527ms with nothing streamed, and an un-preloaded `lazy()` held the shell for the full module load.

  The pending read now simply suspends, letting the nearest boundary own it and stream the content in behind its placeholder. Where there is no boundary to defer to the read becomes a root hole and the renderer blocks the shell on it as before, so a bare `dynamic()` or `lazy()` still resolves inline. Near-instant sources and preloaded modules continue to inline with no fallback flash.

  For `lazy()` this does not affect asset ordering: `assetsPending` gates the render memo separately, so a fragment still cannot flush before its styles and module map are registered.

  Also adds an internal `serialize: false` option to the server `createMemo`, which keeps a value out of the hydration payload while the subtree still hydrates normally (unlike `NoHydrateContext`, which opts the subtree out entirely and suppresses the id allocation needed for client parity). It carries the contract that the client recomputes the value. This lets the server `dynamic()` drop its hand-rolled promise tracking and mirror the client's two-memo shape, since its resolved value is a component function that must never cross the wire.

- 17b0afb: Fix SSR `createProjection` mishandling replacement values (values returned or yielded that differ from the draft) (#2948). Replacements are now authoritative snapshots on every server path — keys absent from the replacement are deleted instead of retained from the seed, matching the client's replace-mode reconcile. Later async-generator replacement yields are now applied through the patch-recording draft before the batch is drained, so their sets/deletes actually stream to the client instead of emitting an empty patch batch. The client's hydration first-snapshot apply mirrors the same replace semantics for object roots.
- Updated dependencies [82d61b4]
- Updated dependencies [55e2682]
- Updated dependencies [e17a31f]
- Updated dependencies [e9e6a78]
- Updated dependencies [b32c105]
- Updated dependencies [09d2540]
- Updated dependencies [0208ff2]
- Updated dependencies [e89a479]
- Updated dependencies [b19d23a]
- Updated dependencies [ef01b13]
  - @solidjs/signals@2.0.0-beta.27

## 2.0.0-beta.26

### Patch Changes

- Updated dependencies [0c206fd]
- Updated dependencies [c5cf84f]
- Updated dependencies [47fbc0d]
- Updated dependencies [6b95ce3]
  - @solidjs/signals@2.0.0-beta.26

## 2.0.0-beta.25

### Patch Changes

- Updated dependencies [82581e4]
- Updated dependencies [82581e4]
- Updated dependencies [82581e4]
  - @solidjs/signals@2.0.0-beta.25

## 2.0.0-beta.24

### Patch Changes

- Updated dependencies [a7d42f6]
- Updated dependencies [588a572]
- Updated dependencies [09e7d64]
- Updated dependencies [d64d1a0]
- Updated dependencies [635182a]
  - @solidjs/signals@2.0.0-beta.24

## 2.0.0-beta.23

### Patch Changes

- 6c95f60: Lazy memos with an in-flight async computation no longer autodispose when
  their last subscriber momentarily drops (e.g. a consumer disposing
  mid-request): the pending work counts as an observer, so a later subscriber
  attaches to the same computation instead of re-executing the source — one
  server fetch per suspended re-read, not one per churn. Settling while
  unobserved still releases the node (normal lazy teardown resumes once
  idle).
- Updated dependencies [a5fe9fb]
  - @solidjs/signals@2.0.0-beta.23

## 2.0.0-beta.22

### Patch Changes

- Updated dependencies [c04931b]
- Updated dependencies [70e89ba]
- Updated dependencies [c3c18d9]
- Updated dependencies [901152f]
  - @solidjs/signals@2.0.0-beta.22

## 2.0.0-beta.21

### Patch Changes

- b1b2f82: Fix `lazy()` hydration crashing when Solid Refresh registers a component in the dynamically imported chunk (#2920). The module-scope `$$component(...)` registration created its bookkeeping signal through the hydration-aware `createSignal`, which requires a reactive owner to consume a hydration child id — at module evaluation time there is none, so `peekNextChildId` threw and hydration fell back to client rendering. Registration signals are dev bookkeeping and never participate in hydration: the component is now stored in a plain-object signal (`createSignal({ current })`), so no hydration-aware computation is created and no hydration child ids are consumed.
- a79f974: Fix streamed `<Loading>` boundaries duplicating resolved content when a Solid Refresh HMR update lands while hydration is still in progress (#2919). A hot swap disposes the mounted component; if a streamed boundary's `$df` reveal had already swapped its settled content into the DOM but the boundary had not yet resumed to claim it, disposal could no longer find the fragment markers and the revealed server nodes leaked as duplicate content. The refresh runtime now defers registry patching until the hydration pass settles (via the internal `sharedConfig.onHydrationEnd` hook), letting the old component finish claiming its server-rendered DOM before the swap reconciles it; patches outside a hydration pass still apply synchronously.
- e3d5fed: Starting hydration for a second root no longer resets the pending-boundary bookkeeping of an earlier root that is still waiting on a serialized `<Loading>` boundary (#2917). The pending-boundary counter now spans hydration roots: `sharedConfig.done` only flips once every root's boundaries have resumed, instead of a later root's completion draining hydration (and clearing snapshots) out from under an earlier pending root and driving the counter negative when it finally resumed. Each boundary registration now releases its pending count exactly once — via resume, the fallback asset path, or disposal — so a disposed boundary whose promise never settles cannot hold global hydration open.
- c4fad7a: A `<Loading>` boundary that resumes after another `hydrate()` root has started now claims server DOM against the root it registered under (#2917, follow-up to the pending-boundary counter fix). Boundary registration captures the current root's registry/gather pair via the DOM runtime's `sharedConfig.captureBoundaryScope`, keyed by the full boundary id; the resume path swaps the captured pair in for its synchronous window and restores the globals afterwards, falling back to the live globals when no capture exists. Previously a late resume gathered against the last-hydrated root's container and registry, so the server-streamed fragment went unclaimed and the boundary's reactive bindings attached to orphaned client nodes. Captures are cleaned up when the boundary's pending count releases (resume, fallback asset path, or disposal).
- Updated dependencies [615bb17]
- Updated dependencies [99b2b8e]
- Updated dependencies [e8fb215]
- Updated dependencies [18f0135]
  - @solidjs/signals@2.0.0-beta.21

## 2.0.0-beta.20

### Patch Changes

- 729a5e1: Add a dev-only `solid-js/refresh` subpath entry hosting the HMR component-swap runtime (ported from the standalone `solid-refresh` package). Compiled HMR wrappers keep the frozen `$$registry`/`$$component`/`$$refresh`/`$$decline` ABI and the `hot.data` protocol; the production build resolves to inert stubs. The "cannot hot-swap" bail path is now configurable via `configureRefresh({ invalidate })` instead of hardcoding `window.location.reload()`.
- ff5c321: Fix hydration of nullish serialized values (#2914). A settled serialization ref `{ s: 1, v: null }` previously hydrated to the internal ref object instead of `null`, and a directly serialized `null`/`undefined` was treated as "no server value", running the client compute instead of adopting it. The unwrap now reads the ref payload directly and presence is decided by `sharedConfig.has` rather than nullish-checking the loaded value.
- bbc5ac8: Fix `lazy()` stranding surviving instances when the first in-flight instance is disposed (#2915). The memo tracking the shared import was owned by whichever instance rendered first; disposing that instance killed the memo and survivors never saw the module resolve. The import promise stays shared (still fetched once), but each in-flight instance now owns its own tracking memo.
- a24a4de: Fix the `solid-js/refresh` runtime resurrecting stale module scopes when a hot update re-executes a module whose rendered tree was already torn down (solid-refresh#85). The Babel transform's `fixRender` feature registers the `render()` disposer with `hot.dispose`, so on entry-module (or multi-boundary) updates the previous tree is disposed and a fresh one is rendered through the _new_ registrations before the accept callback patches the registry — but `patchComponent` still treated the first execution's registration as the mounted one, redirecting the live render back through the previous execution's component closure (dead `createContext` instances, prior-generation imports). In Solid 2.0 this crashed the reactive system with `ContextNotFoundError` (dead UI); on earlier betas it appended duplicate trees on every save. Registrations now track live rendered instances, and when none survive the update the registry adopts the re-executed component instead of resurrecting the old one.
- c7bb2c8: Fix SSR async retry paths re-running computes without resetting owner child state (#2900). The client disposes children and resets the child-id counter on every recompute; on the server only `createSyncMemo` did. Every other retry path — serverEffect retries, async `createMemo` reruns, `createProjection` reruns, and `disposeOwner`'s leaf fast path hit by the Loading discovery retry — kept allocating child hydration ids where the failed run left off, drifting the successful run's ids past the client's so serialized values and DOM nodes hydrated under the wrong keys. Retries now reset child state first (failed runs' onCleanups fire at retry instead of leaking to root disposal), with the retrying primitives' lifecycle cleanups moved to the creation context so a retry can't cancel itself.
- 9f27cdf: Fix `<Switch>` crashing (and halting the reactive system) when a child resolves to a nullish value, e.g. a `<Match>` gated behind a false `<Show>` (#2911). Nullish child slots are now skipped during match selection on both client and server, matching the existing tolerance for boolean children.
- Updated dependencies [aa39752]
- Updated dependencies [a224f2d]
- Updated dependencies [f6dce8a]
- Updated dependencies [e156386]
- Updated dependencies [5ab7d17]
- Updated dependencies [66a6c13]
- Updated dependencies [d57d2c9]
- Updated dependencies [8c864ea]
- Updated dependencies [d2f83c0]
- Updated dependencies [2dc2c8f]
- Updated dependencies [d07a9af]
  - @solidjs/signals@2.0.0-beta.20

## 2.0.0-beta.19

### Patch Changes

- d94d5c3: Pay-for-use tree-shaking, phase 2 (#2883). The optimistic write engine (override writes, lane routing/suspension, stashed-optimistic reads, transition-completion blockage, optimistic-node resolution) moves out of `core.ts`/`scheduler.ts`/`lanes.ts` into a new internal `optimistic` module behind fourteen nullable `GlobalQueue` hooks, installed by the verdict layer and at first `createOptimistic`/`createOptimisticStore` call. Every core call site is gated on state only the engine can create (an `_overrideValue` slot, a live lane, a non-empty optimistic batch), and the A17 override-is-the-value read path stays inline in core. On the `solid-js` side, `createLoadingBoundary`'s hydration-resume machinery (boundary triggers, resume scheduling, asset-failure reporting, snapshot capture) now installs through the existing `enableHydration()` seam, so client-only apps stop shipping it.

  Measured (esbuild, minify, `_`-prop mangling, gzip -9): core floor 8.2 → 7.7 KB gzip; plain-store subset 13.0 → 12.4 KB; minimal app from published dist 11.5 → 10.9 KB; a CSR app using `<Loading>` drops a further ~0.9 KB gzip; opting into `hydrate()` costs +43 min bytes. Cumulative with phase 1, the minimal-app floor is down ~14% and the signals floor ~13.5% with no behavioral change — differential smoke runs are byte-identical and the full Tier-A suite passes unchanged.

- d0b9c91: Pay-for-use tree-shaking, phase 3 (#2883) — mechanical cleanups selected by cost/benefit audit. Signals: the effect re-enqueue block (four copies) and zombie/dirty queue selection dedupe into shared `enqueueSub`/`queueFor` helpers (hot-path microbenched, no regression); boundary/reveal internal method names are `_`-prefixed so property mangling reaches them; production error strings trim to their diagnostic codes (dev builds keep full sentences); and the prod dist build stops stripping `/*@__PURE__*/` annotations — rollup-plugin-prettier is off the prod tree, terser re-emits annotations, and a new `check-pure` build guard fails the build if they ever vanish again. solid-js client: `sharedConfig.getNextContextId` and `lazy()`'s hydration-module lookup install from `enableHydration()` instead of shipping in every CSR bundle, and MockPromise's class static block (which defeated dead-code elimination in every client bundle) becomes a PURE-annotated factory. CDN `unpkg`/`jsdelivr` fields now point at browser production ESM instead of CommonJS files.

  A last-mile pass closes part of the esbuild-vs-Rollup shaking gap at the source level (Rollup's literal tracking folds never-written state that esbuild retains): the external-source wiring in computed setup and `untrack` moves behind hooks that mirror `enableExternalSource()`'s config liveness, the affects-only `onlyMarkPending` read-path helper moves into the affects module, and the optimistic-store settle loop moves inside its store-side hook. All are Rollup-neutral by measurement.

  Measured: minimal app 10.9 → 10.3 KB gzip under esbuild and **9.8 KB gzip / 9.0 KB brotli under Vite** (Solid's default toolchain — under the 10 KB mark); CSR app with `<Loading>`/`lazy` 13.9 → 12.6 KB; signals floor 7.7 → 7.4 KB; and the full-featured bundle _shrinks_ ~330 gzip bytes, recovering a third of the phase-1/2 hook indirection tax. Cumulative across all three phases the minimal app is down ~19% with all 1,941 tests across the affected packages passing unchanged.

- Updated dependencies [655b614]
- Updated dependencies [442ad9a]
- Updated dependencies [1dc0b45]
- Updated dependencies [24bca49]
- Updated dependencies [71ba988]
- Updated dependencies [587cf48]
- Updated dependencies [d94d5c3]
- Updated dependencies [d0b9c91]
- Updated dependencies [b923fd7]
  - @solidjs/signals@2.0.0-beta.19

## 2.0.0-beta.18

### Minor Changes

- 1b94264: Question-scoped pending model and the `affects()` primitive (supersedes the optimistic mask)

  `isPending` is re-derived from one rule: a read is pending iff a value change is in flight for it that has not yet revealed, or it carries a live `affects()` mark.
  - **Same-question re-asks are silent.** `refresh()`, polling, and confirm refetches whose tracked inputs are value-stable no longer read as pending — the fresh value reveals silently.
  - **New questions pend monotonically.** An input value change in flight pends every read under the source until its answer reveals, and nothing can silence it.
  - **Optimistic writes are verdict-inert.** An active override displays without decreeing settlement: it neither reads pending on its own slot (only a differing held correction re-opens the verdict) nor masks anything else. The store-wide optimistic mask (A21) and node mask (A20) are removed.
  - **New `affects(target, key?)` primitive** (re-exported from `solid-js`). Declares that in-flight work will change the targeted data: the named slot (a store record, a specific record key, or a source accessor) reads pending from the declaration until the surrounding transaction settles or reverts. `affects(x); refresh(x)` is the declared-reload idiom.

### Patch Changes

- 500d484: Narrow `affects()` to a single optional key: `affects(target, key?)`. The variadic form read like a 1.x store path (`affects(state, "user", "name")` suggests `state.user.name` but marked two sibling slots) — mark multiple slots with multiple calls, or target the nested record directly. Passing more than one key now throws in dev.
- 7d21226: Server `lazy()` now supports resolver manifests (dev servers answering asset
  lookups from their live module graph): when `ctx.resolveAssets` returns a
  promise, registration defers with boundary attribution preserved and the
  lazy render memo stays not-ready until the assets have registered, so
  streamed fragments cannot flush without their styles. CSS entries resolved
  as `{ id, content, attrs }` descriptors register as `inline-style` assets
  (SSR'd `<style>` tags, e.g. dev CSS that Vite's HMR client adopts) instead
  of stylesheet links. The `moduleUrl` getter (islands) prefers the context's
  `resolveAssetsSync` fast path, so it keeps returning a client-loadable URL
  and registering modulepreload hints under async dev resolvers too.
- 9b4dd76: Raise the seroval / seroval-plugins dependency floor to `~1.5.4`: seroval 1.5.3 and earlier are affected by a security issue fixed in 1.5.4.
- 1561c7e: Sever reveal-group membership at boundaries during SSR (#2871, #2872)

  Only direct `<Loading>` children of a `<Reveal>` now join its group, matching
  client semantics where `createCollectionBoundary` clears the reveal controller
  context for the subtree of both boundary types:
  - A `<Loading>` nested inside another slot's content no longer enrolls in the
    ancestor group, so a slow nested boundary can't stall `order="together"` or
    park a `sequential` frontier. It is covered by its own fallback inside the
    held slot and activates independently — the streamed runtime (from
    `@dom-expressions/runtime` 0.50.0-next.20, whose deferred-activation queue
    this change depends on) queues its swap until the enclosing slot goes live.
  - An `<Errored>`-wrapped `<Loading>` likewise no longer holds the group
    hostage; error fallbacks can appear without blocking group progression.

  `RevealGroupContext` moved from `server/hydration.ts` to `server/signals.ts`
  so `createErrorBoundary` can sever it without a circular import.

- 4e67d45: Fix nested `Reveal` readiness across the client and streaming SSR.

  Empty or synchronously resolved composites now count as minimally ready, so an
  enclosing `order="together"` group cannot deadlock. Nested `order="natural"`
  groups also report readiness as soon as one direct child is minimally ready,
  and nested client `order="together"` groups propagate the same direct-slot
  readiness they use for their own release. Readiness and completion on the server
  are held until all synchronous child slots have registered, preventing an early
  child from making a partially constructed group release prematurely.

- 8ca127d: Update dom-expressions to 0.50.0-next.19. Pulls in resolver manifests: the
  `manifest` option of `renderToString`/`renderToStream` now also accepts
  `{ resolve(key), resolveSync?(key) }` (or a bare function) as an alternative
  to a static manifest object, so dev servers can answer asset lookups from
  their live module graph. `resolve` may return a promise and may resolve CSS
  entries to inline-style descriptors (`{ id, content, attrs }`) for HMR
  adoption; `resolveSync` is exposed on the render context as
  `resolveAssetsSync` for sync consumers like `lazy()`'s `moduleUrl` getter.
  Also picks up an internal perf refactor of root-level insert cleanup
  (foreign-sibling detection via O(1) pointer checks).
- Updated dependencies [500d484]
- Updated dependencies [500d484]
- Updated dependencies [1b94264]
- Updated dependencies [4e67d45]
  - @solidjs/signals@2.0.0-beta.18

## 2.0.0-beta.17

### Patch Changes

- 928ba28: Fixed a pending `<Loading>` leaking its asset-attribution scope to later document-order siblings during streaming SSR (#2860). The boundary assigned `_currentBoundaryId` on its buffered context at creation, but the property is an accessor inherited from the root context over shared tracking state — the assignment mutated the global boundary id with no restore, so a root-level `lazy()` after the boundary filed its module under the boundary's already-serialized asset map instead of the root `_assets` map, and that island never hydrated. The creation-time assignment is removed; every render phase already scopes the id correctly via `runWithBoundaryErrorContext`, which sets and restores it around the run.
- 25a5685: Unlink disposed SSR owners from their parent's child chain before pooling. The pool cleared `_parent`/`_nextSibling` on the recycled node, but the parent's `_firstChild`/sibling chain still referenced it — so once the pool reused the owner in a different tree, disposing the old parent walked its stale chain and disposed live owners in the new tree. Boundary retries (`self=false`) are unaffected; subtree disposal still unlinks each child in O(1).
- fe9ed90: Redesign SSR asset handling for `lazy()` around hydration ids instead of module specifiers.
  - The server now keys the streamed module map by the hydration id of the lazy render memo, and the client looks preloaded modules up by computing the same id positionally. Module identity no longer needs to exist client-side, so bundler `moduleUrl` injection is only required on the server.
  - New glob support: when a `lazy()` callsite has no static import specifier (e.g. `lazy(globModules[path])` over `import.meta.glob`), the server defers asset resolution until the import settles and reads the module's bundler-injected `$$moduleUrl` export. Assets still attribute to the boundary that rendered the component. Rendering without any resolvable identity now warns (late client load) instead of throwing.
  - `Component.moduleUrl` on the server is now a getter that resolves through the active request's asset manifest, returning the client-loadable entry URL (e.g. `/assets/About-abc123.js`) for stamping into markup (islands and similar). Reading it during SSR also registers modulepreload hints for the module's chunks — the only preload signal for lazy components under `NoHydration`. Outside a request context it returns the raw specifier.

- 4cc6113: Fixed `lazy()` inside `<NoHydration>` silently rendering nothing during SSR (#2859). The moduleUrl/manifest guards are intentionally waived for no-hydrate zones, but the early return that gated asset registration also gated the render memo — so exactly those waived cases returned `undefined` and the lazy content vanished from the output with no error. Asset registration is now decoupled from rendering: the render memo is always created, and async SSR waits for the module as usual. Also fixed the lazy module rejection check treating a falsy rejection value as "still loading" (same class as #2857).
- 9b883e0: Fixed two SSR async-source regressions from 1.x (#2857, #2858):
  - A rejection with a falsy value (`undefined`, `null`, `""`, `0`, `false`) was treated as resolved by the server memo read path — the HTML rendered the success branch while the hydration payload serialized the same source as rejected. Error presence on server computations is now tracked as a flag instead of a truthiness test on the error value, so falsy rejections render the `Errored` fallback exactly like truthy ones.
  - Server async detection only recognized native `Promise` instances, so a non-Promise thenable (PromiseLike) returned from a memo was stored as a sync render value and skipped by the renderer with "Unrecognized value". SSR now uses the same object-thenable detection as the client async runtime (async-iterable takes precedence, matching client order): thenables under `<Loading>` are awaited and rendered, and without a boundary they surface the same missing-boundary diagnostic as a native `Promise`.

- Updated dependencies [ef4d53e]
- Updated dependencies [bcb0ca6]
- Updated dependencies [fda28a9]
- Updated dependencies [286fa3f]
- Updated dependencies [3e18b8d]
- Updated dependencies [08b88fb]
- Updated dependencies [40d13a9]
- Updated dependencies [b9cefee]
- Updated dependencies [c3b8314]
  - @solidjs/signals@2.0.0-beta.17

## 2.0.0-beta.16

### Patch Changes

- 4b5272f: `createErrorBoundary` and `createLoadingBoundary` now return a properly typed `Accessor<T | U>` (content union fallback) instead of `() => unknown`, with the same external signature across the core, client hydration, and server layers.
- f8f992d: A rejected chunk preload no longer hangs boundary hydration forever (#2817 layer 3). Every asset-wait path in `createLoadingBoundary` now handles rejection: the error is reported via console and the boundary resumes with a fresh client render (`shouldHydrate=false`), letting `lazy()`'s own `import()` retry or fail through normal error channels.
- f658824: Fix `createProjection` seed typing so readonly store seeds do not override inference from the projection function return type.
- 088f97e: fix(server): serialize chained async memo values resolved after a nested Loading boundary commits

  A chained async memo reached through a synchronous derived memo (e.g. `a` async → `m = createMemo(() => a()[0])` → `b = createMemo(() => fetchItems(m()))`) resolves only after its dependency, so inside a nested `<Loading>` boundary it serializes _after_ the surrounding boundary has already flushed and committed. That late serialization landed in a buffer that never flushed again, so the value was dropped — only the dependency's value survived. On the client the memo then re-ran its compute and orphaned the server-streamed fragment ("Hydration completed with N unclaimed server-rendered node(s)"). This is the shape produced when route content is nested in a root layout's boundary (e.g. TanStack Start).

  Once a boundary has flushed, later serializations now write through to the parent context instead of being buffered into a buffer that will never flush again.

- 4608539: Release the Reveal group slot when a streamed boundary errors so sequential/together frontiers don't stall and later resolved siblings still activate (#2776)
- f14e3e3: Stop pending async reads in server effects from throwing through the render. An effect compute reading a not-yet-ready async source previously propagated `NotReadyError` out of the effect, forcing the surrounding `Loading` boundary to rebuild its whole subtree on every settle — re-creating the async work each time in an infinite discovery loop (#2801). Now render effects register the pending source with the stream (holding flush like top-level JSX async) and retry once it settles so the effect function runs with the resolved value, matching how render effects drive boundaries on the client. Plain `createEffect` is swallowed outright — it never impacts boundaries even on the client.
- 8b6c298: Server render effects now respect `defer: true` — the compute still runs for parity, but the initial side-effect run is skipped like on the client (#2811)
- 5bc9080: Loading boundaries whose serialized state is already settled now hydrate straight through to content instead of rendering the fallback for a microtask. The fallback only hydrates when it is actually what the server left showing (i.e. the streamed fragment has not swapped in yet). The phantom fallback pass created detached client DOM and poisoned insert's node bookkeeping, causing async values beside siblings at fragment root to duplicate instead of update on post-hydration refresh (#2801).
- 0e8672a: Fix streamed SSR infinite loop when async work is created inside an `Errored` boundary (#2809 follow-up). The server error boundary discarded its partial template when children went async and disposed + re-ran them on every retry pull, recreating the async computation (and its fetch) each pass so the render never completed. The boundary now stashes the pending template and resumes its surviving holes across retries, matching how `Loading` already resumes.
- 1458907: Fix hydration key drift when a compiler-emitted expression memo reads a pending async source during streamed SSR (#2801). The server's lean sync memo re-runs its compute on every pull after a `NotReadyError`, but did so without resetting the owner's child state — each failed pull leaked the child-id slots it consumed (e.g. the inner condition memo of `{data().value && <h4>...</h4>}`), so hydration keys produced by the eventual successful pull drifted ahead of the client's single successful compute and the affected nodes went unclaimed (duplicated in prod, "unclaimed server-rendered node" warning in dev). The sync memo now disposes children and resets `_childCount` before each re-pull, mirroring how the client resets an owner on recompute, so every pull emits the same ids.
- 098876d: Fix hydration key mismatches when async holes defer past eager siblings
  (#2801 bug 2). New `ssrScope` (server): reserves one hydration id slot at
  registration and evaluates the hole — including async retries — under the
  reserved id with a zeroed child counter (a virtual scope in the style of
  mapArray's row-owner elision, so no owner allocation on the hot path). On
  the client, `@solidjs/web`'s `effect` wrapper now honors a `scope: true`
  option (set by the dom-expressions `insert` for compiler-tagged hole
  accessors) that makes the outer insert render effect non-transparent, giving
  the same hole its own id scope. Hole content ids gain one nesting level
  identically on both sides, so deferral timing can no longer shift sibling
  hydration keys.
- f6a3540: Update dom-expressions to 0.50.0-next.16. Pulls in: per-slot insertion markers so adjacent expression slots no longer destroy nodes migrating between them (#2830), delegated events reaching outer roots across nested render roots (#2832), recovery from module preload failures during hydration plus manifest asset URL normalization (#2817), non-destructive style object diffing with explicit-undefined removal (#2828), preserved JS value semantics for wrapped `&&` conditions, and the hole id scope hydration fixes (#2801).
- Updated dependencies [4b5272f]
- Updated dependencies [a2c9de1]
- Updated dependencies [7de51be]
- Updated dependencies [822a5a6]
- Updated dependencies [c45b6f7]
- Updated dependencies [c2b7aed]
- Updated dependencies [57b92a1]
- Updated dependencies [b51bbcc]
- Updated dependencies [5efe089]
- Updated dependencies [0e81199]
- Updated dependencies [bb750d1]
- Updated dependencies [f658824]
- Updated dependencies [e2ebc11]
- Updated dependencies [26f443f]
- Updated dependencies [aace71e]
- Updated dependencies [536bea5]
- Updated dependencies [16c861e]
- Updated dependencies [219e30c]
- Updated dependencies [45df105]
- Updated dependencies [2d07c8d]
- Updated dependencies [9a55a4d]
- Updated dependencies [6cef1c1]
- Updated dependencies [bc92d00]
- Updated dependencies [cfe6c8f]
- Updated dependencies [54b2175]
- Updated dependencies [c4ba526]
- Updated dependencies [d7e382a]
- Updated dependencies [461b242]
- Updated dependencies [5894f2a]
- Updated dependencies [bc92d00]
- Updated dependencies [5efe089]
- Updated dependencies [90238e7]
- Updated dependencies [936b098]
- Updated dependencies [90238e7]
- Updated dependencies [cdbe95d]
- Updated dependencies [233e7b0]
- Updated dependencies [77f6d18]
- Updated dependencies [a6d83f1]
- Updated dependencies [b7c03a7]
- Updated dependencies [e73ccae]
- Updated dependencies [b9f2737]
- Updated dependencies [4e81e9c]
- Updated dependencies [76fc7e6]
- Updated dependencies [faf78eb]
- Updated dependencies [c165ec2]
  - @solidjs/signals@2.0.0-beta.16

## 2.0.0-beta.15

### Patch Changes

- 8402421: Demote low-level `solid-js` boundary primitive docs in favor of the component APIs.
- f083220: Align server `Errored` boundaries with client hydration and preserve streamed outer error fallbacks for rejected `Loading` content.
- 98a7385: Fix late-streamed `<Loading>` fragments being orphaned/duplicated during hydration when a chained async memo recomputes between stream chunks. A computation is now treated as still hydrating while the overall lifecycle is in progress (`!done`) and it has an unconsumed serialized value, so it short-circuits to the server's deferred value instead of re-running its async body on the client.
- c943c5c: Stop SSR from silently swallowing errors thrown in server effects. `serverEffect` now re-throws real errors so a wrapping `createErrorBoundary`/`<Errored>` can catch them (matching the client/hydration path), while still propagating `NotReadyError` as suspense control flow (#2777).
- 4f14a34: Fix rejected SSR `lazy()` so it reaches `<Errored>` instead of stack-overflowing or leaking an unhandled rejection (#2780). `lazy()` hand-rolls its own promise tracking and previously had no rejection handler, so a failed module load left `p.v` undefined forever (the render memo kept throwing `NotReadyError`, i.e. perpetual "loading") and the orphaned rejection escaped as a process-level `unhandledRejection`. The loader now captures the rejection on the lazy and surfaces it through the render memo, and `ctx.block` swallows its duplicate rejection branch — bringing `lazy()` to parity with async memos, whose rejections already propagate to error boundaries. Once the error reaches the boundary, the existing streamed-fragment hydration path renders the fallback as usual.
- bff4c21: Handle pending store reads in server projections during SSR.
- 52255dc: Remove the public `isRefreshing()` API and treat `refresh()` as write-like invalidation in dev owned-scope diagnostics.

  `refresh()` is an action that invalidates an explicit refresh target; it should not expose ambient phase state to pure computations. User-visible mutation or retry intent should be modeled with actions and optimistic state, while readiness remains observable through `Loading` and `isPending`.

- Updated dependencies [0564da2]
- Updated dependencies [e141459]
- Updated dependencies [97b4111]
- Updated dependencies [f0bdfad]
- Updated dependencies [0eb7f4e]
- Updated dependencies [910b0ee]
- Updated dependencies [dfcd7bd]
- Updated dependencies [f97643c]
- Updated dependencies [f0bdfad]
- Updated dependencies [b26bc04]
- Updated dependencies [03369dd]
- Updated dependencies [99d829e]
- Updated dependencies [e5761bd]
- Updated dependencies [1847868]
- Updated dependencies [5466a3b]
- Updated dependencies [db88de1]
- Updated dependencies [d8921ac]
- Updated dependencies [e141b64]
- Updated dependencies [baa47d2]
- Updated dependencies [52255dc]
- Updated dependencies [23c9563]
  - @solidjs/signals@2.0.0-beta.15

## 2.0.0-beta.14

### Patch Changes

- Add store return tuple type aliases and harden store draft writes against prototype pollution keys.
- Updated dependencies [79e246e]
- Updated dependencies
  - @solidjs/signals@2.0.0-beta.14

## 2.0.0-beta.13

### Patch Changes

- 157dfe2: Pass an error accessor to error boundary fallbacks so repeated async errors from the same captured source update reactively.
- 4404f9f: Add an opt-in `isPending(fn, true)` render guard mode that lets pending reads follow the Loading path.
- 6fec663: Remove `on:` namespace event typings and document ref callbacks for native listener options.
- Updated dependencies [157dfe2]
- Updated dependencies [4404f9f]
  - @solidjs/signals@2.0.0-beta.13

## 2.0.0-beta.12

### Patch Changes

- b964dc7: Bump dom-expressions, babel-plugin-jsx-dom-expressions, hyper-dom-expressions, and sld-dom-expressions to 0.50.0-next.10.

  This includes SSR runtime optimizations for synchronous function holes and plain SSR array resolution, reducing overhead in list-heavy server rendering.

- 0a7c278: Document the mode-specific callback shapes for mapArray and For.
- 1c5cc7c: Avoid extra strict-read warnings when keyed Show and Match pass raw store-backed values to function children.
- 1833f14: Fix SSR hydration owner id parity for function-source prop merging and list helpers.
- 12f15a2: Align control-flow callback values with their keying mode so stable rows receive raw values and index-owned rows receive accessors only where the value can change.
- Updated dependencies [0a7c278]
- Updated dependencies [12f15a2]
  - @solidjs/signals@2.0.0-beta.12

## 2.0.0-beta.11

### Patch Changes

- 95ca987: Bump dom-expressions, babel-plugin-jsx-dom-expressions, hyper-dom-expressions, and sld-dom-expressions to 0.50.0-next.8.
  - **SSR attribute/textContent grouping** (next.7): the compiler now coalesces contiguous runs of dynamic attribute and `textContent` closures into a single `_$ssrGroup(() => […], N)` per element, and the runtime resolves all `N` hole positions through one closure invocation instead of `N`. Inserts/children stay separate so child isolation and hydration ids are unaffected. Bench: ~+15% on `search-results` (heavy attribute usage), neutral on `color-picker` (no qualifying groups).
  - **SSR bail-path single-invocation fix** (next.8): `ssr()` was invoking certain function holes twice when their return value walked into the bail branch (e.g., an array containing a NotReady-throwing item). For closures that read stateful getters such as JSX `props.children` — which rebuilds an owner subtree on each access — the duplicate invocation produced a divergent hydration-key prefix that the client could not claim, surfacing as "Hydration completed with N unclaimed server-rendered node(s)" warnings. The bail path now consumes the already-evaluated value instead of re-invoking the original closure.

- cb04b8e: Export public primitive option types from the root `solid-js` entrypoint and align projection options with hydration fields.
- b0db6c9: Ensure manual writes to writable derived signals and derived stores win over queued same-tick recomputes.
- 47c0e6f: Fix memory leak where individually-disposed owners (e.g. `<For>` rows whose
  keyed-by-identity entries are replaced) stayed wired into their parent's
  `_firstChild → _nextSibling` chain forever, causing zombie Owner shells to
  accumulate per click. The previous fix (`ac50d5cf`) had stopped nulling
  `_nextSibling` to keep the chain intact during cascading `unobserved()` walks,
  but that left no path to detach an individually-disposed node from its parent.

  Owners now form a doubly-linked sibling list (`_prevSibling` added to the
  `Owner` shape, mirroring how subscriptions already use `_prevSub`/`_nextSub`).
  On individual disposal we splice the node out of its parent's chain in O(1).
  The splice is skipped when the parent is itself being torn down (batch
  dispose path is unchanged) or when the node was already a zombie sitting on
  `_pendingFirstChild`. The disposed node's own `_nextSibling` is deliberately
  left intact so an in-flight outer dispose walk that already advanced past
  this node still reaches later siblings — preserving the cascade-safety from
  the original fix.

- 263be3f: fix(signals): `refresh()` no longer cascades into upstream memos. Only the memos read at the top level of the refresh callback (or the explicit `refresh(memo)` target) recompute; their dependencies are left untouched. `isRefreshing()` still reports `true` for the entire refresh call so consumers can opt into deeper refresh manually.
- 59d84ba: Fix the Tier-1 SSR `search-results` / `color-picker` benches under `packages/solid-web/test/server/`. Both files now carry a `@jsxImportSource @solidjs/web` pragma so `tsc --project tsconfig.test.json` can resolve `JSX.IntrinsicElements`. The `search-results` bench had a latent typing bug — it passed the row accessor through `<For>` while typing the row component's prop as the resolved `SearchItem`, so every `props.item.title` read returned `undefined` and the bench was silently emitting empty `textContent` for every dynamic field. The bench now mirrors the realistic Solid 2.0 keyed shape under performance optimized situations: dereference the row accessor at the `<For>` boundary, destructure `props.item` once at function entry, then read plain locals in the JSX. This means a single props-proxy trap per row instead of one per field access, and the bench now actually measures rendering of real data.
- 80b4e8d: Replace the upstream `@solidjs/signals` owner runtime with a lean SSR-specific implementation. The server is single-pass and pull-based, so the scheduler / heap / zombie graph / observer linked list that the upstream owner carries serve no purpose during SSR. The new `SSROwner` shape is a forward-only linked list with cleanup hooks and an id (~9 fields vs. ~14 upstream), plus a freelist that recycles owners across the disposal at end-of-render — repeat renders of the same shape pay ~0 steady-state owner allocation.

  Layered on top:
  - `mapArray` and `repeat` rows reuse the parent memo owner instead of allocating a new owner per iteration. Per-row id parity with the client is preserved by mutating the memo owner's `id` and resetting `_childCount` for each iteration; nested compiler-emitted memos / providers / boundaries see the correct synthetic row id as their parent prefix. Safe because `mapFn` runs once per render (sync `NotReadyError` propagates up through the `sync: true` outer memo and the engine reruns the whole `mapArray`) and async retries always live in their own nested owners with snapshotted ids.
  - `createSyncMemo` is a separate lean memo for computes statically guaranteed to return synchronously (compiler-emitted `_$memo` / `_$effect` wrappers, internal control-flow primitives). It skips the full `ServerComputation` / `processResult` / `$REFRESH` / `runWithObserver` / `onCleanup` scaffolding that async memos need, while still letting `NotReadyError` propagate to the nearest boundary.
  - The Loading boundary now uses `disposeOwner(o, false)` directly (instead of `o.dispose(false)`) to wipe the boundary's children on retry while keeping the boundary owner itself alive for the re-run. `SSRTemplateObject` is widened to a union covering both the heavy `{ t: string[]; h: Function[]; p: Promise[] }` shape and the leaf `{ t: string }` shape; the boundary's pending-loop narrows to the heavy variant before threading values back through `ctx.ssr`.

- d2529e3: Redesign refresh to invalidate a single explicit target without reading accessor values.
- 80b4e8d: Remove `ssrRunInScope` from the public surface. The function had been a true pass-through identity (`fn => fn`) on the server runtime since owner-capture moved into `tryResolveString`'s `NotReadyError` handler, and the compiler no longer emits it. With no internal callers and no behavior to provide, the export was dead surface area and is now removed from `solid-js` (server export, server core impl, client stub) and from `@solidjs/web`'s `rxcore` re-export. User code that called it can drop the wrap (it was a no-op) or replicate the original deferred-callback owner-capture intent in two lines with `getOwner()` + `runWithOwner()`.
- 80b4e8d: Mark internal control-flow memos as `sync: true` on both client and server runtimes (`Show`, `Switch`, `mapArray`'s outer body, `repeat`'s outer body, `children`'s outer flatten memo, `lazy`'s outer render memo, plus `Show` / `Switch` non-keyed condition wrappers). The user-input-facing memos (`when={…}`, `each={…}`, `props.children` getter, `lazy()`'s pending promise) stay async-shape aware. This skips the per-recompute Promise/AsyncIterable probe in `recompute` (client) and the corresponding `ServerComputation` / `processResult` / `$REFRESH` scaffolding (server) for memos statically guaranteed to return synchronously, reducing per-render overhead in SSR and client renders without affecting async behavior.
- Updated dependencies [cf62254]
- Updated dependencies [e41186c]
- Updated dependencies [02ec407]
- Updated dependencies [e16371f]
- Updated dependencies [7d4d0c3]
- Updated dependencies [005c9fb]
- Updated dependencies [d2529e3]
- Updated dependencies [7d4d0c3]
- Updated dependencies [d42f112]
- Updated dependencies [e16371f]
  - @solidjs/signals@2.0.0-beta.11

## 2.0.0-beta.10

### Major Changes

- 2a7c6a5: Move JSX type ownership from `solid-js` to renderer packages.

### Patch Changes

- 59dd11f: Docs prep for the 2.0 reference auto-generation pass: backfill JSDoc examples on previously-undocumented public APIs (`getObserver`, `isDisposed`, `createRenderEffect`, `onCleanup`, `createErrorBoundary`, `createLoadingBoundary`, `createRevealOrder`, `flatten`, `enableExternalSource`, `NotReadyError`, `NoHydration`, `Hydration`, `isServer`, `isDev`); normalize inline JSDoc code fences to `@example` tags on the JSX components (`<For>`, `<Repeat>`, `<Switch>`, `<Errored>`, `<Reveal>`, `dynamic`, `<Dynamic>`); and tag cross-package wiring / compiler-emitted exports with `@internal` so the doc generator can hide them from the user-facing surface (`getContext`, `setContext`, `createOwner`, `getNextChildId`, `peekNextChildId`, `enforceLoadingBoundary`, `sharedConfig`, `enableHydration`, `NoHydrateContext`, `$DEVCOMP`, `$PROXY`, `$REFRESH`, `$TRACK`, `$TARGET`, `$DELETED`, `ssr*` helpers, `escape`, `resolveSSRNode`, `mergeProps`, `ssrHandleError`, `ssrRunInScope`). Also extends the `equals` field JSDoc on `SignalOptions` / `MemoOptions` to mention `isEqual` as the default.
- e841f8c: Bump dom-expressions, babel-plugin-jsx-dom-expressions, hyper-dom-expressions, and sld-dom-expressions to 0.50.0-next.5. Picks up the document-root reactivity fix: `render(..., document)` and `hydrate(..., document)` now wrap the rendered tree in a transparent render effect (mirroring what `insert` does for non-document roots), so a top-level reactive expression at the document root stays driven by signal changes after the initial flatten. Previously the document-root path called `flatten(code)` and discarded the subscription scope, leaving any top-level memo idle after the first walk — most visible with full-document hydration as in TanStack Solid Start. The new JSDoc on the JSX `class` attribute (a string vs. array+object form note carried up from dom-expressions) is also picked up.
- a93a216: Fix store reads of inherited accessor getters so class/prototype getters track through the store proxy.
- cf92b55: Guard storePath against prototype pollution through dangerous path segments.
- Updated dependencies [59dd11f]
  - @solidjs/signals@2.0.0-beta.10

## 2.0.0-beta.9

### Patch Changes

- 9015b12: AI-readiness docs/JSDoc pass — continued from the initial pass shipped earlier on this branch. Targets the failure modes surfaced while authoring the kitchen-sink TodoMVC example.

  **Cheatsheet (`solid-js/CHEATSHEET.md`)**
  - New "Props" section leading with "props are reactive values, not accessors". Covers the two failure modes that dominated the audit: passing `filter={filter}` instead of `filter={filter()}`, and destructuring props in the child (`function Comp({ value })`) which unwraps reactivity once and breaks tracking. The footgun list now points at this section.
  - Reframed `onSettled` as the canonical lifecycle primitive for component-level setup/teardown (return a cleanup function from the body); demoted `onCleanup` to advanced.
  - Store/setter/projection entries reframed to match the JSDoc precision below.

  **`createStore`, `createOptimisticStore`, `createProjection`**
  - `StoreSetter<T>` is mutation-first; the return form is shallow (arrays index-replace + length-adjust, objects top-level diff) and is **not** keyed reconciliation. Keyed reconciliation belongs to the projection-function return path (`createStore(fn, …, { key })`, `createProjection`, `createOptimisticStore(fn, …)`), where the function's return is reconciled by `options.key` (default `"id"`).
  - `createStore` JSDoc gained a paragraph against putting signal accessors as store property values — the proxy already tracks reads per-property; nesting `() => signal()` inside a store property gives you a getter that won't track when called.
  - `createOptimisticStore` / `createProjection` — explicit note that `options.key` defaults to `"id"` and is only worth specifying for non-`id` identity fields. Replaced the imperative `draft.length = 0; draft.push(...)` example with a `return …filter(...)` form that names the keyed-reconcile guarantee, plus a per-property mutation example.
  - Added a `setStore(s => s.list.filter(...))` line to `createStore` and a `removeTodo` `filter`-return action to `createOptimisticStore`.

  **`<Loading>`**
  - Added a sentence on scoping: place the boundary around the data-dependent slot, not the surrounding shell, so revalidation doesn't replace layout chrome with the fallback.

  **Hydration wrappers (`solid-js`)**
  - The hydration-aware re-exports of `createMemo`, `createSignal`, `createOptimistic`, `createProjection`, `createStore`, `createOptimisticStore`, `createRenderEffect`, `createEffect`, and `createErrorBoundary` previously had no docs at the wrapper site — hovering them in `solid-js` showed only the type signature. Each wrapper now carries the canonical primitive description plus a short **Hydration** paragraph pointing at the new `HydrationSsrFields` type, which centrally documents the `ssrSource` modes (`"server"` / `"hybrid"` / `"client"`) and `deferStream`.
  - `HydrationProjectionOptions` (used by `createProjection`, the projection form of `createStore`, and `createOptimisticStore`) gets its own JSDoc explaining the `ssrSource` extension over `ProjectionOptions`.

  **`@solidjs/universal` README**
  - 2.0 banner added matching the `@solidjs/web` pattern — names the `solid-js/universal` → `@solidjs/universal` rename and the new deferred-mount semantics in the wrapped `createRenderer.render` (top-level mount goes through the effect queue and drains with a tail `flush()`; uncaught top-level async holds the initial commit on the active transition).
  - Custom-renderer example fixed: import path corrected to `@solidjs/universal`, the destructured `use` (1.x relic) replaced with `applyRef, ref` to match the actual `dom-expressions/universal.js` return shape, and the forwarded control-flow list updated to 2.0 names — `For, Repeat, Show, Switch, Match, Errored, Loading, Reveal` instead of `For, Show, Suspense, SuspenseList, Switch, Match, Index, ErrorBoundary`.

  JSDoc/example/docs only — no runtime or type-signature changes.

- fb2e43b: Docs and JSDoc pass for AI-assisted code generation: rewrite root, `solid-js`, and `@solidjs/web` READMEs for the 2.0 beta; ship a one-page `CHEATSHEET.md` inside the `solid-js` npm package; audit and add `@example` blocks to the high-traffic public exports across `solid-js`, `@solidjs/web`, and `@solidjs/signals`. No runtime changes.
- 845b6bb: Drop the solid-side support machinery for dom-expressions' old
  `memo(accessor, true)` wrap in `insert()`. That wrap has been replaced in
  dom-expressions with a conditionally nested render-effect pattern that
  splits the accessor's creation scope from its read scope — fixing stale
  reads and transition-ownership regressions (the Sierpinski hover freeze)
  without reintroducing the #2610 sibling re-render.

  Solid-side companion cleanup:
  - `@solidjs/web` `memo` helper collapses to `createMemo(() => fn())` and
    drops the `coreMemo` import; the `transparent` branch and `$r`
    short-circuit are no longer reachable.
  - `@solidjs/signals` `accessor()` no longer tags the returned function
    with `$r`.
  - `@solidjs/web` drops `@solidjs/signals` from `peerDependencies` and
    `devDependencies` — it reaches signals transitively through
    `solid-js`.

  No public API changes. Coordinates with a forthcoming dom-expressions
  release.

- 23f7550: Bump dom-expressions/babel-plugin-jsx-dom-expressions/hyper-dom-expressions to 0.50.0-next.3. Replace lit-dom-expressions with sld-dom-expressions in @solidjs/html for an AST-driven, CSP-safe tagged-template runtime. Wire `untrack` into @solidjs/h's runtime to satisfy the new hyper API. Add small vitest smoke suites for @solidjs/h and @solidjs/html, and a `@solidjs/web#test-types` task with a tripwire for upstream `client.d.ts` re-exports of `VoidElements`/`RawTextElements`. Refresh both READMEs.
- 8b9c5bf: Bump dom-expressions, babel-plugin-jsx-dom-expressions, hyper-dom-expressions, and sld-dom-expressions to 0.50.0-next.4. Picks up the hyperscript callback-prop materialization fix (returning `h(Comp, …)` from a render-prop callback no longer re-mounts stable rows on parent updates) and the upstream `client.d.ts` re-exports of `VoidElements`/`RawTextElements`. Drops the local workarounds in `@solidjs/web` (explicit constants re-export and the `client.d.ts` skip in `types:copy-web`). Folds the For-row regression cases into `@solidjs/h`'s smoke suite as plain tests.
- 9015b12: `createContext<T>()` (default-less form) is now typed `Context<T>` (was `Context<T | undefined>`). `useContext` returns `T` directly and the runtime continues to throw `ContextNotFoundError` when no Provider is mounted (this was already the runtime behavior — only the type signature was lying).

  This eliminates the `useX`-with-throw wrapper hook idiom: `const useTodos = () => { const t = useContext(Ctx); if (!t) throw …; return t; }` becomes a plain `useContext(TodosContext)` call.

  The default form `createContext<T>(defaultValue)` is unchanged: `useContext` falls back to `defaultValue` outside any Provider. Reserved for primitive fallbacks (theme, locale, frozen config); for any context carrying reactive state, prefer the default-less form.

  **Breaking:** consumers that rely on `useContext(ctx)` returning `undefined` for a default-less context (and branch on that) will now see the throw at runtime and the type narrowing they were doing becomes a type error. Migration: pass an explicit default to `createContext`, or remove the now-redundant null check.

- c324d2c: Diagnostic messages now include their stable code identifier as a prefix (e.g. `[NO_OWNER_EFFECT] Effects created outside a reactive context will never be disposed`). Applied to all dev-mode diagnostics: `STRICT_READ_UNTRACKED`, `PENDING_ASYNC_UNTRACKED_READ`, `PENDING_ASYNC_FORBIDDEN_SCOPE`, `SIGNAL_WRITE_IN_OWNED_SCOPE`, `RUN_WITH_DISPOSED_OWNER`, `NO_OWNER_CLEANUP`, `CLEANUP_IN_FORBIDDEN_SCOPE`, `NO_OWNER_EFFECT`, `NO_OWNER_BOUNDARY`, `ASYNC_OUTSIDE_LOADING_BOUNDARY`, and `MISSING_EFFECT_FN`.

  The previously bare `throw new Error("Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled")` (raised when creating a memo, effect, or owner inside `createTrackedEffect`/`onSettled`) is now also surfaced through the diagnostic system as `PRIMITIVE_IN_FORBIDDEN_SCOPE` (severity `error`, dev-only, throws after emitting). Existing tests that match the message substring continue to work.

  The code identifier surfaces in console output and thrown errors, so users (and AI tools) can search documentation, issue trackers, and the source by code rather than parsing prose. The `code` field on `DiagnosticEvent` is unchanged — this only affects the human-readable `message` string.

- 4620612: Fix `createOptimisticStore` flicker on the second toggle of the same property when the action calls `refresh()` after `yield`. The stash branch's committed-view rerun was firing whenever the action queue was empty, even if the transition was still waiting on async reporters — causing render effects to briefly read the previous committed value before the new override. The rerun now also requires `_asyncReporters` to be empty, matching `transitionComplete`'s definition of idle.
- f7d5af6: Fix `<For keyed={false}>` (and `mapArray` with `keyed: false`) lagging by one update when its source is a store and a store property is mutated in-place. The mapArray internal owner now points its `_parentComputed` at the mapArray computed, so untracked store-proxy reads inside `updateKeyedMap` resolve to the pending value being written in the same flush rather than the stale committed value. Fixes #2687.
- c324d2c: `createEffect(compute)` (single-argument form) is now a hard error. Solid 2.0's `createEffect` requires a separate effect callback as its second argument: `createEffect(() => signal(), value => doWork(value))`.

  Two layers now surface the misuse:
  - **TypeScript** — a deprecated overload `createEffect(compute): never` is added so editors render the call with strikethrough and surface the migration message on hover.
  - **Runtime (dev)** — calling without an effect function now throws synchronously with a clear message and emits a new `MISSING_EFFECT_FN` diagnostic (replaces the previous opaque `TypeError: Cannot read properties of undefined`).

  If you want a derived value, use `createMemo`. If you want a one-shot side effect at construction time, just call the function directly.

- c324d2c: Tighten npm `description` fields across the published packages so they identify each package's role unambiguously in npm search results and AI-indexed package metadata.
  - `solid-js` — was generic ("A declarative JavaScript library for building user interfaces."); now names the actual differentiators (real DOM, signal-based updates, no virtual DOM).
  - `@solidjs/web` — names the concrete entry points (rendering, hydration, SSR, Portal, Dynamic).
  - `@solidjs/signals` — names the actual primitives (signals, memos, effects, stores, async-aware computations) instead of "reactive core implementation".
  - `@solidjs/h` — drops the self-deprecating "less-optimal" wording; states the use case (no compiled JSX).
  - `solid-html` — leads with the user-visible benefit (no build step).
  - `babel-preset-solid` — mentions what makes it Solid-specific (fine-grained DOM ops vs. generic JSX).

  `solid-element` and `@solidjs/universal` descriptions left unchanged.

- 3ee92f3: Fix mid-transition observability of mixed optimistic and entangled state. Subscribers recomputing under an optimistic lane that read a plain signal with a pending mid-transition write now see the signal's committed value (entangled), while optimistic overrides still project their optimistic value. Async drivers continue to read latest values for correct fetching. At commit, gated subscribers re-run with the new committed view.
- 0ef177e: Fixes #2686. Owned non-lazy memos no longer autodispose when their
  subscriber count momentarily drops to zero (e.g. during a transition swap,
  or when read only through `untrack` from a suspending render-effect). They
  now live for their owner's lifetime and retain their cached value, so an
  async `createMemo` read via `untrack` from a suspending consumer settles
  once and stays settled across re-runs.

  Lazy memos (`createMemo(fn, { lazy: true })`) and unowned memos retain the
  previous "compute-on-demand, dispose-when-not-needed" semantics, and the
  JSDoc on `lazy` now documents this contract.

  Internally this folds the per-node config booleans (`_ownedWrite`,
  `_noSnapshot`, `_transparent`, `_inSnapshotScope`, `_childrenForbidden`,
  `_preventAutoDisposal`) into a single `_config: number` bitfield with
  `CONFIG_*` constants, replacing `_preventAutoDisposal` (opt-out) with
  `CONFIG_AUTO_DISPOSE` (opt-in). Public node options are unchanged.

- 9015b12: Introduce `Refreshable<T>` as a public type alias for the `$REFRESH` brand applied to derived/projected stores. The return types of `createOptimisticStore`, `createProjection`, and the projection form of `createStore` now use `Refreshable<Store<T>>` instead of inlining `Store<T> & { [$REFRESH]: any }`.

  This fixes a TS4058 error in user-defined hooks that wrap these primitives — the inferred return type would previously reference the unique `$REFRESH` symbol from a deep import path, forcing consumers to write an explicit return annotation. `Refreshable` is re-exported from both `@solidjs/signals` and `solid-js` (client + server entries) so the inferred type is now nameable from any consumer.
  - @solidjs/signals@2.0.0-beta.9

## 2.0.0-beta.8

### Patch Changes

- 34c65b8: CSR: async reads without a `Loading` ancestor no longer throw. The root mount now participates in transitions — when uncaught async surfaces during initial render, the root DOM attach is withheld until all pending settles and then attaches atomically. On the no-async happy path, `render()` still attaches synchronously before returning (via an internal tail `flush()`).

  **New `schedule` option on effects**

  `@solidjs/signals` exposes a new `schedule?: boolean` option on `EffectOptions`. When `true`, the initial effect callback is enqueued through the effect queue (the same path user effects already take) instead of running synchronously at creation. This lets the initial run participate in transitions — if any source bails during the compute phase, the callback is held until the transition settles.

  ```ts
  createRenderEffect(
    () => source(),
    v => {
      /* runs after flush, deferred by any pending transition */
    },
    { schedule: true }
  );
  ```

  `@solidjs/web`'s `render()` uses this option internally for its top-level insert, which is what enables permissive top-level async in CSR.

  **Dev diagnostic**

  `ASYNC_OUTSIDE_LOADING_BOUNDARY` is now a non-halting `console.warn` (severity downgraded from `error` to `warn`). With deferred-mount the runtime is correct; the diagnostic is an informative FYI rather than a correctness failure. The warning only fires during the synchronous body of `render()` / `hydrate()` — post-mount transitions (including lazy route changes) run under their own transitions with the guard off and do not emit this warning.

  Placing a `Loading` boundary remains the right tool when you want explicit fallback UI or partial progressive mount.

  **Known limitation: multi-phase async**

  Multi-phase async flows — for example, a `lazy()` component whose resolved body reads a second pending async memo — may still reveal partial DOM between waves. This is because the scheduler currently nulls `activeTransition` before running the completing flush's restored queues; a new transition started by recomputes during that phase does not re-stash already-restored callbacks. Single-wave nested async (including static siblings alongside a pending descendant) commits atomically. The multi-phase case is tracked as a follow-up; the recommended workaround today is to place a `Loading` boundary around multi-phase async subtrees.

- ed2079f: Fix SSR `<Loading>` to handle a bare async memo passed directly as its child (e.g. `<Loading>{asyncValue()}</Loading>`). The boundary now catches the synchronous `NotReadyError` from the discovery pass, awaits the underlying source, and re-runs discovery — restoring parity with the client and allowing inner `<Errored>` boundaries to propagate async holes through outer `<Loading>` on the server (issue #2677).
- 2597a4a: Fix `createProjection` hydration from async iterables when no `Loading` boundary wraps the consumer (e.g. `Repeat` reading projection state directly).
  - `hydration.ts`: disable snapshot capture while applying the initial full value from the server iterable so `prepareStoreWrite` doesn't record the pre-write (empty) base as the snapshot. Without this, reads during hydration (like `Repeat` reading `length`) see the stale pre-value and fail to match the server-rendered DOM, producing unclaimed nodes and duplicated items.
  - `projection.ts`: eagerly assign the inner `computed` owner to the outer `node` binding on first run so `STORE_FIREWALL` lookups work during synchronous hydration writes (before `node = computed(...)` returns).

- 00c3f78: Fix `createProjection` streaming when no outer `Loading` boundary is present. Two related bugs were fixed, plus a small internal refactor:
  - The synchronous `reconcile` path in `createProjectionInternal` now goes through `storeSetter` so the `writeOnly` guard is engaged during reconcile reads. Previously it bypassed the guard, causing the projection's own reads (via its store's `_firewall`) to be tracked as dependencies, dirtying the projection mid-recompute and producing a runaway self-loop.
  - `recompute` now snapshots `_inFlight` before running the node's `_fn`. When `_fn` self-registers an async subscription (as `createProjection` does via an internal `handleAsync(owner, asyncIterable, setter)` call that returns `undefined` from the body), the outer `handleAsync(el, undefined)` would otherwise clear `_inFlight` and drop every subsequent yielded value. The snapshot lets `recompute` skip the outer `handleAsync` in that case and keep the internally-registered iteration alive, so projections stream all values (not just the first) regardless of whether a `Loading` boundary is present.
  - Internal: the projection recompute body (`draft + storeSetter + handleAsync + commit`) is now shared between `createProjection` and the derived form of `createOptimisticStore` via a `runProjectionComputed` helper. As a side-effect this routes optimistic projections' sync commit through `storeSetter` too, bringing them in line with the fix above.

- d46928f: fix: stores now batch like signals on cold writes

  Untracked reads of a store property after a `setStore` mutation now return the
  previous value until `flush()` (or the surrounding effect/transition) commits,
  matching `createSignal` semantics. The `in` operator batches the same way —
  after a cold add or delete, presence reflects the pre-write shape until commit.
  Previously both reads resolved synchronously against the override, which broke
  the "no reading uncommitted state" invariant for store properties that had
  never been observed.

  Internally we upsert a transient pending node for the property (and, on
  presence change, a matching `STORE_HAS` node) on cold writes, queue the new
  value as `_pendingValue`, and sweep nodes that never gain a subscriber when
  their pending write commits. Optimistic stores and projection writes are
  unaffected — they keep their immediate-visibility semantics.

- 000da61: Refactor `WidenPropValue` helper in `jsx-properties.d.ts` to split the nested conditional into a small named helper. Behavior-identical; removes a line that sat exactly at `printWidth: 100` so formatters running at the default width no longer fight the repo's prettier config.
- 2e4a924: Remove the `ssrSource: "initial"` mode and type derived `client` hydration reads as possibly undefined until hydration resumes.
- ac0067a: Replace `Reveal`'s boolean `together` prop with an `order` string union
  (`"sequential" | "together" | "natural"`) and add the new `"natural"` mode.
  - `order="sequential"` is the default and matches the previous default behavior.
  - `order="together"` replaces `<Reveal together>`; existing `together` props must be migrated to `order="together"`.
  - `order="natural"` is new. A nested `<Reveal order="natural">` group opts its own
    children out of the outer frontier (each child reveals as its own data resolves),
    while the group as a whole still acts as a single composite slot to the enclosing
    `<Reveal>`. This closes the gap where a nested subtree needed to respect its parent's
    broader ordering while returning to natural, independent reveal behavior internally.
  - `collapsed` is only consulted when `order="sequential"` (the default). It is
    silently ignored under `order="together"` or `order="natural"` — no type error,
    so dynamic `order` bindings don't need a discriminated-union workaround.
  - `RevealOrder` (the `"sequential" | "together" | "natural"` string union) is
    exported from `solid-js` for use in consumer code that types the prop directly.
  - `renderToString` now supports `order="natural"` out of the box (no streaming required).
  - `createRevealOrder` options changed from `{ together?, collapsed? }` to
    `{ order?, collapsed? }` with the same accessor shape.

  See `documentation/solid-2.0/03-control-flow.md` for the full outer/inner nesting
  matrix and SSR caveats.

- ac0067a: Fix nested `<Reveal>` coordination: a nested group is now held on its fallbacks
  until its parent releases the slot it occupies, in both the client runtime and
  SSR streaming. Previously, an inner `Reveal` inside an outer `order="together"`
  (or past the frontier of an outer `sequential` without `collapsed`) could reveal
  its own children independently, breaking the outer group's "reveal as one unit"
  guarantee.

  Key behavior changes:
  - `order="together"` now releases when every direct slot is "minimally ready"
    under its own order (a nested `sequential` is minimally ready at frontier-0,
    a nested `natural` when any child is ready, a nested `together` when all its
    children are ready) rather than waiting for every descendant to fully resolve.
    This keeps `together` composable without sacrificing the cohesive group reveal.
  - When an outer `sequential` advances to a nested `Reveal` as its frontier, or
    an outer `natural` surfaces a nested `Reveal` slot, the nested group is now
    released to run its own order locally. Previously the nested group inherited
    the outer's hold, which forced its children to reveal together once released;
    they now reveal per the nested group's own policy (e.g., inner `natural`
    children reveal independently as their data lands). This applies to both the
    client runtime and SSR streaming.
  - SSR fix: when an outer `sequential+collapsed` frontier advances to a nested
    `Reveal`, the inner group now emits `revealFallbacks` for its leaf children so
    their collapsed fallback templates become visible under the inner's own order.
    Previously the inner fallbacks remained hidden until they resolved. Requires a
    matching `dom-expressions` update: `$dflj(ids)` now materializes every id in
    the list instead of stopping at the first, so bulk uncollapse reveals all of
    its listed fallbacks in one call. Solid's `advanceFrontier` now passes the
    single new frontier key to `revealFallbacks` for sequential cascading, which
    preserves the prior incremental behavior.
  - Nested `<Reveal>` groups cannot opt out of an outer group's hold while it is
    still held. Wrapping a subtree in a `<Loading>` does not bypass this — the
    `<Loading>` is itself a slot the parent holds. Subtrees that need independent
    reveal should not be nested under an outer ordering.
  - On the server, HTML for resolved fragments still streams immediately into
    templates; only the `revealFragments` swap calls are stashed and drained in
    resolution order when the enclosing `Reveal` releases the slot.

  See `documentation/solid-2.0/03-control-flow.md` for the updated nesting matrix
  and the "minimally ready" definition per order.

- Updated dependencies [34c65b8]
  - @solidjs/signals@2.0.0-beta.8

## 2.0.0-beta.7

### Patch Changes

- e855fcb: Fix dual runtime package type resolution for CommonJS consumers.
- 76b11b2: Bump dom-expressions to next.22 with cascading root hole fix and jsx-properties type resolution
- 5869c94: Fix ASYNC_OUTSIDE_LOADING_BOUNDARY diagnostic firing even when a boundary handled the async
- 3242e50: Move loadModuleAssets to dom-expressions and consume via sharedConfig for lazy hydration without Loading boundary
- f18780e: Update `@solidjs/signals` to `0.13.12` to fix `Loading` boundaries mounted during async refresh so new fallbacks render instead of holding stale content.
- ea7f892: Fix ownerless conditional memo reads by reviving suspended unowned computeds on direct access, and align Repeat and Reveal compiler/runtime exports.
- beb419e: Move `@solidjs/signals` into the monorepo and wire local builds, tests, and releases to the workspace package.
- bd563d0: Remove the misleading initial value parameter from derived primitives and require explicit seed values for store-backed projection APIs.
- 5086c21: Rename `pureWrite` option to `ownedWrite` across signals and hydration to align with error messaging and documentation
- 8511fc1: Support async callbacks in createMemo and createProjection on the server by retrying when a NotReadyError-rejected promise is detected, instead of treating it as a terminal error
- Updated dependencies [5acf0ee]
  - @solidjs/signals@2.0.0-beta.7

## 2.0.0-beta.6

### Patch Changes

- 159d204: Add Reveal component SSR support with streaming fragment coordination, collapsed fallback mode, and nested composite slots
- df3f514: Align with dom-expressions: add MathML support to Dynamic/createElement, consolidate namespaces, remove deprecated isSvg/Properties/SVGNamespace
- 74ea248: Dev tooling 2.0 surface: remove registerGraph/sourceMap, consolidate devComponent metadata into single \_component object, wire DEV.hooks to @solidjs/signals hook registration (onOwner, onGraph, onUpdate, onStoreNodeUpdate), expose graph traversal helpers (getChildren, getSignals, getParent, getSources, getObservers) through DEV, export isDisposed
- 4a954e7: Fix server-side `createProjection` promise serialization to resolve with the projected state so hydration receives the correct value.
- 6a87fb2: Support Reveal collapsed mode in string (non-async) SSR by providing RevealGroupContext and collapsing non-frontier fallbacks server-side. Warn for nested Reveal in renderToString where client coordination is limited.

## 2.0.0-beta.5

### Patch Changes

- 03e2cca: Forward async iterator cancellation through hydration and SSR wrappers so generators close when hydration adapters or SSR serializers stop consuming them.
- 8ef7ece: **Loading hydration (client):** Serialized boundary refs that are already settled (`{ s: 1, v }`) still run one deferred `resumeBoundaryHydration` (with optional lazy-asset wait) so inner memos/projections match SSR; a per-boundary closure flag prevents double-scheduling—no global `WeakSet`/`Map`. Terminal serialized states `{ s: 1 }` and `{ s: 2 }` stay gather-only so a promise that later gets `p.s = 2` does not keep re-entering the pending branch and trapping the UI on the fallback. Standalone asset loading only runs when `!sharedConfig.has(id)` so it does not duplicate work when the boundary ref path handles assets. `gather` is optional for test hosts.
- 8db4de8: Treat Loading on as a value prop so keyed loading boundaries work with normal component usage.
- e6177b4: Fix streamed SSR `Loading` and `Errored` hydration so async memo rejections render the expected fallback and recover correctly after reset.
- 8ef7ece: Align server `createMemo` Promise handling with `@solidjs/signals`: pending promises now always attach `NotReadyError` regardless of initial value, so seeds like `[]` no longer skip Loading/async boundaries.
- 009d3de: Apply the remaining formatting updates for the streamed SSR hydration fixes and their regression coverage.
- 3bd00d2: Move `Loading` into the flow exports while keeping hydration-aware behavior in `createLoadingBoundary`.
- 3eed9c1: Refine server Loading and Errored settlement and update dom runtime dependencies.
- d037842: Tighten Show and Match JSX typings to reject ambiguous zero-argument function children.
- 6b4af47: Update to `@solidjs/signals` 0.13.8 and drop redundant hydrated async-iterable cleanup now handled by the signals core.

## 2.0.0-beta.4

### Patch Changes

- 681d6a5: Update the bundled `@solidjs/signals` baseline to `0.13.6` and fix boundary hydration so `ssrSource: "client"` children resume after hydration mode turns off.
- 2922dbb: Update the bundled `@solidjs/signals` baseline to pick up the recent beta bug fixes from #2628, #2631, #2633, #2634, #2635, #2636, #2619, #2637, #2638, and #2639, covering loading and error boundaries, pending state propagation, tracked effect semantics, `resolve()` behavior, and async generator projection and optimistic-store fixes.

## 2.0.0-beta.3

### Patch Changes

- 284738e: Re-export `enableExternalSource` and related types from `@solidjs/signals`. Add `on` prop to `<Loading>` component for declarative boundary reset.
- 5c961fa: Add regression test for #2620: createProjection + refresh with keyed For/Show tree rendering stale DOM nodes due to uncleared STATUS_PENDING flags (fix in @solidjs/signals)
- 284738e: Fix ssrSource "client" and "hybrid" mode hydration for projections and stores
  - "client" mode: use a `hydrated` signal gate so the user's function runs only after hydration completes, instead of returning an identity function that never transitions
  - "hybrid" mode: use a `hydrated` signal gate to load the server promise during hydration, then transition to the client's async generator post-hydration. A shallow shadow draft absorbs the first iteration's reads/writes (preventing first-value duplication) before switching to the real reactive store
  - Fix microtask timing in `hydrateStoreFromAsyncIterable` with a custom thenable so `process` and `asyncWrite` execute in the same microtask
  - Skip hydration wrapper for transparent memos (HMR support)

- 284738e: Rename `createLoadBoundary` to `createLoadingBoundary` for consistency with the `<Loading>` component naming.
- 26ea296: Suppress dev-mode "owned scope" warnings for internal hydration-gating signals by marking them as pureWrite, and bump @solidjs/signals to 0.13.3 which decouples snapshot exclusion from pureWrite via a new \_noSnapshot flag

## 2.0.0-beta.2

### Patch Changes

- 8187065: Add dev-mode error when async content is used in JSX without a `<Loading>` boundary during `render()`. In dev, the app is unmounted and an error message is rendered into the container. Re-export `setOnUnhandledAsync` hook from `@solidjs/signals`.
- 8187065: Refactor async iterable hydration to delegate to signals' handleAsync pipeline:
  - Replace imperative consumeFirstSync/scheduleIteratorConsumption with normalizeIterator that ensures V1 is sync for snapshot capture and V2+ are greedily batched after a single microtask deferral
  - createMemo, createProjection, and createStore(fn) hydration now return async iterables that handleAsync processes natively, eliminating manual flush/schedule management
  - Fix hybrid mode: processResult and createProjection .then() callbacks now return values so serialized promises resolve correctly
- 8187065: Fix SSR createSignal(fn) with async value showing undefined instead of triggering Loading boundary
- 8187065: Include `$REFRESH` in the return types of `createStore(fn)`, `createOptimisticStore(fn)`, and `createProjection` to match `@solidjs/signals` upstream types, and re-export `$REFRESH` from `solid-js`
- 8187065: Use untrack(fn, strictReadLabel) for strict-read warnings instead of separate setStrictRead API

## 2.0.0-beta.1

### Patch Changes

- dadeeeb: Add NoHydration/Hydration components, expose moduleUrl on lazy, fix mapArray hydration ID mismatch, update dependencies

  **NoHydration / Hydration components** — Moved from dom-expressions into solid-js using the owner-tree context API. `NoHydration` suppresses hydration keys and signal serialization for its children. `Hydration` re-enables hydration within a `NoHydration` zone with an `id` prop matching the client's `hydrate({ renderId })`. On the client, `NoHydration` skips rendering during hydration; `Hydration` is a passthrough. Lazy components inside `NoHydration` register CSS but not JS modules, enabling code-split islands without a compiler.

  **lazy().moduleUrl** — Exposed `moduleUrl` as a read-only property on lazy component wrappers (both client and server) to support Islands architectures and advanced asset discovery.

  **mapArray hydration ID fix** — Server-side `mapArray` was constructing owner IDs by decimal string concatenation (`"prefix" + 10 = "prefix10"`), while the client uses base-36 encoding (`"prefixa"`). Refactored to use parent/child `createOwner()` pattern matching the client, ensuring ID parity for lists with 10+ items.

  **Dependency updates** — `@solidjs/signals` ^0.11.3 (fixes strictRead in computations), `dom-expressions` 0.41.0-next.11 (resolveAssets base path prefixing, removed NoHydration/Hydration stubs), `babel-plugin-jsx-dom-expressions` 0.41.0-next.11 (SSR conditional memo alignment).

  **Test fixes** — Updated strict read warning message assertion, fixed SSR streaming test manifests to use relative paths (matching real Vite output), removed stale TODO, added comprehensive test suites for NoHydration/Hydration, mapArray base-36 IDs, ternary conditional ID parity, and Show fallback hydration toggling.

## 2.0.0-beta.0

### Major Changes

- c3e5e78: Async everywhere
- 2645436: Update to R3 based signals
- a4c833d: Update to new package layout, signals implementation, compiler

### Minor Changes

- Move pre-release tag from experimental to beta
- 75eebc2: feat: snapshot-based boundary-local hydration safety (Goal 4)

  Signal writes during hydration are now safe by construction. Each Loading boundary gets its own snapshot scope — computations created during hydration read snapshot values (matching server DOM) while writes update only the current value. After a boundary's sync hydration walk completes, its snapshot scope is released and stale computations rerun with current values.

  Key changes:
  - Add markTopLevelSnapshotScope/releaseSnapshotScope plumbing to all hydrated primitives
  - Extract createBoundaryTrigger() helper for internal trigger signals excluded from snapshot capture
  - Add resumeBoundaryHydration() with isDisposed guard, per-boundary scope management, and flush
  - Add onCleanup for cleanupFragment to handle orphaned streaming content on navigation
  - Remove deferHydration option (no longer needed with snapshots)
  - Remove isHydrating/onHydrationEnd from public API (snapshots make hydration timing transparent)
  - Update @solidjs/signals to ^0.10.7, dom-expressions to 0.41.0-next.6

- 75eebc2: feat(ssr): implement ssrSource, async iterable streaming, and client hydration (Goal 2d)

  Adds the ssrSource option (4 modes: "server", "hybrid", "initial", "client") controlling how computations serialize and hydrate. Server-side async iterable streaming via processResult tap wrapper with patch-based projection serialization. Client-side async iterable hydration with synchronous first-value consumption from seroval and scheduleIteratorConsumption for remaining values. Includes isHydrating/onHydrationEnd lifecycle APIs, deferHydration option, and subFetch updates for generator dependency capture.

### Patch Changes

- 512fd5e: update signals to 0.3.0
- dea16f3: Add client hydration support with tree-shakeable createMemo/createSignal wrappers, fix SSR context isolation for concurrent requests, align seroval serialization format, update @solidjs/signals to ^0.10.2
- 15dc3c6: return of useTransition, small API tweaks
- 874c256: fix input compilation, rebased dom-expressions
- 4cab248: Fix Dynamic component hydration key misalignment by aligning server-side createDynamic owner tree with client
- 1122d74: Fix server-side flow component hydration key alignment for Show, Errored, and Repeat
- c78ec9f: Bump dom-expressions to 0.41.0-next.9 to fix SSR spread element hydration mismatch. Dynamic children of spread elements were incorrectly wrapped in memo() on the server, consuming extra owner slots and causing \_hk value misalignment with the client.
- 9788bad: Harden SSR async error handling: add try/catch to Loading's async IIFE, serialize errors in createErrorBoundary for client hydration, and fix unhandled promise rejections in processResult
- 21fff6f: Make insert render effects transparent and align SSR owner tree to fix hydration ID mismatches
- 60f2922: Add hydration-aware wrappers for createErrorBoundary, createOptimistic, createProjection, createStore(fn), and createOptimisticStore(fn). Server-side createProjection now creates owner for ID alignment and handles async Promise returns. Bump @solidjs/signals to 0.10.4 for peekNextChildId support.
- 433eae5: Make `children` helper lazy to prevent hydration mismatches when resolved children are never inserted into the DOM. Export `storePath` and related types (`StorePathRange`, `ArrayFilterFn`, `CustomPartial`, `Part`, `PathSetter`) from both client and server builds. Bump `@solidjs/signals` to 0.11.1.
- b1646a5: update signals
- e8d8403: add action helper
- 1a1a5d4: add `from` to repeat
- 5f29f14: Update signals, dom expressions to default attrs
- 85aa54f: Refactor SSR stream blocking: delegate deferStream blocking to dom-expressions via serialize instead of imperative ctx.block() calls in processResult. Pass deferStream option through createSignal(fn), createMemo, and createProjection to serialize. Update dom-expressions to 0.41.0-next.3 for structural blocking support.
- 433eae5: Rename `pending` API to `latest`. `isPending(() => latest(value))` reads more naturally than the redundant `isPending(() => pending(value))`. Also renames internal `pendingReadActive`, `_pendingValueComputed`, and `getPendingValueComputed` in @solidjs/signals to align with the new name.
- c74106f: fix multi insert/removal, ssr wip, async signal render
- f4b0956: fix(ssr): lock server-side comp.value to first async iterable value

  During SSR, async-iterable-backed computations (createMemo, createProjection) now lock their readable value to the first yield. Subsequent iterations still stream to the client via seroval, but SSR reads always return V1. This prevents hydration mismatches when Loading boundaries retry after the iterator has advanced.

  For projections, the SSR-visible store state is deep-cloned at first value resolution, isolating it from subsequent generator mutations (including nested object changes).

- 3e3c875: remove runWithObserver, add back createReaction, createTrackedEffect
- 568ed6f: Add ssrSource support for createEffect and createRenderEffect; fix server createEffect to run compute function
- d1e6e29: Add dev-mode warning for untracked reactive reads in component bodies and control flow callbacks. Signals, memos, and store properties read outside a reactive scope now emit a console warning with the component or flow control name. Integrated into devComponent, Show, Match, For, and Repeat. Zero production overhead.
- 84c80f9: Make devComponent use transparent owner so dev-mode IDs match production for hydration parity. Bump @solidjs/signals to 0.10.3 for transparent owner support.
- 381d895: update signals to store/projections with returns
- fbbd7e3: Update dependencies (signals 0.10.5, dom-expressions 0.41.0-next.5) and fix build compatibility with Turbo 2.x and TypeScript 5.9
- 53dcb14: expose new transition methods
- dea16f3: Add server-side rendering implementation: pull-based server signals, streaming Loading component, SSR-aware flow controls, and hydration context infrastructure

## 1.9.12

### Patch Changes

- 51b0797: fix: prevent createDeferred from keeping Node.js process alive
- 6b0c4ee: fix: lazily create inTransition external source to prevent use-after-dispose
- 51cce75: Set committed value for computations created during transition
- c58983d: fix SSR output including `bool:` attribute serialization and escaping for logical and child expressions

## 1.9.11

### Patch Changes

- 6628d9f: Update dom-expressions/seroval to latest

## 1.9.10

### Patch Changes

- 2270ae9: Fix: Collision during SSR in createResource due to `loading` property.
- 94d87f1: Update `build:clean` and `types:clean` script to include missing paths
- 3114302: Improve `splitProps` performance
- 6c92555: Update dom-expressions, seroval plugins, optional chaining ref, style optimization

## 1.9.9

### Patch Changes

- f59ee48: fix dynamic overtracking
- 62c5a98: Update `SuspenseList` to handle hydration context
- 62c5a98: Add unit tests for `resolveSSRNode` and `createResource` functions
- c07887c: fix #2524 closedby types, fix regression inlining style/classList

## 1.9.8

### Patch Changes

- 09a9c1d: Export RendererOptions and Renderer types from solid-js/universal
- 472c007: fix(scheduler): adjust yield timing logic to improve task scheduling …
- 3d3207d: fix #2491 no key on merge false
- 2cd810f: compiler and jsx type updates
  - fix: ssr style undefined
  - fix: ssr double escaped array
  - fix: skip jsxImportSource skipping transform
  - fix: @once on style, classlist
  - JSX type updates
  - Update Universal Renderer Types
- cbff564: feat: createMutable support for class inheritance
- e056eab: add support for `is` in `Dynamic`, closes #2413
- bdba4dc: Fix resource instances always getting cached on SSR
- Updated dependencies [2cd810f]
  - babel-preset-solid@1.9.8

## 1.9.7

### Patch Changes

- 84ca952: Fix hydration issues caused by seroval update.
- 4cd7eb1: Catch synchronous errors in `createResource`.

## 1.9.6

### Patch Changes

- 362e99f: fix #2444 prev value in memo messing with reactive rendering
- 8356213: update compiler config, fix boolean attribute regression, update JSX types
- c65faec: fix #2428 - owner always present in resource fetcher
- 6380b01: fix #2399: novalidate, #2460 spellcheck types

## 1.9.5

### Patch Changes

- 86ae8a9: add optional initalValue argument to `from` helper
- 89e016d: dev: Add `internal` flag to signal
- 9431b88: Mirror createDynamic for SSR
- 35266c1: JSX type updates, preliminary MathML support, fix spread overescaping
- 0eab77d: Removed unnecessary evaluations of <Show> and <Match> conditions.
- fff8aed: Update typescript to 5.7
- f9ef621: dev: Add afterRegisterGraph hook replacing afterCreateSignal

## 1.9.4

### Patch Changes

- b93956f: fix escaping in resolution done outside of DOM Expressions
- 199dd69: fix reconcile null guard
- 7f9cd3d: lazy image, tagged template detection, security fixes
- 32aa744: Improve resolving arguments in createResource

## 1.9.3

### Patch Changes

- bb6ce8b: Reordering setter overloads
- 9b70a15: validation fixes, type updates, ssr attribute fix

## 1.9.2

### Patch Changes

- 22aff14: update validation: smaller lib, opt out, better table handling
  add `on:` event types for native events
- e2e2a03: Fix setter type compatibility with kobalte select and add tests

## 1.9.1

### Patch Changes

- fb67b687: fix anchor host interfering with event delegation
- 7ecf92d3: fix #2304 component props can be string, explicit imports in tests

## 1.9.0

### Minor Changes

- 4f8597dc: better handling of exports client/server
- 120bf06d: fix!: Remove browser field from package.json
- 2a3a1980: update dom-expressions
  - Improved Custom Element/Shadow DOM traversal - @olivercoad
  - Better heuristic to determine when to importNode - @titoBouzout
  - handleEvent syntax to allow custom event properties when not delegated - @titoBouzout
  - support for bool: attribute namespace - @titoBouzout
  - add "is" as detection for custom element - @titoBouzout
  - fix missing exports in different envs - @trusktr
  - better hydration mismatch errors - @ryansolid
  - improved HTML validation of JSX partials - @titoBouzout

### Patch Changes

- 80b09589: Improve signal setter type for code completion of string literal unions.
- 51bec61a: update TS to NodeNext

## 1.8.23

### Patch Changes

- bc20a4ce: update types, fix hydration cancel timing error, sync ssr script appending
- 9697c94b: jsdoc: Fix incorrect links of reactive utility `on`
- 9e192d7e: fix #2282: Add Check for Proxy support
- 379293d9: use correct hydration id in server lazy
- 73c00927: Fix missing code block end in `useTransition`'s jsdoc comment
- e4b2c668: fix missing disposal of nested transition nodes
- 94929afa: fix wrapping of object with `null` prototype

## 1.8.22

### Patch Changes

- f8ae663c: Fix broken links in Readme
- 19d0295f: fix stranded effects during hydration cancelation
- 26128ec0: fix #2259 attr: in ssr, updates some types

## 1.8.21

### Patch Changes

- a036a63a: shortcut hydrate call when hydration is done

## 1.8.20

### Patch Changes

- c8fe58e9: fix #2250 hydration error, fix lazy component loading, better hydration cancelation
- 80dd2769: fix #2236 improper shortcircuit in resource hydration

## 1.8.19

### Patch Changes

- 3fc015c2: track length in array helpers, fix mobx external source
- f909c1c1: fix #2228 - chained resources with initial values
- 816a5c61: fix #2209 processing parent before child value binding in select
- 424a31a3: optimize hydration keys

## 1.8.18

### Patch Changes

- 6693b56f: update TS, custom elements, and a lot compiler fixes
  fixes #2144, #2145, #2178, #2192
- a8c2a8f3: remove weird server resource hack, fix hydrated resource state

## 1.8.17

### Patch Changes

- 72c5381d: fix #2134, merge dom expressions fix #2136, fix #2137, fix #2110
- e065e475: fix #2135 ssr of top level fragments under Suspense

## 1.8.16

### Patch Changes

- 8de75a47: fix #2065 forward initial value to `on`
- 071cd42f: fix #2100, fix #2102 - hydration errors due to over optimization
- 3212f74d: Adjust some JSDocs

## 1.8.15

### Patch Changes

- 829af663: fix #2047 early interaction/multiple resources
- 4ee461dc: improve template escaping, fragment hydration, SVG use types

## 1.8.14

### Patch Changes

- 4b76be80: fix storage export in top-level package.json

## 1.8.13

### Patch Changes

- 3ac8210c: fix storage export

## 1.8.12

### Patch Changes

- aba5de08: fix #1746 class properties not working getters in createMutable
- 85b26c36: fix #2041, fix #2043 - async renderer timing, numeric prop literals

## 1.8.11

### Patch Changes

- 1ec67f15: fix #2028, fix #2029 revert spread value bypass, and guard multi-text

## 1.8.10

### Patch Changes

- 169d23b4: fix disposal timing when streaming

## 1.8.9

### Patch Changes

- 80d4830f: fix #2016 value spread, smaller build output
- 918586fb: fix #2017 object replacing array in `reconcile`
- 71bea784: fix #1971 order of merged properties
- b0862d39: fix #2014 html not replaced when resource resolves next `tick`
- cbc8d3ee: remove seroval plugins from build output

## 1.8.8

### Patch Changes

- 40b5d78d: chore(types): return mapped type for splitProps excluded `other` value
- 968e2cc9: update seroval, fix #1972, fix #1980, fix #2002, support partial ALS
- 292aba41: fix #1982 ErrorBoundary with ExternalSource
- 7e5667ab: fix #1998 Switch relying on order
- 8d2de12f: fix #1850 untrack in external source
- b887587a: fix #1973 array over object reconcile

## 1.8.7

### Patch Changes

- 22667bbc: fix: createSignal not found when bundled
- e09a3cc3: fix timing issue with deferStream

## 1.8.6

### Patch Changes

- 2b320376: Add types directory export for each package
- fb7f4bc1: fix #1950 leaking error tracking
- b092368c: feat(DEV): Add afterCreateSignal hook to DevHooks
- 54e1aecf: update seroval, fix this, optimize star imports, fix #1952 hydration race condition

## 1.8.5

### Patch Changes

- 80ca972f: fix `onHydrate` call being skipped

## 1.8.4

### Patch Changes

- cf0542a4: fix #1927, fix #1929, fix #1931, update storage API
- 3f3a3396: serialization error handling, experimental async storage

## 1.8.3

### Patch Changes

- 1f0226e1: fix #1917 for real this time

## 1.8.2

### Patch Changes

- b632dfd5: Add missing `indexArray` to server-side runtime.
- dd492c5e: fix #1917, fix #1918 error handling with serialization
- 4968fe26: Add `.js` extension to import

## 1.8.1

### Patch Changes

- 0b9b71aa: better errors for hydration

## 1.8.0

### Minor Changes

- 2c087cbb: update to seroval streaming serializer, change ssr markers
- 2c087cbb: hydration perf improvement, fix #1849

### Patch Changes

- 2c087cbb: remove attribute quotes in template, batch serialization
- 2c087cbb: improved serialization/guards, fix #1413, fix #1796 hydration with lazy
- 2c087cbb: fix: missing `has` property in `SharedConfig`
- 2c087cbb: fix #1905, fix #1908 JSX type ommissions

## 1.8.0-beta.2

### Minor Changes

- e3a97d28: hydration perf improvement, fix #1849

### Patch Changes

- d797a143: fix #1905, fix #1908 JSX type ommissions

## 1.8.0-beta.1

### Patch Changes

- f6d511db: remove attribute quotes in template, batch serialization
- af625dd3: fix: missing `has` property in `SharedConfig`

## 1.8.0-beta.0

### Minor Changes

- d8e0e8e8: update to seroval streaming serializer, change ssr markers

### Patch Changes

- bf09b838: improved serialization/guards, fix #1413, fix #1796 hydration with lazy

## 1.7.12

### Patch Changes

- 12eb1552: fix #1875 - mergeProps not handling undefined on SSR
- 13b1fa6e: fix #1883 initialize createDeferred with transition value
- 10ac07af: update jsx types, iife compiler optimization
- 8b49110b: Allow passing defer:boolean to `on`

## 1.7.11

### Patch Changes

- 26740b88: fix #1848 Suspense Default Context Non-Null

## 1.7.10

### Patch Changes

- 5ed448ae: Export `ContextProviderComponent`, `ResolvedChildren` and `ResolvedJSXElement` types
- 7dd1f413: fix .pipeTo signature to return promise
- c2008f02: Fix underscore property
- 792e7dea: fix #1821 improve context performance

## 1.7.9

### Patch Changes

- 44a2bf0b: fix #1814 incorrect typing embedding for h and html
- 6cd10c73: Changes how the Setter type was declared without actually functionally changing it, fixing the Setter type being assignable to any other Setter type; fixes #1818.

  Generically typed Setters must now non-null assert their parameter, i.e.

  ```diff
  function myCustomSignal<T>(v: T) {
    const [get, set] = createSignal<T>();
  -   const mySetter: Setter<T | undefined> = (v?) => set(v);
  +   const mySetter: Setter<T | undefined> = (v?) => set(v!);

    const [get, set] = createSignal<T>(v);
  -   const mySetter: Setter<T> = (v?) => set(v);
  +   const mySetter: Setter<T> = (v?) => set(v!);
  }
  ```

- 6c9879c9: fix in introspection in stores
- 039cf60d: update universal runtime readme
- 852f4c76: add missing link jsx types

## 1.7.8

### Patch Changes

- efd23186: fix #1780 invalid HTML comments
- 51074fab: remove optional chaining, reduce bundle size
- fe6f03f9: fix #1795 early effects running during async hydration

## 1.7.7

### Patch Changes

- c4cbfd3c: fix(Portal): reactive in children when pass signal directly
- 0100bd12: Propagate errors to parents when throwing errors in nested catchError
- 46e5e787: Improve type inference of `createSelector`.
- 8ba0e80a: Fix `mergeProps`.
- e660e5a3: add prettier code format in git-commit-hook
- 93d44d45: fix #1787 missing CJS types

## 1.7.6

### Patch Changes

- 83c99d51: fix #1739 resolved state of disabled resources
- f99dd044: Solid-Element: Add clarification on 'props' parameter in customElement function
- 88493691: apply reference optimization to mergeProps
- 514ef679: test: add tests to `splitProps`
- 20261537: fix #1735 web component instantiation before constructor
- 194f93c7: Improve performance in `splitProps` and `mergeProps`

## 1.7.5

### Patch Changes

- 5288cfa8: fix #1713, fix non-option jsx types
- 8852c199: test: add tests to `splitProps` and `mergeProps`

## 1.7.4

### Patch Changes

- 1b5ea076: perf: avoid unnecessary flat
- 91110701: fix element/test mismatch issues #1684, #1697, #1707
  fix solid-ssr types
  add missing JSX types #1690
  fix firefox iframe #1688

## 1.7.3

### Patch Changes

- 655f0b7e: fix attr in ssr spread, fix static undefined classList values, fix #1666 directives in TTLs
- 8ce2c47b: Portal fixes #1676, #1677

## 1.7.2

### Patch Changes

- 27994dc9: Another attempt at fixing skypack
- dfec6883: fix #1668 proto methods on store data nodes

## 1.7.1

### Patch Changes

- ba024813: fix ref timing in portals

## 1.7.0

### Minor Changes

- 503b6328: Add type narrowing non-keyed control flow
- 86c32279: always cast to errors when handled
- f7dc355f: Remove FunctionElement from JSX.Element types
- 940e5745: change to seroval serializer, better ssr fragment fixes
- 608b3c3a: Add catchError/deprecate onError
- 2b80f706: Reduce DOM compiler output size
  Remove auxilary closing tags and lazy evaluate templates
- 8d0877e4: fix #1562 cleanup order
- 74f00e15: Support prop/attr directives in spreads, apply prop aliases only to specific elements

### Patch Changes

- 6b77d9ed: Better types on function callback control flow
- 41ca6522: fixes around templates and hydration
- 840933b8: fix #1653 portal bypasses Suspense
- cb6a383d: ensure narrowed values are non-null
- 3de9432c: Better Input Event Types, Template Pruning, Universal Renderer Fixes
- 2cb6f3d6: fix treeshaking in rollup 3
- 24469762: Add a reference to the component funciton to DevComponent owner.
  Rename DevComponent's property from `componentName` to `name`.
- 5545d3ee: Type narrowed flow on the server, add stale warning
- 0dc8e365: Make non-null control flow assertion stricter by throwing
- 4929530b: Remove name generation of owners and signals
- 71c40af6: DEV: Minor additions and change the API of dev hooks
- 6a4fe46c: fix #1553 improper html entity encoding in literal expressions
- 5d671b89: Fix external source tests
- 23c157ac: fix backward compatibility of template, fix #1639 loading on iframe

## 1.7.0-beta.5

### Patch Changes

- 0dc8e365: Make non-null control flow assertion stricter by throwing

## 1.7.0-beta.4

### Patch Changes

- cb6a383d: ensure narrowed values are non-null
- 3de9432c: Better Input Event Types, Template Pruning, Universal Renderer Fixes
- 2cb6f3d6: fix treeshaking in rollup 3
- 23c157ac: fix backward compatibility of template, fix #1639 loading on iframe

## 1.7.0-beta.3

### Patch Changes

- 41ca6522: fixes around templates and hydration

## 1.7.0-beta.2

### Minor Changes

- 940e5745: change to seroval serializer, better ssr fragment fixes

## 1.7.0-beta.1

### Minor Changes

- 608b3c3a: Add catchError/deprecate onError
- 2b80f706: Reduce DOM compiler output size
  Remove auxilary closing tags and lazy evaluate templates
- 8d0877e4: fix #1562 cleanup order
- 74f00e15: Support prop/attr directives in spreads, apply prop aliases only to specific elements

### Patch Changes

- 6b77d9ed: Better types on function callback control flow
- 24469762: Add a reference to the component funciton to DevComponent owner.
  Rename DevComponent's property from `componentName` to `name`.
- 5545d3ee: Type narrowed flow on the server, add stale warning

## 1.7.0-beta.0

### Minor Changes

- 503b632: Add type narrowing non-keyed control flow
- 86c3227: always cast to errors when handled
- f7dc355: Remove FunctionElement from JSX.Element types

### Patch Changes

- 4929530: Remove name generation of owners and signals
- 71c40af: DEV: Minor additions and change the API of dev hooks
- e245736: Fixed test case for setStore 7 parameter overload by fixing KeyOf giving number for KeyOf<never>
- 6a4fe46: fix #1553 improper html entity encoding in literal expressions

## 1.6.16

### Patch Changes

- d10da016: Fix #1651 hydration markers introduced too early
- 620c7636: Switch test runner from Jest to Vitest

## 1.6.15

### Patch Changes

- e8448ebd: fix #1624 early fallback removal, add missing svg pathLength type
- da83ebda: defer ssr cleanup to next macrotask

## 1.6.14

### Patch Changes

- 6cceab2f: fix #1613 broken renderToString

## 1.6.13

### Patch Changes

- af20f00b: fix #1602 wrong resource state during SSR
- 60f8624d: fix #1596 ssr fragment text merge, fix #1599 ssr onCleanup

## 1.6.12

### Patch Changes

- e2888c77: Correct the type of `isServer` const to `boolean` from `false`.
- 676ed331: docs: fix typos
- b8a3ff13: fix #1586 error boundary called twice
- 1aff80c6: fix #1573 top level reconcile not merging
- 53db3f0f: fix fallback hydration
- 47d574a8: fix #1588: dynamic mount elements in Portals without recreation
- e245736f: Fixed test case for setStore 7 parameter overload by fixing KeyOf giving number for KeyOf<never>
- 61d1fe25: Export `isDev` const from solid-js/web for differentiating between dev/prod env.
- 4fdec4f9: fix #1564, fix #1567 template literal bugs

## 1.6.11

### Patch Changes

- bfbd002: Fixed the store setter's recursive fallback overload not terminating with non-numbers
- 1ecdea4: chore: export package.json
- 91d518a: fix: createResource should not ignores empty string throw
- 18e734d: Support null for detachedOwner in createRoot
- 12d458d: fix #1547, missing SVGPattern type
- 4aaa94b: Fix: swap KeyOf for MutableKeyOf in one of the SetStoreFunction overload
- c26f933: Add fast track for `untrack` in case of `null` listener
- 6fb3cd8: fix #1541: process errors at the end of synchronous execution
- c5b208c: fix #1522, errors stop future effects from running

## 1.6.10

### Patch Changes

- 1b32e63: Fix broken comments description link to solid docs
- dd879da: fix #1493 export DynamicProps
- d89e791: Add generic to onCleanup
- 695d99b: Export `EffectOptions` and `OnOptions` from main module
- d35a1ca: Fixed the return type of the `Symbol.observable` method of the `observable` in the generated `.d.ts`
- 7ab43a4: fix #1492 SSR Spread Breaks Hydration
  fix #1495 runWithOwner not clearing listener
  fix #1498 unrecoverable error in async batch

## 1.6.9

### Patch Changes

- a572c12: Streaming without a wrapper and compile time JSX validation
- 0ad9859: fix #1478 error infinite loop
- 12629a3: DEV: registerGraph `graph` property added to values

## 1.6.8

### Patch Changes

- 6db2d89: Fix #1461 - streaming broken due to reusing same resources for lazy dedupe

## 1.6.7

### Patch Changes

- c4ac14c: Format/Cleanup Types and code style
- 1384496: Fix unowned roots having owner in dev
- 1dbd5a9: stub out render and hydrate on server
- 368e508: make splitProps with dynamic source return proxies
- 54f3068: fix #1452 runWithOwner responsible for errors in its scope
- c8edacd: Fix lazy defined in components during SSR
- 89baf12: fix boolean escaping, improve ssr performance

## 1.6.6

### Patch Changes

- a603850: Export SignalOptions
- 2119211: fix #1423 - inlined arrow functions in SSR and update rollup
- 5a5a72d: Fix #1436 incorrectly missing proxy detection
- 5eb575a: fix: delete lazy contexts one by one as they are completed

## 1.6.5

### Patch Changes

- 50d1304: fix #1416 nulls in array reconcile
- ee71b16: fix #1410 - node 14 compatibility. Remove `||=` operator that isn't available on some legacy platforms.

## 1.6.4

### Patch Changes

- a42a5f6: memoize merging functions

## 1.6.3

### Patch Changes

- e95e95f: Bug fixes and testing changelog
