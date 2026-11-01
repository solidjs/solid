import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

// #4568: a `latest()` reader under a fresh <Loading> whose source settled was
// queued to re-derive (A19) with the pending it carried retired. A sibling
// settling judged the boundary's readers by status before that pass ran, and
// the boundary revealed into a hold the reader's pass then went pending in —
// a hold on the next flight. The rejection that came after was staged in it
// (D-41) and reached <Errored> only when that obsolete flight landed.

const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

function run(mode: "plain" | "latest") {
  const flights = new Map<string, { resolve: (v: number) => void; reject: (e: Error) => void }>();
  const ask = (key: string) =>
    new Promise<number>((resolve, reject) => flights.set(key, { resolve, reject }));
  const [s, setS] = createSignal(0);
  let out = "";
  const dispose = createRoot(dispose => {
    const a0 = createMemo(() => ask("a0:" + s()));
    const a1 = createMemo(async () => ask("a1:" + (await a0())));
    const c0 = createMemo(() => `${a1()}.${a0()}`);
    const view = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => {
            createRenderEffect(
              () => a0(),
              () => {}
            );
            createRenderEffect(
              () => (mode === "latest" ? latest(c0) : c0()),
              () => {}
            );
            return "content";
          },
          () => "[L]"
        ),
      (e: () => any) => `[E ${e()?.message}]`
    );
    createRenderEffect(
      () => {
        const v = view();
        return typeof v === "function" ? (v as () => unknown)() : v;
      },
      v => void (out = String(v))
    );
    return dispose;
  });
  return { flights, setS, out: () => out, dispose };
}

for (const mode of ["plain", "latest"] as const)
  it(`a rejection under a fresh Loading reaches Errored without waiting on an obsolete flight (${mode})`, async () => {
    const { flights, setS, out, dispose } = run(mode);
    await tick();
    setS(1);
    flush();
    await tick();
    flights.get("a0:1")!.resolve(12);
    await tick();
    // Nothing under the fresh boundary holds: the fallback stays.
    expect(out()).toBe("[L]");
    setS(2);
    flush();
    await tick();
    flights.get("a0:2")!.reject(new Error("boom"));
    for (let i = 0; i < 3; i++) await tick();
    const afterReject = out();
    flights.get("a1:12")!.resolve(7);
    await tick();
    const afterObsolete = out();
    dispose();
    expect({ afterReject, afterObsolete }).toEqual({
      afterReject: "[E boom]",
      afterObsolete: "[E boom]"
    });
  });
