/**
 * Optimistic list-mutation matrix — mutations × contexts × readers over a
 * keyed row list, with a plain `createStore` as the oracle.
 *
 * Why: two user-reported optimistic bugs in one week were plain list
 * mutations the array / `For` suites cover exhaustively but the optimistic
 * path had never seen. #3662: two overlapping optimistic moves under a keyed
 * `For` with a nested `<Show>` disposed the lane's inner effect (fixed in
 * #3669). #3672: a chained optimistic store (`createOptimisticStore(base)`)
 * dropped a write back to the pre-action value, a re-add of a deleted key
 * and a pop of an appended row (fixed in #3674). This file makes
 * every optimistic list bug one more row instead of a bespoke spec.
 *
 * Oracle (visibility-oracle-store.states.ts pattern): the plain store's
 * rendered output for the same cumulative mutation list is the expected
 * frame; the optimistic contexts must match it at every checkpoint on the
 * effect channel AND the untracked channel (A17: an active override is the
 * displayed value on both), and between the optimistic apply and the settle
 * the effect channel may show nothing but those two frames (A18: the
 * override lives exactly as long as its transaction; the revert and the
 * landing truth are one frame, no flash of the pre-action base). Ambient
 * writes are visible only at the flush that carries them and revert with it
 * (A28 (5)) — the post-settle probe uses that to prove the action's
 * transaction is gone.
 *
 * Contexts:
 *  1. plain store — the oracle checks itself against plain JavaScript.
 *  2. one action pending on a gate; confirmed with the SAME truth, and
 *     separately with a DIFFERENT truth (the mutation plus a server row).
 *  3. two overlapping actions with distinct mutations, resolved in both
 *     orders (#3662).
 *  4. chained over a base store with the base committing OUTSIDE the action,
 *     while the action pends and after it settled; then a second action
 *     writes the inverse — the write back to the pre-action value (#3672).
 *  5. a mutation and its inverse in one action, and across two actions.
 *
 * Truth sources: `derived` (the store derives from a signal the action sets
 * after its await — the playground shape) and `chained`
 * (`createOptimisticStore(base)` with `setBase` after the await — #3672).
 *
 * Readers: `mapArray` keyed by id, `mapArray` by index, `repeat` over the
 * length — each row with an `onCleanup` and a nested memo (the `<Show>`
 * stand-in), published through the nested-insert effect shape of
 * optimistic-move-keyed-show-3662.test.ts — and a `createMemo` over the
 * joined rows (memos surface revert bugs a render effect's replay hides).
 *
 * Invariants at every checkpoint besides frame equality: no row instance is
 * displayed after its cleanup ran; after settle no republish, the untracked
 * read serves the truth, an ambient probe write reverts at its flush, every
 * retired row instance was cleaned up exactly once and every displayed one
 * not at all; after dispose every instance was cleaned up exactly once.
 *
 * Bugs found are pinned as `it.fails` rows in KNOWN_FAILURES below, each
 * with the frame it fails at — not fixed here. Not reached in the first cut:
 * the web-level `<For>` / `<Show>` spec.
 */
import { afterEach, describe, expect, it } from "vitest";
import { action, createRoot, flush, resetErrorHalt, untrack } from "../../src/index.js";
import {
  MUTATIONS,
  PAIRS,
  PROBE_ROW,
  READERS,
  SERVER_ROW,
  SOURCES,
  createSource,
  frameOf,
  gate,
  oracleFrame,
  pureFrame,
  renderList,
  settle,
  type Mutate,
  type Mutation,
  type ReaderKind,
  type Rendered,
  type Source,
  type SourceKind
} from "./optimistic-list-mutation-matrix.harness.js";

afterEach(() => {
  resetErrorHalt();
  flush();
});

