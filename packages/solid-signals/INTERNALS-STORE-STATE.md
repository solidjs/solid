# Store Storage Model Rewrite — Semantic Rules & Working Notes

Companion to `INTERNALS-ASYNC-STATE.md`, same method: pin the semantic contract
as rules first, wire the checkable ones as `__TEST__` assertions, then let the
implementation land against them. Nothing below is final until it survives the
existing store/projection/optimistic suites plus rule-derived tests.

Motivating evidence (2026-08-16 baselines, octane dbmon four-way + uibench
profile): store mechanism cost is 3.6x its actual diff cost (wrap/init 97ms +
traps 63ms vs applyState 44ms across the uibench suite); deep-store dbmon tick
is 4x the identical engine in shallow shape (10.3ms vs 2.5ms); teardown cost is
graph size, not walk speed (1.1ms vs 0.3ms with right-sized graph). Harnesses:
`~/Development/octane-dbmon-local` (vs octane/vapor), `~/Development/solid-uibench`
(vs ivi). Targets: octane + ivi (VDOM adversaries), vapor (sibling reference).

Note on what these workloads measure: they are reconcile-only and never
*populate* override layers, yet they pay layer **presence** on every
operation — `getOverlayLayer` per read, layer slots in every target
allocation, override-gated path selection in reconcile, READ_SLOW gating on
the node fast path. The measured tax is empty-layer tax; the layer deletion
targets exactly it. Conversely they validate nothing about the replacement:
node-lane performance under *populated* layers needs its own harness scenario
(optimistic write storm) — correctness rides the optimism/transition suites.

## 1. Storage model (the single-home rule)

Proposed homes for a property value, replacing the current four:

- **Owned raw graph** — the committed truth, always. **Never the user's
  objects**: dropping source-object mutation was an intentional 1.x→2.0 change
  (user complaints; Svelte precedent; Vue still mutates targets and is
  considered broken here). Ownership is copy-on-write: on ingest the store
  shares user objects structurally (zero copies, reads pass through); the
  first write to an object shallow-clones it into store ownership and lands
  there; every later write to it is direct write-through (single home,
  Vue-like cost without source mutation). Steady state: fully privatized,
  zero clones per update. `snapshot`'s documented contract ("original identity
  for subtrees not modified relative to the source") is exactly the ownership
  boundary: unwritten subtrees return source identity, privatized ones return
  the owned objects. Owned raw mutates at exactly one moment: flush commit
  (writes batch like signals — see §3 urgent write; privatization may defer
  to commit).
- **Privatization mechanics (path copying)** — a shared parent cannot be
  mutated to point at an owned child, so privatizing an object privatizes its
  ancestor chain first; the root is privatized eagerly at `createStore` (one
  clone) so chains terminate. Each object privatizes at most once: lifetime
  clone count = number of objects ever written (worst single write = O(depth)
  shallow clones; steady state = zero; traversal of owned raw needs no lookup
  table — it is a real object graph). Privatization is **not a reactive
  event**: no notification, no proxy identity change, no subscriber runs; only
  the internal backing pointer moves (R1 extension: ownership state is as
  unobservable as node existence). The backing pointer is not new machinery:
  the shipped 2.0 proxy already wraps the internal target — not the raw — with
  `STORE_VALUE` as the pointer to backing (`$TARGET` is a free trap answer;
  proxy identity binds to the target, never to raw). Privatization and
  adoption are the same primitive with different sources: repoint
  `STORE_VALUE` behind a stable proxy. Ownership tracking, first cut: a WeakSet of
  store-owned raws — one structure serving both production checks and the
  `__TEST__` no-mutation oracle. Symbol tags on raw are ruled out permanently:
  stamping a symbol *is* a mutation of the passed-in source (visible via
  `getOwnPropertySymbols`, rejected by frozen objects — the 1.x `$PROXY` stamp
  was part of the original complaint class). Cheaper carriers (`target._owned`
  field — every consulting path resolves the target anyway) are recorded as
  optimization candidates, adopted only if post-phase-1 profiling shows
  ownership lookups on hot paths (historical expectation: field/symbol reads
  beat WeakSet identity-hash lookups; verify before spending complexity).
- **Node (lazily materialized, per tracked-or-written property)** — a real core
  signal. Carries: subscriptions, and pending lane values (transition +
  optimistic) via the same core machinery signals already use. No store-side
  override maps, no backup snapshots, no separate transactional subsystem.
- **Key-set node (per object, lazy)** — carries `ownKeys`/`has`/`length`
  overlay during pending structural edits, and key-set subscriptions
  (`trackSelf` successor).

A property with no node has its value in raw and nowhere else. A property with
a node still has its committed value in raw; the node adds subscription + any
in-flight lane values on top.

## 2. Read paths

Every read goes node-first when a node exists, raw otherwise:

| path | committed | during transition lane | during optimistic lane |
|---|---|---|---|
| tracked proxy read | raw (subscribes) | lane value if lane-visible, else raw | optimistic value |
| untracked proxy read | raw | same-lane rules as tracked | optimistic value |
| `snapshot` (non-tracking) | raw identity, zero copy | CoW: copy lane-touched subtrees only — **confirm (O1)** | same as transition |
| `deep` (tracking snapshot) | raw identity + deep subscribe | same CoW as `snapshot` | same |
| internal `$RAW`/`$TARGET` | raw | raw (committed) | raw (committed) |
| `ownKeys` / `has` / iteration | raw keys | key-set node overlay | key-set node overlay |

Rule R1 (load-bearing): **node existence must be unobservable.** For any
program, behavior is identical whether or not a node happens to be
materialized. Laziness is an optimization, never a semantic.

Rule R2 (ruling heuristic — Ryan, 2026-08-17): **signal parity by default.**
A store behavior should be what a signal would do in the same situation
(batching, lane collapse, equality cuts, transition visibility all resolved
this way). Divergence is legitimate only where granularity forces it — a
store is a family of nodes plus a membership dimension signals don't have
(key-sets, structural edits, keyed identity, per-key ownership, store-wide
status enforcement). Every divergence must be identified as such and
documented; "the store does its own thing here" is never the default.

Corollary R2a (Ryan, 2026-08-17): **take no responsibility for mutation
outside reactivity.** Input to a store is immutable by convention, same as
signals; the store defends reactivity's own contract, never the user's
discipline. Spending mechanism to detect or survive external mutation is
where perf is lost. (Applied: reconcile's diff baseline is the *current
view* — signal parity; the identity skip is sound when keyed on the current
backing, because same-reference input plus the immutability convention proves
there is nothing to diff.)

## 3. Write paths (all must stay equivalent)

