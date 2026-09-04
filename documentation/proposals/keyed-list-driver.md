# PROPOSAL: Keyed list-driver engagement (accessor rows) — for external audit

Status: PROPOSAL ONLY. Nothing in this document is implemented. It exists to be
audited before any code is written. The author (agent) has made several
attribution and coverage errors in the preceding work (§9 lists them); the
auditor should treat every claim here as unverified until argued from the code.

Repos/branches involved:
- `solid-edit-script` worktree, branch `store-edit-script` (solid monorepo)
- `dom-expressions-patch` worktree, branch `stage4-ssr` (compilers + runtime)
- Design record: `packages/solid-signals/DESIGN-PATCH-CHANNEL.md` (§16 has the
  identity ruling this builds on)

---

## 1. Context: the seam as built (three independent layers)

1. **Self-declaration (runtime).** `For` is an ordinary component. Inside its
   own body it attaches `$ll = { each, row }` to the accessor it returns
   (`packages/solid/src/client/flow.ts`). Nothing detects For; it opts in. Any
   list primitive may attach the same marker.
2. **Marker check (runtime).** dom-expressions `insert` offers any function
   accessor carrying `$ll` to `driveList`; a `false` return falls through to
   calling the accessor (classic mapArray path).
3. **Shape proof (compile time, inert).** The compiler stamps
   (`rowProof`, `Symbol.for("solid.pure-row")`) any single-param function whose
   body is exactly one compiled template with all dynamics landing in one
   patch body on the param. Stamping is applied by syntax anywhere, carries no
   meaning until a driver consults it, and involves no knowledge of For,
   children props, or lists.

**Identity ruling (landed 2026-08-24, DESIGN §16a):** the driver implements the
identity semantics the view declares, never the reconcile key's. Deep lists
coincide by construction (adoption preserves proxy identity per key). Shallow
reference-keyed lists rebuild replaced records. `keyed={fn}` lists currently
DECLINE the driver, because their rows receive accessors under the classic
contract and the driver binds raw records.

**Consequence being addressed:** shallow + declared-key lists have no fast
path. Measured on octane's dbmon (same machine, same morning):

| op           | deep+driver (honest) | shallow keyed-classic | shallow old (RETRACTED, unsound) | octane |
|--------------|----------------------|-----------------------|----------------------------------|--------|
| mount        | 5.80                 | 7.05                  | 4.85                             | 4.81   |
| tick         | 1.56                 | 1.83                  | 1.40                             | 1.42   |
| tick_partial | 0.45                 | 0.72                  | 0.44                             | 0.50   |
| remount      | 4.38                 | 4.58                  | 3.79                             | 3.77   |
| sort         | 2.04                 | 2.23                  | 2.06                             | 1.54   |
| unmount      | 0.53                 | 0.32                  | 1.60                             | 0.42   |

Target: recover ~the retracted shallow numbers (tick ≈1.40, partial ≈0.44)
under correctly declared semantics. This is an optimization of an
already-winning configuration (deep+driver beats keyed-classic ~7% geomean),
NOT load-bearing for stage 2's case.

---

## 2. Proposal A — seam identity contract (runtime only)

Replace the currently-landed `keyed` forwarding on `$ll` with a
component-neutral field:

```ts
$ll = {
  each: () => T[],
  row: (item) => Node,            // raw rows
  identity: "reference" | "positional" | ((item: T) => any)
}
```

- `For` translates its own prop: `keyed` absent/`true` → `"reference"`,
  `false` → `"positional"`, fn → the fn. The translation lives in For's body.
- The driver implements the seam's semantics and has no knowledge of For's
  API. Rationale: any keyed-list renderer must define "what makes a row the
  same row" — reference, position, or key. The seam carries only this
  domain-forced vocabulary, never component vocabulary (boundary rule).

## 3. Proposal B — accessor-row stamp variant (compile time)

A second row-proof production, `param().member`:

