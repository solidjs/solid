# @solidjs/signals

## 2.0.0-beta.33

### Minor Changes

- 521b73d: Add `loadingValue` (`createMemo` / `createSignal(fn)` / `createOptimistic(fn)`) and `seedLoadingValue` (`createProjection` / `createStore(fn)` / `createOptimisticStore(fn)`): commit #0 for async sources. The node is born committed with the loading value (the projection's seed) and serves it everywhere during the compute's first flight — no NotReadyError propagation, no Loading-boundary suspension, no transition holds (first-flight work is loading-class, like a boundary fallback). The window is verdict-quiet: `isPending` stays false, because commit #0 answers the question by declaration — first-load affordances live in the value channel (null / skeleton provenance the author encodes), and `isPending` remains refetch truth for an answered question, so `data.skeleton || isPending(data)` covers the two disjoint states. The first real answer closes the window permanently: refetches use normal pending semantics. `loadingValue` is typed strictly as `T` (nullable placeholders require a nullable node type) and seeds the compute's first `prev`.

### Patch Changes

- b37d19a: Dev-mode error for untracked async reads after `await` (#2987)

  A `NotReadyError` that rejects an async computation's flight is treated as
  pending and retried through the settle sweep over the source's subscribers —
  which requires the dependency edge a tracked read creates. A source FIRST
  read after an `await` is untracked: no edge exists, the sweep can never find
  the node, and it wedged forever — boundary hung on its fallback, `isPending`
  reading false, no error anywhere.

  Dev builds now detect the unreachable retry at rejection time (the source is
  not among the node's deps, nor carried by any dep's pending chain) and
  convert it to a descriptive error that propagates to `Errored`/logging.
  Post-`await` re-reads of sources tracked before the first `await` keep their
  retry behavior. The check is dev-only — it compiles out of production builds
  entirely (all size gates unchanged), per the convention that authorship
  diagnostics don't cost production bytes.

- ba7560f: Loading-window integrity fixes (#2988, #2989, #2990): seed-window projections run their derive against a detached shadow of the seed so mid-flight draft writes can never tear through commit #0 (each commit point reconciles a detached snapshot; the server freezes the seed before the derive runs to match); a parked retry on an errored loading-value node no longer replaces the settled error with a NotReadyError; and the window now closes when the first answer becomes observable — direct commits close it immediately, transition-held landings keep it open until the hold commits — so no one-frame isPending pulse can leak to live observers at the landing.
- 913913a: Size pass over the loading-window (loadingValue/seedLoadingValue) client code: the unready-source parking sequence dedupes into one shared `parkLoadingWindow` helper (used by recompute's catch and handleAsync's handleError), the repeated `instanceof NotReadyError` tests in recompute's catch hoist into one boolean, and the window-clear writes at landing points become unconditional stores. The hydration entry stops precomputing the window flag per wrapper — options thread through to `readHydratedValue`, which does the check at read time. Behavior unchanged. The signals size gates ratchet for the feature itself (core floor 7.1 -> 7.35 KB, isPending 8.75 -> 9 KB, measured 7.18 / 8.84): the window support rides always-retained memo paths by construction (it's an option, not an import), so its ~110 B brotli cannot tree-shake.
- aa5b96e: Disposal removes computations from the scheduler heaps regardless of their dependency list, so a disposed computation can never be recomputed by a later flush. The child walk in `disposeChildren` only deleted queued children from the heap inside its `if (child._deps)` branch — a dependency-free memo queued by `refresh()` stayed queued, the post-disposal flush recomputed it, and `recompute()` rewriting `_flags` cleared `REACTIVE_DISPOSED`: the node came back to life (user code running after unmount, the accessor readable again, cleanups from the post-disposal run leaked, #2983). The standalone `dispose()` path gains the same heap removal for the node itself, mirroring `unobserved`.
- ab5f83c: Promote the `transparent` option on effects to typed, documented public API. The runtime has always honored it on `createEffect`/`createRenderEffect` — a transparent node is invisible to the hydration id scheme (it inherits its parent's id instead of consuming a child slot) and its compute runs live during hydration instead of adopting the serialized server value — but the flag was absent from the published `EffectOptions` type (typed only on `MemoOptions`) and documented nowhere, forcing integrations to cast on faith (`@solidjs/router` ships `{ transparent: true } as {}` on its client-only link-state and scroll-restoration effects). It exists for client-only reactive nodes created while hydrating, which have no server-rendered counterpart and would otherwise shift every later sibling's hydration id, and it is the supported alternative to branching on hydration state, which freezes whatever the first run decided. SSR ignores the option (server-side nodes always allocate their id slot), so it is documented for nodes the server does not create. Types, JSDoc, and RFC 05 docs only — no runtime change; every size scenario is byte-identical.

## 2.0.0-beta.32

### Patch Changes

- 1313447: Async-iterable reads now tolerate protocol-loose iterators, matching `for await` semantics. Real producers return a bare `IteratorResult` from `next()` as a promise-free fast path when a value is already buffered — seroval's deserialized streams do — and the iterate loop called `.then` on it directly, crashing with `it.next(...).then is not a function` and halting the reactive system. Any seroval-delivered async iterable read through a memo (a server function's streamed return, an async-iterable slot arg) hit this whenever a yield was already buffered at pull time. Bare steps are now assimilated as already-settled.

  Also fixes a latent drop on the same path that predates it: a sync-settled step arriving AFTER an async gap (seroval buffering between pulls, sync-thenable producers mid-stream) was stashed for handleAsync's initial-read consumer — which no longer exists post-gap — so the value never wrote to the node. Post-gap sync settles now write through the async path like their asynchronous twins.

## 2.0.0-beta.31

### Patch Changes

- 0cd35f0: Fix ambient writes going stale for a tick under verdict-companion lanes (#2963). An `isPending()` companion flip puts downstream render effects "under an optimistic lane", where reads of plain nodes serve the committed view; with no transaction to re-deliver, an unrelated same-tick write committed silently and the effect missed it until the next write. Readers whose committed-view read hid a fresh value are now recorded on the batch and replayed at commit — deferring to the transaction's completion when one forms mid-flush, preserving same-tick entanglement holds.

## 2.0.0-beta.30

## 2.0.0-beta.29

## 2.0.0-beta.28

## 2.0.0-beta.27

### Patch Changes

- 82d61b4: Re-adopt the queue batch when an action completes. `done()` restored the
  active transition with a bare `setActiveTransition`, leaving the global
  queue's batch as a detached ambient batch until the scheduled flush. Anything
  registered in that microtask window was stranded with nothing to finalize it:
  a completed action's held writes were silently lost when another action
  resumed in the window (its transition merge never transferred them), a bare
  optimistic write never reverted, and an `affects()` mark could leak — leaving
  `isPending` stuck true. Completing an action now goes through
  `initTransition`, the same batch-adoption path every other
  transition-resumption site already uses.
- 55e2682: An errored derived-store/projection derive now follows async memo rules for every reader. Previously the rejection only reached subscribers that existed at settle time: any later reader — fresh tracked or untracked — silently got node values instead (the seed while uninitialized, last-good data after a failed refetch). Late readers now throw the derive's error, and a genuine tracked re-read on a later cycle retries the derive exactly like an errored async memo (never for untracked reads or `isPending` probes, once per cycle).
- e17a31f: Fix `<For>`/`mapArray`/`repeat` over an async-derived store key rendering nothing after the source first settles (#2944). The store's untracked-read uninitialized guard consulted `STATUS_UNINITIALIZED`, whose clear is deferred to batch commit — so during the settle flush it vetoed the keyed diff's item reads (untracked by design inside the map's internal owner) with a fresh `NotReadyError` that nothing would sweep, wedging the map computed permanently. The guard now also requires the firewall to still be in flight (`STATUS_PENDING`, the live bit that mirrors core `read()`'s verdict) or errored.
- e9e6a78: Bare optimistic store writes made while the store's own refetch is in flight now hold until truth lands and compose across consecutive writes, instead of reverting at plain flush end and clobbering each other (#2951). Net bundle-size reduction: the transition-completion gate this replaces was larger than the hook call.
- b32c105: Fix `createProjection(() => store)` not updating when the source store is mutated (#2941). A projection commit whose derive returns a foreign store now adopts it as the live backing (store-in-store chain) instead of flattening a disconnected raw copy, so the source's updates flow through the projection with no re-derive — restoring the beta.15 semantics without regressing the #2825 self-proxy guards.
- 09d2540: Keep traversing sibling effect queues when a flush disposes queues mid-pass. An effect can dispose an owner, and disposal removes queues from the parent's child list — the running child itself, an earlier sibling, or several at once when one root owns multiple boundaries. The index walk then skipped whatever shifted into the cursor, leaving those effects unexecuted with no later flush scheduled. Each child is now stamped with the current pass before it runs, so the traversal can rescan after a shift and still run every child exactly once; children appended mid-pass still run, as before.
- 0208ff2: Fix `createErrorBoundary`/`Errored` revealing stale content when a failing source recovers by recomputing to a value equal to its last committed one (#2949). Such a recovery fires no value notification, but dependents that re-ran during the error window consumed their dirty flag in an errored run — fresh sibling values were absorbed and nothing committed. `recompute` now mirrors `settlePendingSource`'s blocked re-enqueue on the error dimension: a silent recovery sweeps dependents still holding the propagated error object (one identity down the whole tree) and re-enqueues them, so fresh values commit and flow, and a dependent with another still-broken source simply re-errors.
- e89a479: Let a projection's derive return a different entity than the one it currently holds

  A projection fetching route data (`createProjection(() => fetchUser(params.id), {})`) crashed on the second navigation with "Cannot reconcile states with different identity": the seed has no `id`, so the first commit passed the root identity guard and the next one threw — inside the projection's computed, which stopped all further updates.

  The guard belongs to `reconcile()`, where the caller picked the slot and merging entity X into entity Y's slot is a bug. A projection commit is not a merge: the root proxy is a cell handed out by `createProjection` that can never change reference, so no consumer can hold it as an entity token, and the return form's semantics require the backing data to be swappable. Projection commits now swap instead of throwing. Nothing below the root survives an identity change — every slot is replaced by reference rather than merged into, matching what the keyed diff already does at a nested slot on a key mismatch — and the outgoing raw is dropped from the projection's family map so it can't resurface as the new entity. `reconcile()` itself is unchanged.

  Applies to all three projection commit paths: `createProjection`, the derived `createStore(fn, seed)` form, and the derived `createOptimisticStore(fn, seed)` form.

  Also fixes `key: null` on those same three forms. `ProjectionOptions["key"]` did not admit `null`, and both call sites resolved the default with `options?.key || "id"`, so a `null` meant to select positional merging was silently swallowed into the `"id"` default — the one escape hatch from keyed identity did not reach `reconcile`.

- b19d23a: Stop `reconcile` from merging an array into an object slot (and vice versa) inside arrays

  The object diff has always refused to recurse into a pair whose kinds disagree — `Array.isArray(previous) !== Array.isArray(next)` replaces the slot instead of merging. The array paths reach the same recursion through `keyedMatch` and positional pairing, and neither applied that rule: two keyless wrappables "match" because `keyFn` returns `undefined` for both, regardless of whether they are arrays or objects.

  The result was a slot whose proxy is permanently the wrong kind. `Array.isArray` on a store proxy inspects the proxy's target, which is fixed at wrap time, so after

  ```js
  const [state, setState] = createStore({ list: [{ x: 1 }] });
  setState(reconcile({ list: [[10, 20]] }, "id"));
  ```

  `state.list[0]` reports `Array.isArray === false` and enumerates as `{ "0": 10, "1": 20 }` — spread, `.map`, `<For each>` and `JSON.stringify` all see an object. The reverse direction (array slot receiving an object) is worse: the array-shaped target reads `length` off the incoming object and the store presents an empty array, silently dropping the data.

  Four call sites shared the gap — the keyed prefix loop and the positional loop in both `applyStateFast` and `applyStateSlow`, plus `applyArrayItem` (which covers the keyed diff's trailing and moved slots). They now share a `recursablePair()` helper that folds the existing raw-value (`markRaw`) check together with the container-kind check, so a kind change replaces the slot by reference — exactly what the object diff and `descendInto` already do.

- ef01b13: Platform objects (Map, Set, Date, URL, DOM nodes, and other natives/host objects) are no longer wrapped by stores (#2952). Native code brand-checks internal slots and throws when invoked through a proxy (`store.map.size`, draft `s.map.set(...)` — "called on incompatible receiver"), so they can't honestly be stores. `isWrappable` now excludes them structurally via the tag check (`[object Object]` vs `[object Map]`, ...), giving them the markRaw-children contract automatically: served raw, mutations land on the raw object, and the property holding them still tracks so reassignment notifies. User class instances (which stringify as `[object Object]`) keep wrapping — getters and draft methods stay fully reactive. The hot path is unchanged perf-wise: plain/null-proto objects resolve on one `getPrototypeOf`, and the custom-proto verdict is memoized per prototype.

## 2.0.0-beta.26

### Patch Changes

- 0c206fd: Fix a deadlock where a boundary-caught first load settled back into an incomplete action transaction (#2937). The loading rail is invisible to transactions: an uninitialized async that never registered as a transition reporter now drops its stale transition stamp at settle instead of re-entering the transaction, so the boundary's fallback-to-content reveal (and its onCleanup) flows ambiently. Same-tick writes before an action call — plain or optimistic — still join the transaction; escaped (unboundaried) first loads keep transition scheduling.
- c5cf84f: Fix two autodispose leaks in lazy nodes kept alive by the STATUS_PENDING exemption (#2934, #2935). The exemption keeps a lazy node alive when it loses its last subscriber mid-flight, but only the thenable branch's own settle callbacks ran the matching release. Now every path that clears pending state on a subscriber-less lazy node releases it: `settlePendingSource` (derivatively-pending nodes settling by upstream resolution), the error propagation path (upstream rejection), and the AsyncIterable branch — which also stops pulling values once unobserved, closing the iterator via its cleanup instead of pumping the stream forever.
- 47fbc0d: Fix a projection over an async store wedging its Loading boundary on `undefined` (#2938). The store trap's uninitialized guard (#2897) also ran for observer-present reads, vetoing `read()`'s verdict with the stale UNINITIALIZED flag during the settle flush (the firewall's flag clear is deferred to batch commit) and throwing a fresh NotReadyError for an already-settled source that no sweep would ever release. The guard is now scoped to its documented contract — genuinely untracked fall-throughs — so downstream recomputes read the first values off the pending rail at settle, while untracked reads still throw for the whole uninitialized window (the seed never leaks).
- 6b95ce3: Fix a shallow store leaking writes across a derived chain when it holds another store's proxy (#2932). Shallow ingest sticky-marked the ingested value raw — but the mark is global, so marking a live store proxy made every store serve it verbatim: a downstream deep store captured the upstream proxy instead of wrapping it in its own family, and its writes landed in the upstream store's override layer. Store proxies now pass through the shallow boundary unmarked (slot semantics unchanged: replaced by reference), so each store wraps them in its own family and write isolation matches the non-shallow chain. Also fixes the set-trap ingest mark being inert unless a raw mark already existed somewhere (`rawValuesUsed` was never flipped).

## 2.0.0-beta.25

### Patch Changes

- 82581e4: Per-run effect/write trims on the plain synchronous path, each individually measured: `recompute` skips the `clearStatus` chain on status-free nodes (guaranteed no-op — every branch of its body is gated on one of the guarded fields) and skips `insertSubs` for subscriber-less nodes; the `syncCompanions` hook call in `setSignal`/optimistic writes is gated on companion existence (its entire body is the two companion pokes); and the store `get` trap's fast path reads through `readNodeFast` — `read()`'s plain-signal fast path hoisted over the call, falling back to the full `read()` whenever a global read window (latest/pending-check/transition/lane/snapshot capture) or node layer is active. The last is worth a consistent ~2–3% on store-read-heavy flushes; the gates are neutral-to-positive and remove dead per-run work from every effect.
- 82581e4: New: shallow stores.

  `createStore(value, { shallow: true })` creates a single-layer store: the root's own keys are fully reactive (per-key nodes, membership, `$TRACK`, length) while its values are raw records replaced by reference — no proxies, no tracking, and no deep diffing below the boundary. `reconcile` at a shallow boundary is a positional per-slot reference compare; keyed row identity belongs to the consumer (`<For keyed={r => r.id}>`). Records are replaced, never edited in place: setter reads below the boundary serve the raw (so read-then-replace and `filter`/`pop` idioms work) and in-place mutation is reactively inert by construction — which is what makes optimistic staging sound: replacements stage in the existing override layers and ambient writes auto-revert to the untouched raw base. The option is available on `createProjection`/`createOptimisticStore` via their options.

  Records ingested below a shallow boundary are sticky-marked raw in an internal registry: no store ever wraps them — they present as-is everywhere, tracked by reference at whatever slot holds them, so a record served raw once keeps a single identity in every store (no proxy/raw split-brain). The registry is consulted only on wrap-creation and ingest paths behind a used-at-all gate; reads and shallow-free apps are untouched. (A public `markRaw` for external instances/proxy props is deliberately deferred.)

  Hardened against an adversarial audit: raw-marked values are leaves in every reconcile recursion path (previously a raw pair silently no-op'd instead of replacing the slot — affecting deep stores holding `markRaw` values, setter-write-then-reconcile on shallow stores, and shallow stores nested in deep ones); setter-staged overrides fold into the shallow diff; write-scope reads serve the raw so read-then-replace, `filter`/`pop` removal idioms, and projection derives work; ingesting an already-deep-tracked value into a shallow boundary throws in dev; `deep()` no longer wraps below raw values. Exposed end to end: plain-form `createStore`/`createOptimisticStore` accept options, `ProjectionOptions.shallow` typed.

  Measured on the dbmon-shaped workload (1000 rows × 13 bindings, fresh keyed payload per tick): reconcile 14× faster (3.2 → 0.22ms), full reactive tick 2.4× faster; on the octane dbmon browser harness with all keyed lifecycle gates passing, the store fixture goes from 2.6× to 1.7× octane (1.36× with `textContent` bindings), ahead of React on every op. +1.4KB gzip.

- 82581e4: Structural store/reconcile hot-path pass (dbmon-shaped workload — keyed reconcile of a fresh 7k-object graph driving 13k effect re-reads — runs ~30% faster end to end; every change validated on a signals-only micro-bench):
  - The trap fast path returns node values directly: every node-writing site wraps wrappables before `setSignal`, so re-wrapping on read was redundant (a dev-mode assertion now enforces the invariant; snapshot capture keeps the wrapping path).
  - The global `storeLookup` maps raw values to StoreNode **targets** instead of proxies, and reconcile recurses target-to-target (`applyStateChild`) — no `wrap()`/`$PROXY`/`$TARGET` proxy round-trips per visited child. A lookup miss now means the child was never observed, so the subtree is skipped entirely: the diff is O(observed graph), not O(payload graph). Per-family lookups (projections/optimistic) keep their proxy contract and their wrap-based recursion.
  - Keyed arrays: identity-equal matched slots skip recursion dispatch outright, and a fully-matched equal-length pass (the steady-state polling tick) returns before allocating its staging array/Map or re-syncing membership.
  - `applyDescendants` and `syncArrayNodeMembership` iterate in place instead of allocating key arrays per object per pass.
  - Effect values direct-commit on plain sync flushes instead of taking the `queuePendingNode`/`commitPendingNodes` round-trip that exists to sequence transition reveals.

## 2.0.0-beta.24

### Patch Changes

- a7d42f6: `mapArray` update passes shed their fixed O(n) overhead. Previously every non-empty update staged the matched suffix, copied the whole changed range back at commit, and unconditionally re-sliced `_mappings` (plus the `newItems` copy) — ~4 full-array passes even for a single-row removal. The suffix is now counted rather than staged, and commit lands the retained prefix/suffix plus the diffed window into fresh arrays in one pass each and swaps them in (the swap provides the new array identity downstream change propagation relied on the slice for). Sparse `j in temp` checks became `tempNodes[j] === undefined`. New no-change fast path: when every position matches in place at equal length — the common shape after `reconcile` preserves row identities — the same mapped array is returned, so downstream `<For>` insert effects don't re-run at all. Staged-commit exception safety (#2903) is unchanged: mappers still run before any live state is touched, and an aborted pass disposes only the owners it created.
- 588a572: `NotReadyError` no longer pays V8's eager stack capture in production builds. It is thrown on every read of a pending source — pure control flow, with real cost proportional to stack depth under SSR — so the constructor now zeroes `Error.stackTraceLimit` around `super()` on V8 and restores it after. Dev builds keep full stacks for debuggability; non-V8 engines take the plain path.
- 09e7d64: `reconcile`'s `key` parameter is now optional, defaulting to `"id"`, and accepts `null` to opt into purely positional merging — index N of the new array merges into index N of the old, preserving slot identity with no keyed diff pass. This restores the classic 1.x `{ key: null, merge: true }` pattern (fixed-shape data that churns in place — dashboards, monitors); merge semantics are always on in 2.0. Items missing the key field already fell back to positional matching, so the `"id"` default degrades gracefully for unkeyed data.
- d64d1a0: Republish with fresh build artifacts: the `2.0.0-beta.23` tarball of
  `@solidjs/signals` was packed from a stale local build and is missing the
  `snapshot()` derived-store-view unwrap fix that its own changelog claims.
  No source changes; this release exists so the published artifacts match
  the source at the tag.
- 635182a: Store hot-path trims, measured on high-frequency full-graph updates (dbmon-shaped: reconcile of a fresh 7k-object graph + ~13k effect re-reads per tick, ~9% faster end to end):
  - The proxy `get` trap takes a dedicated fast path for the common shape of an effect re-read — an existing node on a plain target (no firewall, no override layers, no write scope, raw source) — paying one node read and the wrap check instead of the full layered resolution.
  - `StoreNode` targets now pre-initialize every field in one fixed order (`createStoreProxy`), so all targets share a single hidden class and the traps' and reconcile's field loads stay monomorphic; the field `delete`s in optimistic-layer teardown and snapshot clearing became `undefined` assignments to preserve the shape.
  - `applyStateFast`'s object diff iterates plain string-keyed node records with `for...in` instead of allocating a fresh `Object.keys` array per object per pass (tracked and symbol-keyed records keep the array path).

## 2.0.0-beta.23

### Patch Changes

- a5fe9fb: Fix `snapshot()` returning the inner store's live proxy for rows accessed through a derived store view (e.g. `createOptimisticStore(base)` over an existing store). The no-overlay fast path mapped a row to its node's `STORE_VALUE` verbatim, but for store-in-store nodes that value is the inner store's proxy — so per-row snapshots (`snapshot(view[i])`) leaked a live, writable proxy while whole-store snapshots were plain. Chained store proxies now unwrap recursively to the raw backing object.

## 2.0.0-beta.22

### Patch Changes

- c04931b: Two architecture consolidations from the growth audit's Tier-1 spikes, each retiring a mechanism family rather than shrinking one.

  `affects()` marks move off the async status rails onto a dedicated verdict channel. A mark is now only a refcount on the marked node(s); derived coverage is pull-computed at verdict time by a dependency-graph walk, and Loading interaction survives as a boundary-only visual notification. Because marks never touch `_statusFlags`/`_error`/`_pendingSources`/`_asyncReporters`, the five carve-out families that previously un-taught the async rails everything a mark does — value-transparency, transaction-inertness, error-inferiority, settle-release, quiet-reask immunity — are deleted as unrepresentable rather than maintained. The per-read affects collection and per-recompute mark bookkeeping also leave the core read/recompute hot paths. Marks stay invisible to all completion and settlement accounting by construction (a mark can never block or end its own transaction), ambient marks are verdict-only and release at flush end, and mark state serializes only inside a resumable transaction.

  `stashedOptimisticReads` is deleted. It forced a committed-view effect re-run when a transaction backgrounded — masking an active override from stale tracked reads (against A17) and un-rendering co-written optimistic flags mid-window (against the affordance idiom) — while engaging zero times across the whole suite. The queue stash and `_gatedSubs` replay are retained (they cover transaction-held reveal and silent-revert re-ask, which are irreducibly distinct); a spec comment records why they cannot merge.

  Full bundle −775 min / −304 gzip bytes; core floor −388 / −169. All prior tests pass unchanged plus new contract pins: the backgrounded-transaction reveal shape (S3), the interleaved-ambient-flush queue-stash guard (S4, a pre-existing coverage hole), and a deterministic recompute-count isolation guard for the propagation/Sierpinski surgical-update property. No public API change.

- 70e89ba: Fix dev/prod divergence of `isPending()` on uninitialized async sources in component bodies (#2928): the dev component-body safeguard threw a plain Error inside the probe, which `isPending` swallowed, returning `false` where production propagates `NotReadyError`. Probe reads now follow the production path in both builds.
- c3c18d9: Fix memos created inside a `latest()` read window never re-running (#2926): the creation-time eager compute ran with the latest-window flag set, so every source read short-circuited through the companion path before dependency linking, leaving the memo permanently dependency-less. `compute()` now suspends the latest window while a computed's own fn runs.
- 901152f: Fix `resolve()` created inside an `action()` never settling and deadlocking the action (#2930): the promise was delivered from a user effect's apply phase, which an incomplete transition stashes until it settles — but the action yielding that promise is itself what keeps the transition open. `resolve()` now delivers effect applies on a microtask (immune to the transition stash) while computes still run in place under the transaction's view; status/boundary notifications keep their normal queue route.

## 2.0.0-beta.21

### Patch Changes

- 615bb17: Yielding a thenable whose `then` getter or `then()` method throws synchronously no longer leaks the action's iterator in its transaction (#2918). Assimilation failures now match `await` semantics: the error is thrown back into the generator at the yield point (catchable there); if uncaught, the action settles through its normal rejection path, the iterator is removed from the transition, and plain writes made before the yield commit. Previously the exception escaped the Promise executor — the returned promise rejected, but the transition stayed incomplete forever and every write to the affected signals was permanently held.
- 99b2b8e: Document the action naming rationale: actions are the mutation primitive (writes spanning an async gap), navigation is a plain setter call handled by per-node async holding, and framework-level actions (router form actions, server actions) are specializations of this primitive sharing the name deliberately.
- e8fb215: `latest()` on a memo now recomputes after every unflushed write instead of freezing at the first speculative value (#2922). Two staleness holes closed: the heap's mark memo (`_marked`) is only reset by a flush, so a plain write landing between two mid-tick pulls left its subscribers unmarked and every later pull stale; and an untracked `latest()` read has no reading context, so `read()` never performed its mid-tick pull on a still-subscribed shadow. Writes now invalidate the mark memo when an unmarked node enters a marked heap, and the latest() read path pulls its shadow up to date (and surfaces the shadow's held speculative value) before answering.
- 18f0135: An ordinary signal write made in the microtask window between one action's completion and its scheduled flush no longer freezes the signal when another action keeps the shared transaction incomplete (#2916). Action `done()` restores the active transition without adopting the ambient batch, so such writes queue in a detached ambient batch; the incomplete-transition stash then replaced that batch wholesale, stranding the queued pending node — the write never committed and every later write to the same signal stayed held (dev INV-7). The stash now only installs a fresh ambient batch when the current batch is the stashed transition itself, and stays scheduled so a kept batch's pending nodes commit on the next drain.

## 2.0.0-beta.20

### Patch Changes

- aa39752: Three behavior-preserving state consolidations from the architecture audit, each making a past bug class unrepresentable. Pending sources use a single container (the singular-slot/Set dual representation and its promotion invariant — the mechanism behind #2893's first bug — is gone). Ambient work now uses the same batch shape as a transaction, deleting the globalQueue's parallel batch fields and the `initTransition` adoption/aliasing blocks (the alias-drift bug family). Full bundle −523 min / −179 gzip bytes; core floor −440 / −151. All 1,052 tests pass unchanged; every patch was independently re-measured and reviewed hunk-by-hunk for observable-behavior drift before landing.
- a224f2d: Deduplicate the strict-read diagnostics (PENDING_ASYNC_UNTRACKED_READ / STRICT_READ_UNTRACKED) into shared dev helpers used by both core read() and the store proxy traps — the #2897 safeguard parity is now structural (one message source) instead of two hand-kept copies. Dev-only refactor; no behavior change, prod bundles untouched.
- f6dce8a: Document the `action()` transaction contract across `await` (#2913, ruled behaves-as-designed): `yield` is the only transaction-safe suspension point — writes to fresh signals between an internal `await` and the next `yield` escape the transaction. Use `await` for typed results, then a bare `yield` before writing to re-enter the transaction. Calling `flush()` inside an action body is out of contract.
- e156386: Keyed `affects(store, key)` marks now resolve by raw identity like keyless marks, so they are visible through other proxy families sharing the same backing record — e.g. a derived optimistic store whose projection landed the source store's value (#2904)
- 5ab7d17: Stop lane merges from transferring transaction ownership of optimistic overrides (#2912). A shared subscriber (one effect reading values touched by two actions) merges their lanes for effect scheduling — correct — but `resolveTransition` followed the merged lane's transition, so one action's settle could revert another action's live override and same-key follow-up writes entangled with the wrong transaction. Optimistic writes now stamp the owning transaction on the node (`_overrideOwner`, the node-level sibling of #2899's `STORE_OPTIMISTIC_OWNERS`), and `resolveTransition` prefers a live owner stamp over the lane.
- 66a6c13: Make `mapArray` and `repeat` exception-safe under NotReadyError (#2903). A map callback reading a pending async source aborts the pass mid-diff; passes now stage all work (new rows into temp arrays, removals deferred) and commit only after every mapper succeeds, so an aborted pass disposes exactly the owners it created and leaves prior state intact for the post-settle retry. Previously an aborted pass corrupted the internal diff state — duplicated/lost rows, wrong-owner disposals, and leaked partial owners. `repeat` also gains the `_parentComputed` hookup so async reads in its callbacks suspend and retry correctly. Removed rows now dispose at commit (after the pass's new rows are created).
- d57d2c9: Fix first-settling action wiping other in-flight actions' optimistic store overrides (#2899). The optimistic layer is one record per store target, and settle cleared it wholesale — two concurrent actions writing disjoint keys of the same `createOptimisticStore` visibly reverted the still-pending one the moment the other finished. Layer entries are now stamped with their owning transaction and a settling action consumes only its own keys (merge chains resolved, so same-key entanglement still settles jointly). Ambient writes keep clearing at plain flush end, and a derived store's projection landing still consumes the whole layer.
- 8c864ea: Fix optimistic writes of literal `undefined` colliding with the no-override sentinel (#2898). The `_overrideValue` slot doubles as the optimistic-node brand, so storing the raw value erased the node's optimistic identity: the write was invisible to readers, and a follow-up optimistic write was routed off the optimistic path and committed permanently with no rollback at settle. Store deletes, set-to-undefined, and the canonical `filter()` removal shape all funneled into it. Literal `undefined` is now stored as a dedicated `OVERRIDE_UNDEFINED` stand-in (the `NO_SNAPSHOT` pattern) and unwrapped at every site that surfaces the override value — reads, recompute comparisons, `latest()`, verdicts, and store leaf visibility.
- d2f83c0: reconcile() now reaches captured proxies with live subscribers through untracked intermediate levels: node presence bubbles a sticky flag up the wrap chain and the object diff follows it, while never-subscribed branches keep the wholesale identity-swap prune (#2902)
- 2dc2c8f: Restore safeguard parity for derived stores read outside tracking (#2897), matching async memos. The seed of a derived store is a draft for the derive function, never an observable value: until the first resolution (or first async-iterator yield) lands, any outside read, `in` check, or enumeration of the store now throws NotReadyError — in dev strictRead scopes (component bodies) the more descriptive PENDING_ASYNC_UNTRACKED_READ error wins. Self reads from the derive function are exempt (that is what the seed is for), as are reconcile's write-path reads. Previously the store proxy's untracked path skipped node creation — and with it every safeguard — silently returning the seed value.
- d07a9af: Preserve enumerable symbol-keyed properties when snapshotting and deeply
  tracking stores, including array metadata and untouched nested values. Make
  setter drafts writable when the store type is readonly.

## 2.0.0-beta.19

### Patch Changes

- 655b614: Fix the four affects() audit bugs (#2893): the pending-source container no longer corrupts at three overlapping sources (isPending stuck true forever after a keyless store mark over mapArray), mark propagation no longer captures downstream subscribers into the marking action's transaction (plain writes to marked or graph-adjacent unmarked signals froze until the action settled), mark pendingness now survives recomputation transitively past one derivation level (including the recompute the isPending probe itself triggers), and a memo's real error is no longer clobbered by a mark sentinel's NotReadyError.
- 442ad9a: Fix `affects(store)` as an action's first statement never lighting tracked `isPending` probes (#2887). The mark pokes the node's verdict companion while the owner is still lane-less, so the companion's optimistic lane was born parentless and the action's first optimistic write merged it into the async-carrying lane, deferring every tracked reader of the verdict to settle. Owner lane creation now adopts a companion's own unmerged, parentless lane as a child, making the parent-child relation a property of the nodes rather than of write order.
- 1dc0b45: Fix `affects(store)` hiding concurrent optimistic writes from live tracked readers (#2886). A mark's sentinel put derived nodes (like a `mapArray` over the marked store) into `STATUS_PENDING`, and the read path treated that like real in-flight async — suspending the reader — so an optimistic insert under a whole-store mark never rendered for the duration of the action. Mark-only pending is now value-transparent through derivation: reads whose owner's pending sources are all affects sentinels never suspend, so pendingness reaches readers exclusively through `isPending` verdicts while values keep flowing.
- 24bca49: Surface the error that causes `REACTIVITY_HALTED` (#2884). Two fixes: a boundary's foreign-status scrub no longer silently discards an ERROR the queue chain could not deliver to any boundary — the boundary now halts and rethrows exactly like an unhandled effect error (previously an error thrown during initial render under `Loading` + element + `Show` vanished entirely); and `haltReactivity` now logs the causing error alongside the halt message, so the crash cause is visible in the console even when an unwinding layer absorbs the rethrow.
- 71ba988: Fix mergeTransitionState duplicating optimistic nodes: the outgoing transition's \_optimisticNodes are now moved (not copied) into the target, so the adoption pass in initTransition can't re-push the same entries when overlapping actions merge.
- 587cf48: Make `affects()` and `isPending()`/`latest()` pay-for-use (#2883, phase 1). The affects mark engine and sentinel propagation move out of `async.ts`/`scheduler.ts` into the `affects` feature module, and the whole isPending/latest verdict layer (probe, companions, re-ask classification, the `latest()` read path) moves to a new internal `verdict` module; both install nullable `GlobalQueue` hooks on import, so bundles that never import these APIs never ship their machinery. The prod ESM dist is now a per-module tree (`dist/prod/`) instead of one flat file — statement-level tree-shaking can never drop a flat file's top-level hook installs, so the split is what makes the hooks pay off for npm consumers. It is the only output that changes shape: bundlers are its sole consumers and scope-hoist it back into one module, so nobody pays the per-module-boundary call cost at runtime. Dev (`dist/dev.js`) and node CJS (`dist/node.cjs`) stay flat single files — dev bundle size doesn't matter and CJS can't tree-shake, while the flat hot path stays fast for unbundled and test-transformed consumers. `_`-prefixed property mangling runs as a single sequential pass with one shared name cache per prod output, keeping mangled names consistent across module files.

  Measured on a minimal app (render + one signal) bundled from the published dist: 12.7 → 11.4 KB gzip. Core-primitives floor from src: 8.9 → 8.2 KB gzip. Apps importing every feature pay ~0.7 KB min of hook shims. A new `treeshake` test guards the retained-module graph and the floor's byte ceiling so re-coupling fails CI.

  No public API changes: `createStore`'s derived overload intentionally keeps its static projection/reconcile coupling, and promise-returning computeds remain handled by core in every build — the appearance of a promise is the trigger, not an import.

- d94d5c3: Pay-for-use tree-shaking, phase 2 (#2883). The optimistic write engine (override writes, lane routing/suspension, stashed-optimistic reads, transition-completion blockage, optimistic-node resolution) moves out of `core.ts`/`scheduler.ts`/`lanes.ts` into a new internal `optimistic` module behind fourteen nullable `GlobalQueue` hooks, installed by the verdict layer and at first `createOptimistic`/`createOptimisticStore` call. Every core call site is gated on state only the engine can create (an `_overrideValue` slot, a live lane, a non-empty optimistic batch), and the A17 override-is-the-value read path stays inline in core. On the `solid-js` side, `createLoadingBoundary`'s hydration-resume machinery (boundary triggers, resume scheduling, asset-failure reporting, snapshot capture) now installs through the existing `enableHydration()` seam, so client-only apps stop shipping it.

  Measured (esbuild, minify, `_`-prop mangling, gzip -9): core floor 8.2 → 7.7 KB gzip; plain-store subset 13.0 → 12.4 KB; minimal app from published dist 11.5 → 10.9 KB; a CSR app using `<Loading>` drops a further ~0.9 KB gzip; opting into `hydrate()` costs +43 min bytes. Cumulative with phase 1, the minimal-app floor is down ~14% and the signals floor ~13.5% with no behavioral change — differential smoke runs are byte-identical and the full Tier-A suite passes unchanged.

- d0b9c91: Pay-for-use tree-shaking, phase 3 (#2883) — mechanical cleanups selected by cost/benefit audit. Signals: the effect re-enqueue block (four copies) and zombie/dirty queue selection dedupe into shared `enqueueSub`/`queueFor` helpers (hot-path microbenched, no regression); boundary/reveal internal method names are `_`-prefixed so property mangling reaches them; production error strings trim to their diagnostic codes (dev builds keep full sentences); and the prod dist build stops stripping `/*@__PURE__*/` annotations — rollup-plugin-prettier is off the prod tree, terser re-emits annotations, and a new `check-pure` build guard fails the build if they ever vanish again. solid-js client: `sharedConfig.getNextContextId` and `lazy()`'s hydration-module lookup install from `enableHydration()` instead of shipping in every CSR bundle, and MockPromise's class static block (which defeated dead-code elimination in every client bundle) becomes a PURE-annotated factory. CDN `unpkg`/`jsdelivr` fields now point at browser production ESM instead of CommonJS files.

  A last-mile pass closes part of the esbuild-vs-Rollup shaking gap at the source level (Rollup's literal tracking folds never-written state that esbuild retains): the external-source wiring in computed setup and `untrack` moves behind hooks that mirror `enableExternalSource()`'s config liveness, the affects-only `onlyMarkPending` read-path helper moves into the affects module, and the optimistic-store settle loop moves inside its store-side hook. All are Rollup-neutral by measurement.

  Measured: minimal app 10.9 → 10.3 KB gzip under esbuild and **9.8 KB gzip / 9.0 KB brotli under Vite** (Solid's default toolchain — under the 10 KB mark); CSR app with `<Loading>`/`lazy` 13.9 → 12.6 KB; signals floor 7.7 → 7.4 KB; and the full-featured bundle _shrinks_ ~330 gzip bytes, recovering a third of the phase-1/2 hook indirection tax. Cumulative across all three phases the minimal app is down ~19% with all 1,941 tests across the affected packages passing unchanged.

- b923fd7: Tighten the #2893 guards: addPendingSource collapses to a single branch chain off the container invariant, notifyStatus derives its mark check with one optional-chain read, and recompute's pending-commit gate does a single status-mask test so the mark-free hot path pays exactly the pre-#2893 cost. No behavior change.

## 2.0.0-beta.18

### Minor Changes

- 1b94264: Question-scoped pending model and the `affects()` primitive (supersedes the optimistic mask)

  `isPending` is re-derived from one rule: a read is pending iff a value change is in flight for it that has not yet revealed, or it carries a live `affects()` mark.
  - **Same-question re-asks are silent.** `refresh()`, polling, and confirm refetches whose tracked inputs are value-stable no longer read as pending — the fresh value reveals silently.
  - **New questions pend monotonically.** An input value change in flight pends every read under the source until its answer reveals, and nothing can silence it.
  - **Optimistic writes are verdict-inert.** An active override displays without decreeing settlement: it neither reads pending on its own slot (only a differing held correction re-opens the verdict) nor masks anything else. The store-wide optimistic mask (A21) and node mask (A20) are removed.
  - **New `affects(target, key?)` primitive** (re-exported from `solid-js`). Declares that in-flight work will change the targeted data: the named slot (a store record, a specific record key, or a source accessor) reads pending from the declaration until the surrounding transaction settles or reverts. `affects(x); refresh(x)` is the declared-reload idiom.

### Patch Changes

- 500d484: Rebuild `affects()` on the status rails so marks propagate through derivation (#2882). A live mark now pushes `STATUS_PENDING` downstream from the marked node exactly like real in-flight async — memos and effects DERIVED from marked data read pending too, not just direct reads of the marked slot — under a dedicated sentinel pending-source per marked node, so the two channels can't clear each other: a landing on the marked node settles only its own source entry, a quiet `refresh()` re-ask can't silence the declared window (the sentinel is never a re-ask), and a mark never blocks its own transaction's settlement (release happens AT settle). Computeds that recompute mid-window re-acquire the mark through the read path.

  This also fixes keyless marks not covering captured store proxies (`<For>` rows): a keyless declaration walks the marked record's subtree (through write overlays), registers on every live node in it, snapshots the reachable raw identities, and nodes created during the window inherit the mark at birth from that scope. Records added after the declaration are not covered (snapshot-at-declaration semantics).

- 500d484: Narrow `affects()` to a single optional key: `affects(target, key?)`. The variadic form read like a 1.x store path (`affects(state, "user", "name")` suggests `state.user.name` but marked two sibling slots) — mark multiple slots with multiple calls, or target the nested record directly. Passing more than one key now throws in dev.
- 4e67d45: Fix nested `Reveal` readiness across the client and streaming SSR.

  Empty or synchronously resolved composites now count as minimally ready, so an
  enclosing `order="together"` group cannot deadlock. Nested `order="natural"`
  groups also report readiness as soon as one direct child is minimally ready,
  and nested client `order="together"` groups propagate the same direct-slot
  readiness they use for their own release. Readiness and completion on the server
  are held until all synchronous child slots have registered, preventing an early
  child from making a partially constructed group release prematurely.

## 2.0.0-beta.17

### Patch Changes

- ef4d53e: Calling an action synchronously inside an owned scope (component body, computation) is now a dev-mode error (`ACTION_CALLED_IN_OWNED_SCOPE`), matching the existing write guards. Previously the call went through silently — post-await writes run with no ambient owner, so the write guard never fired, and a computation tracking what its action writes would livelock (each write retriggered the compute, firing a fresh invocation whose transition superseded the last; the value never committed). Actions remain callable from event handlers, effect callbacks, tracked effects/`onSettled`, and other imperative scopes.
- bcb0ca6: Reject actions correctly when generators throw falsy values. `done` distinguished resolve from reject by the truthiness of the error argument, so `throw undefined` / `throw 0` / `throw ""` inside an action generator resolved the returned promise instead of rejecting it. An explicit `failed` flag now carries the settle disposition.
- fda28a9: Stricter array index detection for store writes. Any string property on an array (except `length`) was fed through `parseInt` to derive a length extension, so non-index keys like `"01"`, `"1.5"`, or `"1e2"` were treated as index writes and could grow the array's length. Writes now only count as index writes for canonical array indices (`String(Number(p)) === p`, integer, in bounds), matching the ECMAScript definition.
- 286fa3f: Fix async iterator settlement when the iterator completes before yielding or returns a thenable that rejects synchronously. Empty iterators now settle to `undefined`; synchronous iterator rejections reach error boundaries with their original value, including after an asynchronous yield, without producing an unhandled rejection.
- 3e18b8d: Fix structural tracking through store-in-store wrapper views (#2864). A derived store returning another store creates a wrapper proxy whose $TRACK self-node is separate from the wrapped source's, so structural notifications (reconcile, key adds/deletes) never reached consumers subscribed through the wrapper — `<For>`/`mapArray`, `Object.keys`, `snapshot`/`deep`. An optimistic row could therefore survive in a `<For>` after the refreshed data landed. `trackSelf` now chains the wrapper's $TRACK read through to the wrapped source, except while an override layer holds on the view (the overlay owns the shown structure; the reveal notifies the view's own self-node and re-establishes the chain).
- 08b88fb: Fixed an error-routing escape in `Errored > Loading > Errored > content` composition: a sync error thrown by the content was routed past the inner `Errored` to the boundary above the `Loading` — both when the content threw during the same flush the boundaries mounted (e.g. navigating to a route that renders already-errored) and when it threw reactively after a healthy commit. The inner `Errored` consumed the ERROR dimension from the notification mask when it caught, but the `Loading` queue's notify-through remap keyed off the node's raw status flags and resurrected the already-caught error past its handler. The remap now only fires while the ERROR dimension is still live in the mask. Errors surfaced through DOM insertion effects were unaffected. Restores the beta.15 (and Solid 1.x) contract that `Loading > Errored > content` reliably catches at the inner boundary.
- 40d13a9: Restored 1.x replacement semantics for `createReaction` (#2861): calling `track()` again before the reaction fired now disposes the superseded arm instead of accumulating it. Previously every `track()` call created a new deferred effect that stayed alive until it individually fired — superseded sources still fired the callback, each accumulated arm delivered its own fire, and un-fired arms leaked as live effect nodes under the owner.
- b9cefee: Removed the `Loading` queue's notify-through remap. After #2856 narrowed it to fire only while the ERROR dimension was still live in the notification mask, the rule collapsed into the generic consume-and-forward path: each boundary consumes only its own status dimension and forwards the remainder, so an error inside a `Loading` reaches its `Errored` natively. The only residual behavior — suppressing pending collection on a node that is simultaneously pending and errored — is unreachable, as status propagation never sets both dimensions on one node. Added pins for the two paths the remap used to intercept (sync error in the mounting flush and reactive error after commit, both `Errored > Loading > content`).
- c3b8314: Nullish async rejections (`Promise.reject()`, `reject(null)`) now reach user error surfaces as the rejected value instead of the internal `StatusError` wrapper. Both unwrap sites — the `Errored`/`createErrorBoundary` fallback and the effect bundle's `error` arm (including its no-handler `console.error` fallback) — recovered the user error via `cause ?? wrapper`, and `StatusError` always installs `cause` (even for `undefined`/`null`), so nullish rejections fell back to the wrapper itself: an undocumented type carrying a reactive `.source` node, which also broke `err() == null` branching in fallbacks. The unwrap is centralized in `unwrapStatusError()`, which tests the wrapper type instead. Non-nullish errors are unaffected.

## 2.0.0-beta.16

### Patch Changes

- 4b5272f: `createErrorBoundary` and `createLoadingBoundary` now return a properly typed `Accessor<T | U>` (content union fallback) instead of `() => unknown`, with the same external signature across the core, client hydration, and server layers.
- a2c9de1: Add an opt-in companion-vs-oracle census (test-mode, `COMPANION_CENSUS` env var): a non-asserting diff logger that compares every live isPending/latest companion against a fresh oracle at the end of each flush. Census findings (nine divergence fingerprints, all pending divergences one-directional under-reporting) are recorded in INTERNALS-ASYNC-STATE.md and define the write-driven companion redesign's update points.
- 7de51be: Redesign isPending/latest companion updates to be write-driven (#2838): verdicts derive from data state and survive transition completion. Fixes the four pinned spec violations — V1 (resting optimistic node reported not-pending while an entangled refetch held its fresh value; the #2799 carve-out is removed since resting nodes never hold revert targets), V2 (an early probe froze latest() at the stale value for the whole blocked window), V3 (isPending read false during a post-transition refetch), and V4 (the latest-form on an untouched optimistic store leaf failed to filter a pure firewall refresh and its companion stuck true forever). Companions now re-derive at settlement checkpoints (commit/revert), firewall status changes poke probed leaf companions, and the resting async hold syncs companions like every other write path.
- 822a5a6: Add dev-mode invariant assertions and a spec test suite for the async/transition/lane machinery (probe leaks, companion coherence, override/pending leaks at quiescence, merged-lane routing, out-of-band async-reporter registration). Assertions throw under test, log in dev, and fully tree-shake from production builds. Enabling them surfaced and fixed a real leak: `mergeLanes` copied the merged lane's pending-async set and effect queues into the root without clearing the originals, retaining node references for the lane's lifetime.
- c45b6f7: Effect-returned cleanups now fire at the effect node's own disposal (unwind order) instead of via a hook registered on the parent's disposal list. Removes a retention edge — early-disposed effects no longer leave dead closures in the parent's disposal array — and makes final effect cleanup ordering identical between dev and prod through the dev component wrapper.
- c2b7aed: The effect bundle `error` handler is now the error arm of the effect phase (#2840)

  Previously the handler fired synchronously mid-propagation, inside an owned
  scope — signal writes (the natural "set error state" pattern) tripped
  `REACTIVE_WRITE_IN_OWNED_SCOPE`, and it could fire for speculative computes
  under a held transition. It now queues like the `effect` function and runs
  on the same schedule, in the same imperative writable scope, with the same
  throw escalation (nearest boundary, else halt). Consequences: the handler
  observes settled outcomes — an error that recovers before the effect phase
  runs the `effect` arm instead, and a held transition defers the handler
  exactly as it defers `effect`. The no-handler `console.error` fallback moves
  to the same schedule. Render effects are unchanged.

- 57b92a1: Fix the effect bundle `error` handler receiving the internal `StatusError` wrapper instead of the thrown error (#2840)

  `notifyStatus` wraps compute-phase errors in `StatusError` for source
  tracking. `createErrorBoundary` already unwrapped before exposing the error
  to its fallback, but `notifyEffectStatus` passed the raw wrapper to the
  bundle's `error` handler — breaking `instanceof` and class-based branching
  on the documented recovery path. The handler (and the no-handler
  `console.error` fallback, and the no-boundary halt rethrow) now receive the
  user's original error; the node keeps the wrapper internally for boundary
  notification.

- b51bbcc: Eliminate optimistic revert targets: `_pendingValue` now has exactly one meaning (a pending commit) and `_value` changes only at commit points. Authoritative values arriving under an active override hold like any other transition write and elevate on their own transition's schedule — unobservably, since every reader sees the override (A17); reverting an override is a pure drop that commits nothing. Fixes a data-loss bug (V5) where a first optimistic write clobbered a refetch value held in the blocked-merged window, resurrecting stale data at revert. Refines A18 (2026-07-07b re-rule): an override's lifetime is bound to its own transition; in merged transitions corrections reveal atomically with the merged completion (pending true throughout) while still propagating internally on arrival — no waterfalls, only the reveal is gated.
- 5efe089: `action()` now awaits yielded object thenables, not just native `Promise` instances. Yielding a Promise-like object that is not `instanceof Promise` (a custom thenable, cache wrapper, or cross-realm promise) previously resumed the generator immediately with the raw object instead of its settled value. Yield handling now uses an object-thenability check (`typeof value === "object" && typeof value.then === "function"`), shared with the async runtime's thenable detection (#2765).
- 0e81199: Fix uncaught errors in async-generator `action()`s freezing the JS thread (#2841)

  A rejected iterator-result promise from an async generator means the error
  already escaped the generator body (it is completed) — throwing back in via
  `it.throw()` just rejected again forever, starving the event loop in a
  microtask loop. The runner now settles the action instead: the returned
  promise rejects, the iterator is removed from the transition's `_actions`,
  and the transition can complete. `try`/`catch` around `yield`/`await` inside
  async generators is unaffected, as is the sync-generator throw path.

- bb750d1: Dev: the `ASYNC_OUTSIDE_LOADING_BOUNDARY` warning now fires consistently when a pending async read escapes without a `Loading` ancestor, even under an `Errored` boundary (#2822). Enforcement previously re-notified the boundary chain with an error status, which both suppressed the warning and routed the pending to the error boundary — showing the error fallback in dev only, a dev/prod divergence. Pending is not an error: the mount defers identically in dev and prod, and the diagnostic is informational.
- f658824: Fix `createProjection` seed typing so readonly store seeds do not override inference from the projection function return type.
- e2ebc11: Errors thrown by a user `equals` comparator now route through the node's error status like compute-phase throws, so error boundaries contain them (previously they unwound the scheduler flush, bypassing every boundary and silently wedging the queue). Applies to sync recompute, direct writes during async resolution, and lane-routed async writes. Also documented the createEffect error contract: the `EffectBundle.error` handler intercepts compute-phase (reactivity) errors only; effect-phase throws are the user's own imperative code and escalate to the nearest error boundary (#2837, #2839).
- 26f443f: Fix `isPending` on an async source that errors (#2790). `isPending` reading an
  errored source now resolves to `false` (both synchronously and asynchronously)
  instead of livelocking or surfacing an unhandled rejection. Three layered changes:
  - Async propagation: the link an `isPending` read creates is tagged as a
    pending-observer. When the source errors, `notifyStatus` re-runs the observer
    (so `isPending` re-evaluates to not-pending) instead of forwarding the error
    through it — preventing the error from escaping (e.g. out of an `<Errored>`
    fallback, which its own boundary cannot catch) as an unhandled rejection.
  - `isPending` observation: the errored-retry in `read` is gated behind
    `!pendingCheckActive`, so a pending check observes the errored status (the
    stored error is thrown and swallowed by `isPending`) rather than re-running the
    async body — which would re-fetch, flip the source back to pending, and livelock
    on a source that keeps failing.
  - Retry policy: the errored-retry in `read` is additionally gated behind
    `tracking`. An errored async source only retries when re-read from an
    owned/tracked scope (a reactive recomputation) in a later cycle. Naked/ownerless
    reads — events, `untrack`, an effect's side-effect phase — surface the stored
    error without re-fetching.

- aace71e: Fix `isPending` not reporting pending during a `refresh()`/refetch of an async `createOptimistic` accessor (#2799). A resting optimistic node (no active override) now reports pending exactly like a plain async memo while a refetch is in flight with stale data; muting pending remains the job of an active optimistic override only.
- 536bea5: Fix `latest()` / `isPending(() => latest(x))` on async memos (#2829). Three related defects in the latest-shadow computed's lifecycle: (1) after the initial load resolved, `latest(x)` regressed to `undefined` because the shadow recomputed mid-transition under a stale/lane read context and cached the committed (still-undefined) value; (2) the first refresh after settling never reported pending because the shadow stayed `STATUS_UNINITIALIZED` forever (the optimistic-node resolution path committed its first value without clearing the flag), so the pending probe mis-classified the refresh as an initial load and suspended the reader before collecting pending sources; (3) `latest()` now never suspends a reader once the source has a value — it falls back to the stale committed value, and only suspends on a true initial load where there is nothing stale to show.
- 16c861e: Fix `latest()`/`isPending()` consistency gaps (#2831): store-leaf reads now report the firewall's refetch as pending; `[isPending(x), x()]` can no longer pair pending with the fresh in-flight value for non-stale readers; and sync derivations of transition-held sources (a memo over a held signal) are now visible to `latest()` and `isPending()` — the transition-held sync recompute path maintains the same companion nodes as `setSignal` and async writes.
- 219e30c: Fix infinite loop when an async memo is read inside `Loading > Errored` (#2809). Boundaries no longer re-throw a foreign status (pending through an `Errored`, errors through a `Loading`) to reactive readers; the status is propagated exclusively through the boundary queue chain to whichever boundary handles it. Boundary trees notify both status dimensions like render effects do, foreign flags are cleared from the tree's reader-visible state, and boundary result computeds are excluded from hydration snapshot capture (they previously relied on the leaked pending flag to be skipped).
- 45df105: `onSettled` no longer runs a returned cleanup eagerly when it fires from an unowned scope (an event handler, a tracked effect, or another `onSettled`). A cleanup is only meaningful when `onSettled` runs in an owned scope, where it fires on owner disposal. In an out-of-band fire there is no owner lifecycle to bind to, so previously the cleanup was invoked immediately in the same flush — tearing down setup-with-teardown helpers the instant they installed. Returning a cleanup from such a scope is now a dev-mode error (`SETTLED_CLEANUP_UNOWNED`) guiding the call into an owned scope, and is dropped in production. The out-of-band one-shot fire itself (no cleanup) is unchanged.
- 2d07c8d: Fix optimistic overrides being silently dropped when their transition is entangled with other async work. `transitionComplete` excluded a node pending on its own fetch from blocking completion, so a merged transition could complete on the first flush and revert the override while its async was still in flight. An active override is now held for every reader (ambient and tracked) until the owning transition truly settles (ruled as spec A17).
- 9a55a4d: Fix `reconcile()` leaving stale per-index and `has` nodes on array resize (#2823). After a shrink, tracked reads of removed indices now update to `undefined` and untracked reads agree with `length` instead of serving the removed row from the leftover node; `in` checks update in both directions (removed indices report `false`, indices added by growth report `true`). Node sync is membership-based (`key in next`), so sparse holes and named array properties are unaffected.
- 6cef1c1: reconcile: force wholesale replacement when nested value type changes between array and object
- bc92d00: Fix keyed `reconcile` crashing on non-object array entries (#2772): a keyed `reconcile(..., key)` threw when an array held `null`/`undefined`/primitive entries, because the keyed diff passed them to `keyFn` (which assumes an object) or to `wrap()` (which assumes a wrappable value). The keyed paths now guard every match/key/wrap site, so non-object slots are preserved or replaced wholesale (object→primitive and back).
- cfe6c8f: Fix `reconcile()` mishandling store proxies held as values (#2825). The diff's `unwrap` helper read the internal signal-node record (`STORE_NODE`) instead of the store's value, so reconciling data containing store proxies leaked internal Signal records into store reads (breaking `JSON.stringify` with a circular-structure error) or silently dropped keyless swaps; keyed reorder of an array whose items are store proxies crashed with a stack overflow. Proxies are now normalized to their raw value at the diff entry, restoring identity-preserving merges across the proxy boundary.
- 54b2175: reconcile: notify ownKeys subscribers on pure keyed trailing removal
- c4ba526: Fix `resolve()` never settling (and leaking its root) when the async source rejects (#2842)

  `resolve()` was built on a bare, subscriber-less computed: a pending source
  that _resolved_ re-enqueued it, but a _rejection_ only marked it errored for
  a pull that never came — the promise hung forever and the internal root was
  never disposed. Rebuilt on a user effect, whose error-notification channel is
  actively told about rejections: the promise now rejects with the user's
  original error (unwrapped from the internal `StatusError`, matching error
  boundaries) and the root is disposed on every terminal state.

- d7e382a: A resting `createOptimistic` async source (no active override) now commits its async completion through the same pending-node commit path as a plain async memo, instead of writing its value directly. The direct write skipped the commit that clears `STATUS_UNINITIALIZED`, so when `isPending(() => data())` was the _only_ consumer (the `disabled={isPending(data)}` shape, with no value-observer to drive the commit), the flag was never cleared and the first `refresh()` was misread as an initial load — `isPending` never reported `true`. Routing the resting completion through the shared commit makes a resting optimistic node indistinguishable from a non-optimistic one, removing the divergence rather than special-casing it.
- 461b242: `snapshot()` and `deep()` now read through the optimistic overlay on `createOptimisticStore` (#2850), agreeing with every other reader: an active optimistic write is THE value (A17), and snapshot's documented behavior on regular stores is already to read the pending-write overlay synchronously. Resolution order matches the proxy traps and `reconcile` (optimistic over regular). Also lands the specialized no-overlay snapshot walk deferred from #2756.
- 5894f2a: store: fix two proxy invariant bugs — non-configurable property descriptor and stale indices after array truncation
- bc92d00: Store key-handling fixes, plus a follow-up to the #2797 array-truncation fix:
  - **Array truncation notifies tracked reads** (#2768): #2797 clears the truncated indices from `has`/`ownKeys`/index reads; this additionally calls `notifyStoreProperty` for each dropped index, so a reactive read tracking `store[i]` re-runs instead of holding the stale value.
  - **Symbol-keyed properties** (#2769): writing a symbol key on an array store threw (`parseInt` on a symbol), and several helper/replacement paths dropped symbol keys because they enumerated with `Object.keys`. Array writes now treat symbols as metadata (not indices), and `storeSetter`, `storePath`, and `merge`/`omit` enumerate own enumerable keys including symbols.
  - **Null-prototype objects** (#2771): reading a function-valued property off an `Object.create(null)` store crashed (`storeValue.hasOwnProperty` is undefined). The check now uses `Object.prototype.hasOwnProperty.call`.

- 5efe089: Surface synchronously-rejecting thenables. A memo returning a Promise-like thenable that invoked its rejection handler synchronously during `.then()` (e.g. a cache that already knows it failed) had its error dropped and stayed stuck on the pending path forever — `<Loading>` never gave way to `<Errored>`. The thenable branch now captures a synchronous rejection (mirroring the existing sync-resolve handling) and settles it, so the error reaches the boundary the same way an async rejection does (#2764).
- 90238e7: Detach effect cleanups before invoking them so a throwing cleanup is never re-run on later passes and its error takes the standard effect error path (catchable by error boundaries) (#2813)
- 936b098: Gate the async/transition invariant assertions behind `__TEST__` instead of `__DEV__`. The per-write tracking and per-flush quiescence sweep regressed dev-build performance by 5-21% across the benchmark suite; dev builds now pay nothing for them and they run only under the test suite's defines.
- 90238e7: An error that escapes every error boundary now permanently halts the reactive system instead of leaving it in a partially-updated state (#2761, #2762). The error still throws through as an uncaught exception; after that, further writes and flushes are ignored and a `REACTIVITY_HALTED` message is logged. Handle errors with `createErrorBoundary`/`<Errored>`, or treat an uncaught error as an app crash. `resetErrorHalt()` is exposed for tests and dev tooling.
- cdbe95d: Add the INV-2 test-mode assertion (an active optimistic override must hold a revert target and stay registered for reversion) and characterization tests for the open async semantics questions (B4, C1, C4), including two known ruled-spec violations in the blocked-merged-transition window pinned as expected failures.
- 233e7b0: Ineffective optimistic store writes no longer arm the store-wide isPending mask or entangle the transition. Previously the mask armed on any write-trap fire before the equality short-circuit, so `setStore(s => ({ ...s }))` (which replays every key with equal values) and same-value property writes silently decreed the store settled while the semantically identical `setStore(s => s)` did not. The mask and reversion tracking now arm only when data actually changes, matching the signal path where an equal-value first optimistic write creates no override.
- 77f6d18: Optimistic overrides now mask `isPending` — an active optimistic write is "certainty by decree" (#2844, #2728)
  - An active optimistic override reads `isPending === false` for its whole
    lifetime, on every node kind and in both probe forms. `isPending` is
    reserved for data being updated by machinery the reader did not decree
    (refetches, transition-held commits) — never for the provisional nature of
    an override. Action affordances ("Saving…") belong in the data as
    co-written flags or a separate `createOptimistic(false)`.
  - For derived optimistic stores the mask is store-wide: while any optimistic
    write on the store is live, the entire store (written leaves, untouched
    siblings, structural reads, the firewall's own refetch) reads settled. The
    mask lifts when the store's optimistic state clears. Background polling
    falls out: `refresh(store); setStore(s => …reassert…)` revalidates silently.
  - `isPending(() => latest(x))` now follows `x`'s own in-flight async only:
    `latest` acts as a self-applied override the moment a held value exists, so
    transition holds no longer read pending through it; it is never pending on
    signals or sync computeds.
  - Store leaves report a firewall refetch in both probe forms (the old
    latest-form filter is gone; the store-wide mask is the only silencer).
  - Companion verdicts now revert when their owner is disposed (no
    latched-`true` spinner for a dead source — the #2845 edge).
  - Dev/test invariants INV-9 (disposal) and INV-10 (mask, both node- and
    store-scoped arms) enforce the new semantics; dead lane-merge and probe
    special-case paths were removed.

  See `SPEC-ASYNC-SEMANTICS.md` (A8/A9/A19/A20/A21 re-rulings, 2026-07-07c) and
  `INTERNALS-ASYNC-STATE.md` §5f for the full ruling and implementation notes.

- a6d83f1: Extend test-mode invariant machinery for the async/companion redesign pre-work: INV-8 pending-hold provenance (every held `_pendingValue` is tagged as an optimistic revert target or a transition/refetch hold, and the #2799 resting carve-out is probed for muting refetch holds — the V1 root cause), INV-9 (a disposed owner's isPending companion must not report a phantom `true` at quiescence). Rule and pin A20 semantics: an active optimistic override reads `isPending === true` uniformly (overrides mask stale content, not settlement), pending scope follows the read, and `latest` strips coordination but never confirmation — with the latest-form store-leaf filter pinned as expected failure V4.
- b7c03a7: perf: O(1) dependency revalidation and reconcile allocation trims (from #2756)
  - Replace the `isValidLink` dep-list scan with a per-recompute generation stamp
    on links, eliminating O(n²) behavior when a computation re-reads a dependency
    it already saw during the same pass (deep-tree reconcile with all paths
    subscribed: ~7x faster)
  - Reconcile: reuse the existing key array when key sets match in `getAllKeys`,
    and skip symbol lookups on primitive leaves in `unwrap`
  - Avoid the `untrack` closure in `getKeys` for plain (non-proxy) sources
  - Cache one bound effect runner per effect instead of allocating per update

- e73ccae: Code reduction pass over the optimistic machinery. Remove dead override-correction paths made unreachable by the hold model (`_overrideSinceLane` flag, the non-lane recompute correction, setSignal equal-write re-propagation). Consolidate the store's three-layer value resolution behind `getOverlayLayer`/`visibleNodeValue` chokepoints so every proxy trap resolves optimistic → override → base identically.
- b9f2737: Fix `reconcile()` never notifying symbol-keyed store nodes (#2851)

  The remaining variant of #2769: reconcile's diff loops enumerated with
  `Object.keys`, so symbol-keyed nodes were never diffed — tracked reads and
  `in` checks of `state[SYM]` were not notified, and the stale node shadowed
  the reconciled value even for untracked reads. Symbol keys are now diffed
  like string keys: `getAllKeys` appends enumerable symbols (with override
  deletes still winning), and node-record loops enumerate symbols only for
  records that currently hold a user symbol node (tracked via a WeakSet mark
  maintained by `getNode`/`unobserved`), keeping the symbol-free hot path on
  `Object.keys`.

- 4e81e9c: Fix `repeat()` / `<Repeat>` leaking live row scopes and crashing on disjoint window jumps. When a reactive `from` moves the window to indices that don't overlap the previous window, the shift-and-fill update walked `_nodes` at negative local indices: a forward jump larger than the window created every gap row and left them alive (owners, effects, and `onCleanup`s never disposed), and a backward disjoint jump threw `Cannot read properties of undefined (reading 'dispose')` and froze the list. The first render with a nonzero `from` mapped the whole `0..from+count` prefix for the same reason. Disjoint windows are now detected and replaced wholesale; overlapping slides (the #2784 fix) are unchanged.
- 76fc7e6: Streamline the isPending()/latest() internals: remove a dead branch in `computePendingState`, consolidate the tripled companion-node bookkeeping (setSignal / async resolution / transition-held recompute) into a single `syncCompanions` helper, collapse the four isPending probe globals into one probe object, and deduplicate node preparation in `read()`. No behavior change; slightly smaller bundle.
- faf78eb: Fix `snapshot()` and `deep()` shrinking an array's length when trailing indices were deleted (#2846)

  `delete arr[i]` on a store leaves a hole without changing `length` — plain
  JS semantics, and every proxy-side read agrees — but `snapshotImpl`'s array
  branch skipped `$DELETED` slots without restoring the result's length, so
  trailing holes truncated the copy (at any nesting depth, for either API).
  The array branch now restores the length after the loop, mirroring
  `unwrapStoreValue`, so deleted slots stay holes (`i in copy === false`,
  serialized as `null`).

- c165ec2: Fix store property descriptors reporting stale values after `setStore` writes. `Object.getOwnPropertyDescriptor(store, key)` and `Object.getOwnPropertyDescriptors(store)` now agree with proxy reads for written string and symbol keys while preserving the source descriptor's flags. Writes over prototype-inherited properties now also report an own descriptor and no longer crash `snapshot()`.

## 2.0.0-beta.15

### Patch Changes

- 0564da2: Avoid recomputing reconcile state identity keys.
- e141459: fix scheduler livelock after disposing a subtree with a stale height-adjust heap entry
- 97b4111: Coalesce same-flush refresh calls by scheduling refresh invalidations through the reactive queue.
- f0bdfad: Route height-adjusted subscribers to the queue that matches their own zombie flag in `adjustHeight`, mirroring the post-recompute height-adjust path. Inserting into the currently running heap unconditionally could park a zombie node in `dirtyQueue` (or a live node in `zombieQueue`), breaking the flag/queue invariant `deleteFromHeap` relies on — the same corruption class behind the #2759 livelock, reachable through a different trigger.
- 0eb7f4e: Track pending state for deep reads of optimistic stores during transitions.
- 910b0ee: Clear derived optimistic store overlays when fresh projected data commits.
- dfcd7bd: Resume derived signal tracking after repeated same-value manual writes.
- f97643c: Report pending state for action-held writes to derived stores.
- f0bdfad: `flush(fn)` now restores its sync-depth counter when the drain throws. An effect that throws inside a synchronous flush scope previously leaked the counter, which left `schedule()` permanently unable to queue a microtask and silently froze all later reactivity. Balancing it in a `finally` keeps the scheduler usable after the error propagates.
- b26bc04: Avoid reconcile crashes when async optimistic stores return nested arrays that have not created store nodes.
- 03369dd: Track pending state for nested deep optimistic store reads.
- 99d829e: Fix overlapping same-value optimistic writes so overrides stay active until all actions settle.
- e5761bd: Prevent projection draft inspection from subscribing projections to their own store.
- 1847868: Fix projection pending state on first refresh after initial async resolution.
- 5466a3b: Preserve pending projection object property writes when draft arrays move store proxies.
- db88de1: Fix `createReaction` crashing with `Cannot read properties of null (reading '_dep')` when the invalidating rerun of the tracked callback reads zero dependencies. `dispose()` now guards its dependency-unlink loop instead of unconditionally calling `unlinkSubs` once.
- d8921ac: Fix `repeat` (`<Repeat>`) disposing the wrong row owners when `from` advances from a non-zero offset. The front-clear loop indexed the local `_nodes` array with a global index, so a sliding window (e.g. rows 1-3 → 3-5) disposed rows that stayed visible and leaked rows that left. It now disposes the correct local positions.
- e141b64: Reset `<Repeat>`'s window offset when its count drops to zero. Previously the empty-window path cleared the row data but left `_offset` stale, so a later nonzero render with a smaller `from` computed a negative local index and disposed `_nodes[-1]`, crashing `updateRepeat`. This is the second symptom of #2767 (the first, wrong-row disposal on a forward slide, was fixed separately).
- baa47d2: Preserve snapshot array length overrides when the overridden length is 0.
- 52255dc: Remove the public `isRefreshing()` API and treat `refresh()` as write-like invalidation in dev owned-scope diagnostics.

  `refresh()` is an action that invalidates an explicit refresh target; it should not expose ambient phase state to pure computations. User-visible mutation or retry intent should be modeled with actions and optimistic state, while readiness remains observable through `Loading` and `isPending`.

- 23c9563: update primitive store array mappings

## 2.0.0-beta.14

### Patch Changes

- 79e246e: Fix Loading boundary child flattening so settled async memo reads converge with `latest()`.
- Add store return tuple type aliases and harden store draft writes against prototype pollution keys.

## 2.0.0-beta.13

### Patch Changes

- 157dfe2: Pass an error accessor to error boundary fallbacks so repeated async errors from the same captured source update reactively.
- 4404f9f: Add an opt-in `isPending(fn, true)` render guard mode that lets pending reads follow the Loading path.

## 2.0.0-beta.12

### Patch Changes

- 0a7c278: Document the mode-specific callback shapes for mapArray and For.
- 12f15a2: Align control-flow callback values with their keying mode so stable rows receive raw values and index-owned rows receive accessors only where the value can change.

## 2.0.0-beta.11

### Patch Changes

- cf62254: Throw a dev-mode error when refresh is called with an unbranded target.
- e41186c: Drop stale dependencies from async memos after their pending result settles.
- 02ec407: Prevent pending async reads from escaping when refreshing an optimistic accessor with an active override.
- e16371f: Reduce effect creation overhead by sharing status notification logic, registering effect cleanups lazily, and avoiding generic store proxy work for tracked reads of absent plain-object properties.
- 7d4d0c3: Optimize pending node commits for the common single-source update path.
- 005c9fb: Improve merge and omit performance for store utility hot paths.
- d2529e3: Redesign refresh to invalidate a single explicit target without reading accessor values.
- 7d4d0c3: Add scoped synchronous flushing and skip no-op status work.
- d42f112: perf(store): split `applyState` into fast/slow paths and tighten store hot-path

  `applyState` now dispatches at every (recursive) call between a `applyStateFast`
  body for plain stores and an `applyStateSlow` body for stores with override or
  optimistic-override slots set. The fast body never calls `getOverrideValue` and
  never branches on a `fastPath` flag, so V8 sees a tighter, more inlinable shape
  in the overwhelmingly common case. Validated end-to-end with UIBench: ~18–21%
  total render time improvement, with no regression in `js-framework-benchmark`.

  Also:
  - `isWrappable` restructured for an early-return hot path on the common
    `null` / non-object cases.
  - `createStoreProxy` now only stamps `STORE_CUSTOM_PROTO` when the prototype
    is non-trivial, avoiding the extra slot on the default object/array path.

- e16371f: Performance: add `CONFIG_SYNC` opt-in for sync-only computeds/effects. New `sync?: boolean` option on `MemoOptions`/`EffectOptions` skips the async-shape probe in `recompute` for nodes that provably never return Promise/AsyncIterable. Compiler-emitted `_$effect` and `_$memo` (via `@solidjs/web`'s `effect`/`memo` wrappers) opt in by default — `01_run1k` mean −0.62 ms and `08_create1k-after1k_x2` mean −0.80 ms in `js-framework-benchmark`. User-authored `createMemo`/`createEffect`/`createRenderEffect` keep full async-aware behavior unless they explicitly pass `sync: true`. Returning a Promise from a `sync: true` node throws `SYNC_NODE_RECEIVED_ASYNC` in dev (production silently stores the unawaited value, by contract).

  Correctness: `flush(fn)` now drains at every nesting level instead of only the outermost. Nested `flush(fn)` calls each honor their own contract — writes inside an inner `flush(fn)` propagate before it returns, rather than being held until the outer `flush(fn)` exits. Microtask scheduling and arg-less `flush()` are unchanged. Code that depended on the old hold-until-outermost behavior should switch to a harness-layer depth counter (see `js-reactivity-benchmark`'s `r3` / `r3-solid-target` adapters for the pattern).

## 2.0.0-beta.10

### Patch Changes

- 59dd11f: Docs prep for the 2.0 reference auto-generation pass: backfill JSDoc examples on previously-undocumented public APIs (`getObserver`, `isDisposed`, `createRenderEffect`, `onCleanup`, `createErrorBoundary`, `createLoadingBoundary`, `createRevealOrder`, `flatten`, `enableExternalSource`, `NotReadyError`, `NoHydration`, `Hydration`, `isServer`, `isDev`); normalize inline JSDoc code fences to `@example` tags on the JSX components (`<For>`, `<Repeat>`, `<Switch>`, `<Errored>`, `<Reveal>`, `dynamic`, `<Dynamic>`); and tag cross-package wiring / compiler-emitted exports with `@internal` so the doc generator can hide them from the user-facing surface (`getContext`, `setContext`, `createOwner`, `getNextChildId`, `peekNextChildId`, `enforceLoadingBoundary`, `sharedConfig`, `enableHydration`, `NoHydrateContext`, `$DEVCOMP`, `$PROXY`, `$REFRESH`, `$TRACK`, `$TARGET`, `$DELETED`, `ssr*` helpers, `escape`, `resolveSSRNode`, `mergeProps`, `ssrHandleError`, `ssrRunInScope`). Also extends the `equals` field JSDoc on `SignalOptions` / `MemoOptions` to mention `isEqual` as the default.

## 2.0.0-beta.9

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

## 2.0.0-beta.7

### Patch Changes

- 5acf0ee: Allow partial initial values for derived stores/projections by accepting `Partial<T>` for the seed parameter
