/**
 * #5255, S-44's probe frame: `comments` is an optimistic async memo over `sel`; a
 * post guesses `comments = 9` and waits; `sel` changes from outside. The
 * change is a new question held with the post (D-34), so a tracked
 * `isPending(comments)` reads true from that flush until the post's refresh
 * lands (F-9), while the screen keeps `3 9` throughout. A `refresh()` re-asks
 * the same question and stays quiet (F-9). The store form already read true
 * (#4337) and is the control.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  refresh
} from "../src/index.js";

const flights = new Map<string, { res: (v: any) => void; rej: (e: any) => void }>();
const ask = (key: string) => new Promise<any>((res, rej) => flights.set(key, { res, rej }));
const settle = (key: string, ok: boolean, v: unknown) => {
  const f = flights.get(key)!;
  flights.delete(key);
  ok ? f.res(v) : f.rej(v);
};
const answer = (key: string, v: unknown) => settle(key, true, v);
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
let roots: (() => void)[] = [];
afterEach(async () => {
  roots.forEach(d => d());
  roots = [];
  for (const f of flights.values()) f.res(0);
  flights.clear();
  await tick();
});

function setup(form: "signal" | "store") {
  const frames: string[] = [];
  let a = "";
  let b = "";
  let p = "";
  let setSel!: (v: number) => void;
  let post!: () => void;
  let reask!: () => void;
  createRoot(dispose => {
    roots.push(dispose);
    const [sel, ss] = createSignal(3);
    setSel = ss;
    let read: () => number;
    let guess: () => void;
    let node: any;
    if (form === "signal") {
      const [c, set] = createOptimistic(() => ask("c:" + sel()));
      node = read = c;
      guess = () => set(9);
    } else {
      const [c, set] = createOptimisticStore(async () => ({ n: await ask("c:" + sel()) }), {
        n: 0
      });
      node = c;
      read = () => c.n;
      guess = () => set(d => void (d.n = 9));
    }
    post = action(function* () {
      guess();
      try {
        yield ask("post");
      } catch {
        return;
      }
      refresh(node);
    });
    reask = () => refresh(node);
    // One frame per flush: the three bindings as the flush that applied them left them.
    let queued = false;
    const frame = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        frames.push(`${a} ${b} ${p}`);
      });
    };
    createRenderEffect(
      () => `${sel()} ${read()}`,
      v => void ((a = v), frame())
    );
    createRenderEffect(
      () => String(latest(read)),
      v => void ((b = v), frame())
    );
    createRenderEffect(
      () => String(isPending(read)),
      v => void ((p = v), frame())
    );
  });
  return { frames, setSel, post, reask, screen: () => `${a} ${b} ${p}` };
}

async function guessed(form: "signal" | "store") {
  const h = setup(form);
  await tick();
  answer("c:3", 4);
  await tick();
  expect(h.screen()).toBe("3 4 4 false");
  h.post();
  flush();
  await tick();
  expect(h.screen()).toBe("3 9 9 false");
  return h;
}

for (const form of ["signal", "store"] as const)
  describe(`S-44: isPending of a guessed node over an outside input change (${form})`, () => {
    it("reads true from the outside change until the post's refresh lands; the screen stays held", async () => {
      const h = await guessed(form);
      const seen = h.frames.length;

      h.setSel(1);
      flush();
      await tick();
      expect([...flights.keys()].sort()).toEqual(["c:1", "post"]);
      expect(h.screen()).toBe("3 9 9 true");

      answer("c:1", 2);
      await tick();
      expect(h.screen()).toBe("3 9 9 true");

      answer("post", 0);
      await tick();
      expect([...flights.keys()]).toEqual(["c:1"]);
      expect(h.screen()).toBe("3 9 9 true");

      answer("c:1", 2);
      await tick();
      expect(h.screen()).toBe("1 2 2 false");
      // Held exactly: the guess stays until the landing, which is one frame.
      expect(h.frames.slice(seen).filter((f, i, all) => f !== all[i - 1])).toEqual([
        "3 9 9 true",
        "1 2 2 false"
      ]);
    });

    it("reads true while the change's request is out when the post rejects", async () => {
      const h = await guessed(form);

      h.setSel(1);
      flush();
      await tick();
      expect(h.screen()).toBe("3 9 9 true");

      settle("post", false, new Error("post failed"));
      await tick();
      // The guess's hold now waits on the change's request alone.
      expect([...flights.keys()]).toEqual(["c:1"]);
      expect(h.screen()).toBe("3 9 9 true");

      answer("c:1", 2);
      await tick();
      expect(flights.size).toBe(0);
      expect(h.screen()).toBe("1 2 2 false");
    });

    it("control: with no guess, the change reads true while its request is out", async () => {
      const h = setup(form);
      await tick();
      answer("c:3", 4);
      await tick();
      h.setSel(1);
      flush();
      await tick();
      expect(h.screen()).toBe("3 4 4 true");
      answer("c:1", 2);
      await tick();
      expect(h.screen()).toBe("1 2 2 false");
    });

    it("control: a refresh() re-ask under the guess stays quiet (F-9)", async () => {
      const h = await guessed(form);
      h.reask();
      flush();
      await tick();
      expect(flights.has("c:3")).toBe(true);
      expect(h.screen()).toBe("3 9 9 false");
      answer("c:3", 4);
      await tick();
      expect(h.screen()).toBe("3 9 9 false");
    });

    it("control: a refresh() re-ask with no guess stays quiet (F-9)", async () => {
      const h = setup(form);
      await tick();
      answer("c:3", 4);
      await tick();
      h.reask();
      flush();
      await tick();
      expect(flights.has("c:3")).toBe(true);
      expect(h.screen()).toBe("3 4 4 false");
      answer("c:3", 5);
      await tick();
      expect(h.screen()).toBe("3 5 5 false");
    });
  });

describe("#5255: a guess over an async memo", () => {
  function chain() {
    let p = "";
    let setSel!: (v: number) => void;
    let post!: (reask: boolean) => void;
    createRoot(dispose => {
      roots.push(dispose);
      const [sel, ss] = createSignal(3);
      setSel = ss;
      const source = createMemo(() => ask("s:" + sel()));
      const [c, set] = createOptimistic(() => source());
      post = action(function* (reask: boolean) {
        set(9);
        yield ask("post");
        if (reask) refresh(source);
      });
      createRenderEffect(
        () => String(isPending(c)),
        v => void (p = v)
      );
    });
    return { setSel, post, pending: () => p };
  }

  it("an input change upstream reads true until it lands", async () => {
    const h = chain();
    await tick();
    answer("s:3", 4);
    await tick();
    h.post(false);
    flush();
    await tick();
    expect(h.pending()).toBe("false");
    h.setSel(1);
    flush();
    await tick();
    expect(h.pending()).toBe("true");
    answer("post", 0);
    await tick();
    answer("s:1", 2);
    await tick();
    expect(h.pending()).toBe("false");
  });

  it("control: a refresh() of the upstream memo stays quiet (F-9)", async () => {
    const h = chain();
    await tick();
    answer("s:3", 4);
    await tick();
    h.post(true);
    flush();
    await tick();
    answer("post", 0);
    await tick();
    expect(flights.has("s:3")).toBe(true);
    expect(h.pending()).toBe("false");
    answer("s:3", 4);
    await tick();
    expect(h.pending()).toBe("false");
  });
});

describe("#5255: a latest() reader under the guess (F-6)", () => {
  it("an async memo over latest() starts no request when the input changes", async () => {
    const calls: number[] = [];
    let setSel!: (v: number) => void;
    let post!: () => void;
    createRoot(dispose => {
      roots.push(dispose);
      const [sel, ss] = createSignal(3);
      setSel = ss;
      const [c, set] = createOptimistic(() => ask("c:" + sel()));
      post = action(function* () {
        set(9);
        yield ask("post");
      });
      const detail = createMemo(() => {
        const n = latest(c);
        calls.push(n);
        return ask("d:" + n);
      });
      createRenderEffect(detail, () => {});
    });
    await tick();
    answer("c:3", 4);
    await tick();
    answer("d:4", 40);
    await tick();
    post();
    flush();
    await tick();
    answer("d:9", 90);
    await tick();
    expect(calls.at(-1)).toBe(9);
    calls.length = 0;

    setSel(1);
    flush();
    await tick();
    // Only the input's request: the memo's input is still the guess, 9.
    expect([...flights.keys()].sort()).toEqual(["c:1", "post"]);
    expect(calls).toEqual([]);
  });
});

describe("#5255: only the guess's own probes wake", () => {
  // A post guesses `c` and `c2` and writes `page`; then `sel` changes. Only
  // a reader that probes `isPending(c)` re-runs: a reader of `latest(c)` that
  // also reads something else the post holds keeps its request (F-6).
  type Held = { c: () => number; c2: () => number; page: () => number; xm: () => number };
  function held(reader: (h: Held) => void) {
    let p = "";
    let setSel!: (v: number) => void;
    let post!: () => void;
    createRoot(dispose => {
      roots.push(dispose);
      const [sel, ss] = createSignal(3);
      setSel = ss;
      const [page, setPage] = createSignal(0);
      const [c, set] = createOptimistic(() => ask("c:" + sel()));
      const [c2, set2] = createOptimistic(0);
      post = action(function* () {
        set(9);
        set2(1);
        setPage(1);
        yield ask("post");
        refresh(c);
      });
      createRenderEffect(
        () => String(isPending(c)),
        v => void (p = v)
      );
      reader({ c, c2, page, xm: createMemo(() => page() + 1) });
    });
    return { setSel, post, pending: () => p };
  }
  /** Prime, post, answer the reader's requests, then change `sel`. */
  async function change(h: ReturnType<typeof held>, runs: unknown[]) {
    await tick();
    answer("c:3", 4);
    await tick();
    for (const k of [...flights.keys()]) if (k.startsWith("d:")) answer(k, 40);
    await tick();
    h.post();
    flush();
    await tick();
    for (const k of [...flights.keys()]) if (k.startsWith("d:")) answer(k, 90);
    await tick();
    expect(h.pending()).toBe("false");
    runs.length = 0;
    h.setSel(1);
    flush();
    await tick();
  }
  const asyncReader = (runs: unknown[], also: (h: Held) => unknown) => (h: Held) => {
    const d = createMemo(() => {
      const k = `${latest(h.c)}:${also(h)}`;
      runs.push(k);
      return ask("d:" + k);
    });
    createRenderEffect(d, () => {});
  };

  it("an async memo over latest() that also reads a signal the post wrote", async () => {
    const runs: unknown[] = [];
    const h = held(asyncReader(runs, h => h.page()));
    await change(h, runs);
    expect([...flights.keys()].sort()).toEqual(["c:1", "post"]);
    expect(runs).toEqual([]);
    expect(h.pending()).toBe("true");
  });

  it("an async memo over latest() that also probes another guess of the post", async () => {
    const runs: unknown[] = [];
    const h = held(asyncReader(runs, h => isPending(h.c2)));
    await change(h, runs);
    expect([...flights.keys()].sort()).toEqual(["c:1", "post"]);
    expect(runs).toEqual([]);
    expect(h.pending()).toBe("true");
  });

  it("an async memo over latest() that also probes a memo the post holds", async () => {
    const runs: unknown[] = [];
    const h = held(asyncReader(runs, h => isPending(h.xm)));
    await change(h, runs);
    expect([...flights.keys()].sort()).toEqual(["c:1", "post"]);
    expect(runs).toEqual([]);
    expect(h.pending()).toBe("true");
  });

  it("a probe of another guess of the post is not re-run", async () => {
    const runs: unknown[] = [];
    const h = held(h =>
      createRenderEffect(
        () => (runs.push(1), `${isPending(h.c2)}:${latest(h.c)}`),
        () => {}
      )
    );
    await change(h, runs);
    expect(runs).toEqual([]);
    expect(h.pending()).toBe("true");
  });
});
