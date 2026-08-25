/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Faithful multi-module simulation of Vite's HMR client driving the
// solid-js/refresh runtime plus @solidjs/web `render`, modeled on
// vite/src/shared/hmr.ts semantics:
//
// - dataMap persists per module path across executions
// - disposeMap holds a SINGLE dispose callback per module path
// - a new hot context (module re-execution) clears the module's stale
//   accept callbacks
// - fetchUpdate captures the old accept callbacks, runs the dispose
//   callback, re-imports (re-executes) the module, and only afterwards
//   fires the captured callbacks with the new module namespace
// - editing a file that is not self-accepting propagates: every
//   self-accepting importer becomes its own boundary
//   (path === acceptedPath) and re-executes
//
// Scenario mirroring solid-refresh#85 / vite-plugin-solid#202: an entry
// module calls render() (fixRender registers its disposer via hot.dispose),
// importing a component module and a shared plain-helper module. Editing
// the shared module re-executes both boundaries. The container must end up
// with exactly one app tree and working event delegation.
import { afterEach, describe, expect, test } from "vitest";
import { createComponent, createContext, createSignal, flush, useContext } from "solid-js";
import { $$component, $$refresh, $$registry } from "solid-js/refresh";
import { render, delegateEvents } from "../src/index.js";

type Accept = (mod?: unknown) => void;

interface ModuleRecord {
  id: string;
  execute: (hot: HotContext) => Record<string, any>;
  exports: Record<string, any>;
  invalidated: boolean;
}

interface HotContext {
  data: Record<string, any>;
  accept: (cb?: Accept) => void;
  dispose: (cb: (data: Record<string, any>) => void) => void;
  invalidate: () => void;
  decline: () => void;
}

/** Tiny module system + Vite HMR client model. */
class ViteSim {
  modules = new Map<string, ModuleRecord>();
  dataMap = new Map<string, Record<string, any>>();
  disposeMap = new Map<string, (data: Record<string, any>) => void>();
  callbacksMap = new Map<string, Accept[]>();
  invalidateCalls: string[] = [];

  define(id: string, execute: (hot: HotContext) => Record<string, any>) {
    this.modules.set(id, { id, execute, exports: {}, invalidated: true });
  }

  private makeHot(id: string): HotContext {
    if (!this.dataMap.has(id)) this.dataMap.set(id, {});
    // A fresh execution clears the module's stale accept callbacks,
    // matching HMRContext's constructor.
    this.callbacksMap.set(id, []);
    return {
      data: this.dataMap.get(id)!,
      accept: (cb?: Accept) => {
        this.callbacksMap.get(id)!.push(cb ?? (() => {}));
      },
      dispose: cb => {
        this.disposeMap.set(id, cb);
      },
      invalidate: () => {
        this.invalidateCalls.push(id);
      },
      decline: () => {}
    };
  }

  /** import — executes the module if it was invalidated, else cached. */
  import(id: string): Record<string, any> {
    const mod = this.modules.get(id)!;
    if (mod.invalidated) {
      mod.invalidated = false;
      mod.exports = mod.execute(this.makeHot(mod.id));
    }
    return mod.exports;
  }

  /**
   * Simulates a file edit: `changed` (and transitively stale modules) are
   * invalidated, then every self-accepting boundary re-executes via
   * fetchUpdate semantics, then old accept callbacks fire.
   */
  update(changedAndStale: string[], boundaries: string[]) {
    for (const id of changedAndStale) this.modules.get(id)!.invalidated = true;
    const fired: Array<() => void> = [];
    for (const boundary of boundaries) {
      // Capture the boundary's callbacks registered by its CURRENT execution.
      const oldCallbacks = [...(this.callbacksMap.get(boundary) ?? [])];
      const disposer = this.disposeMap.get(boundary);
      if (disposer) disposer(this.dataMap.get(boundary)!);
      // Real client awaits dynamic imports between dispose and execution, so
      // scheduled reactive work flushes in those gaps.
      flush();
      const newExports = this.import(boundary);
      flush();
      fired.push(() => {
        for (const cb of oldCallbacks) cb(newExports);
      });
    }
    for (const fn of fired) fn();
    flush();
  }
}

