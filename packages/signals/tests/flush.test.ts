import { createEffect, createRoot, createSignal, flush, resetErrorHalt } from "../src/index.js";

afterEach(() => flush());

describe("scheduler hygiene around throwing effects", () => {
  it("balances syncDepth when an effect throws inside flush(fn)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [a, setA] = createSignal(0);
    const [c, setC] = createSignal(0);
    const seenC: number[] = [];

    createRoot(() => {
      // Throws without writing a signal, so the drain leaves no pending work —
      // this isolates the syncDepth leak from any stuck-`scheduled` symptom.
      createEffect(a, v => {
        if (v === 1) throw new Error("boom");
      });
      createEffect(c, v => {
        seenC.push(v);
      });
    });
    flush();
    // Drain the microtask queued by effect creation; a leftover microtask would
    // otherwise mask a leaked syncDepth by draining the work for us.
    await Promise.resolve();
    seenC.length = 0;

    expect(() => flush(() => setA(1))).toThrow("boom");

    // The uncaught error halts the system by design; revive it so a leaked
    // syncDepth is the only thing that could stop `schedule()` from queuing a
    // microtask again.
    resetErrorHalt();
    setC(3);
    await Promise.resolve();
    await Promise.resolve();
    expect(seenC).toEqual([3]);
    vi.restoreAllMocks();
  });
});

it("should batch updates", () => {
  const [$x, setX] = createSignal(10);
  const effect = vi.fn();

  createRoot(() => createEffect($x, effect));
  flush();

  setX(20);
  setX(30);
  setX(40);

  expect(effect).to.toHaveBeenCalledTimes(1);
  flush();
  expect(effect).to.toHaveBeenCalledTimes(2);
});

it("should wait for queue to flush", () => {
  const [$x, setX] = createSignal(10);
  const $effect = vi.fn();

  createRoot(() => createEffect($x, $effect));
  flush();

  expect($effect).to.toHaveBeenCalledTimes(1);

  setX(20);
  flush();
  expect($effect).to.toHaveBeenCalledTimes(2);

  setX(30);
  flush();
  expect($effect).to.toHaveBeenCalledTimes(3);
});

it("should not fail if called while flushing", () => {
  const [$a, setA] = createSignal(10);

  const effect = vi.fn(() => {
    flush();
  });

  createRoot(() => createEffect($a, effect));
  flush();

  expect(effect).to.toHaveBeenCalledTimes(1);

  setA(20);
  flush();
  expect(effect).to.toHaveBeenCalledTimes(2);
});

it("should run callback and flush before returning", () => {
  const [$x, setX] = createSignal(10);
  const effect = vi.fn();

  createRoot(() => createEffect($x, effect));
  flush();

  const result = flush(() => {
    setX(20);
    expect(effect).to.toHaveBeenCalledTimes(1);
    return "done";
  });

  expect(result).toBe("done");
  expect(effect).to.toHaveBeenCalledTimes(2);
});

it("nested flush(fn) drains at each level", () => {
  const [$x, setX] = createSignal(10);
  const [$y, setY] = createSignal(10);
  const effect = vi.fn();

  createRoot(() => createEffect(() => [$x(), $y()], effect));
  flush();

  flush(() => {
    setX(20);
    expect(effect).to.toHaveBeenCalledTimes(1);

    const inner = flush(() => {
      setY(30);
      expect(effect).to.toHaveBeenCalledTimes(1);
      return 1;
    });

    expect(inner).toBe(1);
    // Inner flush drained, so effect already saw [20, 30].
    expect(effect).to.toHaveBeenCalledTimes(2);
  });

  // Outer flush drain finds nothing pending — no extra call.
  expect(effect).to.toHaveBeenCalledTimes(2);
});
