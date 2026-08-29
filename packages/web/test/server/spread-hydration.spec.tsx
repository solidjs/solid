/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";

function extractHydrationKeys(html: string): string[] {
  const matches = [...html.matchAll(/_hk=([^\s>]+)/g)];
  return matches.map(m => m[1]);
}

describe("Spread element hydration key alignment", () => {
  test("two sibling spread elements reserve matching merge IDs", () => {
    function Link(props: { linkProps: any; count: number }) {
      return <a {...props.linkProps}>My Link {props.count}</a>;
    }

    function App() {
      const linkProps = { class: "link" };
      return (
        <div>
          <Link linkProps={linkProps} count={1} />
          <Link linkProps={linkProps} count={2} />
        </div>
      );
    }

    const html = renderToString(() => <App />);
    const keys = extractHydrationKeys(html);

    // Each reactive spread reserves one child ID after its element key.
    const anchorKeys = keys.filter((_, i) => i > 0); // skip the outer <div>
    expect(anchorKeys).toHaveLength(2);

    const firstParts = anchorKeys[0].split("-");
    const secondParts = anchorKeys[1].split("-");
    const firstLast = parseInt(firstParts[firstParts.length - 1]);
    const secondLast = parseInt(secondParts[secondParts.length - 1]);
    expect(secondLast - firstLast).toBe(2);
  });

  test("spread element followed by another spread sibling — three siblings", () => {
    function Link(props: { linkProps: any; label: string; count: number }) {
      return (
        <a {...props.linkProps}>
          {props.label} {props.count}
        </a>
      );
    }

    function App() {
      const linkProps = { class: "nav" };
      return (
        <div>
          <Link linkProps={linkProps} label="Home" count={1} />
          <Link linkProps={linkProps} label="About" count={2} />
          <Link linkProps={linkProps} label="Contact" count={3} />
        </div>
      );
    }

    const html = renderToString(() => <App />);
    const keys = extractHydrationKeys(html);

    // 4 _hk values: 1 for <div> + 3 for <a> elements
    expect(keys).toHaveLength(4);

    // Each reactive spread reserves the ID between two element keys.
    const anchorKeys = keys.slice(1);
    const lastSegments = anchorKeys.map(k => parseInt(k.split("-").pop()!));
    expect(lastSegments[1] - lastSegments[0]).toBe(2);
    expect(lastSegments[2] - lastSegments[1]).toBe(2);
  });
});
