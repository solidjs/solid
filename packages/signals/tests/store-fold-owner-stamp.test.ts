import { describe, expect, test } from "vitest";
import {
  createStore,
  createRoot,
  createRenderEffect,
  flush,
  reconcile,
  snapshot
} from "../src/index.js";

function track<T>(fn: () => T) {
  const log: T[] = [];
  createRoot(() => {
    createRenderEffect(fn, v => {
      log.push(v);
    });
  });
  flush();
  return log;
}

describe("a fold keeps the ownership stamp of a privatized backing", () => {
  test("a write after a nested write and a parent reconcile in one batch reaches reads and subscribers", () => {
    const [s, set] = createStore<any>({ b: { n: 1, list: [{ id: 1 }, { id: 2 }] } });
    set(d => {
      d.b.n = 2;
    });
    flush();
    track(() => Object.keys(s.b.list).join());
    set(d => {
      d.b.list[1].x = 1;
    });
    set(d => {
      reconcile({ n: 3, list: { k: 0 } }, null)(d.b);
    });
    flush();
    expect(s.b.n).toBe(3);

    const n = track(() => s.b.n);
    set(d => {
      d.b.n = 4;
    });
    flush();
    expect(snapshot(s).b.n).toBe(4);
    expect(s.b.n).toBe(4);
    expect(n).toEqual([3, 4]);
  });
});
