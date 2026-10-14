/**
 * @jsxImportSource @solidjs/web
 *
 * C13 — one sweep, one frame: the SERVER half (frames-rulings §"The server
 * half", the sweep delimiter). The sink's `sweep()` walks every binding in
 * one span; the hole / attr re-emissions one pass produces leave as ONE
 * unit — `{ type: "ops", ops: [...] }` on the stream face (one chunk, one
 * wire line) and one `sc:live` op of the same shape on the document face —
 * so the client, whose unit of application is the chunk, lands the
 * server's flush as one flush. A pass that changes one binding emits that
 * member alone, as before (the client pins' control arm).
 *
 * Shape: two content holes reading one async-iterable memo. Each yield is
 * one commit → one sweep → both bindings change in the same pass.
 */
import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { createMemo } from "solid-js";
import { Loading, renderToStream } from "@solidjs/web";
import {
  frameTransformDirectResult,
  renderServerComponent,
  ServerComponentPlugin
} from "../../frames/src/frame-sink.js";

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

function consume(stream: any) {
  const chunks: any[] = [];
  const waiters: { test: (c: any) => boolean; resolve: () => void }[] = [];
  const done = new Promise<void>(res =>
    stream.pipe({
      write: (c: any) => {
        chunks.push(c);
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].test(c)) waiters.splice(i, 1)[0].resolve();
        }
      },
      end: res
    })
  );
  const until = (test: (c: any) => boolean) => {
    if (chunks.some(test)) return Promise.resolve();
    return new Promise<void>(resolve => waiters.push({ test, resolve }));
  };
  return { chunks, until, done };
}

/** A push-driven async iterable. */
function channel<T>() {
  const queue: T[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  const wake = () => {
    notify?.();
    notify = null;
  };
  return {
    push(v: T) {
      queue.push(v);
      wake();
    },
    end() {
      done = true;
      wake();
    },
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<T>> {
            while (queue.length === 0) {
              if (done) return { value: undefined as any, done: true };
              await new Promise<void>(r => (notify = r));
            }
            return { value: queue.shift()!, done: false };
          }
        };
      }
    } as AsyncIterable<T>
  };
}

/** Two holes over one source: `<p>{a}</p><p>{b}</p>`, both move per yield. */
function twoHoleComponent(source: () => AsyncIterable<[string, string]>) {
  return () => {
    const pair = createMemo(source);
    return (
      <Loading fallback={<p>typing</p>}>
        <p>{pair()[0]}</p>
        <p>{pair()[1]}</p>
      </Loading>
    );
  };
}

describe("C13 server half — the sink emits one sweep as one unit", () => {
  it("stream face: a sweep that changes two holes emits ONE `ops` chunk; a sweep that changes one emits the plain `hole`", async () => {
    const ch = channel<[string, string]>();
    const { chunks, until, done } = consume(
      renderServerComponent(
        twoHoleComponent(() => ch.iterable),
        { frame: { id: "f" } }
      )
    );
    await tick();
    ch.push(["a0", "b0"]);
    await until(c => c.type === "fragment");
    // Both move: one unit.
    ch.push(["a1", "b1"]);
    await until(c => c.type === "ops");
    // One moves (the second value repeats): the plain member.
    ch.push(["a2", "b1"]);
    await until(c => c.type === "hole");
    ch.end();
    await done;

    const ops = chunks.filter(c => c.type === "ops");
    expect(ops).toHaveLength(1);
    expect(ops[0].id).toBe("f");
    expect(ops[0].version).toBe(1);
    // Members are unaddressed (the envelope addresses them) and carry
    // their digests like any re-emission.
    expect(ops[0].ops.map((m: any) => [m.type, m.html, "id" in m])).toEqual([
      ["hole", "a1", false],
      ["hole", "b1", false]
    ]);
    for (const m of ops[0].ops) expect(typeof m.digest).toBe("string");
    const holes = chunks.filter(c => c.type === "hole");
    expect(holes.map(h => [h.id, h.version, h.html])).toEqual([["f", 1, "a2"]]);
    expect(chunks[chunks.length - 1].type).toBe("complete");
  }, 8000);

  it("document face: a sweep that changes two holes pushes ONE `ops` op on `sc:live`", async () => {
    const ServerComp = twoHoleComponent(async function* () {
      yield ["a0", "b0"] as [string, string];
      await tick();
      yield ["a1", "b1"] as [string, string];
      await tick();
      yield ["a2", "b1"] as [string, string];
    });
    const Inline = frameTransformDirectResult(ServerComp, { id: "sweep-ops/doc" }) as any;
    const html = await new Promise<string>(resolve => {
      const out: string[] = [];
      renderToStream(() => Inline({}), { plugins: [ServerComponentPlugin] } as any).pipe({
        write: (c: string) => out.push(c),
        end: () => resolve(out.join(""))
      });
    });
    const sandbox: any = {
      document: { getElementById: () => null, addEventListener() {} },
      _$HY: { r: {}, fe() {} },
      ReadableStream,
      Promise,
      Symbol
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    for (const [, src] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
      vm.runInContext(src, sandbox);
    }
    const reader = sandbox._$HY.r["sc:live"].getReader();
    const ops: any[] = [];
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      ops.push(r.value);
    }
    expect(ops.map(op => op.type)).toEqual(["ops", "hole"]);
    expect(ops[0].ops.map((m: any) => [m.type, m.html])).toEqual([
      ["hole", "a1"],
      ["hole", "b1"]
    ]);
    expect(ops[1].html).toBe("a2");
  });
});
