/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";
import { createSignal } from "solid-js";

function extractHydrationKeys(html: string): string[] {
  const matches = [...html.matchAll(/_hk=([^\s>]+)/g)];
  return matches.map(m => m[1]);
}

describe("Spread element hydration key alignment", () => {
  test("two sibling spread elements produce sequential _hk values", () => {
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

    // With the bug, memo() in ssrElement children consumes an extra parent slot
    // per spread element, shifting the second <a>'s _hk value.
    // The two <a> elements should have consecutive last-segment IDs.
    const anchorKeys = keys.filter((_, i) => i > 0); // skip the outer <div>
    expect(anchorKeys).toHaveLength(2);

    const firstParts = anchorKeys[0].split("-");
    const secondParts = anchorKeys[1].split("-");
    const firstLast = parseInt(firstParts[firstParts.length - 1]);
    const secondLast = parseInt(secondParts[secondParts.length - 1]);
    expect(secondLast - firstLast).toBe(1);
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

    // All three <a> elements should have consecutive last-segment IDs
    const anchorKeys = keys.slice(1);
    const lastSegments = anchorKeys.map(k => parseInt(k.split("-").pop()!));
    expect(lastSegments[1] - lastSegments[0]).toBe(1);
    expect(lastSegments[2] - lastSegments[1]).toBe(1);
  });

  // #3313: `<a {...props} />` — children arrive INSIDE the spread, so the
  // only place they are ever read is ssrElement's prop loop. The compiled
  // `children` getter builds the child element and consumes its hydration
  // id; a second read consumed a second id the client never allocates, and
  // every element after the first such spread hydrated against the wrong
  // node. The two-sibling specs above never reach this path: JSX children
  // make ssrElement skip the spread's `children` entirely.
  test("children carried in the spread of a self-closing wrapper keep every _hk contiguous", () => {
    function Link(props: any) {
      return <a {...props} />;
    }

    function App() {
      return (
        <div>
          <Link href="/a">
            <span>A</span>
          </Link>
          <Link href="/b">
            <span>B</span>
          </Link>
          <Link href="/c">
            <svg />
          </Link>
          <pre>done</pre>
        </div>
      );
    }

    const html = renderToString(() => <App />);
    const keys = extractHydrationKeys(html);

    // div, a, span, a, span, a, svg — one id each, in document order (the
    // static <pre> is template content and takes none). The regression
    // produced 0,1,3,4,6,7,9: a skipped id after every spread's child.
    const lastSegments = keys.map(k => parseInt(k.split("-").pop()!));
    expect(lastSegments).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  // The contract the ids depend on, pinned directly: ssrElement reads each
  // spread key at most once, and never reads `children` when JSX children
  // already own the slot. A "harmless" hoist of the read above the
  // ChildProperties early-out is exactly what broke it.
  test("ssrElement reads a spread's children getter once when self-closing", () => {
    let reads = 0;
    const spread = {
      href: "/x",
      get children() {
        reads++;
        return "inner";
      }
    };
    const html = renderToString(() => <a {...spread} />);
    expect(html).toContain(">inner</a>");
    expect(reads).toBe(1);
  });

  test("ssrElement does not read a spread's children getter when JSX children are present", () => {
    let reads = 0;
    const spread = {
      href: "/x",
      get children() {
        reads++;
        return "from-spread";
      }
    };
    const html = renderToString(() => <a {...spread}>from-jsx</a>);
    expect(html).toContain(">from-jsx</a>");
    expect(html).not.toContain("from-spread");
    expect(reads).toBe(0);
  });

  test("ssrElement reads every other spread key exactly once", () => {
    const reads: Record<string, number> = {};
    const counting = (key: string, value: unknown) => ({
      get() {
        reads[key] = (reads[key] ?? 0) + 1;
        return value;
      },
      enumerable: true
    });
    const spread = Object.defineProperties(
      {},
      {
        class: counting("class", "c"),
        style: counting("style", { color: "red" }),
        "data-x": counting("data-x", "x"),
        hidden: counting("hidden", true),
        onClick: counting("onClick", () => {})
      }
    );
    renderToString(() => <div {...spread} />);
    expect(reads).toEqual({ class: 1, style: 1, "data-x": 1, hidden: 1, onClick: 1 });
  });

  // #3286 is the change that moved the read: textarea value/defaultValue in a
  // spread are its content, never attributes — and still read once.
  test("textarea value in a spread renders as content, read once", () => {
    let reads = 0;
    const spread = {
      "data-x": "x",
      get value() {
        reads++;
        return "typed";
      }
    };
    const html = renderToString(() => <textarea {...spread} />);
    expect(html).toMatch(/data-x="x"\s*>typed<\/textarea>/);
    expect(html).not.toContain(' value="typed"');
    expect(reads).toBe(1);
  });
});
