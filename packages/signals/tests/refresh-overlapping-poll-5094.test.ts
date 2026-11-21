/**
 * #5094: `refresh()` while the same question's answer is still out waits for
 * that answer and re-asks once after it lands. A re-ask asks the same
 * question (D-34, F-9), so the answer in flight is a valid value: superseding
 * it, a poll faster than the response never showed a new value, and an
 * unrelated write that read the polled memo waited behind the poll forever.
 */
import { expect, test } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  refresh
} from "../src/index.js";

const tick = () => new Promise<void>(r => setTimeout(r, 0));

function setup() {
  const answers: ((v: number) => void)[] = [];
  let asked = 0;
  const seen: number[] = [];
  let stats!: () => number;
  createRoot(() => {
    stats = createMemo(() => {
      const n = ++asked;
      return new Promise<number>(r => answers.push(() => r(n)));
    });
    createRenderEffect(stats, v => {
      seen.push(v);
    });
  });
  flush();
  const answer = async () => {
    answers.shift()!(0);
    await tick();
    await tick();
  };
  return { answers, seen, stats: () => stats, asked: () => asked, answer };
}

test("refreshes while an answer is out coalesce into one re-ask after it lands", async () => {
  const { seen, stats, asked, answer } = setup();
  await answer();
  expect(seen).toEqual([1]);

  refresh(stats());
  await tick();
  expect(asked()).toBe(2);

  // Two more polls while #2 is out: no new request yet.
  refresh(stats());
  refresh(stats());
  await tick();
  expect(asked()).toBe(2);

  // #2 lands and shows; the polls owe one re-ask.
  await answer();
  expect(seen).toEqual([1, 2]);
  expect(asked()).toBe(3);

  await answer();
  expect(seen).toEqual([1, 2, 3]);
  // Nothing was owed after #3.
  expect(asked()).toBe(3);
});

test("a poll faster than the response shows every answer", async () => {
  const { seen, stats, asked, answer } = setup();
  await answer();
  for (let i = 0; i < 4; i++) {
    refresh(stats());
    await tick();
    refresh(stats());
    await tick();
    await answer();
  }
  expect(seen).toEqual([1, 2, 3, 4, 5]);
  expect(asked()).toBe(6);
});

test("the awaited refresh() settles at the answer that lands", async () => {
  const { stats, answer } = setup();
  await answer();
  refresh(stats());
  await tick();
  const p = refresh(stats());
  await answer();
  await answer();
  expect(await p).toBeGreaterThanOrEqual(2);
});

test("a write that reads the polled memo is not held behind the poll", async () => {
  const answers: ((v: string) => void)[] = [];
  const seen: string[] = [];
  let stats!: () => string;
  let setRange!: (v: number) => void;
  createRoot(() => {
    const [range, set] = createSignal(1);
    setRange = set;
    stats = createMemo(() => {
      const r = range();
      return new Promise<string>(res => answers.push(() => res("range " + r)));
    });
    createRenderEffect(stats, v => {
      seen.push(v);
    });
  });
  flush();
  answers.shift()!("");
  await tick();
  expect(seen).toEqual(["range 1"]);

  refresh(stats);
  await tick();
  setRange(2);
  flush();
  // Polls keep coming while the range's answer is out.
  refresh(stats);
  await tick();
  while (answers.length) {
    answers.shift()!("");
    await tick();
    await tick();
  }
  expect(seen[seen.length - 1]).toBe("range 2");
});

test("refresh() with nothing out re-asks at once", async () => {
  const { stats, asked, answer } = setup();
  await answer();
  refresh(stats());
  await tick();
  expect(asked()).toBe(2);
  await answer();
  refresh(stats());
  await tick();
  expect(asked()).toBe(3);
});

test("the coalesced re-ask stays quiet", async () => {
  const { stats, answer } = setup();
  await answer();
  refresh(stats());
  await tick();
  refresh(stats());
  let pending: boolean | undefined;
  createRoot(() =>
    createRenderEffect(
      () => isPending(stats()),
      v => void (pending = v)
    )
  );
  flush();
  expect(pending).toBe(false);
  await answer();
  expect(pending).toBe(false);
});

test("an action's refresh() still re-asks inside its hold", async () => {
  const { stats, asked, answer } = setup();
  await answer();
  refresh(stats());
  await tick();
  expect(asked()).toBe(2);
  const run = action(function* () {
    yield refresh(stats());
  });
  const done = run();
  await tick();
  expect(asked()).toBe(3);
  await answer();
  await answer();
  await done;
});
