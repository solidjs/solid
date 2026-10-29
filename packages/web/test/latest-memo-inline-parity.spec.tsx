/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// `latest()` read inline in a hole and the same read through a memo
// (`L = createMemo(() => latest(x))`) show the same screen (F-6, D-25, D-26).
// The signals-side pins are `packages/signals/tests/latest-memo-inline-parity.test.ts`.
import { describe, expect, test } from "vitest";
import {
  Errored,
  Loading,
  action,
  createMemo,
  createOptimistic,
  createSignal,
  createStore,
  flush,
  isPending,
  latest
} from "solid-js";
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

// async-gen seed 91501 #504 (E2/E3): `latest()` of an async derivation's
// first load in flight — read directly, through an identity memo, or through
// a derived store — is loading (D-22): the boundary keeps its fallback, and
// no hole shows `undefined`.
describe("latest() of a first load in flight: direct, identity memo, derived store", () => {
  for (const view of ["direct", "identity", "store"] as const)
    test(view, async () => {
      const div = document.createElement("div");
      const resolvers: (() => void)[] = [];
      const [s, set] = createSignal(0, { ownedWrite: true });
      const dispose = render(() => {
        const m0 = createMemo(() => 1 + latest(s) + s());
        const m1 = createMemo(() => {
          const v = 1 + latest(m0) + m0();
          return new Promise<number>(r => resolvers.push(() => r(v)));
        });
        let read: () => number | undefined = m1;
        if (view === "identity") read = createMemo(() => m1());
        else if (view === "store") {
          const [store] = createStore<{ v?: number }>(d => {
            d.v = m1();
          }, {});
          read = () => store.v;
        }
        return (
          <Loading fallback="[L]">
            <span data-l={`lm1:${latest(read)}`}>
              {s()} {latest(s)}
            </span>
          </Loading>
        );
      }, div);
      flush();
      expect(div.innerHTML).toBe("[L]");
      set(2);
      await tick();
      expect(div.innerHTML).toBe("[L]");
      resolvers.forEach(r => r());
      await tick();
      expect(div.innerHTML).toBe('<span data-l="lm1:11">2 2<!----></span>');
      dispose();
    });
});

// async-gen seed 91501 #156: `isPending()` of a first load in flight is
// loading (A19 exc. 1): the boundary keeps its fallback until a load lands,
// rather than revealing a span whose attribute effect is still loading.
test("isPending() of a first load in flight keeps the boundary's fallback", async () => {
  const div = document.createElement("div");
  const flights: (() => void)[] = [];
  const [s, set] = createSignal(0, { ownedWrite: true });
  const dispose = render(() => {
    const m0 = createMemo(() => {
      const v = 1 + latest(s);
      return new Promise<number>((res, rej) =>
        flights.push(() => (v === 1 ? rej(new Error("m0:1")) : res(v)))
      );
    });
    return (
      <Errored fallback="[E]">
        <Loading fallback="[L]">
          <span data-a={`ls:${latest(s)}`} data-b={`pm:${isPending(m0)}`} />
        </Loading>
      </Errored>
    );
  }, div);
  flush();
  expect(div.innerHTML).toBe("[L]");
  set(3);
  await tick();
  expect(div.innerHTML).toBe("[L]");
  flights.shift()!();
  await tick();
  expect(div.innerHTML).toBe("[L]");
  flights.shift()!();
  await tick();
  expect(div.innerHTML).toBe('<span data-a="ls:3" data-b="pm:false"></span>');
  dispose();
});
