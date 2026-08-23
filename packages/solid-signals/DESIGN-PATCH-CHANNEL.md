# Stage 2 Design: The Patch Channel

Status: DRAFT for vetting (2026-08-19). Prototype-validated on dbmon
(ceiling v4): shallow+patch beats octane on full ticks (2.8 vs 3.2) and
partials (1.1 vs 1.4); deep+patch within ~19% on full churn, wins partials
(1.2), free teardown. See INTERNALS-STORE-STATE.md §10 for the ruled
constraints and measurement history.

## 0. One-paragraph summary

Store-driven templates compile to **patch functions** — per-record (deep) or
per-slot (shallow) compiled compare-and-write functions registered against
store data — dispatched by the store's own visibility transitions instead of
render effects. The reactive graph remains for derivation and structure;
pure data→DOM plumbing leaves it. Lists gain **slot ops** (add/remove/move)
computed by the same walk, consumed by `For` for minimal DOM moves. One
mechanism serves both store modes: deep = granularity mode (record patches +
descent), shallow = vdom-parity mode (slot patches, raw records).

## 1. Consumers

### 1a. Record patches (deep stores)

```ts
// compiler-emitted; not user-facing
registerPatch(record, (next, prev) => { /* inline compares + writes */ }): unbind
```

- Registered on the record's target. MULTI-CONSUMER: `t.p` holds one patch
  or an array (two lists can render the same record); dispatch loops.
