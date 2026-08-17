/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */

import { describe, expect, test, vi } from "vitest";
import {
  createSignal,
  createMemo,
  createResource,
  enableScheduling,
  useTransition
} from "../../src/index.js";
import { getSuspenseContext } from "../../src/reactive/signal.js";
import { render, Suspense } from "../src/index.js";

describe("Transition memo stale read (#2046)", () => {
  test("memo created during transition should not return undefined in committed state", async () => {
    // isolate:false + suspense.spec's enableScheduling() leave the time-slicing
    // scheduler on. Transition updates then go through requestCallback, and a
    // stranded MessageChannel queue means RouteComponent never mounts. Null
    // restores the immediate runQueue path this test was written against.
    enableScheduling(null as any);

    const div = document.createElement("div");
    const [showDetail, setShowDetail] = createSignal(false);
    const [resourceKey, setResourceKey] = createSignal("home");
    const [dbVersion, setDbVersion] = createSignal(1);
    const [pending, start] = useTransition();
    let dataRef: (() => { q: number }) | null = null;
    let resolveResource: (v: string) => void;

    let fetchCount = 0;
    const dispose = render(() => {
      const [resource] = createResource(
        () => resourceKey(),
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
      function RouteComponent() {
        // Always returns {q:42}. Never undefined.
        const data = createMemo(() => ({ q: 42 }));
        // Reads both dbVersion (external signal) and data
        const label = createMemo(() => dbVersion() + ": " + data()!.q);
        dataRef = data;
        return (
          <>
            <p>{label()}</p>
            <p>{resource()!}</p>
          </>
        );
      }
      return <Suspense fallback="loading">{showDetail() && <RouteComponent />}</Suspense>;
    }, div);

    try {
      // Wait for initial resource to resolve
      await Promise.resolve();
      await Promise.resolve();

      // Ensure startTransition creates a real transition in this test environment.
      getSuspenseContext();

      // Navigate via transition — resource refetches, keeps transition pending
      const transition = start(() => {
        setShowDetail(true);
        setResourceKey("detail");
      });

      await vi.waitFor(() => {
        expect(dataRef).not.toBeNull();
        expect(pending()).toBe(true);
      });

      // External signal change while transition is pending.
      // label recomputes → reads data() → should be {q:42}, not undefined.
      setDbVersion(2);
      expect(dataRef!()).toEqual({ q: 42 });

      resolveResource!("done");
      await transition;
      await Promise.resolve();
    } finally {
      dispose();
    }
  });
});
