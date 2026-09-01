# Graph-Native Regions — design & evidence (2026-09-01)

**Branch:** `region-delivery` (off `next`). The patch-channel/driver work
remains on `patch-hardening-r6` / `patch-node-delivery-proto` (PR #3091,
draft) as the independent comparison baseline. This branch GUTS the channel
(patch.ts, patch-driver.ts, the compiler-contract exports, the `$ll` insert
seam) and replaces delivery with regions.

## 1. The thesis

Pure fine-grained rendering carries intrinsic overhead: a reactive citizen
(effect node + subscription edges + closures) per dynamic binding. The
theory (Ryan's, long-standing): granularity only needs to reach DECISION
POINTS — conditionals, list structure, component boundaries, places where
DOM *shape* changes. Below a decision point, straight-line DOM writes can be
driven by coarse, data-shaped delivery.

Ten months of patch-channel work vetted the mechanism but built it as a
PARALLEL SCHEDULER (emission rails, dedup stamps, held stashes, version
chains) — every new scheduler behavior needed a hand-written mirror, and
~30 audit findings were that mirror lagging. The structural review's verdict
stands: visibility must be decided ONCE, at the graph.

## 2. The architecture

Three primitives, ~150 added lines, zero scheduler changes:

- **Per-record version node** (`trackRecordVersion`/`regionBind`,
  store.ts): a LAZY signal on the target, written through the normal write
  path at the adoption site (`bumpRecordVersion` after `adoptPB`, eager
  targets). Transitions park it, lanes override it, merges and steals carry
  it — delivery timing is the scheduler's. Creation marks `markDescendants`
  (a version subscription counts like nodes/patches for keyed-pruning §6d).
- **Region effect** (`deliveryEffect`, core/effect.ts): detached,
  owner-less render effect — compute subscribes (one version read per
  record, or `$TRACK` for list structure), commit runs the compiled body:
  raw reads + monomorphic compares against retained prev values. Caller
  owns disposal (`dispose(node)`).
- **Apply-time structural diff** (list regions): the list region subscribes
  to the KEYSET node (bumps only on structural change — value ticks never
  wake it) and its commit diffs the visible row array against retained
  rows: aligned-prefix scan exits steady-state for free; keyed match +
  LIS moves otherwise. NO write-time ops, NO structural queues, NO version
  chains, NO held stashes — the machinery behind four fold audits does not
  exist here.

Grouping precedent: `textContent` already forced sole-text children into
the grouped attribute effect — absorption by positional accident. Regions
generalize it to absorption by PROOF (the rowProof purity analysis becomes
the template partitioner) and add the subscription-side coarsening the
grouped effect never had.

## 3. Evidence (dbmon four-way, 2026-09-01)

Fixtures: `solid-next` (classic, native compiler), `solid-bindings`
(hand-written channel ceiling), `solid-compiled` (patch driver e2e),
`solid-region` (hand-written region shape). Two clean runs; the second on
the day's quietest machine state:

| op           | classic | ceiling | driver | region |
|--------------|---------|---------|--------|--------|
| mount        | 15.9    | 4.5     | 7.2    | 7.1    |
| tick         | 6.0     | 2.1     | 2.2    | **1.8**|
| tick_partial | 1.2     | 0.6     | 0.6    | 0.6    |
| remount      | 9.8     | 4.8     | 4.9    | 4.9    |
| sort         | 2.7     | 2.6     | 2.4    | 2.3    |
| unmount      | 2.5     | 0.3     | 1.7    | 1.7    |

- Region ties or leads the driver on EVERY op, both runs.
- Region tick beats the CEILING: `regionBind`'s bare closures (one signal
  read, raw object, 12 compares) undercut the channel's per-delivery
  dispatch. The ceiling's remaining edge is mount (4.5 vs 7.1): it has NO
  per-row reactive citizen — that gap is the intrinsic price of scheduler-
  native correctness, and the driver pays the same (7.2).
- Unmount medians are GC-placement artifacts (mins 0.1–0.3 across all
  fixtures; prior investigation traced this to incremental-marking write
  barriers, not work).
- Mount golf history: naive prototype 10.3 → `regionBind` (one-time target
  resolution, no options allocation) 8.3 → 7.1 ≈ driver parity.

## 4. Size (the honest ledger)

Gutting + regions, measured against next's budgets:

- Store-app tiers: **230–260 B UNDER** pre-gut budgets (createStore 14.29
  vs 14.55 KB; store-family app 26.48 vs 26.71 KB). The gut made the hook
  seams `const null` — emission branches now provably dead and DCE'd,
  which the installable-`let` pay-for-use design never achieved.
- Non-store tiers: +45/+90/+12 B — prototype exports sharing core chunks.
  GATE before product (subpath or compiler-only entry).
- Deleted outright: patch.ts (670 lines), patch-driver.ts (591), channel
  exports in three packages, the insert seam, channel tests, two size
  scenarios. On the driver branch the same machinery is ~2400 lines of
  patch.ts and ten hardening rounds of audit surface.

## 5. Open rulings (needed before this is a proposal)

1. **Region = consistency/hold unit.** A pending source defers the whole
   region's commit, not one binding (a row goes stale-or-fresh as a unit —
   no torn rows). The channel's per-record delivery already had this
   semantic and the equivalence matrix blessed it; it needs an explicit
   ruling as RENDER semantics.
2. **Version-node release.** `regionBind` nodes live as long as the record
   (the golf dropped the `unobserved` reclaim). Product shape: region
   disposal releases, or unobserved-with-shared-handler.
3. **Getter/accessor fallback.** Records with accessors can't read raw; the
   fallback is tracked reads inside the same region effect (classic
   semantics, per-key) — far simpler than the channel's demotion, but
   unexercised by the prototype. Needs tests + the compile-time/bind-time
   probe decision.
4. **Deep paths.** The prototype bumps per adopted record; regions
   subscribe per record at any depth via the manifest. No ancestor
   bubbling — confirm against nested-template shapes.
5. **Compiler partitioning.** rowProof's purity analysis generalizes to:
   every template section between decision points is a region; proven-text
   holes join it; unproven inserts stay isolated effects. The manifest
   analysis feeds regionBind associations. This is the rc.6-scale work.

## 6. Status

- `region-delivery` pushed: prototype (ef42d094), regionBind golf
  (e043e830), channel gut (5d243eef). Signals 1433 / web 637 / treeshake /
  size gates all green.
- Bench fixtures live in octane-dbmon-local (`solid-region` port 5206);
  probes: `probe-region.mjs`, `probe-sort.mjs`.
- Next: uibench-style structural shapes, the getter fallback tests, ruling
  1 sign-off, then the compiler partitioner design.