- **Urgent write** — batches exactly like a core signal write (RUL-1,
  verified against `core.ts` read/write paths 2026-08-16): parks in the
  pending home — the node's `_pendingValue` when a node exists, a transient
  per-target pending record otherwise (no subscriptions; folded into backing
  and discarded at flush commit). Read rule mirrors signals: context-free
  reads see committed backing until flush; reads under an owner context see
  pending; setter drafts and `snapshot` read pending explicitly. Reconcile
  parks as one pending backing-swap per target (not per-property values).
  Privatization/path-copying may defer to flush commit.
- **Transition write** — materializes the node (writes always materialize);
  value parks in the lane slot; raw untouched until the transition commits.
- **Optimistic write** — same as transition write in the optimistic lane;
  rollback = discard lane value; raw was never touched (this replaces
  override+backup entirely).
- **Reconcile / projection merge** — the **immutable-diff adoption channel**
  (per Ryan: "we let reconcile do essentially immutable diffs"). Reconcile
  never merge-writes into backing objects: it adopts `next` as the
  authoritative backing at every proxied level (internal pointer swap — no
  clones, no user-object mutation), value-notifies only where nodes exist, and
  skips whole subtrees by reference equality. Adoption **resets ownership to
  shared**; setter privatizations since the last reconcile fold into the diff
  and their owned clones are discarded. Identity skip rule:
  `incoming === backing && !owned(backing)` — sound because both sides are
  user-supplied immutable objects; an owned backing is definitionally
  setter-diverged and must diff. (Current code encodes the same guard
  structurally: `applyStateFast` is only selected when no overrides exist,
  `applyStateShallow` skips only on `next === previous && !override`, and
  "reconcile makes next the authoritative base" is already the documented
  contract.) Logical identity for consumers is proxy identity, which is
  stable across adoption; raw identity intentionally moves to the incoming
  graph, which is what makes post-reconcile `snapshot` free.
- Commit hook: lane settle folds the winning lane value into raw, then the
  node returns to passthrough (no pending state retained).

## 4. Identity rules

- Proxy identity per logical node is stable for the store's lifetime; the
  backing raw may change identity via exactly two mechanisms (setter
  privatization → owned clone; reconcile adoption → incoming object), both
  unobservable through the proxy.
- Reconcile/projection preserve *logical* identity for key-matched branches
  (same proxy, keyed flows compare proxy identity); reference-equal unowned
  branches additionally keep raw identity (the skip path).
- New objects introduced under a pending lane are wrapped on read like any
  other; on rollback they simply become unreachable.

## 5. Laziness invariants (candidates for `__TEST__` assertions)

- **(high)** No write path ever mutates a user-provided (non-owned) object.
  First cut: the ownership WeakSet serves both the production check and the
  `__TEST__` oracle — assert every raw mutation's target is in the owned set.
- **(high)** No *permanent* node is created by: proxy creation, untracked
  reads, urgent writes with no observers, or reconcile writes to unobserved
  properties. (Observer-less writes may hold a transient per-target pending
  record until flush commit — carries no subscriptions, discarded at fold.)
- **(high)** A node is created by: first tracked read, first has/keys tracking,
  any transition/optimistic write, projection write to an observed property.
- **(high)** After every flush with no active lanes: for every materialized
  node, node's committed view === raw value (single-home coherence).
- **(medium)** Disposal of a store tears down only materialized nodes
  (teardown cost ∝ tracked surface, not data size).
- **(medium)** `snapshot` on settled state (no active lanes touching the
  subtree) returns raw identity — allocates nothing, materializes no nodes.

## 5b. Creation budget (phase-1 fitness)

Creation tax decomposed, with the phase-1 budget per unit:

- **Per store**: zero extras — no projection internals, no firewall unless the
  store *is* a projection (today every `createStore` pays
  `createProjectionInternal`).
- **Per adopted-but-unread object**: zero allocations. Adoption links by
  reference; nothing wraps until read. Creation is O(rendered), not O(data).
- **Per read-through object**: one minimal target (backing pointer + lazy
  slots + flags — no layer slots, no `initStoreFields` ceremony), one proxy,
  one `storeLookup` entry. Slimming, not deferral — fully-rendered workloads
  (uibench/dbmon mount) can only win here, since they read everything.
- **Per tracked binding**: one bare core signal + one graph link. This is the
  fine-grained floor, accepted; the shallow column (2.5ms vs deep 10.3ms,
  same engine) shows ~75% of today's deep cost is mechanism above that floor.
  If post-phase-1 mount gaps vs ivi/octane are floor-dominated, that is the
  trigger for the phase-2 edit-script channel — not more store surgery.

## 5c. Comparison method (shipped vs rewrite)

Side-by-side at three levels; the worktree split makes both dists coexist:

- **Perf**: harnesses gain a `solid-next` fixture (identical app code, deps
  pointed at the worktree build) so every sweep reports shipped vs rewrite in
  one table beside the references (shallow floor, vapor, octane; ivi for
  uibench). Requires moving the dbmon workspace's root pnpm overrides to
  per-fixture `file:` deps (root overrides are global — they'd force one
  checkout for all fixtures). Re-baseline shipped columns whenever the
  harness itself changes; never compare against stale numbers.
  **A/A noise floor (measured 2026-08-17)**: with byte-identical bundles in
  both columns, single sweeps diverge up to ~30% on tick (session-order /
  thermal variance, direction unstable across runs). Treat sub-30%
  single-sweep deltas as noise; real claims need ABBA-interleaved sweeps or
  effect sizes beyond the floor. Baseline: `octane-dbmon-local/baselines/
  2026-08-17-shipped-rebaseline.txt`.
- **Correctness**: old suites run unmodified against the rewrite (hard gate).
  Rule-derived `__TEST__` assertions run against *both* implementations —
  shipped first, to record which rules it already violates (findings-log
  baseline); each violation gets a deliberate ruling (bug being fixed vs rule
  written wrong) before the rewrite is built to satisfy it.
