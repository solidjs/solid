# Mined rules: core store suites

Files: **CS** = `tests/store/createStore.test.ts`, **SP** = `tests/store/storePath.test.ts`, **SIS** = `tests/store/store-in-store-tracking.test.ts`, **SH** = `tests/store/shallow.test.ts`, **SPC** = `tests/shallow-store-proxy-children.test.ts`, **RE** = `tests/store/recursive-effects.test.ts`, **NC** = `tests/store/native-collections.test.ts`, **MA** = `tests/maparray-store-nonkeyed.test.ts`.

## A. Value residency & identity

**R1. Wrappable values are wrapped: reading a plain object/array child never returns the raw source (`state.data !== data`).**
- CS "State wrapping > Setting plain object", "Setting plain array". No conflict.

**R2. Raw→proxy resolution is global and deduplicating: wrapping the same raw through two different stores yields the same proxy (`outer.list === inner`).**
- SH "shallow store nested in a deep store reconciles through the parent".
- **CONFLICT (mild):** under CoW, once a store privatizes a shared raw, the raw held by the other store diverges — dedupe key (raw identity) and logical node no longer coincide. Ruling needed on what dedupe means once backings diverge.

**R3. A store proxy ingested into another store (deep or shallow) is re-wrapped in the ingesting store's own proxy family — never identity-passed, never raw-marked.**
- SPC "each level serves its own proxies…", "set-trap ingest passes through without raw-marking", "seed ingest…".

**R4. Write isolation across a store chain: writing through the last store in a derived chain is visible only there; upstream stores and base objects untouched (shallow or deep middle).**
- SPC "write to the last store stays in the last store (shallow middle)", "parity with the shallow:false control".

**R5. Upstream writes propagate downstream through the chain without re-running structural machinery.**
- SPC "each level serves its own proxies; upstream writes stay fresh through the chain".

**R6. No store write path ever mutates a user-provided source object.** Aligned with 2026-08-16b.
- SH "setter replacement never mutates the base rows", "optimistic shallow store…"; SPC.

**R7. Circular references wrap without infinite recursion; cycle consistent through proxy (`state.b.a === state.a`).**
- CS "State recursion > there is no infinite loop".

**R8. `snapshot` returns fully unwrapped values (no proxy anywhere, `$TARGET` undefined), incl. frozen objects/arrays; reflects committed written values incl. writes over inherited prototype props.**
- CS "Unwrapping Edge Cases" (×3), "writing over an inherited property…".

**R9. Proxy identity per logical slot is stable across writes and reconciles** (mapArray keyed flows reuse rows across refetch/reconcile).
- SIS "read through derived optimistic store + mapArray", "mapArray directly over the base store"; SH. Aligned with §4.

## B. Tracking granularity

**R10. Per-property tracking; same-value writes (direct or functional path setter returning prev) do not re-trigger.**
- CS "Track a state change"; SP "Functional setter no-op when returning same value".

**R11. Per-path tracking: reading `state.user.firstName` subscribes to that leaf; reading the reference `store[0]` does not subscribe to `store[0].i`.**
- CS "Track a nested state change", "arrays > supports arrays".

**R12. Reading an absent key subscribes to that key: other-key changes don't trigger; defining it later (assignment or defineProperty) does.**
- CS "Not Tracking Top level key addition/removal", "supports Object.defineProperty inside a setter".

**R13. `in` tracks presence, not value: undefined-write doesn't retrigger; delete does; adding absent key does. `in`/`has` never invokes source getters.**
- CS "objects > has properties", "In Operator > wrapped nested class" (access === 0).

**R14. `Object.keys` / `for…in` subscribe to key-set membership (root and nested) — distinct from property nodes.** Aligned: key-set node.
- CS "Tracking iteration Object key addition/removal", "Tracking Top level iteration…".

**R15. Array structural tracking is uniform across idioms: indexed length loop, `for…of`, mapArray ($TRACK) all re-run exactly once per flush on add/update/removal.**
- CS "Tracking Top-Level Array iteration".

**R16. `length` independently trackable; index write extending the array notifies length subscribers.**
- CS "Array length > Setting plain object", "direct array index extension updates length immediately".

**R17. Truncating via `length = N` notifies tracked index reads of removed slots (re-run, observe undefined) and clears has/index/keys for removed indices.**
- CS "Array truncation notifies tracked index reads (#2768)", "Truncating array length clears stale indices…", "Track array item on removal".

