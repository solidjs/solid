/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The optimistic frame through an index-mode <For> — matrix finding F1
 * (signals: optimistic-list-mutation-matrix.test.ts,
 * optimistic-maparray-index-frame-f1.test.ts).
 *
 * `<For keyed={false}>` reuses a row by position and hands it an item
 * ACCESSOR: the row's value lives in a per-slot signal mapArray writes on
 * every pass. Inside an action those writes were staged into the action's
 * transaction instead of the lane's frame, so the rows kept rendering the
 * pre-action list until the server answered — while `<For>` keyed by id
 * showed the optimistic reorder at once. The same per-slot write carries the
 * INDEX accessor of a keyed <For>: a reorder moved the rows but each kept its
 * old index until the landing.
 *
 * Every case: the DOM shows the mutation right after the apply flush, an
 * equal landing changes nothing, a differing landing (a server-assigned row)
 * replaces the frame whole, and after the settle an ambient write reverts at
 * its flush (the action's transaction is gone). No errors reach the page.
 */
import { describe, expect, test } from "vitest";
import {
  action,
  createOptimisticStore,
  createSignal,
  createStore,
  flush,
  For,
  type Accessor
} from "solid-js";
import { render } from "../src/index.js";

interface Card {
  id: string;
}
const cards = (ids: string): Card[] => ids.split("").map(id => ({ id }));
const tick = () => new Promise<void>(r => setTimeout(r, 0));
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(r => (release = r));
  return { promise, release };
};
type Mutate = (d: Card[]) => void;
const move =
  (from: number, to: number): Mutate =>
  d => {
    const [r] = d.splice(from, 1);
    d.splice(to, 0, r);
  };
const insertHead: Mutate = d => void d.unshift({ id: "x" });
const insertMiddle: Mutate = d => void d.splice(3, 0, { id: "x" });
const deleteHead: Mutate = d => void d.shift();
const deleteMiddle: Mutate = d => void d.splice(3, 1);
const swapAB: Mutate = d => {
  const t = d[0];
  d[0] = d[1];
  d[1] = t;
};
const reverse: Mutate = d => void d.reverse();
const rotateLeft: Mutate = d => void d.push(d.shift()!);
const appendServer: Mutate = d => void d.push({ id: "s" });

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

/** The frame `muts` produce from a..f, as the rows render it. */
const pure = (muts: Mutate[]) => {
  const l = cards("abcdef");
  for (const m of muts) m(l);
  return l.map(c => c.id);
};

type SourceKind = "derived" | "chained";
const SOURCES: SourceKind[] = ["derived", "chained"];

/** Must run under an owner. */
function createSource(kind: SourceKind) {
  if (kind === "derived") {
    const [truth, setTruth] = createSignal<Card[]>(cards("abcdef"));
    const [view, setView] = createOptimisticStore<Card[]>(() => truth(), []);
    return {
      view,
      setView,
      commitTruth(m: Mutate) {
        const next = truth().map(c => ({ ...c }));
        m(next);
        setTruth(next);
      }
    };
  }
  const [base, setBase] = createStore<Card[]>(cards("abcdef"));
  const [view, setView] = createOptimisticStore<Card[]>(base);
  return {
    view,
    setView,
    commitTruth(m: Mutate) {
      setBase(m);
    }
  };
}

type Mode = "index" | "keyed-index";

function setup(kind: SourceKind, mode: Mode = "index") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let source!: ReturnType<typeof createSource>;
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
  window.addEventListener("error", onError);

  function App() {
    source = createSource(kind);
    return (
      <ul>
        {mode === "index" ? (
          <For each={source.view} keyed={false}>
            {c => <li>{c().id}</li>}
          </For>
        ) : (
          <For each={source.view} keyed={(c: Card) => c.id}>
            {(c: Accessor<Card>, i: Accessor<number>) => (
              <li>
                {i()}
                {c().id}
              </li>
            )}
          </For>
        )}
      </ul>
    );
  }

  const dispose = render(() => <App />, container);
  flush();
  const run = action(function* (m: Mutate, g: { promise: Promise<void> }, confirm?: Mutate) {
    source.setView(m);
    yield g.promise;
    if (confirm) source.commitTruth(confirm);
  });
  return {
    lis: () => Array.from(container.querySelectorAll("li")),
    dom: () => Array.from(container.querySelectorAll("li")).map(li => li.textContent),
    run,
    errors,
    get source() {
      return source;
    },
    dispose: () => {
      window.removeEventListener("error", onError);
      dispose();
      container.remove();
    }
  };
}
type Fixture = ReturnType<typeof setup>;

