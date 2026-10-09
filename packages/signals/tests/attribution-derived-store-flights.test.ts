/**
 * A derived store's async landing must finalize its flight (#3947).
 *
 * `createStore(async fn, seed)` lands through the setter branch of
 * `asyncWrite`, which used to skip `asyncEnd`. The flight stayed open, so
 * the next reload's `trackFlightStart` counted the committed answer as
 * abandoned. A plain `createMemo` of the same sequence lands both.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution, feedback } from "../src/attribution.js";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../src/index.js";

afterEach(() => {
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, timeout = 5000) {
  const start = Date.now();
  for (;;) {
    flush();
    if (cond()) return;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await wait(5);
  }
}

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  attribution.enable({ log: false });
}

describe("derived store flight finalize (#3947)", () => {
  it("a reload that commits both answers lands both flights", async () => {
    arm();
    const [page, setPage] = createSignal(1);
    let resolve!: (v: { title: string }) => void;
    const [doc] = createStore(
      () => {
        page();
        return new Promise<{ title: string }>(r => (resolve = r));
      },
      { title: "" },
      { name: "doc" }
    );
    const shown: string[] = [];
    createRoot(() =>
      createRenderEffect(
        () => doc.title,
        title => {
          shown.push(title);
        }
      )
    );
    flush();
    resolve({ title: "one" });
    await until(() => shown.includes("one"), "first store answer");
    setPage(2);
    flush();
    resolve({ title: "two" });
    await until(() => shown.includes("two"), "second store answer");
    expect(shown).toEqual(["one", "two"]);
    expect(feedback().flights).toEqual([
      {
        source: "doc",
        flights: 2,
        landed: 2,
        abandoned: 0,
        landedMs: expect.any(Number),
        worstMs: expect.any(Number)
      }
    ]);
  });

  it("a plain async memo of the same sequence lands both flights", async () => {
    arm();
    const [page, setPage] = createSignal(1);
    let resolve!: (v: string) => void;
    const title = createMemo(
      () => {
        page();
        return new Promise<string>(r => (resolve = r));
      },
      { name: "doc" }
    );
    const shown: string[] = [];
    createRoot(() =>
      createRenderEffect(title, v => {
        shown.push(v);
      })
    );
    flush();
    resolve("one");
    await until(() => shown.includes("one"), "first memo answer");
    setPage(2);
    flush();
    resolve("two");
    await until(() => shown.includes("two"), "second memo answer");
    expect(shown).toEqual(["one", "two"]);
    expect(feedback().flights).toEqual([
      {
        source: "doc",
        flights: 2,
        landed: 2,
        abandoned: 0,
        landedMs: expect.any(Number),
        worstMs: expect.any(Number)
      }
    ]);
  });
});
