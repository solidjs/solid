/** @vitest-environment node */
import { createRoot } from "../../src/server/index.js";
import { dynamicComponent } from "../../src/server/dynamic.js";

describe("server dynamicComponent", () => {
  test("renders the resolved component and nothing for a string", () => {
    const A = (p: { n: string }) => `A${p.n}`;
    let view!: () => unknown;
    createRoot(() => {
      const Comp = dynamicComponent(() => A);
      view = Comp({ n: "1" }) as () => unknown;
    });
    expect(view()).toBe("A1");

    createRoot(() => {
      const Comp = dynamicComponent(() => "div" as any);
      view = Comp({}) as () => unknown;
    });
    expect(view()).toBeUndefined();
  });

  test("static rejects a promise and renders the component with no memo", () => {
    const A = (p: { n: string }) => `A${p.n}`;
    expect(() => dynamicComponent(() => Promise.resolve(A), { static: true })).toThrow(
      /static source must resolve synchronously/
    );
    let reads = 0;
    let view!: unknown;
    createRoot(() => {
      const Comp = dynamicComponent(() => (reads++, A), { static: true });
      view = Comp({ n: "1" });
    });
    expect(view).toBe("A1");
    expect(reads).toBe(1);
  });
});
