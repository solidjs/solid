/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { createSignal, isStatic, omit } from "solid-js";
import { renderToString, dynamic, type JSX } from "@solidjs/web";

const SVG = "http://www.w3.org/2000/svg";
const noKeys = (html: string) => html.replace(/ _hk=[\w-]+/g, "");

// #3387, server side. The static path exists to match the compiled output's
// SHAPE, so the invariant that matters here is hydration keys: a static
// dynamic() creates no owner, so its keys are the compiled element's, not the
// memo path's.
describe("dynamic(source, { static }) on the server", () => {
  test("a static tag is the compiled markup, with the key a runtime element needs", () => {
    const Tag = dynamic(() => "a", { static: true });
    const viaDynamic = renderToString(() => (
      <div>
        <Tag href="/x" class="c">
          hi
        </Tag>
      </div>
    ));
    const compiled = renderToString(() => (
      <div>
        <a href="/x" class="c">
          hi
        </a>
      </div>
    ));
    // Same markup; a compiled element inside a template needs no key of its
    // own, while any element created at runtime does, so the `<a>` keeps one.
    // What the static path removes is the OWNER, which is what the key's
    // DEPTH shows — see the memo comparison below.
    expect(noKeys(viaDynamic)).toBe(noKeys(compiled));
    expect(viaDynamic).toBe('<div _hk=0><a _hk=1 href="/x" class="c">hi</a></div>');
  });

  test("a static component is byte-identical to the compiled call", () => {
    // A component has no element of its own, so there is nothing left to
    // distinguish the two: same markup, same keys.
    const Inner = (props: { label: string }) => <span>{props.label}</span>;
    const Comp = dynamic(() => Inner, { static: true });
    expect(
      renderToString(() => (
        <div>
          <Comp label="hi" />
        </div>
      ))
    ).toBe(
      renderToString(() => (
        <div>
          <Inner label="hi" />
        </div>
      ))
    );
  });

  test("the memo path allocates an owner the static path does not", () => {
    const Static = dynamic(() => "a", { static: true });
    const Memo = dynamic(() => "a");
    const staticHtml = renderToString(() => (
      <div>
        <Static href="/x" />
      </div>
    ));
    const memoHtml = renderToString(() => (
      <div>
        <Memo href="/x" />
      </div>
    ));
    // Same markup …
    expect(noKeys(staticHtml)).toBe(noKeys(memoHtml));
    // … but the memo path's element sits one owner deeper, which its key
    // spells out. That is the cost the static path removes, and the reason
    // client and server must agree on `static` per instance.
    expect(staticHtml).toBe('<div _hk=0><a _hk=1 href="/x"></a></div>');
    expect(memoHtml).toBe('<div _hk=0><a _hk=10 href="/x"></a></div>');
  });

  test("the source is called once, untracked", () => {
    const [tag, setTag] = createSignal<"a" | "b">("a");
    let calls = 0;
    const Tag = dynamic(() => (calls++, tag()), { static: true });
    expect(calls).toBe(1);
    expect(noKeys(renderToString(() => <Tag />))).toBe("<a></a>");
    expect(noKeys(renderToString(() => <Tag />))).toBe("<a></a>");
    expect(calls).toBe(1);
    setTag("b");
    expect(noKeys(renderToString(() => <Tag />))).toBe("<a></a>");
    expect(calls).toBe(1);
  });

  test("a falsy static source renders nothing", () => {
    const Nothing = dynamic(() => null, { static: true });
    expect(
      noKeys(
        renderToString(() => (
          <div>
            <Nothing />
          </div>
        ))
      )
    ).toBe("<div></div>");
  });

  test("a static source may not resolve to a promise", () => {
    expect(() => dynamic(() => Promise.resolve("a") as any, { static: true })).toThrow(
      /static source must resolve synchronously/
    );
  });

  test("xmlns serializes as an ordinary attribute, as on the memo path", () => {
    const Link = dynamic(() => "a", { static: true });
    const html = renderToString(() => (
      <svg>
        <Link xmlns={SVG} href="/x" />
      </svg>
    ));
    expect(noKeys(html)).toBe('<svg><a xmlns="http://www.w3.org/2000/svg" href="/x"></a></svg>');
  });

  // The shape the option exists for. `isStatic` reads the same descriptors on
  // both sides — the compiler encodes `as="a"` as a data property and
  // `as={expr}` as a getter in the server output too — so the two instances
  // below choose the same paths the client chooses, which is what makes the
  // keys line up. The parity harness (`polymorphic-chain-static`) pins that
  // end to end.
  test("isStatic picks the path per call site, and the literal matches compiled", () => {
    function Polymorphic(props: { as: string; children?: JSX.Element; class?: string }) {
      const Tag = dynamic(() => props.as as any, { static: isStatic(props, "as") });
      return <Tag {...omit(props, "as")} />;
    }
    const [asTag] = createSignal<"a" | "span">("a");
    const html = renderToString(() => (
      <div>
        <Polymorphic as="button" class="x">
          lit
        </Polymorphic>
        <Polymorphic as={asTag()} class="x">
          dyn
        </Polymorphic>
      </div>
    ));
    // `<!--$-->`/`<!--/-->` bracket each component's output on the server.
    expect(noKeys(html).replace(/<!--[$/]-->/g, "")).toBe(
      '<div><button class="x">lit</button><a class="x">dyn</a></div>'
    );
    // The literal instance took the static path and the getter instance the
    // memo path, which their key depths spell out (one owner apart).
    const keys = [...html.matchAll(/<(?:button|a) _hk=([\w-]+)/g)].map(m => m[1]);
    expect(keys).toHaveLength(2);
    expect(keys[1].length).toBe(keys[0].length + 1);
  });
});
