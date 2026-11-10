/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4227: a value the serializer cannot handle, handed over
 * already settled. #4206 covers the failure that lands when a serialized
 * promise settles. A value written as is (a `deferStream` value
 * once the shell stops waiting on it, a `getHydrationWriter().write`) fails
 * inside the write itself, and seroval's stream parser never reaches that
 * write's `onDone` after a failed parse. The hook heard `render/serialize`,
 * but the serializer never finished: no `onCompleteAll`, no end of stream,
 * no final dispose, and the awaited render stayed pending forever.
 */
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createRequestEvent,
  createSSRResponse,
  getHydrationWriter,
  renderToStream,
  type ServerErrorContext
} from "@solidjs/web";
import { provideRequestEvent } from "../../storage/src/index.js";
import { createComponent, createMemo, Loading, onCleanup } from "solid-js";
import { pipeSettle, settle, watchEscapes } from "./stream-settle-harness.js";

/** The hydration registry the page's scripts build, run as a browser would. */
function registry(html: string) {
  const sandbox: any = {
    document: { getElementById: () => null, addEventListener() {} },
    _$HY: { r: {}, fe() {} }
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const [, src] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(src, sandbox);
  }
  return sandbox._$HY.r as Record<string, unknown>;
}

let heard: ServerErrorContext[];
let ran: string[];
const onError = (_: unknown, context: ServerErrorContext) => void heard.push(context);
const kinds = () => heard.map(c => `${c.kind}/${c.handling}`);

beforeEach(() => {
  heard = [];
  ran = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A page whose `deferStream` value settles, before the shell, to `value`. */
function deferred(value: unknown) {
  return () => {
    onCleanup(() => ran.push("cleanup"));
    const data = createMemo(() => Promise.resolve(value), { deferStream: true });
    return <main>{typeof data()}</main>;
  };
}

describe("renderToStream: a value that fails inside the serializer write (#4227)", () => {
  test("a deferStream value: the awaited render fails without HTML and is disposed", async () => {
    let completed = false;
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(
        renderToStream(
          deferred(() => "fn"),
          {
            onError,
            onCompleteAll() {
              completed = true;
            }
          }
        )
      );
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(result!.html).toBe("");
    expect(completed).toBe(false);
    expect(ran).toEqual(["cleanup"]);
    expect(kinds()).toEqual(["render/serialize"]);
  });

  test("a deferStream value: the piped stream ends", async () => {
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await pipeSettle(
        deferred(() => "fn"),
        { onError }
      );
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(result!.html).toBe("");
    expect(ran).toEqual(["cleanup"]);
    expect(kinds()).toEqual(["render/serialize"]);
  });

  test("getHydrationWriter().write: a pre-flush failure discards the whole document", async () => {
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(
        renderToStream(
          () => {
            const writer = getHydrationWriter()!;
            writer.write("lib:before", "before");
            writer.write("lib:bad", () => "fn");
            writer.write("lib:after", "after");
            return <main>page</main>;
          },
          { onError }
        )
      );
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(kinds()).toEqual(["render/serialize"]);
    expect(result!.html).toBe("");
    expect(Object.keys(registry(result!.html))).toEqual([]);
  });

  test("without a hook anywhere the render settles and the failure reaches console.error", async () => {
    const logged: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(renderToStream(deferred(() => "fn")));
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(result!.html).toBe("");
    expect(logged.length).toBe(1);
  });
});

describe.each([true, false])("serialization failure with deferStream=%s (#4709)", deferStream => {
  test("before the first flush: HTTP 500, no HTML, no completion", async () => {
    const event = createRequestEvent(new Request("https://example.com/"));
    let completed = false;
    let status: number | undefined;
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(
        provideRequestEvent(event, async () => {
          const response = await createSSRResponse(
            renderToStream(
              () => {
                onCleanup(() => ran.push("cleanup"));
                const ok = createMemo(() => Promise.resolve("ok"), { deferStream: true });
                const bad = createMemo(() => Promise.resolve(() => "fn"), { deferStream });
                return (
                  <main>
                    {ok()} {typeof bad()}
                  </main>
                );
              },
              {
                onError,
                onCompleteAll() {
                  completed = true;
                }
              }
            ),
            event
          );
          status = response.status;
          return response.text();
        })
      );
    });
    expect(escaped).toEqual([]);
    expect(result).toEqual({ state: "settled", html: "" });
    expect(status).toBe(500);
    expect(completed).toBe(false);
    expect(ran).toEqual(["cleanup"]);
    expect(kinds()).toEqual(["render/serialize"]);
  });

  test("before the first flush: pipeTo closes without writing", async () => {
    const chunks: string[] = [];
    let closed = false;
    let completed = false;
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(
        renderToStream(
          () => {
            onCleanup(() => ran.push("cleanup"));
            const bad = createMemo(() => Promise.resolve(() => "fn"), { deferStream });
            return <main>{typeof bad()}</main>;
          },
          {
            onError,
            onCompleteAll() {
              completed = true;
            }
          }
        )
          .pipeTo(
            new WritableStream({
              write(chunk) {
                chunks.push(new TextDecoder().decode(chunk));
              },
              close() {
                closed = true;
              }
            })
          )
          .then(() => chunks.join(""))
      );
    });
    expect(escaped).toEqual([]);
    expect(result).toEqual({ state: "settled", html: "" });
    expect(chunks).toEqual([]);
    expect(closed).toBe(true);
    expect(completed).toBe(false);
    expect(ran).toEqual(["cleanup"]);
    expect(kinds()).toEqual(["render/serialize"]);
  });
});

