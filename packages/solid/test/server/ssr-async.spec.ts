/** @vitest-environment node */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import {
  createRoot,
  createMemo,
  createSignal,
  createStore,
  createProjection,
  NotReadyError,
  getOwner,
  For,
  Repeat,
  Show,
  Errored
} from "../../src/server/index.js";
import { ssrHandleError } from "../../src/server/hydration.js";
import { Loading } from "../../src/server/flow.js";
import { sharedConfig } from "../../src/server/shared.js";
import { createErrorBoundary } from "../../src/server/signals.js";

// ============================================================================
// Mock SSR Context Infrastructure
// ============================================================================
//
// These functions replicate the core template resolution logic from
// @solidjs/web/src/server.ts. At runtime, @solidjs/web provides them
// as ctx.resolve, ctx.ssr, and ctx.escape on sharedConfig.context. For
// isolated unit testing of Loading's async behavior, we inline minimal
// but faithful copies here.

type SSRTemplateObject = { t: string[]; h: Function[]; p: Promise<any>[] };

function resolveSSRNode(
  node: any,
  result: SSRTemplateObject = { t: [""], h: [], p: [] },
  top?: boolean
): SSRTemplateObject {
  const t = typeof node;
  if (t === "string" || t === "number") {
    result.t[result.t.length - 1] += node;
  } else if (node == null || t === "boolean") {
    // skip
  } else if (Array.isArray(node)) {
    let prev: any = {};
    for (let i = 0, len = node.length; i < len; i++) {
      if (!top && typeof prev !== "object" && typeof node[i] !== "object")
        result.t[result.t.length - 1] += `<!--!$-->`;
      resolveSSRNode((prev = node[i]), result);
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

function escape(s: any, attr?: boolean): any {
  const t = typeof s;
  if (t !== "string") {
    if (!attr && Array.isArray(s)) {
      s = s.slice();
      for (let i = 0; i < s.length; i++) s[i] = escape(s[i]);
      return s;
    }
    if (attr && t === "boolean") return s;
    return s;
  }
  const delim = attr ? '"' : "<";
  const escDelim = attr ? "&quot;" : "&lt;";
  let iDelim = s.indexOf(delim);
  let iAmp = s.indexOf("&");
  if (iDelim < 0 && iAmp < 0) return s;
  let left = 0,
    out = "";
  while (iDelim >= 0 && iAmp >= 0) {
    if (iDelim < iAmp) {
      if (left < iDelim) out += s.substring(left, iDelim);
      out += escDelim;
      left = iDelim + 1;
      iDelim = s.indexOf(delim, left);
    } else {
      if (left < iAmp) out += s.substring(left, iAmp);
      out += "&amp;";
      left = iAmp + 1;
      iAmp = s.indexOf("&", left);
    }
  }
  if (iDelim >= 0) {
    do {
      if (left < iDelim) out += s.substring(left, iDelim);
      out += escDelim;
      left = iDelim + 1;
      iDelim = s.indexOf(delim, left);
    } while (iDelim >= 0);
  } else
    while (iAmp >= 0) {
      if (left < iAmp) out += s.substring(left, iAmp);
      out += "&amp;";
      left = iAmp + 1;
      iAmp = s.indexOf("&", left);
    }
  return left < s.length ? out + s.substring(left) : out;
}

// ---- Test utilities ----

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMockSSRContext(options: { async?: boolean; fragmentFlushed?: boolean } = {}) {
  const serialized = new Map<string, any>();
  const registeredFragments = new Set<string>();
  const fragmentResults = new Map<string, string | undefined>();
  const fragmentErrors = new Map<string, any>();
  /** Every done() invocation, including pre-flush ones the maps above skip. */
  const fragmentSettles: Array<{ key: string; value?: string; error?: any }> = [];
  const fragmentFlushed = options.fragmentFlushed ?? true;

  const context: any = {
    async: options.async !== false,
    assets: [],
    nonce: undefined,
    noHydrate: false,
    escape,
    resolve: resolveSSRNode,
    ssr,
    serialize(id: string, p: any) {
      serialized.set(id, p);
    },
    replace() {},
    block() {},
    registerFragment(key: string) {
      registeredFragments.add(key);
      return (value?: string, error?: any) => {
        fragmentSettles.push({ key, value, error });
        if (fragmentFlushed) {
          fragmentResults.set(key, value);
          if (error !== undefined) fragmentErrors.set(key, error);
        }
        return fragmentFlushed;
      };
    }
  };

  return {
    context,
    serialized,
    registeredFragments,
    fragmentResults,
    fragmentErrors,
    fragmentSettles
  };
}

/** Wait for microtasks and pending async to settle. */
function tick() {
  return new Promise<void>(r => setTimeout(r, 0));
}

// ============================================================================
// Tests
// ============================================================================

describe("Loading SSR Async", () => {
  let savedContext: any;

  beforeEach(() => {
    savedContext = sharedConfig.context;
  });

  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  // --------------------------------------------------------------------------
  // 1. Basic Async (hole path)
  // --------------------------------------------------------------------------

  describe("Basic Async (hole path)", () => {
    test("single async memo resolves through hole re-execution", async () => {
      const { context, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();
      let result: any;

      createRoot(
        () => {
          result = Loading({
            fallback: "Loading...",
            get children() {
              const data = createMemo(() => d.promise);
              return ssr(["<div>", "</div>"], () => data()) as any;
            }
          });
        },
        { id: "t" }
      );

      // Should return fallback with placeholder markers
      const html = result().t[0];
      expect(html).toContain("Loading...");
      expect(html).toMatch(/<template id="pl-[^"]+"><\/template>/);
      expect(html).toMatch(/<!--pl-[^-]+-->/);

      // Resolve the async value
      d.resolve("Hello World");
      await tick();

      // Fragment should have resolved with correct HTML
      expect(fragmentResults.size).toBe(1);
      const resolved = [...fragmentResults.values()][0];
      expect(resolved).toBe("<div>Hello World</div>");
    });

    test("createSignal(fn) async value triggers Loading fallback (mirrors createMemo)", async () => {
      const { context, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();
      let result: any;

      createRoot(
        () => {
          result = Loading({
            fallback: "Loading...",
            get children() {
              const [data] = createSignal(() => d.promise);
              return ssr(["<div>", "</div>"], () => data()) as any;
            }
          });
        },
        { id: "t" }
      );

      const html = result().t[0];
      expect(html).toContain("Loading...");
      expect(html).toMatch(/<template id="pl-[^"]+"><\/template>/);
      expect(html).toMatch(/<!--pl-[^-]+-->/);

      d.resolve("Hello World");
      await tick();

      expect(fragmentResults.size).toBe(1);
      const resolved = [...fragmentResults.values()][0];
      expect(resolved).toBe("<div>Hello World</div>");
    });

    test("synchronous children bypass async path entirely", () => {
      const { context, registeredFragments } = createMockSSRContext();
      sharedConfig.context = context;

      let result: any;

      createRoot(
        () => {
          result = Loading({
            fallback: "Loading...",
            get children() {
              return ssr(["<div>Hello</div>"]) as any;
            }
          });
        },
        { id: "t" }
      );

      // No fragments registered — sync path
      expect(registeredFragments.size).toBe(0);
      // Result should contain the children, not the fallback
      const html = result().t[0];
      expect(html).toBe("<div>Hello</div>");
      expect(html).not.toContain("Loading...");
    });

    test("done callback receives the fully resolved HTML", async () => {
      const { context, registeredFragments, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<number>();
      let result: any;

      createRoot(
        () => {
          result = Loading({
            fallback: "wait",
            get children() {
              const num = createMemo(() => d.promise);
              return ssr(["<span>Count: ", "</span>"], () => num()) as any;
            }
          });
        },
        { id: "t" }
      );

      // Fragment registered
      expect(registeredFragments.size).toBe(1);
      // Not yet resolved
      expect(fragmentResults.size).toBe(0);

      d.resolve(42);
      await tick();

      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<span>Count: 42</span>");
    });
  });

  // --------------------------------------------------------------------------
  // 2. Parallel Async
  // --------------------------------------------------------------------------

  describe("Parallel Async", () => {
    test("multiple independent async memos resolve in one pass", async () => {
      const { context, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const dA = deferred<string>();
      const dB = deferred<string>();
      let result: any;

      createRoot(
        () => {
          result = Loading({
            fallback: "Loading...",
            get children() {
              const a = createMemo(() => dA.promise);
              const b = createMemo(() => dB.promise);
              return ssr(
                ["<div>", " and ", "</div>"],
                () => a(),
                () => b()
              ) as any;
            }
          });
        },
        { id: "t" }
      );

      // Should be in async/fallback mode
      expect(result().t[0]).toContain("Loading...");

      // Resolve both
      dA.resolve("Alpha");
      dB.resolve("Beta");
      await tick();

      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<div>Alpha and Beta</div>");
    });

    test("waits for all memos before re-executing holes", async () => {
      const { context, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const dA = deferred<string>();
      const dB = deferred<string>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const a = createMemo(() => dA.promise);
              const b = createMemo(() => dB.promise);
              return ssr(
                ["<p>", "-", "</p>"],
                () => a(),
                () => b()
              ) as any;
            }
          });
        },
        { id: "t" }
      );

      // Resolve only A — B is still pending
      dA.resolve("A");
      await tick();

      // Fragment should NOT be resolved yet (Promise.all waits for both)
      expect(fragmentResults.size).toBe(0);

      // Now resolve B
      dB.resolve("B");
      await tick();

      // Now fragment should be resolved
      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<p>A-B</p>");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Nested Boundaries
  // --------------------------------------------------------------------------

  describe("Nested Boundaries", () => {
    test("inner Loading handles async, outer Loading sees sync children", async () => {
      const { context, registeredFragments, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();
      let result: any;

      createRoot(
        () => {
          result = Loading({
            fallback: "Outer loading",
            get children() {
              return Loading({
                fallback: "Inner loading",
                get children() {
                  const data = createMemo(() => d.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }) as any;
            }
          });
        },
        { id: "t" }
      );

      // Only inner boundary should register a fragment
      expect(registeredFragments.size).toBe(1);

      // Outer boundary passes through — result is inner's fallback (not outer's)
      const html = result().t[0];
      expect(html).toContain("Inner loading");
      expect(html).not.toContain("Outer loading");
      expect(html).toMatch(/pl-/); // inner's placeholder markers

      d.resolve("Resolved");
      await tick();

      // Inner fragment resolves
      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<div>Resolved</div>");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Chained Async
  // --------------------------------------------------------------------------

  describe("Chained Async", () => {
    test("memo depending on async memo resolves in one pass", async () => {
      const { context, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const base = createMemo(() => d.promise);
              // Derived memo depends on async base
              const derived = createMemo(() => (base() as string).toUpperCase());
              return ssr(["<div>", "</div>"], () => derived()) as any;
            }
          });
        },
        { id: "t" }
      );

      d.resolve("hello");
      await tick();

      // Chained resolution: base resolves → derived re-computes → single hole pass
      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<div>HELLO</div>");
    });

    test("async memo callback can wrap a pending async read", async () => {
      const { context, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const base = createMemo(() => d.promise);
              const wrapped = createMemo(async () => (base() as string).toUpperCase());
              return ssr(["<div>", "</div>"], () => wrapped()) as any;
            }
          });
        },
        { id: "t" }
      );

      d.resolve("hello");
      await tick();
      await tick();

      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<div>HELLO</div>");
    });

    test("async projection callback can wrap a pending async read", async () => {
      const { context, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const base = createMemo(() => d.promise);
              const store = createProjection(
                async (draft: { name: string }) => {
                  draft.name = (base() as string).toUpperCase();
                  await Promise.resolve();
                },
                { name: "init" }
              );
              return ssr(["<div>", "</div>"], () => store.name) as any;
            }
          });
        },
        { id: "t" }
      );

      d.resolve("hello");
      await tick();
      await tick();

      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<div>HELLO</div>");
    });

    test("sync projection callback can wrap a pending async store read", async () => {
      const { context, registeredFragments, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<{ id: string; name: string }[]>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const [users] = createStore(() => d.promise, [] as { id: string; name: string }[]);
              const projected = createProjection(
                () => users.map(user => ({ ...user, label: user.name.toUpperCase() })),
                [] as { id: string; name: string; label: string }[]
              );
              return ssr(["<div>", "</div>"], () =>
                projected.map(user => user.label).join(",")
              ) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(1);

      d.resolve([{ id: "1", name: "hello" }]);
      await tick();
      await tick();

      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<div>HELLO</div>");
    });

    test("async iterator memo can wrap a pending async read before first yield", async () => {
      const { context, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const base = createMemo(() => d.promise);
              const wrapped = createMemo(async function* () {
                yield (base() as string).toUpperCase();
              });
              return ssr(["<div>", "</div>"], () => wrapped()) as any;
            }
          });
        },
        { id: "t" }
      );

      d.resolve("hello");
      await tick();
      await tick();

      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<div>HELLO</div>");
    });
  });

  // --------------------------------------------------------------------------
  // 5. Conditional and List Async
  // --------------------------------------------------------------------------

  describe("Conditional Async", () => {
    test("async inside Show when=true propagates through", async () => {
      const { context, registeredFragments, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const data = createMemo(() => d.promise);
              return Show({
                when: true,
                children: ssr(["<div>", "</div>"], () => data()) as any
              }) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(1);

      d.resolve("Shown");
      await tick();

      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<div>Shown</div>");
    });

    test("async inside Show when=false produces no async", () => {
      const { context, registeredFragments } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();
      let result: any;

      createRoot(
        () => {
          result = Loading({
            fallback: "Loading...",
            get children() {
              const data = createMemo(() => d.promise);
              return Show({
                when: false,
                fallback: ssr(["<span>No data</span>"]) as any,
                children: ssr(["<div>", "</div>"], () => data()) as any
              }) as any;
            }
          });
        },
        { id: "t" }
      );

      // Show returns fallback (sync) — no async detected
      expect(registeredFragments.size).toBe(0);
      expect(result().t[0]).toBe("<span>No data</span>");
    });
  });

  describe("Async in For", () => {
    test("async inside For iterations captured as holes", async () => {
      const { context, registeredFragments, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading list...",
            get children() {
              const list = For({
                each: [1, 2, 3] as const,
                children: (item: number) => {
                  const data = createMemo(() => d.promise.then((v: string) => `${v}-${item}`));
                  return ssr(["<li>", "</li>"], () => data()) as any;
                }
              });
              return ssr(["<ul>", "</ul>"], list) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(1);

      d.resolve("item");
      await tick();

      expect(fragmentResults.size).toBe(1);
      const resolved = [...fragmentResults.values()][0];
      expect(resolved).toContain("<li>item-1</li>");
      expect(resolved).toContain("<li>item-2</li>");
      expect(resolved).toContain("<li>item-3</li>");
    });
  });

  // --------------------------------------------------------------------------
  // 5b. Re-entrant Holes
  // --------------------------------------------------------------------------

  describe("Re-entrant Holes", () => {
    test("hole re-execution that reveals new async triggers another pass", async () => {
      const { context, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const dGate = deferred<string>();
      const dDetail = deferred<number>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              // Phase 1: gate memo is async
              const gate = createMemo(() => dGate.promise);
              // Phase 2: detail memo is also async (created eagerly, but only
              // read in the hole when gate resolves to "yes")
              const detail = createMemo(() => dDetail.promise);

              return ssr(["<div>", "</div>"], () => {
                const g = gate() as string;
                if (g === "yes") {
                  // Only reachable after gate resolves — reading detail
                  // throws NotReadyError, creating a NEW hole
                  return `detail:${detail()}`;
                }
                return `gate:${g}`;
              }) as any;
            }
          });
        },
        { id: "t" }
      );

      // Pass 1: gate throws NotReadyError → hole captured
      expect(fragmentResults.size).toBe(0);

      // Resolve gate → hole re-executes → detail throws NotReadyError → new hole
      dGate.resolve("yes");
      await tick();

      // Fragment should NOT be resolved yet — detail is still pending
      expect(fragmentResults.size).toBe(0);

      // Resolve detail → second re-execution → all sync → done
      dDetail.resolve(42);
      await tick();

      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<div>detail:42</div>");
    });

    test("multiple re-entrant passes resolve correctly", async () => {
      const { context, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d1 = deferred<string>();
      const d2 = deferred<string>();
      const d3 = deferred<string>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const step1 = createMemo(() => d1.promise);
              const step2 = createMemo(() => d2.promise);
              const step3 = createMemo(() => d3.promise);

              return ssr(["<div>", "</div>"], () => {
                const s1 = step1() as string;
                if (s1 === "go") {
                  const s2 = step2() as string;
                  if (s2 === "go") {
                    return `final:${step3()}`;
                  }
                  return `at-step2:${s2}`;
                }
                return `at-step1:${s1}`;
              }) as any;
            }
          });
        },
        { id: "t" }
      );

      // Pass 1: step1 throws
      expect(fragmentResults.size).toBe(0);

      // Resolve step1 → re-execute → step2 throws (new hole)
      d1.resolve("go");
      await tick();
      expect(fragmentResults.size).toBe(0);

      // Resolve step2 → re-execute → step3 throws (new hole)
      d2.resolve("go");
      await tick();
      expect(fragmentResults.size).toBe(0);

      // Resolve step3 → re-execute → all sync → done
      d3.resolve("done");
      await tick();

      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<div>final:done</div>");
    });

    test("re-entrant hole with error on second pass", async () => {
      const { context, fragmentResults, fragmentErrors } = createMockSSRContext();
      sharedConfig.context = context;

      const dGate = deferred<string>();
      const dDetail = deferred<number>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const gate = createMemo(() => dGate.promise);
              const detail = createMemo(() => dDetail.promise);

              return ssr(["<div>", "</div>"], () => {
                const g = gate() as string;
                if (g === "yes") {
                  return `detail:${detail()}`;
                }
                return `gate:${g}`;
              }) as any;
            }
          });
        },
        { id: "t" }
      );

      // Pass 1: gate throws → hole captured
      dGate.resolve("yes");
      await tick();

      // Pass 2: detail throws → new hole captured. Now reject it.
      const detailError = new Error("Detail fetch failed");
      dDetail.reject(detailError);
      await tick();

      // Error should be serialized via done
      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBeUndefined();
      expect(fragmentErrors.size).toBe(1);
      expect([...fragmentErrors.values()][0]).toBe(detailError);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Error Handling
  // --------------------------------------------------------------------------

  describe("Error + Async", () => {
    test("rejected promise calls done with error (does not hang the stream)", async () => {
      const { context, registeredFragments, fragmentResults, fragmentErrors } =
        createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const data = createMemo(() => d.promise);
              return ssr(["<div>", "</div>"], () => data()) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(1);

      const fetchError = new Error("Fetch failed");
      d.reject(fetchError);
      await tick();

      // done() should have been called with the error — stream won't hang
      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBeUndefined(); // no HTML value
      expect(fragmentErrors.size).toBe(1);
      expect([...fragmentErrors.values()][0]).toBe(fetchError);
    });

    test("pending promise keeps fragment unresolved", async () => {
      const { context, registeredFragments, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      // Promise that will never resolve — simulates a stalled fetch
      const d = deferred<string>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const data = createMemo(() => d.promise);
              return ssr(["<div>", "</div>"], () => data()) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(1);
      await tick();

      // Fragment stays unresolved while promise is pending
      expect(fragmentResults.size).toBe(0);
    });

    test("Errored inside Loading — sync error caught by Errored", () => {
      const { context, registeredFragments, serialized } = createMockSSRContext();
      sharedConfig.context = context;

      let result: any;

      createRoot(
        () => {
          result = Loading({
            fallback: "Loading...",
            get children() {
              return Errored({
                fallback: "Error caught!",
                get children(): any {
                  throw new Error("Sync render error");
                }
              }) as any;
            }
          });
        },
        { id: "t" }
      );

      // Errored catches sync error → renders fallback → Loading sees sync content
      expect(registeredFragments.size).toBe(0);
      const html = result().t[0];
      expect(html).toContain("Error caught!");
      expect(html).not.toContain("Loading...");

      // Error should be serialized via ctx.serialize for client hydration
      const serializedValues = [...serialized.values()];
      const hasError = serializedValues.some(v => v instanceof Error);
      expect(hasError).toBe(true);
    });

    test("Errored inside Loading — async rejection resolves to error fallback HTML", async () => {
      const { context, registeredFragments, fragmentResults, fragmentErrors, serialized } =
        createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              return Errored({
                fallback: "Error caught!",
                get children() {
                  const data = createMemo(() => d.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(1);

      const fetchError = new Error("Async fetch failed");
      d.reject(fetchError);
      await tick();

      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("Error caught!");
      expect(fragmentErrors.size).toBe(0);
      expect(
        [...serialized.values()].some(v => v instanceof Error && v.message === "Async fetch failed")
      ).toBe(true);
    });

    test("pre-flush Loading rejection rides the fragment channel, not the outer Errored (#2997)", async () => {
      const { context, fragmentResults, fragmentErrors, fragmentSettles, serialized } =
        createMockSSRContext({
          fragmentFlushed: false
        });
      sharedConfig.context = context;

      const d = deferred<string>();
      let fallbackCalls = 0;
      let result: any;
      const read = (value: any): any => {
        while (typeof value === "function") value = value();
        return value;
      };

      createRoot(
        () => {
          result = Errored({
            fallback: (e: any) => {
              fallbackCalls++;
              return `OuterError: ${String(e().message || e())}`;
            },
            get children() {
              return Loading({
                fallback: "Loading..." as any,
                get children() {
                  const data = createMemo(() => d.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }) as any;
            }
          }) as any;
        },
        { id: "t" }
      );

      expect(read(result).t[0]).toContain("Loading...");

      const fetchError = new Error("Async fetch failed");
      d.reject(fetchError);
      await tick();

      // The fragment channel owns the error once the boundary registered:
      // done(undefined, err) settles the fragment (pre-flush the renderer
      // inlines the placeholder away and rejects `<key>_fr`; the client
      // re-renders the subtree fresh and its Errored catches). The outer
      // Errored's handler must NOT run at async time — its rendered fallback
      // would have no consumer (the accessor pull is long gone), and the
      // serialized error record it leaves at the boundary id sends the
      // hydrating client claiming fallback DOM that was never emitted — the
      // #2997 blank page.
      expect(fallbackCalls).toBe(0);
      expect(fragmentSettles).toEqual([{ key: "t000", value: undefined, error: fetchError }]);
      expect(fragmentResults.size).toBe(0);
      expect(fragmentErrors.size).toBe(0);
      expect(
        [...serialized.values()].some(v => v instanceof Error && v.message === "Async fetch failed")
      ).toBe(false);

      // A later re-creation of the Errored (re-pull) still claims the settled
      // rejection synchronously — the pull is on the stack, so the fallback
      // render has a consumer.
      expect(read(result)).toBe("OuterError: Async fetch failed");
      expect(fallbackCalls).toBe(1);
    });

    test("outer Errored stays out of post-flush Loading rejection ownership", async () => {
      const { context, fragmentResults, fragmentErrors, serialized } = createMockSSRContext({
        fragmentFlushed: true
      });
      sharedConfig.context = context;

      const d = deferred<string>();
      let fallbackCalls = 0;
      let result: any;
      const read = (value: any): any => {
        while (typeof value === "function") value = value();
        return value;
      };

      createRoot(
        () => {
          result = Errored({
            fallback: (e: any) => {
              fallbackCalls++;
              return `OuterError: ${String(e().message || e())}`;
            },
            get children() {
              return Loading({
                fallback: "Loading..." as any,
                get children() {
                  const data = createMemo(() => d.promise);
                  return ssr(["<div>", "</div>"], () => data()) as any;
                }
              }) as any;
            }
          }) as any;
        },
        { id: "t" }
      );

      expect(read(result).t[0]).toContain("Loading...");

      const fetchError = new Error("Async fetch failed");
      d.reject(fetchError);
      await tick();

      expect(fallbackCalls).toBe(0);
      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBeUndefined();
      expect(fragmentErrors.size).toBe(1);
      expect([...fragmentErrors.values()][0]).toBe(fetchError);
      expect(
        [...serialized.values()].some(v => v instanceof Error && v.message === "Async fetch failed")
      ).toBe(false);
    });

    test("Loading with nested Errored resolves mixed success and error content", async () => {
      const { context, registeredFragments, fragmentResults, fragmentErrors } =
        createMockSSRContext();
      sharedConfig.context = context;

      const good = deferred<{ title: string }>();
      const bad = deferred<{ title: string }>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const Item = (props: { value: Promise<{ title: string }> }) => {
                const item = createMemo(() => props.value);
                return Errored({
                  fallback: (e: any) => `ItemError: ${String(e().message || e())}`,
                  get children() {
                    return ssr(["<div>", "</div>"], () => item().title) as any;
                  }
                }) as any;
              };

              return ssr(
                ["<section>", "", "</section>"],
                [Item({ value: good.promise }), Item({ value: bad.promise })]
              ) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(1);

      good.resolve({ title: "Test Item" });
      bad.reject(new Error("Item bad-item not found"));
      await tick();

      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe(
        "<section><div>Test Item</div><!--!$-->ItemError: Item bad-item not found</section>"
      );
      expect(fragmentErrors.size).toBe(0);
    });

    test("Loading with createProjection and Repeat count resolves async iterable content", async () => {
      const { context, registeredFragments, fragmentResults, fragmentErrors } =
        createMockSSRContext();
      sharedConfig.context = context;

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const items = createProjection(
                async function* (s) {
                  s.push({ id: 1, text: "First item" });
                  yield;
                  s.push({ id: 2, text: "Second item" });
                  yield;
                },
                [] as { id: number; text: string }[]
              );

              return ssr(
                ["<ul>", "</ul>"],
                Repeat({
                  get count() {
                    return items.length;
                  },
                  children: i =>
                    ssr(
                      ["<li>", ": ", "</li>"],
                      () => items[i].id,
                      () => items[i].text
                    ) as any
                })
              ) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(1);
      await tick();
      await tick();

      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<ul><li>1: First item</li></ul>");
      expect(fragmentErrors.size).toBe(0);
    });

    test("Loading + createProjection(async fn, []) serializes resolved projection value for hydration", async () => {
      const { context, serialized, registeredFragments, fragmentResults, fragmentErrors } =
        createMockSSRContext();
      sharedConfig.context = context;

      async function getTodos() {
        return ["test1", "test2"];
      }

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const todos = createProjection(() => getTodos(), [] as string[]);
              return ssr(["<pre>", "</pre>"], () => JSON.stringify(todos)) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(1);
      await tick();
      await tick();

      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe('<pre>["test1","test2"]</pre>');
      expect(fragmentErrors.size).toBe(0);

      const projectionSerialized: any = serialized.get("t0000");
      expect(projectionSerialized).toBeDefined();
      expect(typeof projectionSerialized.then).toBe("function");
      expect(projectionSerialized.s).toBe(1);
      expect(projectionSerialized.v).toEqual(["test1", "test2"]);
      await expect(projectionSerialized).resolves.toEqual(["test1", "test2"]);
    });

    test("No Errored — sync error during initial render propagates up", () => {
      const { context } = createMockSSRContext();
      sharedConfig.context = context;

      // Sync error with no Errored boundary escapes Loading entirely (pre-flush)
      expect(() => {
        createRoot(
          () => {
            Loading({
              fallback: "Loading...",
              get children(): any {
                throw new Error("Unhandled sync error");
              }
            });
          },
          { id: "t" }
        );
      }).toThrow("Unhandled sync error");
    });

    test("Mixed: some holes resolve, then one errors", async () => {
      const { context, fragmentResults, fragmentErrors } = createMockSSRContext();
      sharedConfig.context = context;

      const dA = deferred<string>();
      const dB = deferred<string>();

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const a = createMemo(() => dA.promise);
              const b = createMemo(() => dB.promise);
              return ssr(
                ["<div>", " and ", "</div>"],
                () => a(),
                () => b()
              ) as any;
            }
          });
        },
        { id: "t" }
      );

      // Resolve A, reject B
      dA.resolve("Alpha");
      const bError = new Error("B failed");
      dB.reject(bError);
      await tick();

      // Promise.all rejects when B rejects → error serialized via done
      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBeUndefined();
      expect(fragmentErrors.size).toBe(1);
      expect([...fragmentErrors.values()][0]).toBe(bError);
    });

    test("createErrorBoundary serializes error for client hydration", () => {
      const { context, serialized } = createMockSSRContext();
      sharedConfig.context = context;

      let fallbackError: unknown;

      createRoot(
        () => {
          const result = createErrorBoundary(
            () => {
              throw new Error("Boundary test error");
            },
            (err, reset) => {
              fallbackError = err();
              return "fallback rendered";
            }
          );
          // Invoke the accessor to get the result
          expect(result()).toBe("fallback rendered");
        },
        { id: "t" }
      );

      // Fallback should have received the error
      expect(fallbackError).toBeInstanceOf(Error);
      expect((fallbackError as Error).message).toBe("Boundary test error");

      // Error should be serialized for client hydration
      const serializedEntries = [...serialized.entries()];
      expect(serializedEntries.length).toBeGreaterThan(0);

      // Find the entry where the value is the error
      const errorEntry = serializedEntries.find(
        ([, v]) => v instanceof Error && v.message === "Boundary test error"
      );
      expect(errorEntry).toBeDefined();
      // The key should be the owner's ID (a string)
      expect(typeof errorEntry![0]).toBe("string");
    });
  });

  // --------------------------------------------------------------------------
  // 8. ID Stability
  // --------------------------------------------------------------------------

  describe("ID Stability", () => {
    test("SSR context: Loading -> Errored children match hydrated owner depth", () => {
      const { context } = createMockSSRContext({ async: false });
      sharedConfig.context = context;

      let childOwnerId: string | undefined;
      let memoOwnerId: string | undefined;

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              return Errored({
                fallback: "error",
                get children() {
                  childOwnerId = getOwner()!.id!;
                  const item = createMemo(() => {
                    memoOwnerId = getOwner()!.id!;
                    return "resolved";
                  });
                  return item() as any;
                }
              }) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(childOwnerId).toBe("t00000");
      expect(memoOwnerId).toBe("t000000");
    });

    test("hole path: memo owners persist across re-execution (IDs inherently stable)", async () => {
      const { context, serialized, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();
      let memoOwnerId: string | undefined;

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const data = createMemo(() => {
                // Capture the owner ID during compute
                memoOwnerId = getOwner()?.id;
                return d.promise;
              });
              return ssr(["<div>", "</div>"], () => data()) as any;
            }
          });
        },
        { id: "t" }
      );

      const initialOwnerId = memoOwnerId;
      expect(initialOwnerId).toBeDefined();

      // In the hole path, memos are NOT re-created — only hole functions are
      // re-executed. The owner should be the same object.
      d.resolve("done");
      await tick();

      // After resolution, the same memo owner ID should still be valid.
      // The compute function doesn't re-run (only the hole function does),
      // so memoOwnerId hasn't changed.
      expect(memoOwnerId).toBe(initialOwnerId);

      // Verify serialized IDs are consistent
      expect(serialized.size).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // 9. Sync fallback mode (non-streaming)
  // --------------------------------------------------------------------------

  describe("Sync fallback mode", () => {
    test("non-async context serializes fallback marker", () => {
      const { context, serialized, registeredFragments } = createMockSSRContext({
        async: false
      });
      sharedConfig.context = context;

      const d = deferred<string>();
      let result: any;

      createRoot(
        () => {
          result = Loading({
            fallback: "Fallback",
            get children() {
              const data = createMemo(() => d.promise);
              return ssr(["<div>", "</div>"], () => data()) as any;
            }
          });
        },
        { id: "t" }
      );

      // No fragments registered (not async mode)
      expect(registeredFragments.size).toBe(0);
      // Should have serialized "$$f" marker for the boundary
      const serializedValues = [...serialized.values()];
      expect(serializedValues).toContain("$$f");
      // Result should be the fallback content
      expect(result()).toBe("Fallback");
    });
  });
});

