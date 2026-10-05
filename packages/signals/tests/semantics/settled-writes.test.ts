import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  onSettled
} from "../../src/index.js";
import { HostTasks } from "./host.js";

test("onSettled can start another async update after the triggering update has published", async () => {
  const host = new HostTasks();
  const gates = new Map<number, () => void>();
  const published = { a: -1, b: -1, details: -1 };
  const callbacks: Array<{ label: string; a: number; b: number; details: number }> = [];
  let setA!: (value: number) => void;
  let setB!: (value: number) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [a, writeA] = createSignal(0);
    const [b, writeB] = createSignal(0);
    setA = writeA;
    setB = writeB;
    const details = createMemo(() => {
      const value = b();
      return new Promise<number>(resolve => {
        gates.set(value, () => resolve(value));
      });
    });
    createRenderEffect(a, value => {
      published.a = value;
    });
    createRenderEffect(
      () => [b(), details()],
      ([b, details]) => {
        published.b = b;
        published.details = details;
      }
    );
  });
  try {
    flush();
    await host.run(() => gates.get(0)!());
    await host.drain();
    await host.run(() => {
      setA(1);
      onSettled(() => {
        callbacks.push({ label: "first", ...published });
        setB(1);
        onSettled(() => {
          callbacks.push({ label: "second", ...published });
        });
      });
    });
    await host.drain();
    expect(callbacks).toEqual([{ label: "first", a: 1, b: 0, details: 0 }]);
    expect(published).toEqual({ a: 1, b: 0, details: 0 });
    await host.run(() => gates.get(1)!());
    await host.drain();
    expect(callbacks).toEqual([
      { label: "first", a: 1, b: 0, details: 0 },
      { label: "second", a: 1, b: 1, details: 1 }
    ]);
  } finally {
    dispose();
    for (const resolve of gates.values()) resolve();
    await host.drain();
    flush();
    host.close();
  }
});
