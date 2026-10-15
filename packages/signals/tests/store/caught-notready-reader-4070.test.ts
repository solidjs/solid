/**
 * #4070 — an effect whose compute catches the NotReadyError an async derived
 * store's read throws ran once with its fallback and never again: the
 * landing commits through the store's leaves, and the reader threw at the
 * firewall pull (`pullFamily`) before it read a leaf. It is linked to the
 * firewall only, it is not pending (it caught), and the firewall's own
 * value never changes, so neither the leaf notify nor the settle walk
 * reached it. A memo's landing is a value change for its readers; the
 * derive's landing is the same change for the readers that observed its
 * flight.
 */
import { describe, expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../../src/index.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

function caughtEffect(read: () => number, seen: string[]) {
  createEffect(
    () => {
      try {
        return `len=${read()}`;
      } catch {
        return "not-ready";
      }
    },
    v => {
      seen.push(v);
    }
  );
}

describe("a reader that catches an async derived store's NotReadyError re-runs at the landing (#4070)", () => {
  it("seeded store: the first landing re-runs the catching effect", async () => {
    const d = deferred<{ id: string }[]>();
    const seen: string[] = [];
    const dispose = createRoot(dispose => {
      const [rows] = createStore(async () => await d.promise, [] as { id: string }[]);
      caughtEffect(() => rows.length, seen);
      return dispose;
    });
    flush();
    d.resolve([{ id: "a" }]);
    await sleep(10);
    flush();
    expect(seen).toEqual(["not-ready", "len=1"]);
    dispose();
  });

  it("seedless store: the first landing re-runs the catching effect", async () => {
    const d = deferred<{ n: number }>();
    const seen: string[] = [];
    const dispose = createRoot(dispose => {
      const [s] = createStore(async () => await d.promise);
      caughtEffect(() => s.n, seen);
      return dispose;
    });
    flush();
    d.resolve({ n: 3 });
    await sleep(10);
    flush();
    expect(seen).toEqual(["not-ready", "len=3"]);
    dispose();
  });

  it("matches an async memo read the same way", async () => {
    const d = deferred<{ id: string }[]>();
    const seen: string[] = [];
    const dispose = createRoot(dispose => {
      const m = createMemo(async () => await d.promise);
      caughtEffect(() => m().length, seen);
      return dispose;
    });
    flush();
    d.resolve([{ id: "a" }]);
    await sleep(10);
    flush();
    expect(seen).toEqual(["not-ready", "len=1"]);
    dispose();
  });

  it("a refetch's landing re-runs a reader that caught during the refetch", async () => {
    const [id, setId] = createSignal(1);
    const seen: string[] = [];
    let ds: ReturnType<typeof deferred<number[]>>[] = [];
    const dispose = createRoot(dispose => {
      const [rows] = createStore(async () => {
        id();
        const d = deferred<number[]>();
        ds.push(d);
        return await d.promise;
      }, [] as number[]);
      caughtEffect(() => rows.length, seen);
      return dispose;
    });
    flush();
    ds[0].resolve([1]);
    await sleep(10);
    flush();
    expect(seen).toEqual(["not-ready", "len=1"]);
    setId(2);
    flush();
    ds[1].resolve([1, 2]);
    await sleep(10);
    flush();
    expect(seen[seen.length - 1]).toBe("len=2");
    dispose();
  });

  it("an effect that does not catch still runs once, with the landed value", async () => {
    const d = deferred<{ id: string }[]>();
    const seen: string[] = [];
    const dispose = createRoot(dispose => {
      const [rows] = createStore(async () => await d.promise, [] as { id: string }[]);
      createEffect(
        () => `len=${rows.length}`,
        v => {
          seen.push(v);
        }
      );
      return dispose;
    });
    flush();
    d.resolve([{ id: "a" }]);
    await sleep(10);
    flush();
    expect(seen).toEqual(["len=1"]);
    dispose();
  });
});