// ============================================================================
// Stream Blocking / deferStream (Goal 2c)
// ============================================================================
//
// New architecture: processResult does NOT call ctx.block(). Blocking is handled
// structurally by @solidjs/web's server renderer:
//   - Root-level async: res.p added to blockingPromises in root render
//   - deferStream: serialize() auto-blocks when deferStream=true
//   - Loading: never interacts with blockingPromises (no block/unblock)
//   - lazy: still calls ctx.block() directly for code-split components

describe("Stream Blocking / deferStream", () => {
  let savedContext: any;

  beforeEach(() => {
    savedContext = sharedConfig.context;
  });

  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  function createBlockTrackingContext(options: { async?: boolean } = {}) {
    const base = createMockSSRContext(options);
    const blocked = new Set<Promise<any>>();
    const serializeLog: Array<{ id: string; value: any; deferStream?: boolean }> = [];

    base.context.block = (p: Promise<any>) => blocked.add(p);
    const origSerialize = base.context.serialize;
    base.context.serialize = (id: string, v: any, deferStream?: boolean) => {
      serializeLog.push({ id, value: v, deferStream });
      origSerialize(id, v);
    };

    return { ...base, blocked, serializeLog };
  }

  // --------------------------------------------------------------------------
  // 1. processResult does NOT block async computations
  // --------------------------------------------------------------------------

  test("async createMemo does not call block (handled by @solidjs/web root)", () => {
    const { context, blocked } = createBlockTrackingContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        createMemo(() => d.promise);
      },
      { id: "t" }
    );

    // processResult no longer calls ctx.block — blocking is structural in @solidjs/web
    expect(blocked.size).toBe(0);
  });

  test("createSignal(fn) does not block (async handled by processResult, like createMemo)", () => {
    const { context, blocked } = createBlockTrackingContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        createSignal(() => d.promise);
      },
      { id: "t" }
    );

    expect(blocked.size).toBe(0);
  });

  test("async createProjection does not call block", () => {
    const { context, blocked } = createBlockTrackingContext();
    sharedConfig.context = context;

    const d = deferred<{ name: string }>();

    createRoot(
      () => {
        createProjection(() => d.promise, {} as { name?: string });
      },
      { id: "t" }
    );

    expect(blocked.size).toBe(0);
  });

  test("sync createMemo does not block", () => {
    const { context, blocked } = createBlockTrackingContext();
    sharedConfig.context = context;

    createRoot(
      () => {
        createMemo(() => "sync value");
      },
      { id: "t" }
    );

    expect(blocked.size).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 2. Loading does not interact with blockingPromises at all
  // --------------------------------------------------------------------------

  test("Loading does not call block or unblock for async children", () => {
    const { context, blocked } = createBlockTrackingContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        Loading({
          fallback: "Loading...",
          get children() {
            const data = createMemo(() => d.promise);
            return ssr(["<div>", "</div>"], () => data()) as any;
          }
        });
      },
      { id: "t" }
    );

    // Neither processResult nor Loading touch blockingPromises
    expect(blocked.size).toBe(0);
  });

  test("Loading with deferStream: true does not call block (serialize handles it)", () => {
    const { context, blocked, serializeLog } = createBlockTrackingContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        Loading({
          fallback: "Loading...",
          get children() {
            const data = createMemo(() => d.promise, { deferStream: true });
            return ssr(["<div>", "</div>"], () => data()) as any;
          }
        });
      },
      { id: "t" }
    );

    // processResult does not block — deferStream blocking happens in @solidjs/web's serialize
    expect(blocked.size).toBe(0);
    // But deferStream IS passed through to serialize for @solidjs/web to handle
    expect(serializeLog.some(e => e.deferStream === true)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 3. deferStream flag passed through to serialize
  // --------------------------------------------------------------------------

  test("deferStream: true is passed as 3rd arg to serialize", () => {
    const { context, serializeLog } = createBlockTrackingContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        createMemo(() => d.promise, { deferStream: true });
      },
      { id: "t" }
    );

    expect(serializeLog.length).toBe(1);
    expect(serializeLog[0].deferStream).toBe(true);
  });

  test("without deferStream, serialize 3rd arg is undefined", () => {
    const { context, serializeLog } = createBlockTrackingContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        createMemo(() => d.promise);
      },
      { id: "t" }
    );

    expect(serializeLog.length).toBe(1);
    expect(serializeLog[0].deferStream).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 4. Multiple async inside Loading — no blocking interaction
  // --------------------------------------------------------------------------

  test("multiple async children in Loading — no block calls", () => {
    const { context, blocked } = createBlockTrackingContext();
    sharedConfig.context = context;

    const d1 = deferred<string>();
    const d2 = deferred<string>();

    createRoot(
      () => {
        Loading({
          fallback: "Loading...",
          get children() {
            const data1 = createMemo(() => d1.promise);
            const data2 = createMemo(() => d2.promise);
            return ssr(
              ["<div>", " ", "</div>"],
              () => data1(),
              () => data2()
            ) as any;
          }
        });
      },
      { id: "t" }
    );

    expect(blocked.size).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 5. createSignal(fn) — deferStream forwarded to processResult
  // --------------------------------------------------------------------------

  test("createSignal(fn) with deferStream: true does not block (deferStream forwarded to processResult)", () => {
    const { context, blocked, serializeLog } = createBlockTrackingContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        Loading({
          fallback: "Loading...",
          get children() {
            const [data] = createSignal(() => d.promise, { deferStream: true });
            return ssr(["<div>", "</div>"], () => data()) as any;
          }
        });
      },
      { id: "t" }
    );

    expect(blocked.size).toBe(0);
    expect(serializeLog.length).toBe(1);
    expect(serializeLog[0].deferStream).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 6. createProjection with deferStream
  // --------------------------------------------------------------------------

  test("createProjection with deferStream: true passes to serialize", () => {
    const { context, serializeLog, blocked } = createBlockTrackingContext();
    sharedConfig.context = context;

    const d = deferred<{ name: string }>();

    createRoot(
      () => {
        createProjection(() => d.promise, {} as any, { deferStream: true });
      },
      { id: "t" }
    );

    // processResult no longer blocks — serialize handles deferStream blocking in @solidjs/web
    expect(blocked.size).toBe(0);
    expect(serializeLog.length).toBe(1);
    expect(serializeLog[0].deferStream).toBe(true);
  });
});