- The patch reads RAW values from its arguments only — never through the
  proxy, never tracked. Nested plain children (dbmon's `queries`) are read
  raw inside the parent's patch; they need no targets of their own.
- Registration marks descendants (`d`) so keyed pruning reaches bound
  records, and counts as a "subscription" for reachability semantics.
- Accessor-bearing records are NOT patchable (patches read raw; getters
  need tracked evaluation) — the compiler bails to render effects for any
  binding it cannot prove is a plain data read (see §5).

### 1b. Slot patches (shallow stores / arrays)

```ts
registerSlotPatch(array, (index, next, prev) => void): unbind
```

- Dispatched by the array slot diff for changed slots (shallow records are
  raw by design — there is no record target to register against).
- The consumer resolves row identity itself (by key) — or, once slot ops
  land (§3), identity comes with the op.

## 2. Emission and timing (the semantic core)

### 2a. Emission sites — the phase-1 funnel

Ops are emitted ONLY from the sites where phase 1 already implements
visibility transitions, inheriting their gating:

1. **Adoption walk** (reconcile): per changed record with (incoming, old)
   in hand. Tentative reconciles (optimistic user-context) do NOT emit —
   they produce engine overrides, which emit via (4).
2. **Setter notify** (`notifyWrites`): plain-channel commits.
3. **Fold commit** (`drainFolds` / write-override landings): projections'
   deferred folds emit WHEN they commit — held folds hold their patches.
4. **Override lifecycle** (optimistic): override application emits
   patch(overridden, committed); settle/revert emits patch(committed,
   overridden). Reverts are first-class emissions computed where the
   engine already computes them.

### 2b. Apply timing — RULED REQUIREMENT: effect-phase

The prototype applied walk-side (setter time); production must not (DOM
mutating mid-batch diverges from render-effect timing under batching and
user DOM reads). Design:

- Emission pushes `(patch, next, prev)` onto a per-flush APPLY QUEUE.
- The queue drains in the render-effect phase slot (after commit, same
  point row effects run today) — batching, transitions, and lanes behave
  identically by construction.
- Patches run under their registering OWNER for error routing (an error in
  a patch reaches the row's boundary like a render-effect error would) and
  are dropped if the owner disposed mid-flush.

### 2c. The prev problem (single-home identity)

Owned backings fold values INTO the same raw object at commit (pinned by
prototype FINDING: prev === next by apply time). Rule:

- At emission, `prev = old` (the pre-adopt raw) — safe when the old raw is
  detached by identity-swap adoption (the data-sync flow; dbmon shape).
- When the old raw is OWNED (`ownedRaw.has(old)`) — setter-mutated flows —
  emission SHALLOW-CLONES prev (one clone per changed patched record).
  Cost is confined to owned+patched records; data-sync flows pay zero.

### 2d. What patches never participate in

Patches are not reactive consumers: no subscriptions, no reads, no
isPending/affects visibility, no async holding of their own. All
async/lane correctness derives from WHERE ops are emitted (§2a). This is
the load-bearing simplification — vet it hard.

### 2g. Ceiling COMPLETE (2026-08-20): full board at vdom-class

Bind-from-raw (one proxy touch per row — the registration record; all value
reads raw) closed the mount artifact: 15.9 → 9.6 vs octane 8.5. Final board
(deep store, full production channel, all gauntlet semantics active):
mount 9.6/8.5, tick 3.1/3.3 WIN, partial 0.9/1.4 WIN 36%, remount 9.9/8.7,
sort 4.5-5.3/4.0, unmount ~par. The ruled bar — beat the fastest vdoms on
updates, competitive everywhere, keep deep's sparse advantage — is MET by
the hand-compiled fixture; what remains is making the compiler and For
emit/consume this shape (mapArray seam, PR-C).

### 2f. PR-B result (2026-08-20): row ops land the structural bar

registerRowOps on keyed arrays: the walk emits { prefix, sources, removed }
only when structure changed (aligned ticks: zero emission — pinned by test).
Consumers LIS the sources once and apply minimal moves; adds bind at
op-apply; removals unbind. dbmon: sort 10.7 → 4.5 (octane 4.0), remount
25.7 → 9.3 (octane 8.5), ticks 3.0/0.9 BEAT octane 3.2/1.3 — deep stores
now beat the vdom bar on update paths and sit within ~10% on structure,
with all PR-A timing semantics active. Remaining gap: mount (15.9 vs 7.9)
— bind-time proxy reads, the known artifact; mapArray seam consumption is
the next PR-B increment (the fixture consumer is the hand-compiled shape
of what For will do).

### 2e. PR-A implementation findings (2026-08-19 night)

- OPTIMISTIC TIMING RULE: optimistic emissions drain at LANE-EFFECT timing,
  not the regular effect queues — an in-flight action stashes the regular
  queues (probe: patches applied only at settle), while lane effects are
  exactly the slot where optimistic visibility reaches the DOM today. The
  stashed regular drain doubles as the settle fallback for lane-less revert
  flushes.
- SITE EXCLUSIVITY: each target class has ONE emitting site — plain/eager
  targets emit at walk/setter; family targets emit ONLY at fold commit
  (adoption + fold both emitting double-fired, caught by the refetch
  gauntlet).
- Bubbled re-applies resolve `next` lazily at drain from the live target:
  privatization can clone an ancestor's backing between emission and drain.
- Transition-stamped entries release via patchCommitHook when their batch
  commits; reverted transactions drop by WeakMap GC — zero revert
  bookkeeping.

## 3. Slot ops for lists

The keyed walk already computes adds/removes/moves (prefix + keyed
remainder). Emit per-array SLOT OPS into the same apply queue:

```
{ retained: [(from, to)...], added: [(index, value)...], removed: [key...] }
```

- `For`/mapArray consume ops through an injection seam (store module
  registers the resolver; `map.ts` pays one branch — non-store arrays keep
  the generic path, per the mapArray ruling).
- Row containers apply minimal DOM moves from the op set (LIS over
  `retained` — the reconcileArrays algorithm runs ONCE, here, from data
  ops instead of re-derived DOM arrays). This replaces the prototype's
  placeholder full-scan sync and is what fixes sort/remount (11-12ms → ~4
  expected) and closes 2b without touching dom-expressions' generic
  insert (keyed store flows bypass it; everything else unchanged).
- Rows in patch mode still get an OWNER (disposal, error routing, nested
  reactive islands) but no row memo/effect — creation cost is template
  clone + bind + registration (measured: shallow-class mount).

### 2h. PR-B COMPLETE (2026-08-20): both modes at/beyond the vdom bar

Shallow row-ops (key-aligned prefix in the slot loop; keyless lists emit
append/truncate on length change only) + drain error isolation (one
throwing patch cannot abort siblings; first error rethrows — boundary
routing rides PR-C). Gauntlet: 11. Final dbmon board, full production
semantics, single run:

| op      | octane | shallow+channel | deep+channel |
|---------|-------:|----------------:|-------------:|
| mount   |    8.6 |   7.5 BEATS     |          9.8 |
| tick    |    3.7 |   3.0 BEATS     |   3.4 BEATS  |
| partial |    1.4 |   1.0 BEATS     |   1.0 BEATS  |
| remount |    9.4 |             9.6 |         10.1 |
| sort    |    4.4 |             4.9 |          5.3 |

Shallow beats octane on creation AND both update paths; deep beats on
updates and holds ~15% on structure while carrying the full granular
contract. The ruled bar is met by both modes. Signals-side stage 2 is
functionally complete: PR-C (compiler emission + For against
registerPatch/registerRowOps) and the wide validation matrix (uibench vs
ivi, octane full suite, jfb store scenarios — per Ryan, on stage
completion) are what remain.

### 3b. mapArray ruling revision (2026-08-20, post-PR-B)

The original design routed ops through mapArray. PR-B's fixture proved the
better shape: PATCH-MODE LISTS BYPASS mapArray ENTIRELY — the ops consumer
is the row manager (create/bind at op-apply, LIS moves, unbind removals),
with no mapped-array recompute and no per-row memos. mapArray keeps its own
staged keyed diff for everything it still owns (signals of arrays, non-patch
rows, generic Index/For) and needs NO seam — the resolver-check byte cost in
core-floor map.ts is avoided altogether. PR-C's For compiles patch-mode
lists against registerRowOps directly (the fixture's applyRowOps is the
hand-compiled spec); the effect-driver fallback keeps today's mapArray path.
REMAINING PR-B increment: row-ops emission for SHALLOW keyed arrays (the
positional branch), so shallow lists get the same structural wins.

## 4. Modes and how they compose

| | deep + patches | shallow + slot patches |
|---|---|---|
| diff | adoption walk + record descent | slot compares only |
| granularity | per-record dispatch; partial ticks beat vdoms | per-slot; rows replace by reference |
| ticks (measured) | within ~19% of octane | BEATS octane |
| semantics | full store contract (projections, optimism, drafts) | replacement-only records (#2932 contract) |
| use when | fine-grained mutation, optimistic UI, mixed access | sync-engine / immutable-feed rows |

O4 resolution: shallow is NOT retired — it is the explicit vdom-parity
mode on the same mechanism, one compiler output serving both.

## 4b. Dispatch bubbling (added 2026-08-19, compiler walkthrough)

Registration lives on the record the compiler binds (the row), but a
targeted nested write (`s.rows[0].queries[0].elapsed = x`) transitions the
NESTED record. Rule: emission walks the parent chain (`t.u` — maintained by
single-home) and dispatches ancestor patches too. Over-fire is safe (the
patch re-compares everything it writes); cost is a short pointer walk per
transitioned record, only when patches exist in the ancestry. This keeps
the compiler free of read-closure registration analysis.

## 5. Compiler (dom-expressions) — scope of 2c

- Patch-mode compilation for store-backed `<For>` row templates: baked
  text nodes, bind function cloning + ref-grabbing, ONE patch fn with
  inline compares, registration under the row owner.
- TIERED ELIGIBILITY: T1 = bare member chains on one unaliased subject;
  T2 = pure expressions of T1 reads and constants (ternary/binary/template
  literals) — same proof obligations, ship together. Per-KEY precision is
  not required (dispatch is per-record; the patch re-compares), so dynamic
  member access that is a pure read stays eligible.
- SUBJECT STABILITY (ruled 2026-08-19): the patch driver additionally
  requires the subject's identity to be FIXED for the instance lifetime.
  Row params satisfy this by construction (the record is the row identity);
  props objects never do (getter-backed, resolve differently over time) —
  props-rooted reads are structurally ineligible as patch subjects and land
  on the effect driver regardless of shape. "Evaluate props.item once at
  bind and patch on that record" is out of v1 (it changes semantics: the
  binding would stop responding to props.item itself changing).
- DEMOTION HOOK: a record that passes the bind probe but ACQUIRES an
  accessor property later (defineProperty/adoption paths already maintain
  the accessor flags) demotes — its patches are cleared and the retained
  effect thunk from the bind closure takes over. Runtime invariant:
  patches only ever read plain data.
- SIZE NOTE: dual-driver emission everywhere member-shape matches carries
  the patch branch even for props-only templates. The effect fallback IS
  today's output (shared helpers), and the compiler may safely skip the
  patch driver when the subject is a component's props binding — prunes an
  optimization, never changes behavior.
- RULED (Ryan, 2026-08-19): in-place mutation of an object held in a signal
  is OUT OF CONTRACT (it never notifies; equality breaks everywhere) — the
  effect driver therefore retains only the previous object REFERENCE and
  runs the same (next, prev) compiled body as the patch channel. No scalar
  retention, no second body variant. (Distinct from the owned-prev clone
  rule, which covers OUR fold mutating OUR owned backing at commit.)
- DUAL DRIVER: the compiled compare/write body is shared — patch-channel
  driven when the runtime bind check finds a patchable record, effect-driven
  (today's grouped-dynamics shape) otherwise. Accessor-bearing records are
  caught by the runtime bind probe, not the compiler.
- COMPONENT-AGNOSTIC: no <For> recognition; eligibility is shape-based on
  the template scope's subject. Custom list components get patch mode for
  free; slot ops couple to mapArray through the runtime seam only.
- PROPS/ATTRS ONLY (ruled 2026-08-19): patch mode covers bindings with an
  unambiguous write semantic — textContent, class/className, style, value,
  checked, attributes. EXPRESSION CHILDREN (inserts) are polymorphic by
  contract and always compile to insert() islands; the textContent-vs-child
  separation is retained ON PURPOSE as the author's type declaration (it is
  the information that gates the fast path). A later runtime string-upgrade
  tier for child text stays out of scope (insertExpression already does
  string→string .data writes).
- STRICT BAIL RULES (correctness over coverage): any binding that is not a
  provably-plain member access on the row param (calls, spreads, context,
  component boundaries, accessor risk) compiles to today's render effects
  within the same row. Patch mode is an optimization tier, never a
  semantic fork; a row can mix patch bindings and effect islands.
- Hydration: claim + register ONLY — no render effects created, no initial
  writes, no graph edges; store-list hydration cost collapses like unmount
  did. textContent cells claim firstChild directly (single text child — no
  markers); insert islands keep the marker machinery unchanged. Policy
  (default): skip the initial apply, dev-mode mismatch check — matching how
  hydration truth is treated elsewhere. Claim-time registration touches
  records without deep proxy reads (the mount-artifact lesson).
- Event handlers/refs compile as today (they don't read reactively).

## 6. What this is NOT

- Not a public userland API (compiler-internal registration; `unstable_`
  exports during development).
- Not a replacement for render effects generally — signal-backed bindings
  keep effects (the light-subscriber alternative washes on status
  bookkeeping; ruled 2026-08-19).
- Not a size win: net-positive bytes, budgeted against the ratcheted gates
  (+createStore 12.2 KB, core floor 7.45 KB — map.ts seam lands in core).

## 7. Acceptance gates (in order)

1. **Gauntlet** (before any API lands): projection mid-refetch shows no
   torn DOM and patches at landing; optimistic storm displays overrides
   and reverts the DOM at settle; transition-held reconcile applies at
   transition commit; error in patch reaches the row boundary; unbind on
   dispose leaks nothing. All 1282 existing tests stay green.
2. **Perf**: dbmon full sweep — shallow+patch ≤ octane on tick/partial;
   deep+patch ≤ 1.25x octane tick, wins partial; sort/remount within 1.3x
   after slot ops; mount ≤ shallow-class. uibench vs ivi re-run. Interleave
   harness is the tool of record. Effect-phase queue tax measured
   explicitly (expected +0.1-0.3ms vs ceiling).
3. **Size**: gates green or consciously bumped in the spending PR.

## 8. Work breakdown

- **PR-A (signals)**: apply queue + emission at the four sites + owned-prev
  clone rule + multi-consumer registration + unbind/owner wiring + gauntlet
  tests. No compiler dependency — hand-written patches testable.
- **PR-B (signals)**: slot ops from the keyed walk + mapArray seam
  consumption + LIS application; fixes sort/remount in the prototype.
- **PR-C (dom-expressions + solid-web)**: patch-mode compilation + bail
  rules + hydration claiming; solid `<For>` wiring.
- **PR-D**: full benchmark matrix, size vet, INTERNALS/spec updates.

## 9. Open questions for ruling

- **Q1 (timing tax)**: effect-phase queue is the correctness default; if
  its measured tax matters, is an opt-in "immediate mode" for
  non-transactional flows acceptable, or is one timing the rule?
- **Q2 (opt-in vs detection)**: does patch-mode compilation require an
  author opt-in (e.g. a `<For>` hint) or apply automatically under the
  bail rules? (Automatic = free wins + risk of surprise bails; opt-in =
  predictable + adoption friction.)
- **Q3 (multi-store rows)**: a row template reading TWO stores' records
  (join shape) — one patch registered on both records, or bail to effects?
  (Proposal: register on both; patch is idempotent recompute of writes.)
- **Q4 (public surface)**: do registerPatch/registerSlotPatch ever become
  public (library authors, custom renderers), or stay compiler-internal?

## 10. PR-C e2e checkpoint (2026-08-20)

Plain JSX-authored dbmon (the ORIGINAL fixture authoring: `createStore` +
`reconcile` + `<For>` + textContent props, zero hand-written DOM) compiled
through the patch-mode plugin (`patchDriver` config option → vite-plugin-solid
`solid` passthrough) against this branch's runtime:

| op            | octane | solid (classic) | hand ceiling | **compiled** |
|---------------|-------:|----------------:|-------------:|-------------:|
| mount         |   8.7  |           29.6  |         9.8  |     **13.1** |
| tick          |   3.9  |           13.9  |         3.5  |      **3.5** |
| tick_partial  |   1.6  |            2.6  |         1.1  |      **1.1** |
| remount       |   8.9  |           20.1  |        10.5  |      **9.8** |
| sort          |   4.7  |            5.6  |         5.3  |      **5.6** |
| unmount       |   0.4  |            5.2  |         3.9  |      **3.6** |

Semantic gate green (keyed identity, partial isolation, remount/sort/unmount
contracts). All 14 row bindings fuse into ONE compiled patch per row; both the
plain table and the optimistic OptTable rows took patch mode.

- Update ops (tick/partial) tie the hand ceiling exactly: the channel + the
  compiled body IS the whole story; classic solid is 4x/2.4x behind.
- Bug found in landing this: patchableRaw/registerPatch sat in core.ts's
  `export {} from "solid-js"` block — re-exports don't bind module scope, so
  patchDriver threw at runtime. The thrown value embeds a store proxy, which
  CDP can't serialize ("object reference chain is too long") — masking the
  real error in the harness. Probe with string-captured errors first.
- REMAINING gaps, both structural (classic `<For>`): mount 13.1 vs 9.8
  ceiling (per-row owner/component/mapArray) and sort 5.6 vs 4.7 octane
  (second diff in reconcileArrays). Both are the row-ops `<For>` integration
  (registerRowOps → LIS moves, patch-mode row creation without per-row
  effect owners). That is the next work item, then hydration claiming.

### 10b. For row-ops integration landed (2026-08-20)

`<For>` now rides the channel (§3b as ruled): the component attaches `$ll`
metadata to a LAZY classic accessor (mapArray created under the component
owner only on first call), and the runtime's insert offers it to `driveList`
(solid-web core, optional rxcore seam — unaware cores just call the
accessor). The driver binds rows once — purity proven by a bind-time owner
probe (blank = no computations/cleanups); non-blank binds DECLINE to
mapArray — then consumes registerRowOps positionally (sources hold old
absolute indices): LIS moves, bind-at-op-apply creates, node removal. No
per-row owners; a removed row's registrations die with its record. Array
identity swaps match by RAW IDENTITY (mapArray's keyed retention semantics)
as a synthetic full-window op, re-registering on the new target.

Compiled JSX dbmon after the driver (30-iter, gate green):

| op       | octane | hand ceiling | compiled (For) |
|----------|-------:|-------------:|---------------:|
| mount    |    8.6 |         10.1 |       **11.5** |
| tick     |    3.3 |          3.2 |        **3.4** |
| partial  |    1.5 |          1.0 |        **1.1** |
| remount  |    8.6 |          9.9 |        **8.4** |
| sort     |    4.5 |          4.7 |        **4.7** |
| unmount  |    2.9 |          3.4 |        **3.1** |

sort and remount landed ON the ceiling (remount beats the hand fixture);
the only gap left is mount 11.5 vs 10.1 — per-row proxy creation at bind
(registration needs the record proxy for parent links). Full monorepo suite
green post-change; dedicated spec (for.patchlist.spec.tsx) proves
engagement (shared list owner), decline paths (impure rows keep classic
semantics + owners), identity-swap retention, and disposal.

Declines in v1 (classic path serves them): fallback prop, index-using
callbacks (arity ≥ 2), keyed={false}, empty initial list, hydration.

### 10c. uibench through the compiled path (2026-08-20) — multi-shape validation

Fork's 2.0 uibench adapter, unmodified source, compiled with patchDriver
against this branch (vs hosted inferno/ivi, sum of medians, i=10):

- TOTAL: solid 28.0ms / inferno 25.7 (1.09x) / ivi 21.4 (1.31x).
  Baselines (BEWARE provenance): pre-stage-1 next (old store, Aug 16) was
  46.4ms; the stage-1 build (≈ current next, Aug 18) was 32.9ms. Stage 2's
  own contribution over recent next is ~15% total — the two-stage sum is
  40%. Inferno/ivi hosted samples are Aug 16 (cross-day variance baked in).
- Table interaction ops now BEAT both vdoms: sort 0.48x, filter 0.47x,
  activate 0.29x of inferno. These are the channel + row-ops wins.
- Tiered compilation behaved as designed with zero authoring changes:
  table rows took patch mode (row.active class binding); cells and tree
  leaves compiled fully static → lists engage the driver with ZERO patches
  (structure-only row ops); tree containers (component children) and anim
  boxes (style-object binding) declined to classic.
- Remaining gaps are CREATION only: tree/render 2.05x, table/render 2.0x
  inferno — the template-clone + proxy-creation tax (same shape as dbmon
  mount; the TSRX-codegen question).

BUG found and fixed by this pass: the purity probe CASCADED on container
rows — probing built the first-child subtree (nested lists probing
recursively), discarded it on decline, O(N log N) waste: 69.6ms (43x
inferno) on the depth-10 tree render. Fix: while probing, reactive work is
recorded-and-skipped (an effect or function-valued insert proves decline,
so its construction is guaranteed-discarded) — container probes now cost
one shallow clone. 69.6 → 7.6ms. Probe-skip is SAFE only because dirty
probes always discard; kept (pure) probe rows never skipped anything.

### 10d. Hydration claiming landed (2026-08-20)

§5 as ruled — claim + register only. patchDriver skips the initial
force-apply while hydrating (server HTML is the truth until the first
transition; verified by a spec where mismatched server text survives
hydration and the first store write repaints through the patch on the
CLAIMED node). The list driver claims server rows through each row's own
`_hk` attribute: a row-scoped explicit-id owner (key minus its trailing
child counter — pure rows consume no ids before the root claim) makes the
compiled template's getNextElement resolve the registry entry, so no
id-scheme replication is needed — the DOM carries the truth.

THE INVARIANT (found by the parity harness, for-nested-ternary): every
driver-side read must be ID-CHAIN NEUTRAL. Evaluating `each` mints
wrapConditionals memos lazily inside the prop getter; minting them on the
ambient chain consumed a child id the classic path expected, shifting every
later hydration key. All driver reads are now id-isolated: decision read
under a disposed throwaway owner, probe under its own detached id scope
(memos record-and-skip while probing), identity-watch effect under the list
owner's private counter. Engage consumes exactly ONE ambient id (mapArray's
owner slot); decline consumes zero.

V1 hydration declines (classic path serves them): marker-bounded regions,
row count != DOM count, rows without clean `_hk` keys. Dev-mode text
mismatch check remains open (policy says skip-initial regardless).
Post-landing CSR sanity: dbmon compiled unchanged (tick 3.5/partial 1.1/
remount 9.0/sort 5.0). Full monorepo green incl. hydration parity harness.

### 10e. JFB validation pass (2026-08-20/21) — PR-D

Two fixtures driven by octane's js-framework runner + keyed-reorder identity
gate (local workspace, edit-script build): the CANONICAL solid-next
authoring (ryansolid/js-framework-benchmark solid-2.0-benchmarks branch —
signal rows, per-row label signals, id-keyed store selection; per Ryan the
fastest-version entry) and an ALL-STORE fixture (deep store rows, setter
mutations, patch-mode compiled row templates) as the store-scenario vehicle.

The store scenario found and fixed FOUR driver/store gaps:
1. Setter-channel structural mutation emitted NO row ops (silent stale DOM
   for driven lists mutated without reconcile) — the fold now identity-diffs
   and emits.
2. Empty-initial lists declined permanently (fatal: JFB starts empty) — now
   tentative engagement with a deferred probe + late-classic re-entry thunk.
3. Draft-authored permutations rebuilt every row (deep ingest stores written
   proxies verbatim; identity matching now unwraps both sides) — caught by
   the reorder identity gate, which the store fixture now passes wholesale.
4. notifyWrites/hold-check scanned EVERY subscribed node per setter write —
   an id-keyed selection store over 10k rows paid two 10k-node scans per
   select (select_lots 47x octane). Trap writes now record written keys
   (t.wk); notify/hold-check are O(written), with full-scan fallbacks for
   array length writes (implicit index deletes/grows), accessor-bearing
   records, and class instances (prototype getters).

Board after (vs octane-tsrx, 8 iters, sub-ms ops so variance is real):
canonical solid-next at effective parity — add/remove/replace/clear ≤1.0x,
run/swap/runlots ~1.1x, update 0.9-1.2x, select 1.6x, select_lots 2.0x
(0.2ms absolute; was 47x). The all-store fixture passes every gate; its
outliers are AUTHORING-side array costs (find/splice/indexOf over proxies —
O(n) trap traffic), noted for a future draft array-method fast path
(shift/splice lowering to bulk pb ops).

Size after the full PR-D fix set: store entry 14.69 KB gzip (13.56 at the
stage-2 branch point → +1.13 KB for the entire channel + row ops + setter
emission + wk bound), core-only 8.61 KB (+0.02).

### 10f. Octane full-suite sweep (2026-08-21) — PR-D

All 18 solid-column suites run through octane's OWN gated harness
(bench.mjs), fixtures on the edit-script build with patchDriver enabled.
Solid passed EVERY correctness gate after two fixes this sweep forced:
probe-abort semantics (effectful-list's work-count gate caught the probe
running user code — refs/cleanups for speculative builds; the probe now
aborts at the first impurity marker incl. createComponent, so user code
never observes it) and fixture authoring (octane's dbmon/jfb fixtures used
expression children — insert holes decline the driver BY DESIGN; updated to
textContent/canonical authoring, mirroring the ruled type-declaration
contract).

Suite geomeans (solid/octane, <1 = solid faster), 109 ops total:
  effectful-list 0.52x | store-selector-fanout 0.71x | async-waterfall
  0.85x | memo-wall 0.97x | dbmon 1.08x | portal-swarm 1.13x |
  js-framework 1.17x | weather-app 1.20x | signal-favoring 1.37x |
  spa-navigation 1.40x | recursive-context 1.47x | svg-dashboard 1.50x |
  jfb-reorder 1.55x | todomvc 1.86x | chat-stream 1.95x | news 1.97x
  OVERALL geomean 1.26x; 50/109 ops at parity-or-faster, 25 ops >2x
  (nearly all sub-millisecond small-op or creation-path).

Reading: solid WINS the store-centric suites (effectful-list, selector-
fanout, memo-wall, async-waterfall — the fine-grained model's home turf,
update_nodeps literally 0.00x) and holds parity on dbmon/JFB main ops.
The behind-tail decomposes into the two known shapes: CREATION (mount/
nav_mount/ssr+hydrate — template-clone+proxy tax, the TSRX-codegen
question) and SMALL-OP FIXED OVERHEAD (rotate/displace/removefirst,
toggleAll, stream ticks — sub-ms ops where scheduler+channel constants
dominate octane's direct writes). Several behind suites (todomvc,
chat-stream, svg-dashboard) retain expression-children authoring — the
same fixture-shape penalty dbmon had (16.4ms→3.1ms tick from authoring
alone); re-authoring those is follow-up fixture work, not runtime work.

### 10g. Shallow compiles; dbmon fixture goes shallow (2026-08-21)

Ruling applied: the fixture carries the FASTEST correct authoring. The last
hand-bound piece landed — shallow rows are raw, so patchDriver hands bodies
whose subject IS the row to the driver's collector, and the driver
dispatches them from the array's slot channel (emission graduated to channel
semantics: key-aligned value slots only, queued, owner-dropped; structure
rides row ops exclusively; kind-changing swaps hand off to classic).

Local A/B (octane | deep-compiled | shallow-compiled):
mount 8.8|12.5|10.1 — tick 3.7|3.9|3.2 — partial 1.5|1.1|1.0 —
remount 9.1|10.3|9.6 — sort 4.9|5.1|4.7. Shallow wins every op vs deep and
beats octane on tick/partial/sort; the mount gap halves (no per-row proxy
creation at bind).

Octane's own gated dbmon suite with the shallow fixture (gates green):
tick 0.94x, partial 0.98x, remount 0.90x, sort 0.95x, mount 1.06x,
unmount 1.62x (1ms abs) — geomean 1.05x, solid FASTER than octane on 4/6
ops. Deep remains the full-contract mode at 1.08x geomean; shallow is the
vdom-parity mode (O4 as ruled), now served by the same compiled output.

### 10h. Fixture best-practices sweep (2026-08-21) — every fixture the fastest version

Ruling (Ryan): every octane fixture carries Solid's fastest correct
authoring; the fixture set may become an upstream PR. Sweep results:

- dbmon → SHALLOW compiled (10g): 1.05x geomean, faster on 4/6 ops.
- js-framework → canonical solid-next authoring (earlier).
- todomvc → hybrid (signal array + per-todo field signals): 1.86x → 1.48x;
  toggleAll 5.0x → 1.25x. An ALL-STORE attempt measured 4.60x — scan-heavy
  derived views (visible/remaining) pay per-read proxy cost; REVERTED.
- chat-stream → hybrid (immutable structure + per-message done signal):
  1.95x → 1.26x; streamFine 3.51x → 1.16x; type160 now faster (0.74x). An
  ALL-STORE attempt measured 4.46x (switchConv 8x — proxy graph mounts);
  REVERTED.
- svg-dashboard: NO change — octane's own fixture uses the same attr
  spreads (style_spread_pulse deliberately measures spread handling);
  rewriting to explicit attrs would dodge the measured work. Authoring
  already parallel; gaps are runtime items (spread assign, SVG creation).
- weather-app / spa-navigation / news: app-realism fixtures, structurally
  parallel to sibling columns — authoring stands.
- signal-favoring: synthetic 100-component signal chain, already minimal;
  µs-scale gaps are scheduler constants. NO REGRESSION vs published beta.20
  (same-machine A/B identical); the committed baseline predates octane's
  own 14-23x signal-propagation improvement.

FINAL corrected board (108 ops): geomean 1.22x; 48/108 at parity-or-faster.
THE AUTHORING PRINCIPLE the sweep validated (documentation-worthy): stores
win FINE-GRAINED MUTATION over stable shapes (dbmon/effectful-list/selector
fanout); signal structure + per-entity field signals win SCAN-HEAVY or
MOUNT-HEAVY shapes; deep-proxying large graphs that get scanned or
remounted wholesale is the anti-pattern (todomvc 4.6x, chat 4.5x).
Remaining behind-tail is runtime work: creation paths, sub-ms small-op
constants, spread assign, SSR/hydrate pipeline.

### 10i. Q2 RESOLVED: patch mode is DEFAULT-ON (2026-08-21)

No authoring or build option — the dual driver makes patch mode invisible:
the same compiled body runs on the channel (patchable subject) or a tracked
effect (anything else), eligibility bails conservatively, the probe declines
gracefully. The babel plugin now defaults `patchDriver: "patchDriver"` for
DOM output (`false` opts out for runtimes predating the export — normal
plugin/runtime lockstep). Blast radius: ONE fixture shape
(attributeExpressions) across the DOM configs; SSR/universal outputs
regenerated byte-identical. Proof of seamlessness: all octane fixture vite
options reverted to stock, dbmon re-run — patch mode engaged via the
default, gates green, numbers identical (geomean 1.05x). The octane repo's
working diff is now fixture-authoring only, ready to shape into an upstream
PR once published packages carry the channel.

## 11. Stage 3 opener: the core tax map (2026-08-21)

Stage 2 closed the store/list story (dbmon shallow FASTER than octane in
their harness; suite geomean 1.22x vs octane, 1.03x vs vue-vapor). The
remaining bottleneck is the REACTIVE CORE's fixed costs, isolated two ways:

- vs VAPOR (signals sibling): we win every structural/lifecycle suite
  (nav 0.59x, portals 0.69x, reorders 0.72x, lists 0.78x) and lose ONLY
  propagation-constant shapes (signal-favoring 2.16x; bump_deep 7x at µs
  scale) — their alien-signals core has a lower per-update constant.
- vs OUR OWN ENGINE (js-reactivity-benchmark, ryansolid fork
  solid-2.0-benchmarks branch, solid-next = edit-script prod build):
  OVERALL solid-next / r3 = 2.20x; / r3-solid-target = 1.67x (so ~1.3x is
  the cost of solid's target semantics; ~1.67x is our implementation of
  them). solid-next beats Solid 1.x everywhere (0.6-0.85x) — the gap is
  headroom, not regression. Engine choice CONFIRMED: r3 heap still wins the
  diamond/avoidable-propagation shapes it was chosen for (0.9-1.5x band);
  alien-signals is NOT the answer (Ryan: r3 benched faster on wide
  fan-outs; the additions cripple it, not the engine).

THE TAX MAP (worst first, all measurable single-command targets):
1. CREATION — create0to1 12.9x, create2to1 6.2x, create4to1 4.1x. The
   constructor path does eager work r3 defers (owner wiring, id
   inheritance, queue/context, flag init). Same tax behind every mount gap
   all stage. Fix shape: field-layout + lazy-init discipline.
2. WRITE FAST PATH — diagnosticWriteNoSubs 4.3x (a write NOBODY observes
   pays 4x), update1to1 3.4x (the canonical hot path). Fix shape: the
   hasPatches() pattern on the core write path — one armed-check branch;
   lane/transition/status machinery consulted only when armed.
3. PROPAGATION CONSTANTS — deep/broad 2.3-2.7x per-hop overhead; expected
   to largely fall out of (2).

Size ruling context: this is GATING/TRIMMING existing paths, not a second
engine — expected size-neutral or negative (unlike any alien hybrid).

Next steps when stage 3 opens: CPU-profile create0to1 + update1to1 against
r3 side-by-side to name exact lines; rule on the fast-path invariants (what
"nothing armed" means precisely: no lanes, no transitions, no async status,
no affects, no patches); then increment with the reactivity benchmark as
the tier-1 gate and the octane suite as tier-2.

### 11b. Profiles name the taxes (2026-08-21, side-by-side vs r3)

- create0to1 (24.0ms vs r3 2.7ms): **GC is 66.6% of the profile** — creation
  is an ALLOCATION problem before it is a code problem (per-node footprint +
  eager work). Visible code costs: disposeChildren (7.4% — our disposal walk
  between bench roots), recompute+computed+setupComputedNode (13.6% — the
  memo RECOMPUTES EAGERLY AT CREATION; r3 defers), inheritId (1.3% — id
  work on a CSR path that should be id-free).
- diagnosticWriteNoSubs (42.9 vs 5.9): the PENDING/COMMIT pipeline is the
  write tax — commitPendingNodes 27.1% + two flush layers 18.9% +
  queuePendingNode + canUseSimpleSyncFlush + setSignal. A write with ZERO
  subscribers runs the full pending-node queue/schedule/flush/commit cycle;
  r3 just writes and stabilizes.
- update1to1 (66.9 vs 13.8): same pipeline dominates (commitPendingNodes
  18.3%, flushes 11%, heap insert/run 9%, canUseSimpleSyncFlush 2.5%) around
  the actual recompute (12.2%).

Stage-3 fix shapes, now specific:
1. CREATION: shrink/lazify node allocation (field count, owner/id wiring),
   and revisit eager-recompute-at-creation for memos (lazy until first read
   where semantics allow — biggest single lever with GC at 2/3 of profile).
2. WRITES: an unarmed write (no subscribers, no lanes/transitions/async/
   affects active) short-circuits past the pending-node pipeline to a direct
   value store + dirty mark — the hasPatches() discipline applied to
   setSignal/flush/commitPendingNodes.
Both are measurable per-commit via `TESTS=<name> FRAMEWORKS=solid-next node
packages/node/dist/index.js` in the reactivity-benchmark fork (profiles/
holds the capture tooling: profile-tax.sh + summarize-profiles.mjs).

### 11c. Stage-3 increment log (2026-08-21)

- LANDED: hot-path shape alignment + presence bits (§11b fix shape 2's
  mechanical layer): signal/computed/effect literals carry the shared hot-
  path slots; CONFIG_OPTIMISTIC/HAS_COMPANIONS/HAS_SNAPSHOT/HAS_LANE gate
  optional-slot probes in setSignal/insertSubs/commit/recompute; optimistic
  constructors no longer fork hidden classes. ~7-10% on write-path benches
  (idle-machine); core-floor ceiling consciously +~120B.
- LANDED: patch-channel held emissions stash on the transition object (one
  property read per flush commit; WeakMap dropped).
- RULED OUT (the experiment that mattered): quiet-world memo direct-commit.
  #3009's latest()/plain-write purity family failed immediately — mid-batch
  pulls must see fresh values while plain reads stay committed until flush;
  the pending round-trip IS that separation. The update-path commit cost is
  semantic price. Write-path headroom therefore narrows to per-step trims;
  the big §11 lever standing is CREATION (allocation: 553B/computed,
  384B/signal measured; node diet yields single digits — the real question
  is structural, i.e. the TSRX/codegen conversation for creation-heavy
  paths, or owner-tree slimming at rewrite scale).
- MEASUREMENT DISCIPLINE: daytime load inflates these µs benches ~10-15%
  (r3 control moves identically). Verify by profile shape or idle runs.
- LANDED (§12): cold-field extension split. The 11 optional-machinery fields
  (`_inFlight/_error/_blocked/_pendingSources/_notifyStatus/_transition/
  _reask/_child/_unobserved/_optimisticLane/_overrideValue` + the post-hoc
  verdict/lane slots) moved off the node literals into ONE lazily-allocated
  extension shape (`_x`, `ext()` in core.ts). Computed literal 39 → 29
  fields, signal 13 → 12; the recompute status gate collapsed to
  `_statusFlags !== 0 || _x !== null`. Presence bits stay the hot gates.
  - Hypothesis check: the V8 in-object cliff (~39 fields; synthetic 4x)
    did NOT drive create0to1 — that bench was flat. The wins came from the
    memory diet: memo 553B → 429B (-22%), create 330 → 280ns; interleaved
    A/B: create1to1 -19%, update1to1 -12%, writeNoSubs -9%. dbmon (shallow
    + deep compiled, reversed-order interleave): tick parity, mount/remount
    -4-6%. Byte cost: core floor 19,570 → 20,313 min (+~740B; the `_x?.`
    chains + ext initializer), ceiling consciously bumped to 20,600.
  - Sweep hazards for posterity: `this`-sensitive callbacks stored in _x
    must be `.call(node, …)`-dispatched (notifyEffectStatus regression);
    `any`-typed reads of moved fields slip tsc silently — the #2951
    firewall-transition entanglement in notifyOptimisticWrites died this
    way (`fw?._transition` read the dead raw slot); `?.` flips `null`
    defaults to `undefined` in comparisons; never allocate _x to store a
    field's default (applyReask, guarded default writes).
- LANDED (§12b): zombie pair (`_pendingDisposal/_pendingFirstChild`) moved
  into _x (computed literal 29 → 27; roots swap the pair for `_x: null`) —
  staged disposal only fires for owners that HAVE children/disposal, so
  childless memos never pay it, and the per-recompute commit gate collapses
  to one `_x` null check. Plus a plain-commit fast drain in
  GlobalQueue.flush (prod-only: dev keeps the full spine for invariant
  checks; semantically identical when preconditions hold). Interleaved A/B:
  update1to1 -12% on top of §12, create1to1 ~-10%, dbmon deep tick
  3.6 → 3.2ms, shallow parity. writeNoSubs flat — the per-flush constant
  is now the commit loop itself; per-write direct-commit stays ruled out
  (#3009 purity). Byte cost +~300B (ceiling 20,900).
- REMAINING (§12c candidates, unproven): creation is now 69% GC at 429B/
  memo — the next real lever is owner-tree slimming (~10 fields of
  ownership machinery per node), which is rewrite-scale and interacts with
  the TSRX/codegen conversation. Per-flush constants are within ~2x of
  floor for the write-only diagnostic; real apps don't flush per write.

## 13. Stage 4 opener: SSR (2026-08-22, branch stage4-ssr)

The full-board run (fresh octane @ 014bf880, rebased stack, 24 suites)
closed stage 3 and named the next target. Client standings: geomean 1.11x
vs octane-tsrx (wins: effectful-list 0.53x, lifecycle 0.62x,
store-selector 0.75x; parity: dbmon 1.11x, jf 1.16x), 1.04x vs vue-vapor.
The outliers left are architecture-shaped, and SSR is the largest and most
SYSTEMATIC:

- ssr-throughput: 2.18x vs octane (news-50), 1.71x (news-500);
  2.81x / 2.22x vs vue-vapor — two unrelated compiled competitors beat us
  2x+ with different runtimes, so the cost is ours, not their trick.
- streaming-ssr: 1.63x (shell_staggered 2.61x).
- The trailing CLIENT cells share the signature: destroy25 3.4x,
  removefirst 3.7x, mount 3.1x, partial_remount 3.3x — creation/teardown,
  not updates. Same tax, different venue.

Working hypothesis (from §11-§12 evidence): SSR builds the entire reactive
graph per request — ~430B/memo, 69%-GC creation, full ownership machinery —
and uses NONE of its update capability. The graph's only server job is
async orchestration (boundaries, streaming order). The channel thesis
applied to SSR: components as plain functions, sync bindings as direct
string emission with zero node creation, graph machinery materialized ONLY
where async appears. That is a compiler + runtime conversation (ssr
generate), bigger than the client patch channel but attacking 100% of the
cost instead of shaving node weight.

First task: the SSR tax map — profile the news fixture's renders (solid vs
octane control), attribute self-time to graph creation vs string emission
vs seroval vs async plumbing, and size the zero-graph headroom before
designing anything. (Signal-scope bodies for the client 7x bump_middle and
the reorder tail stay parked until the SSR read is in.)

### 13a. The tax map falsified the thesis — and closed the gap (same night)

The first profile: GC was 5.9%, graph creation a rounding error. 58.8% of
ALL select-free news-render time was ONE dom-expressions function,
resolveSSRSelectValues — its gate indexOf is the first pass over the
freshly-assembled rope and pays the flatten, and it ran per render AND per
streamed fragment. Fixed on dom-expressions branch stage4-ssr (5a7bb039),
three layers, each individually measured: compiler-armed gate (2.19x
select-free throughput; Babel + Oxc emit one _$ssrSelectValues() marker
per select-value module), region-jump resolver (2.15x on armed pages,
byte-identical), attr `<` escaping as the region-jump soundness invariant
(fast path unchanged). Board (within-run): ssr-throughput 2.18x→1.04x /
1.71x→1.08x vs octane; streaming-ssr 1.63x→0.98x (total_allfast 0.83x —
a WIN); vs vue-vapor 2.81x→1.39x / 2.22x→1.05x. Overall board vs octane
~1.20x→~1.10x, vs vapor ~1.14x→~1.06x.

REMAINING (the vapor-gap tail, all solid-side; probe: us 48µs/render,
vapor 30, octane 15): children resolution 11% (does server children() pay
memo machinery a plain resolve wouldn't?), tryResolveFunctionHole 4%,
runWithOwner 2.7%, formatChildId 2.6% (hydration id strings), asset
tracking ~4%, GC 13% (creation tax demoted to minor). That tail is the
next increment. Lesson for the log: profile before designing — the
"zero-graph server" architecture conversation dissolved into a one-night
string-pipeline fix.

### 13b. Clean-machine re-vet + chunk coalescing (2026-08-23)

Two multi-week runaway processes (280% CPU combined) were discovered and
killed — all §13/§13a absolutes were parasite-era. Clean re-vet:
news-50 0.99x vs octane (the headline HOLDS; parity), 0.83x vs svelte;
news-500 1.15x / 0.89x; vs vue-vapor 1.15x / 1.27x — the "passed vapor"
claim was probe-only and does NOT hold at suite level. streaming-ssr's
"0.98x win" corrected to a loss on the cells that matter: shell TTFB
2.7x, 41 chunks vs octane's 11 (the total_* cells are stagger-dominated
ties).

CHUNK COALESCING (dom-expressions ed260566): a settled boundary's
template/activation/data/reveal writes span one resolution burst across
chained microtasks — historical microtask-alignment (the pushTask double
queue) cannot span arbitrary chain depth; a macrotask defer rides after
the whole burst. Shell flushes synchronously at handoff (TTFB never
deferred); 16KB early-flush; both pipe/pipeTo handoffs share the one
coalescer. Result: all-fast 41 -> 2 chunks and FLIPS TO A WIN (shell
0.12 vs 0.25ms, renders/s +32% over octane); staggered exact chunk
parity (11) and total 0.99x. Byte-identical output.

STILL OPEN: staggered shell-min ~2x (0.31 vs 0.15ms) — boundary-setup
render constant, same family as the news per-element gap; and vapor's
15-25% news-page edge (the §13a tail: children/ids/asset-tracking).
