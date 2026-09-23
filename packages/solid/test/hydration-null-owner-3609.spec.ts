/** @vitest-environment jsdom */
// solidjs/solid#3609: a hydration facade reached with no id counter to
// consume — no owner at all (`runWithOwner(null, …)`), or an owner under an
// id-less tree (a detached `createRoot` without `id`) — has nothing to
// hydrate positionally: the server serializes nothing for such a node (its
// `owner.id` guard), so the client must not look one up. Before this fix
// every signal/store-shaped facade peeked `getOwner()!`'s next child id and
// threw (`TypeError: Cannot read properties of null (reading '_config')` for
// the null owner, `Cannot get child id from owner without an id` for the
// id-less one), halting the reactive system. The rule pinned here: no id
// counter behaves exactly like `transparent` — straight to the core
// primitive, no registry lookup, no id consumed.
import { afterEach, describe, expect, test, vi } from "vitest";
import { flush, runWithOwner, createRoot as coreRoot } from "@solidjs/signals";
import {
  enableHydration,
  sharedConfig,
  createEffect,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore
} from "../src/client/hydration.js";

enableHydration();

let requested: string[];
function startHydration(data: Record<string, any>) {
  requested = [];
  sharedConfig.hydrating = true;
  sharedConfig.has = id => {
    requested.push(id);
    return id in data;
  };
  sharedConfig.load = id => data[id];
}
function stopHydration() {
  sharedConfig.hydrating = false;
  sharedConfig.has = undefined;
  sharedConfig.load = undefined;
}

// The two id-less shapes. `detached` is a root the facades' owner check must
// treat the same way as no owner: it has an owner, but no id to count from.
const scopes = [
  ["null owner", <T>(fn: () => T) => runWithOwner(null, fn) as T],
  ["id-less owner (detached root without id)", <T>(fn: () => T) => coreRoot(fn)]
] as const;

// Every option shape a facade branches on — the check must precede all of
// them, so none of these may reach the id peek.
const ssrSources = [undefined, "server", "hybrid", "client"] as const;