test("a settled write after the first flush still completes and preserves its siblings", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  let completed = false;
  let status: number | undefined;
  let result: { state: string; html: string } | undefined;
  const escaped = await watchEscapes(async () => {
    const event = createRequestEvent(new Request("https://example.com/"));
    result = await settle(
      provideRequestEvent(event, async () => {
        const response = await createSSRResponse(
          renderToStream(
            () => {
              onCleanup(() => ran.push("cleanup"));
              const writer = getHydrationWriter()!;
              const ready = createMemo(() => gate.then(() => "ready"));
              return (
                <main>
                  {createComponent(Loading, {
                    fallback: "pending",
                    get children() {
                      ready();
                      writer.write("lib:before", "before");
                      writer.write("lib:bad", () => "fn");
                      writer.write("lib:after", "after");
                      return <p>ready</p>;
                    }
                  })}
                </main>
              );
            },
            {
              onError,
              onCompleteAll() {
                completed = true;
              }
            }
          ),
          event
        );
        status = response.status;
        const reader = response.body!.getReader();
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toContain("pending");
        expect(heard).toEqual([]);
        release();
        let html = new TextDecoder().decode(first.value);
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) return html;
          html += new TextDecoder().decode(chunk.value);
        }
      })
    );
  });
  expect(escaped).toEqual([]);
  expect(result!.state).toBe("settled");
  expect(status).toBe(200);
  expect(completed).toBe(true);
  expect(ran).toEqual(["cleanup"]);
  expect(kinds()).toEqual(["render/serialize"]);
  const r = registry(result!.html);
  expect(r["lib:before"]).toBe("before");
  expect(r["lib:after"]).toBe("after");
  expect("lib:bad" in r).toBe(false);
});

describe.each([true, false])("a pending sibling with deferStream=%s", deferStream => {
  test.each(["await", "pipe", "pipeTo", "response"])(
    "%s ends after a synchronous failure",
    async consume => {
      const controller = new AbortController();
      let completed = false;
      let status: number | undefined;
      let result: { state: string; html: string } | undefined;
      try {
        const escaped = await watchEscapes(async () => {
          const event = createRequestEvent(new Request("https://example.com/"));
          result = await settle(
            provideRequestEvent(event, async () => {
              const stream = renderToStream(
                () => {
                  onCleanup(() => ran.push("cleanup"));
                  const writer = getHydrationWriter()!;
                  writer.write("lib:bad", () => "fn");
                  writer.write("lib:pending", new Promise(() => {}), { deferStream });
                  return <main>page</main>;
                },
                {
                  signal: controller.signal,
                  onError,
                  onCompleteAll() {
                    completed = true;
                  }
                }
              );
              if (consume === "await") return await stream;
              if (consume === "response") {
                const response = await createSSRResponse(stream, event);
                status = response.status;
                return response.text();
              }
              const chunks: string[] = [];
              if (consume === "pipeTo") {
                await stream.pipeTo(
                  new WritableStream({
                    write(chunk) {
                      chunks.push(new TextDecoder().decode(chunk));
                    }
                  })
                );
                return chunks.join("");
              }
              return new Promise<string>(resolve =>
                stream.pipe({
                  write(chunk) {
                    chunks.push(String(chunk));
                  },
                  end() {
                    resolve(chunks.join(""));
                  }
                })
              );
            })
          );
        });
        expect(escaped).toEqual([]);
        expect(result).toEqual({ state: "settled", html: "" });
        if (consume === "response") expect(status).toBe(500);
        expect(completed).toBe(false);
        expect(ran).toEqual(["cleanup"]);
        expect(kinds()).toEqual(["render/serialize"]);
      } finally {
        controller.abort();
      }
    }
  );
});

test("a custom serializer's synchronous failure still completes", async () => {
  let completed = false;
  const error = new Error("custom serializer");
  let result: { state: string; html: string } | undefined;
  const escaped = await watchEscapes(async () => {
    result = await settle(
      renderToStream(
        () => {
          onCleanup(() => ran.push("cleanup"));
          getHydrationWriter()!.write("lib:bad", () => "fn");
          return <main>page</main>;
        },
        {
          onError,
          onCompleteAll() {
            completed = true;
          },
          serializer: ({ onError, onDone }: { onError(error: unknown): void; onDone(): void }) => ({
            write(key: string) {
              if (key === "lib:bad") onError(error);
            },
            flush() {
              onDone();
            }
          })
        } as any
      )
    );
  });
  expect(escaped).toEqual([]);
  expect(result!.state).toBe("settled");
  expect(result!.html).toMatch(/<main(?:\s[^>]*)?>page<\/main>/);
  expect(completed).toBe(true);
  expect(ran).toEqual(["cleanup"]);
  expect(kinds()).toEqual(["render/serialize"]);
});
