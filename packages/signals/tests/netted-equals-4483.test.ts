// #4483 (D-8: a tick whose writes net to the slot's committed value made no
// proposal). An action rewrites a signal back to its committed value while a
// mainline write to it is still staged. Under a custom `equals`, a new object
// the comparator calls equal nets exactly like the committed object itself:
// the slot pends nothing, so `isPending` of a memo over it stays `false`.
// Without a custom `equals`, only identity nets; a new object is a proposal.
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  resetErrorHalt
} from "../src/index.js";

afterEach(() => resetErrorHalt());
const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

const run = async (custom: boolean, write: "committed" | "copy") => {
  const one = { k: 1 };
  const [s, setS] = createSignal(one, custom ? { equals: (a, b) => a.k === b.k } : undefined);
  const seen: boolean[] = [];
  const dispose = createRoot(d => {
    const m0 = createMemo(() => {
      const v = s().k + 1;
      if (v % 4 === 2) throw new Error(`m0:${v}`);
      return v;
    });
    createRenderEffect(
      () => isPending(m0),
      v => void seen.push(v)
    );
    return d;
  });
  flush();
  const act = action(function* () {
    setS(write === "committed" ? one : { k: 1 });
    yield new Promise(() => {});
  });
  setS({ k: 2 });
  act();
  await tick();
  dispose();
  return seen;
};

describe("#4483: writes that net under a custom equals pend nothing (D-8)", () => {
  it("nets the committed object itself (identity)", async () => {
    expect(await run(true, "committed")).toEqual([false]);
  });

  it("nets a new object the comparator calls equal", async () => {
    expect(await run(true, "copy")).toEqual([false]);
  });

  it("without a custom equals, nets only the committed object", async () => {
    expect(await run(false, "committed")).toEqual([false]);
    expect(await run(false, "copy")).toEqual([false, true]);
  });
});
