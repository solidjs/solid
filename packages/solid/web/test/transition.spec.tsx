/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */

import { describe, expect, test } from "vitest";
import { createSignal, createMemo, createResource, useTransition } from "../../src/index.js";
import { render, Suspense } from "../src/index.js";

describe("Transition memo stale read (#2046)", () => {
  test("memo created during transition should not return undefined in committed state", async () => {
    const div = document.createElement("div");
    const [route, setRoute] = createSignal("home");
    const [dbVersion, setDbVersion] = createSignal(1);
    const [pending, start] = useTransition();
    let dataRef: (() => { q: number }) | null = null;
    let resolveResource: (v: string) => void;

    function RouteComponent() {
      // Always returns {q:42}. Never undefined.
      const data = createMemo(() => ({ q: 42 }));
      // Reads both dbVersion (external signal) and data
      const label = createMemo(() => dbVersion() + ": " + data()!.q);
      dataRef = data;
      return <p>{label()}</p>;
    }

    let fetchCount = 0;
    const dispose = render(() => {
      const [resource] = createResource(
        () => route(),
        r => {
          fetchCount++;
          // First fetch resolves immediately
          if (fetchCount <= 1) return Promise.resolve(r);
          // Second fetch (during transition) stays pending
          return new Promise<string>(resolve => {
            resolveResource = resolve;
          });
        }
      );
      return (
        <Suspense fallback="loading">
          <p>{resource()}</p>
          {route() === "detail" && <RouteComponent />}
        </Suspense>
      );
    }, div);

    // Wait for initial resource to resolve
    await Promise.resolve();
    await Promise.resolve();

    // Navigate via transition — resource refetches, keeps transition pending
    start(() => setRoute("detail"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // RouteComponent mounted during transition, transition is pending
    expect(dataRef).not.toBeNull();
    expect(pending()).toBe(true);

    // External signal change while transition is pending.
    // label recomputes → reads data() → should be {q:42}, not undefined.
    setDbVersion(2);
    expect(dataRef!()).toEqual({ q: 42 });

    resolveResource!("done");
    dispose();
  });
});
