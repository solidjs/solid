/**
 * D-41: a derivation that reads a staged error throws it, as it would read a
 * staged value — its own pass errors and stages with the same frame. A memo
 * whose pass catches the error does not error: its answer is its own value,
 * staged with the frame and committed with it.
 *
 * `m0` throws for the action's write, which a hold keeps; `m` catches it.
 */
import { afterEach, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
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
  let m!: () => unknown;
  const latestScreens: unknown[] = [];
  const dispose = createRoot(d => {
    const m0 = createMemo(() => {
      const v = s() + 1;
      if (v % 4 === 1) throw new Error(`m0:${v}`);
      return v;
    });
    m = createMemo(() => {
      try {
        return `ok:${m0()}`;
      } catch {
        return "caught";
      }
    });
    createRenderEffect(
      () => attempt(() => latest(m)),
      v => void latestScreens.push(v)
    );
    if (plainReader)
      createRenderEffect(
        () => [attempt(() => m()), isPending(m)],
        () => {}
      );
    return d;
  });
  flush();
  return { setS, m: () => m, latestScreens, dispose };
}

it("a catching memo never shows its source's staged error", async () => {
  const { setS, m, latestScreens, dispose } = setup(true);
  let release!: () => void;
  action(function* () {
    setS(0);
    yield new Promise<void>(r => (release = r));
  })();
  await tick();
  // Its own pass's answer to the frame, seen early through `latest`.
  expect(attempt(() => latest(m()))).toBe("caught");
  expect(attempt(() => m()())).toBe("ok:3");
  release();
  await tick();
  await tick();
  expect(latestScreens).toEqual(["ok:3", "caught"]);
  expect(attempt(() => m()())).toBe("caught");
  dispose();
});

it("a catching memo read only through latest() commits its own answer", async () => {
  const { setS, m, latestScreens, dispose } = setup(false);
  let release!: () => void;
  action(function* () {
    setS(0);
    yield new Promise<void>(r => (release = r));
  })();
  await tick();
  release();
  await tick();
  await tick();
  expect(attempt(() => m()())).toBe("caught");
  expect(latestScreens).toEqual(["ok:3", "caught"]);
  dispose();
});

it("a catching memo over an error of a flush with no hold commits its own answer", () => {
  const { setS, m, latestScreens, dispose } = setup(false);
  setS(0);
  flush();
  expect(attempt(() => m()())).toBe("caught");
  expect(latestScreens).toEqual(["ok:3", "caught"]);
  dispose();
});
