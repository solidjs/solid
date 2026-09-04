# Mined rules: optimistic store suites

Source suites: `tests/store/createOptimisticStore.test.ts`, `tests/optimistic-store-refetch-hold.test.ts`, `tests/optimistic-store-layer-scope.test.ts`, `tests/strict-read-pending-store.test.ts`.

## A. Visibility

**R1 — Synchronous universal visibility.** An optimistic write is visible to every reader immediately at write time, before any flush: tracked, untracked, inside the action body, outside any reactive context, and subsequent setter drafts.
- createOptimisticStore — "should update store via setter and revert on flush", "should show optimistic value when read outside reactive context"; refetch-hold draft assertion.

**R2 — Drafts compose on the live optimistic view.** Each setter draft reads through all prior optimistic state (same tick, across ticks, across separate actions/refetches).
- "should allow multiple optimistic updates before flush", "should accumulate rapid successive array pushes"; refetch-hold "#2951: consecutive bare writes stack…".
- CONFLICT: the draft read path must resolve lane view, not raw, including structural array state (length/index nodes + key-set node jointly coherent for the next draft).

**R3 — Per-change notification.** One notification per distinct optimistic value change; sequences like `[0, 1, 2, 0]` are contract.
- "should show each optimistic update during transition", "should track property changes through effects".

**R4 — Equality cut.** An optimistic write equal to current committed value: no notification on write or settle.
- "should not trigger effect if optimistic value matches original".

**R5 — Snapshot/deep read the optimistic view (resolves O1).** snapshot()/deep() agree with every other reader: overlays, nested writes, optimistic deletes (key absent), array mutations; after settle show committed; deep() re-runs on write and revert.
- entire "snapshot and deep see optimistic writes (#2850)" block.
- Note: confirms O1 — snapshot = current view; a committed-only meaning would break these.

**R6 — Snapshot allocates fresh objects while an overlay is live** (not identity-stable across calls); settled returns raw identity.
- "snapshot shows the overlay during a transition…" (`during !== snapshot(state)`).
- CONFLICT (mild): pins allocation behavior; sparse CoW satisfies it, but internals-adjacent (see H2).

**R7 — Propagation through derived graphs** (memo chains, mapArray) like committed values.

**R8 — `latest()` returns the optimistic value** during a pending refetch window.

**R9 — Cross-lane atomic flip.** Regular store written in the same action holds old value while optimistic store shows overlay; at settle both land in ONE notification pass (mixed intermediates never observed).
- "should hold regular store value during transition while showing optimistic".

## B. Rollback / settle

**R10 — Settle reverts to base with one notification** (`[0,1,0]`).

**R11 — Deep-state restoration.** Revert restores complete pre-overlay state at every depth: nested writes, wholesale replacement, array length/indices/order, deletions (value + key membership).

**R12 — Revert target is the CURRENT derived base, not a stale snapshot** (dependency changed mid-overlay → revert to recomputed value).
- "should derive from source signal and revert optimistic writes"; "optimistic write reverts to computed value after async completes".
- Note: why backup snapshots were already wrong; "discard lane, read through to raw" satisfies it IF the projection recompute has adopted into raw by settle time.

**R13 — Base data is not overlay data.** Async-fetched/derived data commits to base and persists; only setter-originated optimistic state discards.

**R14 — No-flicker across the settle/refresh seam.** From action-body return until refresh fetch lands, subscribers never observe the previously-committed value of an overridden property.
- "should not flicker through previously-committed value on second toggle…".
- CONFLICT: lane settle condition must be actions empty AND async reporters empty, jointly — pending async spawned by the transaction keeps the lane alive.

**R15 — Unaffected subscribers do not rerun on another action's settle.**

**R16 — Cycles are independent** (no residue between sequential write/settle cycles).

**R17 — Optimistic writes never pend.** A plain optimistic store is never pending; an optimistic write alone never makes isPending true on any read (shallow, deep(), root or nested proxy, value or length, same- or separate-render probes).

## C. Layer scoping

**R18 — Overlay lifetime is transaction-bound, per key** (never a timer, never a mere flush boundary — under an action).

