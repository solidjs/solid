/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * solidjs/solid#3609: a primitive created with no owner while `hydrate()` is
 * running. The hydration facades peeked the next child id off `getOwner()!`
 * and threw `TypeError: Cannot read properties of null (reading '_config')`,
 * halting the reactive system (REACTIVITY_HALTED). An ownerless node has no
 * id counter to consume, so there is nothing to hydrate positionally: it
 * takes the path `{ transparent: true }` takes — straight to the core
 * primitive, no registry lookup. #3600 patched the one caller it hit
 * (`useHead`'s `waitAsset` gate) with an explicit `transparent`; this pins
 * the general rule at the facades, for the issue's exact repro.
 */
import { afterEach, expect, test, vi } from "vitest";
import { createMemo, createSignal, createStore, flush, runWithOwner } from "solid-js";
import { hydrate } from "@solidjs/web";

function setup() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  return document.createElement("div");
}

const spies: Array<ReturnType<typeof vi.spyOn>> = [];
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
});
function silence() {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  spies.push(error, warn);
  return { error, warn };
}

test("ownerless createMemo during hydrate()", () => {
  const { error } = silence();
  let thrown: unknown;
  let read: (() => number) | undefined;
  const dispose = hydrate(() => {
    try {
      read = runWithOwner(null, () => createMemo(() => 1));
    } catch (e) {
      thrown = e;
    }
    return null;
  }, setup());
  flush();
  try {
    expect(thrown).toBeUndefined();
    expect(read!()).toBe(1);
    expect(error).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});

test("ownerless function-form createSignal during hydrate()", () => {
  const { error } = silence();
  let thrown: unknown;
  let read: (() => number) | undefined;
  const dispose = hydrate(() => {
    try {
      [read] = runWithOwner(null, () => createSignal(() => 1))!;
    } catch (e) {
      thrown = e;
    }
    return null;
  }, setup());
  flush();
  try {
    expect(thrown).toBeUndefined();
    expect(read!()).toBe(1);
    expect(error).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});

test("ownerless function-form createStore during hydrate()", () => {
  const { error } = silence();
  let thrown: unknown;
  let state: { n: number } | undefined;
  const dispose = hydrate(() => {
    try {
      [state] = runWithOwner(null, () =>
        createStore<{ n: number }>(
          draft => {
            draft.n = 1;
          },
          { n: 0 }
        )
      )!;
    } catch (e) {
      thrown = e;
    }
    return null;
  }, setup());
  flush();
  try {
    expect(thrown).toBeUndefined();
    expect(state!.n).toBe(1);
    expect(error).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});

test("the ownerless node touches no serialized slot and shifts no sibling id", () => {
  const { error } = silence();
  const container = setup();
  // The first owned memo under hydrate()'s root would be the slot the
  // ownerless one must not peek or consume.
  const hy = (globalThis as any)._$HY;
  const requested: string[] = [];
  hy.r = new Proxy(
    {},
    {
      has(_, key) {
        requested.push(String(key));
        return false;
      }
    }
  );
  let detached: (() => number) | undefined;
  const dispose = hydrate(() => {
    detached = runWithOwner(null, () => createMemo(() => 1));
    return null;
  }, container);
  flush();
  try {
    expect(detached!()).toBe(1);
    expect(requested).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});