// ── known failures (pinned, not fixed) ──────────────────────────────────────
//
// Every row below fails deterministically on `next` (first pinned @
// 658eecdb7, #3674 landed; two runs, identical sets). A listed row runs as
// `it.fails`; when a fix lands the row starts passing and vitest reports it,
// so the entry must be removed with the fix — #3674 cleared every F2 row and
// the chained `clear` row of F5 while this file was being written; the F3 /
// F5 fix (optimistic-untracked-reads-f3-f5.test.ts) cleared every F5 row and
// every chained F3 row, and moved the derived F3 rows to F4 / F1 (the hole
// checkpoint passes; they fail later on the finding underneath). Findings,
// by failing frame:
//
// F1  `mapArray` by index (`keyed: false`) does not publish the optimistic
//     frame. Any mutation that changes the item at an existing index shows
//     the PRE-ACTION frame after the apply flush while the untracked read
//     shows the mutation; the frame lands only at settle. The per-row
//     signals mapArray writes with `setSignal` inside the lane pass are held
//     by the action's transaction instead of joining the lane frame. Both
//     sources; every context that applies such a mutation.
// F2  #3672 (chained store): a second action's write back to the base's
//     previous value was dropped — frame "B (inverse) applied" showed A's
//     frame. Fixed by #3674; ctx4 now fails only through the index reader
//     (F1). Kept as the context's history.
// F3  Two drafts whose slot writes overlap left a stale `length`: a hole.
//     "move head->tail + move middle" showed `b,c,e,f,d,a,<undefined>`
//     (length 7) after both applied; a move or rotate undone by a second
//     action showed `a..f,<undefined>` at "B (inverse) applied". The
//     `length` draft arm re-composed the prior draft's overrides onto the
//     seeded backing (every other draft channel gates on
//     draftSeesOverrides). Fixed with F5; the derived rows now reach the
//     settle and fail there on F4 (a stray frame of A's truth), the index
//     rows on F1 — re-tagged below. Kept as the context's history.
// F4  Derived source (`createOptimisticStore(() => truth())`): the first
//     action's settle disturbs the second action's pending override — a
//     stray frame of A's truth without B's inverse (`b,a,c,d,e,f` for swap),
//     or with a duplicated row (`a,a,b,c,d,e,f` for delete head), between
//     "A confirmed" and "B confirmed"; in ctx3 "A confirmed" after B can
//     show B's truth lost (`swap+swap` resolved B then A: `b,a,c,d,e,f`
//     instead of `b,a,c,d,f,e`) and the untracked read can differ from the
//     effect channel (`insert head + delete tail`: 7 rows vs 6). The former
//     F3 derived rows fail at "settles" with A's truth as a stray frame
//     (`f,a,b,c,d,e` for rotate left).
// F5  Derived source, a truth landing whose length differs from the
//     optimistic frame (every `differ` insert/delete/clear through the
//     keyed mapArray): the landing superseded the `length` / presence
//     overrides (#3331) and tracked reads served the staged truth while the
//     untracked store paths (the length view, `in`) still composed the
//     override, so mapArray's pass snapshotted a short `_items` and the
//     NEXT pass called the key function with `undefined` (a user key fn
//     throws and halts the scheduler). Fixed: the untracked paths follow
//     the same reader-aware selection as `get`. Kept as history.
// F6  Derived source through `repeat`, `replace-all same ids reordered` and
//     `delete then re-add same id`: after settle the ambient probe push does
//     NOT revert at its flush — an override outlives the action.
const KNOWN_FAILURES: Array<{ finding: string; names: string[] }> = [];

const ALL = READERS;
const IDX = ["mapArray-index"] as const;
const rowsOf = (
  finding: string,
  readers: readonly ReaderKind[],
  sources: readonly SourceKind[],
  template: (reader: ReaderKind, source: SourceKind) => string[]
) => {
  const names: string[] = [];
  for (const r of readers) for (const s of sources) names.push(...template(r, s));
  KNOWN_FAILURES.push({ finding, names });
};
const ctx2 = (variants: string[], muts: string[]) => (r: ReaderKind, s: SourceKind) =>
  variants.flatMap(v => muts.map(m => `[reader=${r}][source=${s}] ${v}: ${m}`));
const ctx3 = (orders: string[], pairs: string[]) => (r: ReaderKind, s: SourceKind) =>
  orders.flatMap(o => pairs.map(p => `[reader=${r}][source=${s}] ${p}, resolved ${o}`));
