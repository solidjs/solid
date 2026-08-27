/**
 * The per-call invocator: `invoke(fn, options, ...args)` — the call-scoped slot
 * of the extension surface (#3057). Options are strictly invocation-scoped
 * (signal, keepalive, priority); everything longer-lived is refused with a
 * redirect to its home. Dispatch rides the invocation channel
 * (SERVER_FUNCTION_INVOKE), which wrappers forward like declaration
 * metadata — so `invoke` composes through GET/live and through integration
 * wrappers that adapt it.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GET as serverGET,
  handleServerFunctionRequest,
  invoke as invokeServer,
  registerServerFunction,
  registerServerReference,
  createServerReference as createServerSideReference
} from "@solidjs/web/server-functions/server";
import {
  GET,
  SERVER_FUNCTION_INVOKE,
  createServerReference,
  invoke,
  live
} from "@solidjs/web/server-functions/client";
import type { InvokeOptions } from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

// Dispatches into the built server handler like the extension spec's
// transport, but honors the RequestInit the client transport produced:
// aborting the init's signal rejects the in-flight call, and every init is
// captured so tests can assert what reached the wire.
function connectTransport() {
  const original = globalThis.fetch;
  const inits: (RequestInit & { keepalive?: boolean; priority?: string })[] = [];
  const urls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(input.toString(), "http://localhost"), init);
    request.headers.set("Sec-Fetch-Site", "same-origin");
    if (init) inits.push(init);
    urls.push(request.url);
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      handleServerFunctionRequest(request).then(resolve, reject);
    });
  }) as typeof fetch;
  return {
    inits,
    urls,
    restore() {
      globalThis.fetch = original;
    }
  };
}

// A fetch that never answers — for asserting teardown reaches the wire.
function connectHangingTransport() {
  const original = globalThis.fetch;
  const signals: (AbortSignal | undefined)[] = [];
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    signals.push(signal ?? undefined);
    return new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }) as typeof fetch;
  return {
    signals,
    restore() {
      globalThis.fetch = original;
    }
  };
}

describe("invoke — per-call invocation (built bundles)", () => {
  it("round-trips a plain reference, args spread after the options bag", async () => {
    registerServerFunction("inv-plain-0", async (a: number, b: number) => a + b);
    const transport = connectTransport();
    try {
      const ref = createServerReference("inv-plain-0");
      expect(await invoke(ref, {}, 20, 22)).toBe(42);
      // and matches a plain call exactly
      expect(await (ref as any)(20, 22)).toBe(42);
    } finally {
      transport.restore();
    }
  });

  it("a pre-aborted signal rejects the call (fetch semantics)", async () => {
    let ran = false;
    registerServerFunction("inv-abort-0", async () => {
      ran = true;
      return "never";
    });
    const transport = connectTransport();
    try {
      const ref = createServerReference("inv-abort-0");
      const controller = new AbortController();
      controller.abort();
      await expect(invoke(ref, { signal: controller.signal })).rejects.toMatchObject({
        name: "AbortError"
      });
      expect(ran).toBe(false);
    } finally {
      transport.restore();
    }
  });

  it("aborting mid-flight rejects the call with the signal's reason", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    registerServerFunction("inv-abort-1", async () => {
      await gate;
      return "late";
    });
    const transport = connectTransport();
    try {
      const ref = createServerReference("inv-abort-1");
      const controller = new AbortController();
      const call = invoke(ref, { signal: controller.signal });
      controller.abort(new Error("superseded"));
      await expect(call).rejects.toThrow("superseded");
    } finally {
      release();
      transport.restore();
    }
  });

  it("keepalive and priority reach the fetch init; a caller signal owns the wire", async () => {
    registerServerFunction("inv-hints-0", async () => "ok");
    const transport = connectTransport();
    try {
      const ref = createServerReference("inv-hints-0");
      const controller = new AbortController();
      const options: InvokeOptions = {
        signal: controller.signal,
        keepalive: true,
        priority: "low"
      };
      expect(await invoke(ref, options)).toBe("ok");
      expect(transport.inits.length).toBe(1);
      expect(transport.inits[0].keepalive).toBe(true);
      expect(transport.inits[0].priority).toBe("low");
      expect(transport.inits[0].signal).toBe(controller.signal);
    } finally {
      transport.restore();
    }
  });

  it("composes through GET: query encoding, options on the wire", async () => {
    serverGET(
      createServerSideReference(registerServerReference("inv-get-0", async (n: number) => n * 2))
    );
    const transport = connectTransport();
    try {
      const declared = GET(createServerReference("inv-get-0"));
      const controller = new AbortController();
      expect(await invoke(declared, { signal: controller.signal, priority: "high" }, 21)).toBe(42);
      expect(transport.inits[0].method).toBe("GET");
      expect(transport.urls[0]).toContain("args=");
      expect(transport.inits[0].signal).toBe(controller.signal);
      expect(transport.inits[0].priority).toBe("high");
    } finally {
      transport.restore();
    }
  });

  it("refuses non-invocation options with a redirect to their home", () => {
    const ref = createServerReference("inv-validate-0");
    expect(() => invoke(ref, { headers: { "x-a": "1" } } as any)).toThrow(
      /prepareRequest.*withMeta.*arguments/s
    );
    expect(() => invoke(ref, { method: "GET" } as any)).toThrow(/GET\(fn\)/);
    expect(() => invoke(ref, { timeout: 5000 } as any)).toThrow(/AbortSignal\.timeout/);
    expect(() => invoke(ref, { retries: 3 } as any)).toThrow(/invocation-scoped/);
    // the options bag is positional — a forgotten bag must not swallow an argument
    expect(() => invoke(ref, 1 as any)).toThrow(/options bag/);
  });

  it("requires a reference (or a wrapper that forwards the channel)", async () => {
    // a plain function is not invocable
    expect(() => invoke(async () => {}, {})).toThrow(/expects a server function reference/);

    // a branded wrapper that did NOT forward the channel gets the directed
    // wrapper error, not the generic one
    const half = (() => {}) as any;
    half[Symbol.for("solid.ServerFunctionMetadata")] = {};
    expect(() => invoke(half, {})).toThrow(/does not forward the invocation channel/);

    // a wrapper that forwards the channel (adapting options) is invocable —
    // the composition contract integration wrappers (query/action) follow
    registerServerFunction("inv-wrap-0", async (n: number) => n + 1);
    const transport = connectTransport();
    try {
      const inner = createServerReference("inv-wrap-0");
      const wrapper = ((...args: unknown[]) => (inner as any)(...args)) as any;
      wrapper[Symbol.for("solid.ServerFunctionMetadata")] = {};
      wrapper[SERVER_FUNCTION_INVOKE] = (args: unknown[], options?: InvokeOptions) =>
        invoke(inner, options || {}, ...args);
      expect(await invoke(wrapper, {}, 41)).toBe(42);
    } finally {
      transport.restore();
    }
  });

  it("live: a caller signal ends the iteration; break severs the wire", async () => {
    registerServerReference("inv-live-0", async () => "value");
    const transport = connectHangingTransport();
    try {
      const source = live(createServerReference("inv-live-0"));

      // abort while connecting: the pending pull rejects with the reason
      const controller = new AbortController();
      const iterable = invoke(source, {
        signal: controller.signal
      }) as unknown as AsyncIterable<string>;
      const iterator = iterable[Symbol.asyncIterator]();
      const pending = iterator.next();
      controller.abort(new Error("navigated away"));
      await expect(pending).rejects.toThrow("navigated away");
      // the combined signal reached the wire and is aborted
      expect(transport.signals.length).toBe(1);
      expect(transport.signals[0]?.aborted).toBe(true);

      // and consumer-initiated end (return/break) aborts the connection too
      const plain = (source as any)() as AsyncIterable<string>;
      const it2 = plain[Symbol.asyncIterator]();
      const pending2 = it2.next();
      await it2.return!(undefined);
      expect(transport.signals.length).toBe(2);
      expect(transport.signals[1]?.aborted).toBe(true);
      await expect(pending2).resolves.toEqual({ done: true, value: undefined });
    } finally {
      transport.restore();
    }
  });

  it("server mirror: in-process call, signal rejects the caller", async () => {
    let calls = 0;
    let finished = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const ref = createServerSideReference(
      registerServerReference("inv-server-0", async (n: number) => {
        calls++;
        await gate;
        finished++;
        return n * 2;
      })
    );
    const storage = (globalThis as any)[RequestContext] as AsyncLocalStorage<unknown>;
    const event = { request: new Request("http://localhost/"), locals: {} };

    await storage.run(event, async () => {
      // plain in-process invoke
      const call = invokeServer(ref, {}, 21) as Promise<number>;
      release();
      expect(await call).toBe(42);

      // pre-aborted: rejects, the function never runs
      const aborted = new AbortController();
      aborted.abort();
      await expect(
        invokeServer(ref, { signal: aborted.signal }, 1) as Promise<number>
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(calls).toBe(1);

      // mid-call abort: the CALLER is rejected; the work, like a server
      // behind HTTP, runs to completion
      let releaseSecond!: () => void;
      const secondGate = new Promise<void>(resolve => (releaseSecond = resolve));
      const slow = createServerSideReference(
        registerServerReference("inv-server-1", async () => {
          await secondGate;
          finished++;
          return "done";
        })
      );
      const controller = new AbortController();
      const midCall = invokeServer(slow, { signal: controller.signal }) as Promise<string>;
      controller.abort(new Error("caller gone"));
      await expect(midCall).rejects.toThrow("caller gone");
      releaseSecond();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(finished).toBe(2);
    });
  });
});
