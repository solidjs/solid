# Frames client — function-by-function re-attribution under A0 (2026-10-06)

Branch `size/frames-a0-reattribution` off `next` @ `23176235d`. **Nothing here
changes an engine**: this document and nothing else. Companions: the
server-components size audit (`sc-layer-audit.md`, `size/sc-audit` @
`0bb67ff38` — its §2 attribution and Appendix A are the unit list this
document re-classifies), the frames rulings
(`documentation/server-components/frames-rulings.md`, `spec/frames-rulings` @
`757aba41c` — the Principle and the sixteen rulings each marked `Restates:`
or `Frames-specific:`), the principles doc's A0
(`server-components-principles.md` §2, same branch), the consistency
contract (`frames-consistency-contract.md`, merged in #3813, with its
twenty-two `test.fails` under `packages/web/test/consistency/`), and the
signals core's L2 section (`packages/signals/docs/SPEC-ASYNC-SEMANTICS.md`).

The maintainer's question, verbatim: *"in all honesty our frames solution is
huge — almost 3× our original target."* The frames eager-client scenario
ships at **13,770 B brotli / 43,310 B minified** against the principles doc's
§6 budget of ≤ 7,800 B (§6 wrote the budget as min+gzip, ≈ 7.0 KB br; the
3× is read against brotli, and this document reads it the same way). The SC
size audit's best case — packaging plus a scoped rulings pass — floored the
scenario at ≈ 10.5 KB br. **That audit classified before A0**: its
"structural" meant *a frames ruling requires it*. Under A0, a frames ruling
that restates a core rule does not justify frames-side bytes. This document
re-classifies every unit against A0 and measures the floor of "frames that
is only a transport", so the maintainer can decide whether the gap is a
**second-model problem** (fixable by deletion) or a **scope problem** (a
product decision about feature tiers).

_Status: in progress — sections are committed as they land._

---

## 0. The rubric

Every unit of the frames eager-client scenario (and the frames / sf units of
`page: base`) is classified into exactly one of four classes. A unit whose
bytes split across classes is classified by its majority and carries a
residue note; the class totals are given both ways (by whole unit, and with
residue re-attributed).

- **T — transport.** What a frame needs to fetch, decode, morph, claim and
  refetch/switch, using the core for everything async: fetch/request and
  the response → binding resolution; chunk framing and parsing; the eager
  half of the codec seam; morph of foreign markup into a range (A7,
  identity-first); hydration claim of server nodes; address → store write
  (A3); site → bound address pull (A4); references and the flight codec;
  the hydration-key payload. **Keep.**
- **R — restates core.** The frames side implements something the core
  already provides under A0: a second reveal engine where the core has
  landings; a shell gate where `<Loading>` has pending state; a version
  space where a memo has a value; waiters/holds where the hold model has
  `holdNode`/`land`; staging-at-commit where the transaction stages;
  dedupe/tables where supersession already drops the stale answer; error
  state where `<Errored>` exists; its own "done" accounting. For each R unit
  the core primitive it duplicates is named (`file:function` in
  signals/solid/web) and what remains if frames routed through it.
- **F — feature.** A capability above the minimal transport: live/GET
  re-emission (E.a), binding/attribute slots (E.c, Stage 7), container
  traces (N), staging/preview at commit (#3759 — the *capability*; its
  *carrier* is R, see §1.3), document-face duality beyond the t = 0 claim,
  regions/nested frames, asset loading, element claims and the
  `frame:applied` event (the router contract), dev/diagnostics in prod.
- **D — dead/incidental.** Unreachable, duplicated seams (the audit's §4
  list), compat shims.

The method is the SC audit's: a source-map function-size tool over the
scenario's minified entry chunk (rebuilt under `tmp-tools/`, not committed;
§7 reproduces it) charges every mapped byte to the innermost named function
in the dist source; the pieces sum to the chunk exactly. Brotli per class is
measured by removing the class from an edited dist copy where that is
feasible (§2, §3), and estimated at the layer's observed ratio (≈ 0.32 on
the frames scenario) where it is not.

---

## 1. Classification

_(pending — the unit table, class totals and the top-40 land here)_

---

## 2. The transport floor

_(pending)_

---

## 3. Tiers

_(pending)_

---

## 4. Verdict

_(pending)_

---

## 5. Open questions

_(pending)_

---

## 6. Sources

_(pending)_

---

## 7. Reproducing

_(pending)_