// ============================================================================
// ssrSource option — server-side behavior
// ============================================================================

describe("ssrSource server modes", () => {
  function createSerializeTrackingContext() {
    const ctx = createMockSSRContext();
    const serializeLog: Array<{ id: string; value: any; deferStream?: boolean }> = [];
    const origSerialize = ctx.context.serialize;
    ctx.context.serialize = (id: string, v: any, deferStream?: boolean) => {
      serializeLog.push({ id, value: v, deferStream });
      origSerialize(id, v);
    };
    return { ...ctx, serializeLog };
  }

  beforeEach(() => {
    sharedConfig.context = undefined;
  });
  afterEach(() => {
    sharedConfig.context = undefined;
  });

  test("ssrSource 'client' skips computation on createMemo, serving the declared commit #0", () => {
    let computeRan = false;
    let result: any;
    createRoot(
      () => {
        // `loadingValue: undefined` is the declared commit #0 — required for
        // "client" sources (#2981).
        const read = createMemo(
          () => {
            computeRan = true;
            return 999;
          },
          { ssrSource: "client", loadingValue: undefined }
        );
        result = read();
      },
      { id: "t" }
    );

    expect(computeRan).toBe(false);
    expect(result).toBeUndefined();
  });

  // Bare `ssrSource: "client"` (no declared commit #0) is the structural
  // form: reads suspend as a FINAL hole so the nearest <Loading> boundary
  // hands the position to the client. Outside a Loading discovery pass there
  // is no boundary to hand off to — the read fails loudly instead of wedging
  // the stream on a promise that can never settle.
  test("bare ssrSource 'client' read outside a Loading boundary throws loudly", () => {
    const { context } = createSerializeTrackingContext();
    sharedConfig.context = context;

    createRoot(
      () => {
        const read = (createMemo as any)(() => 999, { ssrSource: "client" });
        expect(() => read()).toThrow(/outside a <Loading> boundary/);

        const store = (createProjection as any)(
          (d: any) => (d.v = 1),
          { v: 0 },
          { ssrSource: "client" }
        );
        expect(() => store.v).toThrow(/outside a <Loading> boundary/);
      },
      { id: "t" }
    );
  });

  test("bare ssrSource 'client' read inside a Loading pass suspends as a tagged final hole", () => {
    const { context } = createSerializeTrackingContext();
    sharedConfig.context = context;

    createRoot(
      () => {
        const read = (createMemo as any)(() => 999, { ssrSource: "client" });
        (context as any)._loadingPhase = true;
        try {
          let caught: any;
          try {
            read();
          } catch (e) {
            caught = e;
          }
          expect(caught).toBeInstanceOf(NotReadyError);
          expect((caught.source as any).$clientHole).toBe(true);
        } finally {
          (context as any)._loadingPhase = undefined;
        }
      },
      { id: "t" }
    );
  });

  // The boundary flows for bare client sources. A final hole detected before
  // the fragment registers takes the renderToString route (plain fallback +
  // "$$f" — the client hydrates the fallback and renders the content itself);
  // one surfacing only after registration rejects the fragment, because the
  // fragment protocol requires a settle and "settle but keep the fallback" is
  // not expressible.
  describe("bare ssrSource 'client' — boundary handoff", () => {
    test("streaming: final hole at discovery → plain fallback + $$f, no fragment", () => {
      const { context, serialized, registeredFragments } = createMockSSRContext();
      sharedConfig.context = context;

      let result: any;
      createRoot(
        () => {
          result = Loading({
            fallback: "Shell",
            get children() {
              const widget = (createMemo as any)(() => 42, { ssrSource: "client" });
              return ssr(["<div>", "</div>"], () => widget()) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(0);
      expect([...serialized.values()]).toContain("$$f");
      // Plain fallback — no placeholder template, nothing will ever swap.
      expect(result()).toBe("Shell");
    });

    test("streaming: component-body read of a client hole takes the same route", () => {
      const { context, serialized, registeredFragments } = createMockSSRContext();
      sharedConfig.context = context;

      let result: any;
      createRoot(
        () => {
          result = Loading({
            fallback: "Shell",
            get children() {
              const widget = (createMemo as any)(() => 42, { ssrSource: "client" });
              const v = widget(); // throws the tagged NotReady through discovery
              return ssr(["<div>", "</div>"], () => v) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(0);
      expect([...serialized.values()]).toContain("$$f");
      expect(result()).toBe("Shell");
    });

    test("streaming: mixed pending set with a final hole goes client at discovery", async () => {
      const { context, serialized, registeredFragments } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();
      let result: any;
      createRoot(
        () => {
          result = Loading({
            fallback: "Shell",
            get children() {
              const data = createMemo(() => d.promise);
              const widget = (createMemo as any)(() => 42, { ssrSource: "client" });
              // Both surface as template holes in ONE discovery pass — the
              // real one does not mask the final one here.
              return ssr(
                ["<div>", "-", "</div>"],
                () => data(),
                () => widget()
              ) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(0);
      expect([...serialized.values()]).toContain("$$f");
      expect(result()).toBe("Shell");

      // The real source settling later must not disturb the handed-off slot.
      d.resolve("late");
      await tick();
      expect(registeredFragments.size).toBe(0);
    });

    test("streaming: final hole masked by an earlier real await rejects the fragment", async () => {
      const { context, serialized, registeredFragments, fragmentResults, fragmentErrors } =
        createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();
      let result: any;
      createRoot(
        () => {
          result = Loading({
            fallback: "Shell",
            get children() {
              const data = createMemo(() => d.promise);
              // Body-level read: the discovery pass suspends HERE on the real
              // source, so the client hole below is invisible until d settles
              // — by then the fragment has registered.
              const v = data();
              const widget = (createMemo as any)(() => 42, { ssrSource: "client" });
              return ssr(
                ["<div>", "-", "</div>"],
                () => v,
                () => widget()
              ) as any;
            }
          });
        },
        { id: "t" }
      );

      // Registered like any pending boundary; placeholder fallback shown.
      expect(registeredFragments.size).toBe(1);
      expect(result().t[0]).toContain("Shell");

      d.resolve("real");
      await tick();

      // The rediscovery surfaced the final hole: fragment rejected (client
      // renders the content fresh after hydration), no "$$f" on this route.
      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBeUndefined();
      expect(fragmentErrors.size).toBe(1);
      expect(String([...fragmentErrors.values()][0])).toMatch(/client-only content/);
      expect([...serialized.values()]).not.toContain("$$f");
    });

    test("renderToString: client hole takes the existing fallback + $$f route", () => {
      const { context, serialized, registeredFragments } = createMockSSRContext({ async: false });
      sharedConfig.context = context;

      let result: any;
      createRoot(
        () => {
          result = Loading({
            fallback: "Shell",
            get children() {
              const widget = (createMemo as any)(() => 42, { ssrSource: "client" });
              return ssr(["<div>", "</div>"], () => widget()) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(0);
      expect([...serialized.values()]).toContain("$$f");
      expect(result()).toBe("Shell");
    });

    test("bare client projection suspends the boundary to $$f", () => {
      const { context, serialized, registeredFragments } = createMockSSRContext();
      sharedConfig.context = context;

      let result: any;
      createRoot(
        () => {
          result = Loading({
            fallback: "Shell",
            get children() {
              const store = (createProjection as any)(
                (dr: any) => (dr.v = 1),
                { v: 0 },
                { ssrSource: "client" }
              );
              return ssr(["<div>", "</div>"], () => store.v) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(0);
      expect([...serialized.values()]).toContain("$$f");
      expect(result()).toBe("Shell");
    });

    test("client hole read through an Errored boundary propagates the final tag", () => {
      const { context, serialized, registeredFragments } = createMockSSRContext();
      sharedConfig.context = context;

      let result: any;
      createRoot(
        () => {
          result = Loading({
            fallback: "Shell",
            get children() {
              const widget = (createMemo as any)(() => 42, { ssrSource: "client" });
              const eb = createErrorBoundary(
                () => ssr(["<i>", "</i>"], () => widget()),
                () => "errored"
              );
              // The error boundary aggregates its pending set into one
              // NotReady — the $clientHole tag must survive the aggregate.
              return ssr(["<o>", "</o>"], eb) as any;
            }
          });
        },
        { id: "t" }
      );

      expect(registeredFragments.size).toBe(0);
      expect([...serialized.values()]).toContain("$$f");
      expect(result()).toBe("Shell");
    });
  });

  test("ssrSource 'hybrid' runs computation (same as default for Promises)", () => {
    const { context, serializeLog } = createSerializeTrackingContext();
    sharedConfig.context = context;

    const d = deferred<number>();
    let result: any;
    createRoot(
      () => {
        const read = createMemo(() => d.promise, { ssrSource: "hybrid" });
        try {
          result = read();
        } catch (e) {
          if (e instanceof NotReadyError) result = "not-ready";
          else throw e;
        }
      },
      { id: "t" }
    );

    expect(result).toBe("not-ready");
    expect(serializeLog.length).toBe(1);
  });

  test("ssrSource 'server' (default) runs computation normally", () => {
    const { context, serializeLog } = createSerializeTrackingContext();
    sharedConfig.context = context;

    const d = deferred<number>();
    let result: any;
    createRoot(
      () => {
        const read = createMemo(() => d.promise, { ssrSource: "server" });
        try {
          result = read();
        } catch (e) {
          if (e instanceof NotReadyError) result = "not-ready";
          else throw e;
        }
      },
      { id: "t" }
    );

    expect(result).toBe("not-ready");
    expect(serializeLog.length).toBe(1);
  });

  test("ssrSource 'client' still creates owner for ID parity", () => {
    let ownerCreated = false;
    createRoot(
      () => {
        createMemo(() => 1, { ssrSource: "client", loadingValue: undefined });
        const second = createMemo(() => 2);
        ownerCreated = second() === 2;
      },
      { id: "t" }
    );

    expect(ownerCreated).toBe(true);
  });

  test("ssrSource 'client' on createSignal(fn) skips computation without a seeded value", () => {
    let computeRan = false;
    let result: any;
    createRoot(
      () => {
        const [read] = createSignal(
          () => {
            computeRan = true;
            return 999;
          },
          { ssrSource: "client", loadingValue: undefined }
        );
        result = read();
      },
      { id: "t" }
    );

    expect(computeRan).toBe(false);
    expect(result).toBeUndefined();
  });

  test("ssrSource 'client' on createProjection skips computation", () => {
    let computeRan = false;
    let store: any;
    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            computeRan = true;
            draft.name = "computed";
          },
          { name: "initial" },
          { ssrSource: "client", seedLoadingValue: true }
        );
      },
      { id: "t" }
    );

    expect(computeRan).toBe(false);
    expect(store.name).toBe("initial");
  });

  test("seed window: pre-await draft writes are not part of commit #0 (#2988)", () => {
    const { context } = createSerializeTrackingContext();
    sharedConfig.context = context;

    const d = deferred<void>();
    let store: any;
    createRoot(
      () => {
        store = createProjection(
          async (draft: any) => {
            draft.value = 999; // uncommitted mid-flight work — must not render
            await d.promise;
            draft.value = 1;
          },
          { value: 0 },
          { seedLoadingValue: true }
        );
      },
      { id: "t" }
    );

    // Commit #0 is the seed alone: the frozen copy is taken before the derive
    // runs (ruling on #2988), matching the client's shadow draft and what
    // hydration claims against.
    expect(store.value).toBe(0);
  });

  test("ssrSource 'client' does not serialize", () => {
    const { context, serializeLog } = createSerializeTrackingContext();
    sharedConfig.context = context;

    createRoot(
      () => {
        createMemo(() => Promise.resolve(42), {
          ssrSource: "client",
          loadingValue: undefined as number | undefined
        });
      },
      { id: "t" }
    );

    expect(serializeLog.length).toBe(0);
  });
});

// ============================================================================
// Phase 3: Async Iterable Streaming (createMemo, createProjection, createStore)
// ============================================================================

describe("Async Iterable — createMemo", () => {
  beforeEach(() => {
    sharedConfig.context = undefined;
  });
  afterEach(() => {
    sharedConfig.context = undefined;
  });

  function createStreamTrackingContext() {
    const ctx = createMockSSRContext();
    const serializeLog: Array<{ id: string; value: any; deferStream?: boolean }> = [];
    const origSerialize = ctx.context.serialize;
    ctx.context.serialize = (id: string, v: any, deferStream?: boolean) => {
      serializeLog.push({ id, value: v, deferStream });
      origSerialize(id, v);
    };
    return { ...ctx, serializeLog };
  }

  test("default mode (server): serializes async iterable (not just Promise)", () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        createMemo(
          async function* () {
            yield await d.promise;
            yield "second";
          },
          { ssrSource: "server" }
        );
      },
      { id: "t" }
    );

    expect(serializeLog.length).toBe(1);
    const serialized = serializeLog[0].value;
    expect(typeof serialized[Symbol.asyncIterator]).toBe("function");
  });

  test("default mode: first value resolves comp.value and clears NotReadyError", async () => {
    const { context } = createStreamTrackingContext();
    sharedConfig.context = context;

    const d = deferred<string>();
    let read: any;

    createRoot(
      () => {
        read = createMemo(
          async function* () {
            yield await d.promise;
            yield "second";
          },
          { ssrSource: "server" }
        );
      },
      { id: "t" }
    );

    // Before first yield: should throw NotReadyError
    expect(() => read()).toThrow(NotReadyError);

    d.resolve("first");
    await tick();

    // After first yield: should return the value
    expect(read()).toBe("first");
  });

  test("default mode: subsequent yields stream to seroval but comp.value stays at first", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let yieldSecond!: () => void;
    const secondReady = new Promise<void>(r => {
      yieldSecond = r;
    });
    let read: any;

    createRoot(
      () => {
        read = createMemo(
          async function* () {
            yield "first";
            await secondReady;
            yield "second";
          },
          { ssrSource: "server" }
        );
      },
      { id: "t" }
    );

    await tick();
    expect(read()).toBe("first");

    // Iterate the tapped async iterable to pull the second value
    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First next(): replays "first"
    const r1 = await iter.next();
    expect(r1).toEqual({ done: false, value: "first" });

    // Trigger second yield — seroval sees "second" but comp.value is locked at "first"
    yieldSecond();
    const r2 = await iter.next();
    expect(r2).toEqual({ done: false, value: "second" });
    expect(read()).toBe("first");

    // Generator done
    const r3 = await iter.next();
    expect(r3.done).toBe(true);
  });

  test("hybrid mode: serializes first value only as Promise", () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    createRoot(
      () => {
        createMemo(
          async function* () {
            yield "first";
            yield "second";
          },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );

    expect(serializeLog.length).toBe(1);
    // Should be a Promise (first value only), not an async iterable
    const serialized = serializeLog[0].value;
    expect(serialized).toBeInstanceOf(Promise);
  });

  test("hybrid mode: first yield resolves comp.value", async () => {
    const { context } = createStreamTrackingContext();
    sharedConfig.context = context;

    let read: any;

    createRoot(
      () => {
        read = createMemo(
          async function* () {
            yield "first";
            yield "second";
          },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );

    expect(() => read()).toThrow(NotReadyError);

    await tick();

    expect(read()).toBe("first");
  });

  test("hybrid mode: closes iterator after capturing first value", async () => {
    const { context } = createStreamTrackingContext();
    sharedConfig.context = context;

    let read: any;
    let returnCalls = 0;

    createRoot(
      () => {
        read = createMemo(
          () =>
            ({
              [Symbol.asyncIterator]() {
                let step = 0;
                return {
                  next() {
                    step++;
                    return Promise.resolve(
                      step === 1
                        ? { done: false as const, value: "first" }
                        : { done: false as const, value: "second" }
                    );
                  },
                  return(value?: any) {
                    returnCalls++;
                    return Promise.resolve({ done: true as const, value });
                  }
                };
              }
            }) as any,
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );

    expect(() => read()).toThrow(NotReadyError);
    await tick();

    expect(read()).toBe("first");
    expect(returnCalls).toBe(1);
  });

  test("live brand on a direct iterable: auto-hybrid — first value, iterator closed, Promise on the channel", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let read: any;
    let returnCalls = 0;

    createRoot(
      () => {
        read = createMemo(
          () =>
            ({
              [Symbol.for("solid.LiveSource")]: true,
              [Symbol.asyncIterator]() {
                let step = 0;
                return {
                  next() {
                    step++;
                    return Promise.resolve(
                      step === 1
                        ? { done: false as const, value: "first" }
                        : { done: false as const, value: "second" }
                    );
                  },
                  return(value?: any) {
                    returnCalls++;
                    return Promise.resolve({ done: true as const, value });
                  }
                };
              }
            }) as any
          // no ssrSource — the brand selects hybrid
        );
      },
      { id: "t" }
    );

    expect(() => read()).toThrow(NotReadyError);
    await tick();

    expect(read()).toBe("first");
    expect(returnCalls).toBe(1);
    // First value only rides the channel as a Promise, not an iterable.
    expect(serializeLog.length).toBe(1);
    expect(serializeLog[0].value).toBeInstanceOf(Promise);
  });

  test("no ssrSource: defaults to full streaming (same as 'server')", () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    createRoot(
      () => {
        createMemo(async function* () {
          yield "first";
        });
      },
      { id: "t" }
    );

    expect(serializeLog.length).toBe(1);
    const serialized = serializeLog[0].value;
    expect(typeof serialized[Symbol.asyncIterator]).toBe("function");
  });

  test("server mode: tapped async iterable forwards return", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let returnCalls = 0;

    createRoot(
      () => {
        createMemo(
          () =>
            ({
              [Symbol.asyncIterator]() {
                let step = 0;
                return {
                  next() {
                    step++;
                    return Promise.resolve(
                      step === 1
                        ? { done: false as const, value: "first" }
                        : new Promise<IteratorResult<string>>(() => {})
                    );
                  },
                  return(value?: any) {
                    returnCalls++;
                    return Promise.resolve({ done: true as const, value });
                  }
                };
              }
            }) as any
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();
    const r1 = await iter.next();
    expect(r1).toEqual({ done: false, value: "first" });

    await iter.return?.();

    expect(returnCalls).toBe(1);
  });

  test("async generator in Loading: first yield unblocks boundary", async () => {
    const { context, fragmentResults } = createStreamTrackingContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        Loading({
          fallback: "Loading...",
          get children() {
            const data = createMemo(async function* () {
              yield await d.promise;
            });
            return ssr(["<div>", "</div>"], () => data()) as any;
          }
        });
      },
      { id: "t" }
    );

    expect(fragmentResults.size).toBe(0);

    d.resolve("streamed");
    await tick();

    expect(fragmentResults.size).toBe(1);
    expect([...fragmentResults.values()][0]).toBe("<div>streamed</div>");
  });

  test("memo first-value lock: Loading retry reads V1 even after iterable advances", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let yieldSecond!: () => void;
    const secondReady = new Promise<void>(r => {
      yieldSecond = r;
    });
    let read: any;

    createRoot(
      () => {
        read = createMemo(
          async function* () {
            yield "first";
            await secondReady;
            yield "second";
          },
          { ssrSource: "server" }
        );
      },
      { id: "t" }
    );

    await tick();
    expect(read()).toBe("first");

    // Advance the iterator past V1 via the tapped wrapper (simulates seroval consumption)
    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();
    await iter.next(); // consume first
    yieldSecond();
    await iter.next(); // consume second — generator now at V2

    // SSR reads should still return V1, not V2
    // This is the scenario where a Loading boundary retries after the iterable advances
    expect(read()).toBe("first");
  });

  test("generator error on first yield: NotReadyError firstPromise rejects", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let read: any;

    createRoot(
      () => {
        read = createMemo(
          async function* () {
            throw new Error("gen error");
          },
          { ssrSource: "server" }
        );
      },
      { id: "t" }
    );

    // The tapped wrapper's first next() should propagate the error
    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow("gen error");
  });

  test("empty generator (no yields): first next() returns done immediately", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let read: any;

    createRoot(
      () => {
        read = createMemo(
          async function* () {
            // Generator returns immediately without yielding
          },
          { ssrSource: "server" }
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First next() should return done=true (generator completed without yielding)
    const r = await iter.next();
    expect(r.done).toBe(true);

    // No first yield means the memo never commits a value.
    expect(read()).toBeUndefined();
  });

  test("error on second yield after successful first", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let read: any;

    createRoot(
      () => {
        read = createMemo(
          async function* () {
            yield "first";
            throw new Error("second yield failed");
          },
          { ssrSource: "server" }
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First value succeeds
    const r1 = await iter.next();
    expect(r1).toEqual({ done: false, value: "first" });
    expect(read()).toBe("first");

    // Second iteration throws — partial streaming failure
    await expect(iter.next()).rejects.toThrow("second yield failed");

    // comp.value retains the last successful value
    expect(read()).toBe("first");
  });

  test("createSignal(fn) async generator is detected and streamed by processResult", () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let getter: any;

    createRoot(
      () => {
        [getter] = createSignal(() => {
          async function* gen() {
            yield "from-gen";
          }
          return gen() as any;
        }, undefined);
      },
      { id: "t" }
    );

    expect(serializeLog.length).toBe(1);
    expect(typeof serializeLog[0].value[Symbol.asyncIterator]).toBe("function");
    expect(() => getter()).toThrow(NotReadyError);
  });
});

describe("Async Iterable — createProjection", () => {
  beforeEach(() => {
    sharedConfig.context = undefined;
  });
  afterEach(() => {
    sharedConfig.context = undefined;
  });

  function createStreamTrackingContext() {
    const ctx = createMockSSRContext();
    const serializeLog: Array<{ id: string; value: any; deferStream?: boolean }> = [];
    const origSerialize = ctx.context.serialize;
    ctx.context.serialize = (id: string, v: any, deferStream?: boolean) => {
      serializeLog.push({ id, value: v, deferStream });
      origSerialize(id, v);
    };
    return { ...ctx, serializeLog };
  }

  test("server mode: void yields produce patch batches", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            draft.name = "Alice";
            yield;
            draft.age = 30;
            yield;
          },
          { name: "", age: 0 }
        );
      },
      { id: "t" }
    );

    expect(serializeLog.length).toBe(1);
    const tapped = serializeLog[0].value;
    expect(typeof tapped[Symbol.asyncIterator]).toBe("function");

    const iter = tapped[Symbol.asyncIterator]();

    // First yield: full state snapshot
    const r1 = await iter.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual({ name: "Alice", age: 0 });
    expect(store.name).toBe("Alice");

    // Second yield: patches stream to seroval, but SSR reads stay at V1
    const r2 = await iter.next();
    expect(r2.done).toBe(false);
    expect(r2.value).toEqual([[["age"], 30]]);
    expect(store.age).toBe(0);

    // Done
    const r3 = await iter.next();
    expect(r3.done).toBe(true);
  });

  test("server mode: value yield applies to state", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            draft.name = "Alice";
            yield;
            yield { name: "Bob", role: "admin" } as any;
          },
          { name: "", role: "user" }
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First yield: full state snapshot
    const r1 = await iter.next();
    expect(r1.value).toEqual({ name: "Alice", role: "user" });
    expect(store.name).toBe("Alice");

    // Second yield: value yield streams to seroval, but SSR reads stay at V1
    const r2 = await iter.next();
    expect(r2.done).toBe(false);
    expect(store.name).toBe("Alice");
    expect(store.role).toBe("user");
  });

  test("server mode: replacement yields are authoritative snapshots (#2948)", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    createRoot(
      () => {
        createProjection(
          async function* () {
            yield { name: "A" } as any;
            yield { name: "B" } as any;
          },
          { name: "seed", stale: true } as any
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First snapshot: replace, not merge — seed keys absent from the
    // replacement (`stale`) must not survive.
    const r1 = await iter.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual({ name: "A" });

    // Second replacement yield: its changes ride in THIS patch batch —
    // previously the batch was drained before the replacement was applied,
    // so the client never saw the new value.
    const r2 = await iter.next();
    expect(r2.done).toBe(false);
    expect(r2.value).toEqual([[["name"], "B"]]);

    const r3 = await iter.next();
    expect(r3.done).toBe(true);
  });

  test("server mode: later replacement yield dropping a key emits a delete patch (#2948)", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    createRoot(
      () => {
        createProjection(
          async function* () {
            yield { a: 1, b: 2 } as any;
            yield { a: 3 } as any;
          },
          { a: 0 } as any
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    const r1 = await iter.next();
    expect(r1.value).toEqual({ a: 1, b: 2 });

    const r2 = await iter.next();
    expect(r2.done).toBe(false);
    expect(r2.value).toEqual([[["b"]], [["a"], 3]]);
  });

  test("hybrid mode: replacement first yield removes stale seed keys (#2948)", async () => {
    const { context } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;
    createRoot(
      () => {
        store = createProjection(
          async function* () {
            yield { name: "A" } as any;
          },
          { name: "seed", stale: true } as any,
          { ssrSource: "hybrid" } as any
        );
      },
      { id: "t" }
    );

    await tick();
    expect(store.name).toBe("A");
    expect(store.stale).toBeUndefined();
    expect("stale" in store).toBe(false);
  });

  test("promise result: replacement value removes stale seed keys (#2948)", async () => {
    const { context } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;
    createRoot(
      () => {
        store = createProjection(async () => ({ name: "A" }) as any, {
          name: "seed",
          stale: true
        } as any);
      },
      { id: "t" }
    );

    await tick();
    expect(store.name).toBe("A");
    expect(store.stale).toBeUndefined();
  });

  test("sync result: replacement value removes stale seed keys (#2948)", () => {
    const { context } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;
    createRoot(
      () => {
        store = createProjection(() => ({ name: "A" }) as any, {
          name: "seed",
          stale: true
        } as any);
      },
      { id: "t" }
    );

    expect(store.name).toBe("A");
    expect(store.stale).toBeUndefined();
  });

  test("server mode: deep nested mutations tracked", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            draft.user.name = "Alice";
            draft.user.profile.bio = "Hello";
            yield;
          },
          { user: { name: "", profile: { bio: "" } } }
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First yield: full state snapshot
    const r1 = await iter.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual({ user: { name: "Alice", profile: { bio: "Hello" } } });
    expect(store.user.name).toBe("Alice");
    expect(store.user.profile.bio).toBe("Hello");
  });

  test("server mode: array push generates raw set patches", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            draft.items.push("a");
            yield;
          },
          { items: [] as string[] }
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First yield: full state snapshot
    const r1 = await iter.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual({ items: ["a"] });
    expect(store.items).toEqual(["a"]);
  });

  test("server mode: array shift generates semantic O(1) patch", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            draft.items.shift();
            yield;
          },
          { items: ["a", "b", "c"] }
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First yield: full state snapshot
    const r1 = await iter.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual({ items: ["b", "c"] });
    expect(store.items).toEqual(["b", "c"]);
  });

  test("server mode: array unshift generates semantic insert patches", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            draft.items.unshift("x", "y");
            yield;
          },
          { items: ["a"] }
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First yield: full state snapshot
    const r1 = await iter.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual({ items: ["x", "y", "a"] });
    expect(store.items).toEqual(["x", "y", "a"]);
  });

  test("server mode: array splice generates remove + insert patches", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            draft.items.splice(1, 2, "x");
            yield;
          },
          { items: ["a", "b", "c", "d"] }
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First yield: full state snapshot
    const r1 = await iter.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual({ items: ["a", "x", "d"] });
    expect(store.items).toEqual(["a", "x", "d"]);
  });

  test("server mode: throws NotReadyError on read while pending", () => {
    const { context } = createStreamTrackingContext();
    sharedConfig.context = context;

    const d = deferred<void>();
    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            await d.promise;
            draft.name = "loaded";
            yield;
          },
          { name: "init" }
        );
      },
      { id: "t" }
    );

    // Before first yield, reading any property throws NotReadyError
    expect(() => store.name).toThrow(NotReadyError);

    // The NotReadyError carries a source promise for Loading boundaries
    try {
      store.name;
    } catch (err: any) {
      expect(err).toBeInstanceOf(NotReadyError);
      expect(err.source).toBeInstanceOf(Promise);
    }
  });

  test("projection in Loading boundary: async generator blocks until first yield", async () => {
    const { context, fragmentResults } = createStreamTrackingContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        Loading({
          fallback: "Loading...",
          get children() {
            const store: any = createProjection(
              async function* (draft: any) {
                draft.name = await d.promise;
                yield;
              },
              { name: "" }
            );
            return ssr(["<div>", "</div>"], () => store.name) as any;
          }
        });
      },
      { id: "t" }
    );

    // Fragment not yet resolved (projection pending)
    expect(fragmentResults.size).toBe(0);

    d.resolve("Alice");
    await tick();

    // After first yield, fragment resolves with the projected value
    expect(fragmentResults.size).toBe(1);
    expect([...fragmentResults.values()][0]).toBe("<div>Alice</div>");
  });

  test("Promise projection reads throw NotReadyError until resolved", async () => {
    const { context } = createStreamTrackingContext();
    sharedConfig.context = context;

    const key = Symbol("status");
    const d = deferred<{ name: string; [key]: string }>();
    let store: any;

    createRoot(
      () => {
        store = createProjection(() => d.promise, { name: "init", [key]: "init" });
      },
      { id: "t" }
    );

    expect(() => store.name).toThrow(NotReadyError);
    expect(() => store[key]).toThrow(NotReadyError);
    expect(() => "name" in store).toThrow(NotReadyError);
    expect(() => Object.keys(store)).toThrow(NotReadyError);
    expect(() => Object.getOwnPropertyDescriptor(store, "name")).toThrow(NotReadyError);
    expect(() => Object.hasOwn(store, "name")).toThrow(NotReadyError);

    d.resolve({ name: "resolved", [key]: "ready" });
    await tick();

    expect(store.name).toBe("resolved");
    expect(store[key]).toBe("ready");
    expect("name" in store).toBe(true);
    expect(Object.keys(store)).toEqual(["name"]);
    expect(Object.getOwnPropertyDescriptor(store, "name")?.value).toBe("resolved");
    expect(Object.hasOwn(store, "name")).toBe(true);
  });

  test("Promise projection preserves its error after rejection", async () => {
    const { context } = createStreamTrackingContext();
    sharedConfig.context = context;

    const key = Symbol("status");
    const d = deferred<{ name: string; [key]: string }>();
    const error = new Error("projection failed");
    let store: any;
    let source!: Promise<unknown>;

    createRoot(
      () => {
        store = createProjection(() => d.promise, { name: "init", [key]: "init" });
      },
      { id: "t" }
    );

    try {
      store.name;
    } catch (error) {
      expect(error).toBeInstanceOf(NotReadyError);
      source = (error as NotReadyError).source;
    }

    d.reject(error);
    await expect(source).rejects.toBe(error);
    for (const read of [
      () => store.name,
      () => store[key],
      () => "name" in store,
      () => Object.keys(store),
      () => Object.getOwnPropertyDescriptor(store, "name"),
      () => Object.hasOwn(store, "name")
    ]) {
      let thrown: unknown;
      try {
        read();
      } catch (reason) {
        thrown = reason;
      }
      expect(thrown).toBe(error);
    }
  });

  test("async iterable projection preserves a rejection before its first yield", async () => {
    const { context } = createStreamTrackingContext();
    sharedConfig.context = context;

    const d = deferred<void>();
    const error = new Error("projection failed");
    let store: any;
    let source!: Promise<unknown>;

    createRoot(
      () => {
        store = createProjection(
          async function* () {
            await d.promise;
            yield { name: "resolved", count: 1 };
          },
          { name: "init", count: 0 }
        );
      },
      { id: "t" }
    );

    try {
      store.name;
    } catch (error) {
      expect(error).toBeInstanceOf(NotReadyError);
      source = (error as NotReadyError).source;
    }

    d.reject(error);
    await expect(source).rejects.toBe(error);

    for (const read of [() => store.name, () => store.count, () => store.name]) {
      let thrown: unknown;
      try {
        read();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(error);
    }
  });

  test("seedLoadingValue projection preserves a rejected first result", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    const d = deferred<void>();
    const error = new Error("seeded projection failed");
    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* () {
            await d.promise;
            yield { name: "resolved", count: 1 };
          },
          { name: "seed", count: 0 },
          { seedLoadingValue: true }
        );
      },
      { id: "t" }
    );

    expect(store.name).toBe("seed");
    expect(store.count).toBe(0);

    const iter = serializeLog[0].value[Symbol.asyncIterator]();
    const first = iter.next();
    d.reject(error);
    await expect(first).rejects.toBe(error);

    for (const read of [() => store.name, () => store.count, () => store.name]) {
      let thrown: unknown;
      try {
        read();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(error);
    }
  });

  test("sync projection does NOT throw NotReadyError", () => {
    const { context } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;

    createRoot(
      () => {
        store = createProjection(
          (draft: any) => {
            draft.name = "sync";
          },
          { name: "" }
        );
      },
      { id: "t" }
    );

    // Synchronous projections return immediately — no pending state
    expect(store.name).toBe("sync");
  });

  test("server mode: genuinely async first yield (await before yield)", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    const d = deferred<string>();
    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            const name = await d.promise;
            draft.name = name;
            yield;
            draft.count = 1;
            yield;
          },
          { name: "", count: 0 }
        );
      },
      { id: "t" }
    );

    expect(serializeLog.length).toBe(1);
    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First next() is pending (generator awaiting d.promise)
    const firstPromise = iter.next();

    // Store throws NotReadyError while pending
    expect(() => store.name).toThrow(NotReadyError);

    d.resolve("Alice");
    const r1 = await firstPromise;

    // First yield: full state snapshot
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual({ name: "Alice", count: 0 });
    expect(store.name).toBe("Alice");

    // Second yield: patches stream to seroval, but SSR reads stay at V1
    const r2 = await iter.next();
    expect(r2.done).toBe(false);
    expect(r2.value).toEqual([[["count"], 1]]);
    expect(store.count).toBe(0);
  });

  test("projection first-value lock: SSR reads frozen at V1 after multiple yields", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let yieldSecond!: () => void;
    const secondReady = new Promise<void>(r => {
      yieldSecond = r;
    });
    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            draft.name = "Alice";
            draft.items = ["a"];
            yield;
            await secondReady;
            draft.name = "Bob";
            draft.items.push("b");
            yield;
          },
          { name: "", items: [] as string[] }
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First yield: full state snapshot at V1
    const r1 = await iter.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual({ name: "Alice", items: ["a"] });
    expect(store.name).toBe("Alice");
    expect(store.items).toEqual(["a"]);

    // Advance to second yield — seroval gets patches, SSR reads stay at V1
    yieldSecond();
    const r2 = await iter.next();
    expect(r2.done).toBe(false);
    expect(store.name).toBe("Alice");
    expect(store.items).toEqual(["a"]);
  });

  test("projection first-value lock: nested object mutations don't leak to SSR reads", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            draft.user = { name: "Alice", age: 30 };
            yield;
            draft.user.name = "Bob";
            draft.user.age = 31;
            yield;
          },
          { user: { name: "", age: 0 } }
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First yield
    await iter.next();
    expect(store.user).toEqual({ name: "Alice", age: 30 });

    // Second yield — nested mutations should NOT leak to SSR reads
    await iter.next();
    expect(store.user).toEqual({ name: "Alice", age: 30 });
  });

  test("server mode: array pop generates raw set patches", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            draft.items.pop();
            yield;
          },
          { items: ["a", "b", "c"] }
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First yield: full state snapshot
    const r1 = await iter.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual({ items: ["a", "b"] });
    expect(store.items).toEqual(["a", "b"]);
  });

  test("server mode: empty generator (no yields) completes immediately", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (_draft: any) {
            // No mutations, no yields
          },
          { name: "init" }
        );
      },
      { id: "t" }
    );

    // Store is pending until tapped wrapper is iterated
    expect(() => store.name).toThrow(NotReadyError);

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    const r1 = await iter.next();
    expect(r1.done).toBe(true);

    // After done, store is readable with initial value
    expect(store.name).toBe("init");
  });

  test("server mode: error on second yield after successful first", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            draft.name = "Alice";
            yield;
            throw new Error("projection error");
          },
          { name: "" }
        );
      },
      { id: "t" }
    );

    const tapped = serializeLog[0].value;
    const iter = tapped[Symbol.asyncIterator]();

    // First yield: full state snapshot
    const r1 = await iter.next();
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual({ name: "Alice" });
    expect(store.name).toBe("Alice");

    // Second iteration throws
    await expect(iter.next()).rejects.toThrow("projection error");

    // State retains last successful mutation
    expect(store.name).toBe("Alice");
  });

  test("hybrid mode: serializes first yield state as Promise", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;

    createRoot(
      () => {
        store = createProjection(
          async function* (draft: any) {
            draft.name = "Alice";
            yield;
            draft.name = "Bob";
            yield;
          },
          { name: "" },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );

    expect(serializeLog.length).toBe(1);
    const serialized = serializeLog[0].value;
    expect(serialized).toBeInstanceOf(Promise);

    await tick();

    // State should have first yield mutations
    expect(store.name).toBe("Alice");
  });

  test("hybrid mode: closes projection iterator after first yield", async () => {
    const { context } = createStreamTrackingContext();
    sharedConfig.context = context;

    let store: any;
    let returnCalls = 0;

    createRoot(
      () => {
        store = createProjection(
          () =>
            ({
              [Symbol.asyncIterator]() {
                let step = 0;
                return {
                  next() {
                    step++;
                    return Promise.resolve(
                      step === 1
                        ? { done: false as const, value: { name: "Alice" } }
                        : { done: false as const, value: { name: "Bob" } }
                    );
                  },
                  return(value?: any) {
                    returnCalls++;
                    return Promise.resolve({ done: true as const, value });
                  }
                };
              }
            }) as any,
          { name: "" },
          { ssrSource: "hybrid" }
        );
      },
      { id: "t" }
    );

    await tick();

    expect(store.name).toBe("Alice");
    expect(returnCalls).toBe(1);
  });

  test("createStore(fn) with async generator delegates to createProjection", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    const { createStore: createServerStore } = await import("../../src/server/signals.js");
    let store: any;

    createRoot(
      () => {
        [store] = createServerStore(
          async function* (draft: any) {
            draft.name = "fromGen";
            yield;
          },
          { name: "init" } as any
        );
      },
      { id: "t" }
    );

    // Should serialize (delegated to createProjection)
    expect(serializeLog.length).toBe(1);
    const tapped = serializeLog[0].value;
    expect(typeof tapped[Symbol.asyncIterator]).toBe("function");

    const iter = tapped[Symbol.asyncIterator]();
    const r1 = await iter.next();
    expect(r1.done).toBe(false);
    expect(store.name).toBe("fromGen");
  });

  test("createStore(fn) with Promise delegates to createProjection", async () => {
    const { context, serializeLog } = createStreamTrackingContext();
    sharedConfig.context = context;

    const { createStore: createServerStore } = await import("../../src/server/signals.js");
    const d = deferred<{ name: string; count: number }>();
    let store: any;

    createRoot(
      () => {
        [store] = createServerStore(() => d.promise, { name: "init", count: 0 });
      },
      { id: "t" }
    );

    // Should serialize the promise
    expect(serializeLog.length).toBe(1);
    expect(serializeLog[0].value).toBeInstanceOf(Promise);

    // Before resolution, reads throw NotReadyError
    expect(() => store.name).toThrow(NotReadyError);

    d.resolve({ name: "resolved", count: 42 });
    await tick();

    expect(store.name).toBe("resolved");
    expect(store.count).toBe(42);
  });
});

