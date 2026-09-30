import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
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
    resolve([1]);
    flush();
    await tick();
    flush();
    expect(sourceState).toBe("resolved");
    expect(presence).toBe("present");
  });

  it("readers of presence, length and keys wake when the landing leaves them unchanged", () => {
    const [source, setSource] = createSignal<{ a?: number } | null>(null);
    const seen: string[] = [];
    createRoot(() => {
      const [store] = createStore<{ a?: number }>(() => {
        const s = source();
        if (s) return s;
        return new Promise<{ a?: number }>(() => {});
      }, {});
      createRenderEffect(
        () => ("a" in store ? "present" : "missing"),
        v => {
          seen.push(`in:${v}`);
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

    setSource({});
    flush();
    expect(seen.sort()).toEqual(["in:missing", "keys:0"]);
  });
});
