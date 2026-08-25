# Mined rules: optimistic lanes (createOptimistic, undefined-override, lane-transaction-ownership)

Source suites: `tests/createOptimistic.test.ts` (CO), `tests/optimistic-undefined-override.test.ts` (UO), `tests/optimistic-lane-transaction-ownership.test.ts` (LTO).

Scope note: CO contains **no store-form tests** — it is entirely the signal/computed form. Store-form coverage in this set exists only in UO (tests 3–5) and LTO (repro 1). Nested paths, deep writes, and per-property-vs-whole-store optimism beyond those have **no coverage in this set** — a gap the rewrite's rule-derived tests must fill.

## A. createOptimistic contract (signal & computed form)

**R1.** `createOptimistic(value | fn)` returns `[accessor, setter]`; the accessor returns the initial or computed value; the setter accepts a value or an updater function.
- Evidence: CO — "should store and return value on read", "should update signal via update function and revert on flush"

**R2.** An optimistic write is synchronously visible to direct reads before any flush — inside the action body, outside it, and outside any reactive context.
- Evidence: CO — "should update signal via setter and revert on flush", "reading outside reactive context…", "rapid user actions: multiple selections before first resolves"

**R3.** The setter's updater receives the current *visible* (optimistic-if-overridden) value, never the committed value; a plain setter on the underlying source during a transition composes on the transition's *pending* value. The two compose independently.
- Evidence: CO — "should provide current optimistic value in update callback", "should combine pending value with optimistic write when transition completes"

**R4.** Multiple optimistic writes before settle compose sequentially (each updater sees the prior override; last write wins).
- Evidence: CO — "should allow multiple optimistic updates before flush"

**R5.** An optimistic write **outside any action** reverts at the next flush; subscribers observe the optimistic value and then the reverted value within that single flush (effect log `[1, 2, 1]` after one `flush()`).
- Evidence: CO — "should update signal via setter and revert on flush", "independent optimistic writes create separate lanes", "optimistic effect runs before regular effect on same node"
- **CONFLICT:** requires core lanes to support an ephemeral, auto-settling lane for un-actioned writes, with two subscriber runs inside one flush pass.

**R6.** An optimistic write inside an `action` holds for the entire action window and reverts when the action's transition completes; each intermediate write during a multi-yield action is observable in order (`[0,1,2,0]`).
- Evidence: CO — "should show optimistic value during async transition and revert when complete", "should show each optimistic update during transition"

**R7.** Computed-form `createOptimistic(fn)` with no overrides is a transparent passthrough of its (possibly async) source: promise resolutions, re-fired promises, and async-iterable yields all propagate; overrides still revert when the source is async.
- Evidence: CO — "identity pass-through with async source (no override)" describe, "should still revert overrides when source is async"

**R8.** Reset-on-settle targets the source's **newly computed value at settle time**, not the pre-write value: a wrong optimistic guess is auto-corrected to the real result; a correct guess settles silently (see R28).
- Evidence: CO — "optimistic value does not match computed result", "first async resolves first…", "action pattern with mismatch…", "two full cycles with mismatch correction on second cycle"

**R9.** Regular signals written in the same action are held (transition semantics) while optimistic writes display immediately; downstream memos and chained optimistic computeds see optimistic values and revert with them.
- Evidence: CO — "should hold regular signal value during transition while showing optimistic", "should chain optimistic signals correctly", "should propagate optimistic changes through memo chain", "nested optimistic computeds propagate through single lane"

**R10.** `refresh()` of an optimistic accessor inside an action clears the override when the refetch settles; calling `refresh()` while the upstream source is still pending must not throw.
- Evidence: CO — "refreshing an optimistic async accessor clears the override when it settles", "refreshing an optimistic accessor does not throw upstream pending reads (#2694)"

