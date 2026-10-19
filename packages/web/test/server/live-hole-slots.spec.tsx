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

/** One record as it went out, in wire order (`key: "data"` for a data
 *  message, the message itself as `r`). */
type Entry = { key: string; r: any };

/** The stream read record by record: what the client writes, in order. */
function consume(stream: any) {
  const chunks: Entry[] = [];
  const waiters: { test: (c: Entry) => boolean; resolve: () => void }[] = [];
  const done = new Promise<void>(res =>
    stream.pipe({
      write: (m: any) => {
        const entries = m.r
          ? Object.keys(m.r).map(key => ({ key, r: m.r[key] }))
          : [{ key: m.type, r: m }];
        for (const c of entries) {
          chunks.push(c);
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].test(c)) waiters.splice(i, 1)[0].resolve();
          }
        }
      },
      end: res
    })
  );
  const until = (test: (c: Entry) => boolean) => {
    if (chunks.some(test)) return Promise.resolve();
    return new Promise<void>(resolve => waiters.push({ test, resolve }));
  };
  return { chunks, until, done };
}

const isRoot = (c: Entry) => c.key === "";
const isSlot = (c: Entry) => c.key.startsWith("slot:");
const isHole = (c: Entry) => c.key.startsWith("hole:");
/** The root's html. */
const root = (chunks: Entry[]) => chunks.find(isRoot)!.r.value;
/** Slot records as `[occurrence, args]`. */
const slots = (chunks: Entry[]) => chunks.filter(isSlot).map(c => [c.key.slice(5), c.r.args]);
/** Hole records' html. */
const holes = (chunks: Entry[]) => chunks.filter(isHole).map(c => c.r.value);
/** What each record is: `slot`, `hole`, `complete`, ... */
const kinds = (chunks: Entry[]) =>
  chunks.map(c =>
    c.key === "" ? "root" : c.key[0] === ":" ? c.key.slice(1) : c.key.split(":")[0]
  );
const rangeIds = (html: string) => [...html.matchAll(/<!--slot:([^>]*?):start-->/g)].map(m => m[1]);
/** The records after `n` already seen. */
const since = (chunks: Entry[], n: number) => chunks.slice(n);

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
    await until(isRoot);
    const ids = rangeIds(root(chunks));
    expect(ids).toEqual(["copy#0", "copy#1"]);
    expect(root(chunks)).toMatch(/<!--lh:0-->/);
    expect(slots(chunks)).toEqual([
      [ids[0], { code: "a" }],
      [ids[1], { code: "b" }]
    ]);

    // The second item's args change: its record alone, then the hole.
    let seen = chunks.length;
    ch.push(["a", "c"]);
    await until(isHole);
    let next = since(chunks, seen);
    expect(kinds(next)).toEqual(["slot", "hole"]);
    expect(slots(next)[0]).toEqual([ids[1], { code: "c" }]);
    expect(rangeIds(holes(next)[0])).toEqual(ids);

    // A new third occurrence: its record alone.
    seen = chunks.length;
    ch.push(["a", "c", "d"]);
    await until(c => isHole(c) && rangeIds(c.r.value).length === 3);
    next = since(chunks, seen);
    expect(kinds(next)).toEqual(["slot", "hole"]);
    expect(slots(next)[0]).toEqual(["copy#~0.2.0", { code: "d" }]);
    expect(rangeIds(holes(next)[0])).toEqual([...ids, "copy#~0.2.0"]);

    // Nothing the client holds changed: no record, and no hole either.
    seen = chunks.length;
    ch.push(["a", "c", "d"]);
    ch.end();
    await done;
    expect(kinds(since(chunks, seen))).toEqual(["complete"]);
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
    await until(isRoot);
    ch.push(["a"]);
    await until(isHole);
    const seen = chunks.length;
    ch.push(["a", "b"]);
    await until(c => isHole(c) && rangeIds(c.r.value).length === 2);
    ch.end();
    await done;
    expect(slots(since(chunks, seen))).toEqual([["copy#1", { code: "b" }]]);
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
    await until(isRoot);
    expect(rangeIds(root(chunks))).toEqual(["copy#a", "copy#b"]);
    const seen = chunks.length;
    ch.push(["b", "a"]);
    await until(isHole);
    ch.end();
    await done;
    const next = since(chunks, seen);
    expect(slots(next)).toEqual([]);
    expect(rangeIds(holes(next)[0])).toEqual(["copy#b", "copy#a"]);
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
    await until(isRoot);
    expect(slots(chunks).map(([, args]) => args)).toEqual([{ meta: { $ref: "arg:stat#0:meta" } }]);
    const first = chunks.find(isSlot);
    let seen = chunks.length;
    // A fresh `{ tens: 0 }`: the same arg.
    ch.push(2);
    await until(c => isHole(c) && c.r.value.includes("2"));
    expect(slots(since(chunks, seen))).toEqual([]);
    seen = chunks.length;
    ch.push(12);
    await until(c => c.key === "slot:stat#0" && c !== first);
    ch.end();
    await done;
    const next = since(chunks, seen);
    const [, args] = slots(next)[0];
    expect(args).toEqual({ meta: { $ref: "arg:stat#0:meta@1" } });
    expect(next.some(c => c.key === "data" && c.r.key === "arg:stat#0:meta@1")).toBe(true);
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
    await until(isRoot);
    const [id] = rangeIds(root(chunks));
    // The inner hole moves alone.
    inner.push("b2");
    await until(c => isSlot(c) && c.r.args.code === "b2");
    // The outer hole moves: same occurrence, same args, no record.
    let seen = chunks.length;
    outer.push("t2");
    await until(c => isHole(c) && c.r.value.includes("t2"));
    expect(slots(since(chunks, seen))).toEqual([]);
    const outerHole = since(chunks, seen).find(isHole)!;
    expect(rangeIds(outerHole.r.value)).toEqual([id]);
    // After the outer re-emission the outer hole re-runs the inner one.
    seen = chunks.length;
    inner.push("b3");
    await until(c => isHole(c) && c.r.value.includes("t2") && c !== outerHole);
    outer.end();
    inner.end();
    await done;
    expect(slots(since(chunks, seen))).toEqual([[id, { code: "b3" }]]);
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
    await live.until(isRoot);
    ch.end();
    await live.done;
    // The ids the render gave are the ones it always gave.
    // (The hole renders when its value lands, after the call that follows it.)
    expect(rangeIds(root(live.chunks))).toEqual(["copy#0", "copy#2", "copy#3", "copy#1"]);

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
    const html = root(plain.chunks);
    expect(html).not.toMatch(/<!--lh:/);
    expect(rangeIds(html)).toEqual(["copy#0", "copy#1", "copy#2"]);
  });
});