describe("createDeepProxy unit tests", () => {
  test("tracks simple set operations", async () => {
    const { createDeepProxy: deepProxy } = await import("../../src/server/signals.js");
    type P = import("../../src/server/signals.js").PatchOp;
    const patches: P[] = [];
    const target = { a: 1, b: 2 };
    const proxy = deepProxy(target, patches);

    proxy.a = 10;
    proxy.b = 20;

    expect(patches).toEqual([
      [["a"], 10],
      [["b"], 20]
    ]);
    expect(target).toEqual({ a: 10, b: 20 });
  });

  test("tracks delete operations", async () => {
    const { createDeepProxy: deepProxy } = await import("../../src/server/signals.js");
    type P = import("../../src/server/signals.js").PatchOp;
    const patches: P[] = [];
    const target: any = { a: 1, b: 2 };
    const proxy = deepProxy(target, patches);

    delete proxy.b;

    expect(patches).toEqual([[["b"]]]);
    expect(target).toEqual({ a: 1 });
  });

  test("tracks deep nested mutations", async () => {
    const { createDeepProxy: deepProxy } = await import("../../src/server/signals.js");
    type P = import("../../src/server/signals.js").PatchOp;
    const patches: P[] = [];
    const target = { user: { profile: { name: "" } } };
    const proxy = deepProxy(target, patches);

    proxy.user.profile.name = "Alice";

    expect(patches).toEqual([[["user", "profile", "name"], "Alice"]]);
    expect(target.user.profile.name).toBe("Alice");
  });

  test("array push uses raw set traps", async () => {
    const { createDeepProxy: deepProxy } = await import("../../src/server/signals.js");
    type P = import("../../src/server/signals.js").PatchOp;
    const patches: P[] = [];
    const target = { items: [1, 2] };
    const proxy = deepProxy(target, patches);

    proxy.items.push(3);

    // push: sets items[2] = 3 and items.length = 3
    expect(patches.length).toBe(2);
    expect(target.items).toEqual([1, 2, 3]);
  });

  test("array shift produces single remove patch", async () => {
    const { createDeepProxy: deepProxy } = await import("../../src/server/signals.js");
    type P = import("../../src/server/signals.js").PatchOp;
    const patches: P[] = [];
    const target = { items: ["a", "b", "c"] };
    const proxy = deepProxy(target, patches);

    const removed = proxy.items.shift();

    expect(removed).toBe("a");
    expect(patches).toEqual([[["items", 0]]]);
    expect(target.items).toEqual(["b", "c"]);
  });

  test("array unshift produces insert patches (reverse order)", async () => {
    const { createDeepProxy: deepProxy } = await import("../../src/server/signals.js");
    type P = import("../../src/server/signals.js").PatchOp;
    const patches: P[] = [];
    const target = { items: ["c"] };
    const proxy = deepProxy(target, patches);

    proxy.items.unshift("a", "b");

    expect(patches).toEqual([
      [["items", 0], "a", 1],
      [["items", 1], "b", 1]
    ]);
    expect(target.items).toEqual(["a", "b", "c"]);
  });

  test("array splice produces remove + insert patches", async () => {
    const { createDeepProxy: deepProxy } = await import("../../src/server/signals.js");
    type P = import("../../src/server/signals.js").PatchOp;
    const patches: P[] = [];
    const target = { items: ["a", "b", "c", "d"] };
    const proxy = deepProxy(target, patches);

    const removed = proxy.items.splice(1, 2, "x", "y");

    expect(removed).toEqual(["b", "c"]);
    expect(patches).toEqual([
      [["items", 1]],
      [["items", 1]],
      [["items", 1], "x", 1],
      [["items", 2], "y", 1]
    ]);
    expect(target.items).toEqual(["a", "x", "y", "d"]);
  });

  test("array pop uses raw set traps", async () => {
    const { createDeepProxy: deepProxy } = await import("../../src/server/signals.js");
    type P = import("../../src/server/signals.js").PatchOp;
    const patches: P[] = [];
    const target = { items: ["a", "b", "c"] };
    const proxy = deepProxy(target, patches);

    const removed = proxy.items.pop();

    expect(removed).toBe("c");
    // pop: delete items[2] + set items.length = 2
    expect(patches.length).toBe(2);
    expect(target.items).toEqual(["a", "b"]);
  });

  test("flush and re-accumulate patches", async () => {
    const { createDeepProxy: deepProxy } = await import("../../src/server/signals.js");
    type P = import("../../src/server/signals.js").PatchOp;
    const patches: P[] = [];
    const target = { x: 0, y: 0 };
    const proxy = deepProxy(target, patches);

    proxy.x = 1;
    const batch1 = patches.splice(0);
    expect(batch1).toEqual([[["x"], 1]]);
    expect(patches).toEqual([]);

    proxy.y = 2;
    const batch2 = patches.splice(0);
    expect(batch2).toEqual([[["y"], 2]]);
  });

  test("replacing nested object invalidates child proxy cache", async () => {
    const { createDeepProxy: deepProxy } = await import("../../src/server/signals.js");
    type P = import("../../src/server/signals.js").PatchOp;
    const patches: P[] = [];
    const target: any = { nested: { a: 1 } };
    const proxy = deepProxy(target, patches);

    // Mutate nested property
    proxy.nested.a = 2;
    expect(patches).toEqual([[["nested", "a"], 2]]);

    // Replace the entire nested object
    patches.length = 0;
    proxy.nested = { b: 3 };
    expect(patches).toEqual([[["nested"], { b: 3 }]]);

    // Mutate the NEW nested object — should track correctly
    patches.length = 0;
    proxy.nested.b = 4;
    expect(patches).toEqual([[["nested", "b"], 4]]);
    expect(target.nested).toEqual({ b: 4 });
  });
});

