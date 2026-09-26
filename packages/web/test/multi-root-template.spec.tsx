/** @jsxImportSource @solidjs/web */
import { describe, expect, test } from "vitest";
import { render } from "../src/client.js";

describe("multi-root static fragment templates (#3055)", () => {
  test("preserves the fragment array shape and inserts every cloned root", () => {
    const children = (
      <>
        <div>first</div>
        <span>last</span>
      </>
    ) as Node[];

    expect(Array.isArray(children)).toBe(true);
    expect(children.map(node => node.nodeName)).toEqual(["DIV", "SPAN"]);

    const container = document.createElement("main");
    const dispose = render(() => children, container);
    expect(container.innerHTML).toBe("<div>first</div><span>last</span>");
    dispose();
  });

  test("preserves namespaces when an SVG root shares the template", () => {
    const children = (
      <>
        <svg>
          <circle />
        </svg>
        <div />
      </>
    ) as Node[];

    expect((children[0] as SVGElement).namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect((children[0].firstChild as SVGElement).namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect((children[1] as HTMLElement).namespaceURI).toBe("http://www.w3.org/1999/xhtml");
  });
});