- **Size**: a co-equal goal, not a trailing metric — this effort started as a
  size audit (store ~tripled 1.9→2.0; the growth is the same machinery the
  perf work deletes: override/optimistic layers + merge logic, store-side
  transaction bookkeeping, projection internals in plain `createStore`). The
  esbuild+terser store-subpath measurement runs on **every increment** beside
  the perf columns; size regressions need the same justification as perf
  regressions. What the rewrite adds back (privatization helper + path walk,
  ownership WeakSet, key-set node) must stay small; O3 (`applyStateFast`
  delete-or-keep, large module for 33ms) is a size ruling as much as a perf
  one. **Shipped baseline (2026-08-17, `scripts/store-size.mjs`)**: full
  24.0kb gz / 76.8kb min; core-only (no store) 8.4kb gz; store attribution
  (full − core) **15.5kb gz / 50.0kb min**. `createStore + reconcile` alone
  is 14.5kb gz — and the optimistic entry adds only ~0.6kb more, confirming
  plain stores already pay the projection/optimistic machinery.
  **Transitional checkpoint (2026-08-18, full plain-store parity)**: full
  26.4kb gz / store attribution 18.0kb gz — the build carries BOTH
  implementations + dispatcher glue; the rewrite's own modules (plain stores,
  reconcile, snapshot/deep, interop) are the ~2.5kb gz delta over shipped.
  Perf same checkpoint (15-iter, single sweep, ~30% A/A floor): tick 15.2 vs
  12.1 legacy, mount/remount slightly behind, sort equal — correctness work
  (node-authoritative writes, transitions) spent earlier optimization gains;
  the profile loop resumes post-functionality.
  Target: NOT 1.9 scale — optimism and projections are new capability
  1.9 never had (and 1.9 carried `createMutable`, since deleted). The target
  is 1.9's mechanism cost + the *honest* cost of the new features built on
  core lanes — what gets deleted is duplication (override layers re-creating
  lane machinery, projection internals taxed on every plain store), not
  capability.

## 6. Structural edits — the key-set node (resolves O2, RUL-8)

One lazy **key-set node** per wrapped object; the granularity divergence that
gives stores the membership dimension signals lack (R2). Design:

- **Subscriptions**: `ownKeys` / iteration / `$TRACK` subscribe to the
  key-set node. `in`/`has` stays per-key (presence-sensitive subscription on
  the property node) — R13's contract.
- **Lane-scoped membership edits**: a transaction's adds and deletes park as
  overlay entries on the key-set node — add: key → present; delete: key →
  tombstone sentinel — each stamped with its owning transaction (per-
  transaction granularity; FINDING-2 is the motivating bug: shipped reverts
  optimistic deletes but leaks optimistic adds). Commit folds the winning
  edits into backing (real add/delete on owned raw); rollback discards
  exactly the rolling transaction's edits. Backing keys never mutate mid-lane.
- **Length is a view, not a node**: for arrays, `length` derives from the
  key-set node's state (committed keys + visible lane overlay). One node
  holds membership and length, index nodes hold values — tear-free iteration
  by construction (opt R26): a consumer reading `length` then indices within
  one computation resolves both against the same overlay state.
- **Visibility**: the key-set overlay obeys the same lane-visibility rules as
  value nodes (§2 read table) — mid-lane iteration in the writing lane sees
  the overlay; other lanes and committed readers see backing keys.