describe("hydration facades with no id counter (#3609)", () => {
  afterEach(stopHydration);

  for (const [scopeName, scope] of scopes) {
    describe(scopeName, () => {
      for (const ssrSource of ssrSources) {
        const options = ssrSource ? { ssrSource } : undefined;
        const label = ssrSource ? `ssrSource: "${ssrSource}"` : "no options";

        test(`createMemo (${label}) computes live, consults no registry`, () => {
          startHydration({ t0: { v: "serialized", s: 1 } });
          const read = scope(() => createMemo(() => "live", options as any));
          flush();
          expect(read()).toBe("live");
          expect(requested).toEqual([]);
        });

        test(`function-form createSignal (${label}) computes live, consults no registry`, () => {
          startHydration({ t0: { v: "serialized", s: 1 } });
          const [read] = scope(() => createSignal(() => "live", options as any));
          flush();
          expect(read()).toBe("live");
          expect(requested).toEqual([]);
        });

        test(`function-form createOptimistic (${label}) computes live, consults no registry`, () => {
          startHydration({ t0: { v: "serialized", s: 1 } });
          const [read] = scope(() => createOptimistic(() => "live", options as any));
          flush();
          expect(read()).toBe("live");
          expect(requested).toEqual([]);
        });

        test(`function-form createStore (${label}) computes live, consults no registry`, () => {
          startHydration({ t0: { v: { name: "serialized" }, s: 1 } });
          const [state] = scope(() =>
            createStore<{ name: string }>(
              draft => {
                draft.name = "live";
              },
              { name: "" },
              options as any
            )
          );
          flush();
          expect(state.name).toBe("live");
          expect(requested).toEqual([]);
        });

        test(`function-form createOptimisticStore (${label}) computes live, consults no registry`, () => {
          startHydration({ t0: { v: { name: "serialized" }, s: 1 } });
          const [state] = scope(() =>
            createOptimisticStore<{ name: string }>(
              draft => {
                draft.name = "live";
              },
              { name: "" },
              options as any
            )
          );
          flush();
          expect(state.name).toBe("live");
          expect(requested).toEqual([]);
        });

        test(`createProjection (${label}) computes live, consults no registry`, () => {
          startHydration({ t0: { v: { name: "serialized" }, s: 1 } });
          const state = scope(() =>
            createProjection<{ name: string }>(
              draft => {
                draft.name = "live";
              },
              { name: "" },
              options as any
            )
          );
          flush();
          expect(state.name).toBe("live");
          expect(requested).toEqual([]);
        });
      }

      test("createErrorBoundary renders its children, consults no registry", () => {
        startHydration({ t0: new Error("serialized error") });
        const read = scope(() =>
          createErrorBoundary(
            () => "children",
            (err: any) => `fallback: ${err().message}`
          )
        );
        flush();
        expect(read()).toBe("children");
        expect(requested).toEqual([]);
      });

      test("createLoadingBoundary renders its children, consults no registry", () => {
        startHydration({ t0: "$$f", t0_fr: { s: 0 } });
        const read = scope(() =>
          createLoadingBoundary(
            () => "children",
            () => "fallback"
          )
        );
        flush();
        expect(read()).toBe("children");
        expect(requested).toEqual([]);
      });
    });
  }

  // Effects under a bare null owner are the engine's own concern
  // (NO_OWNER_EFFECT); the id-less-owner shape is the one the facade decides.
  test("effects under an id-less owner compute live, consult no registry", () => {
    startHydration({ t0: { v: "serialized", s: 1 }, t1: { v: "serialized", s: 1 } });
    const seen: string[] = [];
    let dispose!: () => void;
    coreRoot(d => {
      dispose = d;
      createRenderEffect(
        () => "render-live",
        v => {
          seen.push(v);
        }
      );
      createEffect(
        () => "effect-live",
        v => {
          seen.push(v);
        }
      );
    });
    flush();
    try {
      expect(seen).toEqual(["render-live", "effect-live"]);
      expect(requested).toEqual([]);
    } finally {
      dispose();
    }
  });

  test("an ownerless memo consumes no id: the next owned sibling still hydrates positionally", () => {
    startHydration({ t0: { v: "sibling-serialized", s: 1 } });
    let detached!: () => string;
    let sibling!: () => string;
    createRoot(
      () => {
        detached = runWithOwner(null, () => createMemo(() => "live"))!;
        sibling = createMemo(() => "sibling-live");
      },
      { id: "t" }
    );
    flush();
    expect(detached()).toBe("live");
    expect(sibling()).toBe("sibling-serialized");
    expect(new Set(requested)).toEqual(new Set(["t0"]));
  });

  test("the transparent option and the null owner take the same path", () => {
    startHydration({ t0: { v: "serialized", s: 1 } });
    let transparent!: () => string;
    let ownerless!: () => string;
    createRoot(
      () => {
        transparent = createMemo(() => "live", { transparent: true });
        ownerless = runWithOwner(null, () => createMemo(() => "live"))!;
      },
      { id: "t" }
    );
    flush();
    expect(transparent()).toBe("live");
    expect(ownerless()).toBe("live");
    expect(requested).toEqual([]);
  });

  test("function-form createSignal honors `transparent` like createMemo does", () => {
    // MemoOptions.transparent documents "computes live instead of adopting the
    // serialized value"; the function-form signal accepts the same options
    // and must not peek (and adopt) the NEXT sibling's serialized slot.
    startHydration({ t0: { v: "sibling-serialized", s: 1 } });
    let read!: () => string;
    let sibling!: () => string;
    createRoot(
      () => {
        [read] = createSignal(() => "live", { transparent: true });
        sibling = createMemo(() => "sibling-live");
      },
      { id: "t" }
    );
    flush();
    expect(read()).toBe("live");
    expect(sibling()).toBe("sibling-serialized");
    expect(new Set(requested)).toEqual(new Set(["t0"]));
  });

  test("owned nodes are unaffected: a memo under an id-carrying owner still adopts", () => {
    startHydration({ t0: { v: "serialized", s: 1 } });
    const read = createRoot(() => createMemo(() => "live"), { id: "t" });
    flush();
    expect(read()).toBe("serialized");
    expect(new Set(requested)).toEqual(new Set(["t0"]));
  });

  test("nothing is logged for the ownerless shapes", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      startHydration({});
      const read = runWithOwner(null, () => createMemo(() => 1))!;
      const [signal] = runWithOwner(null, () => createSignal(() => 2))!;
      const [store] = runWithOwner(null, () =>
        createStore<{ n: number }>(
          d => {
            d.n = 3;
          },
          { n: 0 }
        )
      )!;
      flush();
      expect([read(), signal(), store.n]).toEqual([1, 2, 3]);
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });
});
