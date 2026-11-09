/**
 * #4495 (D-22, F-9, F-10): two async memos m1, m2 both answer, then a write re-asks them,
 * all in one tick. The memo c = m1() + m2() reads both answers through `latest` — 2 + 11 = 13
 * — and is pending on the re-ask: both answers resolved before the write, so both are produced
 * values (D-22: answered, then re-asked), whichever reaction runs first.
 *
 * Cause: an async landing flushed synchronously (`asyncWrite`), and that flush carried the
 * queued write: it re-asked m2 before m2's answer's reaction ran, so the answer arrived
 * superseded and was dropped. A landing that arrives while a write's flush is queued is now
 * carried by that flush (F-10), with every answer whose reaction is queued ahead of it.
 *
 * From the review repro 4459c-two-sources-landing-order (re-review of #4459).
 */
import { expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const task = () => new Promise<void>(r => setTimeout(r, 0));
const attempt = (f: () => unknown) => {
  try {
    return f();
  } catch (e: any) {
    return "throws " + e?.constructor?.name;
  }
};

type Shape = "one" | "two" | "two-reversed" | "m1-unasked";

function setup(shape: Shape) {
  const asks: { v: number; resolve: (v: number) => void }[] = [];
  const [s, setS] = createSignal(1);
  const mk = (off: number, reask = true) =>
    createMemo(() => {
      const v = off + (reask ? s() : 1);
      return new Promise<number>(resolve => asks.push({ v, resolve }));
    });
  const m1 = mk(1, shape !== "m1-unasked"),
    m2 = mk(10);
  const c = createMemo(() =>
    shape === "one" ? m1() : shape === "two-reversed" ? m2() + m1() : m1() + m2()
  );
  const seen: string[] = [];
  createRoot(() => {
    createRenderEffect(
      () => `${attempt(() => latest(c))}|${isPending(c)}`,
      v => void seen.push(v)
    );
  });
  return { asks, setS, c, seen };
}

/** Both answer, then the write re-asks, in one tick. */
async function answerThenReask(shape: Shape, order: "asked" | "reversed" = "asked") {
  const t = setup(shape);
  flush();
  await task();
  flush();
  const answers = t.asks.splice(0);
  if (order === "reversed") answers.reverse();
  for (const a of answers) a.resolve(a.v);
  t.setS(2);
  await task();
  flush();
  return t;
}

it("one source: answered then re-asked in one tick, latest(c) reads the answer (D-22)", async () => {
  const { c } = await answerThenReask("one");
  expect(attempt(() => latest(c))).toBe(2);
});

it("two sources: both answered then re-asked in one tick, latest(c) reads both answers (D-22)", async () => {
  const { c, seen } = await answerThenReask("two");
  expect(attempt(() => latest(c))).toBe(13);
  // F-9: the re-ask is a new question; c is pending on it.
  expect(isPending(c)).toBe(true);
  expect(seen.at(-1)).toBe("13|true");
});

it("two sources, answers resolved in the other order: the same (D-22)", async () => {
  const { c } = await answerThenReask("two", "reversed");
  expect(attempt(() => latest(c))).toBe(13);
});

it("two sources, c reads m2 first: the same (D-22)", async () => {
  const { c } = await answerThenReask("two-reversed");
  expect(attempt(() => latest(c))).toBe(13);
});

it("only the later answer's source is re-asked: its answer is not dropped (D-22)", async () => {
  // m1 = 1 + 1 answers and is not re-asked; m2 = 10 + s is.
  for (const order of ["asked", "reversed"] as const) {
    const { c } = await answerThenReask("m1-unasked", order);
    expect(attempt(() => latest(c))).toBe(13);
  }
});

it("the re-ask's answers land as the next value", async () => {
  const { asks, c } = await answerThenReask("two");
  for (const a of asks.splice(0)) a.resolve(a.v);
  await task();
  flush();
  expect(attempt(() => latest(c))).toBe(3 + 12);
  expect(isPending(c)).toBe(false);
});

it("control: two sources answered in their own tick, then re-asked, read 13", async () => {
  const { asks, setS, c } = setup("two");
  flush();
  await task();
  flush();
  for (const a of asks.splice(0)) a.resolve(a.v);
  await task();
  flush();
  setS(2);
  flush();
  expect(attempt(() => latest(c))).toBe(13);
});

it("an answer resolved after the write is to the superseded question (control)", async () => {
  const { asks, setS, c } = setup("two");
  flush();
  await task();
  flush();
  const answers = asks.splice(0);
  setS(2);
  for (const a of answers) a.resolve(a.v);
  await task();
  flush();
  expect(attempt(() => latest(c))).toBe("throws NotReadyError");
});
