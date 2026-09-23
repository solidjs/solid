/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3609: while hydrating, ownerless `createMemo` / function-form `createSignal`
 * must take the same path as `{ transparent: true }`. Peeking a child id off
 * a null owner throws `Cannot read properties of null (reading '_config')`
 * and halts reactivity.
 */
import { expect, test } from "vitest";
import { createMemo, createSignal, flush, getOwner, runWithOwner } from "solid-js";
import { peekNextChildId } from "@solidjs/signals";
import { hydrate, render } from "@solidjs/web";

function setup() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  return document.createElement("div");
}

test("ownerless createMemo during hydrate()", () => {
  let thrown: unknown;
  const dispose = hydrate(() => {
    try {
      runWithOwner(null, () => createMemo(() => 1));
    } catch (e) {
      thrown = e;
    }
    return null;
  }, setup());
  flush();
  dispose();
  expect(thrown).toBeUndefined();
});

test("ownerless function-form createSignal during hydrate()", () => {
  let thrown: unknown;
  const dispose = hydrate(() => {
    try {
      runWithOwner(null, () => createSignal(() => 1));
    } catch (e) {
      thrown = e;
    }
    return null;
  }, setup());
  flush();
  dispose();
  expect(thrown).toBeUndefined();
});

test("transparent createMemo during hydrate() runs live and consumes no id", () => {
  const r: Record<string, unknown> = {};
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r, fe() {} };
  let live: unknown;
  let owned: unknown;
  const dispose = hydrate(() => {
    const owner = getOwner()!;
    const id = peekNextChildId(owner);
    // A transparent node inherits its parent's id. The facade must skip
    // hydration entirely, or that serialized value would be adopted.
    r[owner.id!] = "parent-serialized";
    r[id] = "server";
    live = createMemo(() => "client", { transparent: true })();
    expect(peekNextChildId(owner)).toBe(id);
    owned = createMemo(() => "client")();
    return null;
  }, document.createElement("div"));
  flush();
  dispose();
  expect(live).toBe("client");
  expect(owned).toBe("server");
});

test("transparent function-form createSignal during hydrate() runs live and consumes no id", () => {
  const r: Record<string, unknown> = {};
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r, fe() {} };
  let live: unknown;
  let owned: unknown;
  const dispose = hydrate(() => {
    const owner = getOwner()!;
    const id = peekNextChildId(owner);
    r[owner.id!] = "parent-serialized";
    r[id] = "server";
    const [get] = createSignal(() => "client", { transparent: true });
    live = get();
    expect(peekNextChildId(owner)).toBe(id);
    owned = createMemo(() => "client")();
    return null;
  }, document.createElement("div"));
  flush();
  dispose();
  expect(live).toBe("client");
  expect(owned).toBe("server");
});

test("ownerless createMemo outside hydrate()", () => {
  let value: unknown;
  const dispose = render(() => {
    runWithOwner(null, () => {
      value = createMemo(() => 1)();
    });
    return null;
  }, document.createElement("div"));
  flush();
  dispose();
  expect(value).toBe(1);
});

test("ownerless function-form createSignal outside hydrate()", () => {
  let value: unknown;
  const dispose = render(() => {
    runWithOwner(null, () => {
      const [get] = createSignal(() => 1);
      value = get();
    });
    return null;
  }, document.createElement("div"));
  flush();
  dispose();
  expect(value).toBe(1);
});

test("owned createMemo still adopts the serialized value", () => {
  const r: Record<string, unknown> = {};
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r, fe() {} };
  let owned: unknown;
  const dispose = hydrate(() => {
    const owner = getOwner()!;
    r[peekNextChildId(owner)] = "server";
    owned = createMemo(() => "client")();
    return null;
  }, document.createElement("div"));
  flush();
  dispose();
  expect(owned).toBe("server");
});

test("owned function-form createSignal still adopts the serialized value", () => {
  const r: Record<string, unknown> = {};
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r, fe() {} };
  let owned: unknown;
  const dispose = hydrate(() => {
    const owner = getOwner()!;
    r[peekNextChildId(owner)] = "server";
    const [get] = createSignal(() => "client");
    owned = get();
    return null;
  }, document.createElement("div"));
  flush();
  dispose();
  expect(owned).toBe("server");
});

test("ownerless createMemo during hydrate() consumes no hydration id", () => {
  const r: Record<string, unknown> = {};
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r, fe() {} };
  let detached: unknown;
  let owned: unknown;
  const dispose = hydrate(() => {
    runWithOwner(null, () => {
      detached = createMemo(() => "detached")();
    });
    const owner = getOwner()!;
    const id = peekNextChildId(owner);
    r[id] = "server";
    owned = createMemo(() => "client")();
    return null;
  }, document.createElement("div"));
  flush();
  dispose();
  expect(detached).toBe("detached");
  expect(owned).toBe("server");
});