**R11.** Verdict channels: an optimistic override **is the value** on every channel — plain read and `latest()` both return it (including literal `undefined`); the override itself is **verdict-inert** — it never makes its own slot pending, and it cannot silence pending when the source's *question* changed and is in flight (`isPending` reads true through the override).
- Evidence: UO — "1b: verdict channels see the undefined override (latest/isPending)"; CO — "optimistic value matches computed result", "optimistic value does not match computed result", "isPending tracks optimistic node state alongside value effects", "action pattern: setOptimistic -> yield api -> refresh"

**R12.** A bare `refresh()` is a quiet re-ask — never pending; a **declared** reload (`affects(x)` + `refresh(x)` inside an action) pends the slot for the whole reload window, even when the sole consumer is a reactive `isPending`.
- Evidence: CO — "refresh() of an async optimistic accessor is a quiet re-ask — not pending (#2799…)", "a declared reload (affects + refresh) fires isPending when it is the only consumer (#2806…)"

**R13.** During the pending window, a source recompute that reveals a value **different** from the current override corrects the override in place (before the action settles), triggering downstream refetch; a recompute matching the override leaves everything untouched and silent.
- Evidence: CO — "shared async config resolves first: lanes stay separate despite shared dependency", "rapid action: correction should not be blocked…"
- **CONFLICT:** the design's write model is binary (rollback = discard; commit = fold). Correction is a third behavior: source-driven mid-flight replacement of the lane value with cascade invalidation. Needs a defined path in §3.

## B. Lane / transaction ownership

**R14.** Independent optimistic writes to unrelated signals form independent lanes: notifications scoped to each signal's own subscribers; each action's overrides revert when *that* action settles, regardless of other in-flight actions.
- Evidence: CO — "independent optimistic writes create separate lanes", "should show both optimistic updates immediately when two independent actions are triggered rapidly"

**R15.** A shared subscriber reading multiple optimistic sources merges lanes **for scheduling only**; it must not transfer transaction ownership of overrides. Disjoint-key work settles with its owning action even when lanes merged through the shared effect.
- Evidence: LTO — "repro 1: #2899 test-3 shape with B's writes swapped", "repro 2: three actions on plain createOptimistic signals"
- **CONFLICT (critical):** §7 defers collision to core lane semantics. Today this uses node-level owner stamps (`_overrideOwner`) + store-side `STORE_OPTIMISTIC_OWNERS`. Core lanes must natively carry per-node transaction ownership or §7's deference is insufficient.

**R16.** Same-key writes from multiple actions **entangle** those actions: the override (and transitively every override of the entangled actions) reverts only when the **last** entangled action settles.
- Evidence: LTO — "repro 1"; CO — "holds same-value optimistic writes until all overlapping actions settle"
- **CONFLICT:** per-property lane values must support multi-action refcounting/entanglement per key, including transitive spread across all keys those actions wrote.

**R17.** An equal-value write still registers ownership and still performs lane bookkeeping: a second action writing the same value keeps the override alive after the first settles; an override write whose value equals the (corrected) current value must still dirty downstream to invalidate stale in-flight async.
- Evidence: CO — "holds same-value optimistic writes until all overlapping actions settle", "rapid action: unchanged override value should still dirty downstream to invalidate stale _inFlight"
- **CONFLICT:** the core write path must not equality-short-circuit lane registration or downstream invalidation.

**R18.** All optimistic writes in one action share one transaction and revert together atomically; lanes/transactions clean up fully between cycles — the Nth cycle behaves exactly like the first, including after rapid lane reuse.
- Evidence: CO — "should revert multiple optimistic signals together…", "concurrent optimistic writes in same action share a lane", "multiple sequential cycles", "two full cycles - lanes clean up properly…" (×3), "rapid action: correction should not be blocked when lane is reused across actions"

**R19.** A shared **upstream** async resolving must not merge distinct downstream optimistic lanes — independent paths keep updating independently; genuine merge happens only at convergence points (a memo reading both), where the merged node waits for all inputs.
- Evidence: CO — "shared async config resolves first…", "latest() allows independent progressive display for parallel optimistic paths"

