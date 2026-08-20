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
