/**
 * @jsxImportSource @solidjs/web
 *
 * The synchronous half of #4193: a value the serializer cannot handle,
 * handed over already settled. #4206 covers the failure that lands when a
 * serialized promise settles. A value written as is (a `deferStream` value
 * once the shell stops waiting on it, a `getHydrationWriter().write`) fails
 * inside the write itself, and seroval's stream parser never reaches that
 * write's `onDone` after a failed parse. The hook heard `render/serialize`,
 * but the serializer never finished: no `onCompleteAll`, no end of stream,
 * no final dispose, and the awaited render stayed pending forever.
 */
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getHydrationWriter, renderToStream, type ServerErrorContext } from "@solidjs/web";
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

describe("renderToStream: a value that fails inside the serializer write", () => {
  test("a deferStream value: the awaited render settles, completes and is disposed", async () => {
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
    expect(result!.html).toContain(">function</main>");
    expect(completed).toBe(true);
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
    expect(ran).toEqual(["cleanup"]);
    expect(kinds()).toEqual(["render/serialize"]);
  });

  test("getHydrationWriter().write: the render settles and the other keys still reach the client", async () => {
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
    const r = registry(result!.html);
    expect(r["lib:before"]).toBe("before");
    expect(r["lib:after"]).toBe("after");
    expect("lib:bad" in r).toBe(false);
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
    expect(logged.length).toBe(1);
  });
});
