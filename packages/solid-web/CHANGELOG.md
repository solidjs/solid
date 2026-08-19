# @solidjs/web

## 2.0.0-rc.1

### Patch Changes

- 8fec5a3: Document the supported document-shell hydration pattern on hydrate(): when the server renders a full document but the client hydrates only the app subtree, wrap the shell in NoHydration and re-enter with Hydration around the app so both sides share a hydration id namespace (#3000). The pattern is now pinned by server/client test pairs.
- 56ca647: `lazy()` and `clientOnly()` accept an `{ export }` option to select a named export of the resolved module (defaults to `default`). The export name is a call-site literal available in both bundles, so lazy hydration still resolves the component synchronously from the preloaded module — wrappers that pick an export at runtime inside the import thunk remain unsupported and now fail loudly in dev. `lazy()`'s bundler-injected `moduleUrl` moves to the third argument to make room, matching `clientOnly()`.
- Updated dependencies [3c68ab2]
- Updated dependencies [62e7883]
- Updated dependencies [4f84cd5]
- Updated dependencies [8366208]
- Updated dependencies [66accfb]
- Updated dependencies [56ca647]
- Updated dependencies [366da09]
- Updated dependencies [254daf8]
  - solid-js@2.0.0-rc.1

## 2.0.0-rc.0

### Patch Changes

- Updated dependencies [427dc18]
- Updated dependencies [667a020]
- Updated dependencies [d9050a8]
  - solid-js@2.0.0-rc.0

## 2.0.0-beta.34

### Patch Changes

- 57194d8: Update dom-expressions to 0.50.0-next.42 — the multi-root hydrate/islands fix. Pages that call `hydrate()` more than once (islands entry-clients, Astro-style one-render-per-island documents) hydrate correctly: each root re-installs its own captured registry/gather and re-arms `hydrating` across the deferred module-preload render instead of racing other roots on the shared live `sharedConfig`, and the root module map serializes renderId-scoped (`<renderId>_assets`, with a bare `_assets` fallback for the single-render islands shape) so per-island `renderToString` writes stop clobbering each other's preload maps. Whole-document renders are unchanged.
- Updated dependencies [f14e4ec]
  - solid-js@2.0.0-beta.34

## 2.0.0-beta.33

### Patch Changes

- f3accb3: Container tier at the slot border (DR-2 case 3): projections passed as slot args to server components cross as bounded async traces — one snapshot, then PatchOp batches — and materialize on the client as live read-only projections. Server: the projection trace registry (`getProjectionTrace`) with a multi-consumer shared pump (one source iterator drives an append-only patch log; hydration resume and every slot crossing replay from their own cursor, snapshots captured only at stable pull boundaries). Client: `materializeContainerTrace` — a projection fed by the trace under its own root; the container reference is available synchronously, reads into it suspend until the snapshot (the fill's own `<Loading>` covers them), patch batches apply granularly, the trace's end latches the last state. The frames client installs the materializer, revives document-face `{ $tr, $ta }` marker literals at arg-read, and classifies containers FIRST and trap-safe (a pending projection's property probe throws not-ready): the slot props proxy returns the store instead of async-probing it, and the record-dedupe compare identity-tests containers through the host's `isContainer` hook.
- 8923ac6: Shrink CSR bundles by moving the hydration-phase coordination seams (`sharedConfig.isHydrationInProgress` / `sharedConfig.onHydrationEnd`) out of the `sharedConfig` object literal and into `enableHydration()`, matching the null-slot pattern every other hydration hook already follows. Declaring them in the literal retained their bodies and the hydration-phase bookkeeping they close over (`_pendingBoundaries`, `_hydrationDone`, the callback list) in every client bundle; installed by `enableHydration()` they shake out of pure-CSR builds (≈100 B brotli on the CSR size scenario, ≈80 B on the minimal-app floor). Both fields were already typed optional and documented as cross-package internal wiring; consumers treat absence as "not hydrating" — the refresh runtime already optional-chains, and `clientOnly` now falls back to a bare `queueMicrotask`, which is byte-for-byte the behavior `onHydrationEnd` itself had outside hydration.
- 3bcce84: Document-face live holes (Stage 4): `inServerComponentScope` gates live-hole arming and the iterable-memo pump to server-component render barriers on the document face, and the frames client pumps the `sc:live` channel record — one module-level reader broadcasting hole/attr ops to every adopted boundary (geometry routes; a log replay catches up boundaries that adopt after ops arrived, and call-driven streams supersede document ops).
- dd163c5: Apply document-face `slot` ops from the `sc:live` channel (DR-2 case 1 at t=0): a re-emitted occurrence record updates the adopted occurrence's live props in place. Slot ops are store-keyed rather than geometry-routed — two boundaries can share an occurrence name — so they carry the producing frame's id and only the owning boundary applies them.
- a8d56dc: `RequestEventLocals` reaches the public types through a real (non-type-only) re-export: the types build rewrites the copied `client.d.ts`'s `export type { RequestEventLocals }` to a plain re-export (failing loudly if upstream drifts), so `declare module "@solidjs/web"` augmentation identity never depends on TypeScript's `export type` alias handling. Acceptance type tests now cover augmentation from a `.ts` module that imports nothing from the package and from a module-form `.d.ts`, and RFC 12 documents the two sharp edges reproduced while investigating: a `declare module` block in a global _script_ file (a `.d.ts` with no top-level import/export) is an ambient module declaration that replaces the package's types wholesale rather than augmenting them, and a `foo.d.ts` sharing a sibling `foo.ts`'s basename is treated as compiled output and silently dropped from the program.
- 2722022: Frames client, size audit pass: (1) the seroval codec no longer ships in the eager graph — the per-response data tables materialize lazily through the frame host's new `prepareData` hook (`import("@solidjs/web/serialization")` awaited by the transport before the first `data` chunk delivers), so HTML chunks, scalar slot args and document records (self-executing hydration scripts) stay codec-free; the eager frames consumer drops from ~16.8 to ~10.9 kB gz, with the codec loading on demand only when serialized data actually arrives. A new size scenario pins the eager entry at 10.35 KB with the codec external, so a static seroval import creeping back fails CI. (2) The `sc:live` catch-up log compacts on last-value-wins keys (`type:fid:key`) instead of retaining every op for the life of the page — memory is bounded by distinct targets and a late-adopting boundary replays the latest state in one pass instead of the whole history.
- 3740fde: Include the cookie API declaration files in the published package for both ESM and CommonJS consumers.
- 09e2d3b: Server support for live markup holes (Stage 3): `creationStamp()` exposes an owner-creation counter the live-holes engine uses as an impurity gate, boundary output accessors (`Loading`, error boundaries) tag `$lhSkip` so boundary machinery is never treated as a re-runnable hole, and the async-iterable memo pump acquires the response-window hold (`ctx.hold()`) so iterable-fed holes stream every value before the response closes.
- 536dec5: Require a declared commit #0 for `ssrSource: "client"` (#2981). The server cannot run a client source, so the author must say what the pre-compute window renders: `loadingValue` on signal-family sources (`createMemo`, function-form `createSignal`/`createOptimistic`; an explicit `loadingValue: undefined` is a valid declaration — put the undefined in the type and branch on it), `seedLoadingValue: true` on store-family sources (`createProjection`, derived `createStore`/`createOptimisticStore`; the seed is what the window shows). Effects are exempt — nothing renders from them.

  Enforced at the type level (the bare `"client"` overloads are gone) and with a runtime error naming the fix — behind the dev flag on the client (zero production bytes; prod falls back to the previous gate behavior), always-on in the single-build server entry, where the implicit promotion would flush into markup. `Portal`'s internal client-sourced memos now declare `loadingValue: undefined` ("server renders nothing" is their honest commit #0).

- 45ef757: New `@solidjs/web/serialization/decode` entry: the codec's decode half on its own (the web plugin set, `createJSONDeserializer`, `createJSONDataTable`). The frames client and the server-function response path late-load this entry instead of the full serialization module, so the encode machinery ships to a browser only when rich arguments actually serialize — the lazy codec chunk drops from ~13 kB gz to ~6.5. The full `@solidjs/web/serialization` entry is unchanged (it re-exports the decode half).
- 3b97432: Update dom-expressions to 0.50.0-next.41 — the published runtime for the DR-2/live-holes arc this branch builds on. The container tier lands (DR-2 case 3): reactive containers passed as slot args cross the slot border as their trace — an async iterable of a snapshot plus PatchOp batches — and materialize back into live read-only containers on the client, on both faces, with the `ContainerTracePlugin` riding the codec's default plugin set and its hooks living in a registered global so duplicated bundle copies share one protocol endpoint. Live markup holes reach the document face (Stage 4 producer half: one per-document engine, re-emissions on an eagerly-serialized `sc:live` record) and live attribute holes ship element-addressed via `data-lha` (Stage 3); document-face slot args get per-arg pending (a not-ready getter rides its own boundary instead of coarse-holding the occurrence) and mint-suppressed fill interiors, and scope-minting arg expressions latch instead of re-emitting (no duplicate projections, no never-ending responses). Server functions decouple the transport/codec from the codec-free registry surface (`server-functions/registry.js` + a late-bound RPC seam on `globalThis`), so an app with zero server functions stops shipping seroval and the fetch RPC client; results negotiate the JSON fast path with a lazily-loaded codec, and `isJSONSafe` survives cyclic and deeply nested values so negotiation failures stop masquerading as function errors (#566). Also picks up the serializer decode split (lazy readers load half the codec), Node16-CJS importable main-entry types, tree-shakable `ResponseEnvelope`, hydrating inserts keeping `current` honest about the DOM, and the streaming-SSR retry robustness fixes (branded retry wrappers ending O(N²) stack growth; real errors in retry passes fail the request, not the process).
- 38a8b51: `httpHeader`/`httpStatus` retraction is declaration-exact instead of snapshot-restore: each response head keeps a ledger of live declarations per header (and for status), and disposing a scope removes only that scope's entry, replaying the survivors over the integration's base value in original write order. The write-time whole-field snapshot was only correct for LIFO disposal — when an earlier sibling SSR scope recovered while a later writer stayed live, restoring the earlier snapshot deleted the survivor's contribution (silently dropping e.g. a session `Set-Cookie`; same ordering hole for plain headers and `httpStatus`, #2984). Set-cookie ledgers stay entry-exact (`getSetCookie()` + re-append), and once a header's last declaration retracts its ledger is dropped so a later declaration re-reads a fresh base.
- da5646b: Server-function results negotiate a JSON fast path and the seroval codec
  loads lazily. The runtime's shared wire layer now late-loads the codec with a
  dynamic import the moment a Serialized body actually has to be encoded or
  decoded; since the server answers JSON-safe results (single-flight
  `{ value, data }` envelopes included) as plain JSON and void results
  body-less, a plain-data app's client bundle carries only the transport
  (~2.9 kB gz eager, down from ~7.3) and the codec arrives as a lazily-fetched
  chunk only when a rich value — a Date, a Map, a stream, a typed Error —
  appears on the wire. The packaging resolves that dynamic import to the public
  `@solidjs/web/serialization` entry (these single-file dists cannot
  code-split), so the app's bundler splits it at the package boundary and the
  lazily-loaded codec is the same module instance custom plugins are authored
  against.
- 57611e8: The production server bundles build with `_DX_DEV_` replaced to false. The main server Rollup target (dist/server.js/.cjs — the only node/worker/deno artifact) was missing `replaceDev(false)`, and babel constant-folds the unreplaced truthy `"_DX_DEV_"` literal, so the shipped artifact permanently took the dev branch of every build-mode gate — most damaging the committed-stub header guard, which is spec'd to throw in dev but `console.error` + no-op in production: a post-commit header write from late async SSR work crashed a live production request instead of being reported and dropped (#2982). The frames server target had the same omission (dev-only useHead/insert warnings shipped in prod). Because the constant folding erases the `_DX_DEV_` marker whether or not the replace ran, the contract is pinned behaviorally by a new spec that imports the built dist/server.js directly, bypassing the suite's source aliasing.
- Updated dependencies [f3accb3]
- Updated dependencies [8923ac6]
- Updated dependencies [3bcce84]
- Updated dependencies [23657d2]
- Updated dependencies [a37611e]
- Updated dependencies [ba7560f]
- Updated dependencies [28f7bec]
- Updated dependencies [09e2d3b]
- Updated dependencies [913913a]
- Updated dependencies [ce8e46b]
- Updated dependencies [c320429]
- Updated dependencies [766ea30]
- Updated dependencies [536dec5]
- Updated dependencies [af1c71e]
- Updated dependencies [ab5f83c]
- Updated dependencies [d7f95bb]
  - solid-js@2.0.0-beta.33

## 2.0.0-beta.32

### Patch Changes

- b160a5f: New `asyncArg` helper on `@solidjs/web/frames` (both faces): the type-level statement of the DR-2 value-tier contract at the slot border. What you pass is what ships — the promise / async iterable itself rides the data channel — but the client's prop read settles, so `Slot<P>` deliberately types the fill's props as the settled values. `asyncArg<T>(value: PromiseLike<T> | AsyncIterable<T>): T` is the identity that lets a server component pass an async value through a slot typed with its settled shape without widening `Slot`'s parameter type (which would leak async unions into every client fill's contextual typing).
- 311cc4e: DR-2 value tier, client half: async values passed whole as slot args (promises, async iterables) suspend at the consumption read. The slot-props proxy routes an async-valued prop through a lazily created async memo under the occurrence's owner, so the read follows the normal async path — it suspends into the covering loading boundary and settles when the server's data chunk lands. Applies on both the live-props and static-args paths. (The shell gate this leans on — a fresh mount's covering `<Loading>` holding until the frame's first apply — shipped separately; here it's what gives a t=0 fill's pending async arg read its covering boundary.)
- e999401: Fix a remounted `dynamic` server-component site rendering the first resolution's content instead of the latest call's (the away/back navigation regression on the identity split). `dynamic`'s kept-resolution path returns `prev` — a binding whose `.address` is frozen at the first resolution — and delivers fresh addresses only to currently-mounted sites, so a site that unmounts and later remounts initialized its address accessor from the stale binding: the fresh mount bound the first call's resident store (the SSR payload, in the document-adoption shape) while the remount's refetched response warmed a store nothing was bound to. The latest resolved address is now tracked at the `dynamic()` level and new mounts initialize from it; live-delivery into mounted sites is unchanged.
- c85b610: Stream-mounted slot fills now dispose at occurrence unmount (the lifecycle matrix's cleanup gap). A fill invoked from a stream microtask used to render under the boundary's owner, so its `onCleanup` and effects survived a later response dropping the occurrence and only died at boundary dispose — a leak for keyed churn in long sessions. Those fills now render under a per-occurrence owner tied to the frame's occurrence-level cleanup: a response that drops the occurrence (or a morph that destroys its range) disposes the fill's reactive scope right there, and a re-invocation supersedes the previous scope before rendering.

  Live-render invocations — a reveal boundary's content render, the t=0 adoption sync — deliberately keep their ambient owner. The covering render already owns their lifetime, and tying them to frame cleanups is actively wrong: the frame's zombie heuristic reads "mounted nodes without a parent" as a destroyed mount, but a pending fill's nodes are legitimately detached while its covering boundary shows the fallback — disposing there would kill the live pending effect and reveal the segment over a hole.

- af97611: A `<Loading>` inside a server component now reveals on document SSR (#2978). A deferred fragment whose producer ran on the SERVER has no client boundary to ever register as its claimant, so a `$df` settling after hydration completed was held forever by the held-swap policy (#2964) — fallback frozen on screen — while the frames classification gate (#2968) deferred on the very `fr.pending()` answer that hold kept true: a deadlock between two individually-correct policies. The fragment ledger now exposes the claimant contract (`_$HY.fr.claim`/`release`, the same one Loading boundaries use internally), and the frames document adoption — which owns the markup it adopts wholesale — goes on record as the claimant for every `pl-*` placeholder in its region: at adopt time, again for content revealed into the region later (an outer fragment's payload can carry a nested pending one), retiring its claims when the frame disposes. The secondary defect is fixed in the ledger itself: content whose placeholder range was removed (a refetch morphed over the region before the document delivered) can never swap, so it no longer keeps `fr.pending()` reading "in flight" for the rest of the page's life.
- 80970b7: Drain hydration records when a fragment reveals into an adopted server-component region. A slot invoked inside a server `<Loading>` ships its `sc:slot:` record with the deferred fragment — about the async's own delay after the boundary adopted, long after the adopt-time drain ran. That record was then stranded: the classification gate's only other re-drain arms on `_$HY.fr.pending()`, and the very reveal that delivers the record is what flips it false (a revealed fragment is no longer pending). The occurrence stayed recordless, so the next full sync — a refetch's stream apply — classified the region's render prop as a direct-insert value and evaluated it as a zero-arg accessor, whose props read halted the reactive system.
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

- 8e148a8: `isPending` holds through a server component's args switch (#2977). An args change on a live site resolves its call at response-HEADER time — the identity split keeps the instance and rebinds the frame to the new address — but the header is not an answer: for exactly as long as the server held the shell on its own unboundaried async, the site read "settled" while the boundary still showed the PREVIOUS call's content, tearing the driving source's pending state against the screen ("count is 1" beside count-0's markup). The shell gate is now re-armable: an address switch re-pends the site until the new address's first apply — its shell content, a server-rendered `<Loading>` fallback (boundaried pends drop `isPending` as readily as a client fallback: the answer is on screen), or its error record (the pending state must never outlive the response). Async-holds-latest keeps the old content in place while the gate pends, and a warm store still answers instantly — arm-then-rebind is self-correcting, since a warm registration's synchronous seed releases the gate before any reader sees it.

  Both faces: the call-driven mount re-pends through its existing gate chain, and the t=0 adopted mount — whose return value is the raw SSR'd element that hydration claims in place, leaving no reader in the render graph to see an armed gate — gets a dedicated pending-observer effect that holds the delivering transition (the notes-search shape: adopted sidebar, then a search param changes the call).

- 595b9e9: RC API-freeze pass over the web surface (rides the matching `@dom-expressions/runtime` pass):
  - **`@solidjs/web/server-functions/rich-args`** ships. `enableRichArguments()` installs the codec's write half (~5 KB gz) as the client transport's `serializeArgs`, replacing the plain-JSON default that throws a directed message on Dates, Maps, Sets, typed arrays, and cycles. Importing the entry is the opt-in at the module-graph level — the serializer ships only when the app asks for it — and it externalizes against the shared `server-functions/client` instance, so the config write lands where the compiled reference proxies read.
  - **`renderToStringAsync` is gone** (server entry and browser mock). It was `renderToStream().then()` in a trench coat; `renderToStream` is now a real `PromiseLike<string>`, so `await renderToStream(code, options)` is the replacement — same options, resolves to the fully settled HTML.
  - **Server-function error sanitization keys on the build variant, not `NODE_ENV`.** The server-functions server entry now builds twice: the copy behind the `development` export condition (what Vite dev resolves) keeps full error fidelity, and every default resolution — production bundles, plain node, deep imports with no bundler signal — gets the sanitizing copy, failing safe. `markSafeError`/`isSafeError`/`SAFE_ERROR` export from the core entry next to the response helpers for intentional client-facing errors.
  - **`@solidjs/web/serialization` is marked integration-facing** — exempt from the 2.0 stability guarantee, per-export — and is now the single home of `createJSONDataTable` (the `/frames` duplicate re-export is removed).
  - **Every `/frames` export carries `@experimental` JSDoc** plus a banner per entry file, matching the changeset-level experimental framing.
  - **The browser mock matches the runtime signatures** (`onHead`, resolver-form `manifest`, `ssrClassName`/`ssrStyleProperty`/`ssrGroup`, `createRequestEvent`'s generic, `createSSRResponse` over `RequestEvent`), with a type-level test so drift can't recur, and compiler-output-only exports and wire plumbing are marked `@internal`.

- 687a993: Re-export the HTTP response-head lifecycle and middleware composition from the runtime (lands with the next `@dom-expressions/runtime` bump): `createRequestEvent` builds the canonical stub-backed request event; `createSSRResponse` derives the outgoing `Response` from a render result — committing the stub at shell flush, turning a pre-flush `Location` into a real redirect (`getExpectedRedirectStatus`), and appending a nonce-aware script fallback for post-flush redirects; `composeMiddleware` composes web-standard `(request, next) => Response` middleware inside the request scope. `@solidjs/web/server-functions` gains the `wrapInvocation` seam: a per-invocation wrap around server function execution (HTTP dispatch and direct SSR calls) with the invocation identity established. Documented in RFC 10 and RFC 12.
- 202acdd: New rxcore hook `ssrAsyncValue`, the reactive half of the document face's value tier (DR-2 at t=0): wraps an async slot arg in a full async-aware server memo so the inline fill's read throws `NotReadyError` until the value settles, then reads as the settled value — the SSR engine's hole machinery catches and re-pulls, so the covering boundary holds exactly as it does for any pending server read. `serialize: false` keeps the memo out of the hydration payload (the arg already ships once, through the slot record). The frame sink pre-taps async iterables down to a promise of their first yield, so the hook only ever sees thenables.
- d657df1: Fresh server-component mounts now shell-gate: the mount's covering `<Loading>` stays open until the frame's first content applies, instead of resolving over an empty `<dx-frame>` at response-header time (the empty-frame flash — the lifecycle matrix's shell-gate gap). The frame notifies before it syncs slots, so a t=0 fill's pending async read registers while the boundary queue is still open and the fallback holds seamlessly from fetch through settlement. Only call-driven mounts gate (the transport begins the address's stream before the binding resolves); placeholder mounts with no call in flight — the exhausted late-boundary waiter, client-only boots — still render their empty frame immediately, ready for a future call's stream.

  A frame `error` record also releases the gate, which requires the runtime's error-apply notification (on dom-expressions next, unpublished); until the runtime dependency bumps past it, a failed stream holds the fallback.

- 43b5aaf: The `asyncArg` docs model the correct authored form for slots with args: JSX (`<props.status …/>` — the compiler wraps each prop in a getter, deferring reads to the slot border), never a call, which evaluates its args eagerly in the component body — a top-level read, an error in most cases. Argless slots remain plain prop access.
- 1c03436: Update dom-expressions to 0.50.0-next.40 — the published runtime for the freeze-gap public API this branch re-exports. The cookie codec lands as core platform-gap primitives (`serializeCookie`/`parseCookieHeader`, dependency-free percent-encoded round-trip; reads via `parseCookieHeader(event.request.headers.get("cookie"))`, writes via `event.response.headers.append("set-cookie", ...)`), with committed-stub write loudness (a post-commit `event.response` header write throws in dev, reports + no-ops in prod) and the multi-`Set-Cookie` portability guarantee (entry-by-entry `getSetCookie()` + append everywhere headers materialize, so multi-cookie responses survive Node/undici, workerd and Deno identically). The server-function handler's commit seam is public as `commitEventResponse(response, event?)` — the second of a handler's two exits, idempotent at handler edges because an already-committed stub passes the response through untouched. The serializer entry re-exports seroval's plugin-authoring API (`createPlugin`, `OpaqueReference`) from the runtime's own seroval instance so custom codec plugins are version-pinned by construction, and `RequestEvent.locals` is typed by the exported, module-augmentable `RequestEventLocals` interface. Also picks up the frames fixes: slot records wait for their `{$ref}` data args' arrival (async ref values compare by identity, so a re-sent pending ref re-suspends instead of freezing the previous value), rebind resets per-stream root affinity so a byte-identical shell still answers an address switch (#2977's stuck `isPending` re-arm), and the ambient hydration gather treats frame regions as opaque.
- bef6da9: Implement the `waitAsset` rxcore seam for client-side CSS reveal gating (dom-expressions `docs/client-css-reveal-gating.md`). During a transition or boundary reveal, the runtime's `useHead` warms a registered stylesheet as `rel="preload"` at discovery (overlapping the fetch with the data wait) and calls `waitAsset(loadPromise)` from the gating compute; the seam throws `NotReadyError` while the sheet is loading so the transition holds — content and its CSS reveal together, client parity with SSR streaming's `$dfs` gate. Loaded, errored, and cached sheets pass through without a wait. One detached async node per promise (WeakMap-shared across readers), created outside the calling compute so the retry it triggers can't dispose it and so it never consumes a hydration id from the calling owner chain.
- 0813a51: `commitEventResponse(response, event?)` is exported from the server entry (with a loud client-side mock, like the other server-only helpers) — handler-lifecycle plumbing completing the response-head choreography's two exits: page results leave through `createSSRResponse`, any other `Response` (a middleware early return, an API result) leaves through `commitEventResponse`; application middleware never calls it. It runs the same fold the server-function handler's responses take — cookies append entry-by-entry, other stub headers gap-fill (minus the protocol-owned family and body metadata on bodiless responses), status never — then commits the stub. Idempotent at handler edges: an already-committed stub (a page response from `createSSRResponse`) passes through untouched, so handlers apply it unconditionally after their middleware chain unwinds. `event` defaults to the ambient `getRequestEvent()`.
- 0813a51: `event.locals` gets its typing augmentation point: `RequestEvent.locals` is typed by the exported, module-augmentable `RequestEventLocals` interface, replacing Start's ambient `App.RequestEventLocals` namespace (a plain exported interface, no global `App.*`). Augment `@solidjs/web` and the merge flows to `getRequestEvent()!.locals` everywhere the event surfaces — the main entry, `createRequestEvent`, the server-functions event — through one shared interface identity:

  ```ts
  declare module "@solidjs/web" {
    interface RequestEventLocals {
      user: User;
    }
  }
  ```

  The interface keeps the index signature the inline `Record` type had, so un-augmented code stays exactly as permissive as before (`event.locals.whatever = x` keeps typechecking); augmentation adds precision for the keys it names. The trade, matching Start's precedent: unaugmented keys read as `any` rather than erroring.

- 0813a51: `@solidjs/web/serialization` exports `createPlugin` and `OpaqueReference` — seroval's plugin-authoring API, re-exported from the runtime's own seroval instance so custom codec plugins are version-pinned by construction (a plugin built against your own `seroval` dependency edge would not fail the build; it would emit nodes the other end of the wire can't interpret — solid-start #1474). This closes the `@solidjs/start/serialization` gap for the Start retirement: author plugins from this subpath and feed them to the server-function `codec` option on both entries. `SerializerPlugin` is now generic (`SerializerPlugin<Value, Info>`; bare use unchanged), and the authoring surface is fully typed under `moduleResolution: "nodenext"` — the types are hand-declared against the pinned seroval line because seroval's own published d.ts degrade to `any` there. Deliberately excluded from Start's export list: seroval's granular context/`Plugin` type names — `createPlugin`'s generics carry the inference, and `SerializerPlugin` stays the one exported plugin type.
- Updated dependencies [af97611]
- Updated dependencies [dc7b5c2]
- Updated dependencies [b6071ba]
- Updated dependencies [3fd0499]
  - solid-js@2.0.0-beta.32

## 2.0.0-beta.31

### Minor Changes

- bcbe7e5: Server components Stage 2 (identity split): `dynamic` now consumes the transport's binding contract — a resolution branded `{ component, address }` whose component matches the mounted instance's keeps the instance and delivers the new address into a per-site live accessor ("same component, new props"), replacing the mount-stealing handoff protocol. The frames client mounts per-function components bound to per-call addresses (`followBinding` drives `frame.rebind`), document adoption binds the call's address from the hydration records, and the transport install drops the `documentComponent` seam — the document placeholder IS the per-function component. Argument changes at a live site, hover preloads, back-navigation re-materialization, and single-flight saves all flow through the one store-keyed-by-address model.

### Patch Changes

- 977b176: Thread the document wire id down as the adopted frame's claim scope. The identity split binds the frame to the call ADDRESS (function id + args hash), but the document producer stamps `_hk` hydration keys and region fids under the bare wire id — so every adopted claim on an args-bearing call (e.g. a note list keyed by search text) derived a `:hash`-suffixed prefix, missed the registry, and re-rendered fresh clones whose inserts moved the server-rendered `{$frame}` regions into a discarded detached tree: streamed content flashed and went blank. `claimScope` is the runtime's existing seam for exactly this (nested region frames already thread the root's scope down); adoptBoundary now passes the wire id through it.
- 70d0da6: frames: keep an adopted boundary's slot range reactive. The claim scope wrapped insert's accessor, so the binding's first read ran inside `runWithOwner`'s untracked window — reactive only by accident, via the re-read of whatever accessor that first read returned. A `<Loading>` answering a still-pending streamed fragment returns fallback NODES instead, leaving the effect with no dependency at all and the range permanently inert: the boundary's own resume still claimed the swapped-in server markup, so the region looked right, but nothing downstream ever re-rendered it (in the notes example, every navigation out of a late-settling note changed the URL and nothing else). The claim now wraps the insert CALL, so the first evaluation is the render effect's own compute — still under the producer's hydration keys, but tracked.
- edb3e36: Fix hydrated `clientOnly` desyncing DOM bookkeeping for following siblings. The client half's post-settle swap was armed with `onSettled`, which registers a tracked effect — an id-consuming owner the server half (whose only owner is the fallback mirror memo) never mints. Every sibling created after a hydrated `clientOnly` therefore derived its hydration id one slot past the server's, its template claim missed the registry, and `insert` tracked a never-inserted phantom node: the sibling's first post-hydration re-render reconciled against the phantom and inserted the new content beside the orphaned server node instead of replacing it (first surfaced as duplicated nodes after an HMR hot-swap of a component following a `clientOnly`). The swap is now armed through `sharedConfig.onHydrationEnd` — the ownerless "all hydration complete" channel — so `clientOnly` consumes exactly one child id on both sides.
- 38e2e72: Make the document boundary's record drain re-drainable and wire the adopt-time record-race seam (#2968). `adoptBoundary` previously absorbed `_$HY.r` slot/region records exactly once, synchronously at adoption — so a record whose data script ran after adoption was never delivered, and the frames client misclassified the invoked slot as argless content (halting the reactive system on the first props read). The drain now applies each key once but can run again, and the frame receives `recordsPending` (parser still running, or fragments still pending) plus `drainRecords`, letting a recordless occurrence wait one macrotask and classify with the record present.
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
- 70d0da6: frames: keep waiting for a document boundary whose element is still held by a deferred fragment. `_$HY.done` stopped meaning "the page is complete" once post-done swaps became held-until-claimed (#2964) — a boundary rendering in that window mounted a fresh frame, orphaning the markup the replay then delivered, and left the id unclaimed so every later call resolved back to the document placeholder instead of fetching (a server-component region that never updates again). An unresolved `pl-*` placeholder now keeps the answer "not yet"; a reveal that exhausts the page's deferred fragments releases the waiter to mount fresh.
- 3ba6c86: Update dom-expressions to 0.50.0-next.36 (identity split, fragment reveal ledger, identity-first morph grafts, held recordless-occurrence classification) and drop the temporary local runtime link. With the runtime now re-checking a recordless adopted occurrence until records can no longer arrive, the frames integration's `recordsPending` answers the actual question — parser still running (`document.readyState === "loading"`) or fragments still pending — instead of borrowing `boundaryMayArrive()`'s `!_$HY.done` term: holding classification until client hydration completes pushed adopted mounts past the hydrate window, where the claim adopted markup the client's state had already moved past.
- ce60796: Update dom-expressions to 0.50.0-next.37. Serialized server-component references now self-bootstrap the `_$SC` registry — each hydration script's first reference carries it as an idempotent expression — so no integration needs to splice a bootstrap script into `<head>`. The old head-open splice (vite-plugin-solid) put a script ahead of the authored head elements, where the hydration walk claimed it as the first walked child and drifted every positional claim in the head by one (metas claimed as title, title as link), warning in dev and silently drifting in production. The compiler also picks up the directive-DCE fix for type-only import remnants (solid-start #2273): pruning the last value specifier out of a mixed import now removes the whole declaration instead of leaving a bare server-module edge in the client bundle.
- Updated dependencies [a60b288]
- Updated dependencies [40b05e1]
- Updated dependencies [15b512f]
  - solid-js@2.0.0-beta.31

## 2.0.0-beta.30

### Patch Changes

- 8c8b591: Emit early preload hints for `clientOnly` modules. The bundler's module-URL
  pass (the same one that annotates `lazy()`) now also annotates
  `clientOnly(() => import("x"))` calls, and the server half resolves the
  module's client assets through the manifest seam lazy uses, emitting plain
  link hints (`modulepreload` for js, stylesheet links for css) so the browser
  fetch starts on HTML arrival instead of when the client bundle evaluates the
  `clientOnly()` call. Deliberately not filed into the hydration asset map:
  the module is not required for hydration — the fallback is what hydrates —
  so mapping it would make the "preloaded before hydration" contract lie.
  Without an injected module URL (untransformed code) or an asset manifest,
  behavior is unchanged.
- 51f971b: Server-component boundaries that settle after the shell flush now mount (#2964). A boundary waiting on a pending streamed fragment registers as its claimant (`_$HY.fk`), so the fragment swap proceeds — or is held and replayed at registration — even after global hydration completes, instead of being discarded. The frames claim scope now also engages when a slot's server content is a pending fragment placeholder with no hydratable elements (a plain-text `Loading` fallback), so the deferred fragment resumes with hydration rather than falling through to a fresh client mount.
- 9cbdb85: Offer dynamic's previous component to the incoming one so same-function server components hand off the live mount

  When a `dynamic` call site's source resolves to a new server component for the same function under different arguments, the previous value is offered through the `COMPONENT_HANDOFF` contract before the swap: the mounted boundary rebinds to the new call and morphs in place instead of remounting, so client slot state (an expanded sidebar note while typing in search) survives argument changes. Async resolutions transform inside the source promise's own microtask via a transparent thenable — no added resolution hop — and a token guards superseded resolutions from handing off stale content.

- 4533813: Give invoked slot render props live, signal-backed props: the frames binding registers the runtime's `ctx.onUpdate` so a server morph that changes an occurrence's args updates the mounted component's props reactively instead of re-creating it — client state (expansion, focus) follows the entity across morphs and effects over changed args (e.g. a title flash) fire, matching compiled component semantics.
- Hand slot claims over from the enclosing hydration registry. `hydrate()`'s page-wide sweep gathers every `_hk` node including client slot roots inside server component frames, but adoption only ever claims them through its scoped registry — the root registry's copies survived to the end of hydration and every page load warned about "unclaimed" nodes that were claimed and live. The claim scope now removes its keys from the enclosing registry when it takes ownership of a range.
- c3fa949: Update dom-expressions to 0.50.0-next.35. Pulls in: live slot props (args changes rebind the mounted slot instead of re-creating it), call-site handoff for dynamic's live mount when a server component changes arguments, streamed-fragment reveals routed through the runtime reveal policy (`_$HY.f`) so late-arriving fragments are held for their claimant instead of discarded, and the morph fix that restores displaced slot ranges into wholesale-inserted parents (regrown list rows no longer render blank after clearing a search).
- Updated dependencies [51f971b]
- Updated dependencies [40af691]
- Updated dependencies [c3fa949]
  - solid-js@2.0.0-beta.30

## 2.0.0-beta.29

### Patch Changes

- 43039c8: Server-component boundary identity is now the call's intrinsic `(function, arguments)` address — per-args, exactly like the router's query cache, so a cached component always mounts the boundary showing the call it was cached for. Same-args refetches still resolve the identical component and morph in place (no remount through `dynamic`'s equals-gate); a source switching arguments swaps boundaries, re-materialized instantly from the frame host's retained state. This fixes hover preloads for other arguments morphing mounted content, and intermittently blank or stale pages when navigating back and forth between two routes inside the query cache's freshness window.
- 43039c8: The frames client bundle resolves the transport's wire-layer imports (server-function framing, addressing, response headers) to the external `@solidjs/web/server-functions/client` entry instead of bundling private copies — one copy of the framing code in an app, and the transport's flight consumer/codec reads are the shared built instance by construction (the getter-override seam is gone). Shrinks `frames/dist/client.js` by ~2.5 kB minified.
- 43039c8: Wire the frames single-flight protocol through `@solidjs/web/frames`: the server entry re-exports `frameTransformFlightResult` (install as `transformFlightResult` on the server-function handler — a mutation whose invalidated payload includes markup answers with regions + envelope in one frame-stream response), and single-flight delivery on the client reads the shared server-functions client instance by construction, since the frames bundle resolves the transport's wire-layer imports to that external entry.
- 0271a9d: Hoist SolidStart's remaining web-protocol pieces into `@solidjs/web`: `clientOnly`, the response primitives `httpStatus`/`httpHeader`, and the renamed `getServerFunctionInvocation` through the server-functions bridge.
  - **`clientOnly(() => import("./Comp"), { lazy? })`** (named export, both builds) wraps a dynamically imported component so it renders only in the browser: the server renders `props.fallback` and never starts the import, the client shows the fallback until load + mount and then swaps the real component in. Unlike `lazy()`, it avoids Suspense entirely and never server-renders the wrapped component, so it participates in no hydration asset manifest and its code is guaranteed to never run on the server; the mount gate keeps hydration mismatch-free. `{ lazy: true }` defers the import to the component's first render.
  - **`httpStatus(code, text?)` / `httpHeader(name, value, { append? })`** declare response status and headers during SSR for the lifetime of the calling reactive scope, writing to the request event's `response` head (core's `ResponseStub` shape, exposed by the integration via module augmentation — no framework event required). They're scope-tied _declarations_, not mutations — "while this reactive scope is live, the response has this status/header" (Solid reserves `set*` verbs for event-time mutation): call them bare in component/reactive-scope bodies like `createSignal`/`onCleanup`, including behind an `if`, and they un-declare on scope disposal. Retraction semantics fix two SolidStart reference bugs: writes snapshot the prior value at write time and restore it on disposal — a 404 page whose inner boundary recovers stays a 404 instead of being stomped back to 200, and header retraction is an exact revert instead of the reference's broken comma-splitting (split `", "`, join `","`). Both writes and retractions are no-ops once the integration marks the response head `committed` (head derived/sent — `response.committed`, not a flag on the event). On the client the primitives are no-ops. Core ships the functions only — no `<HttpStatusCode>`/`<HttpHeader>` JSX components; Start may provide component wrappers for compatibility, but the primitives are the API.
  - **`getServerFunctionInvocation`** (and its `ServerFunctionInvocation` type) re-export through `@solidjs/web/server-functions`, replacing `getServerFunctionMeta` — the rename resolves the near-collision with `getServerFunctionMetadata(fn)` (static declaration metadata) versus this accessor's info about the call in flight. Clean rename, no back-compat alias.

  Requires the next `@dom-expressions/runtime` release (the `ResponseStub`/`committed` response-head contract and the invocation rename land there).

- 11beaf4: Context barrier at server-component render roots. A server component renders inline in the document at t=0 but standalone on every refetch and mutation region, so an app-context read that resolved a provider at t=0 would silently break on the next response. `runInServerComponentScope` rebuilds the scope owner's context record so both renders agree by construction: user context is severed (default-less `useContext` throws an error explaining the boundary; defaulted contexts read their default), providers rendered inside the server component work normally, and boundary plumbing (`ErrorContext`, `RevealGroupContext`, `NoHydrateContext`) still crosses — Loading/Errored/reveal coordination between server-component content and enclosing boundaries is intentional. Client slot positions are unaffected: they re-enter the zone owner captured outside the barrier, keeping full app context during document SSR.
- 93ea8a1: Update dom-expressions to 0.50.0-next.34. Pulls in: single-flight for frames (`frameTransformFlightResult`, flight codec, per-frame versioning and outcome chunks), per-args boundary identity with host retention so cached server-component calls re-materialize instantly and never collide across argument sets, the server-component context barrier hook, keyed slot ranges relocating correctly across parents during morphs, a frame-client size pass, and the typed `transformFlightResult` seam.
- Updated dependencies [11beaf4]
- Updated dependencies [93ea8a1]
  - solid-js@2.0.0-beta.29

## 2.0.0-beta.28

### Patch Changes

- 8b20c1a: Export a `Slot<P>` type from `@solidjs/web/frames` for typing server-component client positions.

  A server component describes its client positions as props the server renders where client-owned markup belongs. Typing those by hand meant restating the client component's shape and adding `$key` to it, which pushed apps toward wrapper types per component. `Slot<P>` takes the client component's own props and adds the optional `$key`, so the hole is described with the same type that fills it:

  ```ts
  type ToggleSlot = Slot<ComponentProps<typeof Toggle>>;
  ```

  The type is exported from both halves of the subpath — server components are authored in universal code, so it has to resolve under the browser condition too. It is type-only, so nothing crosses into the client bundle.

- Update `@dom-expressions/runtime` to 0.50.0-next.33. The server function handler now pre-digests the single-flight outcome before invoking `collectFlightData` — `targetUrl` (the URL the client will show after the mutation, origin-checked), `revalidateKeys` (the outcome's `X-Revalidate` keys, split), and `foldedHeaders` (request headers with the mutation's `Set-Cookie` effects applied) arrive on the outcome, so integrations only supply the data strategy. Raw body-carrying `Response` values skip collection entirely. Adds `decodeResponsePayload` beside `decodeResponse` for splitting the single-flight envelope on manually opted-in calls.
  - solid-js@2.0.0-beta.28

## 2.0.0-beta.27

### Patch Changes

- 2a38f8a: Adopt @dom-expressions/runtime 0.50.0-next.32, which absorbs the router-agnostic wire protocols from Solid Router. Through the `server-functions` entries this adds: the flash cookie protocol (`FLASH_COOKIE`/`hasFlashCookie`/`clearFlashCookie` on both entries; `encodeFlashCookie`/`decodeFlashCookie` and the `FlashSubmission` shape on the server entry), `foldSetCookies` for replaying a mutation's `Set-Cookie` deltas onto request headers, `REVALIDATE_HEADER` as a named export next to the response helpers that write it, and `createNoJSHandler` — which `handleServerFunctionRequest` now applies to browser form posts by default, so form posts made without the client runtime redirect back with the outcome flashed instead of answering with a serialized payload (configure or disable via `handleNoJS`). Also fixes a thrown bodyless `Response` being nulled before reaching `handleNoJS`, which silently dropped the redirect target.
- 76cb1aa: Fix `dynamic()` and `lazy()` gating the SSR shell flush instead of suspending into their boundary

  Both registered their source promise as a renderer-blocking promise, so the document's first flush waited on it. An enclosing `<Loading>` never rendered its fallback and a slow source stalled the entire document — a 500ms server component pushed the shell from 27ms to 527ms with nothing streamed, and an un-preloaded `lazy()` held the shell for the full module load.

  The pending read now simply suspends, letting the nearest boundary own it and stream the content in behind its placeholder. Where there is no boundary to defer to the read becomes a root hole and the renderer blocks the shell on it as before, so a bare `dynamic()` or `lazy()` still resolves inline. Near-instant sources and preloaded modules continue to inline with no fallback flash.

  For `lazy()` this does not affect asset ordering: `assetsPending` gates the render memo separately, so a fragment still cannot flush before its styles and module map are registered.

  Also adds an internal `serialize: false` option to the server `createMemo`, which keeps a value out of the hydration payload while the subtree still hydrates normally (unlike `NoHydrateContext`, which opts the subtree out entirely and suppresses the id allocation needed for client parity). It carries the contract that the client recomputes the value. This lets the server `dynamic()` drop its hand-rolled promise tracking and mirror the client's two-memo shape, since its resolved value is a component function that must never cross the wire.

- 919a081: Frames: gather hydration-claim registries without descending into nested regions

  `claimRender` built each occurrence's registry with `querySelectorAll("*[_hk]")` over its existing nodes, which descends into nested `<dx-frame>` regions — content that belongs to nested occurrences running their own claims. On a deeply nested adopted tree (an HN comment thread) every level re-collected its entire subtree, making registry gathering O(nodes × depth). The registry is now gathered by a walk that treats region elements as opaque, so the total work across all claims is linear in the tree.

- 137e5ec: Adopt server-component boundaries that arrive after the shell flush. A boundary was looked up in a one-time `[data-fid]` snapshot of `document.body`, and a miss immediately mounted a fresh client frame. That decision is unrecoverable, and it was wrong for every server component whose source settles after the shell flush: the producer emits the resolver script (`$R[n](…, self._$SC.r(id))`) ahead of the markup, so the placeholder mounts while the boundary element is still in flight — on a live feed the shell flushes with a few hundred bytes of body, and the markup follows after `</html>` inside the reveal template. The server's markup then landed owned by nothing, visible but inert, while the stream drove an element outside the page: the boundary never updated again, so every navigation into it fetched correctly and changed nothing, and route changes left the orphan behind, stacking the old route's DOM under the new one.

  A miss while the document is still streaming now means "not yet" rather than "never": the boundary suspends — the enclosing `<Loading>` goes on showing the server's fallback, which is what the page is already displaying — and adopts the element when the reveal delivers it. Reveals are picked up from `_$HY.fe`, which the streaming layer already calls on every swap, wrapped rather than overwritten so other consumers keep working; when the producer passes the revealed fragment's parent, the rescan is scoped to what just arrived. Client-only boots are unchanged (no `_$HY`, or the document is done → mount fresh), and the index now skips nested region ids, which keeps it at a handful of entries instead of one per region.

- Updated dependencies [76cb1aa]
- Updated dependencies [17b0afb]
  - solid-js@2.0.0-beta.27

## 2.0.0-beta.26

### Patch Changes

- 685d597: Bump dom-expressions to 0.50.0-next.30. Picks up the hydration fix for streamed `<Loading>` fallbacks (#2936): a pending boundary's placeholder scaffolding (`<template id="pl-X">` and its `<!--pl-X-->` end comment) is now excluded from hydration claim arrays, so a reactive text hole in the fallback adopts the server-rendered node and updates replace it in place instead of appending debris.
- 144801e: Fix frames types build on fresh installs: map bare `@solidjs/web` in `frames/tsconfig.build.json` paths (alongside the existing server-functions/client mapping). The insert-dedup change imports `insert` from `@solidjs/web`, which fails under NodeNext without the package self-link that only local `link` checkouts have.
- b29ca0a: Adopt the element-based frame seams from `@dom-expressions/runtime`: a server-component boundary is now a client-owned `<dx-frame>` element rather than a branded comment-marker range. `boundaryComponent` uses `createFrameElement` and returns the element (which `insert` places natively in any position, fixing the array/fragment crash class), and `documentBoundary` adopts the SSR'd boundary element via `createFrame(el, { adopt: true })`, located by a single `[data-fid]` attribute query instead of a comment-pair TreeWalk. The occlusion drain, hydration-claim scoping, and stable-component transport policy are unchanged. Requires `@dom-expressions/runtime` with the element seam (`createFrameElement`/`FRAME_ID_ATTR`, `createFrame` adopt option); `createFrameInsertable`/`adoptFrameRange` are gone.
  - solid-js@2.0.0-beta.26

## 2.0.0-beta.25

### Patch Changes

- fc6cbaf: Fix the packaged frames client shipping without its transport half. `frames/dist/client.js` bundled a PRIVATE copy of the server-function client; because the frames entry never calls that copy's readers, rollup concluded the `configureServerFunctionsClient({ responseHandler: ... })` write inside `installServerComponents` was unobservable and tree-shook the entire call out of the artifact — published beta.23/24 could adopt document boundaries but never installed the frame-stream transport (t=0 intercept, refetch morphs, fresh boundaries all dead). The private copy was a correctness hazard even without the shake: its module-scoped config would never be seen by the compiled reference proxies, which call through `@solidjs/web/server-functions`. The frames client now imports `@solidjs/web/server-functions/client` and keeps it external, so the dist configures the same built instance the proxies resolve to, and a build-time assertion (`assertFramesClientTransport` in rollup.config.js) fails the frames build if the transport wiring ever drops out of the emitted chunk again.
- e654a59: Fix the frames types build: `types:copy-frames` expected compiled declarations at `frames/types/` that no step ever generated, breaking `pnpm types` (and CI builds). Frames declarations now compile via a dedicated `frames/tsconfig.build.json` (mirroring the storage submodule), and the published `types/frames` facades get their bundled `@dom-expressions/runtime` specifiers rewritten to relative paths so they resolve against the runtime d.ts files shipped alongside them.
  - solid-js@2.0.0-beta.25

## 2.0.0-beta.24

### Patch Changes

- f9a1e63: Frames: hydration claims are now gated to the adoption attach
  (`ctx.adopted`) — a stream-driven re-call of an adopted occurrence renders
  for real instead of claiming, so content the re-call displaces (moved-out
  `{$frame}` region ranges) is re-placed rather than silently dropped
  (dom-expressions#547).
  - solid-js@2.0.0-beta.24

## 2.0.0-beta.23

### Patch Changes

- 6c95f60: **Experimental — `@solidjs/web/frames`: server components.** Shipping as
  an experimental preview alongside Solid 2.0: the subpath, its API, and the
  underlying wire format are NOT covered by 2.0's stability guarantees and
  may change between prereleases. Expect a separate stabilization
  announcement.

  There is deliberately no new component API. A server component is a
  function returned from a server function, and `dynamic` is how you use it:

  ```tsx
  const getStory = /* "use server" fn returning (props) => JSX */;

  function StoryPage(props) {
    const Story = dynamic(() => getStory(props.storyId));
    return (
      <Story comment={(p) => <CollapsibleComment cid={p.cid}>{p.children}</CollapsibleComment>}>
        <ShareBar />
      </Story>
    );
  }
  ```

  Server content streams as HTML and morphs in place across refetches —
  client components inside it (and their state: focus, inputs, toggles)
  survive navigation. Nothing ships twice: no serialized component trees, no
  hydration data for server content, and at t = 0 the server-rendered
  document is adopted (zero requests at boot; wrappers claim their
  server-rendered DOM by hydration key). Content the client didn't render at
  SSR (e.g. collapsed threads) ships once as data and mounts later with zero
  network.

  Surface:
  - client: `installServerComponents()` (call once in the client entry),
    `getFrameHost`, and the frame/transport primitives routers build on
    (`applyFrameResponse`, `FRAME_APPLIED_EVENT`, `adoptFrameRange`,
    `createServerComponentHandler`). Server-component anchors/forms
    participate in the element-claim contract, so router link state works on
    server content unchanged.
  - server (`@solidjs/web/frames/server`): `frameTransformResult` /
    `frameTransformDirectResult` — install on the server-function handler
    and document SSR respectively — plus `renderServerComponent`,
    `renderToFrameStream`, `serverComponentResponse`, `createFrameSink`, and
    the document-shell pieces (`ServerComponentPlugin`,
    `SERVER_COMPONENT_BOOTSTRAP`).

  See `examples/hackernews` (and its SSR-SPA twin, the measured comparison)
  and dom-expressions' `docs/server-components.md`.

- Updated dependencies [6c95f60]
  - solid-js@2.0.0-beta.23

## 2.0.0-beta.22

### Patch Changes

- solid-js@2.0.0-beta.22

## 2.0.0-beta.21

### Patch Changes

- e88e2de: Bridge the settled server-function extension surface through `@solidjs/web/server-functions`: `GET(fn)`, the declaration-metadata channel (`withMeta`, `getServerFunctionMetadata`, `isServerFunction`), and the `prepareRequest` client hook — and drop the legacy per-reference `.GET`/`.withOptions` escape hatches (beta, no compatibility shims).
  - **`GET(fn)`** declares a server function callable over HTTP GET (arguments codec-encoded in the query string, cacheable URLs). Both environment halves export it: the browser build's returns the GET-transport callable, the server build's is identity-flavored (SSR stays in-process) and records the declaration so the handler answers 405 when the request method contradicts it. Function-level `"use server"` directives round-trip the wrapper call, so `export const getUser = GET(async (id) => { "use server"; ... })` needs no compiler support.
  - **`withMeta(fn, meta)`** attaches arbitrary user-declared transport metadata to a reference through the same channel and returns it, shallow-merging later writes; it composes with `GET` in either order. `getServerFunctionMetadata(fn)` reads the merged bag and `isServerFunction(fn)` is the structural guard — both detect by a registered-symbol brand, so they work across the separately bundled client/server entries; routers use them instead of property sniffing.
  - **`prepareRequest(init, { id, meta })`** on `configureServerFunctionsClient` (with the exported `PrepareRequestHook` type) runs before every outgoing server-function fetch — session-dynamic transport policy like OAuth bearer tokens, keyed per-function through `withMeta` declarations rather than id comparisons.
  - References keep the callable, `url`, and now expose `id` on both sides; `.GET` and `.withOptions` are gone — session-dynamic uses go through `prepareRequest`, and single-flight opt-in is already automatic via `subscribeFlightData`.

- 51de4f3: Bridge the single-flight mutation protocol through `@solidjs/web/server-functions`.

  Pulls in dom-expressions' generic single-flight protocol: on the server, `configureServerFunctionsServer({ collectFlightData })` (or the per-handler `collectFlightData` option on `handleServerFunctionRequest`) registers the hook that produces a data payload from a call's outcome — the handler folds it into the response as the standardized `{ value, data }` payload under the `X-Single-Flight` header. On the client, `subscribeFlightData(consumer)` registers the consumer the fetch transport delivers `data` to (with the response as envelope context — redirect location, revalidation keys) before returning `value` to the caller; the registration is universal, exported from both halves of the subpath, since routers are universal code. The flight-data types (`SingleFlightPayload`, `FlightDataConsumer`, `FlightDataContext`, `CollectFlightDataHook`, `ServerFunctionOutcome`) and `SINGLE_FLIGHT_HEADER` ride the copied type surface. Without a hook or consumer, behavior is byte-identical to before.

- Updated dependencies [b1b2f82]
- Updated dependencies [a79f974]
- Updated dependencies [e3d5fed]
- Updated dependencies [c4fad7a]
  - solid-js@2.0.0-beta.21

## 2.0.0-beta.20

### Patch Changes

- Updated dependencies [729a5e1]
- Updated dependencies [ff5c321]
- Updated dependencies [bbc5ac8]
- Updated dependencies [a24a4de]
- Updated dependencies [c7bb2c8]
- Updated dependencies [9f27cdf]
  - solid-js@2.0.0-beta.20

## 2.0.0-beta.19

### Patch Changes

- 32996e8: Add the server function runtime ABI as `@solidjs/web/server-functions` and the response helpers on the core entry.

  The `server-functions` subpath resolves per environment like the main entry: the browser condition gets the fetch transport (`createServerReference(id)` producing the client callable with the `url`/`GET`/`withOptions` surface, `configureServerFunctionsClient` for the endpoint and codec), while node/worker/deno get registration (`registerServerReference`, `registerServerFunction`, `getServerFunction`), the SSR in-process callable (`createServerReference(reference)`), and the web-standard `handleServerFunctionRequest(request, options) => Response` handler with `createEvent`/`provideEvent`/`transformResult`/`handleNoJS` hooks for integrations. Compiled `"use server"` output (vite-plugin-solid) targets this module as its runtime. Event scoping defaults to the AsyncLocalStorage that `@solidjs/web/storage`'s `provideRequestEvent` parks on `globalThis[RequestContext]` — now a registered symbol so the separately bundled entries agree.

  The response helpers (`redirect`, `reload`, `respond`, plus `ResponseEnvelope`/`isResponseEnvelope`) export from the core `@solidjs/web` entry — both client and server builds, one import site regardless of usage. They construct plain `Response` objects carrying the protocol signals (`Location`, `X-Revalidate`, statuses); client-only actions return them and the integration interprets the Response in memory, while server functions return (or throw) the same objects and the HTTP handler forwards their metadata. `respond(value, init)` — `json()` from SolidStart/Solid Router, renamed for what it actually does: pair a value with the response metadata a naked return can't express. Progressive enhancement stays invisible: the carried response holds a plain JSON body so consumers without the client runtime (no-JS form posts, direct HTTP) get real JSON, while integrations read `value` with no reparse. Envelope detection uses a registered-symbol brand so identity survives the separately bundled entries.

- cded919: Bump dom-expressions to next.22. Beyond the server-functions runtime, the bundles pick up a deduplicated `DOMElements` set (~1 KB minified for consumers that retain it) and hydration-time insert/event behaviors moved behind a runtime slot installed by `hydrate()`, so client-only bundles tree-shake them.
- Updated dependencies [d94d5c3]
- Updated dependencies [d0b9c91]
  - solid-js@2.0.0-beta.19

## 2.0.0-beta.18

### Minor Changes

- 9b4dd76: Add the `@solidjs/web/serialization` subpath exposing the runtime's Seroval serialization primitives: `createSerializer`, `DEFAULT_WEB_PLUGINS`, and `resolveSerializerPlugins` for the shared web plugin configuration, plus the isomorphic JSON codec (`serializeJSON` / `createJSONDeserializer`) for RPC-style transports such as server functions. The entry is opt-in — browser bundles only include it when imported, like `@solidjs/web/storage`. The seroval dependency floor moves to `~1.5.4` (1.5.3 and earlier carry a security issue; the codec also relies on `depthLimit` support).

### Patch Changes

- 9b4dd76: Bump dom-expressions to next.21 with the streamed fragment comment-scan fix and the reusable serializer/JSON-codec module backing the new `serialization` entry
- 43c537a: Emit `@solidjs/web/storage` types at the advertised path (#2873)

  The storage tsbuild used `rootDir: ".."`, so declarations landed at
  `storage/types/storage/src/index.d.ts` while package.json advertised
  `storage/types/index.d.ts`, breaking consumers of `@solidjs/web/storage`
  (e.g. solid-start). The build now resolves `@solidjs/web` against the built
  declarations and emits directly to `storage/types/index.d.ts`.

- 4a1d997: Portal no longer crashes SSR — portals are client-only islands (#2876)

  The server renders nothing for a `<Portal>`: children are never evaluated, no
  async starts, and nothing is serialized. Throwing (as earlier betas did) was
  caught by ancestor `Errored` boundaries and baked the error fallback into the
  streamed HTML for trees that render fine client-side.

  Both sides advance the parent's child-id counter by exactly one slot — the
  client scopes the portal's internals under a dedicated owner and the server
  consumes the matching id — so hydration ids for siblings after a portal stay
  aligned.

  On the client, the portal's content memo and effects are gated with
  `ssrSource: "client"`, so under hydration the children render fresh in the
  settle flush — no evaluation during the hydration walk, no effect-type
  switching (the 1.x timing hack). Async discovered inside a portal after
  settle forwards through already-initialized ancestor boundaries as ordinary
  pending status, so nothing regresses to a fallback; the portal simply attaches
  when its content is ready.

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
- Updated dependencies [7d21226]
- Updated dependencies [1b94264]
- Updated dependencies [9b4dd76]
- Updated dependencies [1561c7e]
- Updated dependencies [4e67d45]
- Updated dependencies [8ca127d]
  - solid-js@2.0.0-beta.18

## 2.0.0-beta.17

### Patch Changes

- Updated dependencies [928ba28]
- Updated dependencies [25a5685]
- Updated dependencies [fe9ed90]
- Updated dependencies [4cc6113]
- Updated dependencies [9b883e0]
  - solid-js@2.0.0-beta.17

## 2.0.0-beta.16

### Patch Changes

- 5dd2949: Update dom-expressions to 0.50.0-next.15 under the new `@dom-expressions` npm scope (`@dom-expressions/runtime`, `@dom-expressions/babel-plugin-jsx`, `@dom-expressions/hyperscript`, `@dom-expressions/tagged-jsx`). Includes the upstream fix where awaited `renderToStream` now waits out blocked root holes (#2779) and the server `mergeProps` sourcing fix (#2815). `@solidjs/html`'s runtime shim follows the upstream SLD → Tagged JSX rename (`createTaggedJSXRuntime` / `TaggedJSXInstance`).
- be9a07a: Server `dynamic()` now supports Promise sources (#2779). A Promise component/tag source previously fell through the sync function/string checks and rendered nothing. It now follows `lazy()`'s SSR contract: block async renderers and throw `NotReadyError` from a sync memo until the promise lands, so the streaming engine captures the position as a retry hole. Requires `@dom-expressions/runtime` 0.50.0-next.15, where awaited `renderToStream` waits out blocked root holes.
- 06e45e8: Fix `Portal` stranding one empty text node in its mount target per unmount: the cleanup removed the nodes in `[startMarker, endMarker)` but never `endMarker` itself, which the same effect run had appended. Toggling a Portal (the modal open/close pattern) accumulated one node per cycle, unbounded — invisible to `innerHTML` checks but breaking `:empty` selectors and `childNodes` counts on the mount target. The removal range is now inclusive of `endMarker`.
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
- Updated dependencies [f8f992d]
- Updated dependencies [f658824]
- Updated dependencies [088f97e]
- Updated dependencies [4608539]
- Updated dependencies [f14e3e3]
- Updated dependencies [8b6c298]
- Updated dependencies [5bc9080]
- Updated dependencies [0e8672a]
- Updated dependencies [1458907]
- Updated dependencies [098876d]
- Updated dependencies [f6a3540]
  - solid-js@2.0.0-beta.16

## 2.0.0-beta.15

### Patch Changes

- a5d15f6: Fix Portal mount timing so earlier sibling refs can be used as Portal targets.
- 2c0a336: Rewrite `Portal` mounting: pass the real mount element to `insert` with the new `host` option instead of a `Proxy` wrapper, and run the insert in an owner-parented root that is disposed on mount change or Portal disposal. Fixes portal content accumulating on keyed swaps (#2757), `NO_OWNER_EFFECT` leaks from scheduled portal effects (#2758), and event retargeting for nodes inserted through replace paths.
- Updated dependencies [8402421]
- Updated dependencies [f083220]
- Updated dependencies [98a7385]
- Updated dependencies [c943c5c]
- Updated dependencies [4f14a34]
- Updated dependencies [bff4c21]
- Updated dependencies [52255dc]
  - solid-js@2.0.0-beta.15

## 2.0.0-beta.14

### Patch Changes

- adbdab3: Bump dom-expressions and babel-plugin-jsx-dom-expressions to 0.50.0-next.12.

  This picks up root-owned delegated event targeting: `render()` and `hydrate()` own delegated listeners for their root containers while compiler-emitted `delegateEvents([...])` declares only the delegated event names needed by compiled JSX.

- 153e80f: Bump dom-expressions and babel-plugin-jsx-dom-expressions to 0.50.0-next.13.

  This picks up the following runtime/compiler updates:
  - **Slot-owned node tagging** (resolves solidjs/solid#2030, solidjs/solid#2357): a single DOM node referenced from multiple JSX slots, or wrapped into a new slot's value between renders, no longer crashes `replaceChild` with "new child contains the parent" or vanishes during sibling-slot cleanup. Each runtime insertion now tags the inserted node with a per-slot symbol; destructive operations are gated on parent-and-tag ownership so foreign refs and migrated nodes are left alone. DOM renderer only.
  - **Init-throw scope cleanup**: when a user's render function (or anything inside `render()` / `hydrate()` init) throws, the partial render scope is now disposed instead of being orphaned, preventing leaked effects and stale subscriptions after a failed mount.
  - **Event-listener helper rename**: the compiler-emitted runtime helper that was previously `addEventListener` is now `addEvent`, avoiding the name collision with the native `EventTarget.addEventListener`. Compiler output reflects the new name automatically; runtime/userland code that imported `addEventListener` from `@solidjs/web` should switch to `addEvent`.
  - **JSX namespace cleanup**: previously tolerated `class:foo` and `style:foo` namespace syntax no longer gets special handling — both fall through to literal HTML attributes. Use `class={{ ... }}` for class toggles and `style={{ ... }}` for style properties.
  - **Static JSX marker**: the `/*@once*/` marker is removed from Solid's public JSX model. The compiler still recognizes a renamed `/*@static*/` marker for low-level cases (e.g. compiler internals), but Solid 2.0 guidance is to use normal reactive JSX, `defaultValue` / `defaultChecked` for DOM initial state, and `untrack` for intentional one-time JavaScript reads — not a marker-based replacement.

- adbdab3: Portal now participates in root-owned delegated events by registering outside-root mount points as listener containers for the owning render root.
- Updated dependencies
  - solid-js@2.0.0-beta.14

## 2.0.0-beta.13

### Patch Changes

- 4404f9f: Add an opt-in `isPending(fn, true)` render guard mode that lets pending reads follow the Loading path.
- 6fec663: Remove `on:` namespace event typings and document ref callbacks for native listener options.
- Updated dependencies [157dfe2]
- Updated dependencies [4404f9f]
- Updated dependencies [6fec663]
  - solid-js@2.0.0-beta.13

## 2.0.0-beta.12

### Patch Changes

- Updated dependencies [b964dc7]
- Updated dependencies [0a7c278]
- Updated dependencies [1c5cc7c]
- Updated dependencies [1833f14]
- Updated dependencies [12f15a2]
  - solid-js@2.0.0-beta.12

## 2.0.0-beta.11

### Patch Changes

- e16371f: Performance: add `CONFIG_SYNC` opt-in for sync-only computeds/effects. New `sync?: boolean` option on `MemoOptions`/`EffectOptions` skips the async-shape probe in `recompute` for nodes that provably never return Promise/AsyncIterable. Compiler-emitted `_$effect` and `_$memo` (via `@solidjs/web`'s `effect`/`memo` wrappers) opt in by default — `01_run1k` mean −0.62 ms and `08_create1k-after1k_x2` mean −0.80 ms in `js-framework-benchmark`. User-authored `createMemo`/`createEffect`/`createRenderEffect` keep full async-aware behavior unless they explicitly pass `sync: true`. Returning a Promise from a `sync: true` node throws `SYNC_NODE_RECEIVED_ASYNC` in dev (production silently stores the unawaited value, by contract).

  Correctness: `flush(fn)` now drains at every nesting level instead of only the outermost. Nested `flush(fn)` calls each honor their own contract — writes inside an inner `flush(fn)` propagate before it returns, rather than being held until the outer `flush(fn)` exits. Microtask scheduling and arg-less `flush()` are unchanged. Code that depended on the old hold-until-outermost behavior should switch to a harness-layer depth counter (see `js-reactivity-benchmark`'s `r3` / `r3-solid-target` adapters for the pattern).

- Updated dependencies [95ca987]
- Updated dependencies [cb04b8e]
- Updated dependencies [b0db6c9]
- Updated dependencies [47c0e6f]
- Updated dependencies [263be3f]
- Updated dependencies [59d84ba]
- Updated dependencies [80b4e8d]
- Updated dependencies [d2529e3]
- Updated dependencies [80b4e8d]
- Updated dependencies [80b4e8d]
  - solid-js@2.0.0-beta.11

## 2.0.0-beta.10

### Patch Changes

- 59dd11f: Docs prep for the 2.0 reference auto-generation pass: backfill JSDoc examples on previously-undocumented public APIs (`getObserver`, `isDisposed`, `createRenderEffect`, `onCleanup`, `createErrorBoundary`, `createLoadingBoundary`, `createRevealOrder`, `flatten`, `enableExternalSource`, `NotReadyError`, `NoHydration`, `Hydration`, `isServer`, `isDev`); normalize inline JSDoc code fences to `@example` tags on the JSX components (`<For>`, `<Repeat>`, `<Switch>`, `<Errored>`, `<Reveal>`, `dynamic`, `<Dynamic>`); and tag cross-package wiring / compiler-emitted exports with `@internal` so the doc generator can hide them from the user-facing surface (`getContext`, `setContext`, `createOwner`, `getNextChildId`, `peekNextChildId`, `enforceLoadingBoundary`, `sharedConfig`, `enableHydration`, `NoHydrateContext`, `$DEVCOMP`, `$PROXY`, `$REFRESH`, `$TRACK`, `$TARGET`, `$DELETED`, `ssr*` helpers, `escape`, `resolveSSRNode`, `mergeProps`, `ssrHandleError`, `ssrRunInScope`). Also extends the `equals` field JSDoc on `SignalOptions` / `MemoOptions` to mention `isEqual` as the default.
- Updated dependencies [59dd11f]
- Updated dependencies [e841f8c]
- Updated dependencies [a93a216]
- Updated dependencies [cf92b55]
- Updated dependencies [2a7c6a5]
  - solid-js@2.0.0-beta.10

## 2.0.0-beta.9

### Patch Changes

- d8d8c95: Reshape `createDynamic` into a `dynamic` factory.

  `createDynamic(source, props): JSX.Element` is replaced by `dynamic(source): Component<P>` — a `lazy`-style factory returning a stable component whose identity is driven by a reactive (and optionally async) source. `source` may return `null | undefined | false` to render nothing, so `() => cond() && Comp` works directly.

  ```tsx
  const Active = dynamic(() => (isEditing() ? Editor : Viewer));
  return <Active value={value()} />;
  ```

  The `<Dynamic component={...}>` JSX wrapper is unchanged at the call site; it now delegates to `dynamic` internally. Direct callers of `createDynamic(source, props)` should use `<Dynamic>` or `createComponent(dynamic(source), props)`.

- d31b3c6: Simplify `render` wrappers and give custom universal renderers deferred top-level mount.

  `@solidjs/web`'s `render()` is now a thin wrapper around `dom-expressions`' `render` — it threads `{ insertOptions: { schedule: true } }` through the new `insertOptions` seam (added in `dom-expressions@0.50.0-next.2`), scopes the `ASYNC_OUTSIDE_LOADING_BOUNDARY` dev window, and tail-flushes the queue. No behavioral change for end users; the local `createRoot` / `flatten` / `insert` plumbing that was inlined in the previous commit has moved back into `dom-expressions`.

  `@solidjs/universal` is no longer a pure re-export of `dom-expressions/src/universal.js`. It wraps `createRenderer` so the returned `render(code, element)` does `createRoot` + `insert(..., { schedule: true })` + tail `flush()`. Every custom universal renderer now inherits the same permissive top-level async semantics as `@solidjs/web`, without having to rewrite its own `render`.

- Updated dependencies [9015b12]
- Updated dependencies [fb2e43b]
- Updated dependencies [845b6bb]
- Updated dependencies [23f7550]
- Updated dependencies [8b9c5bf]
- Updated dependencies [9015b12]
- Updated dependencies [c324d2c]
- Updated dependencies [4620612]
- Updated dependencies [f7d5af6]
- Updated dependencies [c324d2c]
- Updated dependencies [c324d2c]
- Updated dependencies [3ee92f3]
- Updated dependencies [0ef177e]
- Updated dependencies [9015b12]
  - solid-js@2.0.0-beta.9

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

- Updated dependencies [34c65b8]
- Updated dependencies [ed2079f]
- Updated dependencies [2597a4a]
- Updated dependencies [00c3f78]
- Updated dependencies [d46928f]
- Updated dependencies [000da61]
- Updated dependencies [2e4a924]
- Updated dependencies [ac0067a]
- Updated dependencies [ac0067a]
  - solid-js@2.0.0-beta.8
  - @solidjs/signals@2.0.0-beta.8

## 2.0.0-beta.7

### Patch Changes

- Updated dependencies [76b11b2]
- Updated dependencies [5869c94]
- Updated dependencies [3242e50]
- Updated dependencies [f18780e]
- Updated dependencies [ea7f892]
- Updated dependencies [5acf0ee]
- Updated dependencies [beb419e]
- Updated dependencies [bd563d0]
- Updated dependencies [e855fcb]
- Updated dependencies [5086c21]
- Updated dependencies [8511fc1]
  - solid-js@2.0.0-beta.7
  - @solidjs/signals@2.0.0-beta.7

## 2.0.0-beta.6

### Patch Changes

- Updated dependencies [df3f514]
- Updated dependencies [74ea248]
- Updated dependencies [4a954e7]
- Updated dependencies [159d204]
- Updated dependencies [6a87fb2]
  - solid-js@2.0.0-beta.6

## 2.0.0-beta.5

### Patch Changes

- Updated dependencies [03e2cca]
- Updated dependencies [8ef7ece]
- Updated dependencies [8db4de8]
- Updated dependencies [e6177b4]
- Updated dependencies [8ef7ece]
- Updated dependencies [009d3de]
- Updated dependencies [3bd00d2]
- Updated dependencies [3eed9c1]
- Updated dependencies [d037842]
- Updated dependencies [6b4af47]
  - solid-js@2.0.0-beta.5

## 2.0.0-beta.4

### Patch Changes

- 2922dbb: Add regression coverage for SSR Show hydration placement so Show content hydrates before its following sibling once the dom-expressions runtime fix is published.
- 8d3e093: Update the bundled `dom-expressions`, `hyper-dom-expressions`, and `lit-dom-expressions` baseline to pick up the spread children caching fix, and add regression coverage for intrinsic spread children and `Dynamic component="div"` granularity.
- Updated dependencies [681d6a5]
- Updated dependencies [2922dbb]
  - solid-js@2.0.0-beta.4

## 2.0.0-beta.3

### Patch Changes

- Updated dependencies [284738e]
- Updated dependencies [5c961fa]
- Updated dependencies [284738e]
- Updated dependencies [284738e]
- Updated dependencies [26ea296]
  - solid-js@2.0.0-beta.3

## 2.0.0-beta.2

### Patch Changes

- 8187065: Fix unnecessary sibling re-rendering when Show/conditional children update by wrapping insert accessor in a transparent memo, with reactive accessor detection to skip redundant memoization
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
- Updated dependencies [8187065]
  - solid-js@2.0.0-beta.2

## 2.0.0-beta.1

### Patch Changes

- dadeeeb: Add NoHydration/Hydration components, expose moduleUrl on lazy, fix mapArray hydration ID mismatch, update dependencies

  **NoHydration / Hydration components** — Moved from dom-expressions into solid-js using the owner-tree context API. `NoHydration` suppresses hydration keys and signal serialization for its children. `Hydration` re-enables hydration within a `NoHydration` zone with an `id` prop matching the client's `hydrate({ renderId })`. On the client, `NoHydration` skips rendering during hydration; `Hydration` is a passthrough. Lazy components inside `NoHydration` register CSS but not JS modules, enabling code-split islands without a compiler.

  **lazy().moduleUrl** — Exposed `moduleUrl` as a read-only property on lazy component wrappers (both client and server) to support Islands architectures and advanced asset discovery.

  **mapArray hydration ID fix** — Server-side `mapArray` was constructing owner IDs by decimal string concatenation (`"prefix" + 10 = "prefix10"`), while the client uses base-36 encoding (`"prefixa"`). Refactored to use parent/child `createOwner()` pattern matching the client, ensuring ID parity for lists with 10+ items.

  **Dependency updates** — `@solidjs/signals` ^0.11.3 (fixes strictRead in computations), `dom-expressions` 0.41.0-next.11 (resolveAssets base path prefixing, removed NoHydration/Hydration stubs), `babel-plugin-jsx-dom-expressions` 0.41.0-next.11 (SSR conditional memo alignment).

  **Test fixes** — Updated strict read warning message assertion, fixed SSR streaming test manifests to use relative paths (matching real Vite output), removed stale TODO, added comprehensive test suites for NoHydration/Hydration, mapArray base-36 IDs, ternary conditional ID parity, and Show fallback hydration toggling.

- Updated dependencies [dadeeeb]
  - solid-js@2.0.0-beta.1

## 2.0.0-beta.0

### Major Changes

- 2645436: Update to R3 based signals
- a4c833d: Update to new package layout, signals implementation, compiler

### Patch Changes

- b1646a5: update signals
- c74106f: fix multi insert/removal, ssr wip, async signal render
- 433eae5: Add `runWithOwner` to rxcore shim to support callback refs from updated dom-expressions runtime
- Updated dependencies [512fd5e]
- Updated dependencies [dea16f3]
- Updated dependencies [15dc3c6]
- Updated dependencies [c3e5e78]
- Updated dependencies [874c256]
- Updated dependencies [4cab248]
- Updated dependencies [1122d74]
- Updated dependencies [c78ec9f]
- Updated dependencies [9788bad]
- Updated dependencies [21fff6f]
- Updated dependencies [2645436]
- Updated dependencies [60f2922]
- Updated dependencies [433eae5]
- Updated dependencies [b1646a5]
- Updated dependencies [e8d8403]
- Updated dependencies
- Updated dependencies [1a1a5d4]
- Updated dependencies [5f29f14]
- Updated dependencies [85aa54f]
- Updated dependencies [433eae5]
- Updated dependencies [c74106f]
- Updated dependencies [f4b0956]
- Updated dependencies [3e3c875]
- Updated dependencies [75eebc2]
- Updated dependencies [568ed6f]
- Updated dependencies [75eebc2]
- Updated dependencies [d1e6e29]
- Updated dependencies [a4c833d]
- Updated dependencies [84c80f9]
- Updated dependencies [381d895]
- Updated dependencies [fbbd7e3]
- Updated dependencies [53dcb14]
- Updated dependencies [dea16f3]
  - solid-js@2.0.0-beta.0
