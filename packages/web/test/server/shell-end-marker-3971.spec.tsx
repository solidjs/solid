/**
 * @jsxImportSource @solidjs/web
 */
// #3971: a render that emits <HydrationScript /> ends its shell with a marker
// script after its records,
// so a hydrate() started mid-parse (an `async` entry) can park until the
// whole shell is in the DOM. The bootstrap declares the ledger it writes to.
import { describe, expect, test } from "vitest";
import {
  generateHydrationScript,
  HydrationScript,
  renderToStream,
  renderToString
} from "@solidjs/web";
import { createMemo, Loading } from "solid-js";

function collect(code: () => any, options?: any): Promise<{ chunks: string[]; html: string }> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, options).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve({ chunks, html: chunks.join("") })
    });
  });
}

const MARKER = `<script>_$HY.s[""]=1,_$HY.sw&&_$HY.sw("")</script>`;

const Doc = (props: { children: any }) => (
  <html>
    <head>
      <HydrationScript />
    </head>
    <body>{props.children}</body>
  </html>
);

describe("shell-end marker (#3971)", () => {
  test("only an in-render <HydrationScript /> declares the shell ledger", () => {
    // Host-placed bootstraps (hand-built documents, islands hosts like Astro)
    // get no ledger, so hydrate() never parks under them.
    expect(generateHydrationScript()).not.toContain("s:{}");
    expect(
      renderToString(() => (
        <Doc>
          <p>x</p>
        </Doc>
      ))
    ).toContain("s:{},fe(){}");
  });

  test("renderToString ends with the marker, after the records", () => {
    const html = renderToString(() => (
      <Doc>
        <button>edit</button>
      </Doc>
    ));
    expect(html.endsWith(MARKER)).toBe(true);
    expect(html.indexOf("_$HY")).toBeLessThan(html.indexOf(MARKER));
  });

  test("a render without <HydrationScript /> is unchanged", () => {
    expect(renderToString(() => <p>x</p>)).not.toContain("_$HY.s[");
  });

  test("the marker carries the render id and nonce", () => {
    const html = renderToString(
      () => (
        <Doc>
          <p>x</p>
        </Doc>
      ),
      { renderId: "isl", nonce: "n0" }
    );
    expect(
      html.endsWith(`<script nonce="n0">_$HY.s["isl"]=1,_$HY.sw&&_$HY.sw("isl")</script>`)
    ).toBe(true);
  });

  test("noScripts renders carry no marker", () => {
    const html = renderToString(
      () => (
        <Doc>
          <p>x</p>
        </Doc>
      ),
      { noScripts: true }
    );
    expect(html).not.toContain("_$HY.s[");
  });

  test("a stream ends its shell chunk with the marker, before any streamed fragment", async () => {
    const Late = () => {
      const v = createMemo(() => new Promise<string>(r => setTimeout(() => r("late"), 10)));
      return <span>{v()}</span>;
    };
    const { chunks, html } = await collect(() => (
      <Doc>
        <main>
          <Loading fallback="...">
            <Late />
          </Loading>
        </main>
      </Doc>
    ));
    expect(chunks[0].endsWith(MARKER)).toBe(true);
    expect(html.split(MARKER).length - 1).toBe(1);
    expect(html.indexOf(MARKER)).toBeLessThan(html.indexOf(">late<"));
  });
});
