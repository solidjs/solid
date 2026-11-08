/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";

// In HTML, <style> and <script> are raw text. Under <svg> and <math> they are
// ordinary elements whose text parses as markup and character references, so
// SSR escapes their children like any other text (#4704).

const breakout = "</style><b>x</b>";
const escaped = "&lt;/style>&lt;b>x&lt;/b>";
const stripKeys = (html: string) => html.replace(/ _hk=[^\s>]+/g, "");
const render = (code: () => any) => stripKeys(renderToString(code as never));

describe("<style>/<script> children escape in foreign content on the server (#4704)", () => {
  test("under <math>", () => {
    expect(
      render(() => (
        <math>
          <style>{breakout}</style>
        </math>
      ))
    ).toBe(`<math><style>${escaped}</style></math>`);
    expect(
      render(() => (
        <math>
          <script>{"</script><b>x</b>"}</script>
        </math>
      ))
    ).toBe("<math><script>&lt;/script>&lt;b>x&lt;/b></script></math>");
  });

  test("under <svg>", () => {
    expect(
      render(() => (
        <svg>
          <style>{breakout}</style>
        </svg>
      ))
    ).toBe(`<svg><style>${escaped}</style></svg>`);
  });

  test("through an expression inside <svg>", () => {
    const show = true;
    expect(render(() => <svg>{show && <style>{breakout}</style>}</svg>)).toBe(
      `<svg><style>${escaped}</style></svg>`
    );
  });

  test("HTML <style> stays raw text, including back in HTML via <foreignObject>", () => {
    const css = "a > b { content: '&' }";
    expect(render(() => <style>{css}</style>)).toBe(`<style>${css}</style>`);
    expect(
      render(() => (
        <svg>
          <foreignObject>
            <style>{css}</style>
          </foreignObject>
        </svg>
      ))
    ).toBe(`<svg><foreignObject><style>${css}</style></foreignObject></svg>`);
  });
});