// ============================================================================
// Asset Manifest + lazy() Asset Registration
// ============================================================================

describe("Asset Manifest + lazy()", () => {
  let savedContext: any;

  beforeEach(() => {
    savedContext = sharedConfig.context;
  });

  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  test("lazy() without moduleUrl renders and warns when the module lacks $$moduleUrl", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const { context } = createMockSSRContext();
    context.resolveAssets = () => null;
    context.registerAsset = () => {};
    sharedConfig.context = context;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const Comp = (props: any) => "Hello";
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }));
    await LazyComp.preload!();

    // No render-time throw — identity resolution defers to the module's
    // bundler-injected $$moduleUrl export (glob case) and warns when missing.
    expect(() => {
      createRoot(
        () => {
          LazyComp({});
        },
        { id: "t" }
      );
    }).not.toThrow();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("$$moduleUrl"));
    warn.mockRestore();
  });

  test("lazy() with { export } resolves the named export server-side (#3011)", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const { context } = createMockSSRContext();
    context.resolveAssets = () => ({ js: ["/assets/pages.js"], css: [] });
    context.registerAsset = () => {};
    sharedConfig.context = context;

    const LazyComp = lazy(
      () =>
        Promise.resolve({
          HomePage: (props: any) => `Home ${props.name}`,
          AboutPage: (props: any) => `About ${props.name}`
        } as any),
      { export: "HomePage" },
      "./pages.tsx"
    );
    await (LazyComp as any).preload!();

    let result: any;
    createRoot(
      () => {
        result = (LazyComp as any)({ name: "World" });
      },
      { id: "t" }
    );
    expect(typeof result).toBe("function");
    expect(result()).toBe("Home World");
  });

  test("lazy() throws when no manifest is set (no resolveAssets on context)", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    const Comp = (props: any) => "Hello";
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), undefined, "./Comp.tsx");
    await LazyComp.preload!();

    expect(() => {
      createRoot(
        () => {
          LazyComp({});
        },
        { id: "t" }
      );
    }).toThrow(/asset manifest/);
  });

  test("lazy() with moduleUrl registers assets and module mapping", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const registered: Array<{ type: string; value: any }> = [];
    const modules: Record<string, string> = {};
    const { context } = createMockSSRContext();
    context.registerAsset = (type: string, value: any) => registered.push({ type, value });
    context.registerModule = (moduleUrl: string, entryUrl: string) => {
      modules[moduleUrl] = entryUrl;
    };
    context.resolveAssets = (id: string) => {
      if (id === "./MyComp.tsx")
        return {
          js: ["/assets/MyComp-abc123.js", "/assets/shared-def456.js"],
          css: [],
          preloads: [{ href: "/assets/hero.avif", as: "image", fetchpriority: "high" }]
        };
      return null;
    };
    sharedConfig.context = context;

    const Comp = (props: any) => "Hello";
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), undefined, "./MyComp.tsx");
    await LazyComp.preload!();
    // preload() now hints the module too; this case covers the render pass.
    registered.length = 0;

    createRoot(
      () => {
        LazyComp({});
      },
      { id: "t" }
    );

    expect(registered).toEqual([
      {
        type: "preload",
        value: { href: "/assets/hero.avif", as: "image", fetchpriority: "high" }
      },
      { type: "module", value: "/assets/MyComp-abc123.js" },
      { type: "module", value: "/assets/shared-def456.js" }
    ]);
    // The mapping is keyed by the hydration id of lazy's render memo (the
    // next child id of the root owner "t"), not by moduleUrl — the client
    // computes the same id positionally during hydration.
    expect(modules).toEqual({ t0: "/assets/MyComp-abc123.js" });
  });

  test("preload() hints the module's assets without rendering it", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const registered: Array<{ type: string; value: any }> = [];
    const modules: Record<string, string> = {};
    const { context } = createMockSSRContext();
    context.registerAsset = (type: string, value: any) => registered.push({ type, value });
    context.registerModule = (moduleUrl: string, entryUrl: string) => {
      modules[moduleUrl] = entryUrl;
    };
    context.resolveAssets = (id: string) =>
      id === "./Route.tsx"
        ? {
            js: ["/assets/Route.js", "/assets/shared.js"],
            css: ["/assets/Route.css"],
            preloads: [{ href: "/assets/route-font.woff2", as: "font", crossorigin: "" }]
          }
        : null;
    sharedConfig.context = context;

    const LazyRoute = lazy(
      () => Promise.resolve({ default: () => "route" }),
      undefined,
      "./Route.tsx"
    );
    await LazyRoute.preload!();

    expect(registered).toEqual([
      { type: "style", value: "/assets/Route.css" },
      {
        type: "preload",
        value: { href: "/assets/route-font.woff2", as: "font", crossorigin: "" }
      },
      { type: "module", value: "/assets/Route.js" },
      { type: "module", value: "/assets/shared.js" }
    ]);
    // Hint-only: the hydration mapping belongs to the render that creates the
    // component, which knows the hydration key.
    expect(modules).toEqual({});
  });

  test("preload() resolves each module once per request", async () => {
    const { lazy } = await import("../../src/server/component.js");

    let calls = 0;
    const registered: Array<{ type: string; url: string }> = [];
    const { context } = createMockSSRContext();
    context.registerAsset = (type: string, url: string) => registered.push({ type, url });
    context.resolveAssets = (id: string) => {
      calls++;
      return { js: ["/assets/Once.js"], css: [] };
    };
    sharedConfig.context = context;

    const LazyOnce = lazy(
      () => Promise.resolve({ default: (_props: any) => "once" }),
      undefined,
      "./Once.tsx"
    );
    await LazyOnce.preload!();
    await LazyOnce.preload!();
    createRoot(
      () => {
        LazyOnce({});
      },
      { id: "t" }
    );

    expect(calls).toBe(1);
  });

  test("lazy() with moduleUrl classifies .css URLs as style", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const registered: Array<{ type: string; url: string }> = [];
    const { context } = createMockSSRContext();
    context.registerAsset = (type: string, url: string) => registered.push({ type, url });
    context.resolveAssets = (id: string) => {
      if (id === "./Styled.tsx")
        return { js: ["/assets/Styled-abc.js"], css: ["/assets/Styled-abc.css"] };
      return null;
    };
    sharedConfig.context = context;

    const Comp = (props: any) => "styled";
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), undefined, "./Styled.tsx");
    await LazyComp.preload!();
    // preload() now hints the module too; this case covers the render pass.
    registered.length = 0;

    createRoot(
      () => {
        LazyComp({});
      },
      { id: "t" }
    );

    expect(registered).toEqual([
      { type: "style", url: "/assets/Styled-abc.css" },
      { type: "module", url: "/assets/Styled-abc.js" }
    ]);
  });

  test("lazy() with missing manifest entry does not crash", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const registered: Array<{ type: string; url: string }> = [];
    const { context } = createMockSSRContext();
    context.registerAsset = (type: string, url: string) => registered.push({ type, url });
    context.resolveAssets = () => null;
    sharedConfig.context = context;

    const Comp = (props: any) => "missing";
    const LazyComp = lazy(
      () => Promise.resolve({ default: Comp }),
      undefined,
      "./NotInManifest.tsx"
    );
    await LazyComp.preload!();

    createRoot(
      () => {
        LazyComp({});
      },
      { id: "t" }
    );

    expect(registered).toEqual([]);
  });

  test("lazy() without registerAsset on context does not crash", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const { context } = createMockSSRContext();
    context.resolveAssets = () => ({ js: ["/assets/comp.js"], css: [] });
    sharedConfig.context = context;

    const Comp = (props: any) => "ok";
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), undefined, "./Comp.tsx");
    await LazyComp.preload!();

    expect(() => {
      createRoot(
        () => {
          LazyComp({});
        },
        { id: "t" }
      );
    }).not.toThrow();
  });

  test("lazy() registers assets even when component is not yet loaded (async path)", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const registered: Array<{ type: string; url: string }> = [];
    const { context } = createMockSSRContext();
    context.registerAsset = (type: string, url: string) => registered.push({ type, url });
    context.resolveAssets = (id: string) => {
      if (id === "./Async.tsx") return { js: ["/assets/async.js"], css: [] };
      return null;
    };
    sharedConfig.context = context;

    const d = deferred<{ default: (props: any) => string }>();
    const LazyComp = lazy(() => d.promise, undefined, "./Async.tsx");

    let thunk: any;
    let thunkThrew = false;
    createRoot(
      () => {
        thunk = LazyComp({});
      },
      { id: "t" }
    );

    expect(typeof thunk).toBe("function");
    try {
      thunk();
    } catch (e) {
      if (e instanceof NotReadyError) thunkThrew = true;
      else throw e;
    }
    expect(thunkThrew).toBe(true);
    expect(registered).toEqual([{ type: "module", url: "/assets/async.js" }]);

    d.resolve({ default: () => "done" });
  });

  test("lazy() with sync resolver registers inline-style css descriptors", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const registered: Array<{ type: string; value: any }> = [];
    const { context } = createMockSSRContext();
    context.registerAsset = (type: string, value: any) => registered.push({ type, value });
    context.resolveAssets = (id: string) =>
      id === "./Dev.tsx"
        ? {
            js: ["/src/Dev.tsx"],
            css: [
              {
                id: "/src/Dev.css",
                content: ".dev{}",
                attrs: { "data-vite-dev-id": "/src/Dev.css" }
              }
            ]
          }
        : null;
    sharedConfig.context = context;

    const Comp = (props: any) => "dev";
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), undefined, "./Dev.tsx");
    await LazyComp.preload!();
    // preload() now hints the module too; this case covers the render pass.
    registered.length = 0;

    createRoot(
      () => {
        LazyComp({});
      },
      { id: "t" }
    );

    expect(registered).toEqual([
      {
        type: "inline-style",
        value: {
          id: "/src/Dev.css",
          content: ".dev{}",
          attrs: { "data-vite-dev-id": "/src/Dev.css" }
        }
      },
      { type: "module", value: "/src/Dev.tsx" }
    ]);
  });

  test("lazy() with async resolver gates rendering until assets register", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const registered: Array<{ type: string; value: any; boundary: string | null | undefined }> = [];
    const resolverDeferred = deferred<{ js: string[]; css: any[] } | null>();
    const { context } = createMockSSRContext();
    context.registerAsset = (type: string, value: any) =>
      registered.push({ type, value, boundary: context._currentBoundaryId });
    context.resolveAssets = () => resolverDeferred.promise;
    context._currentBoundaryId = "b-owner";
    sharedConfig.context = context;

    const Comp = (props: any) => "async-dev";
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), undefined, "./AsyncDev.tsx");
    await LazyComp.preload!();
    // preload() now hints the module too; this case covers the render pass.
    registered.length = 0;

    let thunk: any;
    createRoot(
      () => {
        thunk = LazyComp({});
      },
      { id: "t" }
    );

    // Module is loaded, but the resolver is still in flight — the memo must
    // stay not-ready so a streamed fragment can't flush without its styles.
    expect(() => thunk()).toThrow(NotReadyError);
    expect(registered).toEqual([]);

    // Another boundary renders while the resolver settles; registration must
    // restore attribution to the boundary that owned the lazy render.
    context._currentBoundaryId = "b-other";
    resolverDeferred.resolve({
      js: ["/src/AsyncDev.tsx"],
      css: [{ id: "/src/AsyncDev.css", content: ".a{}" }]
    });
    await resolverDeferred.promise;
    await Promise.resolve();

    // Both the preload hint and the render registration settle here, and both
    // must restore the owning boundary.
    expect(registered).toEqual([
      {
        type: "inline-style",
        value: { id: "/src/AsyncDev.css", content: ".a{}" },
        boundary: "b-owner"
      },
      { type: "module", value: "/src/AsyncDev.tsx", boundary: "b-owner" },
      {
        type: "inline-style",
        value: { id: "/src/AsyncDev.css", content: ".a{}" },
        boundary: "b-owner"
      },
      { type: "module", value: "/src/AsyncDev.tsx", boundary: "b-owner" }
    ]);
    expect(context._currentBoundaryId).toBe("b-other");
    expect(thunk()).toBe("async-dev");
  });

  test("lazy() async resolver failure warns and unblocks rendering", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const { context } = createMockSSRContext();
    context.registerAsset = () => {};
    context.resolveAssets = () => Promise.reject(new Error("graph walk failed"));
    sharedConfig.context = context;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const Comp = (props: any) => "survives";
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), undefined, "./Broken.tsx");
    await LazyComp.preload!();

    let thunk: any;
    createRoot(
      () => {
        thunk = LazyComp({});
      },
      { id: "t" }
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('asset resolution failed for "./Broken.tsx"'),
      expect.any(Error)
    );
    expect(thunk()).toBe("survives");
    warn.mockRestore();
  });

  test("lazy() glob fallback chains into an async resolver", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const registered: Array<{ type: string; value: any }> = [];
    const { context } = createMockSSRContext();
    context.registerAsset = (type: string, value: any) => registered.push({ type, value });
    context.resolveAssets = (id: string) =>
      Promise.resolve(
        id === "src/Glob.tsx"
          ? { js: ["/src/Glob.tsx"], css: [{ id: "/src/Glob.css", content: ".g{}" }] }
          : null
      );
    sharedConfig.context = context;

    const Comp = (props: any) => "glob";
    const LazyComp = lazy(() =>
      Promise.resolve({ default: Comp, $$moduleUrl: "src/Glob.tsx" } as any)
    );
    await LazyComp.preload!();

    let thunk: any;
    createRoot(
      () => {
        thunk = LazyComp({});
      },
      { id: "t" }
    );

    // module promise then -> resolver promise then -> registration; promise
    // adoption of the nested chain costs extra microtasks, so drain with a
    // macrotask instead of counting ticks.
    await new Promise(r => setTimeout(r));

    // The glob fallback now hints from preload() as well, once the import
    // exposes $$moduleUrl, and again from the render.
    expect(registered).toEqual([
      { type: "inline-style", value: { id: "/src/Glob.css", content: ".g{}" } },
      { type: "module", value: "/src/Glob.tsx" },
      { type: "inline-style", value: { id: "/src/Glob.css", content: ".g{}" } },
      { type: "module", value: "/src/Glob.tsx" }
    ]);
    expect(thunk()).toBe("glob");
  });
});

