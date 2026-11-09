// #4439: a verdict memo (`createMemo(() => isPending(a))`, the router's
// `useIsRouting`) probes `a`'s new flight before anything in the flush has
// joined a transaction: the seam decides its membership (`watchVerdict`).
// A later verdict reader (here `w`, a verdict reader through a `latest()`
// memo it reads, D-25, like a `<Show when={latest(x)}>` in the tree) reads
// the flight plainly and opens the frame, which parks with `a` held. The
// memo's `true` was staged in that frame. Since #4356 the lane seam skipped
// it as "a reader a transaction holds that read none of its stagings", so it
// ran only at the landing and `isPending` showed `false` for the whole hold.
// Its probe's node is held now: a re-run routes it into the holder's verdict
// lane and shows `true` now (F-6, D-23), as the inline form already does.
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

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

type Form = "memo" | "inline" | "pair memo" | "pair inline";

async function run(form: Form) {
  const [s, setS] = createSignal(0);
  const [other] = createSignal(false);
  const screen = { p: "", w: "" };
  const frames: string[] = [];
  const frame = () => {
    const v = `${screen.p} | ${screen.w}`;
    if (frames.at(-1) !== v) frames.push(v);
  };
  const resolvers: (() => void)[] = [];
  const dispose = createRoot(dispose => {
    const a = createMemo(async () => {
      const v = s();
      if (v !== 0) await new Promise<void>(r => resolvers.push(r));
      return v;
    });
    const probe = form.startsWith("pair")
      ? () => `${isPending(a)}/${a()}`
      : () => String(isPending(a));
    const p = form.endsWith("memo") ? createMemo(probe) : probe;
    const k = createMemo(() => latest(other));
    const w = createMemo(() => {
      k();
      return a();
    });
    createRenderEffect(p, v => {
      screen.p = v;
    });
    createRenderEffect(w, v => {
      screen.w = String(v);
    });
    return dispose;
  });
  try {
    flush();
    await tick();
    frame();
    setS(1);
    flush();
    await tick();
    frame();
    expect(resolvers.length).toBe(1);
    resolvers.shift()!();
    await tick();
    frame();
    return frames;
  } finally {
    dispose();
  }
}

describe("a verdict memo whose probe the seam's park answered shows now (#4439)", () => {
  it("the memo form shows `true` while the frame is held", async () => {
    expect(await run("memo")).toEqual(["false | 0", "true | 0", "false | 1"]);
  });
  it("the inline form (control)", async () => {
    expect(await run("inline")).toEqual(["false | 0", "true | 0", "false | 1"]);
  });
  it("`[isPending(a), a()]` as a memo (control)", async () => {
    expect(await run("pair memo")).toEqual(["false/0 | 0", "true/0 | 0", "false/1 | 1"]);
  });
  it("`[isPending(a), a()]` inline (control)", async () => {
    expect(await run("pair inline")).toEqual(["false/0 | 0", "true/0 | 0", "false/1 | 1"]);
  });
});
