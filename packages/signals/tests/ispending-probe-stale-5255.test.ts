/**
 * #5255: the probe record is per pass. A reader that probed a guess and then
 * reads it only through `latest()` (same guess, still out) is not woken by
 * the next input change.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  refresh
} from "../src/index.js";

const flights = new Map<string, { res: (v: any) => void; rej: (e: any) => void }>();
const asked: string[] = [];
const ask = (key: string) => {
  asked.push(key);
  return new Promise<any>((res, rej) => flights.set(key, { res, rej }));
};
const answer = (key: string, v: unknown) => {
  const f = flights.get(key)!;
  flights.delete(key);
  f.res(v);
};
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
let disposers: (() => void)[] = [];
afterEach(async () => {
  disposers.forEach(d => d());
  disposers = [];
  for (const f of flights.values()) f.res(0);
  flights.clear();
  asked.length = 0;
  await tick();
});

function base(extra: (h: any) => void, opts: { refreshAtEnd?: boolean } = {}) {
  const h: any = {};
  createRoot(dispose => {
    disposers.push(dispose);
    h.dispose = dispose;
    const [sel, setSel] = createSignal(3);
    h.sel = sel;
    h.setSel = setSel;
    const [c, set] = createOptimistic(() => ask("c:" + sel()));
    h.c = c;
    h.set = set;
    h.post = action(function* () {
      set(9);
      yield ask("post");
      if (opts.refreshAtEnd !== false) refresh(c);
    });
    createRenderEffect(
      () => String(isPending(c)),
      v => void (h.p = v)
    );
    extra(h);
  });
  return h;
}
async function prime(h: any) {
  await tick();
  answer("c:3", 4);
  await tick();
  for (const k of [...flights.keys()]) if (k.startsWith("d:")) (answer(k, 40), await tick());
  h.post();
  flush();
  await tick();
  for (const k of [...flights.keys()]) if (k.startsWith("d:")) (answer(k, 90), await tick());
}

describe("#5255 a reader that stopped probing", () => {
  it("an async memo that stopped probing starts no request on the next input change", async () => {
    const runs: string[] = [];
    let setMode!: (v: boolean) => void;
    const h = base(h => {
      const [mode, sm] = createSignal(true);
      setMode = sm;
      const d = createMemo(() => {
        const k = mode() ? `p${isPending(h.c)}` : `l${latest(h.c)}`;
        runs.push(k);
        return ask("d:" + k);
      });
      createRenderEffect(d, () => {});
    });
    await prime(h);
    setMode(false); // still under the guess: probe recorded earlier, now latest only
    flush();
    await tick();
    for (const k of [...flights.keys()]) if (k.startsWith("d:")) (answer(k, 1), await tick());
    runs.length = 0;
    asked.length = 0;
    h.setSel(1);
    flush();
    await tick();
    expect(asked).toEqual(["c:1"]);
    expect(runs).toEqual([]);
  });

  it("a render effect that stopped probing is not re-run on the next input change", async () => {
    let runs = 0;
    let setMode!: (v: boolean) => void;
    const h = base(h => {
      const [mode, sm] = createSignal(true);
      setMode = sm;
      createRenderEffect(
        () => (runs++, mode() ? String(isPending(h.c)) : String(latest(h.c))),
        () => {}
      );
    });
    await prime(h);
    setMode(false);
    flush();
    await tick();
    runs = 0;
    h.setSel(1);
    flush();
    await tick();
    expect(runs).toBe(0);
  });
});
