/**
 * Optimistic frame through an index-mode `mapArray` — matrix finding F1
 * (optimistic-list-mutation-matrix.test.ts).
 *
 * `mapArray` in INDEX mode (`keyed: false`, `<For>` without `keyed`) reuses a
 * row's owner by position and hands the mapper an ACCESSOR: the row's value
 * lives in a per-slot signal the pass writes with `setSignal`. The keyed
 * modes publish a reorder through the computed's own result (the mapped array
 * moves owners), which a lane pass routes into the memo's derived override
 * (A17 lanes stage) — so the optimistic frame shows. The index mode's frame
 * is the per-slot writes, and a plain `setSignal` inside the lane pass staged
 * them into the ACTION's transaction: the row readers (render effects) were
 * served the committed value until the action landed, while the untracked
 * store read already showed the mutation. The optimistic frame was never
 * published — `<For>` without `keyed` showed stale truth for the whole action.
 *
 * Rule: a `mapArray` pass under an optimistic lane publishes its per-slot
 * writes (row values, index accessors in keyed mode) into the lane's frame —
 * the slot signals become lane members carrying a derived override, exactly
 * as the computed's own result does — never into the transaction's hold. The
 * landing (which may differ from the frame) writes the slots plainly and the
 * revert promotes or drops the override with the lane's transaction.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  mapArray,
  onCleanup,
  resetErrorHalt,
  untrack,
  type Accessor
} from "../../src/index.js";

interface Row {
  id: string;
  text: string;
}
const row = (id: string, text = id.toUpperCase()): Row => ({ id, text });
const rows = (ids: string): Row[] => ids.split("").map(id => row(id));
const frameOf = (l: readonly (Row | undefined)[]) =>
  l.map(r => (r ? `${r.id}:${r.text}` : "<hole>")).join(",");
const tick = () => new Promise<void>(r => setTimeout(r, 0));
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(r => (release = r));
  return { promise, release };
};
async function settle(done: Promise<unknown>) {
  flush();
  await Promise.race([
    done,
    (async () => {
      for (let i = 0; i < 10; i++) await tick();
    })()
  ]);
  flush();
  await tick();
  flush();
}

afterEach(() => {
  resetErrorHalt();
  flush();
});

type Mutate = (d: Row[]) => void;
type SourceKind = "derived" | "chained";
const SOURCES: SourceKind[] = ["derived", "chained"];

/** Must run under an owner. */
function createSource(kind: SourceKind) {
  if (kind === "derived") {
    const [truth, setTruth] = createSignal<Row[]>(rows("abcdef"));
    const [view, setView] = createOptimisticStore<Row[]>(() => truth(), []);
    return {
      view,
      setView,
      truth: () => untrack(truth),
      commitTruth(m: Mutate) {
        const next = untrack(truth).map(r => ({ ...r }));
        m(next);
        setTruth(next);
      }
    };
  }
  const [base, setBase] = createStore<Row[]>(rows("abcdef"));
  const [view, setView] = createOptimisticStore<Row[]>(base);
  return {
    view,
    setView,
    truth: () => untrack(() => base.map(r => ({ ...r }))),
    commitTruth(m: Mutate) {
      setBase(m);
    }
  };
}

interface Rendered {
  frames: string[];
  /** `slot<i>#<serial>` for every row owner the last frame displayed. */
  shown: string[];
  cleanups: Map<string, number>;
  violations: string[];
}

/** The matrix harness's index reader: a per-row owner with an `onCleanup`
 * and a nested memo, published through the nested-insert effect shape. */
function renderIndex(list: () => Row[]): Rendered {
  const out: Rendered = { frames: [], shown: [], cleanups: new Map(), violations: [] };
  let serial = 0;
  const mapped = mapArray(
    list,
    (item: Accessor<Row>, index: number) => {
      const inst = `slot${index}#${++serial}`;
      out.cleanups.set(inst, 0);
      onCleanup(() => out.cleanups.set(inst, out.cleanups.get(inst)! + 1));
      const show = createMemo(() => (createMemo(() => false)() ? "child" : undefined));
      return {
        inst,
        read: () => {
          show();
          const r = item();
          return r ? `${r.id}:${r.text}` : "<hole>";
        }
      };
    },
    { keyed: false }
  );
  createRenderEffect(
    () => {
      const rs = mapped();
      createRenderEffect(
        () => rs.map(r => r.read()).join(","),
        frame => {
          for (const r of rs)
            if (out.cleanups.get(r.inst)! > 0)
              out.violations.push(`row ${r.inst} displayed in "${frame}" after its cleanup`);
          out.frames.push(frame);
          out.shown = rs.map(r => r.inst);
        },
        { schedule: true }
      );
      return rs.length;
    },
    () => {}
  );
  return out;
}

