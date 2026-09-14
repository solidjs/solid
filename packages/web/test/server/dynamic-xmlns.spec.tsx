/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString, dynamic } from "@solidjs/web";

const SVG = "http://www.w3.org/2000/svg";

// #3386 part 2, server side: nothing to resolve — HTML has no namespaces in
// the serialization, the browser's parser assigns them from the tree. `xmlns`
// is just serialized like compiled JSX does (`<a xmlns=…>` keeps it in SSR
// output), so the hydrated DOM carries the same attribute the client would
// set, and hydration claims the parser-namespaced node.
describe("dynamic() xmlns on the server (#3386)", () => {
  test("xmlns serializes as an ordinary attribute", () => {
    const Link = dynamic(() => "a");
    const html = renderToString(() => (
      <svg>
        <Link xmlns={SVG} href="/x">
          <text>hi</text>
        </Link>
      </svg>
    ));
    expect(html.replace(/ _hk=\w+/g, "")).toBe(
      '<svg><a xmlns="http://www.w3.org/2000/svg" href="/x"><text>hi</text></a></svg>'
    );
  });

  test("matches what compiled JSX emits for the same element", () => {
    const Link = dynamic(() => "a");
    const viaDynamic = renderToString(() => (
      <svg>
        <Link xmlns={SVG} href="/x" />
      </svg>
    )).replace(/ _hk=\w+/g, "");
    const compiled = renderToString(() => (
      <svg>
        <a xmlns={SVG} href="/x" />
      </svg>
    )).replace(/ _hk=\w+/g, "");
    expect(viaDynamic).toBe(compiled);
  });
});
