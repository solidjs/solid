/**
 * @jsxImportSource @solidjs/web
 *
 * C13 — one sweep, one frame: the SERVER half (frames-rulings §"The server
 * half", the sweep delimiter). The sink's `sweep()` walks every binding in
 * one span; the hole / attr re-emissions one pass produces leave as ONE
 * unit — one record batch, never split across messages, on the stream face
 * (one wire line) and one `sc:live` batch on the document face — so the
 * client, whose unit of application is the message, lands the server's
 * flush as one flush. A pass that changes one binding writes that record
 * alone (the client pins' control arm).
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
import { has, records, writesSegment } from "./wire.js";

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
  it("stream face: a sweep that changes two holes writes ONE batch with both; a sweep that changes one writes that `hole:` record alone", async () => {
    const ch = channel<[string, string]>();
    const { chunks, until, done } = consume(
      renderServerComponent(
        twoHoleComponent(() => ch.iterable),
        { frame: { id: "f" } }
      )
    );
    await tick();
    ch.push(["a0", "b0"]);
    await until(writesSegment);
    const holes = (c: any) => records([c], "hole:");
    // Both move: one unit.
    ch.push(["a1", "b1"]);
    await until(c => holes(c).length === 2);
    // One moves (the second value repeats): its record alone.
    ch.push(["a2", "b1"]);
    await until(c => holes(c).some(([, r]) => r.value === "a2"));
    ch.end();
    await done;

    const sweeps = chunks.filter(c => holes(c).length);
    expect(sweeps).toHaveLength(2);
    expect(sweeps[0].id).toBe("f");
    expect(sweeps[0].version).toBe(1);
    // Records are unaddressed (the batch addresses them) and carry their
    // digests like any re-emission.
    expect(holes(sweeps[0]).map(([key, r]) => [key.slice(0, 5), r.kind, r.value])).toEqual([
      ["hole:", "html", "a1"],
      ["hole:", "html", "b1"]
    ]);
    for (const [, r] of holes(sweeps[0])) expect(typeof r.digest).toBe("string");
    expect(sweeps.slice(1).map(c => [c.id, c.version, holes(c).map(([, r]) => r.value)])).toEqual([
      ["f", 1, ["a2"]]
    ]);
    expect(has(chunks[chunks.length - 1], ":complete")).toBe(true);
  }, 8000);

  it("document face: a sweep that changes two holes pushes ONE two-record batch on `sc:live`", async () => {
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
    // Two batches: the two-hole sweep as ONE, then the one-hole sweep.
    expect(ops.map(op => Object.keys(op.r).length)).toEqual([2, 1]);
    expect(Object.values(ops[0].r).map((m: any) => [m.kind, m.value])).toEqual([
      ["html", "a1"],
      ["html", "b1"]
    ]);
    expect((Object.values(ops[1].r)[0] as any).value).toBe("a2");
  });
});
