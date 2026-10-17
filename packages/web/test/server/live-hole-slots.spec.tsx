/**
 * @jsxImportSource @solidjs/web
 *
 * A live markup hole that calls a slot stays live. A call's position in the
 * hole keeps the id the render gave it, so a re-run finds the occurrences
 * it had (a position no render reached is `prop#~<scope>.<n>`); an
 * occurrence whose args did not change sends no record, a new or changed
 * one sends its record ahead of the hole's markup, and one the hole no
 * longer reaches is forgotten (a later return sends its record again). What
 * the render emits is byte for byte what it was.
 */
import { describe, expect, it } from "vitest";
import { createMemo } from "solid-js";
import { renderServerComponent } from "../../frames/src/frame-sink.js";

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

const slots = (chunks: any[]) => chunks.filter(c => c.type === "slot");
const holes = (chunks: any[]) => chunks.filter(c => c.type === "hole");
const rangeIds = (html: string) => [...html.matchAll(/<!--slot:([^>]*?):start-->/g)].map(m => m[1]);
/** The chunks after `n` already seen. */
const since = (chunks: any[], n: number) => chunks.slice(n);

describe("live holes with slot occurrences", () => {
  it("re-runs on each commit: unchanged occurrences send nothing, changed and new ones send their record first", async () => {
    const ch = channel<string[]>();
    const Comp = (props: any) => {
      const items = createMemo(() => ch.iterable);
      return (
        <ul>
          {items().map(i => (
            <li>
              {i}
              {props.copy({ code: i })}
            </li>
          ))}
        </ul>
      );
    };
    const { chunks, until, done } = consume(
      renderServerComponent(Comp, { frame: { id: "f" }, live: true })
    );
    ch.push(["a", "b"]);
    await until(c => c.type === "html");
    const root = chunks.find(c => c.type === "html");
    const ids = rangeIds(root.html);
    expect(ids).toEqual(["copy#0", "copy#1"]);
    expect(root.html).toMatch(/<!--lh:0-->/);
    expect(slots(chunks).map(c => [c.key, c.args])).toEqual([
      [ids[0], { code: "a" }],
      [ids[1], { code: "b" }]
    ]);

    // The second item's args change: its record alone, then the hole.
    let seen = chunks.length;
    ch.push(["a", "c"]);
    await until(c => c.type === "hole");
    let next = since(chunks, seen);
    expect(next.map(c => c.type)).toEqual(["slot", "hole"]);
    expect([next[0].key, next[0].args]).toEqual([ids[1], { code: "c" }]);
    expect(rangeIds(next[1].html)).toEqual(ids);

    // A new third occurrence: its record alone.
    seen = chunks.length;
    ch.push(["a", "c", "d"]);
    await until(c => c.type === "hole" && rangeIds(c.html).length === 3);
    next = since(chunks, seen);
    expect(next.map(c => c.type)).toEqual(["slot", "hole"]);
    expect([next[0].key, next[0].args]).toEqual(["copy#~0.2.0", { code: "d" }]);
    expect(rangeIds(next[1].html)).toEqual([...ids, "copy#~0.2.0"]);

    // Nothing the client holds changed: no record, and no hole either.
    seen = chunks.length;
    ch.push(["a", "c", "d"]);
    ch.end();
    await done;
    expect(since(chunks, seen).map(c => c.type)).toEqual(["complete"]);
  });

  it("an occurrence the hole drops is forgotten: its return sends its record again", async () => {
    const ch = channel<string[]>();
    const Comp = (props: any) => {
      const items = createMemo(() => ch.iterable);
      return <div>{items().map(i => props.copy({ code: i }))}</div>;
    };
    const { chunks, until, done } = consume(
      renderServerComponent(Comp, { frame: { id: "f" }, live: true })
    );
    ch.push(["a", "b"]);
    await until(c => c.type === "html");
    ch.push(["a"]);
    await until(c => c.type === "hole");
    const seen = chunks.length;
    ch.push(["a", "b"]);
    await until(c => holes(c ? [c] : []).length > 0 && rangeIds(c.html).length === 2);
    ch.end();
    await done;
    expect(slots(since(chunks, seen)).map(c => [c.key, c.args])).toEqual([
      ["copy#1", { code: "b" }]
    ]);
  });

  it("`$key` names the occurrence: a reorder moves ranges and sends no record", async () => {
    const ch = channel<string[]>();
    const Comp = (props: any) => {
      const items = createMemo(() => ch.iterable);
      return (
        <ul>
          {items().map(i => (
            <li>{props.copy({ $key: i, code: i })}</li>
          ))}
        </ul>
      );
    };
    const { chunks, until, done } = consume(
      renderServerComponent(Comp, { frame: { id: "f" }, live: true })
    );
    ch.push(["a", "b"]);
    await until(c => c.type === "html");
    expect(rangeIds(chunks.find(c => c.type === "html").html)).toEqual(["copy#a", "copy#b"]);
    const seen = chunks.length;
    ch.push(["b", "a"]);
    await until(c => c.type === "hole");
    ch.end();
    await done;
    const next = since(chunks, seen);
    expect(slots(next)).toEqual([]);
    expect(rangeIds(holes(next)[0].html)).toEqual(["copy#b", "copy#a"]);
  });

  it("a changed data arg re-sends the record under a fresh ref; an equal fresh object sends nothing", async () => {
    const ch = channel<number>();
    const Comp = (props: any) => {
      const n = createMemo(() => ch.iterable);
      return (
        <div>
          {n() > 0 && (
            <p>
              <b>{n()}</b>
              {props.stat({ meta: { tens: Math.floor(n() / 10) } })}
            </p>
          )}
        </div>
      );
    };
    const { chunks, until, done } = consume(
      renderServerComponent(Comp, { frame: { id: "f" }, live: true })
    );
    ch.push(1);
    await until(c => c.type === "html");
    expect(slots(chunks).map(c => c.args)).toEqual([{ meta: { $ref: "arg:stat#0:meta" } }]);
    let seen = chunks.length;
    // A fresh `{ tens: 0 }`: the same arg.
    ch.push(2);
    await until(c => c.type === "hole" && c.html.includes("2"));
    expect(slots(since(chunks, seen))).toEqual([]);
    seen = chunks.length;
    ch.push(12);
    await until(c => c.type === "slot" && c.key === "stat#0" && c !== chunks[0]);
    ch.end();
    await done;
    const next = since(chunks, seen);
    const record = slots(next)[0];
    expect(record.args).toEqual({ meta: { $ref: "arg:stat#0:meta@1" } });
    expect(next.some(c => c.type === "data" && c.key === "arg:stat#0:meta@1")).toBe(true);
  });

  it("a nested hole's own re-run and its parent's re-run give its occurrence the same id", async () => {
    const outer = channel<string>();
    const inner = channel<string>();
    const Comp = (props: any) => {
      const title = createMemo(() => outer.iterable);
      const body = createMemo(() => inner.iterable);
      return (
        <section>
          {title() && (
            <article>
              <h1>{title()}</h1>
              <p>{[body(), props.copy({ code: body() })]}</p>
            </article>
          )}
        </section>
      );
    };
    const { chunks, until, done } = consume(
      renderServerComponent(Comp, { frame: { id: "f" }, live: true })
    );
    outer.push("t1");
    inner.push("b1");
    await until(c => c.type === "html");
    const [id] = rangeIds(chunks.find(c => c.type === "html").html);
    // The inner hole moves alone.
    inner.push("b2");
    await until(c => c.type === "slot" && c.args.code === "b2");
    // The outer hole moves: same occurrence, same args, no record.
    let seen = chunks.length;
    outer.push("t2");
    await until(c => c.type === "hole" && c.html.includes("t2"));
    expect(slots(since(chunks, seen))).toEqual([]);
    const outerHole = holes(since(chunks, seen))[0];
    expect(rangeIds(outerHole.html)).toEqual([id]);
    // After the outer re-emission the outer hole re-runs the inner one.
    seen = chunks.length;
    inner.push("b3");
    await until(c => c.type === "hole" && c.html.includes("t2") && c !== outerHole);
    outer.end();
    inner.end();
    await done;
    expect(slots(since(chunks, seen)).map(c => [c.key, c.args])).toEqual([[id, { code: "b3" }]]);
  });

  it("outside every hole, and on a response nothing can change, ids stay render-positional", async () => {
    const ch = channel<string[]>();
    const Live = (props: any) => {
      const items = createMemo(() => ch.iterable);
      return (
        <div>
          {props.copy({ code: "before" })}
          <ul>{items().map(i => props.copy({ code: i }))}</ul>
          {props.copy({ code: "after" })}
        </div>
      );
    };
    const live = consume(renderServerComponent(Live, { frame: { id: "f" }, live: true }));
    ch.push(["a", "b"]);
    await live.until(c => c.type === "html");
    ch.end();
    await live.done;
    // The ids the render gave are the ones it always gave.
    // (The hole renders when its value lands, after the call that follows it.)
    expect(rangeIds(live.chunks.find(c => c.type === "html").html)).toEqual([
      "copy#0",
      "copy#2",
      "copy#3",
      "copy#1"
    ]);

    const Plain = (props: any) => {
      const items = () => ["a", "b"];
      return (
        <div>
          <ul>{items().map(i => props.copy({ code: i }))}</ul>
          {props.copy({ code: "after" })}
        </div>
      );
    };
    const plain = consume(renderServerComponent(Plain, { frame: { id: "g" } }));
    await plain.done;
    const html = plain.chunks.find(c => c.type === "html").html;
    expect(html).not.toMatch(/<!--lh:/);
    expect(rangeIds(html)).toEqual(["copy#0", "copy#1", "copy#2"]);
  });
});