- **Resize notification matrix** (recon-snap R12) is the acceptance suite:
  shrink notifies removed tracked indices with `undefined` and flips `in`;
  growth notifies appearing indices; trailing removal notifies `$TRACK`;
  membership sync is key-based, never length-range-based (R13's `"1e3"`).

## 6b. Lane-aware adoption (RUL-5)

Adoption inside a lane is lane-scoped end to end:

- The backing swap parks as a **lane backing** on the target (pending swap
  per lane), committed only when the lane's transaction settles to top.
  Rollback discards the lane backing, the lane's key-set edits, and the
  lane's node values together — restoring prior backing AND prior ownership
  state (the passing half of `adoption-lane-rollback.test.ts` pins this).
- **Diff baselines during in-lane reconcile** (opt R28/R29, both required):
  *previous-arrangement* reads — prev length, key matching, including rows
  that exist only optimistically — consult the **lane view**; *entity
  identity* probes (root key-mismatch checks against incoming data) read
  **committed base**. A raw-only diff is unsound against optimistic rows
  (the #2864/#2899-adjacent regression class).
- Divergence note (R2): signals carry one lane value per node; a store's
  lane view composes per-node lane values + key-set lane edits + the lane
  backing. The composition rule is this section; everything else is §2.

## 6c. Store-wide status gating (RUL-7)

Derived-store status (UNINITIALIZED / ERRORED) is **one field on the root
target**, checked before backing fallthrough in *every* trap — get, has,
ownKeys, descriptors, spread paths. Uninitialized → NotReady (prod) or the
`[PENDING_ASYNC_UNTRACKED_READ]` dev escalation per the strict-read matrix
(opt R30–R34, including the isPending-probe prod-path rule); errored → the
derive's error for all readers, tracked or not. R2 hybrid: parity in meaning
(a signal's status), divergent in enforcement surface (a signal throws from
one read path; a store must gate its whole trap table or the seed leaks
through enumeration). Plain stores carry no status — one undefined-check
branch.

## 6d. Diff reachability (RUL-11)

Port of the `STORE_DESC` mechanism: materializing a node (or key-set node)
on a target sets a sticky descendants flag up the parent-target chain.
Adoption descends into a changed child pair only where a target with the
flag (or nodes) exists below — never-subscribed subtrees are pruned wholesale
(recon-snap R17), while a subscriber several untracked levels down keeps its
ancestors walkable (recon-snap R16). Reference-equal unowned pairs skip
before reachability is even consulted (§3). The flag is monotone (sticky)
exactly as shipped — clearing it buys nothing measurable and risks pruning a
live path.

## 7. Projections & optimism layering

- Projection = computed store: recompute merges output into its raw via §3
  rules; its writes ride whatever lane the recompute runs in, so projections
  remain optimism-compatible by construction (createOptimistic's store form
  keeps building on projection internals).
- Lane collision on the same property defers to core lane semantics — no
  store-specific collision rules. Deep writes to distinct properties in
  different lanes are independent by construction (per-property nodes).

## 7b. Chained backing (cross-store) — spec

The third backing variant (RUL-6 spec work; shipped contract #2941/#2864).
A target's backing pointer may aim at **another store's proxy** instead of a
raw object. Mechanics:

- **Read-through**: reads on the outer target resolve through the inner proxy,
  firing the inner store's traps in the outer reader's tracking context —
  so subscriptions land on the *inner* nodes naturally. This is the entire
  "live chaining" mechanism: no re-derive, no notification forwarding, no
  bridge machinery. Updates flow because consumers are literally subscribed
  to the source (proj R17, R18, R20).
- **Structural chaining** (#2864, core R21): outer `ownKeys`/`$TRACK` reads
  likewise read through to the inner key-set node — chaining is the same
  read-through rule, not a special case.
- **Lane masking = shadow + dynamic dependencies** (core R36 zero-churn): a
  lane value on an outer property node shadows read-through. Subscribers
  re-run once on the hold write, rebuild dependencies against the lane value
  (no longer reaching inner nodes), and therefore receive *zero*
  notifications from mid-hold inner changes. The reveal re-runs them and
  re-subscribes through the chain. No suppression mechanism exists — the
  mask falls out of standard fine-grained dependency rebuilding.
- **Severing** (proj R19): a derive switching its return is an adoption-
  channel backing swap; subscribers re-read, re-subscribe to the new backing,
  and the old chain drops via dependency rebuild. The displaced backing's
  `storeLookup` registration is superseded at swap (proj R10 — proxy keeps
  its backing; the *raw→proxy* entry moves).
- **Snapshot through a chain** unwraps backing pointers to the base raw.
  Snapshot identity rule (resolves proj R22 + recon-snap R24/R25 jointly):
  **source identity for unowned subtrees; cached copy for owned subtrees**
  (copy created on first snapshot after the last write, reused until the
  next write). Never-written stores stay zero-copy; owned subtrees are by
  definition "modified relative to source," so the documented CoW contract
  already mandates copies for exactly them — and copying is what makes the
  chained-projection snapshot detached from future in-place owned-raw writes.
- **Cross-store ownership**: an owned object belongs to exactly one store
  family; the identity-skip guard (`incoming === backing && !owned(backing)`)
  consults the owning family. Raw→proxy dedupe is keyed by *current* backing
  registration — privatization and adoption move the registration, resolving
  core R2's divergent-backing question: dedupe follows the registration, not
  stale raw identity.

## 8. Assumptions / open questions

- **O1**: `snapshot` during pending lanes — today it reads the current view
  through the proxy (optimistic values included) with CoW identity
  preservation. Proposal: keep that observable behavior; raw-as-truth makes it
  free when settled and sparse (lane-touched subtrees only) when pending.
  Confirm no consumer depends on snapshot meaning *committed* state
  (persistence use cases might want a committed variant — decide if that's a
  new API or out of scope).
- **O2 (RESOLVED 2026-08-17)**: key-set node spec in §6 — per-transaction
  membership overlay, tombstone deletes, length as derived view.
- **O3**: does `applyStateFast` survive phase 1? Re-measure after lazy
  creation; expectation: delete (33ms measured benefit pre-laziness, large
  module weight).
- **O4 (reframed 2026-08-18, Ryan)**: shallow exists ONLY for performance —
  "if I could retire it I would." Shallow is therefore NOT a port target: it
  routes to the legacy implementation via the dispatcher indefinitely, and
  the shallow column in the dbmon harness is the **retirement bar** — if
  deep-next's tick closes on it, shallow gets deleted (API, implementation,
  tests, size share) instead of ported. Interop (legacy shallow nested in
  next deep stores, sticky raw-marking, cross-implementation dedupe) is done
  and is the full extent of shallow investment.
- **O5**: symbol keys, class instances, frozen objects — enumerate current
  suite coverage, port as rules.
- **O6**: node committed-value storage — if nodes are literal core signals,
  does the signal `_value` slot mirror the committed value (re-creating a
  second home + the §5 coherence obligation), or do store nodes read through
  to raw for committed state, using the slot only for lane values?
  Single-home purism says read-through: the coherence invariant then holds by
  construction instead of by assertion. Decide whether core signal internals
  permit a read-through variant without forking the hot read path.
- **O8**: un-noded child reads. With lazy nodes, an untracked read of a
  wrappable child re-enters `wrap()` and pays a `storeLookup` WeakMap hit
  every time (tracked reads cache in the node). 2.0 already accepted this
  trade when it dropped 1.x's `$PROXY` source stamp (verified: `wrap()`
  resolves raws via `storeLookup.get`; `$TARGET`/`$PROXY` are trap answers
  only; nothing is ever stamped). If post-phase-1 profiles show this path,
  the candidate is a per-target child-wrapper slot (node-lite: cached wrapper
  without subscription) — never a return to source stamping.
- **O7 (RESOLVED 2026-08-16)**: reconcile identity fast-path under CoW
  ownership. Resolved by the two-channel model (§3): reconcile is the
  immutable-diff adoption channel; skip iff
  `incoming === backing && !owned(backing)`. Owned backing means
  setter-diverged since last reconcile → must diff; adoption resets ownership
  so the fast-path is restored every reconcile. Verified against current code:
  the override-gated selection of `applyStateFast` / the
  `next === previous && !override` guard in `applyStateShallow` are the same
  rule expressed structurally. Port as `__TEST__` rule: a reconcile that
  re-sends the prior reference after an intervening setter write must still
  restore the incoming values (no unsound skip). **Update 2026-08-17: rule
  test written (`reconcile-resend-identity.test.ts`) and run against shipped —
  the nested path FAILS (FINDING-1, rules-mining/FINDINGS.md): committed node
  divergence is invisible to `applyStateFast`'s identity return, confirming
  the suspicion recorded here. Root and derived paths pass. The ownership
  guard fixes it by construction.**

## 8b. Suite-mined rules (2026-08-16) — index & rulings needed

Five parallel mining passes over the 23 store-related suites (~17k lines)
extracted **217 deduplicated observable rules**. Full catalogs with per-rule
evidence live in `rules-mining/`: `core-store.md` (58), `reconcile-snapshot.md`
(40), `projections.md` (36), `optimistic-store.md` (46), `optimistic-lanes.md`
(37). Most rules are compatible with (or actively validated by) this design;
below are only the cross-cutting conflicts requiring a ruling before
implementation, deduplicated across reports.

### Confirmations (design validated by the suites)

- **O1 RESOLVED**: `snapshot`/`deep` = current view, lane values included
  (opt-store R5, recon-snap R26). A committed-only snapshot would break #2850.
- **O7's trigger test already exists** (core R32: setter-staged write +
  reconcile lands the reconciled value); the re-send variant still needs adding.
- Per-property lane independence (#2899 disjoint keys) is the strongest
  validation of nodes-as-lane-carriers (opt-store R19).
- Shallow reconcile's reference-skip (core R40) is the adoption channel's
  skip rule already shipping in shallow form.
- Target indirection is pinned by the proxy-invariant suite (core R51) —
  proxying raw directly is permanently off the table.

### Rulings needed (cross-cutting, deduplicated)

- **RUL-1 — RESOLVED (2026-08-16, verified per "mirror signals if verified" —
  adopted; flag to reopen).** Core
  signals already implement exactly the pinned matrix: writes park in
  `_pendingValue`; context-free reads see `_value` until flush; owner-context
  reads see pending (`core.ts` read fast paths); flush folds. Store adopts
  the same rule: node → `_pendingValue`; no node → transient per-target
  pending record; reconcile → one pending backing swap per target; drafts and
  `snapshot` read pending explicitly; optimistic lane values are the
  visible-immediately exception (per lane semantics). §1/§3/§5 updated.
- **RUL-2 — RULED (Ryan, 2026-08-17): no landing matrix. Two orthogonal
  rules, both pre-existing.** (1) **Lane collapse governs visibility** — pure
  signal semantics: a completing action folds its committed state into its
  parent transition (`_pendingValue` holds, INV-5/INV-7 machinery); entangled
  actions share a merged parent, so a member's landing is invisible until the
  last member completes. (2) **Visible landed truth always replaces
  optimism**, propagation gated only by the signal equality cut. All three
  pinned behaviors derive with no store-specific logic: rapid-toggle "stays
  false" = rule 1 (the landing never became visible — not a preserve rule);
  bare-refresh recycle = rule 2 (no pending transition owns the re-ask →
  collapses to top → visible → adopts, identity recycled); #2719 clear =
  rule 2 (disjoint keys → never entangled → independent transition completes
  → visible → replaces the foreign optimistic row). **No shipped test
  expectations change.** The store rewrite implements zero landing logic;
  it inherits collapse from core lanes and adds only "visible landing
  replaces lane values, equality-gated."
- **RUL-3 — RESOLVED (verified 2026-08-16).** Ownership already lives
  per-node in core (`_overrideOwner` in `core/types.ts`, `lanes.ts`,
  `core/optimistic.ts`); the store-side `STORE_OPTIMISTIC_OWNERS` map exists
  only because store properties aren't real signals today. Nodes-as-core-
  signals deletes the duplicate with no semantic work. Remainder: the key-set
  node must carry the same per-transaction ownership for structural edits —
  folded into RUL-8/O2.
- **RUL-4 — RESOLVED (2026-08-17, signal parity — verified empirically).**
  New test `optimistic-signal-refetch-hold.test.ts` proves the signal form
  already holds bare writes through an in-flight refetch and flashes with
  settled truth (2/2 passing) — #2951 was the store failing to reproduce
  signal behavior, not a distinct semantic. One rule: *an ephemeral
  optimistic lane collapses into the transition owning the node's in-flight
  question; no in-flight question → completes at flush (flash).* R2
  granularity bridge, documented: a store property's "question" lives on the
  derive's firewall computed, not the written node — the ephemeral lane must
  consult it (settle = actions empty AND async reporters empty, per opt R14).
  Still open from this item: the un-actioned double-notify shape
  (`[v, opt, v]` in one flush, lanes R5) — contract or artifact (folded into
  RUL-12).
- **RUL-5 — SPEC'D (2026-08-17): §6b.** Lane backing + lane-view/committed-
  base diff baselines + joint rollback. Test evidence:
  `adoption-lane-rollback.test.ts` (values/length/captures revert on shipped;
  key-addition leak is FINDING-2).
- **RUL-6 — reclassified: SPEC WORK, not a ruling.** Live chaining (#2941 —
  derive returns a store, updates flow with no re-derive) is shipped, tested
  contract; nothing to decide unless the contract changes. Owed: a §7b spec
  for the third backing variant (target's backing pointer aimed at another
  store's proxy, subscription bridging) plus its interaction rules — active
  lane hold on the wrapper masks the chain (#2864, core R36 vs R21
  precedence); chained-projection snapshot detaches (proj R22); cross-store
  ownership/dedupe (recon-snap R25, core R2); displaced-raw unregistration
  (proj R10).
- **RUL-7 — SPEC'D (2026-08-17): §6c.** One status field on the root target,
  checked in every trap before backing fallthrough; strict-read matrix
  preserved.
- **RUL-8 — SPEC'D (2026-08-17): §6 rewrite, resolves O2.** Per-transaction
  membership overlay with tombstones; length as a derived view of the key-set
  node (tear-free by construction); FINDING-2 is the motivating shipped bug.
- **RUL-9 — RESOLVED (2026-08-17, parity by construction).** Every piece of
  mid-flight-correction evidence (lanes R13) is signal-form — it is already
  core lane behavior, not a store transition to enumerate. Nodes-as-core-
  signals inherit it; §3 references lane-value transitions as core-provided
  (commit / rollback / correction) rather than defining them store-side.
- **RUL-10 — The equality trio.** One precise rule needed spanning: no-op
  writes must not entangle lanes (opt R38); equal-value action writes must
  still register ownership and dirty downstream (lanes R17); same-value
  manual writes on derived stores must mask the recompute for the tick (core
  R31) despite equality-checked core signals.
- **RUL-11 — SPEC'D (2026-08-17): §6d.** Sticky descendants flag ported from
  `STORE_DESC`; reference-skip precedes reachability; monotone by design.
- **RUL-12 — Smaller rulings, each with a proposed default** (proceeding on
  the proposals unless overruled; the four marked ⚑ genuinely change or add
  observable behavior and warrant Ryan's eyes):
  - *Multi-parent (DAG) privatization* (recon-snap R37) — proposal: keep
    today's per-object registration-resolved traversal in snapshot/diff
    (already `value[$TARGET] || lookupTarget(value)`), so shared children
    resolve to their owned backing through any parent; no new mechanism.
  - *Snapshot-capture for node-less writes* (recon-snap R31) — proposal:
    capture-window writes materialize the node and use the signal
    `_snapshotValue` path (pure parity; R1 keeps it unobservable).
  - *Sticky cross-store raw-marking* (core R41) — **RULED KEEP
    (2026-08-17)**: stickiness is one half of a single invariant — *an object
    is never both deep-wrapped and raw*. Shallow-first order: the record
    stays a leaf everywhere (no second truth can form). Deep-first order: the
    R44 dev-throw refuses the shallow ingest. Dropping stickiness would allow
    a deep store to privatize its view of a record while the shallow store
    keeps serving the stale source by identity — one entity, two truths.
    Reconcile mechanics would survive; entity coherence would not.
  - *Dev-throw on deep-tracked ingest* (core R44) — keep as the deep-first
    half of the never-both-wrapped-and-raw invariant; best-effort dev
    *diagnostic*, documented as materialization-dependent (R1 governs
    semantics, not dev-error coverage).
  - *Unkeyed nested-object replace-vs-merge in async yields* (proj pin 1) —
    **RULED MERGE (2026-08-17)**: consistent with reconcile/positional
    semantics; the yield-path replace was an accident. Rewrite the two async
    identity assertions at port time.
  - *Throwing-reconcile atomicity* (recon-snap pin 6) — proposal: key
    mismatch is a root precondition checked before any mutation → failed
    reconcile is atomic by construction; assert it.
  - *Snapshot identity mid-overlay* (opt pin 2) — proposal: fresh copy per
    call during pending windows (matches the pinned `not.toBe`), cached copy
    when settled (§7b rule).
  - *Writes into frozen subtrees under CoW* — **RULED ALLOW (2026-08-17)**:
    the clone is unfrozen and the frozen source is never mutated (freezing
    protects *their* object, which we honor). New capability, documented.
  - *Platform-object draft mutations* (core R47) — already deliberate;
    encode as an exemption in the `__TEST__` no-mutation oracle.
  - *Host-object detection* (core pin 8) — proposal: structural tag check
    (NC's mechanism) is the rule; the global-`Node`-mock test retires.
  - *`markRaw` API status* (core pin 2) — **RULED KEEP INTERNAL
    (2026-08-17)**: no demonstrated public need (nesting-shallow-in-deep is
    handled by stickiness without API; platform objects are auto-raw); was
    previously proposed public and rejected. Revisit only on post-rewrite
    evidence of demand.
  - *Un-actioned double-notify `[v, opt, v]`* (lanes R5, from RUL-4) —
    resolved by R2 parity: it is pinned signal behavior; keep.
- **RUL-13 — RESOLVED (verified 2026-08-16)**: `optimistic-lane-transaction-
  ownership` passes against shipped (2/2) — the "FAILS today" comment is
  stale. R15/R16 per-node ownership + entanglement is shipped behavior and
  therefore hard contract for RUL-3. Delete the stale comment when porting.

## 9. Decision log

- **2026-08-16**: Nodes are real core signals; transactions/optimism ride core
  lanes (no store-side transactional subsystem). Raw is committed truth; raw
  mutates only at commit. Laziness is unobservable (R1). Edit-script channel
  (reconcile → mapArray → insert) deferred to phase 2, gated on post-phase-1
  re-baseline; dom-expressions untouched in phase 1. Fitness: dbmon deep column
  converging toward shallow column; uibench tree/render toward ivi.
- **2026-08-16b**: Source-object mutation stays prohibited (intentional 1.x→2.0
  decision, user complaints, Svelte precedent). Single-home is achieved via
  CoW ownership (owned raw graph, privatize-on-first-write), not by writing to
  user objects. External mutation of a still-shared source object remains
  visible-without-notification — now a defined ownership boundary rather than
  an accident; document as such.
- **2026-08-16c**: Two-channel write model. Setters = CoW channel (privatize,
  path-copy, mutate owned). Reconcile = adoption channel (immutable diff, swap
  backing to `next`, reset ownership, no clones) — confirmed as the intended
  semantic ("essentially immutable diffs"). Bridge: identity skip only on
  unowned backing. This supersedes the earlier §3 draft where reconcile
  merge-wrote into owned raw (that variant would have privatized everything
  and killed the reference fast-path, making partial ticks O(data)).
- **2026-08-16d**: Mechanism purity first. Resolution is **proxy-target
  indirection**, the shipped 2.0 pattern: the Proxy wraps the internal target
  (whose `STORE_VALUE` points at backing raw), `$TARGET` is a trap answer,
  child wrappers are reached structurally through parent node state — nothing
  is ever stamped on user objects (1.x stamped `$PROXY` via `defineProperty`;
  2.0 dropped it). The raw→target direction always goes through the
  `storeLookup` WeakMap: `wrap()` dedupe, reconcile resolving
  externally-handed raws, adoption registering `next` for re-send resolution,
  store families (see O8 for the un-noded repeated-read consequence). Ownership = WeakSet in the first cut;
  field/symbol carriers are optimization candidates gated on post-phase-1
  profiles. Rationale: symbol stamping mutates the source (the complaint class
  behind 2026-08-16b), and carrier micro-optimization before the architecture
  is measured is complexity spent blind.
- **2026-08-18a**: Projection port COMPLETE — next-native `createProjection`
  is the default build; all projection suites green on both configs (58/58
  gate, 91/91 default files). Three mechanisms closed the last nine failures:
  (1) the §6c firewall gate must *link* tracked readers when throwing NotReady
  (settle wakes them; the dependency drops on the post-settle re-run via
  dynamic deps, so proj R12 isolation holds) — one line cleared the whole
  isPending/transition cluster; (2) write scope is per-store, extended through
  draft reads (legacy `Writing` semantics ported: reading another store's
  proxy through a draft admits it for writes; reads of *dependency* stores
  inside a derive track normally — chained projections require this); (3) the
  parent-slot fix on fold is compare-and-swap (only replace a slot still
  holding the folded-away backing) — stale wrap-time indices after draft
  splices otherwise resurrect removed rows; registration-based resolution
  (the DAG rule) covers the slots CAS declines. Also executed the RUL-12
  unkeyed-merge ruling: the two async yield-identity assertions rewritten to
  merge semantics (identity preserved) with ruling citations.
- **2026-08-18h**: INITIAL SIZE AUDIT (post-functionality) — the size thesis
  confirmed. Method: next-only entries bypassing dispatchers, plus a FLOOR
  variant with legacy modules stubbed (honest approximations kept for
  machinery that survives deletion, e.g. isWrappable; no-ops for what
  deletion removes). Numbers (gzip):
  - dual build today: full 29.0kb, store attribution 20.5kb (carrying both
    implementations + dispatchers; shipped baseline was 24.0 / 15.5).
  - next-only as-is (no dispatchers): 19.5kb — interop imports drag nearly
    all of legacy in (legacyReconcile, createWriteTraps, legacy optimistic
    hooks, legacy store.ts). The gap to the floor IS the deletion worklist.
  - **next-only FLOOR, all features (plain+derived stores, reconcile,
    snapshot/deep, projections, optimistic): 12.8kb full ⇒ ~4.4kb store
    attribution — 3.5x smaller than shipped's 15.5kb.** Plain store +
    reconcile floor: ~2.6kb attribution.
  - Honest adjustments to the floor: createWriteTraps must move into next
    (~0.3kb), affects wiring survives (treeshaken when unused), and the
    public API glue (setter overloads, derived-form dispatch) adds a little
    — realistic post-deletion attribution ≈ 5-6kb gz, i.e. roughly the 1.9
    store's size WITH projections and optimistic stores, which 1.9 never
    had. The original audit goal (store ~tripled 1.9→2.0) is answered: the
    rewrite un-triples it while keeping the new capabilities.
  - Deletion prerequisites surfaced by the audit: port the DERIVED
    createStore form (fn+seed — routes to legacy today; small, reuses
    createProjectionNextInternal), move createWriteTraps into next, then
    delete legacy store/reconcile/projection/optimistic modules + dispatch.
    Shallow (O4) stays routed to legacy pending the retirement ruling.
- **2026-08-18g**: dbmon decomposition — the remaining gap is ONE structural
  item. Interleaved ABBA (200-tick rounds): next/legacy ratio stable at
  ~1.3x (13.3–15.3 vs 9.6–11.7; both columns drift with thermals, the ratio
  doesn't). Legacy profile: applyStateFast 874ms/300t — diff + notify FUSED
  in one pass. Next: applyAdopt 854ms (parity with legacy's walk!) + a
  SECOND full diff in notifyFold 670ms — the adoption channel re-walks node
  keys re-fetching old/new values the descent just visited. Read-path cuts
  landed (cached `ch` chained flag — no per-read symbol probe on backings;
  single node lookup threaded into serveDataKey; interned-string pollution
  guard; fam-first gate ordering) — worth only ~3%; get-trap delta vs
  legacy (498 vs 261ms) is mostly the second diff's re-reads attributed
  into the trap. NEXT STEP (scoped, single item): fuse fold notification
  into the adoption walk — during applyAdopt's key iteration, notify the
  key's node inline (value compare + setSignal) and reduce notifyFold to
  deletions, has-nodes, and key-set handling. Expected: removes ~0.6ms+ of
  the ~1.2ms/tick structural overhead vs the fused legacy walk. uibench
  standings unchanged (27.5 vs legacy 36.6 — keyed/structural ops carry it).
- **2026-08-18f**: First optimization pass — the creation-tax thesis
  CONFIRMED. uibench (10-iter, same-session sequence): legacy 36.6 → next
  33.8 (functionality landed) → 32.6 (scanAccessors deleted) → 31.1
  (createTarget direct construction) → **27.5 after the full pass — 25%
  faster than legacy**; family breakdown shows keyed structural ops at
  0.67–0.85x of legacy and the remaining ivi gap (21.4) concentrated in
  tree/render (creation) + removeAll (teardown). dbmon tick: 14.35 →
  **11.50ms/tick — legacy parity** (shallow 3.1 still the phase-2 bar).
  Mechanisms: (1) the eager `scanAccessors` descriptor enumeration per
  object (115.7ms in the uibench profile — the single largest store cost)
  is DELETED — accessor-ness is a per-node flag probed allocation-free at
  node creation (`__lookupGetter__`/`__lookupSetter__`, own-gated);
  accessor keys serve via `Reflect.get` with the PROXY receiver (also more
  correct for R20 nested tracking); fold paths use the cached flag plus ONE
  own-gated getter probe on the incoming side (merge/adoption-installed
  getters — pinned by three suite tests; prototype getters deliberately
  keep the invoke-compare path — their fold tracking depends on it, pinned
  by three other tests). (2) createTarget: direct field assignment in fixed
  order (shared hidden-class transition chain) instead of Object.assign
  literal copy. Suite green throughout (1253). Next profile targets:
  applyAdopt self-time (813ms/300 ticks: per-target ownKeys allocations,
  double WeakMap registration, prevByKey maps), then the ivi creation gap.
- **2026-08-18e**: Perf checkpoint at full functionality (single sweeps,
  subject to the ~30% A/A floor — ABBA discipline required before any
  claims): dbmon tick — next 14.2–16.5, legacy 11.5–12.4, shallow 3.1,
  vapor 3.7 (30-iter medians across two sweeps; both columns drifted
  together between sweeps, classic session-order variance). Profile (300
  ticks): adoption channel ≈ 46% of tick (applyAdopt + notifyFold + adoption
  mechanics ~5.2ms/tick self), read path (get/serveDataKey/read) ~2.2ms,
  dom-expressions effects ~2.5ms (floor shared with legacy). First
  structural change landed: plain-store adoption notifies INLINE after the
  descent (no foldOlds queue/drain round trip; projections keep deferred
  folds for hold semantics) — semantics-neutral (suite green), but the
  profile shows the cost is the diff work + per-target fixed overhead
  (~600 targets/tick: key-array allocations in applyAdopt/notifyFold,
  double WeakMap registration per adoption, WeakSet ownership checks), not
  the queue trip. Next profiling cycle candidates: for-in over null-proto
  node maps (kills ~1200 key-array allocations/tick), single-registration
  adoption, and the phase-2 edit-script question if the floor holds.
  Also: worktree `pnpm build` green again (type fixes: overload placement
  in legacy optimistic.ts, computed<void> shape in next/optimistic.ts,
  ownKeys cast).
- **2026-08-18d**: FULL SUITE GREEN — 91/91 files, 1253 passed, zero
  unhandled errors; next-gate store sweep 362 passed. The "zombie cascade"
  decomposed into three real bugs, all fixed: (1) §6's length-as-view rule
  implemented for optimistic arrays — length reads serve the composed view
  (backing ± overrides) with the node used only for tracking, making torn
  iteration (length on the stale-value rail, indices on the pending rail)
  impossible by construction; (2) landing consumption now performs the FULL
  legacy node reset (fold committed into `_value`, clear pending) instead of
  relying on a transaction's commit — a parked transaction's stashed queues
  stranded the wake otherwise; (3) $TRACK on chained backings reads through
  to the inner store's key-set node (§7b structural chaining, #2864/core
  R21) — mapArray over a wrapper view now observes the source's structural
  notifications. Optimistic increment COMPLETE. Remaining queue: legacy
  deletion + dispatcher removal (the size payoff), benchmark sweeps, final
  size vet.
- **2026-08-18c**: Optimistic increment COMPLETE except one zombie.
  Full default suite: every genuine failure fixed; the only remaining red is
  a 4-test in-file cascade in createOptimisticStore.test.ts (all 4 pass in
  isolation) caused by ONE unhandled rejection: the mapArray fixture test
  ends with an undisposed root + a tail `refresh()` whose fetch never
  resolves; a later flush runs its stashed/zombie mapArray recompute, which
  reads an undefined row (`comment.text` TypeError via async.ts notifyStatus
  → StatusError) and poisons subsequent flushes. Mitigation attempted (not
  sufficient): the next-shape transitionBlocked half now only blocks while
  the family holds LIVE overrides (a fully-consumed transaction settles even
  with its firewall eternally pending — also the correct #2951 semantics).
  The residual tear is in the stashed lane/zombie queue interplay — FIRST
  ITEM next cycle: reproduce the zombie recompute standalone (undisposed
  root + never-resolving refresh + later flush) and pin where mapArray sees
  length/index disagree.
  Fixes landed this stretch beyond 2026-08-18b: strict-read refetch-window
  escalation ported (firewall-pending untracked reads throw
  PENDING_ASYNC_UNTRACKED_READ); witnessAffectsMark resolves chained
  backings (marks witness through wrapper views); affects declaration walk
  composes the optimistic view and covers pending backings; store nodes are
  CONFIG_OWNED_WRITE (the setter carries the owned-scope guard; the guard
  itself now exempts roots — legacy parity); snapshot composes optimistic
  views across chained targets (multi-level, innermost outward); landing
  consumption classifies structural keys by PRESENCE OVERRIDES (pre-adoption
  truth), fixing post-landing retention of optimistic adds; projection
  backing folds are NEVER eager (a downstream hold can form later in the
  same flush) — freshness for context-free readers comes from readSource
  serving a fam target's pending backing unless `foldHeld` (any node parked
  under a live transition; the lazy-recompute read case has no transition
  stamp and stays fresh).
- **2026-08-18b**: Optimistic increment (in progress, most of the surface
  green). Architecture validated: armed nodes (`_overrideValue` slot) ride the
  core engine wholesale — zero store-side layer/backup machinery. Mechanisms
  landed: optimistic write channel (visible-view diff at setter exit, draft
  discarded, committed raw untouched — revert target by construction);
  membership overlay derived from armed has-nodes (ownKeys/has/descriptors);
  pb seeding + draft reads from the optimistic view (compose, not clobber —
  #2951); firewall-transition entanglement on bare writes (legacy parity,
  #2951 hold) + next-shape transitionBlocked store-half; landing consumption
  split — structural optimism consumes on landings (legacy layer parity,
  #2719), value overrides on keys present in landed data stay with their
  owning transaction (rapid-toggle); §6b lane-view diff baseline in reconcile
  (optimistic rows recycle their proxies against key-matched landings);
  chained-gate pierce for active overrides (§7b shadow rule);
  snapshot/deep compose the optimistic view (O1) with fam threading. Two core
  fixes surfaced: legacy `createWriteTraps` hard-reset `projectionWriteActive`
  to false per trap-op (now save/restore — it clobbered any enclosing
  authoritative scope); untracked node-first reads now serve the BACKING for
  committed state (O6 ruled read-through in practice: node `_value` lagged the
  eagerly-committed backing when a lazy derive recomputed on the very read
  that forced it). Main optimistic suite 64/68 — the 4 remaining are pure
  cascades from one cross-test zombie: the mapArray fixture test leaves an
  undisposed root + a tail refresh whose fetch never resolves; during LATER
  tests its zombie mapArray re-runs against stuck-lane state, reads an
  undefined row, and the unhandled rejection (async.ts syncError) poisons
  subsequent flushes (rendered arrays stay empty). Also outstanding: ~14
  failures in affects/marks, question-scoped-pending, strict-read,
  uninitialized-visibility, store-in-store, captured-proxies, adoption-lane
  rollback — next cycle's queue.
- **2026-08-17f**: Granularity specs written — §6 (key-set node, resolves O2:
  per-transaction membership overlay + tombstones + length-as-view), §6b
  (lane-aware adoption: lane backing, dual diff baselines, joint rollback),
  §6c (store-wide status gating on the root target), §6d (sticky reachability
  flag ported). RUL-5/7/8/11 all closed as spec'd. Also affirmed (Ryan's
  morning note): reference-equality diff pruning is kept wholesale — the
  ownership guard completes the skip's proof, it does not reduce skip
  frequency (adoption resets ownership, so reconcile-driven workloads never
  pay it).
- **2026-08-17e**: Reconcile diff baseline ruled (Ryan): the **current view**,
  signal parity — accepted with the explicit concern that we not take
  responsibility for unnecessary things (external mutation is the user's,
  immutable-input convention; R2a pinned). FINDING-1 confirmed a bug the
  rewrite fixes by construction; scope narrowed by a passing control — fresh
  references already restore on shipped, only the same-reference early-return
  is unsound (it keys "current" on raw, stale since 2.0 stopped mutating
  sources). Fresh-object control added to the rule test (3 pass, 1 expected
  fail).
- **2026-08-17d**: RUL-12 rulings (Ryan): unkeyed async-yield objects MERGE
  (yield-path replace was accidental); frozen-subtree writes ALLOWED (clone
  unfrozen, source honored); `markRaw` stays INTERNAL (no demonstrated public
  need; previously proposed and rejected). Sticky raw-marking KEPT with the
  reversal of my drop proposal: stickiness + the R44 dev-throw are two halves
  of one invariant — an object is never both deep-wrapped and raw; dropping
  either allows one entity to hold two silently-diverging truths (deep
  privatization vs stale shallow identity). Reconcile mechanics survive that
  state; entity coherence does not.
- **2026-08-17c**: RUL-4 resolved by new empirical evidence
  (`optimistic-signal-refetch-hold.test.ts`, 2/2): signal form already rides
  in-flight refetches; #2951 was a parity failure, not a semantic. RUL-9
  resolved: mid-flight correction is core lane behavior (all evidence is
  signal-form); store inherits. §7b written: chained backing = read-through
  (subscriptions land on inner nodes; masking = lane shadow + dynamic
  dependency rebuild; severing = backing swap); snapshot identity rule:
  source identity for unowned subtrees, cached copy for owned (resolves proj
  R22 + recon-snap R24/R25 jointly). RUL-12 populated with proposed defaults,
  four flagged for Ryan (⚑).
- **2026-08-17b**: Meta-rule pinned as R2 (Ryan): signal parity by default;
  divergence only where granularity forces it, documented per case. Remaining
  queue classified: RUL-4/RUL-9 expected pure parity; RUL-5/RUL-8/RUL-11
  genuine granularity divergences (membership dimension); RUL-7 hybrid
  (parity in meaning, divergent in enforcement surface).
- **2026-08-17a**: RUL-2 ruled by Ryan: landed truth always replaces optimism
  (equality cut gates propagation) — AND visibility of a landing is
  lane-scoped: an entangled member's completion collapses its lane into the
  parent transition, held until the parent completes ("if the parent isn't
  complete no one sees the completion of that optimism anyway — look at
  signals"). The apparent three-way landing matrix derives entirely from
  these two pre-existing rules; no store-specific landing mechanism exists in
  the rewrite, and no shipped test expectations change. (Corrects an earlier
  same-day entry that misapplied the ruling at global visibility and wrongly
  re-ruled the rapid-toggle preserve leg.)
- **2026-08-16f**: RUL-1 adopted after verification (Ryan's instruction:
  mirror signals *if verified* — verified against `core.ts` read/write paths:
  context-free reads → committed; owner-context reads → pending;
  drafts/`snapshot` read pending explicitly; transient per-target pending
  record for node-less writes; adoption = one pending backing swap;
  privatization may defer to commit). RUL-3 closed as a withdrawn flag, not a
  ruling: verification showed ownership is already per-node in core; store
  duplicate deletes; key-set remainder folded into RUL-8. RUL-6 reclassified
  as spec work (live chaining is shipped contract). RUL-2 candidate principle
  recorded — NOT ruled; pending verification against the three landing
  suites, then Ryan's yes/no.
- **2026-08-16e**: Implementation method — rewrite the state model, preserve
  the addressing model. Core (target shape, traps, write paths, ownership,
  node lifecycle) is written fresh from this doc: nothing exists until a rule
  requires it. Diff mechanics (reconcile key-matching, array reconciliation)
  are *ported*, not re-derived — their contract is unchanged and
  edge-case-hardened. The old suites + rule-derived `__TEST__` assertions are
  the contract both halves answer to. Convergence with already-correct parts
  of the shipped code (indirection, adoption) is the expected outcome of a
  rewrite, not a copy-edit; the difference is what's absent (layers, override
  merge machinery, store-side transactions, projection internals in plain
  stores).
