import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

// F-9, D-22, D-23: outside any Loading, a pass that reads `latest(m)` and
// `isPending(m)` of an unheld refetch is shown now — the committed value
// beside `true` — and once more when the refetch lands. The `latest` read
// had opened the flush's transaction for nothing held, and the probe asked
// to re-run at that transaction's landing: it landed at the same seam, the
// re-run opened another, and the flush never settled.
const task = () => new Promise<void>(r => setTimeout(r, 0));

async function refetch(order: "latest first" | "isPending first", via: "effect" | "memo") {
  const asks: { v: number; resolve: (v: number) => void }[] = [];
  const [s, setS] = createSignal(1);
  const m = createMemo(() => {
    const v = 1 + s();
    return new Promise<number>(resolve => asks.push({ v, resolve }));
  });
  const seen: string[] = [];
  createRoot(() => {
    const both =
      order === "latest first"
        ? () => `${latest(m)} ${isPending(m)}`
        : () => {
            const pending = isPending(m);
            return `${latest(m)} ${pending}`;
          };
    const read = via === "memo" ? createMemo(both) : both;
    createRenderEffect(read, v => void seen.push(v));
  });
  flush();
  await task();
  flush();
  const first = asks.shift()!;
  first.resolve(first.v);
  await task();
  flush();
  expect(seen).toEqual(["2 false"]);
  setS(2);
  expect(() => flush()).not.toThrow();
  expect(seen).toEqual(["2 false", "2 true"]);
  const next = asks.shift()!;
  next.resolve(next.v);
  await task();
  flush();
  expect(seen).toEqual(["2 false", "2 true", "3 false"]);
}

describe("[latest(m), isPending(m)] outside a boundary settles on m's refetch", () => {
  for (const order of ["latest first", "isPending first"] as const)
    for (const via of ["effect", "memo"] as const)
      it(`${order}, read in a ${via}`, () => refetch(order, via));
});
