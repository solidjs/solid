/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

// Regression test for solid-refresh#85: in a Vite app, every HMR update of
// the entry module duplicated the rendered tree (each save appended another
// copy of the app) instead of replacing it.
//
// The solid-refresh Babel transform's `fixRender` feature rewrites top-level
// `render(...)` calls in a hot module to
//
//   const _cleanup = render(() => <App />, root);
//   if (import.meta.hot) import.meta.hot.dispose(_cleanup);
//
// so the disposer returned by `render` is invoked by Vite right before the
// module re-executes. This test drives that exact flow — first execution
// renders and registers dispose; the simulated update runs dispose, re-runs
// the module body, then fires the old module's accept callback — and asserts
// the container ends up with exactly one tree.
import { afterEach, describe, expect, test } from "vitest";
import { createComponent, createSignal, flush } from "solid-js";
import { $$component, $$refresh, $$registry } from "solid-js/refresh";
import { render } from "../src/index.js";

/**
 * Minimal model of Vite's client hot context, faithful to the pieces the
 * refresh runtime and `fixRender` output rely on: `data` persists across
 * executions of the same module, `dispose` registers a callback invoked
 * (with `data`) before the replacement module executes, and the self-accept
 * callback of the *previous* execution fires after the new one finishes.
 */
function createViteModuleHotSystem() {
  const data: Record<string, any> = {};
  let disposeCallback: ((data: Record<string, any>) => void) | undefined;
  let acceptCallback: ((mod?: unknown) => void) | undefined;
  let invalidated = false;

  function makeHotContext() {
    return {
      data,
      accept(cb: (mod?: unknown) => void) {
        acceptCallback = cb;
      },
      dispose(cb: (data: Record<string, any>) => void) {
        disposeCallback = cb;
      },
      invalidate() {
        invalidated = true;
      },
      decline() {}
    };
  }

  return {
    makeHotContext,
    wasInvalidated: () => invalidated,
    /** Simulates Vite applying an update: dispose → re-execute → accept. */
    update(executeModule: (hot: ReturnType<typeof makeHotContext>) => void) {
      const previousAccept = acceptCallback;
      disposeCallback?.(data);
      executeModule(makeHotContext());
      previousAccept?.({});
      flush();
    }
  };
}

describe("HMR entry-module flow (solid-refresh#85)", () => {
  let container!: HTMLDivElement;
  let cleanupRender: (() => void) | undefined;

  afterEach(() => {
    cleanupRender?.();
    cleanupRender = undefined;
  });

  /**
   * Simulates one execution of the compiled entry module:
   *
   *   const App = $$component(registry, "App", () => <div>...</div>, {...});
   *   const _cleanup = render(() => <App />, container);
   *   if (import.meta.hot) import.meta.hot.dispose(_cleanup);
   *   $$refresh("vite", import.meta.hot, registry);
   */
  function executeEntryModule(
    hot: any,
    container: HTMLElement,
    version: number,
    signature: string
  ) {
    const registry = $$registry();
    const App = $$component(
      registry,
      "App",
      () => {
        const [count] = createSignal(0);
        return (
          <div class="app">
            v{version}:{count()}
          </div>
        ) as any;
      },
      { signature }
    );
    cleanupRender = render(() => createComponent(App as any, {}), container);
    hot.dispose(cleanupRender);
    $$refresh("vite", hot, registry);
  }

  test("saving the entry module replaces the tree instead of appending a copy", () => {
    const system = createViteModuleHotSystem();
    container = document.createElement("div");
    document.body.appendChild(container);

    executeEntryModule(system.makeHotContext(), container, 1, "sig-a");
    expect(container.querySelectorAll(".app")).toHaveLength(1);
    expect(container.textContent).toBe("v1:0");

    // Edit App (signature changes) and save: Vite disposes the old module,
    // re-executes it, then fires the old self-accept callback.
    system.update(hot => executeEntryModule(hot, container, 2, "sig-b"));

    expect(system.wasInvalidated()).toBe(false);
    expect(container.querySelectorAll(".app")).toHaveLength(1);
    expect(container.textContent).toBe("v2:0");

    // A second save must not accumulate trees either.
    system.update(hot => executeEntryModule(hot, container, 3, "sig-c"));

    expect(system.wasInvalidated()).toBe(false);
    expect(container.querySelectorAll(".app")).toHaveLength(1);
    expect(container.textContent).toBe("v3:0");

    document.body.removeChild(container);
  });

  test("render's disposer clears the container (public unmount contract)", () => {
    container = document.createElement("div");
    const dispose = render(() => (<div class="app">hello</div>) as any, container);
    expect(container.querySelectorAll(".app")).toHaveLength(1);
    dispose();
    expect(container.innerHTML).toBe("");
    cleanupRender = undefined;
  });
});
