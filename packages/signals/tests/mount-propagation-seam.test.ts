import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
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

describe("mount propagation seam", () => {
  it("publishes committed inputs on mount, then prepares the source transaction's result", async () => {
    const [source, setSource] = createSignal(0);
    const pending = hold(() => setSource(1));
    const computed: number[] = [];
    const shown: number[] = [];
    let value!: () => number;
    const dispose = createRoot(dispose => {
      value = createMemo(() => {
        computed.push(source());
        return source();
      });
      createRenderEffect(value, value => {
        shown.push(value);
      });
      return dispose;
    });
    flush();
    expect(shown).toEqual([0]);
    expect(computed).toEqual([0, 1]);
    expect(value()).toBe(0);
    pending.release();
    await tick();
    expect(shown).toEqual([0, 1]);
    expect(value()).toBe(1);
    dispose();
  });

  it("does not pull a mounting visibility update into an older store write", async () => {
    const [card, setCard] = createStore({ failed: false });
    const [drag, setDrag] = createSignal(false);
    const shown: string[] = [];
    const dispose = createRoot(dispose => {
      const preview = createMemo(() => {
        if (!drag()) return "hidden";
        const failed = createMemo(() => card.failed);
        return createMemo(() => (failed() ? "failed" : "preview"));
      });
      createRenderEffect(
        () => {
          const value = preview();
          return typeof value === "function" ? value() : value;
        },
        value => {
          shown.push(value);
        }
      );
      return dispose;
    });
    flush();
    const pending = hold(() =>
      setCard(draft => {
        draft.failed = true;
      })
    );
    setDrag(true);
    flush();
    expect(drag()).toBe(true);
    expect(shown.at(-1)).toBe("preview");
    pending.release();
    await tick();
    expect(shown.at(-1)).toBe("failed");
    dispose();
  });

  it("extends the older hold for downstream async discovered by its continuation", async () => {
    const [source, setSource] = createSignal(0);
    const pending = hold(() => setSource(1));
    let finish!: () => void;
    const shown: number[] = [];
    const dispose = createRoot(dispose => {
      const value = createMemo(() => source());
      const details = createMemo(() =>
        value() === 0
          ? 0
          : new Promise<number>(resolve => {
              finish = () => resolve(1);
            })
      );
      createRenderEffect(details, value => {
        shown.push(value);
      });
      return dispose;
    });
    flush();
    expect(shown).toEqual([0]);
    expect(finish).toBeTypeOf("function");
    pending.release();
    await tick();
    expect(source()).toBe(0);
    expect(shown).toEqual([0]);
    finish();
    await tick();
    expect(source()).toBe(1);
    expect(shown).toEqual([0, 1]);
    dispose();
  });

  it("publishes an async mount's initial result before continuing a foreign hold", async () => {
    const [source, setSource] = createSignal(0);
    const pending = hold(() => setSource(1));
    const answers: Array<() => void> = [];
    const shown: number[] = [];
    const dispose = createRoot(dispose => {
      const details = createMemo(() => {
        const value = source();
        return new Promise<number>(resolve => answers.push(() => resolve(value)));
      });
      createRenderEffect(details, value => {
        shown.push(value);
      });
      return dispose;
    });
    flush();
    expect(answers).toHaveLength(1);
    pending.release();
    await tick();
    expect(shown).toEqual([]);
    expect(source()).toBe(0);
    answers.shift()!();
    await tick();
    expect(shown).toEqual([0]);
    expect(answers).toHaveLength(1);
    answers.shift()!();
    await tick();
    expect(shown).toEqual([0, 1]);
    dispose();
  });

  it("keeps separate source transactions independent when they mount separate subtrees", async () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const first = hold(() => setA(1));
    const second = hold(() => setB(2));
    const shownA: number[] = [];
    const shownB: number[] = [];
    const dispose = createRoot(dispose => {
      createRenderEffect(createMemo(a), value => {
        shownA.push(value);
      });
      createRenderEffect(createMemo(b), value => {
        shownB.push(value);
      });
      return dispose;
    });
    flush();
    expect(shownA).toEqual([0]);
    expect(shownB).toEqual([0]);
    first.release();
    await tick();
    expect(shownA).toEqual([0, 1]);
    expect(shownB).toEqual([0]);
    expect(isPending(b)).toBe(true);
    second.release();
    await tick();
    expect(shownB).toEqual([0, 2]);
    dispose();
  });

  it("reads the mounting batch's own staged input alongside the foreign committed input", async () => {
    const [source, setSource] = createSignal(0);
    const [visible, setVisible] = createSignal(false);
    const shown: string[] = [];
    const dispose = createRoot(dispose => {
      const tree = createMemo(() => {
        if (!visible()) return () => "hidden";
        return createMemo(() => `${visible()}:${source()}`);
      });
      createRenderEffect(
        () => tree()(),
        value => {
          shown.push(value);
        }
      );
      return dispose;
    });
    flush();
    const pending = hold(() => setSource(1));
    setVisible(true);
    flush();
    expect(shown).toEqual(["hidden", "true:0"]);
    pending.release();
    await tick();
    expect(shown).toEqual(["hidden", "true:0", "true:1"]);
    dispose();
  });

  it("does not rerun disposed mounts or skip their cleanups", async () => {
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

  it("still suspends a mount whose source has never committed an answer", async () => {
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

  it("releases the directional wait when an async mount is disposed before its first answer", async () => {
    const [source, setSource] = createSignal(0);
    const pending = hold(() => setSource(1));
    let finish!: () => void;
    const shown: number[] = [];
    const dispose = createRoot(dispose => {
      const value = createMemo(() => {
        const current = source();
        return new Promise<number>(resolve => {
          finish = () => resolve(current);
        });
      });
      createRenderEffect(value, value => {
        shown.push(value);
      });
      return dispose;
    });
    flush();
    pending.release();
    await tick();
    expect(source()).toBe(0);
    dispose();
    flush();
    await tick();
    expect(source()).toBe(1);
    finish();
    await tick();
    expect(shown).toEqual([]);
  });

  it("releases waits carried by async mount batches that later merge", async () => {
    const [source, setSource] = createSignal(0);
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const disposeJoin = createRoot(dispose => {
      createRenderEffect(
        createMemo(() => a() + b()),
        () => {}
      );
      return dispose;
    });
    flush();
    const pending = hold(() => setSource(1));
    const answers: Array<() => void> = [];
    const shown: number[][] = [[], []];
    const mount = (index: number) =>
      createRoot(dispose => {
        const value = createMemo(() => {
          const current = source();
          return new Promise<number>(resolve => answers.push(() => resolve(current)));
        });
        createRenderEffect(value, value => {
          shown[index].push(value);
        });
        return dispose;
      });
    const disposeA = mount(0);
    setA(1);
    flush();
    const disposeB = mount(1);
    setB(1);
    flush();
    pending.release();
    await tick();
    expect(source()).toBe(0);
    for (const answer of answers.splice(0)) answer();
    await tick();
    expect(shown).toEqual([[0], [0]]);
    expect(answers).toHaveLength(2);
    for (const answer of answers.splice(0)) answer();
    await tick();
    expect(source()).toBe(1);
    expect(shown).toEqual([
      [0, 1],
      [0, 1]
    ]);
    disposeA();
    disposeB();
    disposeJoin();
  });

  it("does not block its own publication if the mount joins the source transaction", async () => {
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

  it("publishes a synchronous mount beside an async sibling that joins its source", async () => {
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

  it("preserves normal memo entanglement when a shared continuation needs two foreign holds", async () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const first = hold(() => setA(1));
    const second = hold(() => setB(2));
    const shown: number[] = [];
    const dispose = createRoot(dispose => {
      createRenderEffect(
        createMemo(() => a() + b()),
        value => {
          shown.push(value);
        }
      );
      return dispose;
    });
    flush();
    expect(shown).toEqual([0]);
    first.release();
    await tick();
    expect(shown).toEqual([0]);
    second.release();
    await tick();
    expect(shown).toEqual([0, 3]);
    dispose();
  });

  it("keeps direct render readers of two holds independent after their initial frame", async () => {
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

  it("waits for one async mount frame before continuing multiple source transactions", async () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const first = hold(() => setA(1));
    const second = hold(() => setB(2));
    const answers: Array<() => void> = [];
    const shown: number[] = [];
    const dispose = createRoot(dispose => {
      const value = createMemo(() => {
        const sum = a() + b();
        return new Promise<number>(resolve => answers.push(() => resolve(sum)));
      });
      createRenderEffect(value, value => {
        shown.push(value);
      });
      return dispose;
    });
    flush();
    first.release();
    second.release();
    await tick();
    expect(shown).toEqual([]);
    expect(a()).toBe(0);
    expect(b()).toBe(0);
    answers.shift()!();
    await tick();
    expect(shown).toEqual([0]);
    expect(answers).toHaveLength(1);
    answers.shift()!();
    await tick();
    expect(shown).toEqual([0, 3]);
    expect(a()).toBe(1);
    expect(b()).toBe(2);
    dispose();
  });
});
