/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { lazy, Component, ErrorBoundary, sharedConfig } from "../../src/index.js";
import { hydrate, render, Suspense } from "../src/index.js";

describe("lazy() disposal", () => {
  test("nested lazy boundaries remount after navigation-style dispose", async () => {
    const Child: Component<{ label: string }> = props => <span>{props.label}</span>;
    const innerResolvers: Array<(mod: { default: typeof Child }) => void> = [];
    const InnerLazy = lazy<typeof Child>(
      () => new Promise(resolve => innerResolvers.push(resolve))
    );

    const Route = () => (
      <Suspense fallback="inner-loading">
        <InnerLazy label="page-content" />
      </Suspense>
    );

    let routeImports = 0;
    const RouteLazy = lazy(() => {
      routeImports++;
      return Promise.resolve({ default: Route });
    });

    const mount = () => {
      const div = document.createElement("div");
      const dispose = render(
        () => (
          <Suspense fallback="outer-loading">
            <RouteLazy />
          </Suspense>
        ),
        div
      );
      return { div, dispose };
    };

    const resolvePending = async () => {
      await Promise.resolve();
      await Promise.resolve();
      for (const resolve of innerResolvers.splice(0)) resolve({ default: Child });
      await Promise.resolve();
      await Promise.resolve();
    };

    const first = mount();
    await resolvePending();
    expect(first.div.textContent).toBe("page-content");
    first.dispose();

    const second = mount();
    await resolvePending();
    expect(second.div.textContent).toBe("page-content");
    expect(routeImports).toBe(1);
    second.dispose();
  });

  test("lazy() retries import function on subsequent load if previous promise rejected", async () => {
    let attempts = 0;
    let shouldFail = true;
    const Child: Component<{ label: string }> = props => <span>{props.label}</span>;

    const LazyComp = lazy(async () => {
      attempts++;
      if (shouldFail) {
        throw new Error("network error");
      }
      return { default: Child };
    });

    await expect(LazyComp.preload()).rejects.toThrow("network error");
    expect(attempts).toBe(1);

    shouldFail = false;
    const res = await LazyComp.preload();
    expect(attempts).toBe(2);
    expect(res.default).toBe(Child);
  });
});

describe("lazy() while hydrating", () => {
  test("a rejected module reaches the ErrorBoundary and releases the hydration count", async () => {
    const Broken = lazy<Component>(() => Promise.reject(new Error("boom")));
    const div = document.createElement("div");
    const previousHY = (globalThis as any)._$HY;
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
    let dispose: (() => void) | undefined;
    try {
      dispose = hydrate(
        () => (
          <ErrorBoundary fallback={(err: Error) => `error boundary: ${err.message}`}>
            <Broken />
          </ErrorBoundary>
        ),
        div
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(div.textContent).toBe("error boundary: boom");
      expect(sharedConfig.count).toBe(0);
    } finally {
      dispose?.();
      sharedConfig.registry = undefined;
      sharedConfig.done = false;
      delete sharedConfig.count;
      sharedConfig.context = undefined;
      (globalThis as any)._$HY = previousHY;
    }
  });
});
