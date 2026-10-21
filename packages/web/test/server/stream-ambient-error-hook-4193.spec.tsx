/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4193 — two `renderToStream` failures bypassed the ambient
 * server error hook (`configureServerErrors`) when the render had no
 * `onError` of its own, and escaped as unhandled rejections:
 *
 * - a value the serializer cannot handle, settling after the shell: the
 *   serializer was only given an error callback when the render had a local
 *   `onError`, so seroval threw from its promise callback, never reached its
 *   `onDone`, and the render stayed pending forever;
 * - an `onCleanup` that throws in the final dispose after a normal
 *   completion: only `abandon()` contained a throwing dispose (#4029).
 *
 * Not pinned here: whether the cleanups registered before a throwing one
 * still run. The owner teardown stops at a throw on the server as it does on
 * the client (`disposeOwner` / `runDisposal`); that is owner semantics, not
 * this containment.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  Loading,
  configureServerErrors,
  renderToStream,
  type ServerErrorContext
} from "@solidjs/web";
import { createMemo, onCleanup } from "solid-js";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Own the process's uncaught channels so an escape fails THIS test. */
async function watchEscapes(run: () => Promise<void>) {
  const events = ["uncaughtException", "unhandledRejection"] as const;
  const previous = events.map(e => process.listeners(e));
  events.forEach(e => process.removeAllListeners(e));
  const escaped: unknown[] = [];
  const capture = (reason: unknown) => escaped.push(reason);
  events.forEach(e => process.on(e, capture));
  try {
    await run();
    for (let turn = 0; turn < 4; turn++) await delay(20);
    return escaped;
  } finally {
    events.forEach((e, i) => {
      process.off(e, capture);
      for (const listener of previous[i]) process.on(e, listener as any);
    });
  }
}

/** Resolves "settled" with the HTML, or "pending" if the render never ends. */
function settle(p: PromiseLike<string>) {
  return Promise.race([
    Promise.resolve(p).then(html => ({ state: "settled", html })),
    delay(500).then(() => ({ state: "pending", html: "" }))
  ]);
}

function pipeSettle(code: () => any, options: Parameters<typeof renderToStream>[1] = {}) {
  return settle(
    new Promise<string>(resolve => {
      const chunks: string[] = [];
      renderToStream(code, options).pipe({
        write(chunk: string) {
          chunks.push(String(chunk));
        },
        end() {
          resolve(chunks.join(""));
        }
      });
    })
  );
}

type Heard = { error: unknown; context: ServerErrorContext };
let heard: Heard[];
let logged: unknown[][];
const ambient = (error: unknown, context: ServerErrorContext) => {
  heard.push({ error, context });
};
const kinds = () => heard.map(h => `${h.context.kind}/${h.context.handling}`);

beforeEach(() => {
  heard = [];
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
});
afterEach(() => {
  configureServerErrors({ onError: undefined });
  vi.restoreAllMocks();
});

/** A page whose async value settles after the shell to `value`. */
function page(value: unknown, extra?: () => void) {
  return () => {
    extra && extra();
    const data = createMemo(() => Promise.resolve(value));
    return (
      <main>
        <Loading fallback="pending">
          <p>{String(data())}</p>
        </Loading>
      </main>
    );
  };
}

describe("renderToStream: a value the serializer cannot handle (#4193)", () => {
  test("reaches the ambient hook as render/serialize and the render settles", async () => {
    configureServerErrors({ onError: ambient });
    let completed = false;
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(
        renderToStream(
          page(() => "fn"),
          {
            onCompleteAll() {
              completed = true;
            }
          }
        )
      );
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(completed).toBe(true);
    expect(kinds()).toEqual(["render/serialize"]);
  });

  test("the piped render settles too", async () => {
    configureServerErrors({ onError: ambient });
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await pipeSettle(page(() => "fn"));
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(kinds()).toEqual(["render/serialize"]);
  });

  test("the render's own onError still wins over the ambient hook", async () => {
    configureServerErrors({ onError: ambient });
    const local: Heard[] = [];
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(
        renderToStream(
          page(() => "fn"),
          { onError: (error, context) => void local.push({ error, context }) }
        )
      );
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(heard).toEqual([]);
    expect(local.map(h => h.context.handling)).toEqual(["serialize"]);
  });

  test("without a hook anywhere the render settles and the failure reaches console.error", async () => {
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(renderToStream(page(() => "fn")));
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(logged.length).toBe(1);
  });
});

describe("renderToStream: an onCleanup that throws in the final dispose (#4193)", () => {
  const cleanupBoom = (ran: string[]) => () => {
    onCleanup(() => ran.push("first"));
    onCleanup(() => {
      throw new Error("cleanup threw");
    });
  };

  test("reaches the ambient hook as render/failed when awaited", async () => {
    configureServerErrors({ onError: ambient });
    const ran: string[] = [];
    let completed = false;
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(
        renderToStream(page("resolved", cleanupBoom(ran)), {
          onCompleteAll() {
            completed = true;
          }
        })
      );
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(result!.html).toContain("resolved");
    expect(completed).toBe(true);
    expect(kinds()).toEqual(["render/failed"]);
    expect((heard[0].error as Error).message).toBe("cleanup threw");
  });

  test("reaches the ambient hook as render/failed when piped", async () => {
    configureServerErrors({ onError: ambient });
    const ran: string[] = [];
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await pipeSettle(page("resolved", cleanupBoom(ran)));
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(kinds()).toEqual(["render/failed"]);
  });

  test("the render's own onError hears it ahead of the ambient hook", async () => {
    configureServerErrors({ onError: ambient });
    const local: Heard[] = [];
    const escaped = await watchEscapes(async () => {
      await settle(
        renderToStream(page("resolved", cleanupBoom([])), {
          onError: (error, context) => void local.push({ error, context })
        })
      );
    });
    expect(escaped).toEqual([]);
    expect(heard).toEqual([]);
    expect(local.map(h => `${h.context.kind}/${h.context.handling}`)).toEqual(["render/failed"]);
  });

  test("without a hook anywhere it reaches console.error", async () => {
    const escaped = await watchEscapes(async () => {
      await settle(renderToStream(page("resolved", cleanupBoom([]))));
    });
    expect(escaped).toEqual([]);
    expect(logged.some(args => (args[0] as Error)?.message === "cleanup threw")).toBe(true);
  });
});
