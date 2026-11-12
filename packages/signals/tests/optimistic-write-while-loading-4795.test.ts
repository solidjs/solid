/**
 * #4795 (ruled 2026-11-12): an optimistic write to a source that answered
 * before and is loading a new question (an input changed) composes on the
 * previous answer, and the new answer replaces the guess (D-34). Dev warns
 * `OPTIMISTIC_WRITE_WHILE_LOADING` at the guess, once per source. Not before
 * the first answer (S-56), not over a `refresh()` (the same question).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  action,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  OBSERVE,
  refresh
} from "../src/index.js";

const CODE = "OPTIMISTIC_WRITE_WHILE_LOADING";
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  flush();
});
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

function app(kind: "memo" | "store") {
  const asks: Record<string, (v: any) => void> = {};
  const ask = (k: string) => new Promise<any>(r => (asks[k] = r));
  let setSel!: (v: number) => void, guess!: () => void, again!: () => void;
  createRoot(() => {
    const [sel, set] = createSignal(1);
    setSel = set;
    if (kind === "memo") {
      const [v, setV] = createOptimistic(async () => ask(`fetch:${sel()}`));
      createRenderEffect(
        () => v(),
        () => {}
      );
      guess = () => setV((d: any) => [...(d ?? []), "x"]);
      again = () => void refresh(v);
    } else {
      const [s, setS] = createOptimisticStore(async () => ask(`fetch:${sel()}`), [] as string[]);
      createRenderEffect(
        () => s.length,
        () => {}
      );
      guess = () =>
        setS(d => {
          d.push("x");
        });
      again = () => void refresh(s);
    }
  });
  return { asks, setSel: (v: number) => setSel(v), guess: () => guess(), again: () => again() };
}

describe("#4795: a guess while the source loads a new question warns in dev", () => {
  for (const kind of ["memo", "store"] as const) {
    it(`${kind}: after an input change, once per source`, async () => {
      const a = app(kind);
      flush();
      a.asks["fetch:1"](["a"]);
      await tick();
      a.setSel(2);
      flush();
      const capture = OBSERVE!.diagnostics.capture();
      action(function* () {
        a.guess();
        a.guess();
      })();
      flush();
      const events = capture.stop().filter(e => e.code === CODE) as any[];
      expect(events.length).toBe(1);
      expect(events[0].severity).toBe("warn");
      expect(events[0].kind).toBe("write");
      expect(events[0].message).toContain("D-34");
    });
    it(`${kind}: not over a refresh of the same question`, async () => {
      const a = app(kind);
      flush();
      a.asks["fetch:1"](["a"]);
      await tick();
      a.again();
      flush();
      const capture = OBSERVE!.diagnostics.capture();
      action(function* () {
        a.guess();
      })();
      flush();
      expect(capture.stop().filter(e => e.code === CODE).length).toBe(0);
    });
  }
  it("memo: not before the first answer (S-56)", () => {
    const a = app("memo");
    flush();
    const capture = OBSERVE!.diagnostics.capture();
    action(function* () {
      a.guess();
    })();
    flush();
    expect(capture.stop().filter(e => e.code === CODE).length).toBe(0);
  });
});
