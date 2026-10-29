/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// The async-app generator's E9 pair (`latest(x)` read at the leaf vs through
// a memo of it), seed 3289, no issue filed:
//
//   [s0=0 s1=2 m0=memo(s1+s0 !%4=3)]
//   <Show when=m0() fb><Show when=latest(s1)><span split[isPending(s0)]></span></Show></Show>
//   :: S0 S0 S5 s0=0 S1 S6 t A(s0=0) A(s1=1) m S2 t
//   @11 error vs content :: [ROOT-E]  ≠  <span></span>
//
// `m0` throws on the first render; an action's write to `s1` recovers it in
// the action's world only. Read through a memo, `latest(s1)` moved the outer
// Show's content into the verdict lane, which showed it at once — the
// recovered branch, with an attribute still held — while the action was open.
// The error is the display until the action lands (F-7, D-25, D-26).
import { describe, expect, it } from "vitest";
import {
  Errored,
  Loading,
  Show,
  action,
  createMemo,
  createSignal,
  flush,
  isPending,
  latest
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

describe.each(["inline", "memo"])("latest(s1) read %s", shape => {
  it("keeps the root error until the action that recovers it lands", async () => {
    const [s0, setS0] = createSignal(0);
    const [s1, setS1] = createSignal(2);
    const m0 = createMemo(() => {
      const v = s1() + s0() + 1;
      if (v % 4 === 3) throw new Error(`m0:${v}`);
      return v;
    });
    const L1 = shape === "memo" ? createMemo(() => latest(s1)) : () => latest(s1);
    const flights: (() => void)[] = [];
    const act = action(function* (set: (v: number) => void, v: number) {
      set(v);
      yield new Promise<void>(r => flights.push(r));
    });
    const el = document.createElement("div");
    const dispose = render(
      () => (
        <Errored fallback={(_err: () => unknown) => "[ROOT-E]"}>
          <Loading fallback="[ROOT-L]">
            <Show when={m0()} fallback="[F]">
              <Show when={L1()}>
                <span data-a0={`p:${isPending(s0)}`} />
              </Show>
            </Show>
          </Loading>
        </Errored>
      ),
      el
    );
    flush();
    expect(el.innerHTML).toBe("[ROOT-E]");
    act(setS0, 0);
    act(setS1, 1);
    await Promise.resolve();
    expect(el.innerHTML).toBe("[ROOT-E]");
    flights.shift()!();
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(el.innerHTML).toBe("[ROOT-E]");
    flights.shift()!();
    await tick();
    expect(el.innerHTML).toBe('<span data-a0="p:false"></span>');
    dispose();
  });
});
