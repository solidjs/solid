/**
 * #4336, the case expected to be fine: the question change is its own
 * action, and its guess is computed from the screen's current value, which
 * already includes the first action's guess.
 *
 * Action A posts "milk (sending)", yields its save, then refreshes the list.
 * Action B sets the filter optimistically (`filter` is a `createOptimistic`
 * over the saved filter) and guesses the filtered list over the view it
 * sees — A's guess included — then yields its own save and writes the saved
 * filter. The list re-asks with the new filter in B's lane.
 *
 * D-33: same-slot writes from two actions entangle; the slot reverts only
 * when the last of them settles. D-35: an earlier answer is staged, never a
 * correction of a newer guess. So in every frame the new filter shows from
 * B's write, milk shows until A commits, nothing tears, and milk never
 * flickers out and back. When B settles first (its truth from the server
 * without milk, A still out) nothing on screen changes until A settles; then
 * the final truth shows, with both changes.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  refresh,
  resetErrorHalt
} from "../src/index.js";

const gates: Array<() => void> = [];
afterEach(async () => {
  for (let g; (g = gates.pop()); ) g();
  await tick();
  resetErrorHalt();
  flush();
});
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
const defer = <T = void>() => {
  let res!: (v: T) => void;
  const p = new Promise<T>(a => (res = a));
  gates.push(() => res(undefined as T));
  return { p, res };
};

type Todo = { id: string; text: string; done: boolean };
type Form = "signal" | "store-draft" | "store-return";

function setup(form: Form) {
  // The server: what a fetch for a filter answers, from its current rows.
  const db: Todo[] = [
    { id: "eggs", text: "eggs", done: true },
    { id: "bread", text: "bread", done: false }
  ];
  const asks: { filter: string; res: (v: Todo[]) => void }[] = [];
  /** The server answers every fetch in flight, and any it asks next. */
  const answer = async () => {
    for (let i = 0; i < 5 && asks.length; i++) {
      for (let a; (a = asks.shift()); )
        a.res(db.filter(t => a.filter === "all" || !t.done).map(t => ({ ...t })));
      await tick();
    }
  };
  const frames: string[] = [];
  let todos!: any;
  let guessAdd!: (t: Todo) => void;
  let guessFilter!: () => void;
  let setFilter!: (f: string) => void;
  let setFilterTruth!: (f: string) => void;
  createRoot(() => {
    // The filter's truth, and its optimistic view (the guess shows at once).
    const [saved, setSaved] = createSignal("all");
    const [filter, sf] = createOptimistic(() => saved());
    setFilter = sf;
    setFilterTruth = setSaved;
    const ask = () => {
      const f = filter();
      return new Promise<Todo[]>(res => asks.push({ filter: f, res }));
    };
    let view: () => string;
    if (form === "signal") {
      const [t, set] = createOptimistic<Todo[]>(async () => ask());
      todos = t;
      view = () =>
        t()
          .map(r => r.text)
          .join(",");
      guessAdd = row => set(v => [...v, row]);
      guessFilter = () => set(v => v.filter(r => !r.done));
    } else {
      const [t, set] = createOptimisticStore<Todo[]>(async d => {
        const rows = await ask();
        if (form === "store-return") return rows;
        d.length = 0;
        d.push(...rows);
      }, []);
      todos = t;
      view = () => t.map(r => r?.text ?? "<hole>").join(",");
      guessAdd = row =>
        set(d => {
          d.push(row);
        });
      guessFilter = () =>
        set(d => {
          for (let i = d.length - 1; i >= 0; i--) if (d[i].done) d.splice(i, 1);
        });
    }
    createRenderEffect(
      () => `${filter()}: ${view()}`,
      v => void frames.push(v)
    );
  });
  const save = defer();
  const filterSave = defer();
  const A = action(function* () {
    guessAdd({ id: "milk", text: "milk (sending)", done: false });
    yield save.p;
    db.push({ id: "milk", text: "milk", done: false });
    refresh(todos);
  });
  const B = action(function* () {
    setFilter("open");
    guessFilter();
    yield filterSave.p;
    setFilterTruth("open");
  });
  return { frames, answer, A, B, save, filterSave, screen: () => frames.at(-1) };
}

/** Frames from A's post on: milk in every one; after B's filter, "open" in
 * every one and never eggs. */
function check(frames: string[], from: number) {
  const after = frames.slice(from);
  expect(after.filter(f => !f.includes("milk"))).toEqual([]);
  const b = after.findIndex(f => f.startsWith("open:"));
  if (b !== -1)
    expect(after.slice(b).filter(f => !f.startsWith("open:") || f.includes("eggs"))).toEqual([]);
  expect(after.filter(f => f.includes("<hole>"))).toEqual([]);
}

for (const form of ["signal", "store-draft", "store-return"] as const)
  describe(`#4336 a filter action layered on a post's guess (${form})`, () => {
    for (const order of ["A then B", "B then A"] as const)
      it(`settles ${order}: the filter shows at once, milk until A commits`, async () => {
        const h = setup(form);
        await tick();
        await h.answer();
        expect(h.screen()).toBe("all: eggs,bread");

        h.A();
        await tick();
        expect(h.screen()).toBe("all: eggs,bread,milk (sending)");
        const from = h.frames.length - 1;

        h.B();
        await tick();
        // The filter and the filtered guess show at once (F-6, F-11).
        expect(h.screen()).toBe("open: bread,milk (sending)");

        if (order === "A then B") {
          // The filtered list's own answer (no milk yet: A is out).
          await h.answer();
          expect(h.screen()).toBe("open: bread,milk (sending)");
          h.save.res();
          await tick();
          await h.answer();
          // A's save landed, but B still holds the slot (D-33).
          expect(h.screen()).toMatch(/^open: bread,milk/);
          h.filterSave.res();
          await tick();
          await h.answer();
        } else {
          // B's truth arrives without milk, and B settles: nothing changes
          // on screen while A is out (D-33, D-35).
          await h.answer();
          h.filterSave.res();
          await tick();
          await h.answer();
          expect(h.screen()).toBe("open: bread,milk (sending)");
          h.save.res();
          await tick();
          await h.answer();
        }
        expect(h.screen()).toBe("open: bread,milk");
        check(h.frames, from);
      });
  });