const ctx4 = (muts: string[]) => (r: ReaderKind) =>
  ["WHILE pending", "AFTER settle"].flatMap(t =>
    muts.map(m => `[reader=${r}] base commits ${t}, then inverse action: ${m}`)
  );
const ctx5 = (muts: string[]) => (r: ReaderKind, s: SourceKind) =>
  muts.map(m => `[reader=${r}][source=${s}] across two actions: ${m}`);

const REORDERS = [
  "swap a<->b",
  "reverse",
  "rotate left",
  "move head->tail",
  "move tail->head",
  "move middle (c->4)"
];
const REPLACES = ["replace-all disjoint ids", "replace-all same ids reordered"];
const INSERT_DELETE = [
  "insert head",
  "insert middle",
  "insert tail",
  "delete head",
  "delete middle (d)",
  "delete tail"
];
const READD = "delete then re-add same id (c -> tail)"; // a move of c to the tail
const SLOT_CHANGERS = [
  ...REORDERS,
  READD,
  "insert head",
  "insert middle",
  "delete head",
  "delete middle (d)",
  ...REPLACES
];

// F1
rowsOf("F1", IDX, SOURCES, ctx2(["confirm", "differ"], SLOT_CHANGERS));
rowsOf(
  "F1",
  IDX,
  SOURCES,
  ctx3(["A then B", "B then A"], ["update text in place (c) + swap a<->b"])
);
rowsOf("F1", IDX, ["chained"], ctx4(SLOT_CHANGERS));
rowsOf("F1", IDX, SOURCES, ctx5(["replace-all disjoint ids", "replace-all same ids reordered"]));
// former F3 rows (the hole is fixed): the index reader fails on F1, every
// other reader on the derived source fails at "settles" on F4; the chained
// keyed / repeat / memo rows pass.
const OVERLAP_PAIR = ["move head->tail + move middle (c->4)"];
const OVERLAP_INVERSES = ["move head->tail", "move tail->head", "rotate left", READD];
rowsOf("F1", IDX, SOURCES, ctx3(["A then B", "B then A"], OVERLAP_PAIR));
rowsOf("F1", IDX, SOURCES, ctx5(OVERLAP_INVERSES));
rowsOf(
  "F4",
  ["mapArray-keyed", "memo", "repeat"],
  ["derived"],
  ctx3(["A then B", "B then A"], OVERLAP_PAIR)
);
rowsOf("F4", ["mapArray-keyed", "memo", "repeat"], ["derived"], ctx5(OVERLAP_INVERSES));
// F1 / F4 — both orders of the remaining pairs, and the remaining inverses
// across two actions: the index reader on both sources (F1 underneath),
// every other reader on the derived source (F4), plus the keyed reader on
// the chained source for `insert head + delete tail` resolved B then A.
rowsOf(
  "F1/F4",
  IDX,
  SOURCES,
  ctx3(["A then B", "B then A"], ["insert head + delete tail", "swap a<->b + swap e<->f"])
);
rowsOf(
  "F4",
  ["mapArray-keyed", "memo", "repeat"],
  ["derived"],
  ctx3(["A then B", "B then A"], ["insert head + delete tail", "swap a<->b + swap e<->f"])
);
rowsOf(
  "F4",
  ["mapArray-keyed"],
  ["derived"],
  ctx3(["B then A"], ["update text in place (c) + swap a<->b"])
);
rowsOf("F4", ["mapArray-keyed"], ["chained"], ctx3(["B then A"], ["insert head + delete tail"]));
const UNDONE = [
  "swap a<->b",
  "reverse",
  "move middle (c->4)",
  "insert head",
  "insert middle",
  "delete head",
  "delete middle (d)"
];
rowsOf("F1", IDX, ["chained"], ctx5(UNDONE));
rowsOf("F1/F4", IDX, ["derived"], ctx5([...UNDONE, "insert tail", "delete tail"]));
rowsOf(
  "F4",
  ["mapArray-keyed", "memo", "repeat"],
  ["derived"],
  ctx5([...UNDONE, "insert tail", "delete tail"])
);
// F5 — fixed, no rows pinned
// F6
rowsOf("F6", ["repeat"], ["derived"], ctx2(["confirm"], ["replace-all same ids reordered", READD]));
rowsOf("F6", ["repeat"], ["derived"], ctx5(["replace-all same ids reordered"]));

