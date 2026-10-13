/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { createMemo } from "solid-js";
import { Loading, renderToStream, renderToString, useHead } from "@solidjs/web";
// @ts-expect-error jsdom ships no types; used only to parse the rendered document
import { JSDOM } from "jsdom";

// An inline <script> body is raw text. Rewriting `</script` keeps the element
// closed, but `<!--` followed by `<script` moves the tokenizer into the
// double-escaped state, where the real `</script>` no longer ends it, and the
// markup after it becomes script text up to a later `</script>` (in these
// documents, all of it). JSON data blocks take every `<` as `\u003C`, which
// parses back to the same value.

const data = { name: "<!--<script>", note: "</script><p>x</p>" };
const raw = JSON.stringify(data);
// The six characters `\u003C`, not the `<` a JS string escape would give.
const escaped = raw.replace(/</g, "\\u003C");

function InlineScript(props: { type?: string; children: string | (() => string) }) {
  useHead({ tag: "script", key: "data", props: { type: props.type, children: props.children } });
  return null;
}

function render(type: string | undefined, children = raw) {
  return renderToString(() => (
    <html>
      <head />
      <body>
        <InlineScript type={type} children={children} />
        <main>content</main>
      </body>
    </html>
  ));
}

describe("useHead JSON script bodies on the server", () => {
  test("<!--<script> in JSON-LD leaves the rest of the document intact", () => {
    const html = render("application/ld+json", JSON.stringify({ name: "<!--<script>" }));
    const { document } = new JSDOM(html).window;
    expect(document.querySelector("main")?.textContent).toBe("content");
    const script = document.querySelector('script[type="application/ld+json"]')!;
    expect(JSON.parse(script.textContent!)).toEqual({ name: "<!--<script>" });
  });

  test.each([
    "application/json",
    "application/ld+json",
    "application/manifest+json",
    "text/json",
    "importmap",
    "ImPoRtMaP",
    "speculationrules",
    "Application/LD+JSON; charset=utf-8",
    "application/json\t; charset=utf-8"
  ])("%j: every < in the body is written as \\u003C", type => {
    const html = render(type);
    expect(html).toContain(`<script type="${type}" data-dh="script:key:data">${escaped}</script>`);
    const { document } = new JSDOM(html).window;
    expect(JSON.parse(document.querySelector("script[data-dh]")!.textContent!)).toEqual(data);
    expect(document.querySelector("main")?.textContent).toBe("content");
  });

  // MIME Sniffing's JSON MIME types, parsed with HTTP whitespace (no form
  // feed), and the importmap and speculationrules keywords as HTML matches
  // them: ASCII case-insensitive, with no whitespace stripping or parameters.
  // Anything else is a data block whose text a caller may read as is.
  test.each([
    "video/json",
    "custom+json",
    "importmap;x",
    "speculationrules;x",
    " importmap ",
    "speculationrules\t",
    "\fapplication/json",
    "application/json\f; charset=utf-8",
    "text/plain"
  ])("%j is not a JSON type: the body is left as is", type => {
    const { document } = new JSDOM(render(type, "<b>template</b>")).window;
    expect(document.querySelector("script[data-dh]")!.textContent).toBe("<b>template</b>");
  });

  // The attribute writer stringifies any value, a Symbol included, so the
  // type check must not throw where the attribute renders.
  test("a Symbol type renders as an attribute and leaves the body as is", () => {
    const html = render(Symbol("plain") as any, "<b>template</b>");
    expect(html).toContain('type="Symbol(plain)"');
    const { document } = new JSDOM(html).window;
    expect(document.querySelector("script[data-dh]")!.textContent).toBe("<b>template</b>");
  });

  test("executable scripts keep the </script rewrite only", () => {
    const code = 'if (a < b) x("</script>")';
    for (const type of [undefined, "module"]) {
      expect(render(type, code)).toContain('>if (a < b) x("<\\/script>")</script>');
    }
  });

  test("a JSON script streamed as a head patch carries the same escaped body", async () => {
    function App() {
      const json = createMemo(() => new Promise<string>(r => setTimeout(() => r(raw), 10)));
      return (
        <html>
          <head />
          <body>
            <Loading fallback={<span>Loading...</span>}>
              <InlineScript type="application/ld+json" children={() => json()} />
              <main>content</main>
            </Loading>
          </body>
        </html>
      );
    }
    const full = await new Promise<string>(resolve => {
      let out = "";
      renderToStream(() => <App />).pipe({
        write: (chunk: string) => void (out += chunk),
        end: () => resolve(out)
      });
    });
    // `["a", identity, tag, attrs, children]`: the client applies children
    // with textContent, so they must already be in the shell's form.
    const op = full.match(/\["a","script:key:data","script",\{[^}]*\},("(?:[^"\\]|\\.)*")\]/);
    expect(op).not.toBeNull();
    expect(JSON.parse(op![1])).toBe(escaped);
  });
});
