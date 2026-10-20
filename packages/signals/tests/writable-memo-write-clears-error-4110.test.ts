/**
 * A writable memo that throws keeps throwing for every later reader. Clearing
 * STATUS_ERROR only happens on a recompute or an async settle, and a direct
 * write deliberately does neither, so the written value commits underneath a
 * node that still reports an error and the memo cannot be recovered.
 *
 * @see https://github.com/solidjs/solid/issues/4110
 */
import { afterEach, expect, it } from "vitest";
import {
  action,
  createEffect,
  createErrorBoundary,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  resetErrorHalt,
  untrack
} from "../src/index.js";

afterEach(() => resetErrorHalt());

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
};
const message = (e: any) => String(e?.cause?.message ?? e?.message ?? e);
const read = (f: () => unknown) => {
  try {
    return f();
  } catch (e) {
    return "throws:" + message(e);
  }
};

it("a write clears an error the derivation left behind", () => {
  const seen: unknown[] = [];
  const { value, setValue } = createRoot(() => {
    const [failing] = createSignal(true);
    const [value, setValue] = createSignal(() => {
      if (failing()) throw new Error("boom");
      return 1;
    });
    createEffect(() => value(), {
      effect: v => void seen.push({ ok: v }),
      error: e => void seen.push({ err: (e as Error).message })
    });
    return { value, setValue };
  });

  flush();
  expect(seen).toEqual([{ err: "boom" }]);

  setValue(2);
  flush();
  expect(seen).toEqual([{ err: "boom" }, { ok: 2 }]);
  expect(value()).toBe(2);
});

it("a write of the last good value still recovers the memo", () => {
  const { value, setValue, setFailing } = createRoot(() => {
    const [failing, setFailing] = createSignal(false);
    const [value, setValue] = createSignal(() => {
      if (failing()) throw new Error("boom");
      return 1;
    });
    return { value, setValue, setFailing };
  });

  expect(value()).toBe(1);

  setFailing(true);
  flush();
  expect(() => value()).toThrow("boom");

  // equal to the last good value, so the equality gate must not drop it
  setValue(1);
  flush();
  expect(value()).toBe(1);
});

// The error stays the display until the write commits (D-41): a read between
// the write and its flush still throws instead of tearing to the old value.
it("a read before the write's flush still throws the error", () => {
  const { value, setValue, setFailing } = createRoot(() => {
    const [failing, setFailing] = createSignal(false);
    const [value, setValue] = createSignal(() => {
      if (failing()) throw new Error("boom");
      return 1;
    });
    createEffect(value, { effect: () => {}, error: () => {} });
    return { value, setValue, setFailing };
  });
  flush();
  setFailing(true);
  flush();
  setValue(2);
  expect(read(value)).toBe("throws:boom");
  flush();
  expect(value()).toBe(2);
});

it("a write held by an action shows the error until the action commits", async () => {
  const gate = deferred();
  const log: unknown[] = [];
  const [failing, setFailing] = createSignal(false);
  let value!: () => number, setValue!: (v: number) => void;
  const dispose = createRoot(d => {
    [value, setValue] = createSignal(() => {
      if (failing()) throw new Error("boom");
      return 1;
    }) as any;
    createEffect(value, {
      effect: v => void log.push({ ok: v }),
      error: e => void log.push({ err: message(e) })
    });
    return d;
  });
  const act = action(function* () {
    setValue(3);
    yield gate.promise;
  });
  flush();
  setFailing(true);
  flush();
  act();
  flush();
  log.push({ mid: read(() => untrack(value)) });
  gate.resolve();
  await tick();
  await tick();
  expect(log).toEqual([{ ok: 1 }, { err: "boom" }, { mid: "throws:boom" }, { ok: 3 }]);
  expect(value()).toBe(3);
  dispose();
  flush();
});

it("an error boundary recovers when the action's write commits", async () => {
  const gate = deferred();
  const log: unknown[] = [];
  const [failing, setFailing] = createSignal(false);
  let value!: () => number, setValue!: (v: number) => void;
  const dispose = createRoot(d => {
    [value, setValue] = createSignal(() => {
      if (failing()) throw new Error("boom");
      return 1;
    }) as any;
    const b = createErrorBoundary(
      () => value(),
      e => "fallback:" + message(e())
    );
    createRenderEffect(b, v => void log.push(v));
    return d;
  });
  const act = action(function* () {
    setValue(3);
    yield gate.promise;
  });
  flush();
  setFailing(true);
  flush();
  act();
  flush();
  log.push("--mid");
  gate.resolve();
  await tick();
  await tick();
  expect(log).toEqual([1, "fallback:boom", "--mid", 3]);
  dispose();
  flush();
});

// A write replaces an error a pass staged under the action's hold: the effect
// receives the written value, not the error arm with the value as the "error".
it("a write after a staged error in the same action lands as a value", async () => {
  const gate = deferred();
  const seen: unknown[] = [];
  const [step, setStep] = createSignal(0);
  let value!: () => number, setValue!: (v: number) => void;
  const dispose = createRoot(d => {
    [value, setValue] = createSignal(() => {
      if (step() === 1) throw new Error("boom");
      return step();
    }) as any;
    createEffect(value, {
      effect: v => void seen.push({ ok: v }),
      error: e => void seen.push({ err: message(e) })
    });
    return d;
  });
  const act = action(function* () {
    setStep(1);
    yield gate.promise;
    setValue(5);
  });
  flush();
  act();
  flush();
  gate.resolve();
  await tick();
  await tick();
  expect(seen).toEqual([{ ok: 0 }, { ok: 5 }]);
  expect(value()).toBe(5);
  dispose();
  flush();
});
