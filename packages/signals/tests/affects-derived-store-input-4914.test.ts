// #4914: `affects(list)` on a derived store whose answer holds another
// store's proxy (`{ people: [person] }`) marks the derived store's view of
// the row, never the input store itself: the derived store's work cannot
// change `person`'s data (A24 (4), amended). The source-to-derived direction
// (#2882, #2904) is pinned in question-scoped-pending.test.ts.
import { expect, test } from "vitest";
import { action, affects, createStore, flush, isPending } from "../src/index.js";

test("#4914 affects() on a derived store leaves its input store crisp", async () => {
  const [person] = createStore({ name: "Alice" });
  const [list] = createStore<any>(() => ({ people: [person] }), { people: [] });
  flush();
  expect(list.people[0]).not.toBe(person);
  let resolve!: () => void;
  const mark = action(function* () {
    affects(list);
    yield new Promise<void>(r => (resolve = r));
  });
  const done = mark();
  flush();
  expect(isPending(() => list.people[0].name)).toBe(true);
  expect(isPending(() => person.name)).toBe(false);
  resolve();
  await done;
  flush();
  expect(isPending(() => list.people[0].name)).toBe(false);
  expect(isPending(() => person.name)).toBe(false);
});

test("#4914 a row first read through the derived store during the window is still marked", async () => {
  const [person] = createStore({ name: "Alice", address: { city: "Oslo" } });
  const [list] = createStore<any>(() => ({ people: [person] }), { people: [] });
  flush();
  void person.address.city;
  let resolve!: () => void;
  const mark = action(function* () {
    affects(list);
    yield new Promise<void>(r => (resolve = r));
  });
  const done = mark();
  flush();
  expect(isPending(() => list.people[0].address.city)).toBe(true);
  expect(isPending(() => person.address.city)).toBe(false);
  resolve();
  await done;
  flush();
  expect(isPending(() => list.people[0].address.city)).toBe(false);
});
