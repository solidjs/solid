/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4064 — a live hole whose value is a `<For>`'s rows marks
 * each row, and a sweep that changed some rows sends just those rows by
 * index (plus the whole html, for a client that can't apply them).
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

type Row = { id: string; text: string };
const holes = (chunks: any[]) =>
  chunks.flatMap(c => (c.type === "ops" ? c.ops : c.type === "hole" ? [c] : []));

async function run(pushes: Row[][]) {
  const ch = channel<Row[]>();
  const List = () => {
    const view = createMemo(() => ch.iterable);
    return (
      <Loading fallback={<p>wait</p>}>
        <ul>
          <For each={view()}>{r => <li>{r.text}</li>}</For>
        </ul>
      </Loading>
    );
  };
  const { chunks, done } = consume(renderServerComponent(List, { frame: { id: "f" } }));
  await tick();
  for (const p of pushes) {
    ch.push(p);
    await tick(20);
  }
  ch.end();
  await done;
  return chunks;
}

const rows = (...t: string[]) => t.map((text, i) => ({ id: String(i), text }));

test("first render marks each row of a live For", async () => {
  const chunks = await run([rows("a", "b")]);
  const html = chunks
    .filter(c => c.type === "fragment" || c.type === "html")
    .map(c => c.html)
    .join("");
  expect(html).toContain("<ul><!--lh:0--><!--lr--><li>a</li><!--lr--><li>b</li><!--lh:/0--></ul>");
});

test("a sweep that changed one row sends that row by index", async () => {
  const chunks = await run([rows("a", "b", "c"), rows("a", "B", "c")]);
  const [op] = holes(chunks);
  expect(op.html).toBe("<!--lr--><li>a</li><!--lr--><li>B</li><!--lr--><li>c</li>");
  expect(op.rows).toEqual({ n: 3, r: [[1, "<li>B</li>"]] });
  expect(op.base).toBeUndefined();
});

test("appends and truncation ride the row count; the next op names its base", async () => {
  const chunks = await run([rows("a", "b"), rows("a", "b", "c"), rows("a")]);
  const [append, truncate] = holes(chunks);
  expect(append.rows).toEqual({ n: 3, r: [[2, "<li>c</li>"]] });
  expect(truncate.rows).toEqual({ n: 1, r: [] });
  expect(truncate.base).toBe(append.digest);
});

test("a sweep that changed every row sends the whole hole", async () => {
  const chunks = await run([rows("a", "b"), rows("x", "y")]);
  const [op] = holes(chunks);
  expect(op.rows).toBeUndefined();
  expect(op.html).toBe("<!--lr--><li>x</li><!--lr--><li>y</li>");
});
