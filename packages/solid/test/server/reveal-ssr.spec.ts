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
      order: () => "together",
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
          order: "together",
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
              order: "together",
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
              order: "together",
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

  test("Reveal natural mode reveals each fragment immediately as it resolves", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          order: "natural",
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

    expect(mock.revealFragmentsCalls.length).toBe(0);

    const keys = [...mock.registeredFragments.keys()];

    // Natural mode: out-of-order resolutions reveal immediately.
    d3.resolve("val-3");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(1);
    expect(mock.revealFragmentsCalls[0]).toEqual([keys[2]]);

    d1.resolve("val-1");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(2);
    expect(mock.revealFragmentsCalls[1]).toEqual([keys[0]]);

    d2.resolve("val-2");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(3);
    expect(mock.revealFragmentsCalls[2]).toEqual([keys[1]]);

    // Natural never gates fallbacks.
    expect(mock.revealFallbacksCalls.length).toBe(0);
  });

  test("natural inside sequential: inner children are held behind outer frontier", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const dOuter1 = deferred<string>();
    const dInnerA = deferred<string>();
    const dInnerB = deferred<string>();
    const dOuter2 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          get children() {
            return [
              Loading({
                fallback: "outer-1-fb",
                get children() {
                  const data = createMemo(() => dOuter1.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }),
              Reveal({
                order: "natural",
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
              } as any),
              Loading({
                fallback: "outer-2-fb",
                get children() {
                  const data = createMemo(() => dOuter2.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              })
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    const keys = [...mock.registeredFragments.keys()];
    // keys: [outer-1, inner-a, inner-b, outer-2]

    // Inner fragments resolve before outer-1. Outer sequential holds the inner
    // natural group behind its frontier (outer-1), so nothing reveals yet.
    dInnerA.resolve("inner-a-val");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(0);

    dInnerB.resolve("inner-b-val");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(0);

    // Outer-2 resolves but is behind the frontier too.
    dOuter2.resolve("outer-2-val");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(0);

    // Outer-1 resolves — frontier advances past outer-1 and activates the inner
    // natural composite, which drains its stash [inner-a, inner-b], then past
    // outer-2.
    dOuter1.resolve("outer-1-val");
    await tick();
    const revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[0]); // outer-1
    expect(revealed).toContain(keys[1]); // inner-a (drained from stash)
    expect(revealed).toContain(keys[2]); // inner-b (drained from stash)
    expect(revealed).toContain(keys[3]); // outer-2
  });

  test("natural group acts as single composite slot to outer sequential frontier", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const dOuter1 = deferred<string>();
    const dInnerA = deferred<string>();
    const dInnerB = deferred<string>();
    const dOuter2 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          get children() {
            return [
              Loading({
                fallback: "outer-1-fb",
                get children() {
                  const data = createMemo(() => dOuter1.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }),
              Reveal({
                order: "natural",
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
              } as any),
              Loading({
                fallback: "outer-2-fb",
                get children() {
                  const data = createMemo(() => dOuter2.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              })
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    const keys = [...mock.registeredFragments.keys()];

    // Resolve outer-1 + outer-2, but only one inner. Outer-2 should still wait
    // because the natural composite isn't ready (inner-b is still pending).
    dOuter1.resolve("outer-1-val");
    dOuter2.resolve("outer-2-val");
    dInnerA.resolve("inner-a-val");
    await tick();

    const revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[0]); // outer-1 revealed
    expect(revealed).toContain(keys[1]); // inner-a revealed (natural, independent)
    expect(revealed).not.toContain(keys[2]); // inner-b still pending
    expect(revealed).not.toContain(keys[3]); // outer-2 must wait for composite

    // Resolve inner-b — natural group completes, notifies parent, outer-2 reveals.
    dInnerB.resolve("inner-b-val");
    await tick();
    const revealed2 = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed2).toContain(keys[2]);
    expect(revealed2).toContain(keys[3]);
  });

  test("natural mode ignores collapsed: never calls revealFallbacks", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const d1 = deferred<string>();
    const d2 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          // `collapsed` is disallowed on `order="natural"` at the type level,
          // but the runtime should still be defensive if called via `as any`.
          order: "natural",
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

    d2.resolve("val-2");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(1);
    expect(mock.revealFallbacksCalls.length).toBe(0);

    d1.resolve("val-1");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(2);
    expect(mock.revealFallbacksCalls.length).toBe(0);
  });

  test("together mode ignores collapsed flag", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const d1 = deferred<string>();
    const d2 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          order: "together",
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

  test("outer together + inner together: releases only when every descendant is ready", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const dA = deferred<string>();
    const dB = deferred<string>();
    const dC = deferred<string>();

    createRoot(
      () => {
        Reveal({
          order: "together",
          get children() {
            return [
              Loading({
                fallback: "a-fb",
                get children() {
                  const data = createMemo(() => dA.promise);
                  return ssr(["<span>", "</span>"], () => data()) as any;
                }
              }),
              Reveal({
                order: "together",
                get children() {
                  return [
                    Loading({
                      fallback: "b-fb",
                      get children() {
                        const data = createMemo(() => dB.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    }),
                    Loading({
                      fallback: "c-fb",
                      get children() {
                        const data = createMemo(() => dC.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    })
                  ] as any;
                }
              } as any)
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    const keys = [...mock.registeredFragments.keys()];

    // Inner together is minimally ready only when BOTH inner leaves resolve, so
    // nothing reveals until all three leaves settle.
    dA.resolve("a-val");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(0);

    dB.resolve("b-val");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(0);

    dC.resolve("c-val");
    await tick();
    // Single cohesive reveal across the whole subtree.
    const revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[0]); // a
    expect(revealed).toContain(keys[1]); // b
    expect(revealed).toContain(keys[2]); // c
  });

  test("outer together + inner sequential: releases at first-ready; tail still held", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const dA = deferred<string>();
    const dB = deferred<string>();
    const dC = deferred<string>();

    createRoot(
      () => {
        Reveal({
          order: "together",
          get children() {
            return [
              Loading({
                fallback: "a-fb",
                get children() {
                  const data = createMemo(() => dA.promise);
                  return ssr(["<span>", "</span>"], () => data()) as any;
                }
              }),
              Reveal({
                get children() {
                  return [
                    Loading({
                      fallback: "b-fb",
                      get children() {
                        const data = createMemo(() => dB.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    }),
                    Loading({
                      fallback: "c-fb",
                      get children() {
                        const data = createMemo(() => dC.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    })
                  ] as any;
                }
              } as any)
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    const keys = [...mock.registeredFragments.keys()];

    // Inner sequential is minimally ready when its frontier-0 (keys[1]) resolves.
    // The outer together still waits for direct child a.
    dB.resolve("b-val");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(0);

    // a resolves — now every direct slot of outer together is minimally ready;
    // outer together releases. Inner sequential flushes its frontier (b); c is
    // still pending and stays on its fallback under inner's own sequential order.
    dA.resolve("a-val");
    await tick();
    const revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[0]); // a
    expect(revealed).toContain(keys[1]); // b (inner frontier)
    expect(revealed).not.toContain(keys[2]); // c still held behind inner sequential

    // c resolves — inner advances and flushes it.
    dC.resolve("c-val");
    await tick();
    const revealed2 = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed2).toContain(keys[2]);
  });

  test("outer together + inner natural: releases when any inner child is ready", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const dA = deferred<string>();
    const dB = deferred<string>();
    const dC = deferred<string>();

    createRoot(
      () => {
        Reveal({
          order: "together",
          get children() {
            return [
              Loading({
                fallback: "a-fb",
                get children() {
                  const data = createMemo(() => dA.promise);
                  return ssr(["<span>", "</span>"], () => data()) as any;
                }
              }),
              Reveal({
                order: "natural",
                get children() {
                  return [
                    Loading({
                      fallback: "b-fb",
                      get children() {
                        const data = createMemo(() => dB.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    }),
                    Loading({
                      fallback: "c-fb",
                      get children() {
                        const data = createMemo(() => dC.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    })
                  ] as any;
                }
              } as any)
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    const keys = [...mock.registeredFragments.keys()];

    // Inner natural is minimally ready as soon as any child resolves.
    dB.resolve("b-val");
    await tick();
    // Still waiting on direct child a; nothing reveals yet.
    expect(mock.revealFragmentsCalls.length).toBe(0);

    // a resolves — every direct child of outer together is now minimally ready.
    // Outer together releases: a and b flush; c stays on fallback under inner
    // natural's per-slot reveal.
    dA.resolve("a-val");
    await tick();
    const revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[0]); // a
    expect(revealed).toContain(keys[1]); // b (inner natural's already-resolved child)
    expect(revealed).not.toContain(keys[2]); // c still pending

    // c resolves — inner natural reveals it immediately now that it's unheld.
    dC.resolve("c-val");
    await tick();
    const revealed2 = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed2).toContain(keys[2]);
  });

  test("sequential+collapsed outer uncollapses inner leaves on frontier advance", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const dOuter1 = deferred<string>();
    const dInnerA = deferred<string>();
    const dInnerB = deferred<string>();

    createRoot(
      () => {
        Reveal({
          collapsed: true,
          get children() {
            return [
              Loading({
                fallback: "outer-1-fb",
                get children() {
                  const data = createMemo(() => dOuter1.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }),
              Reveal({
                order: "natural",
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
              } as any)
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    const keys = [...mock.registeredFragments.keys()];
    // keys: [outer-1, inner-a, inner-b]

    // Nothing revealed yet; fallbacks for inner-a/inner-b were rendered as
    // collapsed templates because of outer's tail-collapse.
    expect(mock.revealFragmentsCalls.length).toBe(0);
    expect(mock.revealFallbacksCalls.length).toBe(0);

    // Outer-1 resolves → frontier advances to the inner composite. The inner
    // group is released to run its own order; its leaves were registered with
    // collapseFallback=true (tail-collapsed by outer), so activating the inner
    // must emit revealFallbacks for them to become visible.
    dOuter1.resolve("outer-1-val");
    await tick();
    const uncollapsed = mock.revealFallbacksCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(uncollapsed).toContain(keys[1]); // inner-a fallback now visible
    expect(uncollapsed).toContain(keys[2]); // inner-b fallback now visible

    // Outer-1 itself revealed.
    const revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[0]);
    expect(revealed).not.toContain(keys[1]);
    expect(revealed).not.toContain(keys[2]);

    // Inner leaves reveal independently per inner's natural policy as their
    // data lands.
    dInnerB.resolve("inner-b-val");
    await tick();
    const revealed2 = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed2).toContain(keys[2]);
    expect(revealed2).not.toContain(keys[1]);

    dInnerA.resolve("inner-a-val");
    await tick();
    const revealed3 = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed3).toContain(keys[1]);
  });

  test("outer sequential + inner sequential: inner runs its own frontier after outer reaches it", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const dA = deferred<string>();
    const dB1 = deferred<string>();
    const dB2 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          collapsed: false,
          get children() {
            return [
              Loading({
                fallback: "a-fb",
                get children() {
                  const data = createMemo(() => dA.promise);
                  return ssr(["<span>", "</span>"], () => data()) as any;
                }
              }),
              Reveal({
                collapsed: false,
                get children() {
                  return [
                    Loading({
                      fallback: "b1-fb",
                      get children() {
                        const data = createMemo(() => dB1.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    }),
                    Loading({
                      fallback: "b2-fb",
                      get children() {
                        const data = createMemo(() => dB2.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    })
                  ] as any;
                }
              } as any)
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    const keys = [...mock.registeredFragments.keys()];

    // Inner tail (b2) resolves first — outer hasn't reached the inner yet, and
    // inner sequential's own frontier is b1; nothing reveals.
    dB2.resolve("b2-val");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(0);

    // a resolves — outer advances frontier to the inner composite and activates
    // it. Inner sequential still waits on its own frontier (b1) before
    // revealing anything.
    dA.resolve("a-val");
    await tick();
    let revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[0]); // a
    expect(revealed).not.toContain(keys[1]); // b1 still pending
    expect(revealed).not.toContain(keys[2]); // b2 held behind inner frontier

    // b1 resolves — inner advances past b1 and, since b2 already resolved,
    // advances past b2 too.
    dB1.resolve("b1-val");
    await tick();
    revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[1]);
    expect(revealed).toContain(keys[2]);
  });

  test("outer sequential + inner together: inner stays atomic after outer reaches it", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const dA = deferred<string>();
    const dB1 = deferred<string>();
    const dB2 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          collapsed: false,
          get children() {
            return [
              Loading({
                fallback: "a-fb",
                get children() {
                  const data = createMemo(() => dA.promise);
                  return ssr(["<span>", "</span>"], () => data()) as any;
                }
              }),
              Reveal({
                order: "together",
                get children() {
                  return [
                    Loading({
                      fallback: "b1-fb",
                      get children() {
                        const data = createMemo(() => dB1.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    }),
                    Loading({
                      fallback: "b2-fb",
                      get children() {
                        const data = createMemo(() => dB2.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    })
                  ] as any;
                }
              } as any)
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    const keys = [...mock.registeredFragments.keys()];

    // a resolves first — outer advances and activates the inner together
    // composite. Inner together keeps holding both leaves until each resolves.
    dA.resolve("a-val");
    await tick();
    let revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[0]);
    expect(revealed).not.toContain(keys[1]);
    expect(revealed).not.toContain(keys[2]);

    // Partial inner resolution — still atomic, nothing new reveals.
    dB1.resolve("b1-val");
    await tick();
    revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).not.toContain(keys[1]);
    expect(revealed).not.toContain(keys[2]);

    // Both inner leaves ready — together releases them in one pass.
    dB2.resolve("b2-val");
    await tick();
    revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[1]);
    expect(revealed).toContain(keys[2]);
  });

  test("outer natural + inner sequential: inner runs its own frontier; outer leaf independent", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const dA = deferred<string>();
    const dB1 = deferred<string>();
    const dB2 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          order: "natural",
          get children() {
            return [
              Loading({
                fallback: "a-fb",
                get children() {
                  const data = createMemo(() => dA.promise);
                  return ssr(["<span>", "</span>"], () => data()) as any;
                }
              }),
              Reveal({
                collapsed: false,
                get children() {
                  return [
                    Loading({
                      fallback: "b1-fb",
                      get children() {
                        const data = createMemo(() => dB1.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    }),
                    Loading({
                      fallback: "b2-fb",
                      get children() {
                        const data = createMemo(() => dB2.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    })
                  ] as any;
                }
              } as any)
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    const keys = [...mock.registeredFragments.keys()];

    // Inner tail resolves first — inner sequential's frontier is still b1; no
    // inner reveal. Outer natural does not gate the leaf sibling on inner.
    dB2.resolve("b2-val");
    await tick();
    expect(mock.revealFragmentsCalls.length).toBe(0);

    // Outer leaf resolves independently under natural.
    dA.resolve("a-val");
    await tick();
    let revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[0]);
    expect(revealed).not.toContain(keys[1]);
    expect(revealed).not.toContain(keys[2]);

    // Inner frontier resolves — inner advances past b1 and b2 together (b2 was
    // already resolved).
    dB1.resolve("b1-val");
    await tick();
    revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[1]);
    expect(revealed).toContain(keys[2]);
  });

  test("outer natural + inner together: inner stays atomic; outer leaf independent", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const dA = deferred<string>();
    const dB1 = deferred<string>();
    const dB2 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          order: "natural",
          get children() {
            return [
              Loading({
                fallback: "a-fb",
                get children() {
                  const data = createMemo(() => dA.promise);
                  return ssr(["<span>", "</span>"], () => data()) as any;
                }
              }),
              Reveal({
                order: "together",
                get children() {
                  return [
                    Loading({
                      fallback: "b1-fb",
                      get children() {
                        const data = createMemo(() => dB1.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    }),
                    Loading({
                      fallback: "b2-fb",
                      get children() {
                        const data = createMemo(() => dB2.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    })
                  ] as any;
                }
              } as any)
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    const keys = [...mock.registeredFragments.keys()];

    // Outer leaf reveals independently under natural while inner together
    // holds both children.
    dA.resolve("a-val");
    await tick();
    let revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[0]);
    expect(revealed).not.toContain(keys[1]);
    expect(revealed).not.toContain(keys[2]);

    dB1.resolve("b1-val");
    await tick();
    revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).not.toContain(keys[1]);
    expect(revealed).not.toContain(keys[2]);

    // Inner fully ready — together releases atomically.
    dB2.resolve("b2-val");
    await tick();
    revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[1]);
    expect(revealed).toContain(keys[2]);
  });

  test("outer natural + inner natural: grandchildren reveal independently", async () => {
    const mock = createMockSSRContext({ async: true });
    sharedConfig.context = mock.context;

    const dA = deferred<string>();
    const dB1 = deferred<string>();
    const dB2 = deferred<string>();

    createRoot(
      () => {
        Reveal({
          order: "natural",
          get children() {
            return [
              Loading({
                fallback: "a-fb",
                get children() {
                  const data = createMemo(() => dA.promise);
                  return ssr(["<span>", "</span>"], () => data()) as any;
                }
              }),
              Reveal({
                order: "natural",
                get children() {
                  return [
                    Loading({
                      fallback: "b1-fb",
                      get children() {
                        const data = createMemo(() => dB1.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    }),
                    Loading({
                      fallback: "b2-fb",
                      get children() {
                        const data = createMemo(() => dB2.promise);
                        return ssr(["<span>", "</span>"], () => data()) as any;
                      }
                    })
                  ] as any;
                }
              } as any)
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    const keys = [...mock.registeredFragments.keys()];

    // Each leaf (grand-children or outer leaf) reveals on its own as it
    // resolves — natural all the way down.
    dB2.resolve("b2-val");
    await tick();
    let revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[2]);
    expect(revealed).not.toContain(keys[0]);
    expect(revealed).not.toContain(keys[1]);

    dA.resolve("a-val");
    await tick();
    revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[0]);
    expect(revealed).not.toContain(keys[1]);

    dB1.resolve("b1-val");
    await tick();
    revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
    expect(revealed).toContain(keys[1]);
  });
});