- Grammar line, exactly: **a bare, zero-argument call of the row parameter
  itself at the head of a member chain** (`db().name`,
  `db().queries[0].elapsed` with static/numeric steps). NOT `helper(db).x`,
  NOT `db.child()`, NOT `db()(…)`, NOT calls with arguments.
- Produces a DISTINCT stamp variant (e.g. the stamp value `"accessor"` instead
  of `true`) recording which shape was proved.
- Emitted body is unchanged machinery: it runs against a RESOLVED subject.
  Classic codegen wraps it in an effect that computes `db()` per run (correct
  accessor semantics with zero driver involvement); the driver passes the
  current record directly.
- **Scope constraint (load-bearing):** the production is admitted ONLY by
  `recordPureRow` (row-proof analysis). General patchDriver eligibility for
  template dynamics is untouched. Reason: a registered patch binds to a
  specific record; only the list driver owns subject lifetime (it re-binds or
  rebuilds on every identity transition). `x().member` in general position
  would register against a bind-time snapshot and go stale when `x()` starts
  returning a different object — the existing subject-stability rule exists
  for exactly this.
- Implemented in BOTH compilers (Babel `recordPureRow` in dom/template.ts;
  Oxc `record_pure_row` in dom/element.rs) with byte-parity tests.

## 4. Proposal C — driver accessor binding (runtime)

For engaged lists with `identity: fn` and accessor-variant rows:

- Each row binds with a stable per-row closure: `rowFn(() => currentRecord)`.
  The closure reads a per-row slot the driver owns.
- Key-retained replacement (same key, new record): update the slot, then
  re-apply the row's collected bodies with `(next, prev)` — this is the
  EXISTING slot/value channel (`applySlot` in-place branch, currently
  unreachable), re-pointed at declared-key lists. No third dispatch path.
- Structural ops (add/remove/move) ride the existing row-ops LIS apply
  unchanged.
- Pairing matrix (engagement decision, in order):
  1. row not stamped → decline (classic).
  2. `identity: "reference"` + raw-variant stamp → engage; replacement
     REBUILDS (landed behavior).
  3. `identity: fn` + accessor-variant stamp → engage; replacement value-ticks
     in place (this proposal).
  4. any other pair (reference+accessor, fn+raw, positional+either) → decline.
- Mismatch soundness (S1 below): classic is always correct for whatever the
  author wrote, because the author's row body must match their own `keyed`
  declaration for the CLASSIC path to function at all (a raw-reading body
  under `keyed={fn}` receives an accessor and is broken with no driver in the
  picture; vice versa for `db()` under reference keying).

## 5. Dev-mode checks

- Key agreement: when ops from a reconcile walk (keyed by the reconcile
  keyFn) apply to an `identity: fn` list, dev mode spot-checks
  `identity(next) === identity(prev)` on value-ticked slots and warns on
  disagreement (the reconcile key and the view key describing different
  identities is an authoring error that would otherwise be silent).
- The existing dev ownership assertion (row builds must attach nothing to the
  list owner) applies to accessor rows unchanged.

## 6. Soundness claims (each falsifiable — auditor: try to break these)

