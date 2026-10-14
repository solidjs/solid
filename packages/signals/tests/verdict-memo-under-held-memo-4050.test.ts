// #4050 (U-10): a memo that reads a verdict memo (`isPending`/`latest`) is
// itself a derivation of a display-ahead read (F-6): it shows the verdict now,
// beside the held value it also reads (the screen's), exactly as it would with
// the probe inline — and as a render effect reading the same two does (F-1: a
// memo between is not a reason to wait). Before, it re-entered the hold with
// its held source and the verdict waited for the landing: a Provider's
// children memo over a router shell `[<Feedback/>, outlet]` never showed the
// feedback.
import { expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

const shapes: Record<
  string,
  (h: () => number, verdict: () => boolean, e: () => boolean) => () => [number, boolean]
> = {
  "render effect [h, V]": (h, verdict) => () => [h(), verdict()],
  "memo [h, inline probe]": (h, _v, e) => createMemo(() => [h(), isPending(h) && latest(e)]),
  "memo [h, V]": (h, verdict) => createMemo(() => [h(), verdict()]),
  "memo over a memo [h, V]": (h, verdict) => {
    const m = createMemo(() => [h(), verdict()] as [number, boolean]);
    return createMemo(() => m());
  }
};

for (const [name, shape] of Object.entries(shapes))
  it(`${name}: the verdict shows beside the held value, then lands with it`, async () => {
    const log: string[] = [];
    const [route, setRoute] = createSignal(0);
    let release!: () => void;
    const h = createMemo(async () => {
      const r = route();
      if (r) await new Promise<void>(res => (release = res));
      return r;
    }) as () => number;
    const [e, setE] = createSignal(false);
    createRoot(() => {
      const verdict = createMemo(() => isPending(h) && latest(e));
      createRenderEffect(shape(h, verdict, e), v => void log.push(v.join(",")));
    });
    await tick();
    setRoute(1);
    flush();
    await tick();
    log.push("|");
    setE(true);
    flush();
    await tick();
    expect(log[log.length - 1]).toBe("0,true");
    log.push("|");
    setE(false);
    release();
    await tick();
    expect(log[log.length - 1]).toBe("1,false");
    expect(log).not.toContain("1,true");
  });

it("memo [V, h] reads the verdict first: shows it now too", async () => {
  const log: string[] = [];
  const [route, setRoute] = createSignal(0);
  let release!: () => void;
  const h = createMemo(async () => {
    const r = route();
    if (r) await new Promise<void>(res => (release = res));
    return r;
  }) as () => number;
  const [e, setE] = createSignal(false);
  createRoot(() => {
    const verdict = createMemo(() => isPending(h) && latest(e));
    const m = createMemo(() => {
      const v = verdict();
      return `${h()},${v}`;
    });
    createRenderEffect(m, v => void log.push(v));
  });
  await tick();
  setRoute(1);
  flush();
  await tick();
  setE(true);
  flush();
  await tick();
  expect(log[log.length - 1]).toBe("0,true");
  setE(false);
  release();
  await tick();
  expect(log[log.length - 1]).toBe("1,false");
});
