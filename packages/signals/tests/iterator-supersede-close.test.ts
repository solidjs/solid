/**
 * Regression tests for #3122 — superseded async-iterable flights must close
 * (`it.return()`) at supersede time, not when the SUPERSEDING flight settles.
 *
 * The iterator close is registered as an owner cleanup, and a recompute
 * whose disposal rides the zombie-deferred channel only drains it at
 * commitPendingNode — which a verdict-held write defers until the new
 * flight lands. Iterator close is the cancellation hook for anything
 * resource-shaped behind an async iterable (fibers, sockets, subscriptions),
 * so the flight teardown now also fires at the `_inFlight` release site in
 * recompute, keyed to flight identity. The owner-cleanup registration stays
 * as the death backstop (close is idempotent).
 */
import { describe, expect, it } from "vitest";
import {
  createEffect,
  createLoadingBoundary,
  createMemo,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

function trackedSource(label: string, events: string[]) {
  let land!: () => void;
  const source: AsyncIterable<string> & { land: () => void } = {
    land: () => land(),
    [Symbol.asyncIterator]() {
      events.push(`open ${label}`);
      let done = false;
      return {
        next: () =>
          new Promise<IteratorResult<string>>(resolve => {
            land = () => {
              if (done) return resolve({ done: true, value: undefined });
              done = true;
              events.push(`land ${label}`);
              resolve({ done: false, value: label });
            };
          }),
        return: async () => {
          events.push(`close ${label}`);
          done = true;
          return { done: true as const, value: undefined };
        }
      };
    }
  };
  return source;
}

const microtasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

describe("superseded iterator close timing (#3122)", () => {
  it("closes the stale iterator at supersede even under a loading boundary with isPending", async () => {
    const events: string[] = [];
    const sources = new Map<string, ReturnType<typeof trackedSource>>();
    let setQ!: (v: string) => void;
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const [q, set] = createSignal("");
      setQ = set;
      const m = createMemo(() => {
        const v = q();
        if (!v) return [] as unknown as AsyncIterable<string>;
        const src = trackedSource(v, events);
        sources.set(v, src);
        return src;
      });
      // The issue's failing shape: boundary content reading BOTH isPending
      // and latest over the same source.
      const view = createLoadingBoundary(
        () => {
          try {
            const pending = isPending(() => m());
            return { pending, value: latest(() => m()) };
          } catch {
            return undefined;
          }
        },
        () => "loading-fallback"
      );
      createEffect(
        () => view(),
        () => {}
      );
    });
    flush();

    setQ("a");
    flush();
    expect(events).toEqual(["open a"]);

    // Supersede before 'a' lands: the stale iterator must close NOW, not
    // after 'ab' settles.
    setQ("ab");
    flush();
    await microtasks();
    expect(events).toEqual(["open a", "close a", "open ab"]);

    sources.get("ab")!.land();
    await microtasks();
    expect(events).toEqual(["open a", "close a", "open ab", "land ab"]);

    // The closed stale flight can no longer land a value.
    sources.get("a")!.land();
    await microtasks();
    expect(events).toEqual(["open a", "close a", "open ab", "land ab"]);
    dispose();
  });

  it("closes the stale iterator at supersede for a plain reader too", async () => {
    const events: string[] = [];
    const sources = new Map<string, ReturnType<typeof trackedSource>>();
    let setQ!: (v: string) => void;
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const [q, set] = createSignal("a");
      setQ = set;
      const m = createMemo(() => {
        const v = q();
        const src = trackedSource(v, events);
        sources.set(v, src);
        return src;
      });
      createEffect(
        () => {
          try {
            return latest(() => m());
          } catch {
            return undefined;
          }
        },
        () => {}
      );
    });
    flush();
    expect(events).toEqual(["open a"]);

    setQ("b");
    flush();
    await microtasks();
    expect(events).toEqual(["open a", "close a", "open b"]);

    sources.get("b")!.land();
    await microtasks();
    expect(events).toEqual(["open a", "close a", "open b", "land b"]);
    dispose();
  });
});
