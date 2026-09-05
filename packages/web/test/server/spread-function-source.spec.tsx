/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString, Dynamic, mergeProps, ssrElement } from "@solidjs/web";

// Regression (#2815): SSR dropped props whose spread source is a function.
// The compiler passes spread sources lazily (`mergeProps({...static}, fn)`).
// dom-expressions' server entry used to ship its own merger that resolved a
// function source for key enumeration only — the per-key getter read
// `fn[key]` (undefined) and the attribute vanished from the HTML. The server
// entry now sources `mergeProps` from solid-js, exactly
// like the client and universal entries.
describe("SSR spread with function source (#2815)", () => {
  test("mergeProps resolves function sources for values, not just keys", () => {
    const fn = () => ({ "data-x": "1" });
    const html = renderToString(() => ssrElement("div", mergeProps({ id: "y" }, fn), "x", false));
    expect(html).toContain('data-x="1"');
    expect(html).toContain('id="y"');
  });

  test("object spread source still renders (no regression)", () => {
    const obj = { "data-x": "1" };
    const html = renderToString(() => ssrElement("div", mergeProps({ id: "y" }, obj), "x", false));
    expect(html).toContain('data-x="1"');
    expect(html).toContain('id="y"');
  });

  test("JSX spread of a function call result alongside a static attribute", () => {
    const html = renderToString(() => <div id="y" {...(() => ({ "data-x": "1" }))()} />);
    expect(html).toContain('data-x="1"');
    expect(html).toContain('id="y"');
  });

  test("textarea value from props merged around a spread becomes text content (#3286)", () => {
    const value = () => "something";
    const html = renderToString(() => <textarea {...{ "data-x": "x" }} value={value()} />);

    expect(html).toMatch(/data-x="x"\s*>something<\/textarea>/);
    expect(html).not.toContain(' value="something"');
  });

  test("textarea value supplied by a spread becomes text content (#3286)", () => {
    const html = renderToString(() => <textarea {...{ "data-x": "x", value: "something" }} />);

    expect(html).toMatch(/data-x="x"\s*>something<\/textarea>/);
    expect(html).not.toContain(' value="something"');
  });

  test("textarea value before a spread remains text content (#3286)", () => {
    const html = renderToString(() => <textarea value="something" {...{ "data-x": "x" }} />);

    expect(html).toMatch(/data-x="x"\s*>something<\/textarea>/);
    expect(html).not.toContain(' value="something"');
  });

  test("textarea defaultValue supplied by a spread becomes text content (#3286)", () => {
    const html = renderToString(() => (
      <textarea {...{ "data-x": "x", defaultValue: "something" }} />
    ));

    expect(html).toMatch(/data-x="x"\s*>something<\/textarea>/);
    expect(html).not.toContain(' defaultValue="something"');
  });

  test("Dynamic routes spreads through mergeProps", () => {
    const props = { "data-x": "1", id: "y" };
    const html = renderToString(() => <Dynamic component="div" {...props} />);
    expect(html).toContain('data-x="1"');
    expect(html).toContain('id="y"');
  });

  test("later function source overrides earlier static prop", () => {
    const fn = () => ({ id: "override" });
    const html = renderToString(() => ssrElement("div", mergeProps({ id: "y" }, fn), "x", false));
    expect(html).toContain('id="override"');
    expect(html).not.toContain('id="y"');
  });
});