const KNOWN = new Set(KNOWN_FAILURES.flatMap(k => k.names));
const isKnownFailure = (name: string) => KNOWN.has(name);
const row = (name: string, fn: () => Promise<void> | void) =>
  (isKnownFailure(name) ? it.fails : it)(name, fn);

// ── fixture ─────────────────────────────────────────────────────────────────

interface Fixture {
  kind: ReaderKind;
  source: Source;
  rendered: Rendered;
  dispose: () => void;
  run: (m: Mutate, g: { promise: Promise<void> }, confirm?: Mutate) => Promise<void>;
}

function setup(kind: ReaderKind, sourceKind: SourceKind): Fixture {
  let source!: Source;
  let rendered!: Rendered;
  const dispose = createRoot(d => {
    source = createSource(sourceKind);
    rendered = renderList(kind, () => source.view);
    return d;
  });
  flush();
  const run = action(function* (m: Mutate, g: { promise: Promise<void> }, confirm?: Mutate) {
    source.setView(m);
    yield g.promise;
    if (confirm) source.commitTruth(confirm);
  });
  return { kind, source, rendered, dispose, run };
}

const untrackedFrame = (f: Fixture) => untrack(() => frameOf(f.source.view));

/** The frame both channels must show for `muts` applied to INITIAL. */
function expectFrame(f: Fixture, label: string, muts: Mutate[]): string {
  const expected = oracleFrame(f.kind, muts);
  expect(f.rendered.violations, `${label}: invariants`).toEqual([]);
  expect(f.rendered.frames.at(-1), `${label}: effect channel`).toBe(expected);
  expect(untrackedFrame(f), `${label}: untracked channel`).toBe(expected);
  return expected;
}

/** Between two checkpoints the effect channel showed only `allowed` frames. */
function expectOnlyFrames(f: Fixture, label: string, since: number, allowed: string[]) {
  const between = f.rendered.frames.slice(since);
  const stray = between.filter(fr => !allowed.includes(fr));
  expect(stray, `${label}: stray frames between checkpoints`).toEqual([]);
}

/** Everything an action's settle must leave behind. */
async function expectSettled(f: Fixture, label: string, muts: Mutate[]) {
  const expected = expectFrame(f, label, muts);
  expect(frameOf(f.source.truth()), `${label}: truth`).toBe(pureFrame(muts));

  // no stale republish after the reveal
  const n = f.rendered.frames.length;
  flush();
  await Promise.resolve();
  flush();
  expect(f.rendered.frames.length, `${label}: republish after settle`).toBe(n);

  // the action's transaction is gone: an ambient write reverts at its flush
  f.source.setView(d => void d.push({ ...PROBE_ROW }));
  flush();
  expect(untrackedFrame(f), `${label}: probe write reverted`).toBe(expected);
  expect(f.rendered.frames.at(-1), `${label}: probe write reverted (effect)`).toBe(expected);
  expect(f.rendered.violations, `${label}: invariants after probe`).toEqual([]);

  // row lifetimes
  for (const [inst, cleanups] of f.rendered.instances) {
    const displayed = f.rendered.shown.includes(inst);
    expect(cleanups, `${label}: ${displayed ? "displayed" : "retired"} row ${inst} cleanups`).toBe(
      displayed ? 0 : 1
    );
  }
}

function expectDisposed(f: Fixture) {
  f.dispose();
  flush();
  for (const [inst, cleanups] of f.rendered.instances)
    expect(cleanups, `after dispose: row ${inst} cleanups`).toBe(1);
}

const noopMutate: Mutate = () => {};
const differ =
  (m: Mutation): Mutate =>
  d => {
    m.apply(d);
    d.push({ ...SERVER_ROW });
  };

