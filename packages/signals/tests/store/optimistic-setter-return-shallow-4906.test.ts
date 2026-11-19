import { action, createOptimisticStore, flush } from "../../src/index.js";

// Ruled 2026-11-19 (#4906): an optimistic setter's returned value is a
// shallow diff, as on every store. Returning is for filtering and
// rearranging the rows the store has; it is not a keyed diff of new objects.
const tick = () => new Promise<void>(r => setTimeout(r, 0));

it("a returned filter keeps the rows it carried over", async () => {
  const [list, guess] = createOptimisticStore<any[]>([{ id: 1 }, { id: 2 }, { id: 3 }]);
  flush();
  const r1 = list[0];
  const r3 = list[2];
  let end!: () => void;
  const run = action(function* () {
    guess(d => d.filter(r => r.id !== 2));
    yield new Promise<void>(r => (end = r));
  })();
  flush();
  await tick();
  flush();
  expect(list.map(r => r.id)).toEqual([1, 3]);
  expect(list[0]).toBe(r1);
  expect(list[1]).toBe(r3);
  end();
  await run;
  await tick();
  flush();
  expect(list.map(r => r.id)).toEqual([1, 2, 3]);
  expect(list[0]).toBe(r1);
  expect(list[2]).toBe(r3);
});

// A row rewritten under its own key is that row: the new object's fields are
// the guess, and the row keeps its identity (D-33).
it("a returned new object under a row's key guesses that row's fields", async () => {
  const [list, guess] = createOptimisticStore<any[]>([
    { id: 1, v: 0 },
    { id: 2, v: 0 }
  ]);
  flush();
  const r1 = list[0];
  const r2 = list[1];
  let end!: () => void;
  const run = action(function* () {
    guess(d => d.map(r => (r.id === 2 ? { id: 2, v: 9 } : r)));
    yield new Promise<void>(r => (end = r));
  })();
  flush();
  await tick();
  flush();
  expect(list[0]).toBe(r1);
  expect(list[1]).toBe(r2);
  expect(list[1].v).toBe(9);
  end();
  await run;
  await tick();
  flush();
  expect(list[1]).toBe(r2);
  expect(list[1].v).toBe(0);
});
