/** @vitest-environment node */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createRoot, createMemo, createRevealOrder } from "../../src/server/index.js";
import { ssrHandleError } from "../../src/server/hydration.js";
import { Loading, Reveal } from "../../src/server/flow.js";
import { sharedConfig } from "../../src/server/shared.js";

// ---- Minimal SSR context infrastructure (mirrors ssr-async.spec.ts) ----

type SSRTemplateObject = { t: string[]; h: Function[]; p: Promise<any>[] };

function resolveSSRNode(
  node: any,
  result: SSRTemplateObject = { t: [""], h: [], p: [] }
): SSRTemplateObject {
  const t = typeof node;
  if (t === "string" || t === "number") {
    result.t[result.t.length - 1] += node;
  } else if (node == null || t === "boolean") {
    // skip
  } else if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      resolveSSRNode(node[i], result);
    }
  } else if (t === "object") {
    if (node.h) {
      result.t[result.t.length - 1] += node.t[0];
      if (node.t.length > 1) {
        result.t.push(...node.t.slice(1));
        result.h.push(...node.h);
        result.p.push(...node.p);
      }
    } else result.t[result.t.length - 1] += node.t;
  } else if (t === "function") {
    try {
      resolveSSRNode(node(), result);
    } catch (err) {
      const p = ssrHandleError(err);
      if (p) {
        result.h.push(node);
        result.p.push(p);
        result.t.push("");
      }
    }
  }
  return result;
}

function resolveSSR(
  template: string[],
  holes: any[],
  result: SSRTemplateObject = { t: [""], h: [], p: [] }
): SSRTemplateObject {
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    result.t[result.t.length - 1] += template[i];
    if (hole == null || hole === true || hole === false) continue;
    resolveSSRNode(hole, result);
  }
  result.t[result.t.length - 1] += template[template.length - 1];
  return result;
}

function ssr(t: string[], ...nodes: any[]): SSRTemplateObject {
  if (nodes.length) return resolveSSR(t, nodes);
  return { t } as any;
}

