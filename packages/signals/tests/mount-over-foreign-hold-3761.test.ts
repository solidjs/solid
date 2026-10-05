/**
 * #3761 (GabbeV, "let mainline mounts publish before foreign holds") — the
 * part of its test file that L2 already guarantees, kept as pins.
 *
 * The PR proposes that a mainline mount's DERIVATIONS read the screen first;
 * L2 rules the opposite (A29, creation-time form: a mainline mount shows the
 * committed frame for direct bindings and holds derived ones — "born held" —
 * until the commit reveals both; the mount-reads-the-screen arm was built
 * and reverted 2026-10-02, plan §27.2 N1). Those cases are not here. These
 * five are the PR's asks that follow from standing rules:
 *
 * - a born-held mount disposed before the landing runs once and cleans up
 *   once; the hold lands regardless (ruling A / O2: a held pass's children
 *   die with their owner);
 * - a mount over a source that has never committed suspends (A19 exc. 1 —
 *   loading, not pending);
 * - a direct render effect over two foreign holds is a stale reader of each
 *   (A15): it publishes each landing as it comes, and the other stays held;
 * - a mount whose flush joins the source transaction (a sibling memo already
 *   holds it) still lands and shows the truth; an async sibling that joins
 *   does not strand a synchronous mount beside it.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  NotReadyError,
  onCleanup
} from "../src/index.js";

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

function hold(write: () => void) {
  let release!: () => void;
  const run = action(function* () {
    write();
    yield new Promise<void>(resolve => (release = resolve));
  });
  const done = run();
  flush();
  return { release, done };
}

describe("a mainline mount over a foreign hold — what L2 already gives of #3761", () => {
  it("a born-held mount disposed before the landing runs once, cleans up once; the hold lands regardless", async () => {
    const [source, setSource] = createSignal(0);
    const pending = hold(() => setSource(1));
    let runs = 0;
    let cleanups = 0;
    const dispose = createRoot(dispose => {
      createMemo(() => {
        runs++;
        onCleanup(() => {
          cleanups++;
        });
        return source();
      });
      return dispose;
    });
    dispose();
    flush();
    pending.release();
    await tick();
    expect(runs).toBe(1);
    expect(cleanups).toBe(1);
    expect(source()).toBe(1);
  });

  it("a mount over a source that has never committed suspends — loading, not pending (A19 exc. 1)", async () => {
    let finish!: (value: number) => void;
    let value!: () => number;
    const shown: number[] = [];
    const dispose = createRoot(dispose => {
      const source = createMemo(
        () =>
          new Promise<number>(resolve => {
            finish = resolve;
          })
      );
      value = createMemo(source);
      createRenderEffect(value, value => {
        shown.push(value);
      });
      return dispose;
    });
    flush();
    expect(() => value()).toThrow(NotReadyError);
    expect(shown).toEqual([]);
    finish(1);
    await tick();
    expect(shown).toEqual([1]);
    dispose();
  });

  it("a direct render effect over two foreign holds is a stale reader of each (A15): each landing publishes on its own", async () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const first = hold(() => setA(1));
    const second = hold(() => setB(2));
    const shown: number[][] = [];
    const dispose = createRoot(dispose => {
      createRenderEffect(
        () => [a(), b()],
        value => {
          shown.push(value);
        }
      );
      return dispose;
    });
    flush();
    expect(shown).toEqual([[0, 0]]);
    first.release();
    await tick();
    expect(shown.at(-1)).toEqual([1, 0]);
    expect(isPending(b)).toBe(true);
    second.release();
    await tick();
    expect(shown.at(-1)).toEqual([1, 2]);
    dispose();
  });

  it("an async mount whose flush joins the source transaction (a sibling memo holds it) still lands and shows the truth", async () => {
    const [source, setSource] = createSignal(0);
    const [other, setOther] = createSignal(0);
    const disposeJoin = createRoot(dispose => {
      createRenderEffect(
        createMemo(() => source() + other()),
        () => {}
      );
      return dispose;
    });
    flush();
    const pending = hold(() => setSource(1));
    const answers: Array<() => void> = [];
    const shown: number[] = [];
    const dispose = createRoot(dispose => {
      const value = createMemo(() => {
        const current = source();
        return new Promise<number>(resolve => answers.push(() => resolve(current)));
      });
      createRenderEffect(value, value => {
        shown.push(value);
      });
      return dispose;
    });
    setOther(1);
    flush();
    pending.release();
    await tick();
    for (const answer of answers.splice(0)) answer();
    await tick();
    for (const answer of answers.splice(0)) answer();
    await tick();
    expect(source()).toBe(1);
    expect(shown.at(-1)).toBe(1);
    dispose();
    disposeJoin();
  });

  it("a synchronous mount beside an async sibling that joins its source is not stranded", async () => {
    const [source, setSource] = createSignal(0);
    const [other, setOther] = createSignal(0);
    const disposeJoin = createRoot(dispose => {
      createRenderEffect(
        createMemo(() => source() + other()),
        () => {}
      );
      return dispose;
    });
    flush();
    const pending = hold(() => setSource(1));
    let finish!: () => void;
    const shown: number[] = [];
    const dispose = createRoot(dispose => {
      const value = createMemo(source);
      const sibling = createMemo(
        () =>
          new Promise<number>(resolve => {
            finish = () => resolve(10);
          })
      );
      createRenderEffect(value, value => {
        shown.push(value);
      });
      createRenderEffect(sibling, () => {});
      return dispose;
    });
    setOther(1);
    flush();
    pending.release();
    await tick();
    finish();
    await tick();
    expect(source()).toBe(1);
    expect(shown.at(-1)).toBe(1);
    dispose();
    disposeJoin();
  });
});