**R19 — Disjoint-key concurrent actions revert independently** (incl. different rows, deletes) (#2899 ×3).
- Note: per-property nodes give this by construction — strongest validation of the new model.

**R20 — Same-key writes entangle whole transactions:** latest write displays; NOTHING in the merged transaction settles until the last member completes — including keys written by only one of them.
- "#2899: same-key writes entangle…", "should handle 3 rapid toggles…", "rapid same-tick toggles…".
- CONFLICT (high): §7 defers collision to core lanes; this demands transaction-level merge propagation. If core lanes merge per-property only, `s.b` reverts at B's settle and the test breaks. Ruling: is core lane merge transaction-granular?

**R21 — Optimistic delete is per-transaction scoped** (a concurrent action's settle must not resurrect another action's delete).
- CONFLICT: key-set node is one per object — #2899's flat-record problem reappears at the key-set node; its overlay must carry per-transaction granularity for key adds/removes (O2 unspecified).

**R22 — Ambient (transaction-less) writes flash:** visible until end of flush, then revert — without touching in-flight actions' keys.
- CONFLICT: needs an "ambient lane" with flush-end lifetime; combined with R42, ambient-lane lifetime is conditional.

**R23 — Actions scope globally (a transaction, not a store handle):** writes made under action A belong to A regardless of which store; separate stores under separate actions settle independently.

**R24 — Re-override of a still-overridden key notifies and wins;** the earlier action's completion never resurfaces its value.

## D. Structural

**R25 — Array mutation overlays:** push, splice, whole-array replacement, top-level array stores — length, index reads, holes, spread/iteration, .map all coherent mid-pending and restore exactly on revert.

**R26 — Length reactively consistent with contents;** a consumer reading length then indices in one computation never observes a torn state.
- CONFLICT (mild): length on key-set node + elements on index nodes → tearing is the natural failure mode; §6's acceptance criteria.

**R27 — Key enumeration and `has` are lane-reactive** (Object.keys / `in` reflect optimistic adds/deletes, notify, revert).

**R28 — Proxy identity survives truth adoption of optimistic rows:** server data key-matching an optimistically pushed row recycles the proxy (identity preserved) and adopts server values. Single and multiple pushes.
- CONFLICT (high): an optimistic-only row does not exist in raw — key-matching and prev-length require the adoption channel to consult the LANE VIEW (the pinned regression: "reconcile was blind to STORE_OPTIMISTIC_OVERRIDE, prevLength was 0"). Raw-only diff is unsound here.

**R29 — Entity-swap key probes read committed base, not overlay** (an optimistic `s.id = 99` must not confuse the swap); `key: null` → positional identity.
- Note: paired with R28: identity/key probes of incoming-vs-existing entity use committed base; length/row-matching of the previous arrangement must see the overlay. Both needed, explicitly.

## E. Strict-read / pending-read

**R30 — Seed invisibility.** Derived store's seed is a draft, never observable: before first resolution every read — get, `in`, keys, spread — throws NotReadyError untracked. Applies to createStore(fn, seed) and createOptimisticStore(fn, seed).
- CONFLICT (high): with seed-as-initial-raw + raw fallthrough reads, uninitialized state must gate EVERY trap before the §2 raw fallthrough or the seed leaks.

**R31 — Dev strictRead scopes escalate:** uninitialized read in a component body throws the `[PENDING_ASYNC_UNTRACKED_READ]` dev error (exact tag is contract), precedence over plain NotReadyError.

**R32 — Post-init untracked reads flow committed values,** including during a later refetch window.

**R33 — Refetch window keeps the dev safeguard** (committed value untracked; component-body read still dev-throws).

**R34 — isPending probes take the prod path in both builds:** dev safeguard must not fire inside a probe; uninitialized + surrounding context ⇒ NotReadyError propagates out of isPending identically dev/prod; fully untracked with no context, isPending never throws.

**R35 — Plain stores unaffected** (read normally in every context incl. component bodies).

## F. Refetch / pending-verdict

**R36 — Dependency-driven refetch pends the leaf and holds the committed view** until the fetch lands.

**R37 — Optimistic writes are verdict-inert:** a mid-refetch write displays but neither clears nor causes pending; the honest mixed state {value: 999, pending: true} is observable. (Re-ruled 2026-07-13, superseding the A20 mask.)

**R38 — No-op setters are fully inert:** trap-firing no-ops (s => s, s => ({...s}), same-value write, delete of absent prop) mid-refetch display nothing, don't silence pending, don't entangle with the surrounding transaction.
- CONFLICT (mild): "writes always materialize the node" is fine (unobservable), but LANE ENTANGLEMENT must be gated on actual value change — incl. recognizing a returned shallow copy of identical values as a no-op. Equality-cut before any lane linkage forms.

**R39 — Landing truth wins over the override:** fetch resolves → server/computed value displays, override consumed, pending clears — even if written mid-flight.

**R40 — Bare refresh is a quiet re-ask; affects + refresh is a declared reload.** refresh(store) alone never pends reads; affects(store) + refresh pends them, clearing when data lands. Sync-back refresh inside an action is quiet.

**R41 — Streaming continuations are not pending windows.** A generator-based derive (or wrapped createProjection) that yielded once reads settled while awaiting its next chunk, incl. with an override displayed.

**R42 — Bare writes ride an in-flight refetch (#2951).** A transaction-less optimistic write while the store's own truth is in flight does NOT revert at flush end; holds until truth lands. Order-independent within the tick; also for later-tick writes during the same refetch. Optimistic state clears when truth lands or its transaction settles — never on a timer.
- CONFLICT (high): the rule that killed the old firewall/layer split. Must define which lane a bare write joins — attach to / held open by the store's in-flight recompute transition. R22 flash + R42 ride are ONE rule conditioned on in-flight truth; two mechanisms recreates #2951.

**R43 — Refresh-in-action landings preserve still-pending overlays** (same key ⇒ merged transaction: landing does not consume the pending action's optimistic value).

**R44 — Bare-refresh landings consume key-matched overlay content** (optimistic "Optimistic" → server "Saved"); the action's later settle does not revert it.

**R45 — Separate-transition landings clear foreign optimistic rows (#2719):** a different source transition resolving fresh data clears optimistic rows of a still-pending unrelated action immediately; later settle does not resurrect. Returned-value and draft-mutating derive forms.
- CONFLICT (high, jointly with R43/R44): three different answers to "what does landed truth do to a pending action's optimistic state": preserve (refresh inside entangled action), adopt-and-consume per matched row (bare refresh), clear entirely (separate source transition). Needs one lane principle (plausibly: whether the landing occurs inside the overriding lane's transaction or supersedes it). The tightest constraint set in the suite.

**R46 — Refetch persistence across multi-action windows:** overlay survives arbitrary interleaved refresh landings while any overlapping action is pending.

## G. Consolidated CONFLICT index

1. **R20** — transaction-level same-key entanglement vs §7 "defer to core": per-property or per-transaction merge?
2. **R42/R22** — ambient lane lifetime is conditional (flush-end vs ride-the-refetch): one rule or #2951 recurs.
3. **R28** — reconcile must be lane-aware for key-matching/prev-length; pair with R29's committed-side identity probes.
4. **R43/R44/R45** — the landing matrix needs a single principled discriminator.
5. **R21** — key-set node needs per-transaction granularity or #2899 recurs structurally.
6. **R30** — seed-in-raw: uninitialized firewall gates every trap before raw fallthrough.
7. **R14** — lane settle condition = no live actions AND no live async reporters.
8. **R38** — equality-cut before lane linkage ("writes always materialize" must not imply "no-op writes entangle").
9. **R26** — length/index/key-set coherence mid-lane.

## H. Tests pinning internals — need a ruling

1. **"should not flicker…second toggle"** — R14 portable; choreography targets `stashedOptimisticReads`, `_actions`, `_asyncReporters`, `el._value`; microtask counts implementation-timed. Keep R14, re-derive choreography.
2. **`during !== snapshot(state)`** — pins per-call fresh allocation with a live overlay. Sparse CoW satisfies it; a caching rewrite wouldn't. Contract or accident?
3. **layer-scope suite framing** — headers pin STORE_OPTIMISTIC_OVERRIDE/OWNERS/"merge chains". Behaviors portable; R20's entanglement SHAPE may itself be a transition-merge artifact — ruling before porting verbatim.
4. **"preserve array item proxy identity…reconciled"** — regression comment pins reconcile reading the override record; identity rule semantic, mechanism re-derived (Conflict 3).
5. **refetch-hold header** — pins firewall-computed vs store-layer split anatomy; assertions portable, header not.
6. **Microtask-count choreography generally** — rules portable; awaits need re-tuning checked against the rule, not just made green.

Meta-note: test comments cite an existing ruling ledger (A16, A17, A20-superseded, B5a, re-ruled 2026-07-13). Rule-derived `__TEST__` assertions should cross-reference that ledger so verdict-inertness (R37/R38) and isPending-probe rules (R34) don't get re-litigated from stale comments.
