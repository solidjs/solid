/** @jsxImportSource @solidjs/web */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  Errored,
  Loading,
  configureServerErrors,
  createRequestEvent,
  createSSRResponse,
  redirect,
  respond,
  renderToStream,
  type JSX,
  type RequestEvent,
  type ServerErrorHook
} from "@solidjs/web";
import { SerovalParserError } from "seroval";
import { NotReadyError, createMemo, onCleanup } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { createPlugin, type HydrationSerializerOptions } from "@solidjs/web/serialization";
import {
  createServerReference,
  registerServerReference
} from "@solidjs/web/server-functions/server";
import { renderServerComponent } from "../../frames/src/frame-sink.js";
import { createJSONDataTable, createJSONSerializer } from "../../serialization/src/serializer.js";

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

  test("tracks interleaved requests and maps a reused error once per request", async () => {
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
    expect(mapped).toHaveBeenCalledTimes(2);
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

  test("records each render even when the same request already reported its error", async () => {
    const onError = vi.fn<ServerErrorHook>(() => new Error("public failure"));
    configureServerErrors({ onError });
    const error = new Error("private failure");
    const streams = underRequest(() =>
      [0, 1].map(() =>
        renderToStream(() => (
          <Errored fallback={<p>fallback</p>}>
            <Bad error={error} />
          </Errored>
        ))
      )
    );
    await Promise.all(streams);
    expect(streams.map(stream => stream.hasErrors)).toEqual([true, true]);
    expect(onError).toHaveBeenCalledTimes(1);
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
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0]?.[1]).toMatchObject({ kind: "server-function" });
    expect(onError.mock.calls[1]?.[1]).toMatchObject({ kind: "render" });
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

  test.each(["response", "pipe", "pipeTo", "readable"] as const)(
    "keeps a shell that met a serialization failure from reaching %s",
    async consumer => {
      let first = true;
      const hole = () => {
        if (first) {
          first = false;
          throw new NotReadyError(Promise.resolve());
        }
        sharedConfig.context!.serialize("bad", new WeakMap());
        return "after";
      };
      const onError = vi.fn<ServerErrorHook>(() => undefined);
      const onCompleteShell = vi.fn();
      configureServerErrors({ onError });
      const stream = renderToStream(() => <main>{hole as unknown as JSX.Element}</main>, {
        onCompleteShell
      });
      let body: string;
      if (consumer === "response") {
        const response = await createSSRResponse(stream, undefined);
        expect(response.status).toBe(500);
        body = await response.text();
      } else if (consumer === "pipe") {
        const chunks: string[] = [];
        await new Promise<void>(end => stream.pipe({ write: chunk => chunks.push(chunk), end }));
        body = chunks.join("");
      } else if (consumer === "pipeTo") {
        const chunks: string[] = [];
        await stream.pipeTo(
          new WritableStream({
            write: chunk => {
              chunks.push(new TextDecoder().decode(chunk));
            }
          })
        );
        body = chunks.join("");
      } else body = await new Response(stream.readable).text();
      expect(body).toBe("");
      expect(onCompleteShell).not.toHaveBeenCalled();
      expect(stream.hasErrors).toBe(true);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[1]).toMatchObject({ handling: "serialize" });
    }
  );

  test("resolves pipeTo only after a slow consumer drains a failed render", async () => {
    const gate = Promise.withResolvers<WeakMap<object, unknown>>();
    const events: string[] = [];
    configureServerErrors({ onError: () => undefined });
    const stream = renderToStream(() => {
      sharedConfig.context!.serialize("bad", gate.promise);
      return <p>shell</p>;
    });
    await stream.pipeTo(
      new WritableStream({
        async write() {
          events.push("write");
          gate.resolve(new WeakMap());
          await new Promise(resolve => setTimeout(resolve, 20));
          events.push("written");
        },
        close() {
          events.push("close");
        }
      })
    );
    events.push("resolved");
    expect(events).toEqual(["write", "written", "close", "resolved"]);
    expect(stream.hasErrors).toBe(true);
  });

  test.each(["await", "pipe", "pipeTo", "readable"] as const)(
    "contains a cleanup that throws as a healthy render completes (%s)",
    async consumer => {
      const onError = vi.fn<ServerErrorHook>(() => undefined);
      configureServerErrors({ onError });
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        const stream = renderToStream(() => {
          onCleanup(() => {
            throw new Error("cleanup");
          });
          return <p>healthy</p>;
        });
        let html: Promise<string>;
        if (consumer === "await") html = Promise.resolve(stream);
        else if (consumer === "pipe") {
          const chunks: string[] = [];
          html = new Promise(resolve =>
            stream.pipe({ write: chunk => chunks.push(chunk), end: () => resolve(chunks.join("")) })
          );
        } else if (consumer === "pipeTo") {
          const chunks: string[] = [];
          html = stream
            .pipeTo(
              new WritableStream({
                write: chunk => {
                  chunks.push(new TextDecoder().decode(chunk));
                }
              })
            )
            .then(() => chunks.join(""));
        } else html = new Response(stream.readable).text();
        const timeout = new Promise<"timeout">(resolve =>
          setTimeout(() => resolve("timeout"), 1000)
        );
        expect(await Promise.race([html, timeout])).toContain("healthy");
        await new Promise(resolve => setTimeout(resolve));
        expect(unhandled).not.toHaveBeenCalled();
        expect(stream.hasErrors).toBe(true);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0]?.[1]).toMatchObject({ handling: "failed" });
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    }
  );

  test("completes once when a custom serializer calls onDone twice", async () => {
    const onCompleteAll = vi.fn();
    let ends = 0;
    const options = {
      onCompleteAll,
      serializer: ({ onDone }: HydrationSerializerOptions) => ({
        write() {},
        flush() {
          onDone?.();
          onDone?.();
        }
      })
    };
    const stream = renderToStream(() => <p>shell</p>, options);
    await new Promise<void>(resolve =>
      stream.pipe({
        write() {},
        end() {
          ends++;
          resolve();
        }
      })
    );
    await new Promise(resolve => setTimeout(resolve));
    expect(onCompleteAll).toHaveBeenCalledTimes(1);
    expect(ends).toBe(1);
  });

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

  test("completes a frame stream whose client prop fails to serialize under a local hook", async () => {
    const onError = vi.fn<ServerErrorHook>(() => undefined);
    const View = (props: any) => (
      <ul>
        <props.item meta={new WeakMap()} />
        <props.item meta={{ healthy: true }} />
      </ul>
    );
    const timeout = new Promise<"timeout">(resolve => setTimeout(() => resolve("timeout"), 1000));
    const chunks: any = await Promise.race([
      renderServerComponent(View, { frame: { id: "unsupported-arg" }, onError }),
      timeout
    ]);
    expect(chunks).not.toBe("timeout");
    expect(chunks.at(-1).type).toBe("complete");
    const table = createJSONDataTable();
    for (const chunk of chunks.filter((c: any) => c.type === "data")) table.apply(chunk);
    const slots = chunks.filter((c: any) => c.type === "slot");
    expect(table.resolve(slots[1].args.meta)).toEqual({ healthy: true });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toMatchObject({ handling: "serialize" });
  });

  test.each([true, false])(
    "settles a JSON serializer write that fails to parse (onError: %s)",
    withOnError => {
      const keys: string[] = [];
      const onDone = vi.fn();
      const onError = vi.fn();
      const serializer = createJSONSerializer({
        onData: (record: { key: string }) => keys.push(record.key),
        onDone,
        ...(withOnError ? { onError } : {})
      });
      serializer.write("before", { ok: true });
      const fail = () => serializer.write("bad", new WeakMap());
      if (withOnError) fail();
      else expect(fail).toThrow();
      serializer.write("after", { ok: true });
      serializer.flush();
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(keys).toEqual(["before", "after"]);
      expect(onError).toHaveBeenCalledTimes(withOnError ? 1 : 0);
    }
  );

  test.each([true, false])(
    "does not complete early when a failed JSON write's parsed rejection settles (onError: %s)",
    async withOnError => {
      const onDone = vi.fn();
      const pending = Promise.withResolvers<number>();
      const serializer = createJSONSerializer({
        onData() {},
        onDone,
        ...(withOnError ? { onError() {} } : {})
      });
      const fail = () =>
        serializer.write("bad", { rejected: Promise.reject(new Error("x")), value: new WeakMap() });
      if (withOnError) fail();
      else expect(fail).toThrow();
      serializer.write("after", pending.promise);
      serializer.flush();
      await new Promise(resolve => setTimeout(resolve));
      expect(onDone).not.toHaveBeenCalled();
      pending.resolve(1);
      await new Promise(resolve => setTimeout(resolve));
      expect(onDone).toHaveBeenCalledTimes(1);
    }
  );

  test.each([true, false])(
    "decodes a value a failed JSON write shared with a later write (onError: %s)",
    withOnError => {
      const shared = { label: "shared" };
      const table = createJSONDataTable();
      const serializer = createJSONSerializer({
        onData: record => table.apply(record),
        ...(withOnError ? { onError() {} } : {})
      });
      const fail = () => serializer.write("bad", { shared, value: new WeakMap() });
      if (withOnError) fail();
      else expect(fail).toThrow();
      serializer.write("after", { shared });
      expect(table.resolve({ $ref: "after" })).toEqual({ shared: { label: "shared" } });
    }
  );

  test.each([true, false])(
    "releases the async sources of a JSON write whose parse fails (onError: %s)",
    async withOnError => {
      const release = vi.fn();
      const items = {
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<number>>(() => {}),
          return() {
            release();
            return Promise.resolve({ done: true as const, value: undefined });
          }
        })
      };
      const serializer = createJSONSerializer({
        onData() {},
        ...(withOnError ? { onError() {} } : {})
      });
      const fail = () => serializer.write("bad", { items, value: new WeakMap() });
      if (withOnError) fail();
      else expect(fail).toThrow(SerovalParserError);
      await new Promise(resolve => setTimeout(resolve));
      expect(release).toHaveBeenCalledTimes(1);
    }
  );

  test("stops a JSON write when close() runs inside its first record", async () => {
    const pending = Promise.withResolvers<number>();
    const records: boolean[] = [];
    const onDone = vi.fn();
    const serializer: ReturnType<typeof createJSONSerializer> = createJSONSerializer({
      onData(record: { initial: boolean }) {
        records.push(record.initial);
        if (record.initial) serializer.close();
      },
      onDone
    });
    serializer.write("value", pending.promise);
    pending.resolve(1);
    await new Promise(resolve => setTimeout(resolve));
    expect(records).toEqual([true]);
    expect(onDone).toHaveBeenCalledTimes(1);
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
