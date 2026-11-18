import { describe, expect, test } from "vitest";
import { createEffect, createRoot, createStore, flush } from "../../src/index.js";

class Cart {
  items = [1, 2];
  get total() {
    return this.items.reduce((a, b) => a + b, 0);
  }
  sum() {
    return this.items.reduce((a, b) => a + b, 0);
  }
  add(n: number) {
    this.items.push(n);
  }
}

describe("class instance members in a store (CS-R48)", () => {
  test("a prototype getter tracks the fields it reads", () => {
    const [s, set] = createStore({ cart: new Cart() });
    const seen: number[] = [];
    createRoot(() => {
      createEffect(
        () => s.cart.total,
        v => void seen.push(v)
      );
    });
    flush();
    set(d => {
      d.cart.items.push(3);
    });
    flush();
    expect(seen).toEqual([3, 6]);
  });

  test("a getter on a nested class instance updates after a write", () => {
    const [s, set] = createStore({ outer: { cart: new Cart() } });
    const seen: number[] = [];
    createRoot(() => {
      createEffect(
        () => s.outer.cart.total,
        v => void seen.push(v)
      );
    });
    flush();
    set(d => {
      d.outer.cart.items = [5];
    });
    flush();
    expect(seen).toEqual([3, 5]);
    expect(s.outer.cart.total).toBe(5);
  });

  test("a method outside a draft runs on the proxy and tracks", () => {
    const [s, set] = createStore({ cart: new Cart() });
    const seen: number[] = [];
    createRoot(() => {
      createEffect(
        () => s.cart.sum(),
        v => void seen.push(v)
      );
    });
    flush();
    set(d => {
      d.cart.items.push(3);
    });
    flush();
    expect(seen).toEqual([3, 6]);
  });

  test("a method outside a draft cannot write the store or its source", () => {
    const cart = new Cart();
    const [s] = createStore({ cart });
    try {
      s.cart.add(9);
    } catch {}
    expect(s.cart.items.length).toBe(2);
    expect(cart.items).toEqual([1, 2]);
  });

  test("a method called in a draft writes reactively", () => {
    const [s, set] = createStore({ cart: new Cart() });
    const seen: number[] = [];
    createRoot(() => {
      createEffect(
        () => s.cart.total,
        v => void seen.push(v)
      );
    });
    flush();
    set(d => {
      d.cart.add(4);
    });
    flush();
    expect(seen).toEqual([3, 7]);
    expect(s.cart.sum()).toBe(7);
  });

  test("constructor, instanceof and absent keys are unchanged", () => {
    const [s, set] = createStore<{ cart: Cart & { extra?: number } }>({ cart: new Cart() });
    expect(s.cart.constructor).toBe(Cart);
    expect(s.cart instanceof Cart).toBe(true);
    const seen: (number | undefined)[] = [];
    createRoot(() => {
      createEffect(
        () => s.cart.extra,
        v => void seen.push(v)
      );
    });
    flush();
    set(d => {
      d.cart.extra = 1;
    });
    flush();
    expect(seen).toEqual([undefined, 1]);
  });

  test("plain objects and arrays keep proxy-receiver methods", () => {
    const [s] = createStore({ list: [1, 2], o: { a: 1 } });
    expect(s.list.map).toBe(Array.prototype.map);
    expect(s.o.hasOwnProperty).toBe(Object.prototype.hasOwnProperty);
  });
});
