import { describe, expect, it } from "vitest";
import { analyzeReactiveHelpers } from "../lint/reactive-helpers.js";

describe("lint: reactive reads in un-annotated helpers", () => {
  it("flags a helper that reads a store (the getUserLabel drift)", () => {
    const findings = analyzeReactiveHelpers(`
      const [state, setState] = createStore({
        user: { name: "Ada" },
        notifications: []
      });

      function getUserLabel() {
        const badge = state.notifications.length > 0 ? " •" : "";
        return state.user.name + badge;
      }
    `);
    expect(findings).toHaveLength(1);
    expect(findings[0].functionName).toBe("getUserLabel");
    expect(findings[0].evidence.join(" ")).toContain('store read "state.notifications"');
    expect(findings[0].message).toContain("silently subscribes");
  });

  it("flags signal-accessor reads in plain helpers, including arrow consts", () => {
    const findings = analyzeReactiveHelpers(`
      const [count, setCount] = createSignal(0);
      const doubled = () => count() * 2;
      function formatDate(d: Date) { return d.toISOString(); }
    `);
    expect(findings.map(f => f.functionName)).toEqual(["doubled"]);
    expect(findings[0].evidence).toEqual(['signal read "count()"']);
  });

  it("propagates reactivity up the call graph", () => {
    const findings = analyzeReactiveHelpers(`
      const [n] = createSignal(1);
      function inner() { return n(); }
      function middle() { return inner() + 1; }
      function outer() { return middle() * 2; }
      function unrelated() { return 42; }
    `);
    expect(findings.map(f => f.functionName).sort()).toEqual(["inner", "middle", "outer"]);
    const outer = findings.find(f => f.functionName === "outer")!;
    expect(outer.evidence).toEqual(['calls reactive function "middle()"']);
  });

  it("accepts the declaration sites: @reactive JSDoc and Reactive<> return type", () => {
    const findings = analyzeReactiveHelpers(`
      const [count] = createSignal(0);

      /** @reactive */
      function labeled() { return count(); }

      const branded = (): Reactive<number> => count() * 2;

      function undeclared() { return count(); }
    `);
    expect(findings.map(f => f.functionName)).toEqual(["undeclared"]);
  });

  it("exempts functions passed directly to tracking primitives", () => {
    const findings = analyzeReactiveHelpers(`
      const [count] = createSignal(0);
      const doubled = createMemo(() => count() * 2);
      function computeLabel() { return count() + "!"; }
      createEffect(computeLabel, v => console.log(v));
    `);
    // The inline memo arrow is a tracked scope; computeLabel is passed to
    // createEffect by name, which IS its declaration as a tracked compute.
    expect(findings).toHaveLength(0);
  });

  it("uses the type-based heuristic for Accessor-typed parameters", () => {
    const findings = analyzeReactiveHelpers(`
      function summarize(items: Accessor<string[]>) {
        return items().join(", ");
      }
    `);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toEqual(['accessor-typed parameter "items()"']);
  });

  it("does not flag component bodies or tracked scopes created inside them", () => {
    const findings = analyzeReactiveHelpers(`
      const [count] = createSignal(0);
      function Counter() {
        createEffect(() => count(), v => console.log(v));
        return "ui";
      }
    `);
    expect(findings).toHaveLength(0);
  });

  it("attributes inline callback reads to the enclosing helper", () => {
    const findings = analyzeReactiveHelpers(`
      const [items] = createSignal([1, 2, 3]);
      const [factor] = createSignal(2);
      function scaled() {
        return items().map(x => x * factor());
      }
    `);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.join(" ")).toContain('signal read "factor()"');
  });

  it("reports position and a fix suggestion", () => {
    const findings = analyzeReactiveHelpers(
      `const [n] = createSignal(1);\nfunction f() { return n(); }`
    );
    expect(findings[0].line).toBe(2);
    expect(findings[0].message).toContain("createMemo");
  });
});
