/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// `latest()` read inline in a hole and the same read through a memo
// (`L = createMemo(() => latest(x))`) show the same screen (F-6, D-25, D-26).
// The signals-side pins are `packages/signals/tests/latest-memo-inline-parity.test.ts`.
import { describe, expect, test } from "vitest";
import { action, createMemo, createOptimistic, createSignal, flush, latest } from "solid-js";
import { render } from "../src/index.js";

async function tick() {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
}

describe("#4284 through a memo: one hole reading the guess, its async derivation and latest()", () => {
  for (const via of ["inline", "memo"] as const)
    test(via, async () => {
      const div = document.createElement("div");
      let resolveDerived: (() => void) | undefined;
      let attempt!: () => Promise<void>;
      const dispose = render(() => {
        const [base] = createSignal(1);
        const [x, set] = createOptimistic(() => base());
        const derived = createMemo(() =>
          x() === 1 ? "x1" : new Promise<string>(r => (resolveDerived = () => r("x" + x())))
        );
        const L = via === "memo" ? createMemo(() => latest(x)) : () => latest(x);
        attempt = action(function* () {
          set(5);
          yield new Promise<void>(() => {});
        });
        return <p>{`${x()} ${derived()} / ${L()}`}</p>;
      }, div);
      flush();
      expect(div.innerHTML).toBe("<p>1 x1 / 1</p>");
      void attempt();
      flush();
      await tick();
      expect(div.innerHTML).toBe("<p>1 x1 / 5</p>");
      resolveDerived!();
      await tick();
      expect(div.innerHTML).toBe("<p>5 x5 / 5</p>");
      dispose();
    });
});

describe("a plain write beside an async memo: the screen beside latest(), inline or memo", () => {
  for (const via of ["inline", "memo"] as const)
    test(via, async () => {
      const div = document.createElement("div");
      let resolveA: (() => void) | undefined;
      const [s, set] = createSignal(0);
      const dispose = render(() => {
        const A = createMemo(() => {
          const v = s();
          return v === 0 ? 0 : new Promise<number>(r => (resolveA = () => r(v)));
        });
        const L = via === "memo" ? createMemo(() => latest(s)) : () => latest(s);
        const D = createMemo(() => `v:${s()} l:${L()}`);
        return (
          <>
            <p>{`v:${s()} a:${A()} l:${L()}`}</p>
            <i>{D()}</i>
          </>
        );
      }, div);
      flush();
      expect(div.innerHTML).toBe("<p>v:0 a:0 l:0</p><i>v:0 l:0</i>");
      set(1);
      flush();
      await tick();
      expect(div.innerHTML).toBe("<p>v:0 a:0 l:1</p><i>v:0 l:1</i>");
      resolveA!();
      await tick();
      expect(div.innerHTML).toBe("<p>v:1 a:1 l:1</p><i>v:1 l:1</i>");
      dispose();
    });
});