**R18. `snapshot` is non-tracking.** Aligned with read table.
- CS "Doesn't trigger object on addition/removal", "arrays > supports arrays".

**R19. `untrack` scopes only the wrapped read; property access on the escaped value afterwards tracks normally.**
- RE "respects untracked".

**R20. Source getters (own, prototype, merge-installed) execute with the proxy as receiver, so their internal reads track — incl. through projections.**
- CS "prototype getters track instance field updates", "…through projection stores", "State Getters"; NC.

**R21. Structural subscriptions through a wrapper view (store-in-store) chain to the wrapped source: $TRACK/mapArray, ownKeys, snapshot/trackSelf through an outer derived store re-run when the inner store reconciles/changes shape.**
- SIS all of "#2864…".
- **CONFLICT (design work):** key-set node is per-object; wrapper views give one logical object two node records (view + source). $TRACK/key-set chaining across wrapper views must be a first-class rule or #2864 regresses.

**R22. Slots holding non-wrappable values (markRaw, Map/Date, function) track by reference: reassignment notifies; internal mutation doesn't.**
- SH "raw values are tracked by reference at their slot"; NC; CS "Track function change".

## C. Write semantics

**R23. The proxy is immutable from outside the setter: direct assignment and delete are silently ignored (no change, no notify, no TypeError — traps report success while discarding).**
- CS "State immutability > Setting a property", "Deleting a property", "objects > is immutable from the outside".

**R24. Writes batch like signals: inside the setter draft, reads are read-your-writes (values, length, `in` sync); outside the setter, ALL reads — value, `in`, length — return pre-write state until flush(). Holds for adds, deletes, array extension.**
- CS "Simple Key Value", "Test Array", "Test Array Nested", "direct array index extension…" (×2), "In Operator > batches like signals on cold writes", "State Getters"; SP nearly every test; "storePath.DELETE".
- **CONFLICT (the big one):** §3 "urgent write — commit now: write raw" + read table routing untracked committed reads to raw ⇒ untracked read right after setState would see the new value. Dozens of assertions demand the old value until flush. Either "urgent" means applied-at-flush (synchronously within the flush), or pre-flush writes park in a pending home untracked reads bypass.

**R25. Writes to properties with ZERO observers still batch (no effects anywhere; pre-write value visible between setState and flush).**
- CS "Simple Key Value"; SP non-reactive tests.
- **CONFLICT:** laziness invariant says no node from observer-less urgent writes AND raw written immediately — but the pending value must live somewhere reads don't serve. Ruling needed before the `__TEST__` assertion is wired.

**R26. Setting a key to undefined is not deletion: key stays present (`in` true, no key-set notify); only delete / storePath.DELETE removes.**
- CS "objects > has properties".

**R27. The setter may return a replacement value that swaps the root wholesale; symbol keys on the replacement preserved.**
- CS "Tracking Top-Level Array iteration", "Returned object replacement keeps symbol keys"; SH "canonical filter-removal idiom…".

**R28. `storePath` addressing: string keys, numeric indices, index arrays, predicate filters ((value, index)), ranges, trailing functional setters address and update intended paths + trigger per-path subscribers; nested plain-object arg MERGES (unlisted keys preserved), non-wrappables and arrays REPLACE; root object arg merges at root; storePath.DELETE deletes with full batching semantics.**
- SP "Triggers reactive updates", "Deeply nested reactive updates", "storePath.DELETE" + batching assertions.

**R29. Merge/replacement preserve accessor descriptors and keep getters LIVE (re-evaluated per read, reactive reads track), for pre-existing and new keys.**
- SP "Root-level merge preserves getter descriptors", "Preserves getter descriptors when replacing an existing key"; CS "supports Object.defineProperty inside a setter".
- **CONFLICT (mechanics):** CoW's first-write shallow clone must copy descriptors (Object.defineProperties-style), not values, or installed getters collapse to snapshots; merge writes must install descriptors onto owned raw.

**R30. Prototype pollution fully guarded: `__proto__` assignment inert; reading `constructor` on the draft returns undefined; storePath refuses `__proto__`/`constructor`/`prototype` segments; skips unsafe own keys during merges while applying safe siblings; own keys literally named prototype/constructor land as data.**
- CS "ignores prototype pollution keys in draft setters"; SP "storePath prototype pollution guard".