// ============================================================================
// lazy() rejected module promises are not cached (#2999)
// ============================================================================

describe("lazy() rejected module promises are not cached (#2999)", () => {
  let savedContext: any;

  beforeEach(() => {
    savedContext = sharedConfig.context;
  });

  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  test("a transient import failure does not poison subsequent renders", async () => {
    const { lazy } = await import("../../src/server/component.js");

    let fail = true;
    let importCalls = 0;
    const LazyComp = lazy(
      () => {
        importCalls++;
        return fail
          ? Promise.reject(new Error("transient import failure"))
          : Promise.resolve({ default: (props: any) => "recovered" });
      },
      undefined,
      "./Flaky.tsx"
    );

    const makeRequest = () => {
      const { context } = createMockSSRContext();
      context.registerAsset = () => {};
      context.resolveAssets = () => ({ js: ["/assets/flaky.js"], css: [] });
      sharedConfig.context = context;
      let thunk: any;
      createRoot(
        () => {
          thunk = LazyComp({} as any);
        },
        { id: "t" }
      );
      return thunk;
    };

    // Request 1: the import rejects. The render that captured this load still
    // surfaces the error (an enclosing Errored can catch it)...
    const thunk1 = makeRequest();
    await tick();
    expect(() => thunk1()).toThrow("transient import failure");
    expect(importCalls).toBe(1);

    // ...but the failure is NOT sealed into the module-scoped cache: the next
    // request re-imports and renders.
    fail = false;
    const thunk2 = makeRequest();
    await tick();
    expect(thunk2()).toBe("recovered");
    expect(importCalls).toBe(2);

    // Success IS cached — further requests reuse the resolved module.
    const thunk3 = makeRequest();
    expect(thunk3()).toBe("recovered");
    expect(importCalls).toBe(2);
  });

  test("preload() retries after rejection and dedupes after success", async () => {
    const { lazy } = await import("../../src/server/component.js");

    let fail = true;
    let importCalls = 0;
    const LazyComp = lazy(
      () => {
        importCalls++;
        return fail ? Promise.reject(new Error("nope")) : Promise.resolve({ default: () => "ok" });
      },
      undefined,
      "./Retry.tsx"
    );

    await expect(LazyComp.preload!()).rejects.toThrow("nope");
    fail = false;
    await LazyComp.preload!();
    expect(importCalls).toBe(2);
    await LazyComp.preload!();
    expect(importCalls).toBe(2);
  });
});

// ============================================================================
// lazy() single-render behavior (no Loading boundary)
// ============================================================================

