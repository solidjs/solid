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
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  OBSERVE,
  refresh
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
    const submit = action(function* save() {
      setStatus("saving");
      yield gate.promise;
    });
    const done = submit();
    flush();
    expect(status()).toBe("saving");
    expect(seen(flushes)).toEqual([
      expect.objectContaining({ nodeName: "status", prev: "idle", value: "saving" })
    ]);
    // The guess carries the origin it was written under.
    expect(flushes[0].changes[0].origin).toMatchObject({ kind: "action", name: "save" });
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

/**
 * A store guess shows through the store's guess carrier while the guessed
 * keys' own nodes stay silent (F-11). The record still names each property
 * whose shown value the guess changed — when it appears and when it lifts —
 * with the values the screen showed, as a plain store write is listed.
 */
describe("FlushEvent.changes: store guesses", () => {
  /** An optimistic store whose fetcher answers `db` when its gate opens. */
  function server<T>(initial: T) {
    let db = initial;
    let gate = Promise.resolve();
    return {
      fetch: async () => {
        await gate;
        return structuredClone(db);
      },
      set: (v: T) => void (db = v),
      hold: () => {
        const d = deferred();
        gate = d.promise;
        return d.resolve;
      }
    };
  }
  const settle = async () => {
    flush();
    await new Promise(r => setTimeout(r, 0));
    flush();
  };
  /** The store-property changes of the flushes: `name[key] prev → value`. */
  const props = (flushes: Flush[]) =>
    seen(flushes)
      .filter(c => c.nodeName.startsWith("list.") && !c.nodeName.endsWith(".$guess"))
      .map(c => `${c.nodeName}[${c.key}] ${JSON.stringify(c.prev)} → ${JSON.stringify(c.value)}`);

  it("names the length and the new index of a push, and confirms an equal answer silently", async () => {
    const flushes = arm({ bodies: true });
    const db = server(["a", "b"]);
    const [list, setList] = createOptimisticStore(db.fetch, [] as string[], { name: "list" });
    const shown: string[] = [];
    createRoot(() =>
      createRenderEffect(
        () => list.join(","),
        v => void shown.push(v),
        { name: "paint" }
      )
    );
    await settle();
    expect(shown.at(-1)).toBe("a,b");
    flushes.length = 0;

    const open = db.hold();
    const add = action(function* addItem(x: string) {
      setList(l => {
        l.push(x);
      });
      db.set(["a", "b", x]);
      yield refresh(list);
    });
    const done = add("c");
    flush();
    expect(shown.at(-1)).toBe("a,b,c");
    expect(props(flushes).sort()).toEqual([
      'list.2[2] undefined → "c"',
      "list.length[length] 2 → 3"
    ]);
    expect(flushes[0].changes.find(c => c.key === "length")!.origin).toMatchObject({
      kind: "action",
      name: "addItem"
    });
    flushes.length = 0;

    open();
    await done;
    await settle();
    expect(shown.at(-1)).toBe("a,b,c");
    // The answer equals the guess: nothing shown changed, nothing is named again.
    expect(props(flushes)).toEqual([]);
  });

  it("names a guessed nested property, and lifts it when the action ends without an answer", async () => {
    const flushes = arm({ bodies: true });
    type Row = { id: number; read: boolean };
    const db = server<Row[]>([
      { id: 1, read: false },
      { id: 2, read: false }
    ]);
    const [list, setList] = createOptimisticStore(db.fetch, [] as Row[], {
      key: "id",
      name: "list"
    });
    createRoot(() =>
      createRenderEffect(
        () => list.map(r => r.read).join(","),
        () => {},
        { name: "paint" }
      )
    );
    await settle();
    flushes.length = 0;

    const gate = deferred();
    const markRead = action(function* markRead() {
      setList(l => {
        l[0].read = true;
      });
      yield gate.promise;
    });
    const done = markRead();
    flush();
    expect(list[0].read).toBe(true);
    expect(props(flushes)).toEqual(["list.read[read] false → true"]);
    flushes.length = 0;

    gate.resolve();
    await done;
    await settle();
    expect(list[0].read).toBe(false);
    expect(props(flushes)).toEqual(["list.read[read] true → false"]);
  });

  it("names the property again when the answer differs from the guess", async () => {
    const flushes = arm({ bodies: true });
    const db = server({ count: 1 });
    const [state, setState] = createOptimisticStore(db.fetch, { count: 0 }, { name: "list" });
    createRoot(() =>
      createRenderEffect(
        () => state.count,
        () => {},
        { name: "paint" }
      )
    );
    await settle();
    expect(state.count).toBe(1);
    flushes.length = 0;

    const open = db.hold();
    const bump = action(function* bump() {
      setState(s => {
        s.count = 2;
      });
      db.set({ count: 3 });
      yield refresh(state);
    });
    const done = bump();
    flush();
    expect(props(flushes)).toEqual(["list.count[count] 1 → 2"]);
    flushes.length = 0;

    open();
    await done;
    await settle();
    expect(state.count).toBe(3);
    // Listed once: the guess lifting and the truth landing are one change on screen.
    expect(props(flushes)).toEqual(["list.count[count] 2 → 3"]);
  });

  it("names the properties of an optimistic store chained to another store", async () => {
    const flushes = arm({ bodies: true });
    const [truth, setTruth] = createStore(["a", "b"], { name: "truth" });
    const [source] = createSignal(truth, { name: "source" });
    const [list, setList] = createOptimisticStore(() => source(), [] as string[], {
      name: "list"
    });
    createRoot(() =>
      createRenderEffect(
        () => list.join(","),
        () => {},
        { name: "paint" }
      )
    );
    flush();
    flushes.length = 0;

    const gate = deferred();
    const add = action(function* addItem(x: string) {
      setList(l => {
        l.push(x);
      });
      yield gate.promise;
      setTruth(t => [...t, x]);
    });
    const done = add("c");
    flush();
    expect(list.join(",")).toBe("a,b,c");
    expect(props(flushes).sort()).toEqual([
      'list.2[2] undefined → "c"',
      "list.length[length] 2 → 3"
    ]);
    flushes.length = 0;

    gate.resolve();
    await done;
    await settle();
    expect(list.join(",")).toBe("a,b,c");
    // The answer equals the guess: nothing shown changed.
    expect(props(flushes)).toEqual([]);

    // A guess the action ends without answering lifts back to the store under it.
    const failed = deferred();
    const drop = action(function* dropFirst() {
      setList(l => {
        l.shift();
      });
      yield failed.promise;
    });
    const dropped = drop();
    flush();
    expect(list.join(",")).toBe("b,c");
    flushes.length = 0;
    failed.resolve();
    await dropped;
    await settle();
    expect(list.join(",")).toBe("a,b,c");
    expect(props(flushes).sort()).toEqual([
      'list.0[0] "b" → "a"',
      'list.1[1] "c" → "b"',
      'list.2[2] undefined → "c"',
      "list.length[length] 2 → 3"
    ]);
  });

  it("lines the live side up with the record, index for index", async () => {
    const flushes = arm({ bodies: true });
    const db = server(["a"]);
    const [list, setList] = createOptimisticStore(db.fetch, [] as string[], { name: "list" });
    createRoot(() =>
      createRenderEffect(
        () => list.join(","),
        () => {},
        { name: "paint" }
      )
    );
    await settle();
    const gate = deferred();
    const add = action(function* add() {
      setList(l => {
        l.push("b");
      });
      yield gate.promise;
    });
    const done = add();
    flush();
    gate.resolve();
    await done;
    await settle();
    expect(props(flushes)).toEqual(
      expect.arrayContaining(['list.1[1] undefined → "b"', 'list.1[1] "b" → undefined'])
    );
    for (const f of flushes) {
      expect(f.live.changes).toHaveLength(f.changes.length);
      f.changes.forEach((c, i) => {
        const node = f.live.changes[i].node as { _name?: string; _key?: PropertyKey };
        expect(node._name ?? "signal").toBe(c.nodeName);
        if (c.key !== undefined) expect(String(node._key)).toBe(c.key);
      });
      // One entry per node.
      expect(new Set(f.live.changes.map(c => c.node)).size).toBe(f.changes.length);
    }
  });
});
