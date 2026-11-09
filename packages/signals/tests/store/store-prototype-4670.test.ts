// #4670: a store proxy over an array subclass or a class instance keeps the
// source's prototype chain — `instanceof`, `Object.getPrototypeOf` and
// `.constructor` answer as they do on the source (core R48: class instances
// wrap). The proxy target stays an empty `{}`/`[]` (R51 target indirection,
// `Array.isArray`); a `getPrototypeOf` trap forwards the backing's prototype.
// Core R30 is unchanged: reading an inherited `constructor` on a DRAFT stays
// `undefined` (the pollution guard); a plain read answers the class.
import { describe, expect, test } from "vitest";
import { createProjection, createStore, flush, reconcile, snapshot } from "../../src/index.js";

class Sub extends Array<number> {
  total() {
    return this.reduce((a, b) => a + b, 0);
  }
}
class Obj {
  n = 1;
  hi() {
    return this.n;
  }
}
class Inner {
  v = 0;
}

describe("#4670 store proxies keep the source prototype", () => {
  test("the issue's repro: array subclass and class instance", () => {
    const [s] = createStore<any>({ tags: Sub.from([1, 2]), o: new Obj() });
    expect(Object.getPrototypeOf(s.tags)).toBe(Sub.prototype);
    expect(s.tags instanceof Sub).toBe(true);
    expect(s.tags instanceof Array).toBe(true);
    expect(Array.isArray(s.tags)).toBe(true);
    expect(s.tags.total()).toBe(3);
    expect(s.o instanceof Obj).toBe(true);
    expect(Object.getPrototypeOf(s.o)).toBe(Obj.prototype);
    expect(s.o.constructor).toBe(Obj);
    expect(s.tags.constructor).toBe(Sub);
    expect(s.o.hi()).toBe(1);
    // Array species follows the class, as on the source.
    const doubled = s.tags.map((x: number) => x * 2);
    expect(doubled instanceof Sub).toBe(true);
    expect(doubled.total()).toBe(6);
  });

  test("a frozen class instance keeps its prototype (core R50/R51)", () => {
    const [s] = createStore<any>({ o: Object.freeze(new Obj()) });
    expect(s.o instanceof Obj).toBe(true);
    expect(s.o.hi()).toBe(1);
    expect(Object.keys(s.o)).toEqual(["n"]);
  });

  test("plain objects and arrays keep their prototypes and constructors", () => {
    const [s] = createStore<any>({ list: [1], rec: { a: 1 }, bare: Object.create(null) });
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
    expect(s.constructor).toBe(Object);
    expect(Object.getPrototypeOf(s.list)).toBe(Array.prototype);
    expect(s.list.constructor).toBe(Array);
    expect(Array.isArray(s.list)).toBe(true);
    expect(Array.isArray(s.rec)).toBe(false);
    expect(Object.getPrototypeOf(s.bare)).toBe(null);
    expect(s.bare.constructor).toBeUndefined();
  });

  test("a class instance as the root, and nested class instances", () => {
    class Root {
      child = new Inner();
      rows = Sub.from([4, 5]);
    }
    const [s] = createStore<any>(new Root());
    expect(s instanceof Root).toBe(true);
    expect(s.child instanceof Inner).toBe(true);
    expect(s.rows instanceof Sub).toBe(true);
    expect(s.rows.total()).toBe(9);
  });

  test("after a write, the prototype holds on the proxy, the draft, and the snapshot of an unwritten child", () => {
    const [s, set] = createStore<any>({ tags: Sub.from([1, 2]), o: new Obj(), c: new Inner() });
    let draftTags: unknown;
    let draftObj: unknown;
    set(d => {
      d.tags.push(3);
      d.o.n = 2;
      draftTags = d.tags instanceof Sub;
      draftObj = Object.getPrototypeOf(d.o) === Obj.prototype;
    });
    expect(draftTags).toBe(true);
    expect(draftObj).toBe(true);
    flush();
    expect(s.tags instanceof Sub).toBe(true);
    expect(s.tags.total()).toBe(6);
    expect(s.tags.length).toBe(3);
    expect(Array.isArray(s.tags)).toBe(true);
    expect(s.o instanceof Obj).toBe(true);
    expect(s.o.hi()).toBe(2);
    expect(s.c instanceof Inner).toBe(true);
    expect(snapshot(s).c instanceof Inner).toBe(true);
    // A second write over the committed clone.
    set(d => {
      d.tags[0] = 10;
    });
    flush();
    expect(s.tags instanceof Sub).toBe(true);
    expect(s.tags.total()).toBe(15);
  });

  test("an array subclass written with accessors or named keys keeps its prototype", () => {
    const tags = Sub.from([1, 2]) as Sub & { label?: string };
    tags.label = "x";
    const [s, set] = createStore<any>({ tags });
    set(d => {
      d.tags.push(3);
    });
    flush();
    expect(s.tags instanceof Sub).toBe(true);
    expect(s.tags.label).toBe("x");
    expect(s.tags.total()).toBe(6);
  });

  test("through reconcile: in place and by replacement", () => {
    const [s, set] = createStore<any>({ tags: Sub.from([1, 2]), o: new Obj() });
    set(reconcile({ tags: Sub.from([1, 2, 3]), o: new Obj() }, "id"));
    flush();
    expect(s.tags instanceof Sub).toBe(true);
    expect(s.tags.total()).toBe(6);
    expect(s.o instanceof Obj).toBe(true);
    // A plain array replacing a subclass answers Array, and back.
    set(reconcile({ tags: [7], o: { n: 3 } }, "id"));
    flush();
    expect(s.tags.length).toBe(1);
    expect(s.tags[0]).toBe(7);
    expect(s.o.n).toBe(3);
    set(reconcile({ tags: Sub.from([8, 9]), o: new Obj() }, "id"));
    flush();
    expect(s.tags instanceof Sub).toBe(true);
    expect(s.tags.total()).toBe(17);
    expect(s.o instanceof Obj).toBe(true);
  });

  test("core R30: reading an inherited `constructor` on a draft stays undefined", () => {
    const [s, set] = createStore<any>({ o: new Obj(), tags: Sub.from([1]), rec: { a: 1 } });
    const seen: unknown[] = [];
    set(d => {
      seen.push(d.constructor, d.o.constructor, d.tags.constructor, d.rec.constructor);
      seen.push((d as any).__proto__, d.o.__proto__);
      // The prototype itself is still reported (instanceof works on drafts).
      seen.push(d.o instanceof Obj, d.tags instanceof Sub);
    });
    flush();
    expect(seen).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      true
    ]);
    expect(({} as any).polluted).toBeUndefined();
    // Outside the draft the class answers; inherited `__proto__`/`prototype`
    // stay unserved everywhere (a prototype object is never wrapped).
    expect(s.o.constructor).toBe(Obj);
    expect(s.rec.constructor).toBe(Object);
    expect(s.o.__proto__).toBeUndefined();
    expect(s.rec.__proto__).toBeUndefined();
    expect(s.o.prototype).toBeUndefined();
  });

  test("the prototype cannot be changed through the store", () => {
    const [s, set] = createStore<any>({ o: new Obj() });
    expect(Reflect.setPrototypeOf(s.o, null)).toBe(false);
    set(d => {
      d.o.__proto__ = null;
    });
    flush();
    expect(s.o instanceof Obj).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(Obj.prototype, "polluted")).toBe(false);
  });

  test("a projection's draft and its output keep the prototype", () => {
    const [src] = createStore<any>({ o: new Obj(), tags: Sub.from([1, 2]) });
    let inDerive: unknown[] = [];
    const p = createProjection<any>(
      d => {
        inDerive = [d.o instanceof Obj, d.tags instanceof Sub, d.o.constructor];
        d.o.n = src.o.n + 1;
      },
      { o: new Obj(), tags: Sub.from([3]) }
    );
    expect(p.o.n).toBe(2);
    expect(inDerive).toEqual([true, true, undefined]);
    expect(p.o instanceof Obj).toBe(true);
    expect(p.tags instanceof Sub).toBe(true);
    expect(p.o.constructor).toBe(Obj);
  });
});
