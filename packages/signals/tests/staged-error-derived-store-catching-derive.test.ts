/**
 * D-41 and D-30: a derived store whose derive catches its source's staged
 * error answers with its own pass: no key throws the error, and a key that
 * never read the source (`a`) keeps its value — pending is per key.
 *
 * `d => { d.a = 7; try { d.b = m0() } catch { d.b = "caught" } }`; an action
 * makes `m0` throw and a hold keeps the write.
 */
import { afterEach, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  latest,
  resetErrorHalt
} from "../src/index.js";

afterEach(() => resetErrorHalt());
const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};
const attempt = (fn: () => unknown) => {
  try {
    return fn();
  } catch (e: any) {
    return `throws ${e?.cause?.message ?? e?.message}`;
  }
};

function setup(plainReader: boolean) {
  const [s, setS] = createSignal(2);
  let st!: { a?: number; b?: unknown };
  const dispose = createRoot(d => {
    const m0 = createMemo(() => {
      const v = s() + 1;
      if (v % 4 === 1) throw new Error(`m0:${v}`);
      return v;
    });
    const [store] = createStore<{ a?: number; b?: unknown }>(dr => {
      dr.a = 7;
      try {
        dr.b = m0();
      } catch {
        dr.b = "caught";
      }
    }, {});
    st = store;
    createRenderEffect(
      () => [attempt(() => latest(() => store.a)), attempt(() => latest(() => store.b))],
      () => {}
    );
    if (plainReader)
      createRenderEffect(
        () => [attempt(() => store.a), attempt(() => store.b)],
        () => {}
      );
    return d;
  });
  flush();
  return { setS, st: () => st, dispose };
}

it("latest() of a key that never read the source does not throw its staged error", async () => {
  const { setS, st, dispose } = setup(true);
  let release!: () => void;
  action(function* () {
    setS(0);
    yield new Promise<void>(r => (release = r));
  })();
  await tick();
  expect(attempt(() => latest(() => st().a))).toBe(7);
  expect(attempt(() => latest(() => st().b))).toBe("caught");
  release();
  await tick();
  await tick();
  expect([attempt(() => st().a), attempt(() => st().b)]).toEqual([7, "caught"]);
  dispose();
});

it("a store read only through latest() commits its derive's own answer", async () => {
  const { setS, st, dispose } = setup(false);
  let release!: () => void;
  action(function* () {
    setS(0);
    yield new Promise<void>(r => (release = r));
  })();
  await tick();
  release();
  await tick();
  await tick();
  expect([attempt(() => st().a), attempt(() => st().b)]).toEqual([7, "caught"]);
  dispose();
});