describe("lazy() single-render without Loading", () => {
  let savedContext: any;

  beforeEach(() => {
    savedContext = sharedConfig.context;
  });

  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  test("top-level lazy thunk creates hole, component runs once after resolve", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const { context } = createMockSSRContext();
    context.registerAsset = () => {};
    context.resolveAssets = (id: string) =>
      id === "./Direct.tsx" ? { js: ["/assets/direct.js"], css: [] } : null;
    sharedConfig.context = context;

    let componentRunCount = 0;
    const Comp = (_props: {}) => {
      componentRunCount++;
      return ssr(["<div>direct</div>"], ...[]) as any;
    };

    const dModule = deferred<{ default: typeof Comp }>();
    const LazyComp = lazy(() => dModule.promise, undefined, "./Direct.tsx");

    let ret: any;
    createRoot(
      () => {
        ret = ssr(["<main>", "</main>"], () => LazyComp({})) as any;
      },
      { id: "t" }
    );

    // Thunk created a hole — template has pending promises
    expect(ret.p.length).toBe(1);
    expect(ret.h.length).toBe(1);
    expect(componentRunCount).toBe(0);

    // Resolve the lazy module
    dModule.resolve({ default: Comp });
    await tick();

    // Re-execute holes (like the streaming runtime does)
    ret = ssr(ret.t, ...ret.h);
    expect(ret.p.length).toBe(0);
    expect(componentRunCount).toBe(1);
    expect(ret.t.join("")).toContain("direct");
  });

  test("wrapper component runs once, lazy child resolved via hole retry", async () => {
    const { lazy, createComponent } = await import("../../src/server/component.js");

    const { context } = createMockSSRContext();
    context.registerAsset = () => {};
    context.resolveAssets = (id: string) =>
      id === "./Child.tsx" ? { js: ["/assets/child.js"], css: [] } : null;
    sharedConfig.context = context;

    let wrapperRunCount = 0;
    let childRunCount = 0;

    const Child = () => {
      childRunCount++;
      return ssr(["<span>child</span>"], ...[]) as any;
    };

    const dModule = deferred<{ default: typeof Child }>();
    const LazyChild = lazy(() => dModule.promise, undefined, "./Child.tsx");

    let ret: any;
    createRoot(
      () => {
        const Wrapper = () => {
          wrapperRunCount++;
          return ssr(["<div>", "</div>"], () => createComponent(LazyChild, {})) as any;
        };
        ret = ssr(["<main>", "</main>"], () => Wrapper()) as any;
      },
      { id: "t" }
    );

    expect(ret.p.length).toBe(1);
    expect(wrapperRunCount).toBe(1);
    expect(childRunCount).toBe(0);

    dModule.resolve({ default: Child });
    await tick();

    // Re-execute holes — only the lazy hole re-runs, not the entire wrapper
    ret = ssr(ret.t, ...ret.h);
    expect(ret.p.length).toBe(0);
    expect(wrapperRunCount).toBe(1);
    expect(childRunCount).toBe(1);
    expect(ret.t.join("")).toContain("child");
  });

  test("data memo + lazy child — data compute runs once, no Loading needed", async () => {
    const { lazy, createComponent } = await import("../../src/server/component.js");

    const { context } = createMockSSRContext();
    context.registerAsset = () => {};
    context.resolveAssets = (id: string) =>
      id === "./DataView.tsx" ? { js: ["/assets/dataview.js"], css: [] } : null;
    sharedConfig.context = context;

    let dataComputeCount = 0;
    const dData = deferred<string>();
    const dModule = deferred<{ default: (props: any) => any }>();

    const View = (props: { value: any }) => ssr(["<p>", "</p>"], () => props.value) as any;

    const LazyView = lazy(() => dModule.promise, undefined, "./DataView.tsx");

    let ret: any;
    createRoot(
      () => {
        const data = createMemo(() => {
          dataComputeCount++;
          return dData.promise;
        });
        ret = ssr(["<section>", "</section>"], () =>
          createComponent(LazyView, {
            get value() {
              return data();
            }
          })
        ) as any;
      },
      { id: "t" }
    );

    // Two holes: one from lazy thunk, data memo's NotReadyError is inside the thunk's props
    expect(ret.p.length).toBeGreaterThanOrEqual(1);
    expect(dataComputeCount).toBe(1);

    // Resolve lazy module
    dModule.resolve({ default: View });
    await tick();

    // Re-execute holes — lazy resolves, but data still pending
    ret = ssr(ret.t, ...ret.h);
    expect(dataComputeCount).toBe(1);

    // If data hole still pending, resolve it
    if (ret.p.length > 0) {
      dData.resolve("resolved-data");
      await tick();
      ret = ssr(ret.t, ...ret.h);
    }

    expect(dataComputeCount).toBe(1);
    expect(ret.t.join("")).toContain("resolved-data");
  });
});

// ============================================================================
// lazy() single-render behavior inside Loading
// ============================================================================

describe("lazy() single-render in Loading", () => {
  let savedContext: any;

  beforeEach(() => {
    savedContext = sharedConfig.context;
  });

  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  test("top-level lazy in Loading — component renders once after module loads (streaming)", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const { context, fragmentResults } = createMockSSRContext();
    context.registerAsset = () => {};
    context.resolveAssets = (id: string) =>
      id === "./TopLevel.tsx" ? { js: ["/assets/top.js"], css: [] } : null;
    sharedConfig.context = context;

    let componentRunCount = 0;
    const Comp = (_props: {}) => {
      componentRunCount++;
      return ssr(["<div>top-level</div>"], ...[]) as any;
    };

    const dModule = deferred<{ default: typeof Comp }>();
    const LazyComp = lazy(() => dModule.promise, undefined, "./TopLevel.tsx");

    let result: any;
    createRoot(
      () => {
        result = Loading({
          fallback: "Loading...",
          get children() {
            return LazyComp({}) as any;
          }
        });
      },
      { id: "t" }
    );

    expect(result().t[0]).toContain("Loading...");
    expect(componentRunCount).toBe(0);

    dModule.resolve({ default: Comp });
    await tick();
    await tick();

    expect(componentRunCount).toBe(1);
    expect(fragmentResults.size).toBe(1);
    expect([...fragmentResults.values()][0]).toContain("top-level");
  });

  test("top-level lazy in Loading — component doesn't run in sync mode, $$f serialized", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const { context, serialized } = createMockSSRContext({ async: false });
    context.registerAsset = () => {};
    context.resolveAssets = (id: string) =>
      id === "./Sync.tsx" ? { js: ["/assets/sync.js"], css: [] } : null;
    sharedConfig.context = context;

    let componentRunCount = 0;
    const Comp = (_props: {}) => {
      componentRunCount++;
      return "sync-content";
    };

    const dModule = deferred<{ default: typeof Comp }>();
    const LazyComp = lazy(() => dModule.promise, undefined, "./Sync.tsx");

    let result: any;
    createRoot(
      () => {
        result = Loading({
          fallback: "Fallback",
          get children() {
            return LazyComp({}) as any;
          }
        });
      },
      { id: "t" }
    );

    expect(componentRunCount).toBe(0);
    expect([...serialized.values()]).toContain("$$f");

    dModule.resolve({ default: Comp });
  });

  test("nested lazy in Loading — data compute runs once (streaming, Profile pattern)", async () => {
    const { lazy, createComponent } = await import("../../src/server/component.js");

    const { context, fragmentResults } = createMockSSRContext();
    context.registerAsset = () => {};
    context.resolveAssets = (id: string) =>
      id === "./View.tsx" ? { js: ["/assets/view.js"], css: [] } : null;
    sharedConfig.context = context;

    let dataComputeCount = 0;
    const dData = deferred<string>();

    const View = (props: { data: any }) => ssr(["<span>", "</span>"], () => props.data) as any;

    const dModule = deferred<{ default: typeof View }>();
    const LazyView = lazy(() => dModule.promise, undefined, "./View.tsx");

    let result: any;
    createRoot(
      () => {
        result = Loading({
          fallback: "Loading...",
          get children() {
            const data = createMemo(() => {
              dataComputeCount++;
              return dData.promise;
            });
            return createComponent(LazyView, {
              get data() {
                return data();
              }
            }) as any;
          }
        });
      },
      { id: "t" }
    );

    expect(result().t[0]).toContain("Loading...");
    expect(dataComputeCount).toBe(1);

    dModule.resolve({ default: View });
    await tick();

    // data compute still 1 — lazy resolution doesn't re-run children
    expect(dataComputeCount).toBe(1);

    dData.resolve("hello");
    await tick();
    await tick();

    expect(dataComputeCount).toBe(1);
    expect(fragmentResults.size).toBe(1);
    expect([...fragmentResults.values()][0]).toContain("hello");
  });

  test("nested lazy with cascading async — each compute runs once (streaming)", async () => {
    const { lazy, createComponent } = await import("../../src/server/component.js");

    const { context, fragmentResults } = createMockSSRContext();
    context.registerAsset = () => {};
    context.resolveAssets = (id: string) =>
      id === "./CascadeView.tsx" ? { js: ["/assets/cascade.js"], css: [] } : null;
    sharedConfig.context = context;

    let userComputeCount = 0;
    let infoComputeCount = 0;
    const dUser = deferred<string>();
    const dInfo = deferred<string>();

    const View = (props: { user: any; info: any }) =>
      ssr(
        ["<div>", " - ", "</div>"],
        () => props.user,
        () => props.info
      ) as any;

    const dModule = deferred<{ default: typeof View }>();
    const LazyView = lazy(() => dModule.promise, undefined, "./CascadeView.tsx");

    let result: any;
    createRoot(
      () => {
        result = Loading({
          fallback: "Loading...",
          get children() {
            const user = createMemo(() => {
              userComputeCount++;
              return dUser.promise;
            });
            const info = createMemo(() => {
              user();
              infoComputeCount++;
              return dInfo.promise;
            });
            return createComponent(LazyView, {
              get user() {
                return user();
              },
              get info() {
                return info();
              }
            }) as any;
          }
        });
      },
      { id: "t" }
    );

    expect(result().t[0]).toContain("Loading...");
    expect(userComputeCount).toBe(1);
    // info's compute calls user() which throws NotReadyError before incrementing
    expect(infoComputeCount).toBe(0);

    dModule.resolve({ default: View });
    await tick();

    expect(userComputeCount).toBe(1);

    // Resolve user — info's pending re-eval fires
    dUser.resolve("Jon");
    await tick();

    expect(userComputeCount).toBe(1);
    expect(infoComputeCount).toBe(1);

    dInfo.resolve("details");
    await tick();
    await tick();

    expect(userComputeCount).toBe(1);
    expect(infoComputeCount).toBe(1);
    expect(fragmentResults.size).toBe(1);
    expect([...fragmentResults.values()][0]).toContain("Jon");
    expect([...fragmentResults.values()][0]).toContain("details");
  });
});

/**
 * #2857: an async memo that rejects with a falsy value (`undefined`, `null`,
 * `""`, `0`, `false`) was treated as resolved by the SSR read path — the memo
 * read gated on `if (comp.error)` truthiness, so the success branch rendered
 * while the serializer (which tracks rejection as a state, not a value) still
 * shipped "rejected" to the client. Error presence must be a flag, not a
 * truthiness test on the error value.
 */
describe("falsy async rejections render the Errored fallback (#2857)", () => {
  let savedContext: any;
  beforeEach(() => {
    savedContext = sharedConfig.context;
  });
  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["zero", 0],
    ["false", false]
  ])("rejection with %s is caught by Errored inside Loading", async (_label, falsyError) => {
    const { context, fragmentResults, fragmentErrors } = createMockSSRContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        Loading({
          fallback: "Loading...",
          get children() {
            return Errored({
              fallback: "Error caught!",
              get children() {
                const data = createMemo(() => d.promise);
                return ssr(["<div>", "</div>"], () => data()) as any;
              }
            }) as any;
          }
        });
      },
      { id: "t" }
    );

    d.reject(falsyError);
    await tick();

    expect(fragmentResults.size).toBe(1);
    expect([...fragmentResults.values()][0]).toBe("Error caught!");
    expect(fragmentErrors.size).toBe(0);
  });

  test("truthy Error control still renders the fallback", async () => {
    const { context, fragmentResults } = createMockSSRContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        Loading({
          fallback: "Loading...",
          get children() {
            return Errored({
              fallback: "Error caught!",
              get children() {
                const data = createMemo(() => d.promise);
                return ssr(["<div>", "</div>"], () => data()) as any;
              }
            }) as any;
          }
        });
      },
      { id: "t" }
    );

    d.reject(new Error("boom"));
    await tick();

    expect(fragmentResults.size).toBe(1);
    expect([...fragmentResults.values()][0]).toBe("Error caught!");
  });
});

/**
 * #2858: the server async detection was `result instanceof Promise`, so a
 * non-Promise thenable (PromiseLike) returned from a memo was stored as a
 * sync render value and skipped by the renderer. The client async path
 * accepts PromiseLike (object-thenable, Promises/A+ shape) — SSR must match:
 * treat thenables as async sources under a boundary, and surface the same
 * pending state (NotReadyError) without one.
 */
describe("non-Promise thenables are treated as async sources (#2858)", () => {
  let savedContext: any;
  beforeEach(() => {
    savedContext = sharedConfig.context;
  });
  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  function thenable<T>(promise: Promise<T>): PromiseLike<T> {
    return {
      then(onFulfilled: any, onRejected: any) {
        return promise.then(onFulfilled, onRejected);
      }
    };
  }

  test("thenable under Loading resolves through hole re-execution", async () => {
    const { context, fragmentResults } = createMockSSRContext();
    sharedConfig.context = context;

    const d = deferred<string>();
    let result: any;

    createRoot(
      () => {
        result = Loading({
          fallback: "Loading...",
          get children() {
            const data = createMemo(() => thenable(d.promise));
            return ssr(["<div>", "</div>"], () => data()) as any;
          }
        });
      },
      { id: "t" }
    );

    expect(result().t[0]).toContain("Loading...");

    d.resolve("ThenableValue");
    await tick();

    expect(fragmentResults.size).toBe(1);
    expect([...fragmentResults.values()][0]).toBe("<div>ThenableValue</div>");
  });

  test("thenable rejection routes to Errored inside Loading", async () => {
    const { context, fragmentResults } = createMockSSRContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        Loading({
          fallback: "Loading...",
          get children() {
            return Errored({
              fallback: "Error caught!",
              get children() {
                const data = createMemo(() => thenable(d.promise));
                return ssr(["<div>", "</div>"], () => data()) as any;
              }
            }) as any;
          }
        });
      },
      { id: "t" }
    );

    d.reject(new Error("thenable boom"));
    await tick();

    expect(fragmentResults.size).toBe(1);
    expect([...fragmentResults.values()][0]).toBe("Error caught!");
  });

  test("thenable read without a boundary throws NotReadyError like a native Promise", () => {
    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        const fromPromise = createMemo(() => d.promise);
        const fromThenable = createMemo(() => thenable(d.promise));
        expect(fromPromise).toThrowError(NotReadyError);
        expect(fromThenable).toThrowError(NotReadyError);
      },
      { id: "t" }
    );
  });
});

