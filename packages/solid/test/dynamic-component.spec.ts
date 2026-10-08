import { createRoot, createSignal, flush } from "../src/index.js";
import { dynamicComponent } from "../src/client/dynamic.js";

const BINDING = Symbol.for("solid.component-binding");

function binding(component: Function, address: string) {
  const value = () => {};
  return Object.assign(value, { [BINDING]: { component, address } });
}

describe("dynamicComponent", () => {
  test("swaps client components when the source changes", () => {
    const [which, setWhich] = createSignal(true);
    const A = (p: { n: string }) => `A${p.n}`;
    const B = (p: { n: string }) => `B${p.n}`;
    let view!: () => string;
    createRoot(() => {
      const Comp = dynamicComponent(() => (which() ? A : B));
      view = Comp({ n: "1" }) as () => string;
    });
    expect(view()).toBe("A1");
    setWhich(false);
    flush();
    expect(view()).toBe("B1");
  });

  test("a string or null renders nothing — there is no tag arm", () => {
    let view!: () => unknown;
    createRoot(() => {
      const Comp = dynamicComponent(() => "div" as any);
      view = Comp({}) as () => unknown;
    });
    expect(view()).toBeUndefined();

    createRoot(() => {
      const Comp = dynamicComponent(() => null);
      view = Comp({}) as () => unknown;
    });
    expect(view()).toBeUndefined();
  });

  test("static calls the source once and renders with no memo", () => {
    const [which, setWhich] = createSignal(true);
    let reads = 0;
    const A = () => "A";
    const B = () => "B";
    let view!: string;
    createRoot(() => {
      const Comp = dynamicComponent(() => (reads++, which() ? A : B), { static: true });
      view = Comp({}) as string;
    });
    expect(view).toBe("A");
    setWhich(false);
    flush();
    expect(view).toBe("A");
    expect(reads).toBe(1);
  });

  test("a static promise is an error", () => {
    const A = () => "A";
    expect(() => dynamicComponent(() => Promise.resolve(A), { static: true })).toThrow(
      /static source must resolve synchronously/
    );
  });

  test("a kept server-component binding delivers the new address without remounting", () => {
    let calls = 0;
    let address!: () => string;
    const mount = (_props: { n: string }, next: () => string) => {
      calls++;
      address = next;
      return "mounted";
    };
    const [which, setWhich] = createSignal(0);
    const resolutions = [binding(mount, "a"), binding(mount, "b")];
    let view!: () => string;
    createRoot(() => {
      const Comp = dynamicComponent(() => resolutions[which()] as any);
      view = Comp({ n: "1" }) as () => string;
    });
    expect(view()).toBe("mounted");
    expect(address()).toBe("a");
    expect(calls).toBe(1);
    setWhich(1);
    flush();
    expect(view()).toBe("mounted");
    expect(calls).toBe(1);
    expect(address()).toBe("b");
  });
});
