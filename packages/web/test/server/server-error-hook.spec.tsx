/**
 * @jsxImportSource @solidjs/web
 *
 * The server error hook (sentry-integration-plan C6, #3468 part 3): the
 * prod-tier seam through which a server `init()` hears every failure the
 * runtime handles — an `<Errored>` fallback rendered, a `<Loading>` fragment
 * rejected, a server-function throw (HTTP dispatch or an in-process call
 * during SSR), the failure that fails a request — and may say what the
 * client receives instead.
 *
 * The contract under test:
 *
 *  - ONE call per error object, at first sight, with where it was met
 *    (`kind`/`handling`, the boundary's id, the function's id, the owner
 *    path, the request event);
 *  - the return is the wire value — rendered into the fallback, serialized
 *    for hydration, sent as the RPC error — `undefined` for the default;
 *  - a direct server-function call that throws during SSR is reported once
 *    as the FUNCTION's failure; the boundary that contains it reuses the
 *    verdict and does not report again;
 *  - two tiers: ambient (`configureServerErrors`) and per request
 *    (`renderToStream`'s `onServerError`, the handler's), the latter winning;
 *  - `handling: "failed"` has no wire — the return is ignored — and
 *    `renderToStream`'s `onError` still hears it;
 *  - a throwing hook is reported and treated as silent.
 *
 * Runs the runtimes from source (the dev tier: the default is fidelity, so a
 * hook's mapping is visible against the original). The server-function
 * runtime is its built production artifact, whose `solid-js/internal`
 * resolves to the same engine this render uses — one verdict cache, which
 * is what the direct-call case pins.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  Errored,
  Loading,
  configureServerErrors,
  renderToStream,
  renderToString,
  type ServerErrorContext
} from "@solidjs/web";
import { NotReadyError, createMemo } from "solid-js";
import {
  createServerReference,
  handleServerFunctionRequest,
  registerServerFunction,
  registerServerReference
} from "@solidjs/web/server-functions/server";
import { createServerReference as clientReference } from "@solidjs/web/server-functions/client";
import type { JSX } from "@solidjs/web";

const RequestContext = Symbol.for("solid.RequestContext");
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});
afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

type Call = { error: unknown; context: ServerErrorContext };
let calls: Call[];
let reported: unknown[][];
beforeEach(() => {
  calls = [];
  reported = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    reported.push(args);
  });
});
afterEach(() => {
  configureServerErrors({ onError: undefined });
  vi.restoreAllMocks();
});

/** A hook that records every call and answers `map(error)` (or nothing). */
function hook(map?: (error: unknown, context: ServerErrorContext) => unknown) {
  return (error: unknown, context: ServerErrorContext) => {
    calls.push({ error, context });
    return map ? map(error, context) : undefined;
  };
}

function stream(
  code: () => any,
  options: Parameters<typeof renderToStream>[1] = {}
): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, options).pipe({
      write(chunk: string) {
        chunks.push(String(chunk));
      },
      end() {
        resolve(chunks.join(""));
      }
    });
  });
}

const underRequest = <T,>(fn: () => T): T =>
  ((globalThis as any)[RequestContext] as AsyncLocalStorage<unknown>).run(
    { request: new Request("https://app.example/page"), locals: {} },
    fn
  );

const Fallback = (err: () => any) => <p class="fallback">{String(err().message)}</p>;
const bare = (html: string) => html.replace(/<!--[^>]*-->/g, "").replace(/ _hk=\S+/g, "");

