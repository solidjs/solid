/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Optimistic list holes through a keyed <For> — matrix findings F3 and F5
 * (signals: optimistic-list-mutation-matrix.test.ts,
 * optimistic-untracked-reads-f3-f5.test.ts). Both left `undefined` in
 * mapArray's item snapshot, so the next list pass handed the user's key
 * function (`c => c.id`) an undefined row: a TypeError inside the graph and
 * REACTIVITY_HALTED — the page stopped updating.
 *
 * F5: `createOptimisticStore(() => data())`, an action adds or removes a row,
 * the server answers with a list whose length differs from the optimistic
 * frame (a server-assigned row, a concurrent insert, a rejected add). The
 * landing superseded the store's `length` / presence overrides (#3331);
 * tracked reads saw the truth, the untracked store paths mapArray uses to
 * snapshot the list still composed the override.
 *
 * F3: a second optimistic move while the first is still pending (drag twice
 * before the server confirms). The second draft's `length` re-composed the
 * first draft's overrides onto its shrunken backing: one too long mid-splice,
 * a hole after.
 */
import { describe, expect, test } from "vitest";
import { action, createOptimisticStore, createSignal, flush, For } from "solid-js";
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
const move = (from: number, to: number) => (d: Card[]) => {
  const [r] = d.splice(from, 1);
  d.splice(to, 0, r);
};

type Keyed = "id" | "identity";

function setup(keyed: Keyed, initial = "abc") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let run!: (
    m: (d: Card[]) => void,
    g: { promise: Promise<void> },
    truth?: Card[]
  ) => Promise<void>;
  let view!: Card[];
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
  window.addEventListener("error", onError);

  function App() {
    const [truth, setTruth] = createSignal<Card[]>(cards(initial));
    const [list, setList] = createOptimisticStore<Card[]>(() => truth(), []);
    view = list;
    run = action(function* (m: (d: Card[]) => void, g: { promise: Promise<void> }, t?: Card[]) {
      setList(m);
      yield g.promise;
      if (t) setTruth(t);
    });
    return (
      <ul>
        {keyed === "id" ? (
          <For each={list} keyed={(c: Card) => c.id}>
            {c => <li>{c().id}</li>}
          </For>
        ) : (
          <For each={list}>{c => <li>{c.id}</li>}</For>
        )}
      </ul>
    );
  }

  const dispose = render(() => <App />, container);
  flush();
  return {
    dom: () => Array.from(container.querySelectorAll("li")).map(li => li.textContent),
    run,
    errors,
    get view() {
      return view;
    },
    dispose: () => {
      window.removeEventListener("error", onError);
      dispose();
      container.remove();
    }
  };
}

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

for (const keyed of ["id", "identity"] as const) {
  describe(`F5 <For keyed=${keyed}>: the server list's length differs from the optimistic frame`, () => {
    test("optimistic push; server answers with the row plus one more", async () => {
      const t = setup(keyed);
      expect(t.dom()).toEqual(["a", "b", "c"]);
      const g = gate();
      const done = t.run(d => void d.push({ id: "x" }), g, cards("abcxs"));
      flush();
      expect(t.dom()).toEqual(["a", "b", "c", "x"]);
      g.release();
      await settle(done);
      expect(t.errors).toEqual([]);
      expect(t.dom()).toEqual(["a", "b", "c", "x", "s"]);
      // the pass after the landing is the one that keyed an undefined row
      const g2 = gate();
      const done2 = t.run(d => void d.push({ id: "y" }), g2, cards("abcxsy"));
      flush();
      expect(t.dom()).toEqual(["a", "b", "c", "x", "s", "y"]);
      g2.release();
      await settle(done2);
      expect(t.errors).toEqual([]);
      expect(t.dom()).toEqual(["a", "b", "c", "x", "s", "y"]);
      t.dispose();
    });

    test("optimistic push; server rejects it (answers the shorter list)", async () => {
      const t = setup(keyed);
      const g = gate();
      const done = t.run(d => void d.push({ id: "x" }), g, cards("abc"));
      flush();
      expect(t.dom()).toEqual(["a", "b", "c", "x"]);
      g.release();
      await settle(done);
      expect(t.errors).toEqual([]);
      expect(t.dom()).toEqual(["a", "b", "c"]);
      const g2 = gate();
      const done2 = t.run(d => void d.push({ id: "y" }), g2, cards("abcy"));
      flush();
      g2.release();
      await settle(done2);
      expect(t.errors).toEqual([]);
      expect(t.dom()).toEqual(["a", "b", "c", "y"]);
      t.dispose();
    });

    test("optimistic delete; server answers with another row in that slot", async () => {
      const t = setup(keyed);
      const g = gate();
      const done = t.run(d => void d.pop(), g, cards("abs"));
      flush();
      expect(t.dom()).toEqual(["a", "b"]);
      g.release();
      await settle(done);
      expect(t.errors).toEqual([]);
      expect(t.dom()).toEqual(["a", "b", "s"]);
      const g2 = gate();
      const done2 = t.run(d => void d.push({ id: "y" }), g2, cards("absy"));
      flush();
      expect(t.dom()).toEqual(["a", "b", "s", "y"]);
      g2.release();
      await settle(done2);
      expect(t.errors).toEqual([]);
      expect(t.dom()).toEqual(["a", "b", "s", "y"]);
      t.dispose();
    });
  });

  describe(`F3 <For keyed=${keyed}>: a second drag before the first is confirmed`, () => {
    test("a..f, move head->tail then move c->4 while both pend; both confirm", async () => {
      const t = setup(keyed, "abcdef");
      expect(t.dom()).toEqual(["a", "b", "c", "d", "e", "f"]);
      const ga = gate();
      const doneA = t.run(move(0, 5), ga);
      flush();
      expect(t.dom()).toEqual(["b", "c", "d", "e", "f", "a"]);
      const gb = gate();
      const doneB = t.run(move(2, 4), gb);
      flush();
      expect(t.errors).toEqual([]);
      expect(t.view.length).toBe(6);
      expect(t.dom()).toEqual(["b", "c", "e", "f", "d", "a"]);
      // the server confirms both, in order
      ga.release();
      await settle(doneA);
      gb.release();
      await settle(doneB);
      expect(t.errors).toEqual([]);
      // no truth was written: both overrides revert to the base
      expect(t.dom()).toEqual(["a", "b", "c", "d", "e", "f"]);
      t.dispose();
    });

    test("a..f, two moves in one action's two setter calls", () => {
      const t = setup(keyed, "abcdef");
      const g = gate();
      let threw: unknown = null;
      try {
        void t.run(d => {
          move(0, 5)(d);
        }, g);
        // a second setter call in the same tick — a second draft over the
        // first's live overrides
        void t.run(move(2, 4), gate());
        flush();
      } catch (e) {
        threw = e;
      }
      expect(threw).toBeNull();
      expect(t.errors).toEqual([]);
      expect(t.view.length).toBe(6);
      expect(t.dom()).toEqual(["b", "c", "e", "f", "d", "a"]);
      t.dispose();
    });
  });
}