**R20.** A later action's override wins over an earlier action's background settle: when action 1's refresh resolves *under* action 2's live override, the visible value is unchanged, downstream must not recompute, and pending must not flicker.
- Evidence: CO — "second action while first still in flight…", "should NOT double-flicker isPending on rapid actions when background resolves"

## C. Undefined / absent-value semantics

**R21.** An optimistic write of literal `undefined` is a full-fledged override: visible on plain read and `latest()`, verdict-inert on `isPending`, and it reverts at settle exactly like any other value.
- Evidence: UO — "1: optimistic undefined is visible during the action window", "1b: verdict channels see the undefined override"
- **CONFLICT (critical, by design intent):** #2898 was `undefined` colliding with the no-override sentinel. Lane slots must use a sentinel distinct from `undefined` (NOT_PENDING-style brand); every surface exposing the lane value must unwrap it.

**R22.** A follow-up optimistic write after an `undefined` override still rides the optimistic path and reverts at settle — `undefined` in the slot must never erase the node's optimistic identity or route later writes to permanent commit.
- Evidence: UO — "2: follow-up write reverts at settle (no permanent commit)"

**R23.** Store form distinguishes "override to undefined" from "delete": optimistic set-to-undefined reads `undefined` with the key still present; optimistic `delete` reads `undefined` **and** `"key" in store === false`; at settle both restore the committed value and key presence.
- Evidence: UO — "4: optimistic store set-to-undefined is visible then reverts", "5: optimistic store delete is visible then reverts"
- **CONFLICT (critical):** a per-property lane *value* cannot express key absence — deletion must live in the key-set node overlay (§6/O2). The `has` trap must consult the key-set lane overlay; rollback must restore property view and key membership atomically.

## D. Settle / replay

**R24.** A transition completes only when **all** reachable asyncs (upstream source and downstream lane asyncs) resolve; held source values must never leak to subscribers before completion, even when the upstream resolved first with a value matching the override.
- Evidence: CO — "transition holds when upstream resolves first…", "only first async resolves, second stays pending"

**R25.** Lane readiness gating: subscribers reached *through a downstream async memo* fire with optimistic values only once that async resolves; direct reads show the override immediately. The lane may flush **before** the upstream source resolves.
- Evidence: CO — "first async resolves first, optimistic value matches computed result", "second async resolves first…", "multiple user actions before any async resolves", "action pattern: setOptimistic -> yield api -> refresh"

**R26.** At settle, the commit of held transition writes and the revert of optimistic overrides are delivered **atomically**: one subscriber run observing both, never a torn intermediate.
- Evidence: CO — "should hold regular signal value during transition while showing optimistic", "should revert multiple optimistic signals together when transition completes"

**R27.** Rapid successive user writes replay correctly: the latest override wins; earlier lane flushes deliver the values current at their readiness time; final settled state reflects the last action's confirmed result.
- Evidence: CO — "rapid user actions: multiple selections before first resolves", "multiple user actions before any async resolves"

## E. Notification granularity

**R28.** No-op settles are silent: if the optimistic write equals the current value, neither the write nor the revert notifies; if the settle-time computed value equals the override, no extra notification fires.
- Evidence: CO — "should not trigger effect if optimistic value matches original", "first async resolves first, optimistic value matches computed result", "two full cycles…"
- **CONFLICT:** lane-fold/discard on the node must equality-check against raw before notifying.

**R29.** Pre-flush writes coalesce: subscribers see only the latest override per flush (`[0, 2, 0]`, never intermediate `1`).
- Evidence: CO — "lane reuses existing lane for same signal"

**R30.** Render-tier and user-tier effects must observe **identical value sequences** at every flush, including the mid-transition moment where an action finished but async reporters are still in flight.
- Evidence: CO — "plain optimistic stays true through refresh-of-unrelated-async (issue #2685)"

**R31.** Optimistic lane notifications run even while an unrelated transition is stashed/pending; pending async in one lane never blocks another lane's write/revert notifications.
- Evidence: CO — "lane effects run even when transition is stashed", "cross-lane reads return committed value during optimistic context"

