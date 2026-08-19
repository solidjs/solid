# Mined rules: reconcile, snapshot, utilities

Source suites: `tests/store/reconcile.test.ts`, `tests/store/reconcile-captured-proxies.test.ts`, `tests/snapshot.test.ts`, `tests/snapshot-derived-store-rows.test.ts`, `tests/store/utilities.test.ts`.

## A. Reconcile contract

**R1 — Keyed object merge deletes absent keys.** Properties present in `next` update; properties absent from `next` are deleted (read `undefined`, removed from `in`/keys).
- Evidence: reconcile.test.ts — "Reconcile a simple object", "…on a nested path", "a symbol key removed by reconcile notifies as undefined".

**R2 — Reconcile applies to any nested proxy, not just the root**, with identical semantics.
- Evidence: "Reconcile a simple object on a nested path", "Reconcile nested top level key mismatch", "Reconcile reorder a keyed array".

**R3 — Keyed identity mismatch at the target throws** (key differs, or key present on target but missing from `next`). Post-throw state is deliberately unasserted (original expectations commented out) — the rewrite should decide and document atomicity.
- Evidence: "Reconcile top level key mismatch", "…nested…", "…key missing".

**R4 — `key: null` / `key: ""` disables key matching**: positional merge, no root identity check.
- Evidence: "does not enforce root identity", "Reconcile overwrite in non-keyed merge mode", "merges arrays positionally, preserving slot proxy identity".

**R5 — Key modes: string key, key function, none.** KeyFn's call set is observable (see R17).
- Evidence: string keys throughout; reconcile-captured-proxies — "never-subscribed branches are not walked by the diff".

**R6 — Key-matched items preserve logical (proxy) identity across reorder, insert, delete.**
- Evidence: "Reconcile reorder a keyed array"; captured-proxies — "captured row proxy … survives reconcile".

**R7 — Re-sent identical objects preserve raw identity: `snapshot(state.arr[i])` is `Object.is`-equal to the original.** CONFLICT (benign, verify): adoption satisfies this since raw becomes the incoming object; keep as explicit `__TEST__` rule.
- Evidence: "Reconcile reorder a keyed array".

**R8 — Positional merge preserves slot proxy identity even when identifying fields change** (fixed-shape dashboard pattern).
- Evidence: "merges arrays positionally…", "Reconcile overwrite in non-keyed merge mode".

**R9 — Only changed leaves notify** (changed `a` reruns its subscriber exactly once; `b` subscriber zero times).
- Evidence: "only changed leaves notify".

**R10 — Kind changes (object↔array) at any position replace wholesale, never merge, and notify the property node.**
- Evidence: "Reconcile overwrite an object with an array" and 5 related tests.

