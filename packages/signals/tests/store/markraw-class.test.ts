import { describe, expect, test } from "vitest";
import {
  createEffect,
  createRoot,
  createStore,
  flush,
  isWrappable,
  markRaw,
  snapshot
} from "../../src/index.js";

class Counter {
  #n = 0;
  observers = new Set<() => void>();
  get n() {
    return this.#n;
  }
  inc() {
    this.#n++;
    this.observers.forEach(fn => fn());
  }
}
markRaw(Counter);

class Sub extends Counter {}

class Plain {
  v = 1;
}

describe("markRaw(Class) (CS-R42)", () => {
  test("instances of a marked class and its subclasses are not wrappable", () => {
    expect(isWrappable(new Counter())).toBe(false);
    expect(isWrappable(new Sub())).toBe(false);
    expect(isWrappable(new Plain())).toBe(true);
    expect(isWrappable({})).toBe(true);
  });

  test("marking a class returns it", () => {
    class A {}
    expect(markRaw(A)).toBe(A);
    expect(markRaw(() => 1)).toBeTypeOf("function");
  });

  test("a marked instance is served as itself; #private and own writes work", () => {
    const c = new Counter();
    const [s, set] = createStore({ c, list: [new Sub()] });
    expect(s.c).toBe(c);
    expect(s.list[0]).toBeInstanceOf(Sub);
    expect(snapshot(s).c).toBe(c);
    let calls = 0;
    s.c.observers.add(() => calls++);
    s.c.inc();
    expect(s.c.n).toBe(1);
    expect(calls).toBe(1);

    const seen: Counter[] = [];
    createRoot(() => {
      createEffect(
        () => s.c,
        v => void seen.push(v)
      );
    });
    flush();
    const next = new Counter();
    set(d => {
      d.c = next;
    });
    flush();
    expect(seen).toEqual([c, next]);
  });
});
