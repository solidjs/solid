(globalThis as any).THIN_STORE = true;
import {
  createEffect,
  createRoot,
  createStore,
  flush,
  reconcile,
  snapshot,
  createMemo
} from "../../src/index.js";
import { expect, it } from "vitest";
it("thin smoke", () => {
  const [s, set] = createStore({
    a: 1,
    list: [
      { id: 1, t: "x" },
      { id: 2, t: "y" }
    ],
    n: { d: 1 }
  } as any);
  const log: any[] = [];
  createRoot(() => {
    createEffect(
      () => s.a,
      v => {
        log.push(["a", v]);
      }
    );
    createEffect(
      () => s.list.map((r: any) => r.t).join(),
      v => {
        log.push(["l", v]);
      }
    );
    createEffect(
      () => Object.keys(s).join(),
      v => {
        log.push(["k", v]);
      }
    );
    createEffect(
      () => "z" in s,
      v => {
        log.push(["in", v]);
      }
    );
  });
  flush();
  expect(log).toEqual([
    ["a", 1],
    ["l", "x,y"],
    ["k", "a,list,n"],
    ["in", false]
  ]);
  log.length = 0;
  const row = s.list[0];
  set((d: any) => {
    d.a = 2;
    d.list.push({ id: 3, t: "w" });
    d.z = 1;
    expect(d.a).toBe(2);
  });
  expect(s.a).toBe(1);
  flush();
  expect(log).toEqual([
    ["a", 2],
    ["l", "x,y,w"],
    ["in", true],
    ["k", "a,list,n,z"]
  ]);
  log.length = 0;
  set((d: any) => {
    d.list[0].t = "q";
    delete d.z;
  });
  flush();
  expect(row.t).toBe("q");
  expect(log).toEqual([
    ["l", "q,y,w"],
    ["in", false],
    ["k", "a,list,n"]
  ]);
  log.length = 0;
  set(
    reconcile({
      a: 2,
      list: [
        { id: 2, t: "y" },
        { id: 1, t: "q2" }
      ],
      n: { d: 1 }
    }) as any
  );
  flush();
  expect(s.list[1]).toBe(row);
  expect(row.t).toBe("q2");
  expect(log).toEqual([["l", "y,q2"]]);
  expect(snapshot(s)).toEqual({
    a: 2,
    list: [
      { id: 2, t: "y" },
      { id: 1, t: "q2" }
    ],
    n: { d: 1 }
  });
  expect(snapshot(s).n).toBe((snapshot(s) as any).n);
});