describe("<Errored> during SSR", () => {
  test("the ambient hook hears the failure once — where it was met — and its return is what the fallback renders and the record serializes", () => {
    const boom = new Error("connect ECONNREFUSED");
    configureServerErrors({ onError: hook(() => new Error("Something went wrong")) });
    function Bad(): JSX.Element {
      throw boom;
    }
    function App() {
      return (
        <Errored fallback={Fallback}>
          <Bad />
        </Errored>
      );
    }
    const html = underRequest(() => renderToString(() => <App />));

    expect(calls).toHaveLength(1);
    expect(calls[0].error).toBe(boom);
    expect(calls[0].context).toMatchObject({
      kind: "render",
      handling: "fallback",
      ownerPath: ["<App>", "<Errored>"]
    });
    expect(typeof calls[0].context.boundary).toBe("string");
    expect(calls[0].context.event).toMatchObject({ locals: {} });
    expect(bare(html)).toContain('<p class="fallback">Something went wrong</p>');
    expect(html).toContain('new Error("Something went wrong")');
    expect(html).not.toContain("ECONNREFUSED");
  });

  test("no return: the hook heard it and the default policy applies (fidelity in this tier)", () => {
    configureServerErrors({ onError: hook() });
    function Bad(): JSX.Element {
      throw new Error("as thrown");
    }
    const html = renderToString(() => (
      <Errored fallback={Fallback}>
        <Bad />
      </Errored>
    ));
    expect(calls).toHaveLength(1);
    expect(calls[0].context.event).toBeUndefined();
    expect(bare(html)).toContain('<p class="fallback">as thrown</p>');
  });

  test("the render's own hook wins over the ambient one", async () => {
    const ambient: Call[] = [];
    configureServerErrors({
      onError: (error, context) => {
        ambient.push({ error, context });
      }
    });
    function Bad(): JSX.Element {
      throw new Error("boom");
    }
    const html = await stream(
      () => (
        <Errored fallback={Fallback}>
          <Bad />
        </Errored>
      ),
      { onServerError: hook(() => new Error("per request")) }
    );
    expect(ambient).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(bare(html)).toContain("per request");
  });

  test("a throwing hook is reported on the console and treated as silent", () => {
    configureServerErrors({
      onError: () => {
        throw new Error("hook broke");
      }
    });
    function Bad(): JSX.Element {
      throw new Error("boom");
    }
    const html = renderToString(() => (
      <Errored fallback={Fallback}>
        <Bad />
      </Errored>
    ));
    expect(bare(html)).toContain('<p class="fallback">boom</p>');
    expect(reported.some(c => String(c[0]).includes("hook broke"))).toBe(true);
  });

  test("configureServerErrors refuses a non-function", () => {
    expect(() => configureServerErrors({ onError: 42 as any })).toThrow(TypeError);
  });
});

describe("<Loading> fragments and the failed request", () => {
  test("a fragment that rejects after the shell: one `client` call, before the channel carries it — the `_fr` rejection is the mapping", async () => {
    const boom = new Error("late-boom");
    configureServerErrors({ onError: hook(() => new Error("try again")) });
    function Child() {
      const data = createMemo(async () => {
        await delay(5);
        throw boom;
      });
      return <div>{data()}</div>;
    }
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <Child />
        </Loading>
      );
    }
    const html = await stream(() => <App />);
    expect(calls).toHaveLength(1);
    expect(calls[0].error).toBe(boom);
    expect(calls[0].context).toMatchObject({
      kind: "render",
      handling: "client",
      ownerPath: ["<App>", "<Loading>"]
    });
    expect(typeof calls[0].context.boundary).toBe("string");
    // The fragment's `_fr` rejection carries the mapping — the boundary
    // decided it before settling. The async source's OWN serialized
    // rejection was encoded in the source's rejection microtask, ahead of
    // the boundary, and carries the default policy's value (fidelity in
    // this tier): a documented limit of the hook, kept so the error path
    // gains no tick (see `ServerErrorHook`).
    expect(html).toContain('new Error("try again")');
    expect(html).toContain('new Error("late-boom")');
  });

  test("a synchronous failure under <Loading> inside <Errored>: the parent's fallback is the one sight", () => {
    configureServerErrors({ onError: hook() });
    function Bad(): JSX.Element {
      throw new Error("sync boom");
    }
    renderToString(() => (
      <Errored fallback={Fallback}>
        <Loading fallback={<i>loading</i>}>
          <Bad />
        </Loading>
      </Errored>
    ));
    expect(calls.map(c => c.context.handling)).toEqual(["fallback"]);
  });

  test("a root failure: one `failed` call, `onError` still hears it, the return is ignored", async () => {
    const boom = new Error("root boom");
    const onError = vi.fn();
    configureServerErrors({ onError: hook(() => new Error("ignored")) });
    // A failure on a retry pass: no boundary owns it, nothing is on the
    // stack to throw to, so the renderer's containment channel fails the
    // request (the same shape server-diagnostics.spec.tsx pins).
    let first = true;
    await stream(
      () => (
        <div>
          {
            (() => {
              if (first) {
                first = false;
                throw new NotReadyError(Promise.resolve() as any);
              }
              throw boom;
            }) as unknown as JSX.Element
          }
        </div>
      ),
      { onError }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].error).toBe(boom);
    expect(calls[0].context).toMatchObject({ kind: "render", handling: "failed" });
    expect(onError).toHaveBeenCalledWith(boom);
  });
});