function escape(s: any): any {
  if (typeof s !== "string") return s;
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface MockSSRContext {
  context: any;
  serialized: Map<string, any>;
  registeredFragments: Map<string, { revealGroup?: string }>;
  fragmentResults: Map<string, string | undefined>;
  revealFragmentsCalls: (string | string[])[];
  revealFallbacksCalls: (string | string[])[];
}

function createMockSSRContext(options: { async?: boolean } = {}): MockSSRContext {
  const serialized = new Map<string, any>();
  const registeredFragments = new Map<string, { revealGroup?: string }>();
  const fragmentResults = new Map<string, string | undefined>();
  const revealFragmentsCalls: (string | string[])[] = [];
  const revealFallbacksCalls: (string | string[])[] = [];

  const context: any = {
    async: options.async !== false,
    assets: [],
    escape,
    resolve: resolveSSRNode,
    ssr,
    serialize(id: string, p: any) {
      serialized.set(id, p);
    },
    replace() {},
    block() {},
    registerFragment(key: string, opts?: { revealGroup?: string }) {
      registeredFragments.set(key, opts || {});
      return (value?: string, error?: any) => {
        fragmentResults.set(key, value);
        return true;
      };
    },
    revealFragments(groupOrKeys: string | string[]) {
      revealFragmentsCalls.push(groupOrKeys);
    },
    revealFallbacks(groupOrKeys: string | string[]) {
      revealFallbacksCalls.push(groupOrKeys);
    }
  };

  return {
    context,
    serialized,
    registeredFragments,
    fragmentResults,
    revealFragmentsCalls,
    revealFallbacksCalls
  };
}

function tick() {
  return new Promise<void>(r => setTimeout(r, 0));
}

// ---- Tests ----

describe("Reveal server exports", () => {
  test("createRevealOrder is a no-op passthrough on server", () => {
    const val = createRevealOrder(() => "result");
    expect(val).toBe("result");
  });

  test("createRevealOrder with options is a no-op passthrough", () => {
    const val = createRevealOrder(() => 42, {
      together: () => true,
      collapsed: () => false
    });
    expect(val).toBe(42);
  });
});

describe("Reveal SSR component", () => {
  let savedContext: any;

  beforeEach(() => {
    savedContext = sharedConfig.context;
  });

  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  test("Reveal without streaming context just renders children", () => {
    sharedConfig.context = undefined;
    let result: any;
    createRoot(() => {
      result = Reveal({ children: "passthrough" as any });
    });
    expect(result).toBe("passthrough");
  });

  test("Reveal without async context just renders children", () => {
    const { context } = createMockSSRContext({ async: false });
    context.async = false;
    sharedConfig.context = context;
    let result: any;
    createRoot(() => {
      result = Reveal({ children: "sync-children" as any });
    });
    expect(result).toBe("sync-children");
  });

  test("Reveal with async context sets up reveal group for child Loading boundaries", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const d1 = deferred<string>();
    const d2 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          get children() {
            return [
              Loading({
                fallback: "loading-1",
                get children() {
                  const data = createMemo(() => d1.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }),
              Loading({
                fallback: "loading-2",
                get children() {
                  const data = createMemo(() => d2.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              })
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    // Both Loading boundaries should have registered fragments
    expect(mock.registeredFragments.size).toBe(2);

    // All registered fragments should have a revealGroup
    const registrations = [...mock.registeredFragments.values()];
    const groupIds = registrations.map(r => r.revealGroup).filter(Boolean);
    expect(groupIds.length).toBe(2);
    // Both should share the same group ID
    expect(groupIds[0]).toBe(groupIds[1]);

    // No extra reveal markers needed — dom-expressions tracks groups via registerFragment options
    const revealEntries = [...mock.serialized.entries()].filter(([k]) => k.endsWith("_reveal"));
    expect(revealEntries.length).toBe(0);
  });

  test("Reveal together mode calls revealFragments when all boundaries resolve", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const d1 = deferred<string>();
    const d2 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          together: true,
          get children() {
            return [
              Loading({
                fallback: "loading-1",
                get children() {
                  const data = createMemo(() => d1.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }),
              Loading({
                fallback: "loading-2",
                get children() {
                  const data = createMemo(() => d2.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              })
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    // No reveals yet
    expect(mock.revealFragmentsCalls.length).toBe(0);

    // Resolve first boundary
    d1.resolve("value-1");
    await tick();
    // Together mode: still no reveal (waiting for both)
    expect(mock.revealFragmentsCalls.length).toBe(0);

    // Resolve second boundary
    d2.resolve("value-2");
    await tick();
    // Now together mode should have called revealFragments
    expect(mock.revealFragmentsCalls.length).toBe(1);
  });

  test("Reveal sequential mode calls revealFragments in order as boundaries resolve", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          get children() {
            return [
              Loading({
                fallback: "loading-1",
                get children() {
                  const data = createMemo(() => d1.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }),
              Loading({
                fallback: "loading-2",
                get children() {
                  const data = createMemo(() => d2.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }),
              Loading({
                fallback: "loading-3",
                get children() {
                  const data = createMemo(() => d3.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              })
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    expect(mock.revealFragmentsCalls.length).toBe(0);

    // Resolve second boundary first — sequential should NOT reveal it yet
    d2.resolve("value-2");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(0);

    // Resolve first boundary — sequential should reveal first, then second (already resolved)
    d1.resolve("value-1");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(2);

    // Resolve third
    d3.resolve("value-3");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(3);
  });

  test("Reveal collapsed sequential calls revealFallbacks for frontier", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          collapsed: true,
          get children() {
            return [
              Loading({
                fallback: "loading-1",
                get children() {
                  const data = createMemo(() => d1.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }),
              Loading({
                fallback: "loading-2",
                get children() {
                  const data = createMemo(() => d2.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }),
              Loading({
                fallback: "loading-3",
                get children() {
                  const data = createMemo(() => d3.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              })
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    // Resolve first boundary — frontier advances, collapsed should call revealFallbacks for remaining
    d1.resolve("value-1");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(1);
    expect(mock.revealFallbacksCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("nested Reveal and Loading preserves ownership boundary", () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    createRoot(
      () => {
        Reveal({
          children: [
            Reveal({
              together: true,
              children: "inner-content" as any
            })
          ] as any
        });
      },
      { id: "t" }
    );

    // Just verify no errors thrown — nested Reveal should compose cleanly
    expect(true).toBe(true);
  });

  test("Loading without Reveal does not set revealGroup", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const d = deferred<string>();

    createRoot(
      () => {
        Loading({
          fallback: "loading...",
          get children() {
            const data = createMemo(() => d.promise);
            return ssr(["<div>", "</div>"], () => data()) as any;
          }
        });
      },
      { id: "t" }
    );

    expect(mock.registeredFragments.size).toBe(1);
    const [opts] = [...mock.registeredFragments.values()];
    expect(opts.revealGroup).toBeUndefined();
  });

  test("sequential out-of-order: second resolving first does not trigger premature reveal", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          get children() {
            return [
              Loading({
                fallback: "fb-1",
                get children() {
                  const data = createMemo(() => d1.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }),
              Loading({
                fallback: "fb-2",
                get children() {
                  const data = createMemo(() => d2.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }),
              Loading({
                fallback: "fb-3",
                get children() {
                  const data = createMemo(() => d3.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              })
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    // Resolve third before first — no reveal should happen
    d3.resolve("val-3");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(0);

    // Resolve second — still no reveal (first is the frontier)
    d2.resolve("val-2");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(0);

    // Resolve first — sequential cascade: all three now revealed in order
    d1.resolve("val-1");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(3);

    // Verify the reveal calls were made with individual keys, in registration order
    const keys = [...mock.registeredFragments.keys()];
    expect(mock.revealFragmentsCalls[0]).toEqual([keys[0]]);
    expect(mock.revealFragmentsCalls[1]).toEqual([keys[1]]);
    expect(mock.revealFragmentsCalls[2]).toEqual([keys[2]]);
  });

  test("Reveal inside Loading: inner group has independent reveal ordering", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const dInnerA = deferred<string>();
    const dInnerB = deferred<string>();

    createRoot(
      () => {
        Loading({
          fallback: "outer-fb",
          get children() {
            return Reveal({
              together: true,
              get children() {
                return [
                  Loading({
                    fallback: "inner-a-fb",
                    get children() {
                      const data = createMemo(() => dInnerA.promise);
                      return ssr(["<span>", "</span>"], () => data()) as any;
                    }
                  }),
                  Loading({
                    fallback: "inner-b-fb",
                    get children() {
                      const data = createMemo(() => dInnerB.promise);
                      return ssr(["<span>", "</span>"], () => data()) as any;
                    }
                  })
                ] as any;
              }
            } as any) as any;
          }
        });
      },
      { id: "t" }
    );

    // Inner Loading boundaries resolve to sync fallbacks, so the outer Loading
    // is itself synchronous. Only the 2 inner boundaries register as fragments.
    expect(mock.registeredFragments.size).toBe(2);

    // Both inner boundaries share a revealGroup from the inner Reveal
    const entries = [...mock.registeredFragments.entries()];
    expect(entries.every(([_, opts]) => !!opts.revealGroup)).toBe(true);
    expect(entries[0][1].revealGroup).toBe(entries[1][1].revealGroup);

    // Resolve one inner boundary — together mode should NOT reveal yet
    dInnerA.resolve("inner-a-val");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(0);

    // Resolve other inner boundary — together mode should now reveal
    dInnerB.resolve("inner-b-val");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(1);
  });

  test("together mode ignores collapsed flag", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const d1 = deferred<string>();
    const d2 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          together: true,
          collapsed: true,
          get children() {
            return [
              Loading({
                fallback: "fb-1",
                get children() {
                  const data = createMemo(() => d1.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }),
              Loading({
                fallback: "fb-2",
                get children() {
                  const data = createMemo(() => d2.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              })
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    // Resolve first — together mode should NOT reveal yet even though collapsed is set
    d1.resolve("val-1");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(0);
    // Together mode should never call revealFallbacks (collapsed is irrelevant)
    expect(mock.revealFallbacksCalls.length).toBe(0);

    // Resolve second — now the group reveals
    d2.resolve("val-2");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(1);
    expect(mock.revealFallbacksCalls.length).toBe(0);
  });
});