**R32.** `isPending` granularity: each async path's pending slot clears when its **own** async resolves; merged downstream nodes stay pending — emitting **no intermediate half-state values** — until all inputs resolve; multiple `isPending` consumers must agree at every flush.
- Evidence: CO — "isPending holds until merged lane completes…", "3-optimistic-node checkout…", "checkout: combined style effect…", "multiple isPending effects track independently"

**R33.** No pending flicker when the visible value is unchanged: background refresh phases with an unchanged visible override must not re-pend downstream; a genuinely new in-flight question must fire `isPending` true even on the Nth rapid action.
- Evidence: CO — "no double pending flicker during refresh phase", "should NOT double-flicker isPending…", "isPending effect fires on second rapid action"

**R34.** `latest()` readers opt into progressive per-path display while plain readers of merged memos wait for full resolution.
- Evidence: CO — "latest() allows independent progressive display…", "two full cycles - lanes clean up properly between country changes"

## F. Store-form specifics

**R35.** `createOptimisticStore` returns `[proxy, setter]`; draft-style mutations inside an action are optimistic: immediately visible through the proxy, wholly reverted at settle.
- Evidence: UO — tests 3–5; LTO — "repro 1"

**R36.** Array structural edits (e.g. filter-removal) are visible during the window through `length`, index reads, and iteration, and fully revert at settle.
- Evidence: UO — "3: optimistic store filter-removal reverts at settle"
- **CONFLICT:** rollback must atomically discard all touched index lane values, the length lane value, and the key-set overlay — with mid-lane iteration consistency (O2).

**R37.** Store optimism is per-key: different keys written by different actions settle independently — same ownership rules as signals (R15/R16) at store-key granularity.
- Evidence: LTO — "repro 1"
- **CONFLICT:** current code stamps `STORE_OPTIMISTIC_OWNERS` in the store layer (deleted); per-key ownership must come from core lane values on nodes.

## Tests pinning current internals — need a ruling

1. **LTO "repro 2" carries a live `// FAILS today: x reverts to 1 while C is in flight` comment** (plain `it`, not `it.fails`) — either fixed with stale comment, or the suite is red. Ruling: is R15/R16's signal-form variant shipped behavior or aspirational spec?
2. **UO file header** pins the fix mechanism (`_overrideValue` doubling as brand, `OVERRIDE_UNDEFINED`, NO_SNAPSHOT). Assertions behavioral, survive; header narrative is not contract.
3. **LTO file header** pins `_overrideOwner`, `resolveTransition` preference, `STORE_OPTIMISTIC_OWNERS`. Behavior (R15–R17) is contract; the two-structure mechanism is what the rewrite deletes.
4. **CO "rapid action" Fix 1/Fix 2 tests** encode old-scheduler choreography (`_laneVersion`/`_overrideVersion`, `insertSubs`/`valueChanged` gates). Behaviors (R13, R17) are contract; exact resolve ordering may need re-derivation.
5. **CO "optimistic effect runs before regular effect on same node"** — title claims an ordering never asserted; only pins R5's double-run-in-one-flush. Ruling: is that double notification contract or artifact?
6. **CO stash-mechanism comments** (#2685, `_actions`/`_asyncReporters`) — assertions stand (R30, R31), narration doesn't.
7. **Exact effect-sequence arrays throughout** pin notification counts. Most encode genuine no-flicker contracts (R28–R30); ruling needed on which counts are contract vs incidental.
8. **isPending decree history** — tests cite two partially-superseding rulings (mask 2026-07-07c vs question-scoped 2026-07-13); the "action pattern" test still asserts mask behavior. Confirm the mask-vs-question boundary before porting.

**Biggest tensions, ranked:** (1) per-node transaction ownership + same-key entanglement must move into core lane semantics (R15–R17, R37); (2) optimistic delete/absence needs O2's key-set/tombstone answer (R23/R36); (3) mid-flight correction (R13) is a third lane-value transition missing from §3; (4) `undefined`-safe lane sentinels (R21) and equality-gate exemptions (R17, R28) are small but load-bearing.
