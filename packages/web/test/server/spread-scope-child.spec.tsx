/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString, renderToStream, Loading } from "@solidjs/web";
import { createMemo, NoHydration } from "solid-js";

// A spread element's `() => scope(fn)` child must render as the template path renders it.

const stripKeys = (html: string) => html.replace(/ _hk=[^\s>]+/g, "");
const rest = { id: "a" };
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const values: Record<string, () => any> = {
  text: () => "x < y",
  number: () => 42,
  array: () => ["a", "b", 3],
  accessor: () => () => "deep",
  element: () => <b>bold</b>,
  mixed: () => ["t1", <i>it</i>, "t2"],
  empty: () => null
};

describe("dynamic children on spread elements", () => {
  for (const [name, value] of Object.entries(values)) {
    test(`${name}: same content as the template path`, () => {
      const spread = renderToString(() => <span {...rest}>{value()}</span>);
      const template = renderToString(() => <span id="a">{value()}</span>);
      expect(stripKeys(spread)).toBe(stripKeys(template));
      const plain = renderToString(() => (
        <NoHydration>
          <span {...rest}>{value()}</span>
        </NoHydration>
      ));
      expect(plain).toBe(stripKeys(template));
    });
  }

  test("array children keep their text separators", () => {
    expect(stripKeys(renderToString(() => <span {...rest}>{values.array()}</span>))).toBe(
      '<span id="a">a<!--!$-->b<!--!$-->3</span>'
    );
  });

  test("an async child streams its value in place", async () => {
    function App() {
      const label = createMemo(async () => {
        await delay(5);
        return "async label";
      });
      return (
        <Loading fallback={<em>loading</em>}>
          <span {...rest}>{label()}</span>
          <span {...rest}>{[label(), "tail"]}</span>
        </Loading>
      );
    }
    const html = stripKeys(await new Promise<string>(r => renderToStream(() => <App />).then(r)));
    expect(html).toContain('<span id="a">async label</span>');
    expect(html).toContain('<span id="a">async label<!--!$-->tail</span>');
  });
});
