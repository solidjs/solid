/**
 * @jsxImportSource @solidjs/web
 *
 * Frame-face marking off the live address: a frame's live-hole markers are
 * read only by ops in the same response, so a hole that resolved from final
 * values ships unmarked, unbound and without a digest — the document face's
 * gate. The live address keeps every marker: its reconnect names them in the
 * have-list.
 */
import { describe, expect, it } from "vitest";
import { createMemo } from "solid-js";
import { renderServerComponent } from "../../frames/src/frame-sink.js";

async function collect(stream: any) {
  const chunks: any[] = [];
  await new Promise<void>(end => stream.pipe({ write: (c: any) => chunks.push(c), end }));
  return chunks;
}

const Story = (props: { title: string; by: string; href: string }) => (
  <div>
    <h1>{props.title}</h1>
    <a href={props.href}>{props.by}</a>
  </div>
);
const story = { title: "Hello", by: "dang", href: "/users/dang" };

describe("frame-face marking off the live address", () => {
  it("ships synchronous holes unmarked and without digests", async () => {
    const chunks = await collect(
      renderServerComponent(() => <Story {...story} />, { frame: { id: "f" } })
    );
    const html = chunks.find(c => c.type === "html");
    expect(html.html).toBe('<div><h1>Hello</h1><a href="/users/dang">dang</a></div>');
    expect(html.holes).toBeUndefined();
    expect(chunks.some(c => c.type === "hole" || c.type === "attr")).toBe(false);
  });

  it("keeps every marker at the live address", async () => {
    const chunks = await collect(
      renderServerComponent(() => <Story {...story} />, { frame: { id: "f" }, live: true })
    );
    const html = chunks.find(c => c.type === "html");
    expect(html.html).toMatch(/<!--lh:\d+-->Hello<!--lh:\/\d+-->/);
    expect(html.html).toMatch(/ data-lha="\d+"/);
    expect(Object.keys(html.holes)).toContain("lh:0");
  });

  it("marks a hole fed by a pumped iterable and re-emits it", async () => {
    async function* words() {
      yield "one";
      await new Promise(r => setTimeout(r, 5));
      yield "one two";
    }
    const Comp = () => {
      const text = createMemo(() => words());
      return <p>{text()}</p>;
    };
    const chunks = await collect(renderServerComponent(Comp, { frame: { id: "f" } }));
    const shipped = chunks
      .filter(c => c.type === "html" || c.type === "fragment")
      .map(c => c.html)
      .join("");
    expect(shipped).toMatch(/<!--lh:(\d+)-->(<!--!\$-->)?one<!--lh:\/\1-->/);
    expect(chunks.filter(c => c.type === "hole").map(c => c.html)).toEqual(["one two"]);
  }, 8000);
});
