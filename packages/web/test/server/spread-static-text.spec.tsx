/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";

// A spread element renders through `ssrElement` instead of a template. Its
// static text children and its static textarea `value` must come out escaped
// and ordered exactly as the template path renders them (#3557).

const stripKeys = (html: string) => html.replace(/ _hk=[^\s>]+/g, "");
const render = (code: () => any) => stripKeys(renderToString(code));

const rest = { id: "a" };
const withValue = { id: "a", value: "from-spread" };

describe("static text on spread elements (#3557)", () => {
  test("a static text child is escaped", () => {
    expect(render(() => <div {...rest}>a &lt;b&gt; &amp; c</div>)).toBe(
      '<div id="a">a &lt;b> &amp; c</div>'
    );
    expect(render(() => <div>a &lt;b&gt; &amp; c</div>)).toBe("<div>a &lt;b&gt; &amp; c</div>");
  });

  test("script and style children stay raw", () => {
    expect(render(() => <script {...rest}>a &lt;b&gt; &amp;&amp; c</script>)).toBe(
      '<script id="a">a <b> && c</script>'
    );
    expect(render(() => <style {...rest}>a &gt; b</style>)).toBe('<style id="a">a > b</style>');
  });

  test("a static textarea value is escaped on both paths", () => {
    expect(render(() => <textarea {...rest} value="a &lt;b&gt; &amp; c" />)).toBe(
      '<textarea id="a">a &lt;b> &amp; c</textarea>'
    );
    expect(render(() => <textarea value="a &lt;b&gt; &amp; c" />)).toBe(
      "<textarea>a &lt;b> &amp; c</textarea>"
    );
    expect(render(() => <textarea value="x&amp;lt;y</textarea>z" />)).toBe(
      "<textarea>x&amp;lt;y&lt;/textarea>z</textarea>"
    );
  });

  test("a static textarea value follows source order against a spread", () => {
    expect(render(() => <textarea {...withValue} value="static" />)).toBe(
      '<textarea id="a">static</textarea>'
    );
    expect(render(() => <textarea value="static" {...withValue} />)).toBe(
      '<textarea id="a">from-spread</textarea>'
    );
  });
});
