/**
 * @jsxImportSource @solidjs/web
 *
 * Concurrent renders × the server error hook. Each render's `onError` is
 * that request's policy: it hears the render's own failures and its return
 * is the wire value the render's client receives. The module-global
 * `sharedConfig.context` is whichever render touched it last — a finished
 * `renderToString` context lingers there — so a failure met later, from an
 * async continuation, must be attributed to the render (or request) it
 * belongs to, never to whatever context the global happens to hold. A
 * failure no render owns reaches the ambient hook alone.
 *
 * Every case interleaves request B between request A's start and A's late
 * failure, and asserts B's hook heard nothing of A.
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
import { sharedConfig } from "solid-js/internal";
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
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  configureServerErrors({ onError: undefined });
  vi.restoreAllMocks();
});

type Heard = { error: unknown; context: ServerErrorContext };
function recorder(map?: (error: unknown) => unknown) {
  const heard: Heard[] = [];
  const onError = (error: unknown, context: ServerErrorContext) => {
    heard.push({ error, context });
    return map ? map(error) : undefined;
  };
  return { heard, onError };
}
const handlings = (heard: Heard[]) => heard.map(h => h.context.handling);

/** Request B: a sync render with its own hook, whose context lingers as the global. */
function otherRequest(onError: (error: unknown, context: ServerErrorContext) => unknown) {
  const before = sharedConfig.context;
  renderToString(() => <p>other request</p>, { onError });
  expect(sharedConfig.context).not.toBe(before);
}