**R31. Derived-store manual writes win over the recompute for the tick: manual setStore beats a queued recompute in the same flush; a SAME-VALUE manual write still holds against the recompute for that tick; next source change reclaims.**
- CS "derived store manual writes" (#2692 ×2).
- **CONFLICT (framing + mechanics):** "keeps the override for the tick" — override layers deleted. Manual-write-precedence-until-next-recompute incl. same-value writes must be reproduced by node/lane precedence; equality-checked signal write would no-op yet the mask must hold.

**R32. A setter-staged replacement followed by reconcile lands the reconciled value — staged writes fold into the diff.** Aligned: O7's resolution (a test already exists).
- SH "setter write followed by reconcile lands the reconciled value".

**R33. Action/async lane semantics on store properties: a write held by an action makes isPending true for that property (per-property, not whole-store) while showing the committed value; applies on settle.** Aligned: the node-lane model's purpose.
- CS "isPending sees a derived store property update held by an action", "…held by async work".

**R34. Optimistic writes visible immediately at write time (before flush), never touch base raw; ambient (non-action) optimistic writes auto-revert at flush end.**
- SH "optimistic shallow store: replacement stages, base rows untouched, children raw".
- **CONFLICT (asymmetry to define):** ordinary writes invisible pre-flush (R24) but optimistic writes visible pre-flush. Read-path table needs a "pre-flush" column.

**R35. Mid-refetch optimistic overlays are consumed when data lands — identical via direct reads, mapArray, wrapper views, Object.keys, snapshot.**
- SIS 5 tests.

**R36. An active optimistic hold on a wrapper view masks inner-store changes for the view's subscribers: mid-hold inner refresh landing causes ZERO re-runs of the view's structural subscribers; the reveal re-runs them with the mid-hold data.**
- SIS "an active override on the wrapper view holds…".
- **CONFLICT:** a lane value on the wrapper's property node must actively SUPPRESS the chained structural notification from the inner store (which R21 says normally propagates). Precedence rule between R21 chaining and lane masking not yet in the doc.

**R37. Setting store state from effect callbacks and promise resolutions works, applying next flush.**
- CS "Setting state from signal", "Select Promise".

## D. Shallow store contract

**R38. Shallow stores: root keys reactive (per-key nodes, membership, length), values served raw by identity at every depth, arrays and objects.**
- SH "root keys are reactive, values are raw", "shallow OBJECT store…", "length changes propagate".

**R39. Shallow setter-scope reads serve raws; in-place mutation of a served raw is reactively inert — records replaced, never edited.**
- SH "setter reads serve raws…", "canonical filter-removal idiom…", "shallow projection…".

**R40. Shallow reconcile is positional: per-index effects only where the reference changed; reference-identical rows skip entirely; length propagates; `key` option moot.** Aligned: unowned-reference skip rule in shallow form.
- SH 4 tests.

**R41. A plain record replaced into a shallow store is STICKY raw-marked: presents raw in this store AND in any deep store that later ingests it.**
- SH "record replacement through the setter works and marks raw"; SPC.
- **CONFLICT (ruling needed):** global sticky marking caused #2932 for proxies. Cross-store stickiness for plain records is an implementation choice pinned as semantics — decide deliberately (O4).

**R42. markRaw values never wrap through ANY store (deep included); leaves for reconcile (reference replacement, no recursion).**
- SH 2 tests.

**R43. Store proxies are exempt from shallow raw treatment: shallow store ingesting another store's proxy passes it through unmarked and serves a live wrapped view (upstream visible, downstream isolated), seed or set-trap.**
- SPC "#2932…" + derived chain tests.

**R44. Ingesting an already-deep-tracked raw into a shallow store throws in dev.**
- SH "ingesting a deep-tracked value into a shallow store throws in dev".
- **CONFLICT (violates R1-unobservability):** the throw fires only because a prior READ lazily registered the child; whether createStore throws depends on materialization timing. Make the check materialization-independent or drop it.

**R45. A shallow store nested in a deep store participates in the parent's reconcile (raw replacement, per-index notify).**
- SH.

**R46. Shallow projections work end-to-end (derive re-runs, output reconciles at boundary, rows stay raw).**
- SH.

## E. Edge cases

**R47. Platform objects (Map, Set, Date, Node instances, subclasses) are structurally non-wrappable: served raw by identity; internal-slot methods work on read and draft paths; draft mutations land on the raw collection (visible, un-notified); only the holding slot tracks.**
- NC "#2952" describe; CS "does not wrap Node instances".
- Note: draft collection mutations ARE raw mutation of a user object — a deliberate carve-out from R6 the ownership WeakSet oracle must exempt.

**R48. User class instances (custom prototypes) DO wrap: prototype getters track; methods on the draft receive the proxy as `this` (reactive writes).**
- CS "wrapped nested class", "not wrapped nested class" (historical name); NC ×2.

**R49. Null-prototype objects wrap and track; function-valued props callable through the proxy.**
- NC; CS "#2771".

**R50. Frozen sources fully supported (read/snapshot; getters returning frozen don't throw).**
- CS "Unwrapping Edge Cases", "supports getters that return frozen objects".
- Note: no test writes INTO a frozen subtree — under CoW that becomes possible (clone unfreezes); open behavioral question.

**R51. Proxy-invariant compliance via target indirection: keys/spread/descriptor reads never throw regardless of source rigidity; source-non-configurable prop readable, writable through the store, reported `configurable: true`; descriptors agree with reads after flush; non-enumerable stays non-enumerable; accessor descriptors preserve get/set identity; write over inherited prop yields own data descriptor.**
- CS "Proxy invariant correctness" (8 tests). Pins target-indirection architecture (kept).

**R52. Symbol-keyed properties first-class: read/write/descriptors/preserved through root replacement + storePath root merge; on arrays symbol writes are metadata (never affect length).**
- CS "#2769" (4 tests) + descriptor test.

**R53. Array key hygiene: non-index string keys never affect length; `s[len] = undefined` grows length AND creates a present key.**
- CS 2 tests.

**R54. Array natives work through the proxy on read (filter/reduce/map/iterate) and draft (push/pop/shift) paths.**

**R55. Functions stored as values served raw, replaceable, slot-tracked.**

## F. Recursive effects / re-entrancy

**R56. Multiple setter calls before one flush coalesce: even a deep-reading (structural clone) effect re-runs exactly once per flush.**
- RE 3 tests (called === 2 after ≥2 writes).

**R57. Effect ordering: parent effects before child effects created inside them, incl. shared deps through memos.**
- RE "runs parent effects before child effects".

**R58. Mid-flush read coherence: untracked store reads inside internal machinery running WITHIN a flush (mapArray keyed:false under a Root owner) must observe the value being written in that flush, not stale committed.**
- MA "#2687", "updates when same-length primitive array items are replaced".
- **CONFLICT (needs precision):** flip side of R24 — before flush reads see old values, during flush reads under any owner context see in-flight values. Read table needs a "mid-flush, un-noded, untracked" row; current fix threads owner context (`_parentComputed`). Combined with R24/R25 this defines when the pending→committed swap becomes readable.

## Tests pinning internals — need a ruling

1. **`$TARGET` as public-ish probe** (CS Unwrapping; SPC) — is-proxy oracle hard-codes the symbol's trap semantics; survives if $TARGET stays.
2. **`markRaw` internal import** (SH, "internal for now") — decide if markRaw is API before porting as semantic rules.
3. **Sticky cross-store raw-marking (R41 second assertion)** — global mutable dispatch state, same class that caused #2932. Contract or accident?
4. **Dev-throw on deep-tracked ingest (R44)** — trigger is lazy-wrap timing; violates R1. Re-specify or drop.
5. **Override-vocabulary tests, portable behavior:** CS "same-value setStore… keeps the override for the tick" (R31); SIS "active override on the wrapper view holds…" (R36); SPC + SH comments naming override layers/STORE_SHALLOW/applyStateChild. Port assertions, rewrite framing.
6. **Core-internal fields in comments** (MA #2687: `_value`/`_pendingValue`/`_parentComputed`) — restate R58 as a read-visibility contract.
7. **Target-indirection pinning** (CS non-configurable test) — forbids ever proxying raw directly. Compatible with kept architecture.
8. **Host-object detection via global `Node` mock** (CS) vs NC's structural tag checks — reconcile into one detection rule.
9. **Suite weakness (absence):** most of storePath asserts only pre-flush batching, not landed addressing results — rule-derived tests should close that gap.

## The three conflicts that matter most

1. **R24/R25 vs "urgent write commits now"** — decides where pending values live and whether observer-less writes materialize nodes; decides the laziness invariant's exact wording.
2. **R36 (lane masking suppresses chained structural notifications) vs R21 (wrapper views chain structural tracking)** — interaction unspecified in the doc.
3. **R31 same-value manual-write precedence on derived stores** — equality-checked core write would no-op; the tick-long mask must hold anyway.