// ── context 1: the oracle checks itself ─────────────────────────────────────

describe("ctx1 plain store — the oracle agrees with plain JavaScript", () => {
  for (const kind of READERS) {
    for (const m of MUTATIONS) {
      row(`[reader=${kind}] ${m.name}`, () => {
        expect(oracleFrame(kind, [m.apply])).toBe(pureFrame([m.apply]));
        expect(oracleFrame(kind, [m.apply, m.inverse])).toBe(pureFrame([]));
      });
    }
  }
});

for (const kind of READERS) {
  for (const src of SOURCES) {
    const tag = `[reader=${kind}][source=${src}]`;

    // ── context 2: one action ───────────────────────────────────────────────
    describe(`ctx2 one action ${tag}`, () => {
      for (const m of MUTATIONS) {
        row(`${tag} confirm: ${m.name}`, async () => {
          const f = setup(kind, src);
          expectFrame(f, "initial", []);
          const g = gate();
          const done = f.run(m.apply, g, m.apply);
          flush();
          const optimistic = expectFrame(f, "optimistic apply", [m.apply]);
          const since = f.rendered.frames.length;
          g.release();
          await settle(done);
          expectOnlyFrames(f, "apply -> confirm", since, [optimistic]);
          await expectSettled(f, "confirmed", [m.apply]);
          expectDisposed(f);
        });

        row(`${tag} differ: ${m.name}`, async () => {
          const f = setup(kind, src);
          expectFrame(f, "initial", []);
          const g = gate();
          const done = f.run(m.apply, g, differ(m));
          flush();
          const optimistic = expectFrame(f, "optimistic apply", [m.apply]);
          const since = f.rendered.frames.length;
          g.release();
          await settle(done);
          expectOnlyFrames(f, "apply -> truth", since, [
            optimistic,
            oracleFrame(kind, [differ(m)])
          ]);
          await expectSettled(f, "truth landed", [differ(m)]);
          expectDisposed(f);
        });
      }
    });

    // ── context 3: two overlapping actions ──────────────────────────────────
    describe(`ctx3 two overlapping actions ${tag}`, () => {
      for (const [a, b] of PAIRS) {
        row(`${tag} ${a.name} + ${b.name}, resolved A then B`, async () => {
          const f = setup(kind, src);
          const ga = gate();
          const doneA = f.run(a.apply, ga, a.apply);
          flush();
          expectFrame(f, "A applied", [a.apply]);
          const gb = gate();
          const doneB = f.run(b.apply, gb, b.apply);
          flush();
          const both = expectFrame(f, "A+B applied", [a.apply, b.apply]);
          const since = f.rendered.frames.length;
          ga.release();
          await settle(doneA);
          // A's truth beneath B's override: B was drafted against A's result.
          expectFrame(f, "A confirmed, B pending", [a.apply, b.apply]);
          expectOnlyFrames(f, "A settle", since, [both]);
          gb.release();
          await settle(doneB);
          expectOnlyFrames(f, "B settle", since, [both]);
          await expectSettled(f, "B confirmed", [a.apply, b.apply]);
          expectDisposed(f);
        });

        row(`${tag} ${a.name} + ${b.name}, resolved B then A`, async () => {
          const f = setup(kind, src);
          const ga = gate();
          const doneA = f.run(a.apply, ga, a.apply);
          flush();
          expectFrame(f, "A applied", [a.apply]);
          const gb = gate();
          const doneB = f.run(b.apply, gb, b.apply);
          flush();
          expectFrame(f, "A+B applied", [a.apply, b.apply]);
          gb.release();
          await settle(doneB);
          // B's truth (drafted against A's result) beneath A's override is
          // not a defined list state — overrides are per slot, not
          // operations — so only the invariants are checked here.
          expect(f.rendered.violations, "B confirmed, A pending: invariants").toEqual([]);
          ga.release();
          await settle(doneA);
          await expectSettled(f, "A confirmed", [b.apply, a.apply]);
          expectDisposed(f);
        });
      }
    });

    // ── context 5: a mutation and its inverse ───────────────────────────────
    describe(`ctx5 mutation then inverse ${tag}`, () => {
      for (const m of MUTATIONS) {
        row(`${tag} same action: ${m.name}`, async () => {
          const f = setup(kind, src);
          const initial = expectFrame(f, "initial", []);
          const g = gate();
          const done = f.run(
            d => {
              m.apply(d);
              m.inverse(d);
            },
            g,
            noopMutate
          );
          flush();
          expectFrame(f, "apply+inverse applied", [m.apply, m.inverse]);
          const since = f.rendered.frames.length;
          g.release();
          await settle(done);
          expectOnlyFrames(f, "settle", since, [initial]);
          await expectSettled(f, "settled", []);
          expectDisposed(f);
        });

        row(`${tag} across two actions: ${m.name}`, async () => {
          const f = setup(kind, src);
          const initial = expectFrame(f, "initial", []);
          const ga = gate();
          const doneA = f.run(m.apply, ga, m.apply);
          flush();
          expectFrame(f, "A (apply) applied", [m.apply]);
          const gb = gate();
          const doneB = f.run(m.inverse, gb, m.inverse);
          flush();
          expectFrame(f, "B (inverse) applied", [m.apply, m.inverse]);
          const since = f.rendered.frames.length;
          ga.release();
          await settle(doneA);
          expectFrame(f, "A confirmed, B pending", [m.apply, m.inverse]);
          gb.release();
          await settle(doneB);
          expectOnlyFrames(f, "settles", since, [initial]);
          await expectSettled(f, "B confirmed", [m.apply, m.inverse]);
          expectDisposed(f);
        });
      }
    });
  }

  // ── context 4: chained, the base commits outside the action ─────────────
  describe(`ctx4 chained over a base committing outside the action [reader=${kind}]`, () => {
    for (const m of MUTATIONS) {
      row(
        `[reader=${kind}] base commits WHILE pending, then inverse action: ${m.name}`,
        async () => {
          const f = setup(kind, "chained");
          const initial = expectFrame(f, "initial", []);
          const ga = gate();
          const doneA = f.run(m.apply, ga);
          flush();
          const applied = expectFrame(f, "A applied", [m.apply]);
          // the base commits the same mutation outside the action
          f.source.commitTruth(m.apply);
          flush();
          expectFrame(f, "base committed under A's override", [m.apply]);
          ga.release();
          await settle(doneA);
          await expectSettled(f, "A settled", [m.apply]);
          // #3672: the second action writes back to the pre-action value
          const since = f.rendered.frames.length;
          const gb = gate();
          const doneB = f.run(m.inverse, gb, m.inverse);
          flush();
          expectFrame(f, "B (inverse) applied", [m.apply, m.inverse]);
          gb.release();
          await settle(doneB);
          expectOnlyFrames(f, "B", since, [applied, initial]);
          await expectSettled(f, "B confirmed", [m.apply, m.inverse]);
          expectDisposed(f);
        }
      );

      row(
        `[reader=${kind}] base commits AFTER settle, then inverse action: ${m.name}`,
        async () => {
          const f = setup(kind, "chained");
          const initial = expectFrame(f, "initial", []);
          const ga = gate();
          const doneA = f.run(m.apply, ga);
          flush();
          const applied = expectFrame(f, "A applied", [m.apply]);
          ga.release();
          await settle(doneA);
          // the action settled without a truth: the override reverts
          await expectSettled(f, "A settled, no truth", []);
          // the base commits outside any action
          f.source.commitTruth(m.apply);
          flush();
          expectFrame(f, "base committed", [m.apply]);
          // #3672: the second action writes back to the pre-action value
          const since = f.rendered.frames.length;
          const gb = gate();
          const doneB = f.run(m.inverse, gb, m.inverse);
          flush();
          expectFrame(f, "B (inverse) applied", [m.apply, m.inverse]);
          gb.release();
          await settle(doneB);
          expectOnlyFrames(f, "B", since, [applied, initial]);
          await expectSettled(f, "B confirmed", [m.apply, m.inverse]);
          expectDisposed(f);
        }
      );
    }
  });
}
