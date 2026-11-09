/**
 * @jsxImportSource @solidjs/web
 *
 * Finished markup is only what the runtime made. A plain object that happens
 * to have the template shape (`{ t }`, `{ t, h, p }`), such as one parsed from
 * JSON, is data at every insert position: it never renders as markup.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMemo, Loading } from "solid-js";
import { renderToStream, renderToString, ssrElement } from "@solidjs/web";

const settled = () => JSON.parse('{"t":"<b>raw</b>"}');
const pending = () => JSON.parse('{"t":["<b>","</b>"],"h":[],"p":[]}');

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("template-shaped data is not markup", () => {
  for (const [name, make] of [
    ["{ t }", settled],
    ["{ t, h, p }", pending]
  ] as const) {
    test(`${name} in a compiled hole`, () => {
      const html = renderToString(() => <h1>Hello {make()}</h1>);
      expect(html).not.toContain("<b>");
      expect(html).toContain("<h1");
    });

    test(`${name} as a component's result`, () => {
      const App = () => make();
      expect(renderToString(() => <App />)).not.toContain("<b>");
    });

    test(`${name} as spread children`, () => {
      const props = { children: make() };
      const html = renderToString(() => <h1 {...props} />);
      expect(html).not.toContain("<b>");
      expect(html).toContain("<h1");
      expect(renderToString(() => ssrElement("h1", props, undefined, false))).not.toContain("<b>");
    });

    test(`${name} inside an array`, () => {
      const html = renderToString(() => <p>{[make(), "text"]}</p>);
      expect(html).not.toContain("<b>");
      expect(html).toContain("text");
    });

    test(`${name} from an async memo under Loading`, async () => {
      function Body() {
        const value = createMemo(async () => make());
        return <div>{value() as any}</div>;
      }
      const html = await renderToStream(() => (
        <Loading fallback="loading">
          <Body />
        </Loading>
      ));
      expect(html.replace(/<script[\s\S]*?<\/script>/g, "")).not.toContain("<b>");
    });
  }

  test("runtime markup still renders, alone and nested", () => {
    expect(renderToString(() => <h1>{<b>made</b>}</h1>)).toMatch(/<b[^>]*>made<\/b>/);
    expect(
      renderToString(() => {
        const props = { children: <b>made</b> };
        return <h1 {...props} />;
      })
    ).toMatch(/<b[^>]*>made<\/b>/);
    expect(renderToString(() => <p>{[<b>a</b>, [<i>b</i>]]}</p>)).toMatch(
      /<b[^>]*>a<\/b>.*<i[^>]*>b<\/i>/
    );
  });

  test("a string of markup is still escaped", () => {
    expect(renderToString(() => <h1>{"<b>x</b>"}</h1>)).toContain("&lt;b>x&lt;/b>");
  });
});
