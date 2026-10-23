/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#4064 — a live hole whose value is a `<For>`'s rows marks
 * each row, and on a live response a sweep that changed some rows sends
 * just those rows by index, against the digest of what the client shows.
 * Anywhere else the hole goes whole.
 */
import { expect, test } from "vitest";
import { createMemo, For, Repeat } from "solid-js";
import { Loading } from "@solidjs/web";
import { renderServerComponent } from "../../frames/src/frame-sink.js";
import { content, records } from "./wire.js";

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
const holes = (chunks: any[]) => records(chunks, "hole:").map(([, r]) => r);

async function run(pushes: Row[][], live = true) {
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
  const { chunks, done } = consume(renderServerComponent(List, { frame: { id: "f" }, live }));
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
  const html = content(chunks, ["", "seg"]).join("");
  expect(html).toContain("<ul><!--lh:0--><!--lr--><li>a</li><!--lr--><li>b</li><!--lh:/0--></ul>");
});

test("a sweep that changed one row sends that row by index", async () => {
  const chunks = await run([rows("a", "b", "c"), rows("a", "B", "c")]);
  const [op] = holes(chunks);
  expect(op.value).toBeUndefined();
  // Same structure: the row travels as its edit, text run 0 of element 0.
  expect(op.rows).toEqual({ n: 3, r: [[1, [[0, 0, "B"]], expect.any(Number)]] });
  // The base is the digest the client's ledger took from the first render.
  const [, first] = records(chunks, "").find(([, r]) => r && r.holes && r.holes["lh:0"])!;
  expect(op.base).toBe(first.holes["lh:0"]);
});

test("off a live response the hole goes whole", async () => {
  const chunks = await run([rows("a", "b", "c"), rows("a", "B", "c")], false);
  const [op] = holes(chunks);
  expect(op.rows).toBeUndefined();
  expect(op.value).toBe("<!--lr--><li>a</li><!--lr--><li>B</li><!--lr--><li>c</li>");
  // The client applies hole ops through its live wire tier, so the response
  // announces it, no later than the first op.
  const at = chunks.findIndex(c => c.tiers?.includes("wire"));
  expect(at).toBeGreaterThanOrEqual(0);
  expect(at).toBeLessThanOrEqual(chunks.findIndex(c => holes([c]).length));
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
  expect(op.value).toBe("<!--lr--><li>x</li><!--lr--><li>y</li>");
});

async function runRows<T>(pushes: T[][], row: (r: T) => any) {
  const ch = channel<T[]>();
  const List = () => {
    const view = createMemo(() => ch.iterable);
    return (
      <Loading fallback={<p>wait</p>}>
        <table>
          <tbody>
            <For each={view()}>{row}</For>
          </tbody>
        </table>
      </Loading>
    );
  };
  const { chunks, done } = consume(renderServerComponent(List, { frame: { id: "f" }, live: true }));
  await tick();
  for (const p of pushes) {
    ch.push(p);
    await tick(20);
  }
  ch.end();
  await done;
  return chunks;
}

type Cell = { cls: string; text: string; show?: boolean };
const cell = (r: Cell) => (
  <tr>
    <td class={r.cls}>
      {r.text}
      <span>{r.show ? <b>!</b> : null}</span>
    </td>
  </tr>
);

test("a row with the same structure ships its attribute and text edits and its shape", async () => {
  const chunks = await runRows(
    [
      [
        { cls: "a", text: "x" },
        { cls: "a", text: "y" }
      ],
      [
        { cls: "a", text: "x" },
        { cls: "b", text: "<y> & z" }
      ]
    ],
    cell
  );
  const [op] = holes(chunks);
  const [[i, patch, shape]] = op.rows.r;
  expect(i).toBe(1);
  // Entities decode: the client writes text, not markup. The text run is
  // the td's second slot, after its text hole's opening marker.
  expect(patch).toEqual([
    [1, ' class="b"'],
    [1, 1, "<y> & z"]
  ]);
  expect(typeof shape).toBe("number");
  // The row's html still feeds the digests; it never rides the wire.
  expect(JSON.stringify(op.rows)).not.toContain("<td");
});

test("a row whose structure changed ships whole", async () => {
  const chunks = await runRows(
    [
      [
        { cls: "a", text: "x" },
        { cls: "a", text: "y" }
      ],
      [
        { cls: "a", text: "x" },
        { cls: "a", text: "y", show: true }
      ]
    ],
    cell
  );
  const [op] = holes(chunks);
  const [[i, html]] = op.rows.r;
  expect(i).toBe(1);
  expect(html).toContain("<b>!</b>");
});

test("an SVG attribute change ships the row whole", async () => {
  const chunks = await runRows(
    [
      [{ w: "1" }, { w: "2" }],
      [{ w: "1" }, { w: "3" }]
    ],
    (r: { w: string }) => (
      <tr>
        <td>
          <svg viewBox={`0 0 ${r.w} 1`} />
        </td>
      </tr>
    )
  );
  const [op] = holes(chunks);
  expect(typeof op.rows.r[0][1]).toBe("string");
});

test("a live Repeat's rows travel as row ops too", async () => {
  const ch = channel<string[]>();
  const List = () => {
    const view = createMemo(() => ch.iterable);
    return (
      <Loading fallback={<p>wait</p>}>
        <ul>
          <Repeat count={view().length}>{i => <li>{view()[i]}</li>}</Repeat>
        </ul>
      </Loading>
    );
  };
  const { chunks, done } = consume(renderServerComponent(List, { frame: { id: "f" }, live: true }));
  await tick();
  for (const p of [
    ["a", "b", "c"],
    ["a", "B", "c"]
  ]) {
    ch.push(p);
    await tick(20);
  }
  ch.end();
  await done;
  const [op] = holes(chunks);
  expect(op.value).toBeUndefined();
  expect(op.rows).toEqual({ n: 3, r: [[1, [[0, 0, "B"]], expect.any(Number)]] });
});
