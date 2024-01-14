/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */
import { createMutable } from "../src";
import { render } from "../../web";

describe("Class Operator test", () => {
  test("read and set class", () => {
    let ref: any;
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
    function Test() {
      m = createMutable(new A());
      m.a++;
      m.child.f++;

      return (
        <button
          type="button"
          onClick={() => {
            m.a++;
            m.child.f++;
          }}
          ref={ref}
        >
          {m.a} - {m.b}
        </button>
      );
    }
    const div = document.createElement("div");

    render(Test, div);
    expect(m.b).toBe(8);
    expect(m.child.e).toBe(8);
    ref.$$click();
    expect(m.b).toBe(12);
    expect(m.child.e).toBe(12);
    ref.$$click();
    expect(m.b).toBe(16);
    expect(m.child.e).toBe(16);
  });
});
