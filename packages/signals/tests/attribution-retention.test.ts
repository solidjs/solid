/**
 * The cost and feedback tables and the history buffers outlive the nodes they
 * measured: a row or record stays until the engine resets, and holds no node.
 */
import { Session } from "node:inspector/promises";
import { afterEach, expect, it, vi } from "vitest";
import { attribution, costs, feedback } from "../src/attribution.js";
import {
  createEffect,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner,
  OBSERVE
} from "../src/index.js";

afterEach(() => {
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

async function collectGarbage() {
  // WeakRef targets survive the job that created them.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  const inspector = new Session();
  inspector.connect();
  try {
    await inspector.post("HeapProfiler.collectGarbage");
    await inspector.post("HeapProfiler.collectGarbage");
  } finally {
    inspector.disconnect();
  }
}

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false });
}

it("costs() keeps the row of a disposed scope and releases the scope", async () => {
  arm();
  const [n, setN] = createSignal(0, { name: "n" });
  const refs = (() => {
    const payload = { retained: true };
    let refs!: WeakRef<object>[];
    const dispose = createRoot(dispose => {
      refs = [new WeakRef(payload), new WeakRef(getOwner()!)];
      createEffect(
        () => [n(), payload],
        () => {},
        { name: "disposed-effect" }
      );
      return dispose;
    });
    flush();
    setN(1);
    flush();
    dispose();
    return refs;
  })();
  flush();
  await collectGarbage();
  expect(refs.map(ref => ref.deref())).toEqual([undefined, undefined]);
  expect(costs().scopes.find(scope => scope.name === "disposed-effect")).toMatchObject({
    kind: "effect",
    runs: 1
  });
});

it("feedback() keeps the rows of a disposed async source and boundary and releases both", async () => {
  arm();
  let land: ((value: string) => void) | undefined;
  let dispose: (() => void) | undefined;
  const refs = (() => {
    const payload = { retained: true };
    let refs!: WeakRef<object>[];
    dispose = createRoot(dispose => {
      refs = [new WeakRef(payload), new WeakRef(getOwner()!)];
      const posts = createMemo(
        () => new Promise<string>(resolve => (land = resolve)).then(value => [value, payload]),
        { name: "disposed-posts" }
      );
      const view = createLoadingBoundary(
        () => posts(),
        () => "loading…"
      );
      createRenderEffect(view, () => {});
      return dispose;
    });
    flush();
    return refs;
  })();
  land!("a");
  await new Promise(resolve => setTimeout(resolve, 0));
  flush();
  dispose();
  land = dispose = undefined;
  flush();
  // Core holds the last landed flight's readers until another flight lands.
  const other = createRoot(dispose => {
    createRenderEffect(
      createMemo(() => Promise.resolve(1)),
      () => {}
    );
    return dispose;
  });
  flush();
  await new Promise(resolve => setTimeout(resolve, 0));
  flush();
  other();
  flush();
  await collectGarbage();
  expect(refs.map(ref => ref.deref())).toEqual([undefined, undefined]);
  const { flights, fallbacks } = feedback();
  expect(flights.find(flight => flight.source === "disposed-posts")).toMatchObject({
    flights: 1,
    landed: 1
  });
  expect(fallbacks).toEqual([expect.objectContaining({ shows: 1 })]);
});

it("history() keeps the rerun caused by a disposed effect's write and releases the effect", async () => {
  arm();
  const off = OBSERVE!.records.subscribe("rerun", () => {});
  const [n, setN] = createSignal(0, { name: "n" });
  const refs = (() => {
    const payload = { retained: true };
    let refs!: WeakRef<object>[];
    const dispose = createRoot(dispose => {
      refs = [new WeakRef(payload), new WeakRef(getOwner()!)];
      const [copy, setCopy] = createSignal(0, { name: "copy" });
      createEffect(
        () => [n(), payload] as const,
        ([value]) => {
          setCopy(value);
        },
        { name: "relay" }
      );
      createEffect(copy, () => {}, { name: "disposed-reader" });
      return dispose;
    });
    flush();
    setN(1);
    flush();
    dispose();
    return refs;
  })();
  flush();
  off();
  await collectGarbage();
  expect(refs.map(ref => ref.deref())).toEqual([undefined, undefined]);
  expect(attribution.history("rerun").map(event => event.nodeName)).toContain("disposed-reader");
});

it("costs() folds the rows of collected scopes into one row per name", async () => {
  arm();
  const [n, setN] = createSignal(0, { name: "n" });
  for (let i = 0; i < 3; i++) {
    const dispose = createRoot(dispose => {
      createEffect(n, () => {}, { name: "remounted-effect" });
      return dispose;
    });
    flush();
    setN(value => value + 1);
    flush();
    dispose();
  }
  flush();
  // Finalizers run in their own task, some time after the collection.
  await vi.waitFor(
    async () => {
      await collectGarbage();
      expect(costs().scopes.filter(scope => scope.name === "remounted-effect")).toEqual([
        expect.objectContaining({ kind: "effect", runs: 3 })
      ]);
    },
    { timeout: 5000 }
  );
});

it("a new window releases the rows of the window before it", async () => {
  arm();
  const [n, setN] = createSignal(0, { name: "n" });
  const dispose = createRoot(dispose => {
    createEffect(n, () => {}, { name: "long-lived-effect" });
    return dispose;
  });
  flush();
  setN(1);
  flush();
  const row = new WeakRef(costs().scopes.find(scope => scope.name === "long-lived-effect")!);
  attribution.disable();
  arm();
  await collectGarbage();
  expect(row.deref()).toBeUndefined();
  dispose();
});
