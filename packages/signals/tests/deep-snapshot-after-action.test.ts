import { describe, expect, test } from "vitest";
import {
  action,
  createRenderEffect,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  deep,
  flush,
  snapshot
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

describe("F-1: deep()/snapshot() after an action that writes a store on both sides of a yield", () => {
  test("F-1: a render effect reading s.x and deep(s) sees one frame at the landing", async () => {
    const [s, set] = createStore<{ x: number }>({ x: 1 });
    const log: string[] = [];
    createRoot(() => {
      createRenderEffect(
        () => `${s.x}:${JSON.stringify(deep(s))}`,
        v => void log.push(v)
      );
    });
    flush();

    let release!: () => void;
    const act = action(function* () {
      set(d => {
        d.x = 2;
      });
      yield new Promise<void>(r => (release = r));
      set(d => {
        d.x = 3;
      });
    });
    act();
    await tick();
    flush();
    release();
    for (let i = 0; i < 4; i++) {
      await tick();
      flush();
    }

    expect(snapshot(s)).toEqual({ x: 3 });
    expect(log.at(-1)).toBe('3:{"x":3}');
    for (const entry of log) expect(entry).toBe(`${entry[0]}:{"x":${entry[0]}}`);
  });

  test("F-1: snapshot() inside the render effect sees the landed frame", async () => {
    const [s, set] = createStore<{ x: number }>({ x: 1 });
    const log: string[] = [];
    createRoot(() => {
      createRenderEffect(
        () => `${s.x}:${JSON.stringify(snapshot(s))}`,
        v => void log.push(v)
      );
    });
    flush();
    let release!: () => void;
    action(function* () {
      set(d => {
        d.x = 2;
      });
      yield new Promise<void>(r => (release = r));
      set(d => {
        d.x = 3;
      });
    })();
    await tick();
    flush();
    release();
    for (let i = 0; i < 4; i++) {
      await tick();
      flush();
    }
    expect(log.at(-1)).toBe('3:{"x":3}');
  });

  test("F-1: a derived createStore(fn, seed) serves the user setter's writes to deep()", async () => {
    const [n, setN] = createSignal(1);
    let s: any, set: any;
    createRoot(() => {
      [s, set] = createStore<any>(
        (d: any) => {
          d.n = n();
        },
        { n: 0, mine: [] as number[] }
      );
    });
    const log: string[] = [];
    createRoot(() =>
      createRenderEffect(
        () => JSON.stringify(deep(s)),
        v => void log.push(v)
      )
    );
    flush();
    let release!: () => void;
    action(function* () {
      set((d: any) => void d.mine.push(1));
      yield new Promise<void>(r => (release = r));
      set((d: any) => void d.mine.push(2));
    })();
    await tick();
    flush();
    setN(5);
    flush();
    release();
    for (let i = 0; i < 4; i++) {
      await tick();
      flush();
    }
    expect(snapshot(s)).toEqual({ n: 5, mine: [1, 2] });
    expect(log.at(-1)).toBe(JSON.stringify({ n: 5, mine: [1, 2] }));
  });

  async function runAcrossYield(first: () => void, second: () => void) {
    let release!: () => void;
    action(function* () {
      first();
      yield new Promise<void>(r => (release = r));
      second();
    })();
    await tick();
    flush();
    release();
    for (let i = 0; i < 4; i++) {
      await tick();
      flush();
    }
  }

  test("F-1: a nested object written across the yield is whole in deep()", async () => {
    const [s, set] = createStore({ a: { b: { c: 1 } } });
    const log: string[] = [];
    createRoot(() =>
      createRenderEffect(
        () => `${s.a.b.c}:${JSON.stringify(deep(s))}`,
        v => void log.push(v)
      )
    );
    flush();
    await runAcrossYield(
      () => set(d => void (d.a.b.c = 2)),
      () => set(d => void (d.a.b.c = 3))
    );
    expect(snapshot(s)).toEqual({ a: { b: { c: 3 } } });
    expect(log.at(-1)).toBe('3:{"a":{"b":{"c":3}}}');
  });

  test("F-1: an array pushed on both sides of the yield is whole in deep()", async () => {
    const [s, set] = createStore({ list: [1] });
    const log: string[] = [];
    createRoot(() =>
      createRenderEffect(
        () => `${s.list.length}:${JSON.stringify(deep(s.list))}`,
        v => void log.push(v)
      )
    );
    flush();
    await runAcrossYield(
      () => set(d => void d.list.push(2)),
      () => set(d => void d.list.push(3))
    );
    expect(snapshot(s)).toEqual({ list: [1, 2, 3] });
    expect(log.at(-1)).toBe("3:[1,2,3]");
  });

  test("F-1: a memo reading s.x and snapshot(s) agrees after the action settles", async () => {
    const [s, set] = createStore({ x: 1 });
    const log: string[] = [];
    createRoot(() => {
      const m = createMemo(() => `${s.x}:${JSON.stringify(snapshot(s))}`);
      createRenderEffect(m, v => void log.push(v));
    });
    flush();
    await runAcrossYield(
      () => set(d => void (d.x = 2)),
      () => set(d => void (d.x = 3))
    );
    expect(log.at(-1)).toBe('3:{"x":3}');
  });
});
