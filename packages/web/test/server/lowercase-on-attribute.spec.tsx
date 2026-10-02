/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString, ssrElement, useHead } from "@solidjs/web";

const noKeys = (html: string) => html.replace(/ _hk=[\w-]+/g, "");

// Only `on` + an uppercase letter (`onClick`) is an event handler in 2.0.
// Lowercase `on*` names are plain attributes, so the server renders them.
describe("lowercase on* names on the server", () => {
  test("a lowercase on* expression renders as an escaped attribute", () => {
    const code = `say("a & b")`;
    const html = renderToString(() => (
      <button
        // @ts-expect-error lowercase on* is not a declared JSX attribute
        onclick={code}
      >
        x
      </button>
    ));
    expect(noKeys(html)).toBe('<button onclick="say(&quot;a &amp; b&quot;)">x</button>');
  });

  test("a camelCase handler still renders nothing beside it", () => {
    const html = renderToString(() => (
      <button
        // @ts-expect-error lowercase on* is not a declared JSX attribute
        onmouseover="hover()"
        onClick={() => {}}
      />
    ));
    expect(noKeys(html)).toBe('<button onmouseover="hover()"></button>');
  });

  test("a function value is stringified and escaped like the client's setAttribute", () => {
    const html = renderToString(() => (
      <button
        // @ts-expect-error lowercase on* is not a declared JSX attribute
        onclick={() => console.log("not a handler")}
      />
    ));
    const value = noKeys(html).match(/^<button onclick="([^"]*)"><\/button>$/);
    expect(value).not.toBeNull();
    expect(value![1]).toContain("&quot;not a handler&quot;");
  });

  test("useHead renders lowercase on* as attributes and skips camelCase handler names", () => {
    function Head() {
      useHead({
        tag: "meta",
        props: { name: "lowercase-on", content: "x", onload: "go()", onLoad: "skipped()" }
      });
      return null;
    }
    const html = renderToString(() => (
      <html>
        <head />
        <body>
          <Head />
        </body>
      </html>
    ));
    const meta = html.match(/<meta[^>]*name="lowercase-on"[^>]*>/);
    expect(meta).not.toBeNull();
    expect(meta![0]).toContain('onload="go()"');
    expect(meta![0]).not.toContain("skipped");
  });

  test("spread: lowercase on* keys render, camelCase keys do not", () => {
    const props: Record<string, unknown> = { onclick: "run()", onClick: () => {} };
    const html = renderToString(() => <div {...props} />);
    expect(noKeys(html)).toBe('<div onclick="run()"></div>');
    expect(ssrElement("div", { oninput: "a<b", onInput: () => {} }, undefined, false).t).toBe(
      '<div oninput="a&lt;b"></div>'
    );
  });
});
