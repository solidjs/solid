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
import { NotReadyError, createMemo, onCleanup } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { createPlugin, type HydrationSerializerOptions } from "@solidjs/web/serialization";
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
    "terminates a synchronous parse failure without a local hook (global: %s)",
    async hasGlobalHook => {
      const onError = vi.fn<ServerErrorHook>(() => undefined);
      const onCompleteAll = vi.fn();
      if (hasGlobalHook) configureServerErrors({ onError });
      const abort = new AbortController();
      let context!: NonNullable<typeof sharedConfig.context>;
      const stream = renderToStream(
        () => {
          context = sharedConfig.context!;
          return <p>shell</p>;
        },
        { signal: abort.signal, onCompleteAll }
      );
      try {
        expect(() => context.serialize("unsupported", new WeakMap())).not.toThrow();
        await stream;
        expect(stream.hasErrors).toBe(true);
        expect(onCompleteAll).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(hasGlobalHook ? 1 : 0);
        expect(console.error).toHaveBeenCalledTimes(hasGlobalHook ? 0 : 1);
      } finally {
        abort.abort();
      }
    }
  );

  test.each([new Error("private parse"), undefined, null, false, 0, ""])(
    "cleans up pending sources after a parser throws %s",
    async error => {
      const token = {};
      const cleanup = vi.fn();
      const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
      const source = {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise<IteratorResult<unknown>>(() => {}),
            return: returned
          };
        }
      };
      const plugin = createPlugin({
        tag: "test/failing-parse-cleanup",
        test: value => value === token,
        parse: {
          stream(_value, context) {
            context.parse(source);
            throw error;
          }
        },
        serialize: () => "({})",
        deserialize: () => token
      });
      const onCompleteAll = vi.fn();
      const onError = vi.fn<ServerErrorHook>(() => new Error("public"));
      configureServerErrors({ onError });
      const stream = renderToStream(
        () => {
          onCleanup(cleanup);
          sharedConfig.context!.serialize("bad", token);
          return <p>shell</p>;
        },
        { plugins: [plugin], onCompleteAll }
      );
      await stream;
      await Promise.resolve();
      expect(stream.hasErrors).toBe(true);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[0]).toBe(error);
      expect(onError.mock.calls[0]?.[1]).toMatchObject({ handling: "serialize" });
      expect(onCompleteAll).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(returned).toHaveBeenCalledTimes(1);
    }
  );

  test.each(["pipe", "pipeTo", "readable"] as const)(
    "ends %s and disposes pending siblings after a post-shell serialization failure",
    async consumer => {
      const gate = Promise.withResolvers<WeakMap<object, unknown>>();
      const shell = Promise.withResolvers<void>();
      const ended = Promise.withResolvers<void>();
      const cleanup = vi.fn();
      const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
      const source = {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise<IteratorResult<unknown>>(() => {}),
            return: returned
          };
        }
      };
      const chunks: string[] = [];
      const onCompleteAll = vi.fn();
      const onError = vi.fn<ServerErrorHook>(() => new Error("public"));
      configureServerErrors({ onError });
      const stream = renderToStream(
        () => {
          onCleanup(cleanup);
          sharedConfig.context!.serialize("sibling", source);
          sharedConfig.context!.serialize("bad", gate.promise);
          return <p>shell</p>;
        },
        { onCompleteAll, onCompleteShell: () => shell.resolve() }
      );
      let result: Promise<unknown>;
      if (consumer === "pipe") {
        stream.pipe({ write: chunk => chunks.push(chunk), end: ended.resolve });
        result = ended.promise;
      } else if (consumer === "pipeTo") {
        result = stream
          .pipeTo(
            new WritableStream({
              write: chunk => {
                chunks.push(new TextDecoder().decode(chunk));
              },
              close: ended.resolve
            })
          )
          .then(() => ended.promise);
      } else {
        result = new Response(stream.readable).text().then(html => chunks.push(html));
      }
      await shell.promise;
      expect(stream.hasErrors).toBe(false);
      gate.resolve(new WeakMap());
      await result;
      await Promise.resolve();
      expect(chunks.join("")).toContain("shell");
      expect(chunks.join("")).not.toContain("Seroval Error");
      expect(stream.hasErrors).toBe(true);
      expect(onCompleteAll).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(returned).toHaveBeenCalledTimes(1);
      const healthy = renderToStream(() => <p>healthy</p>);
      expect(await healthy).toContain("healthy");
      expect(healthy.hasErrors).toBe(false);
    }
  );

  test("still terminates when the global serialization hook throws", async () => {
    configureServerErrors({
      onError: () => {
        throw new Error("hook failed");
      }
    });
    const onCompleteAll = vi.fn();
    const stream = renderToStream(
      () => {
        sharedConfig.context!.serialize("bad", Promise.resolve(new WeakMap()));
        return <p>shell</p>;
      },
      { onCompleteAll }
    );
    await stream;
    expect(stream.hasErrors).toBe(true);
    expect(onCompleteAll).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  test.each(["none", "local", "global"])(
    "preserves the custom serializer callback contract (%s hook)",
    async hook => {
      const error = new Error("custom serializer");
      const onError = vi.fn<ServerErrorHook>(() => undefined);
      if (hook === "global") configureServerErrors({ onError });
      let received: unknown;
      const options = {
        onError: hook === "local" ? onError : undefined,
        serializer({ onError, onDone }: HydrationSerializerOptions) {
          received = onError;
          return Object.freeze({
            write() {},
            flush() {
              onError?.(error);
              onError?.(error);
              onDone?.();
            }
          });
        }
      };
      const stream = renderToStream(() => <p>shell</p>, options);
      await stream;
      expect(typeof received).toBe(hook === "local" ? "function" : "undefined");
      expect(stream.hasErrors).toBe(hook === "local");
      expect(onError).toHaveBeenCalledTimes(hook === "local" ? 1 : 0);
    }
  );

  test("reads the serializer factory before capturing its error hook", async () => {
    let onError = vi.fn<ServerErrorHook>(() => undefined);
    let received: unknown;
    const options = {
      get onError() {
        return onError;
      },
      get serializer() {
        onError = vi.fn<ServerErrorHook>(() => undefined);
        return ({ onError, onDone }: HydrationSerializerOptions) => {
          received = onError;
          return {
            write() {},
            flush() {
              onError?.(new Error("custom serializer"));
              onDone?.();
            }
          };
        };
      }
    };
    const stream = renderToStream(() => <p>shell</p>, options);
    await stream;
    expect(received).toBeTypeOf("function");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(stream.hasErrors).toBe(true);
  });

  test("records a frozen custom serializer's synchronous throw without replacing it", () => {
    const error = new Error("custom write");
    const abort = new AbortController();
    let context!: NonNullable<typeof sharedConfig.context>;
    const serializer = Object.freeze({
      write() {
        expect(this).toBe(serializer);
        throw error;
      },
      flush() {}
    });
    const options = { signal: abort.signal, serializer: () => serializer };
    const stream = renderToStream(() => {
      context = sharedConfig.context!;
      return <p>shell</p>;
    }, options);
    try {
      expect(() => context.serialize("custom", 1)).toThrow(error);
      expect(stream.hasErrors).toBe(true);
    } finally {
      abort.abort();
    }
  });

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
