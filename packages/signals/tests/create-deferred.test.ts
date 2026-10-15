import { describe, expect, it } from "vitest";
import {
  action,
  createDeferred,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  refresh,
  createStore,
  createLoadingBoundary,
  until,
  getOwner,
  runWithOwner
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

function gated() {
  const gates: Array<() => void> = [];
  const fails: Array<(e: any) => void> = [];
  const wait = <T>(v: T) =>
    new Promise<T>((res, rej) => {
      gates.push(() => res(v));
      fails.push(rej);
    });
  return { gates, fails, wait };
}

describe("createDeferred (D-40)", () => {
  it("panels: the write commits now, each panel lags to its own landing, isPending per panel", async () => {
    const [period, setPeriod] = createSignal(1);
    const fast = gated();
    const slow = gated();
    const log: string[] = [];
    createRoot(() => {
      const a = createDeferred(() => fast.wait(`a${period()}`));
      const b = createDeferred(() => slow.wait(`b${period()}`));
      createRenderEffect(period, v => void log.push(`label ${v}`));
      createRenderEffect(a, v => void log.push(`A ${v}`));
      createRenderEffect(b, v => void log.push(`B ${v}`));
      createRenderEffect(
        () => [isPending(a), isPending(b)].join(),
        v => void log.push(`pending ${v}`)
      );
    });
    flush();
    fast.gates.shift()!();
    slow.gates.shift()!();
    await tick();
    expect(log.sort()).toEqual(["A a1", "B b1", "label 1", "pending false,false"]);
    log.length = 0;

    setPeriod(2);
    flush();
    expect(log.sort()).toEqual(["label 2", "pending true,true"]);
    log.length = 0;

    fast.gates.shift()!();
    await tick();
    expect(log.sort()).toEqual(["A a2", "pending false,true"]);
    log.length = 0;

    slow.gates.shift()!();
    await tick();
    expect(log.sort()).toEqual(["B b2", "pending false,false"]);
  });

  it("control: plain async memos hold the label until the slowest lands", async () => {
    const [period, setPeriod] = createSignal(1);
    const fast = gated();
    const slow = gated();
    const log: string[] = [];
    createRoot(() => {
      const a = createMemo(() => fast.wait(`a${period()}`));
      const b = createMemo(() => slow.wait(`b${period()}`));
      createRenderEffect(period, v => void log.push(`label ${v}`));
      createRenderEffect(a, v => void log.push(`A ${v}`));
      createRenderEffect(b, v => void log.push(`B ${v}`));
    });
    flush();
    fast.gates.shift()!();
    slow.gates.shift()!();
    await tick();
    log.length = 0;
    setPeriod(2);
    flush();
    fast.gates.shift()!();
    await tick();
    expect(log).toEqual([]);
    slow.gates.shift()!();
    await tick();
    expect(log.sort()).toEqual(["A a2", "B b2", "label 2"]);
  });

  it("first load is loading: the reader waits for the first answer (no stale to serve)", async () => {
    const g = gated();
    const log: string[] = [];
    createRoot(() => {
      const d = createDeferred(() => g.wait(1));
      createRenderEffect(d, v => void log.push(`d ${v}`));
      createRenderEffect(
        () => isPending(d),
        v => void log.push(`p ${v}`)
      );
    });
    flush();
    expect(log).toEqual([]);
    g.gates.shift()!();
    await tick();
    expect(log.sort()).toEqual(["d 1", "p false"]);
  });

  it("isPending reaches a sync derivation of a deferred node in flight", async () => {
    const [n, setN] = createSignal(1);
    const g = gated();
    const log: string[] = [];
    createRoot(() => {
      const rows = createDeferred(() => g.wait(Array.from({ length: n() }, (_, i) => i)));
      const count = createMemo(() => rows().length);
      createRenderEffect(
        () => `${count()} ${isPending(count)}`,
        v => void log.push(v)
      );
    });
    flush();
    g.gates.shift()!();
    await tick();
    expect(log).toEqual(["1 false"]);
    setN(3);
    flush();
    expect(log).toEqual(["1 false", "1 true"]);
    g.gates.shift()!();
    await tick();
    expect(log).toEqual(["1 false", "1 true", "3 false"]);
  });

  it("a rejected refetch errors (never masked by the stale value)", async () => {
    const [n, setN] = createSignal(1);
    const g = gated();
    const log: string[] = [];
    createRoot(() => {
      createErrorBoundary(
        () => {
          const d = createDeferred(() => g.wait(n()));
          createRenderEffect(d, v => void log.push(`d ${v}`));
          return null;
        },
        e => {
          log.push(`err ${(e as any)().message}`);
          return null;
        }
      );
    });
    flush();
    g.gates.shift()!();
    await tick();
    setN(2);
    flush();
    g.fails.pop()!(new Error("boom"));
    await tick();
    expect(log).toContain("err boom");
  });

  it("refresh(d) is quiet and resolves with the landed value, not the stale one (D9)", async () => {
    let calls = 0;
    const g = gated();
    let d!: () => number;
    const log: string[] = [];
    createRoot(() => {
      d = createDeferred(() => g.wait(++calls));
      createRenderEffect(
        () => `${d()} ${isPending(d)}`,
        v => void log.push(v)
      );
    });
    flush();
    g.gates.shift()!();
    await tick();
    const p = refresh(d as any);
    let got: unknown = "unresolved";
    p.then(v => (got = v));
    await tick();
    expect(log).toEqual(["1 false"]);
    expect(got).toBe("unresolved");
    g.gates.shift()!();
    await tick();
    expect(got).toBe(2);
    expect(log).toEqual(["1 false", "2 false"]);
  });

  it("a refetch that read a held write lands with that hold, never ahead of it", async () => {
    const [period, setPeriod] = createSignal(1);
    const g = gated();
    const held = gated();
    const log: string[] = [];
    createRoot(() => {
      const d = createDeferred(() => g.wait(`d${period()}`));
      const h = createMemo(() => held.wait(`h${period()}`));
      createRenderEffect(h, v => void log.push(`H ${v}`));
      createRenderEffect(d, v => void log.push(`D ${v}`));
    });
    flush();
    g.gates.shift()!();
    held.gates.shift()!();
    await tick();
    log.length = 0;
    setPeriod(2);
    flush();
    g.gates.shift()!();
    await tick();
    expect(log).toEqual([]);
    held.gates.shift()!();
    await tick();
    expect(log.sort()).toEqual(["D d2", "H h2"]);
  });

  it("an unrelated hold does not keep a deferred landing back", async () => {
    const [period, setPeriod] = createSignal(1);
    const [theme, setTheme] = createSignal("light");
    const g = gated();
    const themed = gated();
    const log: string[] = [];
    createRoot(() => {
      const d = createDeferred(() => g.wait(`d${period()}`));
      const t = createMemo(() => themed.wait(theme()));
      createRenderEffect(t, v => void log.push(`T ${v}`));
      createRenderEffect(d, v => void log.push(`D ${v}`));
    });
    flush();
    g.gates.shift()!();
    themed.gates.shift()!();
    await tick();
    log.length = 0;
    setTheme("dark");
    flush();
    setPeriod(2);
    flush();
    g.gates.shift()!();
    await tick();
    expect(log).toEqual(["D d2"]);
    themed.gates.shift()!();
    await tick();
    expect(log).toEqual(["D d2", "T dark"]);
  });

  it("wrapping form: createDeferred(() => heldMemo()) lags while the memo's other readers hold", async () => {
    const [n, setN] = createSignal(1);
    const g = gated();
    const log: string[] = [];
    createRoot(() => {
      const q = createMemo(() => g.wait(n()));
      const d = createDeferred(() => q());
      createRenderEffect(
        () => `${d()} ${isPending(d)}`,
        v => void log.push(`D ${v}`)
      );
      createRenderEffect(n, v => void log.push(`N ${v}`));
    });
    flush();
    g.gates.shift()!();
    await tick();
    log.length = 0;
    setN(2);
    flush();
    expect(log).toEqual(["N 2", "D 1 true"]);
    g.gates.shift()!();
    await tick();
    expect(log).toEqual(["N 2", "D 1 true", "D 2 false"]);
  });

  it("store composition: createStore(() => ({ items: rows() })) never re-runs mid-refetch; isPending reaches a leaf", async () => {
    const [n, setN] = createSignal(1);
    const g = gated();
    const log: string[] = [];
    createRoot(() => {
      const rows = createDeferred(() => g.wait(Array.from({ length: n() }, (_, i) => i)));
      const [s] = createStore<{ items: number[] }>(() => ({ items: rows() }), { items: [] });
      createRenderEffect(
        () => `${s.items.length} ${isPending(() => s.items.length)}`,
        v => void log.push(v)
      );
    });
    flush();
    g.gates.shift()!();
    await tick();
    log.length = 0;
    setN(3);
    flush();
    expect(log).toEqual(["1 true"]);
    g.gates.shift()!();
    await tick();
    expect(log).toEqual(["1 true", "3 false"]);
  });

  it("under a Loading boundary: fallback on first load only, never on refetch", async () => {
    const [n, setN] = createSignal(1);
    const g = gated();
    const log: string[] = [];
    createRoot(() => {
      const d = createDeferred(() => g.wait(n()));
      const out = createLoadingBoundary(
        () => {
          createRenderEffect(d, v => void log.push(`d ${v}`));
          return "content";
        },
        () => "fallback"
      );
      createRenderEffect(out, v => void log.push(`show ${v}`));
    });
    flush();
    expect(log).toEqual(["show fallback"]);
    g.gates.shift()!();
    await tick();
    expect(log).toContain("d 1");
    expect(log[log.length - 1]).toBe("show content");
    log.length = 0;
    setN(2);
    flush();
    expect(log).toEqual([]);
    g.gates.shift()!();
    await tick();
    expect(log).toEqual(["d 2"]);
  });

  it("until() over a derivation of a deferred node waits for the landing, not the stale value", async () => {
    const [n, setN] = createSignal(1);
    const g = gated();
    let count!: () => number;
    createRoot(() => {
      const d = createDeferred(() => g.wait(n()));
      count = createMemo(() => d() * 10);
      createRenderEffect(count, () => {});
    });
    flush();
    g.gates.shift()!();
    await tick();
    setN(2);
    flush();
    let got: unknown = "unresolved";
    until(() => count() >= 10 && count()).then(v => (got = v));
    await tick();
    expect(got).toBe("unresolved");
    g.gates.shift()!();
    await tick();
    expect(got).toBe(20);
  });

  it("a stream's flight ends at its first yield", async () => {
    const [n, setN] = createSignal(1);
    const g = gated();
    const log: string[] = [];
    createRoot(() => {
      const d = createDeferred(async function* () {
        const v = n();
        yield await g.wait(v);
        yield await g.wait(v * 100);
      });
      createRenderEffect(
        () => `${d()} ${isPending(d)}`,
        v => void log.push(v)
      );
    });
    flush();
    g.gates.shift()!();
    await tick();
    expect(log).toEqual(["1 false"]);
    g.gates.shift()!();
    await tick();
    expect(log).toEqual(["1 false", "100 false"]);
    setN(2);
    flush();
    expect(log).toEqual(["1 false", "100 false", "100 true"]);
    g.gates.shift()!();
    await tick();
    expect(log).toEqual(["1 false", "100 false", "100 true", "2 false"]);
  });

  it("disposing the node mid-flight drops its verdict", async () => {
    const [n, setN] = createSignal(1);
    const g = gated();
    const log: string[] = [];
    let dispose!: () => void;
    let d!: () => number;
    createRoot(() => {
      createRoot(dd => {
        dispose = dd;
        d = createDeferred(() => g.wait(n()));
        createRenderEffect(d, () => {});
      });
    });
    flush();
    g.gates.shift()!();
    await tick();
    setN(2);
    flush();
    expect(isPending(d)).toBe(true);
    dispose();
    flush();
    expect(isPending(d)).toBe(false);
  });

  it("with loadingValue it never suspends: the sentinel first, quiet; then lag", async () => {
    const [n, setN] = createSignal(1);
    const g = gated();
    const log: string[] = [];
    createRoot(() => {
      const d = createDeferred(() => g.wait(n()), { loadingValue: undefined });
      createRenderEffect(
        () => `${d()} ${isPending(d)}`,
        v => void log.push(v)
      );
      createRenderEffect(n, v => void log.push(`N ${v}`));
    });
    flush();
    expect(log.sort()).toEqual(["N 1", "undefined false"]);
    log.length = 0;
    g.gates.shift()!();
    await tick();
    expect(log).toEqual(["1 false"]);
    setN(2);
    flush();
    expect(log.sort()).toEqual(["1 false", "1 true", "N 2"]);
    g.gates.shift()!();
    await tick();
    expect(log[log.length - 1]).toBe("2 false");
  });
});
