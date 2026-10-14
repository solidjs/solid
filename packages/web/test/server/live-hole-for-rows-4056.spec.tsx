/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4056 — a `<For>` inside a markup hole that re-emits ran
 * `mapFn` for every row on every sweep, so a list's render cost was paid per
 * write. During sweeps a row whose item is the same reference at the same
 * index now reuses the row it rendered on the previous sweep, as the
 * client's `For` keeps its rows. The emitted markup is unchanged.
 */
import { expect, test } from "vitest";
import { createMemo, For } from "solid-js";
import { Loading } from "@solidjs/web";
import { renderServerComponent } from "../../frames/src/frame-sink.js";

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

function consume(stream: any) {
  const chunks: any[] = [];
  const done = new Promise<void>(res =>
    stream.pipe({ write: (c: any) => chunks.push(c), end: res })
  );
  return { chunks, done };
}

/** A push-driven async iterable (the chat model's channel shape). */
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

type Message = { id: string; text: string };

test("a For row whose item is unchanged is not rendered again on a sweep", async () => {
  const ch = channel<Message[]>();
  const rendered: string[] = [];
  const Thread = () => {
    const view = createMemo(() => ch.iterable);
    return (
      <Loading fallback={<p>wait</p>}>
        <ol>
          <For each={view()}>
            {m => {
              rendered.push(m.text);
              return <li>{m.text}</li>;
            }}
          </For>
        </ol>
      </Loading>
    );
  };
  const { chunks, done } = consume(renderServerComponent(Thread, { frame: { id: "f" } }));
  await tick();
  const a = { id: "a", text: "A" };
  const b = { id: "b", text: "B" };
  ch.push([a]);
  await tick(20);
  ch.push([a, b]);
  await tick(20);
  ch.push([a, { ...b, text: "BB" }]);
  await tick(20);
  ch.end();
  await done;

  expect(chunks.find(c => c.type === "fragment").html).toBe(
    "<ol><!--lh:0--><li>A</li><!--lh:/0--></ol>"
  );
  expect(chunks.filter(c => c.type === "hole").map(c => c.html)).toEqual([
    "<li>A</li><li>B</li>",
    "<li>A</li><li>BB</li>"
  ]);
  // Each row renders once per distinct item; before #4056 this was
  // A,A,A,B,A,BB,A,BB.
  expect(rendered).toEqual(["A", "B", "BB"]);
});

test("a row moved to another index renders again", async () => {
  const ch = channel<Message[]>();
  const rendered: string[] = [];
  const Thread = () => {
    const view = createMemo(() => ch.iterable);
    return (
      <Loading fallback={<p>wait</p>}>
        <ol>
          <For each={view()}>
            {(m, i) => {
              rendered.push(m.text);
              return (
                <li>
                  {i()}:{m.text}
                </li>
              );
            }}
          </For>
        </ol>
      </Loading>
    );
  };
  const { chunks, done } = consume(renderServerComponent(Thread, { frame: { id: "f" } }));
  await tick();
  const a = { id: "a", text: "A" };
  const b = { id: "b", text: "B" };
  ch.push([a, b]);
  await tick(20);
  ch.push([a, b, { id: "c", text: "C" }]);
  await tick(20);
  ch.push([b, a]);
  await tick(20);
  ch.end();
  await done;

  const holes = chunks.filter(c => c.type === "hole").map(c => c.html);
  expect(holes.at(-1)).toBe(
    "<li><!--$-->0<!--/-->:<!--$-->B<!--/--></li><li><!--$-->1<!--/-->:<!--$-->A<!--/--></li>"
  );
  expect(rendered.slice(-2)).toEqual(["B", "A"]);
});
