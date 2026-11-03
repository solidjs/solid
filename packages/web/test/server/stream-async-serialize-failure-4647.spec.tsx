/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4647: a serialized async value whose answer the serializer
 * cannot handle. The key already went out to the client as a pending
 * promise and nothing will ever settle it; the hook heard
 * `render/serialize`, yet the render completed and `onCompleteAll` reported
 * the document whole. A rejected value in the same spot fails the render;
 * so does this one. A value that fails as it is handed over never reaches
 * the client and still completes (#4227).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStream, type ServerErrorContext } from "@solidjs/web";
import { createMemo, Loading, onCleanup } from "solid-js";
import { settle, watchEscapes } from "./stream-settle-harness.js";

class Unserializable {}

let heard: string[];
let ran: string[];
const onError = (_: unknown, context: ServerErrorContext) =>
  void heard.push(`${context.kind}/${context.handling}`);

beforeEach(() => {
  heard = [];
  ran = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

function App() {
  onCleanup(() => ran.push("cleanup"));
  const value = createMemo(() => Promise.resolve(new Unserializable()));
  return <main>{String(value() instanceof Unserializable)}</main>;
}

/** A page whose boundary value settles once `gate` opens. */
function late(gate: Promise<void>) {
  return () => {
    onCleanup(() => ran.push("cleanup"));
    const value = createMemo(() => gate.then(() => new Unserializable()));
    return (
      <main>
        <Loading fallback="pending">
          <p>{String(value() instanceof Unserializable)}</p>
        </Loading>
      </main>
    );
  };
}

describe("renderToStream: an async value that fails to serialize (#4647)", () => {
  test("the awaited render fails like a rejection: no HTML, no onCompleteAll", async () => {
    let completed = false;
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(
        renderToStream(App, {
          onError,
          onCompleteAll() {
            completed = true;
          }
        })
      );
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(result!.html).toBe("");
    expect(completed).toBe(false);
    expect(heard).toEqual(["render/serialize"]);
    expect(ran).toEqual(["cleanup"]);
  });

  test("after the shell, the piped stream ends without onCompleteAll", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    let completed = false;
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(
        new Promise<string>(resolve => {
          const chunks: string[] = [];
          renderToStream(late(gate), {
            onError,
            onCompleteAll() {
              completed = true;
            }
          }).pipe({
            write(chunk: string) {
              chunks.push(String(chunk));
              release();
            },
            end() {
              resolve(chunks.join(""));
            }
          });
        })
      );
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(result!.html).toContain("pending");
    expect(completed).toBe(false);
    expect(heard).toEqual(["render/serialize"]);
    expect(ran).toEqual(["cleanup"]);
  });

  test("a custom serializer's late failure is its own to settle: the render completes", async () => {
    // Reports every promise's answer as a failure, then settles the write.
    const serializer = ({ onError, onDone }: { onError(e: unknown): void; onDone(): void }) => {
      let pending = 0;
      let flushed = false;
      let finished = false;
      const settleWrite = () => {
        if (!flushed || pending || finished) return;
        finished = true;
        onDone();
      };
      return {
        write(_: string, value: any) {
          if (!value || typeof value.then !== "function") return;
          pending++;
          value.then(
            () => {
              onError(new Error("late"));
              pending--;
              settleWrite();
            },
            () => {
              pending--;
              settleWrite();
            }
          );
        },
        flush() {
          flushed = true;
          settleWrite();
        }
      };
    };
    let completed = false;
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(
        renderToStream(App, {
          onError,
          serializer,
          onCompleteAll() {
            completed = true;
          }
        } as any)
      );
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(result!.html).toContain("<main");
    expect(completed).toBe(true);
    expect(heard).toEqual(["render/serialize"]);
    expect(ran).toEqual(["cleanup"]);
  });

  test("without a hook anywhere the failure reaches console.error once", async () => {
    const logged: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    let result: { state: string; html: string } | undefined;
    const escaped = await watchEscapes(async () => {
      result = await settle(renderToStream(App));
    });
    expect(escaped).toEqual([]);
    expect(result!.state).toBe("settled");
    expect(result!.html).toBe("");
    expect(logged.length).toBe(1);
  });
});
