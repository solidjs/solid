/**
 * #4806 review: the first-time read that holds a verdict lane (`readsFresh`)
 * is decided per read, and reset by every read with a reader. An untracked
 * read in a gate's pass has no dep to compare, so it never counts as fresh,
 * whatever a tracked read before it found: the gate's display reads ahead.
 */
import { expect, test } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

test("an untracked staged read in a gate's pass does not hold the reveal (#4806)", async () => {
  const asks = new Map<string, (v: any) => void>();
  const ask = (k: string) => new Promise<any>(r => asks.set(k, r));
  let setId!: (v: number) => void, setW!: (v: number) => void;
  const seen: string[] = [];
  createRoot(() => {
    const [id, s] = createSignal(0);
    const [w, sw] = createSignal(0);
    setId = s;
    setW = sw;
    const detail = createMemo(() => ask("d:" + id()));
    const ahead = createMemo(() => latest(id));
    // The gate's pass reads `w` (committed) tracked for the first time,
    // then `id` untracked.
    const gate = createMemo(() => (ahead() > 0 ? `${w()} ${untrack(id)}` : "[none]"));
    createRenderEffect(
      () => `${detail()} ${ahead()} ${gate()}`,
      v => void seen.push(v)
    );
  });
  flush();
  await tick();
  asks.get("d:0")!("d0");
  await tick();
  flush();
  expect(seen.at(-1)).toBe("d0 0 [none]");
  setW(5);
  flush();
  setId(1);
  flush();
  await tick();
  flush();
  expect(seen.at(-1)!.split(" ")[1]).toBe("1");
  asks.get("d:1")!("d1");
  await tick();
  flush();
  expect(seen.at(-1)).toBe("d1 1 5 1");
});
