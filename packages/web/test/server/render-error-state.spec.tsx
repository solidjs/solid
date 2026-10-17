/** @jsxImportSource @solidjs/web */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  Errored,
  Loading,
  configureServerErrors,
  createRequestEvent,
  redirect,
  respond,
  renderToStream,
  type JSX,
  type RequestEvent,
  type ServerErrorHook
} from "@solidjs/web";
import { NotReadyError, createMemo } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import {
  createServerReference,
  registerServerReference
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");
const storage = new AsyncLocalStorage<RequestEvent>();
let previousStorage: unknown;
beforeAll(() => {
  previousStorage = (globalThis as any)[RequestContext];
  (globalThis as any)[RequestContext] = storage;
});
afterAll(() => {
  (globalThis as any)[RequestContext] = previousStorage;
});
beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
  configureServerErrors({});
  vi.restoreAllMocks();
});

function underRequest<T>(run: () => T): T {
  return storage.run(createRequestEvent(new Request("https://example.test/page")), run);
}
type PendingProps = { value: Promise<string> };
type BadProps = { error: unknown };

function Pending(props: PendingProps) {
  const value = createMemo(() => props.value);
  return <p>{value()}</p>;
}
function deferredRender() {
  const gate = Promise.withResolvers<string>();
  const stream = underRequest(() =>
    renderToStream(() => (
      <main>
        <Loading fallback={<i>pending</i>}>
          <Pending value={gate.promise} />
        </Loading>
      </main>
    ))
  );
  const html = Promise.resolve(stream);
  return { gate, stream, html };
}
function Bad(props: BadProps): JSX.Element {
  throw props.error;
}

function failedFunction(id: string) {
  return createServerReference(
    registerServerReference(id, () => Promise.reject(new Error("private backend")))
  );
}

