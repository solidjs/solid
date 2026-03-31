/** @vitest-environment node */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import {
  createRoot,
  createMemo,
  createSignal,
  createProjection,
  NotReadyError,
  getOwner,
  For,
  Show,
  Errored,
  ssrRunInScope
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
// dom-expressions/src/server.js. At runtime, dom-expressions provides them
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

function createMockSSRContext(options: { async?: boolean } = {}) {
  const serialized = new Map<string, any>();
  const registeredFragments = new Set<string>();
  const fragmentResults = new Map<string, string | undefined>();
  const fragmentErrors = new Map<string, any>();

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
        fragmentResults.set(key, value);
        if (error !== undefined) fragmentErrors.set(key, error);
        return true;
      };
    }
  };

  return { context, serialized, registeredFragments, fragmentResults, fragmentErrors };
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
                children: (item: () => number) => {
                  const data = createMemo(() => d.promise.then((v: string) => `${v}-${item()}`));
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
  // 6. Throw Path (boundary re-render)
  // --------------------------------------------------------------------------

  describe("Throw Path (boundary re-render)", () => {
    test("direct memo read in component body triggers full re-render", async () => {
      const { context, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();
      let resolved = false;
      d.promise.then(() => {
        resolved = true;
      });

      let renderCount = 0;
      let result: any;

      createRoot(
        () => {
          result = Loading({
            fallback: "Loading...",
            get children() {
              renderCount++;
              const data = createMemo(() => {
                if (resolved) return "Hello World";
                return d.promise;
              });
              // Direct read in component body — NOT wrapped in template hole
              const val = data();
              return ssr(["<div>", "</div>"], val) as any;
            }
          });
        },
        { id: "t" }
      );

      // Should have rendered once (and thrown)
      expect(renderCount).toBe(1);
      // Should return fallback
      expect(result().t[0]).toContain("Loading...");

      d.resolve("Hello World");
      await tick();

      // Should have re-rendered (throw path calls runInitially again)
      expect(renderCount).toBe(2);
      // Fragment should resolve with correct content
      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBe("<div>Hello World</div>");
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
                  return ssr(
                    ["<div>", "</div>"],
                    ssrRunInScope(() => data())
                  ) as any;
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
      expect([...serialized.values()].some(v => v instanceof Error && v.message === "Async fetch failed")).toBe(
        true
      );
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
                  fallback: (e: any) => `ItemError: ${String(e.message || e)}`,
                  get children() {
                    return ssr(
                      ["<div>", "</div>"],
                      ssrRunInScope(() => item().title)
                    ) as any;
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

    test("Throw path — error during re-render after async resolution", async () => {
      const { context, fragmentResults, fragmentErrors } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();
      let resolved = false;
      d.promise.then(() => {
        resolved = true;
      });

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const data = createMemo(() => {
                if (resolved) return "resolved";
                return d.promise;
              });
              // Direct read — throw path
              const val = data();
              if (resolved) {
                // On re-render after resolution, throw a regular error
                throw new Error("Re-render explosion");
              }
              return ssr(["<div>", "</div>"], val) as any;
            }
          });
        },
        { id: "t" }
      );

      d.resolve("resolved");
      await tick();

      // IIFE catch fires → done(undefined, err) → error serialized
      expect(fragmentResults.size).toBe(1);
      expect([...fragmentResults.values()][0]).toBeUndefined();
      expect(fragmentErrors.size).toBe(1);
      expect(([...fragmentErrors.values()][0] as Error).message).toBe("Re-render explosion");
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
              fallbackError = err;
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

    test("throw path: IDs are stable across boundary re-renders", async () => {
      const { context, fragmentResults } = createMockSSRContext();
      sharedConfig.context = context;

      const d = deferred<string>();
      let resolved = false;
      d.promise.then(() => {
        resolved = true;
      });

      const allMemoIds: string[][] = [];

      createRoot(
        () => {
          Loading({
            fallback: "Loading...",
            get children() {
              const memoIds: string[] = [];

              const a = createMemo(() => {
                memoIds.push(getOwner()!.id!);
                return "static";
              });

              const b = createMemo(() => {
                memoIds.push(getOwner()!.id!);
                if (resolved) return "resolved";
                return d.promise;
              });

              allMemoIds.push(memoIds);

              // Direct read — throw path
              const val = b();
              return ssr(["<div>", "-", "</div>"], () => a(), val) as any;
            }
          });
        },
        { id: "t" }
      );

      d.resolve("resolved");
      await tick();

      // Should have been called twice (initial throw + successful re-render)
      expect(allMemoIds.length).toBe(2);
      // IDs should be identical — dispose resets _childCount so sequential
      // IDs are regenerated in the same order
      expect(allMemoIds[0]).toEqual(allMemoIds[1]);
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
// structurally by dom-expressions:
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

  test("async createMemo does not call block (handled by dom-expressions root)", () => {
    const { context, blocked } = createBlockTrackingContext();
    sharedConfig.context = context;

    const d = deferred<string>();

    createRoot(
      () => {
        createMemo(() => d.promise);
      },
      { id: "t" }
    );

    // processResult no longer calls ctx.block — blocking is structural in dom-expressions
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
        createProjection(() => d.promise);
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
            const data = createMemo(() => d.promise, undefined, { deferStream: true });
            return ssr(["<div>", "</div>"], () => data()) as any;
          }
        });
      },
      { id: "t" }
    );

    // processResult does not block — deferStream blocking happens in dom-expressions' serialize
    expect(blocked.size).toBe(0);
    // But deferStream IS passed through to serialize for dom-expressions to handle
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
        createMemo(() => d.promise, undefined, { deferStream: true });
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
            const [data] = createSignal(() => d.promise, undefined, { deferStream: true });
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

    // processResult no longer blocks — serialize handles deferStream blocking in dom-expressions
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

  test("ssrSource 'initial' skips computation on createMemo, uses initialValue", () => {
    let computeRan = false;
    let result: any;
    createRoot(
      () => {
        const read = createMemo(
          () => {
            computeRan = true;
            return 999;
          },
          42,
          { ssrSource: "initial" }
        );
        result = read();
      },
      { id: "t" }
    );

    expect(computeRan).toBe(false);
    expect(result).toBe(42);
  });

  test("ssrSource 'client' skips computation on createMemo, uses initialValue", () => {
    let computeRan = false;
    let result: any;
    createRoot(
      () => {
        const read = createMemo(
          () => {
            computeRan = true;
            return 999;
          },
          42,
          { ssrSource: "client" }
        );
        result = read();
      },
      { id: "t" }
    );

    expect(computeRan).toBe(false);
    expect(result).toBe(42);
  });

  test("ssrSource 'hybrid' runs computation (same as default for Promises)", () => {
    const { context, serializeLog } = createSerializeTrackingContext();
    sharedConfig.context = context;

    const d = deferred<number>();
    let result: any;
    createRoot(
      () => {
        const read = createMemo(() => d.promise, undefined, { ssrSource: "hybrid" });
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
        const read = createMemo(() => d.promise, undefined, { ssrSource: "server" });
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

  test("ssrSource 'initial' still creates owner for ID parity", () => {
    let ownerCreated = false;
    createRoot(
      () => {
        createMemo(() => 1, 0, { ssrSource: "initial" });
        const second = createMemo(() => 2, 0);
        ownerCreated = second() === 2;
      },
      { id: "t" }
    );

    expect(ownerCreated).toBe(true);
  });

  test("ssrSource 'initial' on createSignal(fn) skips computation", () => {
    let computeRan = false;
    let result: any;
    createRoot(
      () => {
        const [read] = createSignal(
          () => {
            computeRan = true;
            return 999;
          },
          42,
          { ssrSource: "initial" }
        );
        result = read();
      },
      { id: "t" }
    );

    expect(computeRan).toBe(false);
    expect(result).toBe(42);
  });

  test("ssrSource 'initial' on createProjection skips computation", () => {
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
          { ssrSource: "initial" }
        );
      },
      { id: "t" }
    );

    expect(computeRan).toBe(false);
    expect(store.name).toBe("initial");
  });

  test("ssrSource 'initial' does not serialize", () => {
    const { context, serializeLog } = createSerializeTrackingContext();
    sharedConfig.context = context;

    createRoot(
      () => {
        createMemo(() => Promise.resolve(42), undefined, { ssrSource: "initial" });
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
          undefined,
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
          undefined,
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
          undefined,
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
          undefined,
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
          undefined,
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
          undefined,
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
          undefined,
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
          undefined,
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
          "fallback",
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

    // comp.value should still be the initial value (no yield to update it)
    expect(read()).toBe("fallback");
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
          undefined,
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

  test("Promise projection throws NotReadyError until resolved", async () => {
    const { context } = createStreamTrackingContext();
    sharedConfig.context = context;

    const d = deferred<{ name: string }>();
    let store: any;

    createRoot(
      () => {
        store = createProjection(() => d.promise, { name: "init" });
      },
      { id: "t" }
    );

    expect(() => store.name).toThrow(NotReadyError);

    d.resolve({ name: "resolved" });
    await tick();

    expect(store.name).toBe("resolved");
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
          { name: "init" }
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

  test("lazy() throws when rendered without moduleUrl", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const { context } = createMockSSRContext();
    context.resolveAssets = () => null;
    sharedConfig.context = context;

    const Comp = (props: any) => "Hello";
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }));
    await LazyComp.preload!();

    expect(() => {
      createRoot(
        () => {
          LazyComp({});
        },
        { id: "t" }
      );
    }).toThrow(/moduleUrl/);
  });

  test("lazy() throws when no manifest is set (no resolveAssets on context)", async () => {
    const { lazy } = await import("../../src/server/component.js");

    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    const Comp = (props: any) => "Hello";
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), "./Comp.tsx");
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

    const registered: Array<{ type: string; url: string }> = [];
    const modules: Record<string, string> = {};
    const { context } = createMockSSRContext();
    context.registerAsset = (type: string, url: string) => registered.push({ type, url });
    context.registerModule = (moduleUrl: string, entryUrl: string) => {
      modules[moduleUrl] = entryUrl;
    };
    context.resolveAssets = (id: string) => {
      if (id === "./MyComp.tsx")
        return { js: ["/assets/MyComp-abc123.js", "/assets/shared-def456.js"], css: [] };
      return null;
    };
    sharedConfig.context = context;

    const Comp = (props: any) => "Hello";
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), "./MyComp.tsx");
    await LazyComp.preload!();

    createRoot(
      () => {
        LazyComp({});
      },
      { id: "t" }
    );

    expect(registered).toEqual([
      { type: "module", url: "/assets/MyComp-abc123.js" },
      { type: "module", url: "/assets/shared-def456.js" }
    ]);
    expect(modules).toEqual({ "./MyComp.tsx": "/assets/MyComp-abc123.js" });
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
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), "./Styled.tsx");
    await LazyComp.preload!();

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
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), "./NotInManifest.tsx");
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
    const LazyComp = lazy(() => Promise.resolve({ default: Comp }), "./Comp.tsx");
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
    const LazyComp = lazy(() => d.promise, "./Async.tsx");

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
    const LazyComp = lazy(() => dModule.promise, "./Direct.tsx");

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
    const LazyChild = lazy(() => dModule.promise, "./Child.tsx");

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

    const LazyView = lazy(() => dModule.promise, "./DataView.tsx");

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
    const LazyComp = lazy(() => dModule.promise, "./TopLevel.tsx");

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
    const LazyComp = lazy(() => dModule.promise, "./Sync.tsx");

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
    const LazyView = lazy(() => dModule.promise, "./View.tsx");

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
    const LazyView = lazy(() => dModule.promise, "./CascadeView.tsx");

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