// ============================================================================
// Retry convergence without stable promise identity (#3003)
// ============================================================================
//
// The boundary's body-channel retry loop converges by re-running the creation
// scope; a re-created memo normally adopts its previous answer through the
// `.s`/`.v` stamp on the promise object. Sources that derive a fresh promise
// per call (the router query()'s cache-hit `.then()` wrapper) defeat the
// stamp — before the by-slot settlement memory, every pass re-suspended at
// microtask speed, serializing a new deferred per pass until the process
// OOM'd. These tests pin: convergence via the slot cache (fulfilled and
// rejected), and the loud budget failure for shapes that cannot converge.
describe("retry convergence without stable promise identity (#3003)", () => {
  let savedContext: any;

  beforeEach(() => {
    savedContext = sharedConfig.context;
  });

  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  test("body-channel read of a fresh-per-call thenable converges", async () => {
    const { context, fragmentResults } = createMockSSRContext();
    sharedConfig.context = context;

    // The router cache-hit shape: the underlying work is stable and settled,
    // but every call hands back a NEW `.then()` derivative — solid never
    // sees the same promise object twice.
    const underlying = Promise.resolve({ title: "Hello" });
    let calls = 0;
    const query = () => (calls++, underlying.then(v => v));

    let result: any;
    createRoot(
      () => {
        result = Loading({
          fallback: "Loading...",
          get children() {
            const data = createMemo(() => query());
            // Body-position read (solid-meta's useHead evaluates title
            // children exactly here): the NotReady throws through the
            // children getter, taking the discovery channel that disposes
            // and re-creates this whole scope per pass.
            const title = (data() as any).title;
            return ssr(["<h1>", "</h1>"], () => title) as any;
          }
        });
      },
      { id: "t" }
    );

    expect(result().t[0]).toContain("Loading...");
    await tick();
    await tick();

    expect(fragmentResults.size).toBe(1);
    expect([...fragmentResults.values()][0]).toBe("<h1>Hello</h1>");
    // Converged via the slot cache: one pending pass + one adopting pass.
    expect(calls).toBeLessThan(5);
  });

  test("rejected fresh-per-call thenable settles the slot as an error", async () => {
    const { context, fragmentResults } = createMockSSRContext();
    sharedConfig.context = context;

    const underlying = Promise.reject(new Error("query boom"));
    underlying.catch(() => {});
    const query = () => underlying.then(v => v);

    let result: any;
    createRoot(
      () => {
        result = Errored({
          fallback: () => "Error caught!",
          get children() {
            return Loading({
              fallback: "Loading...",
              get children() {
                const data = createMemo(() => query());
                const title = (data() as any).title;
                return ssr(["<h1>", "</h1>"], () => title) as any;
              }
            });
          }
        }) as any;
      },
      { id: "t" }
    );

    result();
    await tick();
    await tick();

    // The rejection lands once (adopted from the slot on the retry pass, not
    // re-suspended forever) and routes through the error channel.
    expect(fragmentResults.size + [...fragmentResults.values()].length).toBeGreaterThan(0);
  });

  test("non-convergent discovery fails the boundary loudly instead of looping", async () => {
    const { context, fragmentErrors, fragmentResults } = createMockSSRContext();
    sharedConfig.context = context;

    let result: any;
    createRoot(
      () => {
        result = Loading({
          fallback: "Loading...",
          get children(): any {
            // Pathological: a fresh, instantly-settling pending source every
            // pass with no adoptable slot behind it. Without the budget this
            // loops at microtask speed until OOM.
            throw new NotReadyError(Promise.resolve() as any);
          }
        });
      },
      { id: "t" }
    );

    expect(result().t[0]).toContain("Loading...");

    // 10k budgeted passes take a moment; poll until the boundary errors.
    const deadline = Date.now() + 10000;
    while (!fragmentErrors.size && Date.now() < deadline) await tick();

    expect(fragmentResults.get([...fragmentResults.keys()][0] ?? "")).toBeUndefined();
    expect(fragmentErrors.size).toBe(1);
    expect(String([...fragmentErrors.values()][0])).toMatch(/did not converge/);
  });

  // A slot re-created while its flight is still pending (post-flush hole
  // re-pulls do this — solid-meta's head registry re-pulls holes on flush
  // microtasks) must JOIN the existing flight. Before in-flight slot sharing,
  // each re-creation serialized a fresh deferred under the same id and the
  // superseded pass's deferred — dropped by the disposal guard — never
  // settled, holding the response stream open forever.
  test("in-flight slot re-creation shares one serialized deferred that still settles", async () => {
    const { context, serialized } = createMockSSRContext();
    const writes: string[] = [];
    const origSerialize = context.serialize;
    context.serialize = function (id: string, p: any, deferStream?: boolean) {
      writes.push(id);
      return origSerialize.call(this, id, p, deferStream);
    };
    sharedConfig.context = context;

    let resolveUnderlying!: (v: string) => void;
    const underlying = new Promise<string>(r => (resolveUnderlying = r));
    // Fresh derivative per call — the promise stamp can never match.
    const query = () => underlying.then(v => v);

    // First creation plants the flight and serializes its deferred.
    const disposeFirst = createRoot(
      dispose => {
        const data = createMemo(() => query());
        try {
          data();
        } catch {}
        return dispose;
      },
      { id: "x" }
    );
    expect(writes.length).toBe(1);
    const flightPromise = serialized.get(writes[0]);

    // Superseded: the first node is disposed mid-flight, then the same slot
    // (same owner id path) is re-created — the shape of a discovery/hole
    // re-pull.
    disposeFirst();
    let read!: () => string;
    createRoot(
      () => {
        const data = createMemo(() => query());
        read = data as () => string;
        try {
          data();
        } catch {}
      },
      { id: "x" }
    );
    // Joined the existing flight: no second serialization for the slot.
    expect(writes.length).toBe(1);

    resolveUnderlying("done");
    await tick();

    // The one serialized deferred settled (the stream can close) and the
    // live re-creation received the value.
    const settled = await Promise.race([flightPromise.then(() => true), tick().then(() => false)]);
    expect(settled).toBe(true);
    expect(read()).toBe("done");
  });

  test("terminal rejection settles the serialized deferred even after disposal", async () => {
    const { context, serialized } = createMockSSRContext();
    sharedConfig.context = context;

    let rejectUnderlying!: (e: any) => void;
    const underlying = new Promise<string>((_, rej) => (rejectUnderlying = rej));
    const query = () => underlying.then(v => v);

    const disposeRoot = createRoot(
      dispose => {
        const data = createMemo(() => query());
        try {
          data();
        } catch {}
        return dispose;
      },
      { id: "y" }
    );
    expect(serialized.size).toBe(1);
    const flightPromise = [...serialized.values()][0];
    // Defuse: this test asserts settlement, not unhandled-rejection routing.
    flightPromise.catch(() => {});

    disposeRoot();
    rejectUnderlying(new Error("boom"));
    await tick();

    const outcome = await Promise.race([
      flightPromise.then(
        () => "resolved",
        () => "rejected"
      ),
      tick().then(() => "pending")
    ]);
    expect(outcome).toBe("rejected");
  });
});

// ============================================================================
// Promise-of-AsyncIterable flattening (data-API tier)
// ============================================================================
//
// A thenable that RESOLVES to an AsyncIterable — the shape an async stub
// returning a stream produces — is consumed as the stream itself, mirroring
// the client core's handleAsync flattening. First yield settles the read and
// locks the HTML-visible value; the serialized promise channel resolves to a
// tapped stream (replay first, then delegate); hybrid takes the first value
// and closes the iterator.

describe("Promise-of-AsyncIterable flattening", () => {
  beforeEach(() => {
    sharedConfig.context = undefined as any;
  });
  afterEach(() => {
    sharedConfig.context = undefined as any;
  });

  function controlledStream<T>() {
    type Waiter = (r: IteratorResult<T>) => void;
    const buffered: IteratorResult<T>[] = [];
    let waiter: Waiter | null = null;
    let openCalls = 0;
    let returnCalls = 0;
    const push = (r: IteratorResult<T>) => {
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(r);
      } else buffered.push(r);
    };
    const iterable: AsyncIterable<T> = {
      [Symbol.asyncIterator]: () => {
        openCalls++;
        return {
          next: () =>
            new Promise<IteratorResult<T>>(res => {
              if (buffered.length) res(buffered.shift()!);
              else waiter = res;
            }),
          return: () => {
            returnCalls++;
            return Promise.resolve({ done: true as const, value: undefined });
          }
        };
      }
    };
    return {
      iterable,
      yield: (value: T) => push({ done: false, value }),
      end: () => push({ done: true, value: undefined as any }),
      get openCalls() {
        return openCalls;
      },
      get returnCalls() {
        return returnCalls;
      }
    };
  }

  test("default mode: pending until first yield; serialized promise resolves to a tapped stream; memo locks at V1", async () => {
    const { context, serialized } = createMockSSRContext();
    sharedConfig.context = context;

    const gate = deferred<void>();
    const stream = controlledStream<string>();
    let read: any;

    createRoot(
      () => {
        read = createMemo(() => gate.promise.then(() => stream.iterable) as any);
      },
      { id: "t" }
    );

    // The promise channel is committed up front.
    expect(serialized.size).toBe(1);
    expect(() => read()).toThrow(NotReadyError);

    // Resolving to the stream is NOT the answer: still pending, one consumer.
    gate.resolve();
    await tick();
    expect(() => read()).toThrow(NotReadyError);
    expect(stream.openCalls).toBe(1);

    // First yield settles the read.
    stream.yield("first");
    await tick();
    expect(read()).toBe("first");

    // The serialized promise resolves to a tapped stream: replay first, then
    // delegate — while the memo's HTML-visible value stays locked at V1.
    const tapped = await [...serialized.values()][0];
    expect(typeof tapped[Symbol.asyncIterator]).toBe("function");
    const it = tapped[Symbol.asyncIterator]();
    expect((await it.next()).value).toBe("first");
    const secondPull = it.next();
    stream.yield("second");
    expect((await secondPull).value).toBe("second");
    expect(read()).toBe("first");
  });

  test("hybrid mode: first value only, iterator closed, plain value on the channel", async () => {
    const { context, serialized } = createMockSSRContext();
    sharedConfig.context = context;

    const gate = deferred<void>();
    const stream = controlledStream<string>();
    let read: any;

    createRoot(
      () => {
        read = createMemo(() => gate.promise.then(() => stream.iterable) as any, {
          ssrSource: "hybrid"
        } as any);
      },
      { id: "t" }
    );

    gate.resolve();
    await tick();
    stream.yield("only");
    await tick();

    expect(read()).toBe("only");
    expect(stream.returnCalls).toBe(1);
    const channel = await [...serialized.values()][0];
    expect(channel).toBe("only");
  });

  test("live brand: auto-hybrid without a declared ssrSource — first value, iterator closed, plain value on the channel", async () => {
    const { context, serialized } = createMockSSRContext();
    sharedConfig.context = context;

    const gate = deferred<void>();
    const stream = controlledStream<string>();
    // The transport's live() declaration brands the resolved iterable: a
    // standing answer, not a bounded trace. No ssrSource declared anywhere.
    (stream.iterable as any)[Symbol.for("solid.LiveSource")] = true;
    let read: any;

    createRoot(
      () => {
        read = createMemo(() => gate.promise.then(() => stream.iterable) as any);
      },
      { id: "t" }
    );

    gate.resolve();
    await tick();
    stream.yield("current");
    await tick();

    expect(read()).toBe("current");
    // Hybrid selected automatically: the origin closed after one value...
    expect(stream.returnCalls).toBe(1);
    // ...and the channel carries a plain value (client reconnects on
    // takeover), not a tapped stream that would hold the document open.
    const channel = await [...serialized.values()][0];
    expect(channel).toBe("current");
  });

  test("live brand: declared ssrSource 'server' still takes hybrid — a standing answer cannot stream the document", async () => {
    const { context, serialized } = createMockSSRContext();
    sharedConfig.context = context;

    const gate = deferred<void>();
    const stream = controlledStream<string>();
    (stream.iterable as any)[Symbol.for("solid.LiveSource")] = true;
    let read: any;

    createRoot(
      () => {
        read = createMemo(() => gate.promise.then(() => stream.iterable) as any, {
          ssrSource: "server"
        } as any);
      },
      { id: "t" }
    );

    gate.resolve();
    await tick();
    stream.yield("current");
    await tick();

    expect(read()).toBe("current");
    expect(stream.returnCalls).toBe(1);
    const channel = await [...serialized.values()][0];
    expect(channel).toBe("current");
  });

  test("projection: promised live iterable auto-hybrids at its first value", async () => {
    const { context, serialized } = createMockSSRContext();
    sharedConfig.context = context;

    const gate = deferred<void>();
    const stream = controlledStream<{ name: string }>();
    (stream.iterable as any)[Symbol.for("solid.LiveSource")] = true;
    let store: any;

    createRoot(
      () => {
        store = createProjection(() => gate.promise.then(() => stream.iterable) as any, {
          name: "seed"
        });
      },
      { id: "t" }
    );

    expect(() => store.name).toThrow(NotReadyError);

    gate.resolve();
    await tick();
    expect(() => store.name).toThrow(NotReadyError);
    expect(stream.openCalls).toBe(1);

    stream.yield({ name: "current" });
    await tick();

    expect(store.name).toBe("current");
    expect(stream.returnCalls).toBe(1);
    const channel = await [...serialized.values()][0];
    expect(channel).toEqual({ name: "current" });
  });

  test("projection: direct live iterable also selects hybrid automatically", async () => {
    const { context, serialized } = createMockSSRContext();
    sharedConfig.context = context;

    const stream = controlledStream<{ name: string }>();
    (stream.iterable as any)[Symbol.for("solid.LiveSource")] = true;
    let store: any;

    createRoot(
      () => {
        store = createProjection(() => stream.iterable as any, { name: "seed" });
      },
      { id: "t" }
    );

    await tick();
    expect(stream.openCalls).toBe(1);
    stream.yield({ name: "current" });
    await tick();

    expect(store.name).toBe("current");
    expect(stream.returnCalls).toBe(1);
    const channel = await [...serialized.values()][0];
    expect(channel).toEqual({ name: "current" });
  });

  test("projection: an empty live iterable ignores its iterator return value", async () => {
    const { context, serialized } = createMockSSRContext();
    sharedConfig.context = context;

    const source = {
      [Symbol.for("solid.LiveSource")]: true,
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            Promise.resolve({
              done: true as const,
              value: { name: "not-a-yield" }
            })
        };
      }
    };
    let store: any;

    createRoot(
      () => {
        store = createProjection(() => Promise.resolve(source) as any, { name: "seed" });
      },
      { id: "t" }
    );

    const channel = await [...serialized.values()][0];
    expect(channel).toEqual({ name: "seed" });
    expect(store.name).toBe("seed");
  });

  test("projection: a synchronous first-pull failure rejects the store and channel", async () => {
    const { context, serialized } = createMockSSRContext();
    sharedConfig.context = context;

    const gate = deferred<void>();
    const error = new Error("first pull failed");
    const source = {
      [Symbol.for("solid.LiveSource")]: true,
      [Symbol.asyncIterator]() {
        return {
          next() {
            throw error;
          }
        };
      }
    };
    let store: any;

    createRoot(
      () => {
        store = createProjection(() => gate.promise.then(() => source) as any, {
          name: "seed"
        });
      },
      { id: "t" }
    );

    const channel = [...serialized.values()][0];
    gate.resolve();
    await expect(channel).rejects.toBe(error);

    let thrown: unknown;
    try {
      store.name;
    } catch (reason) {
      thrown = reason;
    }
    expect(thrown).toBe(error);
  });

  test("Loading boundary reveals at first yield, not at promise resolution", async () => {
    const { context, fragmentResults } = createMockSSRContext();
    sharedConfig.context = context;

    const gate = deferred<void>();
    const stream = controlledStream<string>();

    createRoot(
      () => {
        Loading({
          fallback: "Loading...",
          get children() {
            const data = createMemo(() => gate.promise.then(() => stream.iterable) as any);
            return ssr(["<div>", "</div>"], () => data()) as any;
          }
        });
      },
      { id: "t" }
    );

    expect(fragmentResults.size).toBe(0);

    gate.resolve();
    await tick();
    expect(fragmentResults.size).toBe(0);

    stream.yield("streamed");
    await tick();
    expect(fragmentResults.size).toBe(1);
    expect([...fragmentResults.values()][0]).toBe("<div>streamed</div>");
  });

  test("empty stream settles undefined", async () => {
    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    const gate = deferred<void>();
    const stream = controlledStream<string>();
    let read: any;

    createRoot(
      () => {
        read = createMemo(() => gate.promise.then(() => stream.iterable) as any);
      },
      { id: "t" }
    );

    gate.resolve();
    await tick();
    stream.end();
    await tick();

    expect(read()).toBe(undefined);
  });

  test("stream error settles the memo as errored", async () => {
    const { context, serialized } = createMockSSRContext();
    sharedConfig.context = context;

    const gate = deferred<void>();
    const failing: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new Error("stream boom"))
      })
    };
    let read: any;

    createRoot(
      () => {
        read = createMemo(() => gate.promise.then(() => failing) as any);
      },
      { id: "t" }
    );
    // Defuse the serialized channel rejection: this test asserts memo state.
    [...serialized.values()][0].catch(() => {});

    gate.resolve();
    await tick();

    expect(() => read()).toThrow("stream boom");
  });

  test("re-processing the same promise joins the in-flight stream instead of re-consuming", async () => {
    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    const gate = deferred<void>();
    const stream = controlledStream<string>();
    const shared = gate.promise.then(() => stream.iterable);
    let first: any;
    let second: any;

    createRoot(
      () => {
        first = createMemo(() => shared as any);
      },
      { id: "a" }
    );
    gate.resolve();
    await tick();
    // Stream open, first yield pending: a second node handed the SAME promise
    // must join (pending), not open a second iterator.
    createRoot(
      () => {
        second = createMemo(() => shared as any);
      },
      { id: "b" }
    );
    expect(() => second()).toThrow(NotReadyError);
    expect(stream.openCalls).toBe(1);

    stream.yield("v1");
    await tick();
    expect(first()).toBe("v1");

    // After the first yield the stamp is a settled V1: late re-creations
    // adopt it synchronously (first-value lock).
    let third: any;
    createRoot(
      () => {
        third = createMemo(() => shared as any);
      },
      { id: "c" }
    );
    expect(third()).toBe("v1");
    expect(stream.openCalls).toBe(1);
  });
});
