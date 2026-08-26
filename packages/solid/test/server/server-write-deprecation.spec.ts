/** @vitest-environment node */
// [SERVER_WRITE] deprecation: server render is pure — change enters through
// async sources, never setters. This release tolerates setter calls
// (signal/store writes land as inert data, optimistic writes are no-ops)
// but warns once per process per category on the way to throwing (RFC 11
// server mutation policy). Isolated in its own spec file: the warn-once
// flags are module state, so this file must own the first write of each
// category.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createSignal,
  createStore,
  createOptimistic,
  createOptimisticStore
} from "../../src/server/index.js";

describe("[SERVER_WRITE] deprecation warnings", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  test("signal writes warn once and still land", () => {
    const [value, setValue] = createSignal(1);
    setValue(2);
    expect(value()).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[SERVER_WRITE\] Writing a signal on the server/);

    // Once per process per category — a second write (any signal) is silent.
    const [, setOther] = createSignal(0);
    setOther(9);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("async-form signal setters warn under the same category", () => {
    // Already deduped by the plain write above (module state persists across
    // tests in this file by design).
    const [, setAsync] = createSignal(() => 1);
    setAsync(5 as any);
    expect(warn).not.toHaveBeenCalled();
  });

  test("store writes warn once and still land", () => {
    const [state, setState] = createStore<{ n: number }>({ n: 1 });
    setState(s => {
      s.n = 2;
    });
    expect(state.n).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[SERVER_WRITE\] Writing a store on the server/);

    // Replacement form is the same category — silent now, and still applies.
    const [list, setList] = createStore<{ id: string }[]>([{ id: "x" }]);
    setList(draft => [...draft, { id: "y" }]);
    expect(list.length).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("optimistic writes warn once and stay inert", () => {
    const [value, setValue] = createOptimistic(1);
    setValue(2 as any);
    expect(value()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[SERVER_WRITE\] Optimistic writes are inert/);

    // createOptimisticStore shares the category.
    const [state, setState] = createOptimisticStore<{ n: number }>({ n: 1 });
    setState(s => {
      s.n = 2;
    });
    expect(state.n).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("reads never warn", () => {
    const [value] = createSignal(1);
    const [state] = createStore({ n: 1 });
    const [opt] = createOptimistic(1);
    value();
    state.n;
    opt();
    expect(warn).not.toHaveBeenCalled();
  });
});
