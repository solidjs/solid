/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Router link preload strategies read `preload="viewport"` and `preload="eager"`
// off plain anchors. `test-types` pins the accepted values and this pins that
// they render as written.
import { describe, expect, test } from "vitest";
import { render } from "@solidjs/web";

describe("anchor preload attribute", () => {
  test("renders the strategy values", () => {
    const container = document.createElement("div");
    const dispose = render(
      () => (
        <>
          <a href="/viewport" preload="viewport" />
          <a href="/eager" preload="eager" />
          <a href="/off" preload="false" />
          {/* @ts-expect-error not a preload value */}
          <a href="/typo" preload="hover" />
        </>
      ),
      container
    );

    expect([...container.querySelectorAll("a")].map(a => a.getAttribute("preload"))).toEqual([
      "viewport",
      "eager",
      "false",
      "hover"
    ]);
    dispose();
  });
});