/** Lets a released action run to its commit, bounded. */
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

/** After the settle: the DOM shows `expected`, and an ambient write outside
 * any action reverts at its flush — the action's transaction is gone. */
function expectSettled(t: Fixture, expected: string[]) {
  expect(t.errors).toEqual([]);
  expect(t.dom()).toEqual(expected);
  t.source.setView(d => void d.push({ id: "p" }));
  flush();
  expect(t.dom(), "ambient probe reverted").toEqual(expected);
}

for (const src of SOURCES) {
  describe(`F1 <For keyed={false}> shows the optimistic frame [source=${src}]`, () => {
    for (const [name, m] of CASES) {
      test(`${name}: the frame shows at the apply flush and the confirm lands silently`, async () => {
        const t = setup(src);
        expect(t.dom()).toEqual(pure([]));
        const before = t.lis();
        const g = gate();
        const done = t.run(m, g, m);
        flush();
        const optimistic = pure([m]);
        expect(t.dom(), "optimistic apply").toEqual(optimistic);
        // index mode: a surviving position keeps its element — the row was
        // rewritten through its accessor, not re-created
        const after = t.lis();
        for (let i = 0; i < Math.min(before.length, after.length); i++)
          expect(after[i], `li ${i} reused`).toBe(before[i]);
        g.release();
        await settle(done);
        expectSettled(t, optimistic);
        t.dispose();
      });

      test(`${name}: a landing that differs from the frame (a server row) replaces it whole`, async () => {
        const t = setup(src);
        const g = gate();
        const differ: Mutate = d => {
          m(d);
          appendServer(d);
        };
        const done = t.run(m, g, differ);
        flush();
        expect(t.dom(), "optimistic apply").toEqual(pure([m]));
        g.release();
        await settle(done);
        expectSettled(t, pure([differ]));
        t.dispose();
      });
    }

    test("reorder then a landing in a DIFFERENT order: no torn frame, no hole", async () => {
      const t = setup(src);
      const g = gate();
      const done = t.run(reverse, g, rotateLeft);
      flush();
      expect(t.dom(), "optimistic apply").toEqual(pure([reverse]));
      g.release();
      await settle(done);
      expectSettled(t, pure([rotateLeft]));
      t.dispose();
    });

    test("an action that settles WITHOUT a truth reverts the frame to the base", async () => {
      const t = setup(src);
      const g = gate();
      const done = t.run(rotateLeft, g);
      flush();
      expect(t.dom(), "optimistic apply").toEqual(pure([rotateLeft]));
      g.release();
      await settle(done);
      expectSettled(t, pure([]));
      t.dispose();
    });

    // Chained source only: on the derived source this row fails at "B
    // confirmed" for every reader — A's settle disturbs B's pending override
    // (matrix finding F4, pinned there), not F1.
    if (src === "chained")
      test("two overlapping actions: both frames show, both landings settle", async () => {
        const t = setup(src);
        const ga = gate();
        const doneA = t.run(move(0, 5), ga, move(0, 5));
        flush();
        expect(t.dom(), "A applied").toEqual(pure([move(0, 5)]));
        const gb = gate();
        const doneB = t.run(move(2, 4), gb, move(2, 4));
        flush();
        const both = pure([move(0, 5), move(2, 4)]);
        expect(t.dom(), "A+B applied").toEqual(both);
        ga.release();
        await settle(doneA);
        expect(t.errors).toEqual([]);
        expect(t.dom(), "A confirmed, B pending").toEqual(both);
        gb.release();
        await settle(doneB);
        expectSettled(t, both);
        t.dispose();
      });
  });

  test(`F1 twin [source=${src}]: a keyed <For>'s index accessors move with the rows`, async () => {
    // Before the fix the apply flush rendered `1b 2c 3d 4e 5f 0a`: rows in
    // their new order, each with its old index.
    const t = setup(src, "keyed-index");
    expect(t.dom()).toEqual(["0a", "1b", "2c", "3d", "4e", "5f"]);
    const g = gate();
    const done = t.run(rotateLeft, g, rotateLeft);
    flush();
    const rotated = ["0b", "1c", "2d", "3e", "4f", "5a"];
    expect(t.dom(), "optimistic apply").toEqual(rotated);
    g.release();
    await settle(done);
    expect(t.errors).toEqual([]);
    expect(t.dom(), "confirmed").toEqual(rotated);
    t.dispose();
  });
}