describe("server functions", () => {
  /** Routes the client stub's fetch straight into the handler. */
  function connect(options?: Parameters<typeof handleServerFunctionRequest>[1]) {
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const address = input instanceof Request ? input.url : input.toString();
      const request = new Request(new URL(address, "http://localhost"), init);
      request.headers.set("Sec-Fetch-Site", "same-origin");
      return handleServerFunctionRequest(request, options);
    }) as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  test("HTTP dispatch: the throw is one `thrown` call naming the function; the mapping is what the caller receives", async () => {
    const boom = new Error("connect ECONNREFUSED");
    configureServerErrors({ onError: hook(() => new Error("Please retry")) });
    registerServerFunction("hook/throws", () => {
      throw boom;
    });
    const restore = connect();
    try {
      await expect(clientReference("hook/throws")()).rejects.toMatchObject({
        message: "Please retry"
      });
    } finally {
      restore();
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].error).toBe(boom);
    expect(calls[0].context).toMatchObject({
      kind: "server-function",
      handling: "thrown",
      functionId: "hook/throws",
      direct: false
    });
    expect(calls[0].context.event).toBeDefined();
  });

  test("a failure escaping through the result graph: one `channel` call", async () => {
    const boom = new Error("cursor died");
    configureServerErrors({ onError: hook() });
    registerServerFunction("hook/channel", async () => ({ deferred: Promise.reject(boom) }));
    const restore = connect();
    try {
      const result: any = await clientReference("hook/channel")();
      await expect(result.deferred).rejects.toMatchObject({ message: "Internal Server Error" });
    } finally {
      restore();
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].error).toBe(boom);
    expect(calls[0].context).toMatchObject({
      kind: "server-function",
      handling: "channel",
      functionId: "hook/channel"
    });
  });

  test("the handler's own hook wins over the ambient one for the request it dispatches", async () => {
    const ambient: Call[] = [];
    configureServerErrors({
      onError: (error, context) => {
        ambient.push({ error, context });
      }
    });
    registerServerFunction("hook/per-request", () => {
      throw new Error("boom");
    });
    const restore = connect({ onServerError: hook(() => new Error("handler said")) });
    try {
      await expect(clientReference("hook/per-request")()).rejects.toMatchObject({
        message: "handler said"
      });
    } finally {
      restore();
    }
    expect(ambient).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  test("a direct call that throws during SSR is reported ONCE, as the function's failure; the boundary reuses the verdict", () => {
    const boom = new Error("connect ECONNREFUSED");
    configureServerErrors({ onError: hook(() => new Error("Data unavailable")) });
    const load = createServerReference(
      registerServerReference("hook/direct", () => {
        throw boom;
      })
    );
    function Page(): JSX.Element {
      return <div>{(load as any)()}</div>;
    }
    const html = underRequest(() =>
      renderToString(() => (
        <Errored fallback={Fallback}>
          <Page />
        </Errored>
      ))
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].error).toBe(boom);
    expect(calls[0].context).toMatchObject({
      kind: "server-function",
      handling: "thrown",
      functionId: "hook/direct",
      direct: true
    });
    // The <Errored> rendered the hook's answer without asking again.
    expect(bare(html)).toContain('<p class="fallback">Data unavailable</p>');
    expect(html).toContain('new Error("Data unavailable")');
    expect(html).not.toContain("ECONNREFUSED");
  });
});