function stream(code: () => any, options: Parameters<typeof renderToStream>[1] = {}) {
  return new Promise<string>(resolve => {
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

const Fallback = (err: () => any) => <p>{String(err().message)}</p>;

const underRequest = <T,>(fn: () => T): T =>
  ((globalThis as any)[RequestContext] as AsyncLocalStorage<unknown>).run(
    { request: new Request("https://app.example/page"), locals: {} },
    fn
  );

describe("a <Loading> boundary's resume-loop failure", () => {
  test("pre-shell (`failed`): reaches the stream's own hook, not the other request's", async () => {
    // A root read holds the shell until the failure is reported, so it
    // lands pre-flush and no shell pass re-points the global at A first.
    let releaseShell!: () => void;
    const gate = new Promise<string>(r => (releaseShell = () => r("shell")));
    const a = recorder();
    const b = recorder();
    // A fresh pending source every pass: the boundary's convergence budget
    // fails it from the async resume loop, where nothing is on the stack.
    const NeverConverges = () => {
      throw new NotReadyError(Promise.resolve() as any);
    };
    const done = stream(
      () => {
        const held = createMemo(() => gate);
        return (
          <div>
            {held()}
            <Loading fallback={<i>loading</i>}>
              <NeverConverges />
            </Loading>
          </div>
        );
      },
      {
        onError(error, context) {
          a.onError(error, context);
          setTimeout(releaseShell, 0);
        }
      }
    );
    setTimeout(releaseShell, 500);
    otherRequest(b.onError);
    await done;
    expect(b.heard).toEqual([]);
    expect(handlings(a.heard)).toEqual(["failed"]);
    expect(String((a.heard[0].error as Error).message)).toContain("did not converge");
  });

  test("post-shell (`client`): the stream's hook maps the fragment's rejection, not the other request's", async () => {
    const a = recorder(() => new Error("mapped by A"));
    const b = recorder(() => new Error("mapped by B"));
    let first = true;
    const NeverConverges = () => {
      if (first) {
        first = false;
        throw new NotReadyError(delay(20) as any);
      }
      throw new NotReadyError(Promise.resolve() as any);
    };
    const done = stream(
      () => (
        <div>
          <Loading fallback={<i>loading</i>}>
            <NeverConverges />
          </Loading>
        </div>
      ),
      { onError: a.onError }
    );
    await delay(5);
    otherRequest(b.onError);
    const html = await done;
    expect(b.heard).toEqual([]);
    expect(handlings(a.heard)).toEqual(["client"]);
    expect(html).toContain("mapped by A");
    expect(html).not.toContain("mapped by B");
  });

  test("a fragment rejecting on a retry pass reaches the stream's own hook (guard)", async () => {
    const a = recorder();
    const b = recorder();
    function Child() {
      const data = createMemo(async () => {
        await delay(20);
        throw new Error("A's fragment failed");
      });
      return <div>{data()}</div>;
    }
    const done = stream(
      () => (
        <Loading fallback={<i>loading</i>}>
          <Child />
        </Loading>
      ),
      { onError: a.onError }
    );
    await delay(5);
    otherRequest(b.onError);
    await done;
    expect(b.heard).toEqual([]);
    expect(handlings(a.heard)).toEqual(["client"]);
  });

  test("an <Errored> fallback rendered on a retry pass reaches the stream's own hook (guard)", async () => {
    const a = recorder(() => new Error("mapped by A"));
    const b = recorder(() => new Error("mapped by B"));
    function Child() {
      const data = createMemo(async () => {
        await delay(20);
        throw new Error("A's content failed");
      });
      return <div>{data()}</div>;
    }
    const done = stream(
      () => (
        <Loading fallback={<i>loading</i>}>
          <Errored fallback={Fallback}>
            <Child />
          </Errored>
        </Loading>
      ),
      { onError: a.onError }
    );
    await delay(5);
    otherRequest(b.onError);
    const html = await done;
    expect(b.heard).toEqual([]);
    expect(handlings(a.heard)).toEqual(["fallback"]);
    expect(html).toContain("mapped by A");
  });
});

describe("the stream's serializer", () => {
  test("a hydration value that will not serialize, settling late, reaches the stream's own hook", async () => {
    const a = recorder();
    const b = recorder();
    const done = stream(
      () => {
        (sharedConfig.context as any).serialize(
          "lib:late",
          delay(20).then(() => new WeakMap())
        );
        return <div>a</div>;
      },
      { onError: a.onError }
    );
    await delay(5);
    otherRequest(b.onError);
    await done;
    expect(b.heard).toEqual([]);
    expect(handlings(a.heard)).toEqual(["serialize"]);
  });
});

describe("server functions", () => {
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

  test("HTTP dispatch without a handler hook: the ambient hook answers, not a render's lingering one", async () => {
    const ambient = recorder(() => new Error("ambient said"));
    const b = recorder(() => new Error("mapped by B"));
    configureServerErrors({ onError: ambient.onError });
    registerServerFunction("concurrent/throws", () => {
      throw new Error("A's function failed");
    });
    otherRequest(b.onError);
    const restore = connect();
    try {
      await expect(clientReference("concurrent/throws")()).rejects.toMatchObject({
        message: "ambient said"
      });
    } finally {
      restore();
    }
    expect(b.heard).toEqual([]);
    expect(handlings(ambient.heard)).toEqual(["thrown"]);
  });

  test("a result-graph channel failing after a render took the global: the ambient hook answers", async () => {
    const ambient = recorder();
    const b = recorder();
    configureServerErrors({ onError: ambient.onError });
    registerServerFunction("concurrent/channel", async () => ({
      deferred: delay(20).then(() => Promise.reject(new Error("A's cursor died")))
    }));
    const restore = connect();
    try {
      const result: any = await clientReference("concurrent/channel")();
      await delay(5);
      otherRequest(b.onError);
      await expect(result.deferred).rejects.toBeDefined();
    } finally {
      restore();
    }
    expect(b.heard).toEqual([]);
    expect(handlings(ambient.heard)).toEqual(["channel"]);
  });

  test("a direct call during SSR that rejects late reaches the calling render's hook", async () => {
    const a = recorder(() => new Error("mapped by A"));
    const b = recorder(() => new Error("mapped by B"));
    const load = createServerReference(
      registerServerReference("concurrent/direct", async () => {
        await delay(20);
        throw new Error("A's direct call failed");
      })
    );
    function Page(): JSX.Element {
      const data = createMemo(() => (load as any)());
      return <div>{data()}</div>;
    }
    const done = underRequest(() =>
      stream(
        () => (
          <Loading fallback={<i>loading</i>}>
            <Errored fallback={Fallback}>
              <Page />
            </Errored>
          </Loading>
        ),
        { onError: a.onError }
      )
    );
    await delay(5);
    otherRequest(b.onError);
    const html = await done;
    expect(b.heard).toEqual([]);
    expect(a.heard).toHaveLength(1);
    expect(a.heard[0].context).toMatchObject({
      kind: "server-function",
      functionId: "concurrent/direct",
      direct: true
    });
    expect(html).toContain("mapped by A");
    expect(html).not.toContain("mapped by B");
  });

  test("a direct call made after an await (no render on the stack) reaches its request's render hook", async () => {
    const ambient = recorder();
    const a = recorder(() => new Error("mapped by A"));
    const b = recorder(() => new Error("mapped by B"));
    configureServerErrors({ onError: ambient.onError });
    const load = createServerReference(
      registerServerReference("concurrent/after-await", async () => {
        throw new Error("A's late call failed");
      })
    );
    function Page(): JSX.Element {
      const data = createMemo(async () => {
        await delay(20);
        return (load as any)();
      });
      return <div>{data()}</div>;
    }
    const done = underRequest(() =>
      stream(
        () => (
          <Loading fallback={<i>loading</i>}>
            <Errored fallback={Fallback}>
              <Page />
            </Errored>
          </Loading>
        ),
        { onError: a.onError }
      )
    );
    await delay(5);
    otherRequest(b.onError);
    const html = await done;
    expect(b.heard).toEqual([]);
    expect(ambient.heard).toEqual([]);
    expect(a.heard.map(h => h.context.direct)).toEqual([true]);
    expect(html).toContain("mapped by A");
  });

  test("a direct call outside any render: the ambient hook answers, not a render's lingering one", async () => {
    const ambient = recorder();
    const b = recorder();
    configureServerErrors({ onError: ambient.onError });
    const load = createServerReference(
      registerServerReference("concurrent/unrendered", async () => {
        throw new Error("a loader's call failed");
      })
    );
    otherRequest(b.onError);
    await expect(underRequest(() => (load as any)())).rejects.toThrow("a loader's call failed");
    expect(b.heard).toEqual([]);
    expect(ambient.heard.map(h => h.context.direct)).toEqual([true]);
  });
});
