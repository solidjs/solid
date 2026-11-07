/**
 * `FlushEvent.changes` — what each drain changed on screen.
 *
 * Claim under test: a `flush` record lists every signal, memo and store
 * property whose shown value the drain changed — once per node, with the
 * origin that staged the value — and nothing else: not a write that is held,
 * not a node's first value, not an effect. A held write is listed by the
 * drain that lands it, still naming the action that wrote it; an optimistic
 * value is listed when it appears and again when it lifts. Values travel only
 * to a listener that asked for bodies.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution, type FlushEvent, type FlushLive } from "../src/attribution.js";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  OBSERVE
} from "../src/index.js";
import type { RecordSubscribeOptions } from "../src/core/dev.js";

const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

type Flush = FlushEvent & { live: FlushLive };
function arm(options?: RecordSubscribeOptions): Flush[] {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  attribution.enable({ log: false, checks: false, waterfalls: false });
  const flushes: Flush[] = [];
  offs.push(
    OBSERVE!.records.subscribe("flush", (e, live) => flushes.push({ ...e, live }), options)
  );
  return flushes;
}
/** Each change with its live side: name, key, and the values when bodies were asked for. */
const seen = (flushes: Flush[]) =>
  flushes.flatMap(f => f.changes.map((c, i) => ({ ...c, ...f.live.changes[i], node: undefined })));

const CLICK = { type: "click", target: "button#save" };
const click = <T>(fn: () => T) => OBSERVE!.attribution.withInteraction(CLICK, fn);
const names = (e: FlushEvent) => e.changes.map(c => c.nodeName).sort();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
}

describe("FlushEvent.changes", () => {
  it("lists the drain's changed signals and memos, with the origin that staged them", () => {
    const flushes = arm();
    const [count, setCount] = createSignal(0, { name: "count" });
    createRoot(() => {
      const double = createMemo(() => count() * 2, { name: "double" });
      createRenderEffect(double, () => {}, { name: "paint" });
    });
    flush();
    // First values are not changes.
    expect(flushes.flatMap(f => f.changes)).toEqual([]);
    flushes.length = 0;

    click(() => setCount(1));
    flush();
    expect(flushes).toHaveLength(1);
    expect(names(flushes[0])).toEqual(["count", "double"]);
    const change = flushes[0].changes.find(c => c.nodeName === "count")!;
    expect(change.origin).toMatchObject({ kind: "interaction", name: "click" });
    expect(change.nodeId).toEqual(expect.any(Number));
    // The node travels beside the record; without bodies, no values.
    expect(flushes[0].live.changes.map(c => Object.keys(c))).toEqual([["node"], ["node"]]);
  });

  it("gives one record per drain: two synchronous flushes are two", () => {
    const flushes = arm();
    const [a, setA] = createSignal(0, { name: "a" });
    const [b, setB] = createSignal(0, { name: "b" });
    createRoot(() =>
      createRenderEffect(
        () => a() + b(),
        () => {},
        { name: "paint" }
      )
    );
    flush();
    flushes.length = 0;
    setA(1);
    flush();
    setB(1);
    flush();
    expect(flushes.map(names)).toEqual([["a"], ["b"]]);
  });

  it("carries the values before and after only for a listener that asked for bodies", () => {
    const flushes = arm({ bodies: true });
    const [count, setCount] = createSignal(1, { name: "count" });
    createRoot(() => createRenderEffect(count, () => {}, { name: "paint" }));
    flush();
    setCount(2);
    flush();
    expect(seen(flushes.slice(-1))).toEqual([
      expect.objectContaining({ nodeName: "count", prev: 1, value: 2 })
    ]);
    // The event itself carries no values: it stays serializable.
    expect("value" in flushes.at(-1)!.changes[0]).toBe(false);
  });

  it("names a store property by its key", () => {
    const flushes = arm({ bodies: true });
    const [state, setState] = createStore({ title: "a", done: false });
    createRoot(() =>
      createRenderEffect(
        () => state.title,
        () => {},
        { name: "paint" }
      )
    );
    flush();
    flushes.length = 0;
    setState(s => {
      s.title = "b";
    });
    flush();
    expect(seen(flushes)).toEqual([
      expect.objectContaining({ key: "title", prev: "a", value: "b" })
    ]);
  });

  it("lists a held write in the drain that lands it, naming the action that wrote it", async () => {
    const flushes = arm();
    const gate = deferred();
    const [saved, setSaved] = createSignal("draft", { name: "saved" });
    createRoot(() => createRenderEffect(saved, () => {}, { name: "paint" }));
    flush();
    flushes.length = 0;
    const submit = action(function* save() {
      setSaved("final");
      yield gate.promise;
    });
    const done = submit();
    flush();
    // Held: the screen still shows "draft".
    expect(saved()).toBe("draft");
    expect(flushes.flatMap(f => f.changes)).toEqual([]);
    gate.resolve();
    await done;
    flush();
    const landed = flushes.flatMap(f => f.changes);
    expect(landed).toEqual([expect.objectContaining({ nodeName: "saved" })]);
    expect(landed[0].origin).toMatchObject({ kind: "action", name: "save" });
  });

  it("lists an optimistic value when it appears and again when it lifts", async () => {
    const flushes = arm({ bodies: true });
    const gate = deferred();
    const [status, setStatus] = createOptimistic("idle", { name: "status" });
    createRoot(() => createRenderEffect(status, () => {}, { name: "badge" }));
    flush();
    flushes.length = 0;
    const save = action(function* save() {
      setStatus("saving");
      yield gate.promise;
    });
    const done = save();
    flush();
    expect(status()).toBe("saving");
    expect(seen(flushes)).toEqual([
      expect.objectContaining({ nodeName: "status", prev: "idle", value: "saving" })
    ]);
    flushes.length = 0;
    gate.resolve();
    await done;
    flush();
    expect(status()).toBe("idle");
    expect(seen(flushes)).toEqual([
      expect.objectContaining({ nodeName: "status", prev: "saving", value: "idle" })
    ]);
  });

  it("is empty for a drain that changed nothing on screen", () => {
    const flushes = arm();
    const [count, setCount] = createSignal(0, { name: "count" });
    createRoot(() =>
      createRenderEffect(
        () => count() % 2,
        () => {},
        { name: "parity" }
      )
    );
    flush();
    flushes.length = 0;
    setCount(0);
    setCount(2);
    flush();
    // `count` changed (0 → 2); the effect's output did not, and effects are never listed.
    expect(flushes.map(names)).toEqual([["count"]]);
  });
});
