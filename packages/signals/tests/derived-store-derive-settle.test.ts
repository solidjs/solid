import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../src/index.js";

// A derived store over an async memo (`d.v = m()`) reads like the memo
// (async-gen E3). The derive went pending on the memo's flight, and the
// flight settled without the derive re-running: the settle retired the memo
// from the derive, and now re-runs the derive, whose commit settles the
// store's readers
// (F-12: a rejection staged in the transaction lands; its isPending twin,
// F-9, is pinned in web's async-gen store-derive-settle-e3.spec.ts).
const micro = () => Promise.resolve();
const drain = async () => {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 6; j++) await micro();
    flush();
    await new Promise(r => setTimeout(r, 0));
  }
  flush();
};

function app(
  kind: "memo" | "store",
  init: number,
  poison: number | null,
  leaf: (v: () => any) => string
) {
  const flights: (() => void)[] = [];
  const [s, setS] = createSignal(init);
  let screen = "";
  const dispose = createRoot(d => {
    const m = createMemo(() => {
      const v = s() + 1;
      return new Promise<number>((res, rej) =>
        flights.push(() => (v % 4 === poison ? rej(new Error(`m0:${v}`)) : res(v)))
      );
    });
    let view: () => any = m;
    if (kind === "store") {
      const [st] = createStore<{ v?: number }>(d => {
        d.v = m();
      }, {});
      view = () => st.v;
    }
    const b = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => createMemo(() => leaf(view)),
          () => "[L]"
        ),
      () => "[E]"
    );
    createRenderEffect(
      () => {
        const r: any = b();
        return typeof r === "function" ? r() : r;
      },
      v => {
        screen = String(v);
      }
    );
    return d;
  });
  flush();
  const settleAll = async () => {
    await drain();
    while (flights.length) {
      flights.shift()!();
      await drain();
    }
  };
  return { flights, setS, settleAll, screen: () => screen, dispose };
}

for (const kind of ["memo", "store"] as const) {
  it(`${kind}: a refetch's rejection, asked in the first answer's flush, shows the error`, async () => {
    const a = app(kind, 2, 1, v => `v${v()}`);
    a.flights.shift()!();
    await micro();
    a.setS(0);
    await a.settleAll();
    expect(a.screen()).toBe("[E]");
    a.dispose();
  });
}
