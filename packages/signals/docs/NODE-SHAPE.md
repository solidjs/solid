# Node Shape and Hot-Path Layout — Stage-3 design record (§11–§12)

**Why this file exists.** Source comments in `core.ts`, `scheduler.ts`,
`graph.ts`, `types.ts`, `constants.ts` and `optimistic.ts` cite `§11b`, `§12`,
`§12b`, `§12c`, `§12d` and `§12e`. Those were entries in the _Stage-3
increment log_ (§11c) of `DESIGN-PATCH-CHANNEL.md`, the patch-channel design
journal that lived in the pre-absorb signals repo. That journal was carried
into the monorepo only from §17 on, and deleted with the patch channel
(`d6011192`); the node-shape decisions it recorded outlived the feature they
were recorded next to. This file restores them under their original numbers
so the citations resolve. **Do not renumber**: the numbers are referenced
from code.

Provenance:

- §11, §11b, §11c, §12, §12b, §12c — recovered verbatim (lightly trimmed of
  benchmark chatter) from `packages/solid-signals/DESIGN-PATCH-CHANNEL.md` at
  `3a505c7a` (2026-08-21).
- §12d, §12e — **reconstructed 2026-09-14 from the code comments that cite
  them**; no committed version of the journal contained these entries. The
  statements below are what the code implements; the original log text is
  lost.

Related: `INTERNALS-ASYNC-STATE.md` §1 (node state fields),
`BITWISE_OPERATIONS.md` (the `_config` presence bits), `write-coalescing.md`.

---

## 11. Stage 3 opener: the core tax map (2026-08-21)

