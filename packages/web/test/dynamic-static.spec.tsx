/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import {
  createRoot,
  createSignal,
  flush,
  getOwner,
  isStatic,
  omit,
  type Component,
  type Owner
} from "solid-js";
import { dynamic, type JSX } from "../src/index.js";

const SVG = "http://www.w3.org/2000/svg";

// #3387: `dynamic(source, { static: true })` resolves the source once and
// renders each instance with no computation of its own — the same shape the
// compiler emits for `<tag {...props}>` / `<Comp {...props}>`.
describe("dynamic(source, { static })", () => {
  test("a static tag is the compiled element path: spread, children, reactive attributes", () => {
    const [label, setLabel] = createSignal("one");
    const Tag = dynamic(() => "a", { static: true });
    let el!: HTMLDivElement;
    const dispose = createRoot(dispose => {
      el = (
        <div>
          <Tag href="/x" class={label()}>
            {label()}
          </Tag>
        </div>
      ) as HTMLDivElement;
      return dispose;
    });
    flush();
    expect(el.innerHTML).toBe('<a href="/x" class="one">one</a>');
    // No memo owns the element, but the attributes and children the caller
    // wrote as expressions are still reactive: spread() binds them.
    setLabel("two");
    flush();
    expect(el.innerHTML).toBe('<a href="/x" class="two">two</a>');
    dispose();
  });

  test("the source is called once, untracked, at dynamic() time", () => {
    const [tag, setTag] = createSignal<"a" | "b">("a");
    let calls = 0;
    const Tag = dynamic(() => (calls++, tag()), { static: true });
    expect(calls).toBe(1);
    let el!: HTMLDivElement;
    const dispose = createRoot(dispose => {
      el = (
        <div>
          <Tag />
          <Tag />
        </div>
      ) as HTMLDivElement;
      return dispose;
    });
    flush();
    // `<!---->` are the compiler's separators between adjacent expression
    // children, not anything dynamic() emits.
    expect(el.innerHTML).toBe("<a></a><!----><a></a><!---->");
    expect(calls).toBe(1);
    // Static means static: the source's own signal is not a dependency.
    setTag("b");
    flush();
    expect(el.innerHTML).toBe("<a></a><!----><a></a><!---->");
    expect(calls).toBe(1);
    dispose();
  });

  test("a static component is called with no owner of its own, like compiled JSX", () => {
    const depth = (owner: Owner | null | undefined) => {
      let n = 0;
      for (let o = owner; o; o = o._parent) n++;
      return n;
    };
    let viaCompiled: Owner | null | undefined;
    let viaStatic: Owner | null | undefined;
    let viaMemo: Owner | null | undefined;
    const Inner: Component<{ label: string; seen: (o: Owner | null) => void }> = props => {
      props.seen(getOwner());
      return <span>{props.label}</span>;
    };
    const Static = dynamic(() => Inner, { static: true });
    const Memo = dynamic(() => Inner);
    let el!: HTMLDivElement;
    const dispose = createRoot(dispose => {
      el = (
        <div>
          <div>
            <Inner label="a" seen={o => (viaCompiled = o)} />
          </div>
          <div>
            <Static label="b" seen={o => (viaStatic = o)} />
          </div>
          <div>
            <Memo label="c" seen={o => (viaMemo = o)} />
          </div>
        </div>
      ) as HTMLDivElement;
      return dispose;
    });
    flush();
    expect(el.textContent).toBe("abc");
    // The static path interposes no owner between the call site and the
    // component — exactly compiled `<Inner />` — which is what keeps its
    // hydration keys aligned with the server. The memo path interposes the
    // per-instance memo.
    expect(depth(viaStatic)).toBe(depth(viaCompiled));
    expect(depth(viaMemo)).toBe(depth(viaCompiled) + 1);
    dispose();
  });

  test("a falsy static source renders nothing", () => {
    const Nothing = dynamic(() => null, { static: true });
    let el!: HTMLDivElement;
    const dispose = createRoot(dispose => {
      el = (
        <div>
          <Nothing />
        </div>
      ) as HTMLDivElement;
      return dispose;
    });
    flush();
    expect(el.innerHTML).toBe("");
    dispose();
  });

  test("a static source may not resolve to a promise", () => {
    expect(() => dynamic(() => Promise.resolve("a") as any, { static: true })).toThrow(
      /static source must resolve synchronously/
    );
  });

  test("`is` and `xmlns` still decide how the element is created", () => {
    const Link = dynamic(() => "a", { static: true });
    let svg!: SVGSVGElement;
    const dispose = createRoot(dispose => {
      svg = (
        <svg>
          <Link xmlns={SVG} href="/x" />
        </svg>
      ) as SVGSVGElement;
      return dispose;
    });
    flush();
    const a = svg.firstChild as Element;
    expect(a.namespaceURI).toBe(SVG);
    expect(a.getAttribute("href")).toBe("/x");
    dispose();
  });

  // The polymorphic shape the option exists for: a component keeps a public,
  // reactive `as`, and the literal case (`as="a"`) skips the memo entirely.
  test("isStatic(props, 'as') picks the path per call site", () => {
    function Polymorphic(props: { as: string; children?: JSX.Element; class?: string }) {
      const Tag = dynamic(() => props.as as any, { static: isStatic(props, "as") });
      return <Tag {...omit(props, "as")} />;
    }
    const [asTag, setAsTag] = createSignal<"a" | "span">("a");
    const [cls, setCls] = createSignal("x");
    let el!: HTMLDivElement;
    const dispose = createRoot(dispose => {
      el = (
        <div>
          <Polymorphic as="button" class={cls()}>
            lit
          </Polymorphic>
          <Polymorphic as={asTag()} class={cls()}>
            dyn
          </Polymorphic>
        </div>
      ) as HTMLDivElement;
      return dispose;
    });
    flush();
    const html = () => el.innerHTML.replace(/<!---->/g, "");
    expect(html()).toBe('<button class="x">lit</button><a class="x">dyn</a>');
    // The literal instance took the static path, yet its expression props
    // are as reactive as ever.
    setCls("y");
    flush();
    expect(html()).toBe('<button class="y">lit</button><a class="y">dyn</a>');
    // The getter instance took the memo path: `as` swaps the element.
    setAsTag("span");
    flush();
    expect(html()).toBe('<button class="y">lit</button><span class="y">dyn</span>');
    dispose();
  });
});
