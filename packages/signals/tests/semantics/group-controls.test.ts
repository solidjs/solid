import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../../src/index.js";
import { HostTasks } from "./host.js";

function setup(sharedMemo = false, asyncPair = false, separateAsync = true) {
  const host = new HostTasks();
  const gates: Array<Array<() => void>> = [[], []];
  const shown = [0, 0];
  let pair = [0, 0];
  let dispose!: () => void;
  const state = createRoot(d => {
    dispose = d;
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const values = [a, b];
    const details = values.map((read, i) =>
      createMemo(() => {
        const value = read();
        return new Promise<number>(resolve => gates[i].push(() => resolve(value)));
      })
    );
    for (let i = 0; i < 2; i++) {
      createRenderEffect(values[i], value => {
        shown[i] = value;
      });
      if (separateAsync) createRenderEffect(details[i], () => {});
    }
    const combined = sharedMemo
      ? createMemo(() => [a(), b()])
      : asyncPair
        ? () => [details[0](), details[1]()]
        : () => [a(), b()];
    createRenderEffect(combined, value => {
      pair = value;
    });
    return { setA, setB };
  });
  flush();
  const resolve = (i: number) => gates[i].shift()!();
  const ready = async () => {
    resolve(0);
    resolve(1);
    await host.drain();
  };
  const close = async () => {
    dispose();
    for (const queue of gates) for (const resolve of queue) resolve();
    flush();
    await host.drain();
    host.close();
  };
  return { ...state, host, resolve, ready, close, shown, pair: () => pair };
}

// Controls specify the grouping contract without reading runtime transaction IDs.
// Both async branches are initialized; neither reader needs initial suspension.
test.each([
  ["same block", true],
  ["flush separator", false],
  ["task separator", false],
  ["microtask before flush", true],
  ["microtask after flush", false],
  ["shared memo", true]
] as const)("grouping: %s", async (mode, together) => {
  const h = setup(mode === "shared memo");
  try {
    await h.ready();
    if (mode === "task separator" || mode === "shared memo") {
      await h.host.run(() => h.setA(1));
      await h.host.drain();
      await h.host.run(() => h.setB(1));
    } else
      await h.host.run(() => {
        if (mode === "microtask before flush") queueMicrotask(() => h.setB(1));
        h.setA(1);
        if (mode === "flush separator") flush();
        if (mode === "microtask after flush") queueMicrotask(() => h.setB(1));
        else if (mode !== "microtask before flush") h.setB(1);
      });
    await h.host.drain();
    await h.host.run(() => h.resolve(0));
    await h.host.drain();
    expect(h.shown, mode).toEqual(together ? [0, 0] : [1, 0]);
    expect(h.pair(), mode).toEqual(h.shown);
    await h.host.run(() => h.resolve(1));
    await h.host.drain();
    expect(h.shown).toEqual([1, 1]);
    expect(h.pair()).toEqual([1, 1]);
  } finally {
    await h.close();
  }
});

test.each([true, false])("authoritative action holds, shared batch=%s", async together => {
  const h = setup();
  let finish!: () => void;
  const gate = new Promise<void>(resolve => {
    finish = resolve;
  });
  let done!: Promise<void>;
  try {
    await h.ready();
    await h.host.run(() => {
      h.setA(1);
      if (together)
        done = action(function* () {
          h.setB(1);
          yield gate;
        })();
    });
    await h.host.drain();
    if (!together) {
      await h.host.run(() => {
        done = action(function* () {
          h.setB(1);
          yield gate;
        })();
      });
      await h.host.drain();
    }
    await h.host.run(() => {
      h.resolve(0);
      h.resolve(1);
    });
    await h.host.drain();
    expect(h.shown).toEqual(together ? [0, 0] : [1, 0]);
    finish();
    await done;
    await h.host.drain();
    expect(h.shown).toEqual([1, 1]);
  } finally {
    finish();
    await h.close();
  }
});

// Reading initialized async results alone also permits independent publication.
test.each([true, false])("shared async effect, separate async=%s", async separate => {
  const h = setup(false, true, separate);
  try {
    await h.ready();
    await h.host.run(() => h.setA(1));
    await h.host.drain();
    await h.host.run(() => h.setB(1));
    await h.host.drain();
    await h.host.run(() => h.resolve(0));
    await h.host.drain();
    expect(h.shown).toEqual([1, 0]);
    expect(h.pair()).toEqual([1, 0]);
  } finally {
    await h.close();
  }
});