Stage 2 closed the store/list story. The remaining bottleneck was the
REACTIVE CORE's fixed costs, isolated against the r3 heap engine
(js-reactivity-benchmark, `solid-2.0-benchmarks` branch): overall
solid-next / r3 = 2.20x; / r3-solid-target = 1.67x (so ~1.3x is the cost of
Solid's target semantics; ~1.67x our implementation of them). Engine choice
CONFIRMED: r3's heap still wins the diamond/avoidable-propagation shapes it
was chosen for; alien-signals is not the answer.

The tax map (worst first):

1. CREATION — create0to1 12.9x, create2to1 6.2x, create4to1 4.1x. The
   constructor path does eager work r3 defers (owner wiring, id inheritance,
   queue/context, flag init). Fix shape: field-layout + lazy-init discipline.
2. WRITE FAST PATH — a write nobody observes pays 4x; update1to1 3.4x. Fix
   shape: one armed-check branch on the core write path; lane/transition/
   status machinery consulted only when armed.
3. PROPAGATION CONSTANTS — deep/broad 2.3–2.7x per-hop overhead; expected to
   largely fall out of (2).

Size ruling context: this is GATING/TRIMMING existing paths, not a second
engine — expected size-neutral or negative.

### §11b. Presence bits — hot-path monomorphism

Profiles named the taxes (2026-08-21, side-by-side vs r3): creation was an
ALLOCATION problem before it was a code problem (GC 66% of the create0to1
profile), and the write/notify loops were paying for _missing-property
reads_ — optional per-node slots (`_overrideValue`, `_pendingSignal` /
`_latestValueComputed`, `_snapshotValue`, `_optimisticLane`) were not part of
every node's hidden class, and reading a missing property defeats V8's inline
caches on the hottest loops.

**Rule.** Optional-slot _presence_ is recorded as bits on the always-present
`_config` (`CONFIG_OPTIMISTIC`, `CONFIG_HAS_COMPANIONS`, `CONFIG_HAS_SNAPSHOT`,
`CONFIG_HAS_LANE`, later `CONFIG_FW_CHILDREN`, …). Hot paths — `setSignal`,
`insertSubs`, commit, `recompute`, `markNode` — pay one monomorphic masked read
and touch the optional field only when its bit is set. Bits are sticky: once
set, the field read stays authoritative. Optimistic constructors no longer
fork hidden classes. Measured ~7–10% on write-path benches; core-floor ceiling
consciously +~120 B. See `constants.ts` (presence bits block).

### §11c. Stage-3 increment log

The log entries that became standing design are broken out below as §12–§12e.
Two entries recorded as _ruled out_ still govern:

- **Quiet-world memo direct-commit — RULED OUT.** #3009's `latest()`/plain-
  write purity family failed immediately: mid-batch pulls must see fresh
  values while plain reads stay committed until flush; the pending round-trip
  IS that separation. The update-path commit cost is semantic price.
- **Measurement discipline.** Daytime load inflates µs benches ~10–15% (the
  r3 control moves identically). Verify by profile shape or idle runs.

## §12. Cold-field extension (`_x`, `ext()`)

**Rule.** The optional-machinery fields — `_inFlight`, `_error`, `_blocked`,
`_pendingSources`, `_notifyStatus`, `_reask`, `_child`, `_unobserved`,
`_optimisticLane`, `_overrideValue`, the verdict/lane companion slots, and
later additions — live off the node literal in ONE lazily-allocated extension
object (`_x`, allocated by `ext()` in `core.ts`). The core literal MUST NOT
grow a field that most nodes never use. The recompute status gate collapses to
`_statusFlags !== 0 || _x !== null`; presence bits (§11b) remain the hot
gates.

Measured at landing: computed literal 39 → 29 fields, signal 13 → 12; memo
553 B → 429 B (−22%), create 330 → 280 ns; interleaved A/B create1to1 −19%,
update1to1 −12%, writeNoSubs −9%. The V8 in-object cliff (~39 fields) did NOT
drive the create bench; the wins were the memory diet. Byte cost +~740 B on
the core floor (the `_x?.` chains + the `ext` initializer).

Hazards recorded for posterity (all bit us once): `this`-sensitive callbacks
stored in `_x` must be `.call(node, …)`-dispatched; `any`-typed reads of moved
fields slip `tsc` silently (the #2951 firewall-transition entanglement died
reading a dead raw slot); `?.` flips `null` defaults to `undefined` in
comparisons; never allocate `_x` just to store a field's default.

### §12b. Zombie pair in the extension; plain-commit fast drain

`_pendingDisposal` / `_pendingFirstChild` moved into `_x` (computed literal
29 → 27; roots swap the pair for `_x: null`). Staged disposal only fires for
owners that HAVE children/disposal, so childless memos never pay it, and the
per-recompute commit gate collapses to one `_x` null check. With it: a
plain-commit fast drain in `GlobalQueue.flush` (prod-only; dev keeps the full
spine for invariant checks; semantically identical when its preconditions
hold — see `canUseSimpleSyncFlush`). Interleaved A/B: update1to1 −12% on top
of §12, create1to1 ~−10%. Per-write direct commit stays ruled out (#3009
purity). Byte cost +~300 B.

### §12c. What stays IN the core literal

Recorded as "§12c candidates" at the time; the settled rule is the inverse of
§12: a field consulted on EVERY write or on recompute scheduling stays on the
node — the per-write extension chase measurably taxes propagation chains.
`_transition` is the canonical example (`setSignal`'s transition-init check
reads it on every write; see `types.ts`). Owner-tree slimming (~10 fields of
ownership machinery per node) was identified as the next real creation lever
and left as rewrite-scale.

### §12d. Staged-rewrite fast path (notify epoch) — _reconstructed_

A re-write to a node whose subscribers were already walked, and where NOTHING
has recomputed or linked since, re-stages the value and skips the walk. The
walk is idempotent (subs marked, heap entries flag-guarded, effects queued
once), so skipping it loses nothing _as long as no subscriber has been cleaned
in between_ — a mid-batch pull can clean a marked subscriber, and a skipped
re-write would then leave it stale.

**Mechanism.** A global `notifyEpoch` (scheduler.ts) bumps on every recompute
(`recompute`, core.ts) and on every new subscriber edge (`link`, graph.ts).
`insertSubs` stamps `node._notifiedAt = notifyEpoch` before walking.
`setSignal` skips the walk iff `wasStaged && el._notifiedAt === notifyEpoch`
— and never under an optimistic lane or an armed re-ask, because those change
what a walk MEANS. The `_notifiedAt` slot is in the core literal (it is read
on every write; §12c).

Note: #3337 (A28, writes visible at flush) proposes replacing this epoch with
an unflushed-write list; see that PR for the trade.

### §12e. Signal-literal diet: `_time`, `_fn`, `_statusFlags` are computed-only — _reconstructed_

Signals carry NO `_time` / `_fn` / `_statusFlags` slots. Stores materialize
one signal per touched leaf, so signal bytes are store bytes. `_time` is
write-only on signals (every read site is computed-typed error-retry gating),
and `_fn` / `_statusFlags` read falsy-identically as missing properties on the
shared paths (`undefined` masks to 0).

**Rule.** Any path that writes `_time` must guard it with the computed check —
`if (el._fn !== undefined) el._time = clock` — writing it on a signal would
fork the lean shape (`setSignal`, core.ts; `optimisticWrite`, optimistic.ts).
