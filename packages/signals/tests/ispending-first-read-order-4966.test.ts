/**
 * #4966: in a render effect already on screen, a value read for the first
 * time behind an `isPending(...)` check is the screen's, as it is when read
 * before the check. The order of operands never changes the result.
 */
import { expect, test } from "vitest";
import {
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

function run(shape: "after" | "before" | "plain") {
  const asks: ((v: any) => void)[] = [];
  const seen: string[] = [];
  let setV!: (v: number) => void;
  const mutable = { dir: undefined as string | undefined };
  createRoot(() => {
    const [v, s] = createSignal(0);
    setV = s;
    const store = createProjection<{ value: number }>(
      () => {
        const n = v();
        return new Promise(r => asks.push(() => r({ value: n })));
      },
      {} as { value: number }
    );
    const flag =
      shape === "after"
        ? () => isPending(() => store.value) && (v(), mutable.dir === "back")
        : shape === "before"
          ? () => {
              v();
              return isPending(() => store.value) && mutable.dir === "back";
            }
          : () => isPending(() => store.value) && mutable.dir === "back";
    createRenderEffect(
      () => `value=${store.value} flag=${flag()}`,
      t => void seen.push(t)
    );
  });
  return { asks, seen, setV, mutable };
}

for (const shape of ["after", "before", "plain"] as const) {
  test(`a first read behind isPending shows the screen (#4966, ${shape})`, async () => {
    const { asks, seen, setV, mutable } = run(shape);
    flush();
    await tick();
    asks.shift()!(0);
    await tick();
    flush();
    expect(seen.at(-1)).toBe("value=0 flag=false");
    mutable.dir = "back";
    setV(1);
    flush();
    await tick();
    flush();
    expect(seen.at(-1)).toBe("value=0 flag=true");
    asks.shift()!(0);
    await tick();
    flush();
    expect(seen.at(-1)).toBe("value=1 flag=false");
  });
}

test("a memo hoisting the first read behind isPending shows the screen (#4966)", async () => {
  const asks: ((v: any) => void)[] = [];
  const seen: string[] = [];
  let setV!: (v: number) => void;
  let on = false;
  createRoot(() => {
    const [v, s] = createSignal(0);
    setV = s;
    const data = createMemo(() => {
      const n = v();
      return new Promise<number>(r => asks.push(() => r(n)));
    });
    const flag = createMemo(() => isPending(data) && (v(), on));
    createRenderEffect(
      () => `value=${data()} flag=${flag()}`,
      t => void seen.push(t)
    );
  });
  flush();
  await tick();
  asks.shift()!(0);
  await tick();
  flush();
  expect(seen.at(-1)).toBe("value=0 flag=false");
  on = true;
  setV(1);
  flush();
  await tick();
  flush();
  expect(seen.at(-1)).toBe("value=0 flag=true");
  asks.shift()!(0);
  await tick();
  flush();
  expect(seen.at(-1)).toBe("value=1 flag=false");
});
