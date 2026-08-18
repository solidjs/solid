# Findings log — rule assertions vs the shipped store

Method (INTERNALS-STORE-STATE.md §5c): rule-derived tests run against the
shipped implementation first; every violation gets a deliberate ruling — bug
the rewrite fixes, or rule written wrong. Entries are numbered and referenced
from test comments.

## FINDING-1 — nested reconcile identity skip is unsound against diverged nodes

- **Date**: 2026-08-17. **Test**: `tests/store/reconcile-resend-identity.test.ts`
  ("re-sending the original array after a flushed row write restores row
  values", marked `it.fails` on shipped).
- **Behavior**: after a *flushed* setter write (`d.rows[0].v = 50` — value
  committed to the row's node; raw untouched since 2.0 never mutates
  sources), re-sending the original array reference via
  `reconcile(rows, "id")(d.rows)` leaves the store at `50`. Expected `1` —
  "reconcile makes `next` the authoritative base."
- **Root cause**: `applyStateFast` early-returns on `next === previous`
  (store/reconcile.ts, the swap-path identity check). The guard is only
  structural for *staged* overrides (they route to the slow path); a
  committed node divergence is invisible to it, so the identity skip proves
  nothing and the diff never runs.
- **Scope**: nested path only. The root re-send (`setS(reconcile(data, key))`)
  and the derived-store recompute re-returning the same reference both
  restore correctly (2/3 tests pass on shipped).
- **Real-world shape**: any cache that returns the same object graph on
  refetch (SWR-style hit) fails to revert locally-written values on
  reconcile.
- **Scope refinement (2026-08-17)**: a FRESH reference carrying the original
  values DOES restore on shipped (control test passes) — the per-key node
  writes already compare against the current view. The unsoundness is
  narrowly the `next === previous` same-reference early-return, not the diff
  baseline.
- **Ruling (Ryan, 2026-08-17)**: reconcile's diff baseline is the **current
  view** (signal parity — signals compare writes against current value, not
  original). FINDING-1 stays a bug the rewrite fixes by construction: after a
  setter write privatizes the backing, the re-sent source fails
  `incoming === backing` and the diff runs. Guiding principle recorded with
  the ruling: the store takes no responsibility for mutation outside
  reactivity (immutable-input convention, same as signals) — defending
  against user indiscipline is where perf is lost. The identity skip itself
  is sound *when keyed on the current backing*; shipped's bug is keying it
  on raw, which stopped being "current" when 2.0 stopped mutating sources.

## FINDING-2 — key ADDED by in-window reconcile survives optimistic settle

- **Date**: 2026-08-17. **Test**: `tests/store/adoption-lane-rollback.test.ts`
  ("a key added by an in-window reconcile reverts at settle", `test.fails`).
- **Behavior**: inside an action window, `reconcile({rows, tag: "tentative"})`
  on an optimistic store shows tentatively (correct); at settle, row values
  and array length revert (correct) but the added object key leaks —
  `s.tag === "tentative"` and `"tag" in s === true` persist after settle.
- **Contrast**: optimistic *deletes* revert correctly (pinned,
  `optimistic-undefined-override` test 5); additions do not.
- **Assessment**: the key-set rollback gap RUL-8 predicted, present even
  single-transaction. The rewrite's key-set node carries per-transaction
  membership edits; rollback discards them by construction.
- **Ruling**: bug the rewrite fixes. Shipped hotfix at Ryan's discretion.

## FINDING-3 — snapshot breaks cycle identity on a written cyclic object

- **Date**: 2026-08-17. **Test**:
  `tests/store/shared-child-multiparent.test.ts` ("snapshot preserves cycle
  identity on a written cyclic object", `it.fails`).
- **Behavior**: `node.self = node`, wrap, write `d.root.name`; then
  `snapshot(s.root).self` is a *second copy* (internally cyclic:
  `self: [Circular]`) rather than the snapshot root itself — the copy routine
  duplicated one logical object.
- **Contrast**: symbol-key cycles on untouched objects preserve identity
  (pinned, recon-snap R29 "cycles through symbol keys preserved"); the
  written string-key self-cycle misses the seen-map.
- **Assessment**: violates R29's shared-references-stay-shared contract. The
  rewrite's copy routine must register the copy in the seen-map *before*
  descending into children.
- **Ruling**: bug the rewrite fixes. Low real-world frequency (cyclic store
  data is rare); shipped hotfix likely not worth it.

## Positive controls (shipped agrees with the contract)

- Shared child via two parents: write through path A visible through path B
  on reads, subscription, and snapshot; snapshot keeps the child shared
  (one copy); source untouched (`shared-child-multiparent.test.ts`, passing).
  Validates the RUL-12 registration-resolution proposal.
- In-window reconcile tentative visibility + settle revert of values, length,
  and captured-proxy views (`adoption-lane-rollback.test.ts`, passing).
- Fresh-reference reconcile restores flushed setter writes (FINDING-1's
  control): shipped is view-parity everywhere except the same-reference
  early-return.
- Signal-form refetch-hold parity (`optimistic-signal-refetch-hold.test.ts`,
  2/2): RUL-4's evidence.
