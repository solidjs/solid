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

## 5. Audit response (2026-09-01, external audit of 1c0edc21)

Verdict: "genuinely graph-native; removes the parallel-scheduler problem;
keep exploring." Four P1s, all addressed on this branch:

- **P1-1 delivery coverage:** bumps moved off the reconcile special case
  onto the real choke points — `notifyFold` entry (fold commits, landings,
  adoption marks, entity swaps), both eager walk tails (object + array
  branches notify per-key inline and never reach notifyFold), and
  `notifyWrites` (setter channel; unconditional — a pending backing means
  trap writes happened; value-equal rewrites are no-ops against the body's
  baselines). Covered by the regions.test.ts delivery matrix.
- **P1-2 optimistic visibility:** `createRegion` DECLINES what raw reads
  cannot represent — optimistic families (overrides live on nodes) and
  accessor-bearing records (getters must not run untracked). Declined
  records take the classic tracked path; plain records under transitions
  are sound because the version bump parks as a signal write (the wake IS
  the commit moment). Regression-tested.
- **P1-3 prevRaw:** backed out, twice over. The contract is `commit(raw)`
  ONLY; compiled bodies own scalar baselines per hole. The audit's aliasing
  concern was then CONFIRMED empirically in a second form: the effect
  pipeline's value slot is captured by the PURE-phase compute, but setter
  folds swap the backing at commitPendingNodes — a captured raw is one fold
  stale by construction. The commit closure reads `t.v` at commit time.
- **P1-4 integration:** the runtime half now has its test matrix
  (regions.test.ts: setter/reconcile/projection/replacement delivery,
  transition parking, declines, dispose + owner disposal). The compiler
  half (emitter, hydration claiming, list regions in compiled output)
  remains the rc.6 work, unchanged.

Owner-bound correction adopted: the comments now state what the auditor
observed — region nodes parent under the active owner (boundaries, holds,
disposal compose); rows created inside a list region's commit run
ownerless and are disposed by the list's bookkeeping.

## 6. Audit round 2 + the wider comparison (2026-09-01 night)

Round-2 P1s, all addressed (regions.test.ts: 17):

- **Timing neutrality:** bumps are change-gated — no-op reconciles and
  value-equal rewrites never park version writes under transitions. The
  detection is FUSED into the walk's per-key loop (the dk deep-witness
  compares + a per-key accessor probe behind a vn-existence gate), so
  region-bound adoptions pay no second scan: dbmon tick returned to
  driver parity (2.1) after the naive scan cost 0.4ms.
- **Durable admission:** defineProperty getters demote bound regions
  immediately; getter-bearing adoptions demote at the fused probe.
  Regions carry `onDemote` for the compiled fallback rebind.
- **Helper parity:** regionBind shares createRegion's declines with a
  `trusted` flag for compiler-proven callers (the emitter is the prover;
  the runtime scan is redundant for compiled binds).
