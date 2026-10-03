import { describe, expect, it } from "vitest";
import {
  NotReadyError,
  action,
  createLoadingBoundary,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  untrack,
  type Store
} from "../../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

describe("sync landing after a pending first flight wakes unchanged-node readers (#3726)", () => {
  it("presence read inside a loading boundary shows the landed answer", async () => {
    const [source, setSource] = createSignal<number[] | null>(null);
    let resolve!: (v: number[]) => void;
    let presence = "";
    let sourceState = "";
    createRoot(() => {
      const [store] = createStore<number[]>(() => {
        const s = source();
        if (s) return s;
        return new Promise<number[]>(r => (resolve = r));
      }, []);
      createLoadingBoundary(
        () => {
          createRenderEffect(
            () => ("length" in store ? "present" : "missing"),
            v => {
              presence = v;
            }
          );
          createRenderEffect(
            () => (source() ? "resolved" : "pending"),
            v => {
              sourceState = v;
            }
          );
        },
        () => "fallback"
      );
    });
    flush();
    expect(presence).toBe("");
    expect(sourceState).toBe("pending");

    setSource([1]);
    flush();
    expect(sourceState).toBe("resolved");
    expect(presence).toBe("present");

    resolve([2, 2]);
    await tick();
    flush();
    expect(presence).toBe("present");
  });

  it("readers of presence, length and keys wake when the landing leaves them unchanged", () => {
    const [source, setSource] = createSignal<number[] | null>(null);
    const seen: string[] = [];
    createRoot(() => {
      const [store] = createStore<number[]>(() => {
        const s = source();
        if (s) return s;
        return new Promise<number[]>(() => {});
      }, []);
      createRenderEffect(
        () => (0 in store ? "present" : "missing"),
        v => {
          seen.push(`in:${v}`);
        }
      );
      createRenderEffect(
        () => store.length,
        v => {
          seen.push(`length:${v}`);
        }
      );
      createRenderEffect(
        () => Object.keys(store).length,
        v => {
          seen.push(`keys:${v}`);
        }
      );
    });
    flush();
    expect(seen).toEqual([]);

    setSource([]);
    flush();
    expect(seen.sort()).toEqual(["in:missing", "keys:0", "length:0"]);
  });

  it("a landing held by a transaction keeps the seed invisible until the commit", async () => {
    const [source, setSource] = createSignal<number[] | null>(null);
    let release!: () => void;
    let store!: Store<number[]>;
    createRoot(() => {
      [store] = createStore<number[]>(() => source() ?? new Promise(() => {}), [9, 9, 9]);
    });
    flush();

    const done = action(function* () {
      setSource([1]);
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    expect(() => untrack(() => [...store])).toThrow(NotReadyError);

    release();
    await done;
    await tick();
    flush();
    expect(untrack(() => [...store])).toEqual([1]);
  });
});