function setup(kind: SourceKind) {
  let source!: ReturnType<typeof createSource>;
  let rendered!: Rendered;
  const dispose = createRoot(d => {
    source = createSource(kind);
    rendered = renderIndex(() => source.view);
    return d;
  });
  flush();
  const run = action(function* (m: Mutate, g: { promise: Promise<void> }, confirm?: Mutate) {
    source.setView(m);
    yield g.promise;
    if (confirm) source.commitTruth(confirm);
  });
  return { source, rendered, dispose, run };
}
type Fixture = ReturnType<typeof setup>;

const pure = (muts: Mutate[]) => {
  const l = rows("abcdef");
  for (const m of muts) m(l);
  return frameOf(l);
};
const untracked = (f: Fixture) => untrack(() => frameOf(f.source.view));

/** Both channels show the frame `muts` produce; no row displayed after its cleanup. */
function expectFrame(f: Fixture, label: string, muts: Mutate[]) {
  const expected = pure(muts);
  expect(f.rendered.violations, `${label}: invariants`).toEqual([]);
  expect(f.rendered.frames.at(-1), `${label}: effect channel`).toBe(expected);
  expect(untracked(f), `${label}: untracked channel`).toBe(expected);
  return expected;
}

async function expectSettled(f: Fixture, label: string, muts: Mutate[]) {
  const expected = expectFrame(f, label, muts);
  expect(frameOf(f.source.truth()), `${label}: truth`).toBe(expected);
  const n = f.rendered.frames.length;
  flush();
  await Promise.resolve();
  flush();
  expect(f.rendered.frames.length, `${label}: republish after settle`).toBe(n);
  // the action's transaction is gone: an ambient write reverts at its flush
  f.source.setView(d => void d.push(row("p", "probe")));
  flush();
  expect(untracked(f), `${label}: probe reverted`).toBe(expected);
  expect(f.rendered.frames.at(-1), `${label}: probe reverted (effect)`).toBe(expected);
  // every retired owner cleaned up once, every displayed one not at all
  for (const [inst, n] of f.rendered.cleanups)
    expect(n, `${label}: ${inst} cleanups`).toBe(f.rendered.shown.includes(inst) ? 0 : 1);
}

function expectDisposed(f: Fixture) {
  f.dispose();
  flush();
  for (const [inst, n] of f.rendered.cleanups) expect(n, `dispose: ${inst}`).toBe(1);
}

const move =
  (from: number, to: number): Mutate =>
  d => {
    const [r] = d.splice(from, 1);
    d.splice(to, 0, r);
  };
const insertHead: Mutate = d => void d.unshift(row("x"));
const insertMiddle: Mutate = d => void d.splice(3, 0, row("x"));
const deleteHead: Mutate = d => void d.shift();
const deleteMiddle: Mutate = d => void d.splice(3, 1);
const swapAB: Mutate = d => {
  const t = d[0];
  d[0] = d[1];
  d[1] = t;
};
const reverse: Mutate = d => void d.reverse();
const rotateLeft: Mutate = d => void d.push(d.shift()!);
const appendServer: Mutate = d => void d.push(row("s", "server"));

const CASES: Array<[string, Mutate]> = [
  ["insert head", insertHead],
  ["insert middle", insertMiddle],
  ["delete head", deleteHead],
  ["delete middle", deleteMiddle],
  ["move head->tail", move(0, 5)],
  ["move middle (c->4)", move(2, 4)],
  ["swap a<->b", swapAB],
  ["reverse", reverse],
  ["rotate left", rotateLeft]
];