- **Owned rows (generation owners):** rows bind under an owner created by
  the list region's mount; boundaries/holds compose, and BULK teardown
  (full replacement, clear, unmount) is ONE owner walk + one DOM clear —
  per-node dispose remains for individual removes. This closed the last
  bench gap: teardown, not creation, was the "region loses runlots/clear"
  cause (cold single clicks always tied; the warm loop paid per-node
  unlink surgery on every replacement's previous generation).

Design rulings from the session:

- **Selection (and view state generally) lives beside the data in the
  SAME STORE — a sibling keyed branch — never ON row records.** Rows read
  it as a dynamic key; dynamic keys are inexpressible in manifests, so
  the read joins the region's COMPUTE as a classic per-key tracked read
  (mixed SUBSCRIPTIONS, one node per row — never a second effect node;
  the two-node shape lost creation benches to classic's grouped effect).
- **The grouping unit is the RECORD, not the store**: a high-fanout
  sibling record (the selection map) must not join row regions' read sets
  (one bump would wake every row). Per-key subscriptions are the precise
  tool exactly there — and the emitter needs no heuristic: dynamic-key
  reads fall out of manifests by construction.

Wider comparison (jfb main + reorder, uibench, dbmon rerun; same-store
selection everywhere): region ties or beats the classic STORE column on
every op (clear flipped to a win with generation owners; runlots within
noise); both store columns trail octane/classic-signals on creation-heavy
ops by the STORE TAX (proxy wrap + walk), which is a pre-existing
frontier independent of delivery. uibench (classic compilation on this
branch): 37.00ms/96 scenarios — anchor only; needs a next-runtime
baseline for regression claims.

## 7. The deep-witness migration + measurement methodology (2026-09-01, late)

A paired uibench run (classic compilation, no regions) exposed the round-2
fused latches regressing CLASSIC store walks ~18% — the change-gate code
had grown the walk's hottest per-key loop, which is inlined-on-purpose per
its own comment. The fix was recognizing that the walk ALREADY maintains a
change-gated per-record version signal: the DEEP WITNESS (`dk`, deep()'s
node) — lazy, unobserved-reclaimed (closing §5's version-node leak note),
bumped by pre-existing compares in the walk loop, the setter tail, and
fold commits. Regions now subscribe `dk` directly; the parallel version-
node machinery (vn, bumpRecordVersion*, regionValuesChanged, the fused
latches) is DELETED. The hot loop is byte-identical to next; regions'
entire classic-path footprint is a registry-gated durable-admission probe
at the adoption tails (one property miss per record).

Verdict after migration: uibench 36.1 vs next 35.5 THROUGH THE SAME BUILD
PATH — parity. The initially alarming "30.1 baseline" came from a separate
checkout whose builds run ~15% faster on this machine (environment, not
code): CROSS-CHECKOUT COMPARISONS ARE INVALID; every number in this doc is
same-path paired.

Fixture/economics findings the same night: teardown, not creation, was the
"region loses runlots/clear" cause — GENERATION OWNERS (rows parent under
an owner created at list mount; bulk replacement/clear/unmount disposes
one subtree; individual removes dispose one node) flipped clear to a
region win and closed dbmon unmount to ceiling parity. Selection rides a
SAME-STORE sibling branch read as a per-key classic subscription fused
into the row region's COMPUTE — one node per row (a second per-row effect
node loses creation to classic's grouped effect; mixed SUBSCRIPTIONS, not
mixed nodes).

## 8. Open rulings (needed before this is a proposal)

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
5. **Compiler hole classification + subscription emission.** The
   PARTITION already exists — template segmentation is decision-point
   partitioning by construction, and the grouped effect already spans all
   attributes across all elements. What remains is two extensions of that
   emitter, not a new template model: (a) proven-text holes join the
   existing group (`text.data` writes in the group body instead of
   `insert()`; rowProof's purity analysis generalized from rows to
   arbitrary holes, plus hydration claiming for absorbed text nodes), and
   (b) store-backed groups emit `regionBind` + version-node subscriptions
   with raw reads, falling back to tracked reads for unproven expressions
   WITHIN the same effect. The manifest analysis already computes the read
   sets. Materially smaller than "partitioner design" — the rc.6 compiler
   work is an emitter evolution.

## 9. The emitter (2026-09-02, v1 shipped)

Compiled output is live behind `regions: true` in the babel plugin. One
call per template scope:

    _$region(subject, (_t$, _u$, _d$) => { ...preamble }, (_n$, _t$, _p$) => { ...body })

- **Classification** (`shared/region.ts`): one CONSTANT subject per scope;
  bindings whose values are static-key member chains of it are ELIGIBLE
  (raw reads in the commit body, scalar baselines in `_p$`); everything
  else is a TRACKED RESIDUAL evaluated in the compute (`_t$` slots), with
  direct depth-1 subject reads inside residuals rewritten onto `_u$` (the
  pending-aware raw — the deep witness already wakes the compute).
- **Deep chains** (`row.queries[0].elapsed`): dk has NO ancestor bubbling,
  so the preamble subscribes one `_d$` path witness per unique intermediate
  prefix (shortest first, `_w$` locals share prefixes). The runtime helper
  resolves through readSource — pure-phase computes run BEFORE
  commitPendingNodes, so `t.v` resolution re-subscribed OUTGOING children
  on every replacement delivery (probe: deep-region.probe.test.ts) — and
  materializes unwrapped children via wrapNext like deepNext's walk.
- **One body, two dispatchers**: the runtime combinator `region()` owns
  admission (own-descriptor scan, ~30% cheaper than the Annex-B lookups),
  durable demotion (deferred to notifyWrites — a fallback rebound MID-WRITE
  subscribes in the draft context and never tracks), registry hygiene
  (amortized dead-entry sweep on push), and the classic fallback, which
  reruns the SAME emitted body with the proxy as `_n$`/`_u$`/`_d$` parent —
  per-key tracked, identical semantics.
- **Packaging**: region routes signals → solid-js → web. Web's rollup only
  externalizes solid-js; a direct signals re-export INLINED a second
  reactive core (two schedulers, two $TARGET symbols — paint worked, no
  update ever delivered; caught by the jfb semantic gate).

Numbers (2026-09-02):

- jfb (keyed, 12 iter): runlots 0.98x vs classic, run mins within 4%,
  update 0.82x, select_lots 0.67x. Mount microbench: keyed 9.1ms/10k vs
  classic 9.0; rowflag 6.1ms (−30%); graph weight 2643 B/row keyed /
  1872 B/row rowflag vs classic 3073.
- dbmon from the UNCHANGED classic App.jsx: mount 32.7→18.9ms, tick
  12.7→6.3ms, tick_partial 2.8→1.2ms, remount 21.2→11.3ms, sort
  7.8→4.7ms. Sort at 0.95x of Octane; tick gap to Octane narrowed from
  5x to 2.5x. All semantic gates green.

## 10. Consolidation (2026-09-02, late)

- **Deep regions bubble on write** (replacing §9's witness preamble, which
  measured 2.3x hand-fixture tick on dbmon): the emitter passes a deep
  flag; `bumpDeep` walks `t.u` and bumps refcounted deep-region roots,
  live-gated by a module counter. ONE dk subscription per region at any
  read depth. Compiled dbmon tick reached hand/driver parity and Octane's
  noise band (2.9 vs 3.1 same-run); mount profiling shows region machinery
  at ~6% of the cycle — the residual gap to Octane is platform floor
  (cloneNode, initial attribute writes, For/proxy, GC).
- **API surface consolidated**: `trackRecordVersion`, `regionBind`,
  `createRegion`, and `deliveryEffect` (prototype-era) are DELETED.
  `region()` is the one public entry — admission, tracked residuals, deep
  flag, durable demotion with classic-fallback rebind (deferred to
  notifyWrites), amortized registry hygiene. Tests rewritten on region():
  declines are BEHAVIORAL now (the fallback must still deliver).
- Size: app scenarios unchanged (prototypes were treeshaken); budgets sit
  within 0.03-0.21 kB of actuals across all eight scenarios.

## 11. The ENVELOPE CONTRACT (2026-09-02, audit response)

The compiler audit's structural verdict — "one interleaved body, two
dispatchers" is unsound — is addressed by splitting the emitted scope:

    _$region(subject,
      (_t$, _u$, _d$) => { ...every user expression, SOURCE ORDER... },
      (_t$, _p$, _f$) => { ...compares + DOM writes ONLY... },
      deep?)

- **Compute (pure phase, both dispatchers):** eligible chains ride `_u$`
  (pending-aware raw) with deeper steps resolved through `_d$` (readSource
  per intermediate record — raw child slots are one fold stale in the pure
  phase); SAFE residuals (no calls/assignments/functions — no shadowing,
  no receiver changes, no raw mutation) get depth-1 subject reads
  rewritten; everything else (and every `prop:` sink) stays unsubstituted
  and tracks through the proxy. No DOM writes can run here.
- **Commit (effect phase, both dispatchers):** compares + writes; `_f$`
  forces the first run (initial `undefined` writes); baselines advance
  AFTER each write (throwing setters can't poison them).
- **Demotion** rebinds under the MOUNTING owner (captured at bind; skipped
  when disposed) and defers its first commit into the flush's effect phase
  via queue enqueue — never synchronously inside the demoting write.
- **Deletions demote**: overlay backings retain deleted keys in raw
  (`t.del` is proxy-only), so no raw envelope can represent them — same
  graceful-downgrade philosophy as accessor acquisition.
- **Admission** also requires a plain prototype (proto accessors would
  execute on raw reads); `@solidjs/web` exports `region` under the server
  condition; the solid server stub renders once with the force flag.
- Audit items NOT closed here: shared-alias deep delivery (single-parent
  `u` chain; deep() handles aliases by walking — bubble cannot reach a
  second parent; DOCUMENTED limitation), and scope-precise constancy
  (program-wide name conservatism stands on both compilers).

dbmon after the redesign (same-run): tick 2.3 vs octane 1.8 (hand-fixture
parity retained), tick_partial 0.7 vs 1.0 (faster), remount 5.7 vs 5.3,
unmount 0.3 vs 1.7; mount 9.5 vs 4.6 remains platform floor. All semantic
gates green; snapshots regenerated; babel/oxc byte-parity across the
corpus, probes, and option matrix.

## 12. Status

- `region-delivery` pushed: prototype (ef42d094), regionBind golf
  (e043e830), channel gut (5d243eef). Signals 1433 / web 637 / treeshake /
  size gates all green.
- Bench fixtures live in octane-dbmon-local (`solid-region` port 5206);
  probes: `probe-region.mjs`, `probe-sort.mjs`.
- Next: uibench-style structural shapes, the getter fallback tests, ruling
  1 sign-off, then the compiler partitioner design.
