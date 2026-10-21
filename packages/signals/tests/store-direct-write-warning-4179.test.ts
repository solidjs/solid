/**
 * #4179 — writing to a store proxy outside its setter is ignored (the trap
 * returns `true`, nothing changes). Dev now says so: a
 * `STORE_WRITE_OUTSIDE_SETTER` warning, once per target+key, with a
 * `setStore(s => …)` hint. The write itself stays ignored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, flush, OBSERVE } from "../src/index.js";

const CODE = "STORE_WRITE_OUTSIDE_SETTER";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  flush();
});

function outsideWrites(events: readonly { code: string }[]) {
  return events.filter(e => e.code === CODE) as any[];
}

describe("#4179: store writes outside the setter warn in dev", () => {
  it("a direct set is ignored and reported once per target+key", () => {
    const [store] = createStore({ n: 0, m: 0 });
    const capture = OBSERVE!.diagnostics.capture();
    (store as any).n = 5;
    (store as any).n = 6;
    (store as any).m = 1;
    const events = outsideWrites(capture.stop());
    flush();
    expect(store.n).toBe(0);
    expect(store.m).toBe(0);
    expect(events.length).toBe(2);
    expect(events[0].severity).toBe("warn");
    expect(events[0].kind).toBe("write");
    expect(events[0].data).toEqual({ operation: "set", property: "n" });
    expect(events[0].message).toContain("setStore(s => { s.n = value })");
    expect(events[1].data.property).toBe("m");
    const printed = warn.mock.calls.map(c => String(c[0]));
    expect(printed.filter(t => t.includes(`[${CODE}]`)).length).toBe(2);
  });

  it("nested writes, array pushes and deletes are reported", () => {
    const [store] = createStore({ items: [] as number[], user: { name: "a" } });
    const capture = OBSERVE!.diagnostics.capture();
    (store.user as any).name = "b";
    (store.items as any).push(1);
    delete (store as any).user;
    const events = outsideWrites(capture.stop());
    flush();
    expect(store.user.name).toBe("a");
    expect(store.items.length).toBe(0);
    const ops = events.map(e => `${e.data.operation}:${e.data.property}`);
    expect(ops).toContain("set:name");
    expect(ops).toContain("set:0");
    expect(ops).toContain("deleteProperty:user");
    const del = events.find(e => e.data.operation === "deleteProperty");
    expect(del.message).toContain("setStore(s => { delete s.user })");
    expect(events.find(e => e.data.property === "0").message).toContain("s[0] = value");
  });

  it("defineProperty outside the setter is reported", () => {
    const [store] = createStore({ n: 0 } as Record<string, number>);
    const capture = OBSERVE!.diagnostics.capture();
    Object.defineProperty(store, "x", {
      value: 1,
      writable: true,
      enumerable: true,
      configurable: true
    });
    const events = outsideWrites(capture.stop());
    expect((store as any).x).toBeUndefined();
    expect(events.map(e => e.data.operation)).toEqual(["defineProperty"]);
  });

  it("writes through the setter do not warn", () => {
    const [store, setStore] = createStore({ n: 0, items: [] as number[] });
    const capture = OBSERVE!.diagnostics.capture();
    setStore(s => {
      s.n = 5;
      s.items.push(1);
    });
    flush();
    expect(store.n).toBe(5);
    expect(outsideWrites(capture.stop()).length).toBe(0);
  });
});