describe("renderToStream.hasErrors", () => {
  test("is a readonly getter and remains false for a successful async render", async () => {
    const { gate, stream, html } = deferredRender();
    expect(stream.hasErrors).toBe(false);
    expect(Object.getOwnPropertyDescriptor(stream, "hasErrors")?.set).toBeUndefined();
    gate.resolve("ready");
    expect(await html).toContain("ready");
    expect(stream.hasErrors).toBe(false);
  });

  test("tracks interleaved requests and reused errors without rerunning the mapper", async () => {
    const mapped = vi.fn(() => new Error("public failure"));
    configureServerErrors({ onError: mapped });
    const error = new Error("private failure");
    const first = deferredRender();
    const healthy = deferredRender();
    first.gate.reject(error);
    await first.html;
    const second = deferredRender();
    second.gate.reject(error);
    await second.html;
    healthy.gate.resolve("healthy");
    await healthy.html;
    expect([first.stream.hasErrors, second.stream.hasErrors, healthy.stream.hasErrors]).toEqual([
      true,
      true,
      false
    ]);
    expect(mapped).toHaveBeenCalledTimes(1);
  });

  test.each([new Error("private"), undefined, null, false, 0, ""])(
    "marks an Errored fallback even for %s",
    async error => {
      const stream = underRequest(() =>
        renderToStream(() => (
          <Errored fallback={<p>fallback</p>}>
            <Bad error={error} />
          </Errored>
        ))
      );
      expect(await stream).toContain("fallback");
      expect(stream.hasErrors).toBe(true);
    }
  );

  test.each([undefined, null, false, 0, ""])(
    "marks a fragment rejected with a falsy value (%s)",
    async error => {
      const { gate, stream, html } = deferredRender();
      gate.reject(error);
      await html;
      expect(stream.hasErrors).toBe(true);
    }
  );

  test("keeps separate renders in the same request independent", async () => {
    const [failed, healthy] = underRequest(() => [
      renderToStream(() => (
        <Errored fallback={<p>fallback</p>}>
          <Bad error={new Error("private")} />
        </Errored>
      )),
      renderToStream(() => <p>healthy</p>)
    ]);
    await Promise.all([failed, healthy]);
    expect([failed.hasErrors, healthy.hasErrors]).toEqual([true, false]);
  });

  test("records an asynchronous Errored fallback", async () => {
    const gate = Promise.withResolvers<string>();
    const stream = renderToStream(() => (
      <Errored fallback={<p>fallback</p>}>
        <Loading fallback={<i>pending</i>}>
          <Pending value={gate.promise} />
        </Loading>
      </Errored>
    ));
    const html = Promise.resolve(stream);
    gate.reject(new Error("private async"));
    await html;
    expect(stream.hasErrors).toBe(true);
  });

  test("marks a server function failure that was already reported before Loading receives it", async () => {
    const onError = vi.fn<ServerErrorHook>(() => new Error("public failure"));
    configureServerErrors({ onError });
    const load = failedFunction("render-state/escaped");
    const stream = underRequest(() =>
      renderToStream(() => (
        <Loading fallback={<i>pending</i>}>
          <Pending value={load()} />
        </Loading>
      ))
    );
    await stream;
    expect(stream.hasErrors).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toMatchObject({ kind: "server-function" });
  });

  test("does not mark a server function failure caught by the application", async () => {
    configureServerErrors({ onError: () => new Error("public failure") });
    const load = failedFunction("render-state/caught");
    const stream = underRequest(() =>
      renderToStream(() => (
        <Loading fallback={<i>pending</i>}>
          <Pending value={load().catch(() => "recovered")} />
        </Loading>
      ))
    );
    expect(await stream).toContain("recovered");
    expect(stream.hasErrors).toBe(false);
  });

  test("marks asynchronous serialization loss with the existing local hook policy", async () => {
    const onError = vi.fn<ServerErrorHook>(() => undefined);
    const stream = renderToStream(
      () => {
        sharedConfig.context!.serialize("unsupported", Promise.resolve(new WeakMap()));
        return <p>shell</p>;
      },
      { onError }
    );
    await stream;
    expect(stream.hasErrors).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toMatchObject({ handling: "serialize" });
  });

  test.each([false, true])(
    "preserves the synchronous serializer throw without a local hook (global: %s)",
    hasGlobalHook => {
      const onError = vi.fn<ServerErrorHook>(() => undefined);
      if (hasGlobalHook) configureServerErrors({ onError });
      const abort = new AbortController();
      let context!: NonNullable<typeof sharedConfig.context>;
      const stream = renderToStream(
        () => {
          context = sharedConfig.context!;
          return <p>shell</p>;
        },
        { signal: abort.signal }
      );
      try {
        expect(() => context.serialize("unsupported", new WeakMap())).toThrow();
        expect(stream.hasErrors).toBe(true);
        expect(onError).not.toHaveBeenCalled();
      } finally {
        abort.abort();
      }
    }
  );

  test("marks a root retry failure while preserving the existing completion policy", async () => {
    let first = true;
    let didComplete = false;
    const retry = () => {
      if (first) {
        first = false;
        throw new NotReadyError(Promise.resolve());
      }
      throw new Error("private root");
    };
    const stream = renderToStream(() => <div>{retry as unknown as JSX.Element}</div>, {
      onCompleteAll() {
        didComplete = true;
      }
    });
    await stream;
    expect(stream.hasErrors).toBe(true);
    expect(didComplete).toBe(false);
  });

  test.each([redirect<Response>("/login"), respond({ ready: true })])(
    "does not classify a native control handled by the application as an error",
    async control => {
      const load = createServerReference(
        registerServerReference("render-state/control", () => {
          throw control;
        })
      );
      const stream = underRequest(() =>
        renderToStream(() => {
          try {
            load();
          } catch {
            return <p>control handled</p>;
          }
          return <p>unexpected success</p>;
        })
      );
      expect(await stream).toContain("control handled");
      expect(stream.hasErrors).toBe(false);
    }
  );

  test("does not suppress a Response that actually renders an error fallback", async () => {
    const stream = renderToStream(() => (
      <Errored fallback={<p>fallback</p>}>
        <Bad error={new Response("failed", { status: 500 })} />
      </Errored>
    ));
    await stream;
    expect(stream.hasErrors).toBe(true);
  });

  test("keeps streamed HTML progressive and records a late rejected fragment", async () => {
    const gate = Promise.withResolvers<string>();
    let releaseShell!: () => void;
    const shell = new Promise<void>(resolve => {
      releaseShell = resolve;
    });
    const chunks: string[] = [];
    const stream = renderToStream(() => (
      <main>
        <Loading fallback={<i>pending</i>}>
          <Pending value={gate.promise} />
        </Loading>
      </main>
    ));
    const ended = new Promise<void>(resolve =>
      stream.pipe({
        write(chunk) {
          chunks.push(chunk);
          releaseShell();
        },
        end() {
          resolve();
        }
      })
    );
    await shell;
    expect(chunks.join("")).toContain("pending");
    expect(stream.hasErrors).toBe(false);
    gate.reject(new Error("private late"));
    await ended;
    expect(stream.hasErrors).toBe(true);
  });
});
