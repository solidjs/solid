import { createRoot } from "../../src";
import { createMutable } from "../src";

describe("Class Operator test", () => {
  test("read and set class", () => {
    class D {
      f = 1;
      get e() {
        return this.f * 4;
      }
    }
    class A {
      a = 1;
      get b() {
        return this.a * 4;
      }
      child = new D();
    }
    let m: any;
    const increment = () => {
      m.a++;
      m.child.f++;
    };

    createRoot(() => {
      m = createMutable(new A());
      increment();
    });

    expect(m.b).toBe(8);
    expect(m.child.e).toBe(8);
    increment();
    expect(m.b).toBe(12);
    expect(m.child.e).toBe(12);
    increment();
    expect(m.b).toBe(16);
    expect(m.child.e).toBe(16);
  });
});
