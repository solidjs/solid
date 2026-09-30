import { afterEach, describe, expect, it } from "vitest";
import {
  $TARGET,
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createStore,
  deep,
  flush
} from "../../src/index.js";

/**
 * A second optimistic-store setter in the same action sees the row the first
 * setter added — on every draft channel (#3665).
 *
 * Inside an action, an optimistic setter parks its writes as node overrides;
 * until a flush carries them they are UNFLUSHED (A28 (5)) and no reader sees
 * them. The draft is not a reader: it is the writer's own channel, and it
 * composes on the tick's own writes regardless of flush state
 * (`hasActiveOverride`'s rule — the has trap's draft arm, `visibleKeys`,
 * `optimisticView`, `ensurePB`'s seeding all apply it). rc.9's A28 sweep
 * reader-gated one draft arm — the get trap's absent-own-key arm — so a
 * second setter saw `length === 2` and `"1" in d` but `d[1] === undefined`.
 * Next to it, `visibleDescriptor` had no draft arm at all, so `ownKeys`
 * listed the added key while its descriptor reported it absent: every
 * enumerator (Object.keys, spread, entries, JSON.stringify) and `deep()`
 * dropped the row inside the second setter — since before rc.9.
 *
 * Every case runs the same two-setter shape on a plain `createStore` and on a
 * `createOptimisticStore`; the two must agree. The last block pins the reader
 * side: A28 does not move — an effect and an untracked read see the add only
 * at the flush that carries it, and the revert follows.
 */

type Row = { id: string; qty?: number };

/** Two setters in one action body: `write` adds a row, `read` probes the next
 * draft. The action's only yield resolves at once; the caller flushes. */
function twoSetters<T extends object>(
  kind: "plain" | "optimistic",
  init: T,
  write: (d: T) => void,
  read: (d: T) => void,
  yieldBetween = false
): { run: () => Promise<void>; dispose: () => void } {
  const { setRows, dispose } = createRoot(dispose => {
    const [, setRows] = (kind === "plain" ? createStore : createOptimisticStore)(init);
    return { setRows, dispose };
  });
  const run = action(function* () {
    setRows(write as any);
    if (yieldBetween) yield Promise.resolve();
    setRows(read as any);
    yield Promise.resolve();
  });
  return { run, dispose };
}

function nodesOf(proxy: object) {
  const t = (proxy as any)[$TARGET];
  return { h: Object.keys(t.h ?? {}), n: Object.keys(t.n ?? {}) };
}

/** Every channel the reporters' tables probe, on an array draft. */
function probeArray(d: Row[]) {
  return {
    length: d.length,
    get: d[1],
    findIndex: d.findIndex(r => r?.id === "b"),
    has: 1 in d,
    ownKeys: Reflect.ownKeys(d).filter(k => typeof k === "string" && k !== "length"),
    descriptor: Object.getOwnPropertyDescriptor(d, "1"),
    keys: Object.keys(d),
    spread: { ...d },
    entries: Object.entries(d),
    json: JSON.stringify(d),
    deep: deep(d)
  };
}

/** Every channel the reporters' tables probe, on an object draft. */
function probeObject(d: Record<string, Row>) {
  return {
    get: d.b,
    has: "b" in d,
    ownKeys: Reflect.ownKeys(d),
    descriptor: Object.getOwnPropertyDescriptor(d, "b"),
    enumerable: Object.prototype.propertyIsEnumerable.call(d, "b"),
    keys: Object.keys(d),
    spread: { ...d },
    entries: Object.entries(d),
    json: JSON.stringify(d),
    deep: deep(d)
  };
}

afterEach(() => flush());

