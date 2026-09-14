/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, flush } from "solid-js";
import { Dynamic, dynamic, render } from "../src/index.js";

const SVG = "http://www.w3.org/2000/svg";
const XHTML = "http://www.w3.org/1999/xhtml";
const MATHML = "http://www.w3.org/1998/Math/MathML";

function mount(fn: () => any) {
  const container = document.createElement("div");
  const dispose = render(fn, container);
  return { container, dispose };
}

// #3386 part 2. The compiler resolves a tag's namespace from its parent at
// build time; dynamic() creates the element before it has a parent, so a tag
// that exists in both HTML and SVG (`a`, `script`, `style`, `title`) needs
// the instance to say which one it means. `xmlns` is the attribute compiled
// JSX already uses for that (`<a xmlns="http://www.w3.org/2000/svg">`).
describe("dynamic() namespace (#3386)", () => {
  test("a tag in both HTML and SVG is HTML without xmlns (the documented default)", () => {
    const Link = dynamic(() => "a");
    const { container, dispose } = mount(() => (
      <svg>
        <Link href="/x" />
      </svg>
    ));
    const a = container.querySelector("a")!;
    expect(a.namespaceURI).toBe(XHTML);
    dispose();
  });

  test("xmlns picks the namespace and stays on the element as an attribute", () => {
    const Link = dynamic(() => "a");
    const { container, dispose } = mount(() => (
      <svg>
        <Link xmlns={SVG} href="/x">
          <text>hi</text>
        </Link>
      </svg>
    ));
    const a = container.querySelector("a")!;
    expect(a.namespaceURI).toBe(SVG);
    // Same DOM the server produces: it serializes xmlns as a plain attribute
    // and the parser keeps it, so a client-rendered element matches its own
    // hydrated form. (Compiled templates strip it only to stay small.)
    expect(a.getAttribute("xmlns")).toBe(SVG);
    expect(a.getAttribute("href")).toBe("/x");
    expect(a.parentElement!.namespaceURI).toBe(SVG);
    dispose();
  });

  test("xmlns works for MathML too", () => {
    const Tag = dynamic(() => "a");
    const { container, dispose } = mount(() => (
      <math>
        <Tag xmlns={MATHML} />
      </math>
    ));
    expect(container.querySelector("a")!.namespaceURI).toBe(MATHML);
    dispose();
  });

  test("unambiguous SVG tags are still inferred from the tag name alone", () => {
    const Circle = dynamic(() => "circle");
    const { container, dispose } = mount(() => (
      <svg>
        <Circle r="1" />
      </svg>
    ));
    expect(container.querySelector("circle")!.namespaceURI).toBe(SVG);
    dispose();
  });

  test("xmlns overrides tag inference in the other direction too", () => {
    // `filter` infers SVG from the tag name; an explicit xmlns wins.
    const Tag = dynamic(() => "filter");
    const { container, dispose } = mount(() => <Tag xmlns={XHTML} />);
    expect(container.firstElementChild!.namespaceURI).toBe(XHTML);
    dispose();
  });

  test("<Dynamic> honors xmlns the same way", () => {
    const { container, dispose } = mount(() => (
      <svg>
        <Dynamic component="a" xmlns={SVG} href="/y" />
      </svg>
    ));
    const a = container.querySelector("a")!;
    expect(a.namespaceURI).toBe(SVG);
    expect(a.getAttribute("href")).toBe("/y");
    dispose();
  });

  test("xmlns is read once at creation, untracked; later values only update the attribute", () => {
    const [ns, setNs] = createSignal(SVG);
    const Link = dynamic(() => "a");
    const { container, dispose } = mount(() => (
      <svg>
        <Link xmlns={ns()} />
      </svg>
    ));
    const a = container.querySelector("a")!;
    expect(a.namespaceURI).toBe(SVG);
    setNs(XHTML);
    flush();
    // The DOM can't re-namespace a node; the element is the same one, and
    // the attribute follows the value like any other spread attribute.
    expect(container.querySelector("a")).toBe(a);
    expect(a.namespaceURI).toBe(SVG);
    expect(a.getAttribute("xmlns")).toBe(XHTML);
    dispose();
  });
});

// Kobalte's solid2 branch carries a TODO working around "Dynamic/spread
// doesn't pass ref callbacks correctly" (an array of refs through a spread
// into a string tag, at rc.3). Pin the current behavior.
describe("dynamic() ref through spread", () => {
  test("an array of ref callbacks each receives the element once", () => {
    const a = vi.fn();
    const b = vi.fn();
    let c: HTMLElement | undefined;
    const Tag = dynamic(() => "div");
    const others = { ref: [a, b, (el: HTMLElement) => (c = el)], id: "layer" };
    const { container, dispose } = mount(() => <Tag {...others} />);
    const el = container.querySelector("#layer")!;
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(el);
    expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith(el);
    expect(c).toBe(el);
    dispose();
  });

  test("the Kobalte layer shape: own refs + forwarded props.ref, rest spread", () => {
    // dismissable-layer.tsx: <Tag ref={[setRef, interactOutsideRef, props.ref]} {...others}>
    // where `others` is the props minus `ref`.
    const setRef = vi.fn();
    const interactOutsideRef = vi.fn();
    const Tag = dynamic(() => "div");
    function Layer(props: any) {
      const { ref: _ref, ...others } = props;
      return <Tag ref={[setRef, interactOutsideRef, props.ref]} {...others} />;
    }
    const forwarded = vi.fn();
    const { container, dispose } = mount(() => <Layer ref={forwarded} id="x" role="dialog" />);
    const el = container.querySelector("#x")!;
    expect(el.getAttribute("role")).toBe("dialog");
    for (const fn of [setRef, interactOutsideRef, forwarded]) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(el);
    }
    dispose();
  });

  test("ref via createRoot without render: still applied, null owner", () => {
    const seen: Element[] = [];
    const Tag = dynamic(() => "span");
    createRoot(dispose => {
      <Tag ref={(el: Element) => seen.push(el)} />;
      flush();
      expect(seen).toHaveLength(1);
      expect(seen[0].tagName).toBe("SPAN");
      dispose();
    });
  });
});
