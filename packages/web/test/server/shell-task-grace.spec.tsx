/**
 * @jsxImportSource @solidjs/web
 */
// The shell waits one task for pending fragments before it flushes: data that
// resolves on the next turn of the event loop (an in-memory cache behind a
// server function, `setTimeout(0)`) renders inline, with no fallback, no
// template and no reveal. 1.x behaved the same; 2.0 had only a handful of
// microtask turns, so any read that crossed a task streamed its fallback.
import { describe, expect, test } from "vitest";
import { renderToStream } from "@solidjs/web";
import { createMemo, Loading } from "solid-js";

function collect(code: () => any): { chunks: string[]; done: Promise<string> } {
  const chunks: string[] = [];
  const done = new Promise<string>(resolve => {
    renderToStream(code).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
  return { chunks, done };
}

const Page = (props: { read: () => Promise<string> }) => {
  const value = createMemo(() => props.read());
  return (
    <main>
      <Loading fallback={<p>FALLBACK</p>}>
        <p>{value()}</p>
      </Loading>
      <footer>end</footer>
    </main>
  );
};

describe("shell flush grants pending fragments one task", () => {
  test.each([
    [
      "a long microtask chain",
      async () => {
        for (let i = 0; i < 20; i++) await null;
        return "DATA";
      }
    ],
    ["the next task", () => new Promise<string>(r => setImmediate(() => r("DATA")))]
  ])("data ready after %s renders inline", async (_, read) => {
    const { chunks, done } = collect(() => <Page read={read} />);
    const html = await done;
    expect(chunks[0]).toMatch(/<p[^>]*>DATA<\/p>/);
    expect(html).not.toContain("FALLBACK");
    expect(html).not.toContain("<template");
  });

  test("data still pending after the grace streams behind its fallback", async () => {
    let release!: (v: string) => void;
    const gate = new Promise<string>(r => (release = r));
    const { chunks, done } = collect(() => <Page read={() => gate} />);
    while (!chunks.length) await new Promise(r => setTimeout(r, 1));
    expect(chunks[0]).toContain("FALLBACK");
    expect(chunks[0]).toContain("<footer>end</footer>");
    release("DATA");
    const html = await done;
    expect(html.indexOf("DATA")).toBeGreaterThan(chunks[0].length - 1);
  });
});