- **S1 (fallback equivalence):** for every (identity, stamp-variant, authoring)
  combination, declining to classic produces the author-intended behavior.
  Falsify by exhibiting a row body + keyed declaration that works classically
  but breaks when the driver declines. (Decline = literally calling the
  accessor; hard to see how it could differ, but that's the point of audit.)
- **S2 (engagement equivalence):** for every engaged combination, driver DOM
  behavior ≡ classic DOM behavior for the same op sequence: same nodes
  created/removed/moved/retained, same content, same event/ref/handler
  timing-observable state. Proposed as an executable test matrix (see §8), not
  an argument. KNOWN nuance: bound-data handlers (`onClick={[select, db().id]}`)
  evaluate once at build and go stale after key-retained replacement — in BOTH
  classic keyed mapArray and the driver (parity, author's semantics). The
  matrix must pin this as EQUAL behavior, not fix it.
- **S3 (subject lifetime):** accessor-variant stamps are consumable only by
  driveList (the only consumer that re-binds on identity transitions).
  Falsify by finding another code path that consults stamps or registers
  patches from a `param().member` body.
- **S4 (no component coupling):** compiler stamps by shape anywhere (inert);
  seam speaks domain vocabulary; For translates its own API in its own body.
  Falsify by finding any point where compiler output depends on the component
  named `For`, or where the driver reads For-specific vocabulary.
- **S5 (shape rules):** no new named fields on store targets (the pc-extension
  rule, DESIGN §16d); driver-side per-row slots live in driver locals, not on
  targets. Falsify by finding a new field on `StoreNextTarget` or >20 named
  props on a target in this design.

## 7. Risks the author already sees (auditor: look for more)

- **R1:** stale bound-data handlers on key-retained replacement (parity with
  classic, but a semantics surprise worth documenting for authors).
- **R2:** the slot-index rebasing under mixed value-ticks + structural moves
  (`applySlot` after row-ops in one batch) was tested under the old
  key-semantics regime; the matrix must re-cover it under `identity: fn`.
- **R3:** two-compiler byte-parity for the new production (historically a
  source of drift; §3c/§3d parity harness covers it but the fixture set must
  include accessor rows).
- **R4:** hydration: accessor rows must claim server rows identically
  (claim+register, no writes). The claim path binds rows once; the accessor
  closure must be initialized before first body application.
- **R5:** transitions/optimistic: value-ticks ride the same apply queue with
  transition stamping; nothing new is believed to be needed — verify against
  the PR-A gauntlet tests extended to identity-fn lists.
- **R6:** `each`-watch identity swaps (`s.rows = newArr`) on identity-fn
  lists: the synthetic full-window op currently matches by RAW identity; for
  identity-fn lists it must match by the declared key. Small, easy to miss.

## 8. Acceptance gates (all must pass before merge)

1. **Equivalence matrix test** (the trust-restoring artifact): for each
   identity mode × op sequence (replace-aligned, replace-through-move, add,
   remove, reorder, clear, identity-swap, mixed batch), assert driver-engaged
   DOM ≡ classic DOM node-for-node (identity, content, order), by running the
   same fixture with the driver enabled and with stamps stripped.
2. Shallow-keyed dbmon through octane's harness: gate PASS + tick ≤ ~1.45,
   partial ≤ ~0.50 (recovering the retracted numbers under honest semantics),
   with deep+driver numbers unchanged.
3. Compiler parity suite green with accessor-row fixtures added (Babel ≡ Oxc).
4. Full test matrix green (signals/solid/web incl. hydration claim specs).
5. Coverage report artifact: compiled fixture corpus, listing every `For` row
   and its status (raw-stamped / accessor-stamped / unstamped+why) — the
   audit trail for what each grammar admits, diffable across future changes.
6. No store-target shape changes (probe with `%HasFastProperties` script).

## 9. Documented errors by the author tonight (audit these areas hardest)

1. Claimed §3c probe removal was coverage-neutral; it was not (variable-shape
   rows lost engagement; uibench). Verified only fixtures whose rows stamp.
2. Claimed the dbmon fixture "keeps keyed + keeps its 1.40/0.44" — false at
   the time (keyed rows take accessors, cannot stamp, driver declined).
3. Attributed the js-framework select regression to per-record patch
   amplification; actual cause was the wk-bound's plainProto guard vs overlay
   prototypes (store layer), found only after compiling the fixture.
4. Measured "parity" from single benchmark runs twice before interleaved A/B
   showed regressions (±20% per-suite drift on this machine).
5. Stage-2-era claims (uibench "1.09x inferno", shallow gate pass) retracted;
   see DESIGN §16b/§16c for what replaced them.

## 10. Explicit non-goals

- No change to general patch eligibility, Tier-2 record patches, or any
  non-list template compilation.
- No runtime purity probing in any form.
- No attempt to engage variable-shape rows (uibench `cells()` style): those
  remain classic unless an author hand-stamps (`rowProof`, documented promise,
  dev-asserted) — which is an authoring decision, not part of this proposal.
