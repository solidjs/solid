/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createRoot, lazy, Component, ErrorBoundary, sharedConfig } from "../../src/index.js";
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

  test("remounting an already-loaded lazy() component renders synchronously", async () => {
    const flush = () => new Promise<void>(r => setTimeout(r, 0));
    const read = (value: unknown) =>
      typeof value === "function" ? (value as () => unknown)() : value;

    const Loaded: Component = () => "loaded";
    const Lazy1 = lazy(() => Promise.resolve({ default: Loaded }));
    const first1 = createRoot(dispose => ({ dispose, value: Lazy1({}) }));
    await flush();
    expect(read(first1.value)).toBe("loaded");
    first1.dispose();
    const second1 = createRoot(dispose => ({ dispose, value: Lazy1({}) }));
    expect(read(second1.value)).toBe("loaded");
    second1.dispose();

    const Lazy2 = lazy(() => Promise.resolve({ default: () => "loaded" }));
    const view = () => (
      <Suspense fallback="fallback">
        <Lazy2 />
      </Suspense>
    );
    const first2 = createRoot(dispose => ({ dispose, value: view() }));
    await flush();
    expect(read(first2.value)).toBe("loaded");
    first2.dispose();
    const second2 = createRoot(dispose => ({ dispose, value: view() }));
    expect(read(second2.value)).toBe("loaded");
    second2.dispose();
  });

  test("a rejected lazy() import is retried after its root is disposed", async () => {
    const flush = () => new Promise<void>(r => setTimeout(r, 0));
    let attempts = 0;
    let shouldFail = true;
    const LazyComp = lazy(async () => {
      attempts++;
      if (shouldFail) throw new Error("network error");
      return { default: () => "loaded" };
    });
    const mount = () => {
      const div = document.createElement("div");
      const dispose = render(
        () => (
          <ErrorBoundary fallback={(err: Error) => `error:${err.message}`}>
            <LazyComp />
          </ErrorBoundary>
        ),
        div
      );
      return { div, dispose };
    };

    const first = mount();
    await flush();
    expect(first.div.textContent).toBe("error:network error");
    expect(attempts).toBe(1);
    first.dispose();

    shouldFail = false;
    const second = mount();
    await flush();
    expect(second.div.textContent).toBe("loaded");
    expect(attempts).toBe(2);
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
