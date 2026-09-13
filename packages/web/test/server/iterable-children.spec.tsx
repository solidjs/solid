/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";

describe("SSR iterable children", () => {
  test("render a Set of children", () => {
    const values = new Set(["before", "after"]);

    expect(renderToString(() => <div>{values}</div>)).toContain(">before<!--!$-->after</div>");
  });

  test("renders an iterable nested in array children", () => {
    const values = ["before", new Set(["middle", "after"])];

    expect(renderToString(() => <div>{values}</div>)).toContain(
      ">beforemiddle<!--!$-->after</div>"
    );
  });
});
