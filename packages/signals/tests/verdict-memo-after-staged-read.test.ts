// A memo of a verdict (`L = createMemo(() => latest(s))`, F-6) read by a pass
// that already read the action's staging. The read moved the pass into the
// holder's verdict lane, which shows now, with the staging it had read: the
// held change leaked onto the screen ahead of its commit (F-7). Inline, the
// same read stays the frame's (verdict.ts `route`); the async-app generator's
// E9 pair (`latest(x)` read in a derivation vs at the leaf) found the
// difference, no issue filed (E9, seed 3289):
//
//   [s0=0 s1=2 m0=memo(s1+s0 !%4=3)]
//   <Show when=m0() fb><Show when=latest(s1)><span .../></Show></Show>
//   :: … A(s0=0) A(s1=1) m S2 t
//   @11 error vs content :: [ROOT-E]  ≠  <span></span>
//
// - A derivation (the boundary's children, a memo) stays the frame's, as the
//   inline read does: the error stays the display until the action lands
//   (F-7, D-25).
// - A leaf (a render effect) is the lane's, and its plain read beside the
//   verdict is the screen's: `[s(), L()]` shows `v:0 l:1`, as the inline
//   `[s(), latest(s)]` does (D-26) — the seam re-derives it on the
//   committed world when the flush parks.
import { describe, expect, it } from "vitest";
import {
  action,
  createErrorBoundary,
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

/** An action that writes `s` and stays open until `done()`. */
function hold(set: (v: number) => void, v: number) {
  let done!: () => void;
  action(function* () {
    set(v);
    yield new Promise<void>(r => (done = r));
  })();
  return () => done();
}

describe.each(["inline", "memo"])("%s verdict", shape => {
  it("an error boundary over a held recovery keeps its error until the action lands (E9)", async () => {
    const [s, set] = createSignal(2);
    let out = "";
    createRoot(() => {
      const m0 = createMemo(() => {
        if (s() === 2) throw new Error("m0");
        return s();
      });
      const L = shape === "memo" ? createMemo(() => latest(s)) : () => latest(s);
      const view = createErrorBoundary(
        () => `m0:${m0()} l:${L()}`,
        () => "[E]"
      );
      createRenderEffect(
        () => view(),
        v => void (out = String(v))
      );
    });
    flush();
    expect(out).toBe("[E]");
    const done = hold(set, 1);
    flush();
    // m0 recovers only in the action's world: that is the action's work.
    expect(out).toBe("[E]");
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(out).toBe("[E]");
    done();
    await tick();
    expect(out).toBe("m0:1 l:1");
  });

  it("[s(), latest] in one render effect shows the screen beside the verdict (D-26)", async () => {
    const [s, set] = createSignal(0);
    const seen: string[] = [];
    createRoot(() => {
      const L = shape === "memo" ? createMemo(() => latest(s)) : () => latest(s);
      createRenderEffect(
        () => `v:${s()} l:${L()}`,
        v => void seen.push(v)
      );
    });
    flush();
    const done = hold(set, 1);
    flush();
    expect(seen.at(-1)).toBe("v:0 l:1");
    expect(seen).not.toContain("v:1 l:1");
    done();
    await tick();
    expect(seen.at(-1)).toBe("v:1 l:1");
  });

  it("[s(), isPending] in one render effect shows the screen beside the verdict (D-26)", async () => {
    const [s, set] = createSignal(0);
    const seen: string[] = [];
    createRoot(() => {
      const P = shape === "memo" ? createMemo(() => isPending(s)) : () => isPending(s);
      createRenderEffect(
        () => `v:${s()} p:${P()}`,
        v => void seen.push(v)
      );
    });
    flush();
    const done = hold(set, 1);
    flush();
    expect(seen.at(-1)).toBe("v:0 p:true");
    expect(seen).not.toContain("v:1 p:true");
    done();
    await tick();
    expect(seen.at(-1)).toBe("v:1 p:false");
  });
});

it("a memo of isPending under an error boundary keeps the error until the action lands", async () => {
  const [s, set] = createSignal(2);
  let out = "";
  createRoot(() => {
    const m0 = createMemo(() => {
      if (s() === 2) throw new Error("m0");
      return s();
    });
    const P = createMemo(() => isPending(s));
    const view = createErrorBoundary(
      () => `m0:${m0()} p:${P()}`,
      () => "[E]"
    );
    createRenderEffect(
      () => view(),
      v => void (out = String(v))
    );
  });
  flush();
  const done = hold(set, 1);
  flush();
  expect(out).toBe("[E]");
  done();
  await tick();
  expect(out).toBe("m0:1 p:false");
});
