/** @vitest-environment node */
/**
 * #2900 — SSR async retry paths must reset owner child state before
 * re-running a compute, mirroring the client (which disposes children and
 * resets `_childCount` on every recompute). Without the reset, each retry
 * keeps allocating child hydration ids where the failed run left off, so the
 * eventual successful run's ids drift ahead of the client's — serialized
 * values and DOM nodes get claimed under the wrong hydration keys. Four
 * sites: serverEffect retry, async createMemo rerun, createProjection rerun,
 * and disposeOwner's leaf fast path (id slots consumed without child owners,
 * hit by the Loading discovery retry). Failed runs' onCleanups also fire at
 * retry now (client parity), which is why the retrying primitives register
 * their `comp.disposed` lifecycle cleanup on the creation context instead of
 * on their own owner — a retry must not cancel itself.
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import {
  createRoot,
  createMemo,
  createRenderEffect,
  createProjection,
  createUniqueId,
  getOwner
} from "../../src/server/index.js";
import { Loading } from "../../src/server/flow.js";
import { ssrHandleError } from "../../src/server/hydration.js";
import { sharedConfig } from "../../src/server/shared.js";

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

function escape(s: any): any {
  return s;
}

function createMockSSRContext() {
  const context: any = {
    async: true,
    assets: [],
    nonce: undefined,
    escape,
    resolve: resolveSSRNode,
    ssr,
    serialize() {},
    replace() {},
    block(p: Promise<any>) {
      blocked.push(p);
    },
    registerFragment() {
      return () => true;
    }
  };
  const blocked: Promise<any>[] = [];
  return { context, blocked };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function tick() {
  return new Promise<void>(r => setTimeout(r, 0));
}

describe("#2900: async retry paths reset owner child state (hydration id stability)", () => {
  let savedContext: any;
  beforeEach(() => {
    savedContext = sharedConfig.context;
  });
  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  test("site 1: serverEffect async retry resets child ids", async () => {
    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    const d = deferred<string>();
    const innerIds: string[] = [];

    createRoot(
      () => {
        const data = createMemo(() => d.promise);
        createRenderEffect(
          () => {
            const inner = createMemo(
              () => {
                innerIds.push(getOwner()!.id!);
                return 1;
              },
              { sync: true } as any
            );
            inner();
            return data();
          },
          () => {}
        );
      },
      { id: "t" }
    );

    expect(innerIds.length).toBe(1);
    const firstRunId = innerIds[0];

    d.resolve("ready");
    await tick();

    expect(innerIds.length).toBe(2);
    expect(innerIds[1]).toBe(firstRunId);
  });

  test("site 2: async createMemo retry resets child ids", async () => {
    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    const d = deferred<string>();
    const innerIds: string[] = [];

    createRoot(
      () => {
        const data = createMemo(() => d.promise);
        createMemo(() => {
          const inner = createMemo(
            () => {
              innerIds.push(getOwner()!.id!);
              return 1;
            },
            { sync: true } as any
          );
          inner();
          return data();
        });
      },
      { id: "t" }
    );

    expect(innerIds.length).toBe(1);
    const firstRunId = innerIds[0];

    d.resolve("ready");
    await tick();

    expect(innerIds.length).toBe(2);
    expect(innerIds[1]).toBe(firstRunId);
  });

  test("site 3: createProjection async retry resets child ids", async () => {
    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    const d = deferred<string>();
    const innerIds: string[] = [];

    createRoot(
      () => {
        const data = createMemo(() => d.promise);
        createProjection((draft: any) => {
          innerIds.push(createUniqueId());
          draft.value = data();
        }, {} as any);
      },
      { id: "t" }
    );

    expect(innerIds.length).toBe(1);
    const firstRunId = innerIds[0];

    d.resolve("ready");
    await tick();

    expect(innerIds.length).toBe(2);
    expect(innerIds[1]).toBe(firstRunId);
  });

  test("site 4: Loading discovery retry resets id slots consumed without child owners", async () => {
    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    const d = deferred<string>();
    const uniqueIds: string[] = [];

    createRoot(
      () => {
        // Memo created OUTSIDE the boundary: the children getter consumes id
        // slots (createUniqueId) without creating child owners, then throws
        // NotReady from the direct read — the discovery retry path where the
        // boundary owner hits disposeOwner's leaf fast path.
        const data = createMemo(() => d.promise);
        Loading({
          fallback: "Loading...",
          get children() {
            uniqueIds.push(createUniqueId());
            return `value: ${data()}` as any;
          }
        });
      },
      { id: "t" }
    );

    expect(uniqueIds.length).toBe(1);
    const firstRunId = uniqueIds[0];

    d.resolve("ready");
    await tick();

    expect(uniqueIds.length).toBeGreaterThan(1);
    for (const id of uniqueIds.slice(1)) expect(id).toBe(firstRunId);
  });

  test("failed run's onCleanups fire on retry, not leak to root disposal", async () => {
    const { context } = createMockSSRContext();
    sharedConfig.context = context;

    const d = deferred<string>();
    const cleanups: string[] = [];
    const { onCleanup } = await import("../../src/server/index.js");

    createRoot(
      () => {
        const data = createMemo(() => d.promise);
        createRenderEffect(
          () => {
            onCleanup(() => cleanups.push("run"));
            return data();
          },
          () => {}
        );
      },
      { id: "t" }
    );

    expect(cleanups.length).toBe(0);
    d.resolve("ready");
    await tick();
    // The failed first run's cleanup fires when the retry re-runs the compute.
    expect(cleanups.length).toBe(1);
  });
});
