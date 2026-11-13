import { describe, expect, it } from "vitest";
import {
  action,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

// #4788 (D-33): a guess written by an action that read another hold's live
// guess derives from that guess, so the two holds entangle: neither reverts
// while the other is out. A guess that read nothing of the other stays its
// own (disjoint slots settle independently).
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
type Mode = "setter" | "body" | "none";
function storeApp(mode: Mode) {
  const ends: Record<string, () => void> = {};
  const wait = (k: string) => new Promise<void>(r => (ends[k] = r));
  const seen: string[] = [];
  let saveA!: () => any, saveB!: () => any;
  createRoot(() => {
    const [s, set] = createOptimisticStore({ a: 0, b: 0 });
    createRenderEffect(
      () => `a=${s.a} b=${s.b}`,
      v => void seen.push(v)
    );
    saveA = action(function* () {
      set(d => {
        d.a = 1;
      });
      yield wait("A");
    });
    saveB = action(function* () {
      if (mode === "setter")
        set(d => {
          d.b = d.a + 1;
        });
      else {
        const a = mode === "body" ? s.a : 1;
        set(d => {
          d.b = a + 1;
        });
      }
      yield wait("B");
    });
  });
  return { seen, ends, saveA: () => saveA(), saveB: () => saveB() };
}
function signalApp(mode: Mode) {
  const ends: Record<string, () => void> = {};
  const wait = (k: string) => new Promise<void>(r => (ends[k] = r));
  const seen: string[] = [];
  let saveA!: () => any, saveB!: () => any;
  createRoot(() => {
    const [a, setA] = createOptimistic(0);
    const [b, setB] = createOptimistic(0);
    createRenderEffect(
      () => `a=${a()} b=${b()}`,
      v => void seen.push(v)
    );
    saveA = action(function* () {
      setA(1);
      yield wait("A");
    });
    saveB = action(function* () {
      if (mode === "setter") setB(() => a() + 1);
      else {
        const v = mode === "body" ? a() : 1;
        setB(v + 1);
      }
      yield wait("B");
    });
  });
  return { seen, ends, saveA: () => saveA(), saveB: () => saveB() };
}

describe("a guess derived from another action's live guess (#4788)", () => {
  for (const [name, make] of [
    ["store", storeApp],
    ["signal", signalApp]
  ] as const)
    for (const mode of ["setter", "body", "none"] as Mode[])
      it(`${name}, read in the ${mode === "none" ? "(no read)" : mode}`, async () => {
        const app = make(mode);
        flush();
        app.saveA();
        await tick();
        app.saveB();
        await tick();
        app.ends.A();
        await tick();
        const afterA = app.seen[app.seen.length - 1];
        app.ends.B();
        await tick();
        expect(afterA).toBe(mode === "none" ? "a=0 b=2" : "a=1 b=2");
        expect(app.seen[app.seen.length - 1]).toBe("a=0 b=0");
      });
});
