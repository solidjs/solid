// #4407: a reader whose own error comes from a display-ahead pass
// (`latest(a) = 2` beside the held `b() = 0`) over a write held by another
// memo's flight. At the landing the inline render effect goes
// `title=2 → title=6`; read through a memo it showed the Errored fallback in
// between (`[E own:3]`). JSX grouping must never change the result (#4284,
// #4401).
import { describe, expect, it } from "vitest";
import {
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise(r => setTimeout(r, 0));
  flush();
};

async function run(reader: "memo" | "effect") {
  const [a, setA] = createSignal(1);
  const [b, setB] = createSignal(0);
  const [c, setC] = createSignal(1);
  let resolve!: () => void;
  const out: string[] = [];
  const dispose = createRoot(dispose => {
    const slow = createMemo(() => {
      const v = c();
      return v > 1 ? new Promise<number>(r => (resolve = () => r(v))) : v;
    });
    createRenderEffect(slow, () => {});
    const f = () => {
      const v = latest(a) + b() + 1;
      if (v === 3) throw new Error("own:3");
      return v;
    };
    const show = (v: unknown) => void out.push(`title=${v}`);
    const view = createErrorBoundary(
      () =>
        untrack(() => {
          if (reader === "effect") createRenderEffect(f, show);
          else {
            const m = createMemo(f);
            createRenderEffect(() => m(), show);
          }
          return "content";
        }),
      (e: () => any) => `[E ${e()?.message}]`
    );
    createRenderEffect(
      () => view(),
      v => void (v !== "content" && out.push(String(v)))
    );
    return dispose;
  });
  flush();
  await tick();
  setA(2);
  setB(3);
  setC(2);
  flush();
  await tick();
  out.push("|");
  resolve();
  await tick();
  await tick();
  dispose();
  return out;
}

describe("#4407: own error over a held write, memo vs inline", () => {
  it.each(["memo", "effect"] as const)("no fallback at the landing (%s)", async reader => {
    const out = await run(reader);
    expect(out.slice(out.indexOf("|") + 1), out.join(" ")).not.toContain("[E own:3]");
    expect(out.at(-1)).toBe("title=6");
  });
  it("memo and inline show the same screens", async () => {
    expect(await run("memo")).toEqual(await run("effect"));
  });
});
