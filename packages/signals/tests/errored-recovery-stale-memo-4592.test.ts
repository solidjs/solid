import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

// #4592: `a` and `b` both ask by `s`; `b:0` rejects and `<Errored>` shows
// its fallback. `s` changes and both re-ask. `b:1` landing while `a:1` is
// still out is not a whole frame (F-1). With no boundary between, the error
// stays the display until every reader can answer the current `s` (D-39: a
// pending is not a value). Inside a Loading, the recovery re-arms the
// subtree: the Loading catches `a:1` and shows its fallback (ruled
// 2026-11-02, #4627, D-39, F-4).
const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

async function run(loading: boolean) {
  const flights = new Map<string, { resolve: (v: number) => void; reject: (e: Error) => void }>();
  const ask = (key: string) =>
    new Promise<number>((resolve, reject) => flights.set(key, { resolve, reject }));
  const [s, setS] = createSignal(0);
  const cells: Record<string, unknown> = {};
  let shown: unknown;
  const frames: string[] = [];
  const frame = () =>
    shown === "error"
      ? "error"
      : shown === "loading"
        ? "loading"
        : `s=${cells.s}a=${cells.a}b=${cells.b}`;
  const dispose = createRoot(dispose => {
    const a = createMemo(() => ask("a:" + s()));
    const b = createMemo(() => ask("b:" + s()));
    const content = () => {
      createRenderEffect(s, v => void (cells.s = v));
      createRenderEffect(a, v => void (cells.a = v));
      createRenderEffect(b, v => void (cells.b = v));
      return "content";
    };
    const view = createErrorBoundary(
      () => (loading ? createLoadingBoundary(content, () => "loading") : content()),
      () => "error"
    );
    createRenderEffect(view, v => void (shown = v));
    return dispose;
  });
  await tick();
  flights.get("a:0")!.resolve(10);
  await tick();
  flights.get("b:0")!.reject(new Error("boom"));
  await tick();
  frames.push(frame());
  setS(1);
  flush();
  await tick();
  frames.push(frame());
  flights.get("b:1")!.resolve(21);
  await tick();
  frames.push(frame());
  flights.get("a:1")!.resolve(11);
  await tick();
  frames.push(frame());
  dispose();
  return frames;
}

it("no Loading: the error stays until every reader answers the new input (#4592)", async () => {
  expect(await run(false)).toEqual(["error", "error", "error", "s=1a=11b=21"]);
});

it("inside Loading: the recovery shows the Loading's fallback while a reader still asks (#4592, #4627)", async () => {
  expect(await run(true)).toEqual(["error", "error", "loading", "s=1a=11b=21"]);
});
