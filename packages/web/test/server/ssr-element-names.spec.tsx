/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { Errored } from "solid-js";
import { Dynamic, renderToString, ssrElement } from "@solidjs/web";
import { renderServerComponent } from "../../frames/src/frame-sink.js";

// A spread's keys and a dynamic tag are runtime strings. The HTML tokenizer
// ends a name at whitespace, `/`, `>` or `=`, so a name containing one of
// those (or a quote, `<`, a control character, or nothing at all) would not
// be read back as the one name it was. The client's setAttribute and
// createElement refuse such names; on the server an attribute with one is
// dropped and a tag with one throws.
const unreadable = ["a b", 'a"b', "a'b", "a=b", "a>b", "a<b", "a/b", "a\tb", "a\nb", "a\0b", ""];

describe("ssrElement attribute names", () => {
  test("a value attribute whose name is not one HTML name is dropped", () => {
    const props: Record<string, string> = {};
    for (const name of unreadable) props[name] = "v";
    props.id = "kept";
    expect(renderToString(() => ssrElement("div", props, undefined, false))).toBe(
      '<div id="kept"></div>'
    );
  });

  test("a boolean or empty attribute whose name is not one HTML name is dropped", () => {
    const flags: Record<string, boolean> = {};
    const empties: Record<string, string> = {};
    for (const name of unreadable) {
      flags[name] = true;
      empties[name] = "";
    }
    expect(
      renderToString(() =>
        ssrElement("input", { type: "text", ...flags, placeholder: "p" }, undefined, false)
      )
    ).toBe('<input type="text" placeholder="p" />');
    expect(
      renderToString(() => ssrElement("input", { ...empties, disabled: "" }, undefined, false))
    ).toBe("<input disabled />");
  });

  test("a dropped name stays dropped on every render", () => {
    for (let i = 0; i < 3; i++) {
      expect(
        renderToString(() => ssrElement("div", { "a b": "v", "a b c": true }, undefined, false))
      ).toBe("<div></div>");
    }
  });

  test("names the tokenizer reads whole render as written", () => {
    const props = {
      "data-x": "1",
      "aria-label": "l",
      "@click": "open = true",
      "x-on:click": "go()",
      ":class": "c",
      "xlink:href": "#a",
      "a&b": "2",
      hidden: true
    };
    expect(renderToString(() => ssrElement("div", props, undefined, false))).toBe(
      '<div data-x="1" aria-label="l" @click="open = true" x-on:click="go()" :class="c" ' +
        'xlink:href="#a" a&b="2" hidden></div>'
    );
  });

  test("through a compiled spread", () => {
    const props = { "a b": "v", 'a"b': true, "data-ok": "1" };
    expect(renderToString(() => <div {...props} />)).toMatch(
      /^<div( _hk=\w+)? data-ok="1"><\/div>$/
    );
  });

  test("through <Dynamic> with a spread", () => {
    const props = { type: "text", "a b": "", "a=b": "v", placeholder: "p" };
    expect(renderToString(() => <Dynamic component="input" {...props} />)).toMatch(
      /^<input( _hk=\w+)? type="text" placeholder="p" \/>$/
    );
  });
});

describe("ssrElement tag names", () => {
  const invalid = ["div x", "a>b", "a/b", 'a"b', "a=b", "a\tb", "a\0b", "1a", "-a", ""];

  test("a tag that is not one HTML element name throws, on every render", () => {
    for (const tag of invalid) {
      for (let i = 0; i < 2; i++) {
        expect(() => renderToString(() => ssrElement(tag, {}, undefined, false))).toThrow(
          "is not a valid tag name"
        );
      }
    }
  });

  test("<Dynamic> with such a tag fails into its error boundary", () => {
    expect(() => renderToString(() => <Dynamic component="div x" />)).toThrow(
      "is not a valid tag name"
    );
    const html = renderToString(() => (
      <Errored fallback={<p>fallback</p>}>
        <Dynamic component="div x" title="t" />
      </Errored>
    ));
    expect(html).toContain(">fallback</p>");
    expect(html).not.toContain("<div");
  });

  test("custom elements and case-sensitive SVG names render", () => {
    expect(renderToString(() => <Dynamic component="my-widget" data-x="1" />)).toMatch(
      /^<my-widget( _hk=\w+)? data-x="1"><\/my-widget>$/
    );
    expect(renderToString(() => <Dynamic component="foreignObject" />)).toMatch(
      /^<foreignObject( _hk=\w+)?><\/foreignObject>$/
    );
    expect(renderToString(() => ssrElement("x-a.b_c:d", {}, undefined, false))).toBe(
      "<x-a.b_c:d></x-a.b_c:d>"
    );
  });
});

describe("binding-slot spread attribute names", () => {
  test("a stand-in at a key that is not one HTML name binds nothing", async () => {
    const Spread = (props: any) => {
      const row = props.row({ id: 1 });
      return <li {...{ "a b": row.v, "data-ok": row.w, "onClick x": row.pick, onClick: row.go }} />;
    };
    const chunks: any[] = await (renderServerComponent(Spread, { frame: { id: "names" } }) as any);
    const html = chunks
      .find(c => c.type === "html")
      .html.replace(/ data-lha="\d+"/g, "")
      .replace(/<!--lh:\/?\d+-->/g, "");
    expect(html).toContain('<li _s:data-ok="row#0:w" _s:on:click="row#0:go">');
  });
});
