# Stores: staging as patches owned by holds — brief

Branch `tembo/spike-store-s1` off `tembo/spike-m2-lifecycle` (M1 of the optimism spike: a lane node's value lives in the two slots every held node has; `documentation/plans/optimism-seam-spike-brief.md` §13). Order agreed 2026-11-05: optimism alone (done: H1 yes, H2 no), stores alone, stores and optimism together. This brief is the design for the second and third steps, with the evidence from a first probe.

## 1. What a store write is today

`store/*.ts` is 6,842 lines; `store.ts` 2,905, of which about 1,230 lines (42%) are staging, fold and hold arbitration, and `store/optimistic.ts` is 918, of which about 330 fan a store-level guess out to per-slot lane nodes and gather it back.

One write produces four stagings of the same change:

1. `t.pb` on the target — the pending backing, an overlay (`ovl`, `del`) or a clone of `t.v`, with `wk` the keys written (`ensurePB`, `materializePB`, `overlayOnto`).
2. `k._pendingValue = pb` on the container node (`stageOn`), unless nothing can read the frame through it, in which case the park materializes it (`storePark`).
3. `_pendingValue` on every existing leaf and presence node of a written key, by `setSignal` at the setter's exit (`notifyWrites`, 153 lines), and on a leaf born mid-batch (`bornStaged`); each held by its own transaction (`holdWithDerive`, `holdNode`).
4. An entry in the fold queue, drained at the commit (`drainFolds`, `foldTarget`), which must agree with the scheduler's commit of 2 and 3 — `drainFolds` re-queues a target whose container is still held, and `committed(t)` reconstructs the committed backing from `k._value` while a batch is staged.

The read side chooses among them per read: the `get` trap's hot path serves a known leaf from its own slots (`nodeValue`), which is where the frame decision (held, staged, stale reader, verdict) is made by core's `read` of the leaf; everything else goes through `readSource` (102 lines), which decides between `pb` and `t.v` by `inDraft`/`writeOverride`, a held container's per-key change (`heldKeyChanged`, `changedBetween`, `adoptChild`), a staged read of the pass, and finally `untrack(() => readNode(k))` — the container's frame decision. Two homes per leaf, two deciders.

A derived store (projection) adds a second propagation: leaves are not the derive's dependents, so `wakeFamily`/`settleFamily`/`errorFamily` walk `fam.live` and mark every live node pending/settled by hand (`projection.ts:155-239`).

An optimistic store expresses one guess as N lane nodes: a guess on key `K` is `optimisticWrite(t.n[K])`, presence `t.h[K]`, `length` a leaf, a structural guess a `LaneView` on `t.k`; the engine sees N independent lane values, and the store re-assembles them for reads (`optimisticView`) and re-distributes a landing to them (`_laneRebase`, `pairRows`, `_slotTake`; lanes.ts's `take`/`kept`/`marked` exist for this).

## 2. The shape

**The committed backing `t.v` is the single home.** A leaf is a notifier with equality: a link target for tracking, the value its readers were last notified with, nothing staged on it. The frame a read sees is decided once per target by a node that carries the staging.

**A staging is a patch owned by a hold, carried by one node.** Today's `pb` is already the patch (an overlay of `t.v` with the written keys and `del`); what changes is its owner. A patch node is a slot node per (target, hold) whose `_pendingValue` is that hold's patch and whose `_value` is `t.v`; a flush's own staging is the patch node with no hold, held at the park like any staged node. `t.k` becomes the list of a target's patch nodes (one in the common case). The engine's unit is the node, so the hold model applies to a patch unchanged: a tracked reader of key `K` finds the patch node whose patch has `K` and reads it — `read(p)` serves the patch (the pass joins the hold, D-1) or the committed backing (a frame reader, stale-registered for the landing, D-3) by the rules as they stand — and indexes `[K]`; no patch has `K`, the read is `t.v[K]` and joins nothing. Two holds writing different keys of one object are independent by construction (`continuation-sibling-reader-4146`); two holds writing the same key entangle through the write to the held patch node (A34 (1)), as two writes to one signal do.

**Notification** is at the write: a written key whose value differs from the leaf's last-notified value notifies the leaf's subscribers (`insertSubs`); the commit folds the patch into `t.v` and notifies nothing (the stale readers re-derive through the patch node's `_reruns`). A guess's revert notifies the keys the patch covers whose value changes.

**Per-key verdict and status** come from the patch node: `isPending(() => s.x)` reads the patch node whose patch has `x` (or, for a derived store in flight, the derive's patch node, which the family's flight pends) — `readSource`'s `keyChanged` gate stays, as D-8 per key.

**The derived store** writes through a patch node held by the derive's transaction (`holdWithDerive(target, k)` already does this), and a leaf read that finds the derive's patch node pending throws as a read of the derive would. The family walk stays in S1: its other job is status propagation to the leaves' readers (`propagateStatus` over each live leaf's subscribers), which a patch node cannot do for them while readers link to leaves. It goes when leaf readers become the patch node's dependents (S1b, judged by the store tests).

**Optimism (step 3)** is the same node as a lane node: an optimistic setter's writes are one guess, a patch, on the target's patch node under the action's lane (`optimisticWrite(k, patch)`); `latestOf(k)` is the guessed backing, `screenOf(k)` what the screen shows, `underOf(k)` the truth beneath — M1's three views. A landing on the root re-bases the patch by key (`_laneRebase` becomes the comparator step: apply-then-equal); `laneSet`, `_slotTake`, `take`, `kept`, `marked`, `optimisticView`'s fan-in, `LaneView`'s separate life on `t.k` go. The store keeps the lane engine's four properties (shows now, reveals atomically, parks itself, lands or reverts with its parent) through the one node.

### 2.1 What S1 builds, in order

1. `frameOf(target, key)` — the plain store's one read decider: node-less staging (a staged read of the pass), the per-key gate (a key the patch does not touch is the backing's, joining nothing), a pending patch node (read it: the derive's flight, every key), a verdict window (the probe answered per key, `_witnessMark`; `latest` through the node), the hydration snapshot (the leaf's `_snapshotValue`, as `read` served it), then `readNode(k)`.
2. `setPatch(target, key, value)` — the write: a key a held patch node's patch has joins that hold (A34 (1)) and writes into its patch; otherwise the flush's own patch node, staged and parked like any node; the leaf notified with equality (and the attribution write hook, `attrHooks.write`, which `setSignal` fired).
3. Patch nodes per hold — `t.k` the flush's own, held ones kept beside it; a patch is a diff (own keys and `del`) applied onto the current `t.v` at read and at commit, never an overlay whose prototype goes stale when another patch commits (`overlayOnto` is the commit); `drainFolds` folds each committed patch node.

The probe (§3) did 1 and 2 without the per-key gate's window arms, the join, or 3, and that is what its failures are.

## 3. The probe (2026-11-06)

A mechanical first cut on the branch: for a plain store (not an optimistic family), `notifyWrites` notifies leaves instead of staging them, `bornStaged` only seeds the leaf's last-notified value, and the `get`/`has` traps link the leaf and serve the frame `readSource` chooses, never the leaf's slots (`plainLeaf`, `notifyLeaf` in store.ts; optimistic families untouched). The container node is the only staged node.

Store-using tests, 209 files, 3,283 tests: **37 fail, 3,234 pass** (`next`: all pass). The failures by cause:

- **Per-key hold membership with one `pb` per target** (4146, 3743, 3733, 3712, posture-store-parity S6, visibility-oracle "held by a lane", draft-lifetime): a second hold's write to another key of the same object is held with the first's, because the probe kept one pending backing per target. §2's patch per hold is the answer; the probe shows the rest of the read path survives moving the decision to the container.
- **Per-key verdict and status through the leaf** (createStore "isPending sees a derived property held by an action", latest-isPending-consistency, held-derivation-3612 `latest(() => s.v)`, derived-store-lane-derive, question-scoped-pending marks, derived-store-heal-4451, derived-store-first-landing): `readSource` returns the committed backing for an unchanged key before consulting the container, so a verdict window never sees the container's pending; the family walk marked leaves pending, which the probe no longer reads. §2's rule: a verdict read consults the patch node's status whatever the key's value.
- **Plumbing on the leaf read path** (snapshot: a leaf's `_snapshotValue` for a hydration claim; attribution and observe-exclude: leaf names and causes; createProjection.async "notifies only changed paths": one extra notification through `FORCE`): mechanical, each a small arm on the frame path.

Nothing in the probe needed a new field or hook on a core node.

**Probe 2 (same day): `frameOf` on the probe.** The read decider of §2.1 (1) with its pending, lane and window arms, and the derived store's first-landing arm (a staging while the derive is uninitialized is the only value, A19 exc. 1): 35 fail. Materializing the container node for a verdict window over a node-less staging (so the window asks the node as it asked a leaf born staged) made it 43 — `createLoadingBoundary`, `create-deferred`, `errored-store-probe-settled` and others regress, because a node made at a read joins the hold model mid-flush. The lesson is structural: the staging home has to exist whenever a reader does (the node-less staging and `storePark`'s late materialization go with S1's third piece), not be created by the first read that needs a frame. The verdict failures that remain (`isPending` over a held key, `latest` after a mainline setter mid-hold, a derive over `latest()` under a lane) are each a read of the node where the leaf's slots answered before, and each wants the per-hold patch node to answer for the key.

**Probe 3 (same day): the node made at the first subscription and released with the last leaf, no witness.** The `_witnessMark` shortcut was wrong twice over: the container's comparator already calls any staging a change (`containerEquals`: identity, a pending backing is never equal to the committed one), so `verdictValue(k)` answers "not final" for a changed key by itself, and the shortcut bypassed the quiet-re-ask and sync-derive rules that `verdictValue` applies (createLoadingBoundary, create-deferred, errored-store-probe regressed with it, and recovered without it). With the node made at a leaf's first subscription instead of at a write or a read, and dropped with the last leaf: 46 fail — `posture-store-parity` goes from 5 to 11 and `createStore` from 1 to 2, because the container's existence changes rows of the seat table (`committed(t)` reconstructs the backing from `k._value`, `readSource`'s held arms engage, `drainFolds` defers the fold). The node's existence has semantics today that the design makes the norm; those rows have to be re-derived with it, not met one by one. The branch is left at probe 2 (35).

## 4. Milestones and gates

- **S1 — patch nodes, plain stores.** `t.k` → the patch-node list; `pb`/`wk`/`del`/`ovl` move onto the patch node's staging; leaves as notifiers; `readSource` finds the patch by key; snapshot/attribution arms; the derived store's walk replaced by the patch node's pending. Optimistic families untouched. Gate: the store-using tests (209 files) green; the scalar pins unchanged; size `+ createStore` and `app: hydrating + every store family` not above base.
- **S2 — optimism through the same node.** The optimistic setter's draft becomes the patch of the root's patch node under the action's lane; `_laneRebase` as the comparator; the per-slot fan-out and `take`/`kept`/`marked` deleted. Gate: as S1 plus the optimistic store pins and the 50k × 3 differential (the generator has no store variants yet; the store-variant rows of the executable rulings are the pins).
- **S3 — the engine's store hooks.** `_slotFlight`, `_slotCovered`, `_slotTake`, `_echoes`, `_laneRebase` reduced to the comparator hook and the flight hook; `CONFIG_SLOT_NODE`'s special cases in lanes.ts judged.

**Performance gate.** A target nobody reads stages only the diff and folds; its patch node is made at the first subscription to one of its leaves (never at a write, never mid-flush at a read) and kept while the target has nodes, so a batch creates no nodes it drops at the commit (`stageOn`'s skip was measured: dbmon's tick once made, queued, swept and dropped about 7,000 container nodes). Per batch, S1 queues one node per written target with readers where `next` queues one per written leaf with a node. Gate: the CodSpeed store benchmarks (dbmon's tick) not slower than `next`.

Stop conditions as the spike's: a floor above base after S1; a screen move the rules do not explain; a milestone that needs a new flag or hook on a core node.

## 5. Decisions for the maintainer

None of §2 changes a ruled screen; every behaviour the probe broke is pinned and §2 restores it by construction. One point to confirm because it is a boundary of today's behaviour rather than a rule: a verdict window over a key the patch does not touch, while the same object's other key is held — today `isPending(() => s.untouched)` is `false` (D-8 per key, `readSource`'s `keyChanged` gate), and `isPending(() => s.touched)` is `true`. §2 keeps both. A derived store in flight reports every key pending (the family walk marks all live nodes, `latest-isPending-consistency` "store leaf firewall refetch is reported by isPending"); §2 keeps that through the derive's patch node, which pends with the derive's flight whatever key is asked.

## 6. S1 build, first state (2026-11-06, `tembo/spike-store-s1-build`)

Built as §2.1 (1)–(3) on M1, plain stores only: `kh`, the carriers (`parkPatch` at the park moves the batch's patch from `k` to a slot node the hold holds, with the batch's written keys and deletes on it; `foldPatch` applies a landed carrier's patch onto the backing at the commit; `drainFolds` folds carriers in order), `frameOf` (the own staging for a key this batch wrote, the newest carrier whose patch has the key, the container for a derive's flight or a lane, the backing otherwise; accessor and absent keys read the whole frame, `frameAll`), leaves as notifiers (`notifyLeaf`; a write to a key a held carrier has joins that hold, A34 (1)), the family walk extended to carriers, the container made at the first subscription and released with the last leaf.

Two decisions the build settled against the brief's §2:

- **An adoption's eager swap stays (#4001, `eager-swap-identity`).** A setter's returned replacement, a reconcile and a projection's landing swap the backing at once, and the node holds the committed frame (`committed(t)` reads `k._value`; a carrier is born with the pre-batch backing). "The backing is the single home" holds for trap writes; for adoptions the node's `_value` is the committed frame, as today. A carrier for an adoption has every key written (`WK_ALL`).
- **The container is reader-gated, not write-gated**, and kept while the target has nodes (`releaseSlot` drops it with the last leaf); `storePark` still materializes a node-less staging at the park.

Store-using tests: **143 of 3,283 fail** (`next`: 0). By cause: the chained optimistic view over a plain base, 68, all in `optimistic-list-mutation-matrix` (a stray reorder frame while an action settles — the base's leaf notification reaching the chained view's links at a different moment); adoption under a hold, 16 (`adoption-unchanged-key-read-3706`, `adoption-lazy-child-pairing-3712`); posture and visibility rows, 20 (`posture-store-parity`, `visibility-oracle-store`: the container's existence and the carriers change seat rows); derived stores, 14 (heal-4451, createProjection.async, 3733, 3743, lane-derive, 3612, latest-isPending); projection plumbing, 8; snapshot, 4; attribution and observe, 4; the rest singles.