**R11 — Null entries and primitives are legal keyed-array members** (#2772).
- Evidence: "Reconcile array with nulls", "Keyed reconcile preserves null entries…", "…replaces a keyed object with a primitive".

**R12 — Array resize notification matrix.** Shrink: tracked removed indices notify `undefined`; tracked `in` flips false; untracked reads agree with new length (no stale node values). Growth: tracked missing indices notify new value; `in` flips true. Trailing removal notifies `$TRACK`/ownKeys. Both keyed and non-keyed.
- Evidence: 7 resize tests in reconcile.test.ts.

**R13 — Numeric-coercible non-index string props on arrays (`"1e3"`, `"1.5"`) survive resize**; node sync must be membership-based, not length-range-based.
- Evidence: "Reconcile array shrink preserves tracked named array props…".

**R14 — Symbol keys have full parity with string keys under reconcile** (update/remove/add/nested/mixed).
- Evidence: "reconcile with symbol-keyed properties" block; captured-proxies symbol test.

**R15 — Reconcile can assign, swap, and reorder values that are other stores' proxies.** CONFLICT (attention): adoption must handle `next` values that are live proxies of other stores — `storeLookup` resolution must cover proxy-valued incoming data.
- Evidence: "Reconcile swaps a property whose value is another store's proxy" + 2 more.

**R16 — Captured proxies with a live subscriber anywhere below are diffed in place through never-tracked intermediate levels.** CONFLICT (design obligation): a node exists deep below an un-noded path; adoption must locate and notify deep descendant nodes (current impl: sticky `STORE_DESC` flag bubbled up the wrap chain). Reference-skip pruning must not prune subtrees sheltering subscribers.
- Evidence: captured-proxies — 4 tests.

**R17 — Never-subscribed subtrees are pruned: the diff does not walk below their top-level pair** (observable via keyFn call set).
- Evidence: captured-proxies — "never-subscribed branches are not walked by the diff".

**R18 — Captured-but-unobserved proxies may detach and go stale after reconcile** (pinned pruning contract); a key mismatch detaches even an observed captured proxy.
- Evidence: captured-proxies — "captured-but-unobserved proxies may detach", "key mismatch detaches the captured proxy".

**R19 — `deep()` observes a reconcile as a single notification carrying the final plain data.**
- Evidence: utilities — deep "works with reconcile".

**R20 (type-level) — `reconcile(next)` requires the complete store type.**

## B. Reconcile + layers

**R21 — A reconcile in the same batch after an unflushed setter write behaves identically to a clean reconcile.** CONFLICT (framing only): tests motivate via `STORE_OVERRIDE`/`applyStateSlow` routing (deleted); observable rule maps onto O7 (owned/diverged backing must full-diff). Port assertions, rewrite comments. The O7 re-send test (same prior reference after intervening setter write must still restore) does NOT exist — must be added.
- Evidence: reconcile — "…shrink clears tracked indices on the override path"; captured-proxies — "slow path (live override layer)…".

**R22 — Reconcile inside an optimistic action window is tentatively visible; captured-proxy readers see exactly what tracked readers see, during and after settle.** CONFLICT (load-bearing): adoption must ride the optimistic lane — backing swap + notifications lane-scoped and revertable. "Adoption resets ownership" needs defined meaning when adoption is tentative (does rollback restore prior backing AND ownership?). Needs a ruling.
- Evidence: captured-proxies — "optimistic store: captured subscriber matches tracked-path behavior".

## C. Snapshot contract

**R23 — `snapshot()`/`deep()` always return plain non-proxy data** — including rows through derived stores, nested objects in them, chained views.
- Evidence: snapshot-derived-store-rows (5 tests); utilities deep test.

**R24 — CoW identity preservation:** never-written store snapshots as the original source object (`===`); after a write, changed object + ancestors are new copies, unchanged siblings keep prior snapshot identity; repeated snapshots of untouched subtrees stable. Nuance: after privatization the "copy" must be the owned raw itself, stable across snapshot calls (tests compare successive snapshots by identity).
- Evidence: utilities — 5 identity tests; snapshot — "preserves symbols on an untouched nested store value".

**R25 — Snapshot through a derived-store view returns the same raw object as through the base store** when nothing overridden. CONFLICT (attention): requires unwrapping chained proxy backings to base raw; the "same raw as base" identity only holds if the projection shares the base's raws — identity-skip interacts with `owned()` of another store's objects. Needs a cross-store ownership ruling.
- Evidence: snapshot-derived-store-rows — 2 tests.

**R26 — Snapshot reflects in-flight optimistic overrides while the base stays untouched.** Confirms O1's "snapshot = current view, lane values included".
- Evidence: snapshot-derived-store-rows — "snapshot(view[i]) reflects an in-flight optimistic override".

**R27 — Snapshot sees pending (unflushed) setter writes synchronously, while untracked proxy reads return the previous value until flush.** CONFLICT (MAJOR): §3's "urgent writes are synchronous commits" would make untracked reads see new values pre-flush, breaking R38's half. Either preserve visible-at-flush staging for untracked reads (contradicting write-through) or re-rule these tests. Sharpest observable contradiction in the set.
- Evidence: utilities — "returns new object if changed" (no flush) + comment; Clone Store "simple set".

**R28 — Array holes and length survive snapshot/deep** (trailing delete keeps length; holes stay holes; explicit length truncation round-trips; overridden length 0 snapshots as `[]`).
- Evidence: utilities 4 hole/length tests; snapshot — "preserves an overridden array length of 0"; deep variant.

**R29 — Symbol-keyed data round-trips through snapshot**: enumerable symbols preserved in copies; writes inside symbol subtrees captured; added-after-snapshot appear; deleted dropped; NON-enumerable symbols excluded from written copies; cycles preserved (`snap.node[meta] === snap.node`); shared refs stay shared; symbol-keyed store-in-store unwraps; symbols survive assignment into another store.
- Evidence: snapshot — 11 symbol tests.

**R30 — Snapshot-scope machinery (setSnapshotCapture / markSnapshotScope / releaseSnapshotScope / clearSnapshots):** signals/memos created during capture freeze creation-time value for scoped readers; writes don't reach scoped readers until release; release schedules recompute (async) and is idempotent; nested scopes independent; pre-capture signals propagate normally; propagation skips snapshot-scoped subscribers; clearSnapshots resets; boundary-internal (ownedWrite) signals excluded.
- Evidence: snapshot — capture/scope suites. Core-signal machinery; nodes-as-core-signals inherits it.

**R31 — Store properties written during capture preserve pre-write value for scoped readers; unwritten use current.** CONFLICT: current mechanism (`STORE_SNAPSHOT_PROPS` in set trap) is layer-adjacent; the write may hit a node-less property — needs node materialization on capture-time writes or a separate capture map. Design decision.
- Evidence: snapshot — 2 tests.

**R32 — A pending async projection suppresses snapshot capture**; after resolve + release, readers see resolved value. CONFLICT (mild): guard must move to lane-scoped adoption writes.
- Evidence: snapshot — "pending projection skips snapshot capture" (2 tests).

## D. Utilities

**R33 — `merge` core contract:** lazy getters (`this` = source); later sources win incl. explicit `undefined`; key union via `in`/keys; value props copied by value; non-enumerable → enumerable on result; first source never mutated; nested objects not cloned; nested merges flatten; null/undefined/false sources ignored; non-object sources throw; array sources merge; prototype-pollution safe; own `toString` shadows.
- Evidence: utilities — merge describe (20 tests) + others.

**R34 — `merge` reference-return optimization:** same reference for single arg, trailing falsy args, and when last source's own keys cover the union; new proxy otherwise; holds for store proxies.

**R35 — `merge` over signal-of-object source is reactive with minimal notifications.**

**R36 — `omit` contract:** removed keys disappear from get/`in`/keys incl. store-proxy sources; kept value props copied; descriptors cloned faithfully; pollution-safe; composes with merge.

**R37 — `deep()` contract:** plain data; tracks entire reachable tree (leaf writes, push, branch replacement, symbol subtree writes, symbol add/delete, shared-object writes through other paths); one notification per flush with final value; preserves holes/length. CONFLICT (note): "handles shared references" requires shared raws resolving to a single node home; privatization of a multi-parent (DAG) child needs a ruling — path-copying assumes a tree.

**R38 — Untracked read-through (via merge clone) shows pre-write values until flush.** CONFLICT (same as R27, MAJOR): contradicts write-through-immediately unless plain setter writes stay staged until flush. R27+R38 pin the visibility split (snapshot sees pending, untracked proxy reads don't). Needs explicit ruling.
- Evidence: utilities — Clone Store "simple set".

## Tests pinning internals — need a ruling

1. **reconcile.test.ts "perf invariant: symbol-record mark…"** — imports `symbolKeyedRecords`, `$TARGET`, `STORE_NODE`; asserts WeakSet lifecycle. Delete or re-express as rewrite-native perf invariant.
2. **utilities deep "subscribes to $TRACK at each level"** — counts `owner._deps === 4`; key-set consolidation could change it. Re-derive or replace with behavioral assertions.
3. **Override-path reconcile tests** (R21) — assertions portable; setup rationale names deleted machinery. Port assertions, rewrite comments; confirm setter-then-reconcile still exercises owned-backing diff.
4. **snapshot capture suite names** referencing `_snapshotProps`/`NO_SNAPSHOT`/`insertSubs` — assertions via public API stand (R30–R32); rename to behavior.
5. **snapshot-derived-store-rows header** — narrative in terms of `STORE_VALUE`/snapshotImpl fast path; assertions behavioral, rewrite the header.
6. **Key-mismatch tests' commented-out post-throw expectations** — latent question: is a throwing reconcile atomic? Decide and assert.

**Gaps to add as rule-derived tests:** O7 re-send test; rollback of adoption inside an optimistic lane (R22); privatization of shared multi-parent children (R37); ruling test for R27/R38 visibility split.