describe("#3665 — a second setter in the same action sees the first setter's add", () => {
  describe("array: push, then every channel in the next draft", () => {
    const init = (): Row[] => [{ id: "a" }];
    const push = (d: Row[]) => {
      d.push({ id: "b" });
    };

    it("optimistic draft agrees with the plain draft on every channel", async () => {
      let plain: ReturnType<typeof probeArray> | undefined;
      let opt: ReturnType<typeof probeArray> | undefined;
      const p = twoSetters("plain", init(), push, d => (plain = probeArray(d)));
      const o = twoSetters("optimistic", init(), push, d => (opt = probeArray(d)));
      const runs = Promise.all([p.run(), o.run()]);
      flush();
      await runs;
      flush();

      // The plain draft is the oracle.
      expect(plain!.get).toEqual({ id: "b" });
      expect(plain!.findIndex).toBe(1);
      expect(plain!.keys).toEqual(["0", "1"]);
      expect(plain!.json).toBe('[{"id":"a"},{"id":"b"}]');

      // (a) value channels — the get trap's draft arm (rc.9 regression)
      expect(opt!.length).toBe(2);
      expect(opt!.has).toBe(true);
      expect(opt!.get).toEqual({ id: "b" });
      expect(opt!.findIndex).toBe(1);
      // (b) descriptor channels — visibleDescriptor's draft arm
      expect(opt!.ownKeys).toEqual(["0", "1"]);
      expect(opt!.descriptor).toMatchObject({ value: { id: "b" }, enumerable: true });
      expect(opt!.keys).toEqual(["0", "1"]);
      expect(opt!.spread).toEqual({ "0": { id: "a" }, "1": { id: "b" } });
      expect(opt!.entries).toEqual([
        ["0", { id: "a" }],
        ["1", { id: "b" }]
      ]);
      expect(opt!.json).toBe('[{"id":"a"},{"id":"b"}]');
      expect(opt!.deep).toEqual([{ id: "a" }, { id: "b" }]);
      p.dispose();
      o.dispose();
    });

    it("index set d[1] = … is an add too", async () => {
      let opt: ReturnType<typeof probeArray> | undefined;
      const o = twoSetters(
        "optimistic",
        init(),
        d => {
          d[1] = { id: "b" };
        },
        d => (opt = probeArray(d))
      );
      const run = o.run();
      flush();
      await run;
      flush();
      expect(opt!.has).toBe(true);
      expect(opt!.get).toEqual({ id: "b" });
      expect(opt!.keys).toEqual(["0", "1"]);
      o.dispose();
    });

    it("the add-then-select shape from the report: findIndex then a nested write", async () => {
      const [rows, setRows, dispose] = createRoot(dispose => {
        const [rows, setRows] = createOptimisticStore<Array<Row & { selected?: boolean }>>([
          { id: "a" }
        ]);
        return [rows, setRows, dispose] as const;
      });
      const add = action(function* (node: Row) {
        setRows(d => {
          d.push(node);
        });
        setRows(d => {
          d[d.findIndex(r => r?.id === node.id)].selected = true;
        });
        yield Promise.resolve();
      });
      const run = add({ id: "b" });
      flush();
      expect(rows.length).toBe(2);
      expect(rows[1]).toEqual({ id: "b", selected: true });
      await run;
      flush();
      expect(rows.length).toBe(1); // the optimistic add reverted
      dispose();
    });
  });

  describe("object: key add, then every channel in the next draft", () => {
    const init = (): Record<string, Row> => ({ a: { id: "a" } });
    const addB = (d: Record<string, Row>) => {
      d.b = { id: "b" };
    };

    it("optimistic draft agrees with the plain draft on every channel", async () => {
      let plain: ReturnType<typeof probeObject> | undefined;
      let opt: ReturnType<typeof probeObject> | undefined;
      const p = twoSetters("plain", init(), addB, d => (plain = probeObject(d)));
      const o = twoSetters("optimistic", init(), addB, d => (opt = probeObject(d)));
      const runs = Promise.all([p.run(), o.run()]);
      flush();
      await runs;
      flush();

      expect(plain!.get).toEqual({ id: "b" });
      expect(plain!.keys).toEqual(["a", "b"]);

      // (a)
      expect(opt!.has).toBe(true);
      expect(opt!.get).toEqual({ id: "b" });
      // (b)
      expect(opt!.ownKeys).toEqual(["a", "b"]);
      expect(opt!.descriptor).toEqual({
        value: { id: "b" },
        writable: true,
        enumerable: true,
        configurable: true
      });
      expect(opt!.enumerable).toBe(true);
      expect(opt!.keys).toEqual(["a", "b"]);
      expect(opt!.spread).toEqual({ a: { id: "a" }, b: { id: "b" } });
      expect(opt!.entries).toEqual([
        ["a", { id: "a" }],
        ["b", { id: "b" }]
      ]);
      expect(opt!.json).toBe('{"a":{"id":"a"},"b":{"id":"b"}}');
      expect(opt!.deep).toEqual({ a: { id: "a" }, b: { id: "b" } });
      p.dispose();
      o.dispose();
    });

    it("an enumerator inside the second setter births no presence nodes (#3664 composes)", async () => {
      // #3668 skips the descriptor trap's presence read for enumerators whose
      // observer holds the key-set node; inside a draft there is no observer
      // and no presence read at all. The draft arm must not introduce one:
      // the only nodes on the target are the ones the FIRST setter's write
      // armed.
      const [rows, setRows, dispose] = createRoot(dispose => {
        const [rows, setRows] = createOptimisticStore<Record<string, Row>>({ a: { id: "a" } });
        return [rows, setRows, dispose] as const;
      });
      let afterWrite: ReturnType<typeof nodesOf> | undefined;
      let afterEnumerate: ReturnType<typeof nodesOf> | undefined;
      let keys: string[] | undefined;
      const run = action(function* () {
        setRows(addB);
        afterWrite = nodesOf(rows);
        setRows(d => {
          keys = Object.keys({ ...d, ...Object.fromEntries(Object.entries(d)) });
          JSON.stringify(d);
          for (const _ in d) void _;
        });
        afterEnumerate = nodesOf(rows);
        yield Promise.resolve();
      })();
      flush();
      await run;
      flush();
      expect(keys).toEqual(["a", "b"]);
      expect(afterWrite!.h).toEqual(["b"]); // the add's own presence override
      expect(afterEnumerate).toEqual(afterWrite);
      dispose();
    });
  });

  describe("controls", () => {
    it("a write to an EXISTING key was always visible (serveDataKey's draft arm)", async () => {
      let qty: number | undefined;
      const o = twoSetters(
        "optimistic",
        [{ id: "a", qty: 1 }] as Row[],
        d => {
          d[0].qty = 2;
        },
        d => (qty = d[0].qty)
      );
      const run = o.run();
      flush();
      await run;
      flush();
      expect(qty).toBe(2);
      o.dispose();
    });

    it("after a yield (a flush carried the override) the reader rule serves it too", async () => {
      let opt: ReturnType<typeof probeArray> | undefined;
      const o = twoSetters(
        "optimistic",
        [{ id: "a" }] as Row[],
        d => {
          d.push({ id: "b" });
        },
        d => (opt = probeArray(d)),
        true
      );
      const run = o.run();
      flush();
      await run;
      flush();
      expect(opt!.get).toEqual({ id: "b" });
      expect(opt!.keys).toEqual(["0", "1"]);
      expect(opt!.json).toBe('[{"id":"a"},{"id":"b"}]');
      o.dispose();
    });
  });

  describe("the READER side does not move (A28: a write becomes visible at flush)", () => {
    it("an effect and an untracked read see the add at the flush, not before; the revert follows", async () => {
      const [rows, setRows, dispose] = createRoot(dispose => {
        const [rows, setRows] = createOptimisticStore<Record<string, Row>>({ a: { id: "a" } });
        return [rows, setRows, dispose] as const;
      });
      const seen: string[] = [];
      createRoot(() => {
        createRenderEffect(
          () => `${Object.keys(rows).join(",")}|${rows.b?.id ?? "-"}|${"b" in rows}`,
          v => {
            seen.push(v);
          }
        );
      });
      flush();
      expect(seen).toEqual(["a|-|false"]);

      let draftSaw: { b: Row | undefined; keys: string[] } | undefined;
      const run = action(function* () {
        setRows(d => {
          d.b = { id: "b" };
        });
        // Untracked reads right after the setter, still synchronous: the
        // override is unflushed, so no channel shows it (A28 (5)).
        expect(rows.b).toBeUndefined();
        expect("b" in rows).toBe(false);
        expect(Object.keys(rows)).toEqual(["a"]);
        expect(Object.getOwnPropertyDescriptor(rows, "b")).toBeUndefined();
        expect(seen).toEqual(["a|-|false"]);
        // The next draft — the writer's channel — sees it at once.
        setRows(d => {
          draftSaw = { b: d.b, keys: Object.keys(d) };
        });
        expect(rows.b).toBeUndefined();
        yield Promise.resolve();
      })();
      expect(draftSaw).toEqual({ b: { id: "b" }, keys: ["a", "b"] });

      flush();
      // The carrying flush: readers see the optimistic add.
      expect(seen).toEqual(["a|-|false", "a,b|b|true"]);
      expect(rows.b).toEqual({ id: "b" });
      expect(Object.keys(rows)).toEqual(["a", "b"]);

      await run;
      flush();
      // The action settled with no truth landing: the add reverts.
      expect(seen).toEqual(["a|-|false", "a,b|b|true", "a|-|false"]);
      expect(rows.b).toBeUndefined();
      expect(Object.keys(rows)).toEqual(["a"]);
      dispose();
    });
  });
});
