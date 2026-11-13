/**
 * S-51 (F-2, F-6, D-22), edges of "a pass that asks reads ahead on the
 * screen" raised in review of #4826.
 *
 * 1. A verdict never throws what its thunk throws: `isPending(fn)` whose
 *    thunk errors is simply not pending. That holds for the pass a second
 *    write re-runs as the frame's (verdict.ts `reask`), whose windows are
 *    answered for the hold's world — the same swallow, the same screens as
 *    the thunk that does not throw.
 * 2. The landing's re-derivations hold its runs for one round, never for a
 *    flight nothing on screen reads (F-2, #4504): an unread verdict memo,
 *    sync or async, re-derived at the landing delays nothing.
 * 3. A sync memo over a sync verdict memo reads it as the same window inline
 *    would (D-22): with no hold there is nothing to read ahead of, and under
 *    a hold the display shows the verdict ahead beside the screen's value.
 */
import { afterEach, describe, expect, test } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  resetErrorHalt
} from "../src/index.js";

afterEach(() => resetErrorHalt());

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("isPending whose thunk throws, in the pass a second write re-runs", () => {
  async function run(throws: boolean) {
    const log: string[] = [];
    const asks: string[] = [];
    const gates: Record<string, (v: string) => void> = {};
    const [source, setSource] = createSignal("/");
    const dispose = createRoot(dispose => {
      const data = createMemo(() => {
        const v = source();
        const p = isPending(() => {
          source();
          if (throws) throw new Error("thunk");
        });
        const k = `${v}|${p}`;
        if (!v.startsWith("/slow")) return k;
        asks.push(k);
        return new Promise<string>(r => (gates[k] = r));
      });
      createRenderEffect(
        data,
        v => void log.push(`data: ${v}`),
        e => void log.push(`error: ${(e as Error).message}`)
      );
      createRenderEffect(source, v => void log.push(`src: ${v}`));
      return dispose;
    });
    flush();
    log.length = 0;
    setSource("/slow1");
    flush();
    await tick();
    setSource("/slow2"); // supersedes the question the hold waits on
    flush();
    await tick();
    for (const k in gates) gates[k]("=" + k);
    await tick();
    dispose();
    return { log, asks };
  }

  test("the thunk's error is swallowed: the same screens and requests as without it", async () => {
    const plain = await run(false);
    const thrown = await run(true);
    expect(thrown).toEqual(plain);
    expect(thrown.log.filter(x => x.startsWith("error"))).toEqual([]);
    // Each write's question once, and the write only beside its answer.
    expect(thrown.asks).toEqual(["/slow1|false", "/slow2|false"]);
    expect(thrown.log.filter(x => !x.startsWith("data: /"))).toEqual([
      "data: =/slow2|false",
      "src: /slow2"
    ]);
  });
});

describe("the landing re-derives a verdict memo nothing on screen reads", () => {
  for (const form of ["sync", "async"] as const)
    test(`${form}: the write shows at the landing, held for nothing`, async () => {
      const log: string[] = [];
      let go!: () => unknown;
      let done!: () => void;
      let watched!: () => unknown;
      const dispose = createRoot(dispose => {
        const [s, setS] = createSignal(0);
        const m = createMemo(() => latest(s) + s());
        // Never answers: a flight nothing on screen reads holds nothing.
        const a = createMemo(() => (m() === 0 ? 0 : new Promise<number>(() => {})));
        watched = form === "sync" ? m : a;
        createRenderEffect(s, v => void log.push(`s:${v}`));
        // A user effect keeps the memo live — it runs as a verdict reader
        // during the hold and the landing re-derives it — and is no screen:
        // its pending holds nothing.
        createEffect(watched, () => {});
        go = action(function* () {
          setS(1);
          yield new Promise<void>(r => (done = r));
        });
        return dispose;
      });
      flush();
      go();
      flush();
      await tick();
      expect(log).toEqual(["s:0"]);
      done();
      await tick();
      expect(log).toEqual(["s:0", "s:1"]);
      dispose();
    });
});

describe("a sync memo over a sync verdict memo (D-22)", () => {
  for (const kind of ["latest", "isPending"] as const) {
    const setup = (held: boolean) => {
      const log: string[] = [];
      let go!: () => unknown;
      let done: () => void = () => {};
      const dispose = createRoot(dispose => {
        const [id, setId] = createSignal(0);
        const v = createMemo(() => (kind === "latest" ? latest(id) : isPending(id)));
        const over = createMemo(() => `${v()}`);
        const inline = createMemo(() => `${kind === "latest" ? latest(id) : isPending(id)}`);
        createRenderEffect(
          () => `${id()} ${over()} ${inline()}`,
          v => void log.push(v)
        );
        go = held
          ? action(function* () {
              setId(1);
              yield new Promise<void>(r => (done = r));
            })
          : () => setId(1);
        return dispose;
      });
      return { log, go: () => go(), done: () => done(), dispose };
    };
    const start = kind === "latest" ? "0 0 0" : "0 false false";
    const ahead = kind === "latest" ? "0 1 1" : "0 true true";
    const end = kind === "latest" ? "1 1 1" : "1 false false";

    test(`${kind}, no hold: one frame, nothing read ahead`, async () => {
      const r = setup(false);
      flush();
      r.go();
      flush();
      await tick();
      expect(r.log).toEqual([start, end]);
      r.dispose();
    });

    test(`${kind}, held by an action: the memo form shows ahead as inline does`, async () => {
      const r = setup(true);
      flush();
      r.go();
      flush();
      await tick();
      expect(r.log).toEqual([start, ahead]);
      r.done();
      await tick();
      expect(r.log).toEqual([start, ahead, end]);
      r.dispose();
    });
  }
});
