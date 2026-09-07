/**
 * IMMUTABLE_UPDATE_IN_STORE: a store setter that replaces a container with a
 * fresh one whose leaves are mostly the same values (the spread-copy habit)
 * is reported once per path; genuinely new data, draft mutation, and
 * reconcile() are not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore, DEV, flush, reconcile } from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
  DEV!.attribution.disable();
  flush();
  vi.restoreAllMocks();
});

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  DEV!.attribution.enable({ log: false });
  const hits: DiagnosticEvent[] = [];
  DEV!.diagnostics.subscribe(e => {
    if (e.code === "IMMUTABLE_UPDATE_IN_STORE") hits.push(e);
  });
  return hits;
}

interface State {
  user: { id: number; name: string; email: string; role: string };
  items: { id: number }[];
}
const initial = (): State => ({
  user: { id: 1, name: "a", email: "a@x", role: "admin" },
  items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
});

describe("IMMUTABLE_UPDATE_IN_STORE", () => {
  it("reports a spread-copy object replacement once per path", () => {
    const hits = arm();
    const [state, setState] = createStore<State>(initial());
    setState(s => {
      s.user = { ...s.user, name: "b" };
    });
    flush();
    expect(state.user.name).toBe("b");
    expect(hits).toHaveLength(1);
    const [entry] = hits;
    expect(entry.severity).toBe("warn");
    expect(entry.kind).toBe("perf");
    expect(entry.message).toContain(
      '"store.user" was replaced with a fresh object whose leaves are mostly the same values ' +
        "(3 of 4 unchanged, 1 changed)"
    );
    expect(entry.message).toContain("`store.user.<key> = …`");
    expect(entry.message).toContain("reconcile(data, key)(store.user)");
    expect(entry.data).toEqual({
      path: "store.user",
      shape: "object",
      total: 4,
      unchanged: 3,
      changed: 1
    });
    setState(s => {
      s.user = { ...s.user, name: "c" };
    });
    flush();
    expect(hits).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("reports array push / filter copies", () => {
    const hits = arm();
    const [, setState] = createStore<State>(initial());
    setState(s => {
      s.items = [...s.items, { id: 5 }];
    });
    flush();
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('"store.items" was replaced with a fresh array');
    expect(hits[0].message).toContain("4 of 5 unchanged");
    expect(hits[0].message).toContain("push/splice/index assignment");
    expect(hits[0].data).toEqual({
      path: "store.items",
      shape: "array",
      total: 5,
      unchanged: 4,
      changed: 1
    });
  });

  it("does not report draft mutation", () => {
    const hits = arm();
    const [state, setState] = createStore<State>(initial());
    setState(s => {
      s.user.name = "b";
      s.items.push({ id: 5 });
      s.items.splice(0, 1);
    });
    flush();
    expect(state.user.name).toBe("b");
    expect(state.items.length).toBe(4);
    expect(hits).toEqual([]);
  });

  it("does not report genuinely new data (nothing carried over)", () => {
    const hits = arm();
    const [, setState] = createStore<State>(initial());
    setState(s => {
      s.user = { id: 2, name: "z", email: "z@x", role: "user" };
      s.items = [{ id: 7 }, { id: 8 }, { id: 9 }, { id: 10 }];
    });
    flush();
    expect(hits).toEqual([]);
  });

  it("does not report reconcile()", () => {
    const hits = arm();
    const [state, setState] = createStore<State>(initial());
    setState(s => {
      reconcile({ ...s.user, name: "b" }, "id")(s.user);
    });
    flush();
    expect(state.user.name).toBe("b");
    expect(hits).toEqual([]);
  });

  it("names nested paths", () => {
    const hits = arm();
    const [, setState] = createStore({ a: { b: { x: 1, y: 2, z: 3 } } });
    setState(s => {
      s.a.b = { ...s.a.b, x: 9 };
    });
    flush();
    expect(hits).toHaveLength(1);
    expect(hits[0].data!.path).toBe("store.a.b");
  });
});
