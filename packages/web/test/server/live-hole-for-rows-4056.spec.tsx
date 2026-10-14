/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4056 — a `<For>` inside a markup hole that re-emits ran
 * `mapFn` for every row on every sweep, so a list's render cost was paid per
 * write. During sweeps a row whose item is the same reference at the same
 * index — the same reference, or a fresh shallow-equal object, as a live
 * source's snapshot usually is — now reuses the row it rendered on the
 * previous sweep. The emitted markup is unchanged.
 */
import { expect, test } from "vitest";
import { createMemo, createStore, For } from "solid-js";
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

test("a fresh snapshot whose items are shallow-equal reuses its rows", async () => {
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
  // Every push is a new array of new objects, as a re-run query hands back.
  ch.push([{ id: "a", text: "A" }]);
  await tick(20);
  ch.push([
    { id: "a", text: "A" },
    { id: "b", text: "B" }
  ]);
  await tick(20);
  ch.push([
    { id: "a", text: "A" },
    { id: "b", text: "BB" }
  ]);
  await tick(20);
  ch.end();
  await done;

  expect(chunks.filter(c => c.type === "hole").map(c => c.html)).toEqual([
    "<li>A</li><li>B</li>",
    "<li>A</li><li>BB</li>"
  ]);
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

test("a row that read a memo besides its item renders again on every sweep", async () => {
  type View = { items: Message[]; sel: string };
  const ch = channel<View>();
  const rendered: string[] = [];
  const Thread = () => {
    const view = createMemo(() => ch.iterable);
    return (
      <Loading fallback={<p>wait</p>}>
        <ol>
          <For each={view().items}>
            {m => {
              rendered.push(m.text);
              return <li>{view().sel === m.id ? "*" : m.text}</li>;
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
  ch.push({ items: [a, b], sel: "a" });
  await tick(20);
  ch.push({ items: [a, b], sel: "b" });
  await tick(20);
  ch.push({ items: [a, b], sel: "x" });
  await tick(20);
  ch.end();
  await done;

  // The selection moves with every push though no item changed.
  expect(chunks.filter(c => c.type === "hole").map(c => c.html)).toEqual([
    "<li>A</li><li>*</li>",
    "<li>A</li><li>B</li>"
  ]);
  expect(rendered.length).toBeGreaterThan(2);
});

test("an item edited in place is not the item the row rendered", async () => {
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
  // One object, edited between pushes — as a store updated in place hands back.
  const a = { id: "a", text: "A" };
  const list = [a];
  ch.push(list);
  await tick(20);
  list.push({ id: "b", text: "B" });
  ch.push(list);
  await tick(20);
  a.text = "AA";
  ch.push(list);
  await tick(20);
  ch.end();
  await done;

  expect(chunks.filter(c => c.type === "hole").map(c => c.html)).toEqual([
    "<li>A</li><li>B</li>",
    "<li>AA</li><li>B</li>"
  ]);
  expect(rendered).toEqual(["A", "B", "AA"]);
});

test("a row whose memos read only its item is still reused", async () => {
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
              const loud = createMemo(() => m.text.toUpperCase());
              return <li>{m.text.length > 1 ? <b>{loud()}</b> : <i>{m.text}</i>}</li>;
            }}
          </For>
        </ol>
      </Loading>
    );
  };
  const { chunks, done } = consume(renderServerComponent(Thread, { frame: { id: "f" } }));
  await tick();
  ch.push([{ id: "a", text: "a" }]);
  await tick(20);
  ch.push([
    { id: "a", text: "a" },
    { id: "b", text: "bb" }
  ]);
  await tick(20);
  ch.end();
  await done;

  expect(chunks.filter(c => c.type === "hole").map(c => c.html)).toEqual([
    "<li><i>a</i></li><li><b>BB</b></li>"
  ]);
  expect(rendered).toEqual(["a", "bb"]);
});

test("a row that read an async store besides its item renders again on every sweep", async () => {
  const items = channel<Message[]>();
  const sel = channel<string>();
  const Thread = () => {
    const view = createMemo(() => items.iterable);
    const [state] = createStore<{ sel?: string }>(async function* (draft) {
      for await (const s of sel.iterable) {
        draft.sel = s;
        yield;
      }
    }, {});
    return (
      <Loading fallback={<p>wait</p>}>
        <ol>
          <For each={view()}>{m => <li>{state.sel === m.id ? "*" : m.text}</li>}</For>
        </ol>
      </Loading>
    );
  };
  const { chunks, done } = consume(renderServerComponent(Thread, { frame: { id: "f" } }));
  await tick();
  const a = { id: "a", text: "A" };
  const b = { id: "b", text: "B" };
  sel.push("a");
  items.push([a, b]);
  await tick(20);
  sel.push("b");
  await tick(20);
  items.end();
  sel.end();
  await done;

  expect(
    chunks
      .filter(c => c.type === "hole")
      .map(c => c.html)
      .at(-1)
  ).toBe("<li>A</li><li>*</li>");
});
