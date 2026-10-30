import { describe, expect, it } from "vitest";
import {
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

// D-42 / S-47: `try/catch` around a reactive read is not a channel. A read's
// throw — `NotReadyError` or an error — is addressed to the graph. A dependent
// of a node that goes pending or errored is MARKED with that status and does
// not run (`propagateStatus`: the status rides the edge so dependents are not
// re-executed just to re-throw), so a catch around the read runs only when
// the computation happens to run while the source is already in that state,
// and never when the state changes under it. For not-ready, these pins record
// the bypass as it is: a catch that runs masks the load (not a target). For
// errors the catch is fully inert (F-12, #4410, #4486): a reader of an
// errored memo is errored with it whether or not it catches —
// `errored-reader-4486.test.ts` pins the screens.

let resolvers: ((v: any) => void)[] = [];
function pending<T>(): Promise<T> {
  return new Promise<T>(r => resolvers.push(r));
}
async function settle() {
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
  }
}

describe("D-42: try/catch around a reactive read is not a channel", () => {
  it("not ready: the catch masks the first load and is bypassed by the re-ask", async () => {
    resolvers = [];
    const runs: string[] = [];
    const screens: string[] = [];
    let setId!: (v: number) => void;
    createRoot(() => {
      const [id, _setId] = createSignal(0);
      setId = _setId;
      const data = createMemo(async () => {
        const v = id();
        await pending<void>();
        return `d${v}`;
      });
      const guarded = createMemo(() => {
        runs.push("run");
        try {
          return data();
        } catch (e) {
          runs.push(`caught:${(e as Error).constructor.name}`);
          return "caught";
        }
      });
      createRenderEffect(
        () => guarded(),
        v => {
          screens.push(v);
        }
      );
    });
    flush();
    await settle();
    // The first pass ran while `data` was loading: the catch fired and the
    // computation completed with a value — the first load is masked (no
    // fallback, no hold; a `<Loading>` above would never see it).
    expect(runs).toEqual(["run", "caught:NotReadyError"]);
    expect(screens).toEqual(["caught"]);

    resolvers.shift()!(undefined);
    await settle();
    expect(screens).toEqual(["caught", "d0"]);

    // The re-ask: `data` goes pending; `guarded` is marked, not run — the
    // catch never sees it, and the write is held through `guarded` as if the
    // catch were not there (F-2).
    setId(1);
    flush();
    await settle();
    expect(runs).toEqual(["run", "caught:NotReadyError", "run"]);
    expect(screens).toEqual(["caught", "d0"]);

    resolvers.shift()!(undefined);
    await settle();
    expect(screens).toEqual(["caught", "d0", "d1"]);
  });

  it("error: the catch is bypassed when the source errors under it; the boundary catches instead", () => {
    const runs: string[] = [];
    const screens: string[] = [];
    let setMode!: (v: number) => void;
    createRoot(() => {
      const [mode, _setMode] = createSignal(0);
      setMode = _setMode;
      const source = createMemo(() => {
        if (mode() === 1) throw new Error("boom");
        return `m${mode()}`;
      });
      const guarded = createMemo(() => {
        runs.push("run");
        try {
          return source();
        } catch (e) {
          runs.push(`caught:${(e as Error).message}`);
          return "caught";
        }
      });
      const out = createErrorBoundary(
        () => guarded(),
        err => `errored:${(err() as Error).message}`
      );
      createRenderEffect(
        () => out(),
        v => {
          screens.push(v);
        }
      );
    });
    flush();
    expect(screens).toEqual(["m0"]);

    // `source` errors; `guarded` is marked errored by propagation and does
    // not run, so its catch never fires: the error reaches `<Errored>`.
    setMode(1);
    flush();
    expect(runs).toEqual(["run"]);
    expect(screens).toEqual(["m0", "errored:boom"]);

    setMode(2);
    flush();
    expect(runs).toEqual(["run", "run"]);
    expect(screens).toEqual(["m0", "errored:boom", "m2"]);
  });

  it("error: a computation created over an already-errored source is errored with it, though its catch runs", () => {
    const runs: string[] = [];
    const screens: string[] = [];
    createRoot(() => {
      const [mode] = createSignal(1);
      const source = createMemo(() => {
        if (mode() === 1) throw new Error("boom");
        return `m${mode()}`;
      });
      const guarded = createMemo(() => {
        runs.push("run");
        try {
          return source();
        } catch (e) {
          runs.push(`caught:${(e as Error).message}`);
          return "caught";
        }
      });
      const out = createErrorBoundary(
        () => guarded(),
        err => `errored:${(err() as Error).message}`
      );
      createRenderEffect(
        () => out(),
        v => {
          screens.push(v);
        }
      );
    });
    flush();
    // Same code, the same outcome as the bypass above: the catch ran, and
    // the pass is errored with `source` all the same (F-12, #4410, #4486).
    // "caught" never shows.
    expect(runs).toEqual(["run", "caught:boom"]);
    expect(screens).toEqual(["errored:boom"]);
  });
});