for (const src of SOURCES) {
  describe(`F1 index-mode mapArray publishes the optimistic frame [source=${src}]`, () => {
    for (const [name, m] of CASES) {
      it(`${name}: the frame shows at the apply flush and the confirm lands silently`, async () => {
        const f = setup(src);
        expectFrame(f, "initial", []);
        const g = gate();
        const done = f.run(m, g, m);
        flush();
        const optimistic = expectFrame(f, "optimistic apply", [m]);
        const since = f.rendered.frames.length;
        g.release();
        await settle(done);
        const stray = f.rendered.frames.slice(since).filter(fr => fr !== optimistic);
        expect(stray, "stray frames between apply and confirm").toEqual([]);
        await expectSettled(f, "confirmed", [m]);
        expectDisposed(f);
      });

      it(`${name}: a landing that differs from the frame (a server row) replaces it whole`, async () => {
        const f = setup(src);
        const g = gate();
        const differ: Mutate = d => {
          m(d);
          appendServer(d);
        };
        const done = f.run(m, g, differ);
        flush();
        const optimistic = expectFrame(f, "optimistic apply", [m]);
        const since = f.rendered.frames.length;
        g.release();
        await settle(done);
        const landed = pure([differ]);
        const stray = f.rendered.frames
          .slice(since)
          .filter(fr => fr !== optimistic && fr !== landed);
        expect(stray, "stray frames between apply and landing").toEqual([]);
        await expectSettled(f, "landed", [differ]);
        expectDisposed(f);
      });
    }

    it("reorder then a landing in a DIFFERENT order: no torn frame, no hole", async () => {
      // The client guesses `reverse`; the server answers `rotate left` — a
      // landing whose per-slot values differ from the optimistic frame at
      // every position.
      const f = setup(src);
      const g = gate();
      const done = f.run(reverse, g, rotateLeft);
      flush();
      const optimistic = expectFrame(f, "optimistic apply", [reverse]);
      const since = f.rendered.frames.length;
      g.release();
      await settle(done);
      const landed = pure([rotateLeft]);
      const stray = f.rendered.frames.slice(since).filter(fr => fr !== optimistic && fr !== landed);
      expect(stray, "stray frames between apply and landing").toEqual([]);
      await expectSettled(f, "landed", [rotateLeft]);
      expectDisposed(f);
    });

    it("an action that settles WITHOUT a truth reverts the frame to the base", async () => {
      const f = setup(src);
      const initial = expectFrame(f, "initial", []);
      const g = gate();
      const done = f.run(rotateLeft, g);
      flush();
      const optimistic = expectFrame(f, "optimistic apply", [rotateLeft]);
      const since = f.rendered.frames.length;
      g.release();
      await settle(done);
      const stray = f.rendered.frames
        .slice(since)
        .filter(fr => fr !== optimistic && fr !== initial);
      expect(stray, "stray frames between apply and revert").toEqual([]);
      await expectSettled(f, "reverted", []);
      expectDisposed(f);
    });

    // Chained source only: on the derived source this row fails at "B
    // confirmed" for every reader — A's settle disturbs B's pending override
    // (F4, pinned in optimistic-list-mutation-matrix.test.ts), not F1.
    if (src === "chained")
      it("two overlapping actions: both frames show, both landings settle", async () => {
        const f = setup(src);
        const ga = gate();
        const doneA = f.run(move(0, 5), ga, move(0, 5));
        flush();
        expectFrame(f, "A applied", [move(0, 5)]);
        const gb = gate();
        const doneB = f.run(move(2, 4), gb, move(2, 4));
        flush();
        expectFrame(f, "A+B applied", [move(0, 5), move(2, 4)]);
        ga.release();
        await settle(doneA);
        expectFrame(f, "A confirmed, B pending", [move(0, 5), move(2, 4)]);
        gb.release();
        await settle(doneB);
        await expectSettled(f, "B confirmed", [move(0, 5), move(2, 4)]);
        expectDisposed(f);
      });
  });
}

describe("F1 twin: the index accessor of a keyed mapArray publishes under the lane", () => {
  // `keyed: r => r.id` with a two-argument mapper hands the row a stable
  // owner and an INDEX accessor — a per-slot signal written by the same
  // `setSignal` in the pass. A reorder moves owners (the computed's result,
  // already lane-published) AND rewrites the index signals: those must show
  // in the same frame, or the row renders its old position beside its new
  // neighbours — before the fix the apply flush showed `1b,2c,3d,4e,5f,0a`.
  for (const src of SOURCES) {
    it(`[source=${src}] rotate left: every row's index accessor shows its optimistic position`, async () => {
      let source!: ReturnType<typeof createSource>;
      const frames: string[] = [];
      const dispose = createRoot(d => {
        source = createSource(src);
        const mapped = mapArray(
          () => source.view,
          (item: Accessor<Row>, index: Accessor<number>) => () => `${index()}${item().id}`,
          { keyed: (r: Row) => r.id }
        );
        createRenderEffect(
          () =>
            mapped()
              .map(r => r())
              .join(","),
          frame => void frames.push(frame)
        );
        return d;
      });
      flush();
      expect(frames.at(-1)).toBe("0a,1b,2c,3d,4e,5f");
      const g = gate();
      const run = action(function* () {
        source.setView(rotateLeft);
        yield g.promise;
        source.commitTruth(rotateLeft);
      });
      const done = run();
      flush();
      expect(frames.at(-1), "optimistic apply").toBe("0b,1c,2d,3e,4f,5a");
      const since = frames.length;
      g.release();
      await settle(done);
      // The chained source republishes the identical frame at the landing
      // (the base rows changed under the view) — the keyed path without an
      // index accessor does the same; what must not appear is a frame that
      // differs from the optimistic one (the torn `1b,2c,3d,4e,5f,0a`).
      const stray = frames.slice(since).filter(fr => fr !== "0b,1c,2d,3e,4f,5a");
      expect(stray, "no stray frame at the confirm").toEqual([]);
      expect(frames.at(-1), "confirmed").toBe("0b,1c,2d,3e,4f,5a");
      dispose();
      flush();
    });
  }
});