describe("multi-boundary Vite HMR flow (solid-refresh#85 / vite-plugin-solid#202)", () => {
  let container!: HTMLDivElement;

  afterEach(() => {
    container.remove();
  });

  function defineApp(sim: ViteSim) {
    // src/provider.tsx — plain factory, no registered components, not
    // self-accepting (the solid-refresh transform leaves it untouched).
    sim.define("provider", () => {
      const Ctx = createContext<{ name: string }>();
      function Provider(props: { name: string; children?: any }) {
        return createComponent(Ctx as any, {
          value: { name: props.name },
          get children() {
            return props.children;
          }
        });
      }
      function useName() {
        const ctx = useContext(Ctx as any) as { name: string } | undefined;
        if (!ctx) throw new Error("useName must be used within Provider");
        return ctx.name;
      }
      return { Provider, useName };
    });

    // src/Child.tsx — one registered component depending on `useName`.
    sim.define("child", hot => {
      const { useName } = sim.import("provider");
      const registry = $$registry();
      const Child = $$component(
        registry,
        "Child",
        () => {
          const name = useName();
          return (<div class="child">Hello, {name}!</div>) as any;
        },
        { signature: "child-sig", dependencies: () => ({ useName }) }
      );
      hot.accept();
      $$refresh("vite", hot as any, registry);
      return { Child };
    });

    // src/main.tsx — entry: registered App + render() with the fixRender
    // dispose wiring the transform emits.
    sim.define("main", hot => {
      const { Provider } = sim.import("provider");
      const { Child } = sim.import("child");
      const registry = $$registry();
      const App = $$component(
        registry,
        "App",
        () => {
          const [count, setCount] = createSignal(0);
          return (
            <div class="app">
              <p>Count: {count()}</p>
              <button onClick={() => setCount(c => c + 1)}>+1</button>
              <Provider name="world">
                <Child />
              </Provider>
            </div>
          ) as any;
        },
        // The real transform's getForeignBindings excludes JSX component
        // identifiers (Provider, Child) from the dependency list — they are
        // assumed to be stable refresh proxies. Only plain captured bindings
        // (here: none) are listed, so re-executions compare as "unchanged".
        { signature: "app-sig", dependencies: () => ({}) }
      );
      const cleanup = render(() => createComponent(App as any, {}), container);
      hot.dispose(cleanup);
      hot.accept();
      $$refresh("vite", hot as any, registry);
      delegateEvents(["click"]);
      return { App };
    });
  }

  function clickPlusOne() {
    const button = container.querySelector("button")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flush();
  }

  test("editing a shared non-component module keeps one tree and live delegation", () => {
    const sim = new ViteSim();
    container = document.createElement("div");
    document.body.appendChild(container);
    defineApp(sim);

    sim.import("main");
    flush();

    expect(container.querySelectorAll(".app")).toHaveLength(1);
    expect(container.textContent).toContain("Hello, world!");

    clickPlusOne();
    expect(container.textContent).toContain("Count: 1");

    // Edit provider.tsx: not self-accepting, so both importers re-execute
    // as their own boundaries. Vite sends the update list as
    // "/src/main.tsx, /src/Child.tsx" (observed in a live dev server), so
    // main's dispose + re-execution (which pulls in the fresh child module
    // as a dep) happens first, and accept callbacks fire in that order too.
    sim.update(["provider", "child", "main"], ["main", "child"]);

    expect(sim.invalidateCalls).toEqual([]);
    expect(container.querySelectorAll(".app")).toHaveLength(1);
    expect(container.querySelectorAll(".child")).toHaveLength(1);

    // The re-rendered tree must still respond to delegated events.
    clickPlusOne();
    expect(container.textContent).toContain("Count: 1");

    // And a second edit must behave the same.
    sim.update(["provider", "child", "main"], ["main", "child"]);
    expect(sim.invalidateCalls).toEqual([]);
    expect(container.querySelectorAll(".app")).toHaveLength(1);
    expect(container.querySelectorAll(".child")).toHaveLength(1);
    clickPlusOne();
    expect(container.textContent).toContain("Count: 1");
  });

  test("editing the entry module keeps one tree and live delegation", () => {
    const sim = new ViteSim();
    container = document.createElement("div");
    document.body.appendChild(container);
    defineApp(sim);

    sim.import("main");
    flush();
    expect(container.querySelectorAll(".app")).toHaveLength(1);

    sim.update(["main"], ["main"]);
    expect(container.querySelectorAll(".app")).toHaveLength(1);

    clickPlusOne();
    expect(container.textContent).toContain("Count: 1");
  });
});
