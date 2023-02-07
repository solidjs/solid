import { describe, it, expect, test } from "vitest";

import { createEffect, createRoot, untrack, createStore, unwrap, flushSync } from "../";
import { sharedClone } from "./sharedClone";

describe("recursive effects", () => {
  it("can track deeply with cloning", () => {
    const [store, setStore] = createStore({ foo: "foo", bar: { baz: "baz" } });

    let called = 0;
    let next: any;

    createRoot(() => {
      createEffect(() => {
        next = sharedClone(next, store);
        called++;
      });
    });

    setStore((s) => {
      s.foo = "1";
    });

    setStore((s) => {
      s.bar.baz = "2";
    });

    flushSync();
    expect(called).toBe(2);
  });

  it("respects untracked", () => {
    const [store, setStore] = createStore({ foo: "foo", bar: { baz: "baz" } });

    let called = 0;
    let next: any;

    createRoot(() => {
      createEffect(() => {
        next = sharedClone(next, untrack(() => store).bar);
        called++;
      });
    });

    setStore((s) => {
      s.foo = "1";
    });

    setStore((s) => {
      s.bar.baz = "2";
    });

    setStore((s) => {
      s.bar = {
        baz: "3",
      };
    });

    flushSync();
    expect(called).toBe(2);
  });

  it("supports unwrapped values", () => {
    const [store, setStore] = createStore({ foo: "foo", bar: { baz: "baz" } });

    let called = 0;
    let prev: any;
    let next: any;

    createRoot(() => {
      createEffect(() => {
        prev = next;
        next = unwrap(sharedClone(next, store));
        called++;
      });
    });

    setStore((s) => {
      s.foo = "1";
    });

    setStore((s) => {
      s.bar.baz = "2";
    });

    flushSync();
    expect(next).not.toBe(prev);
    expect(called).toBe(2);
  });
});
