/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { createRoot, createSignal, Component, createStore, flush, Show, Loading } from "solid-js";
import { Dynamic, dynamic, type IntrinsicElement, type JSX } from "../src/index.js";

describe("Testing Dynamic control flow", () => {
  let div!: HTMLDivElement, disposer: () => void;

  interface ExampleProps {
    id: string;
  }
  const [comp, setComp] = createSignal<Component<ExampleProps> | IntrinsicElement>(),
    [name, setName] = createSignal("Smith");
  const Component = () => (
      <div ref={div}>
        <Dynamic component={comp()} id={name()} />
      </div>
    ),
    CompA: Component<ExampleProps> = props => <div>Hi {props.id}</div>,
    CompB: Component<ExampleProps> = props => <span>Yo {props.id}</span>;

  beforeEach(() => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });
    flush();
  });

  afterEach(() => disposer());

  test("Toggle Dynamic control flow", () => {
    expect(div.innerHTML).toBe("");
    setComp(() => CompA);
    flush();
    expect(div.innerHTML).toBe("<div>Hi Smith</div>");
    setName("Smithers");
    flush();
    expect(div.innerHTML).toBe("<div>Hi Smithers</div>");
    setComp(() => CompB);
    flush();
    expect(div.innerHTML).toBe("<span>Yo Smithers</span>");
    setComp("h1");
    flush();
    expect(div.innerHTML).toBe(`<h1 id="Smithers"></h1>`);
    setName("Sunny");
    flush();
    expect(div.innerHTML).toBe(`<h1 id="Sunny"></h1>`);
    expect(div.querySelector("h1")).toBeInstanceOf(HTMLElement);
  });

  test("Renders SVG elements", () => {
    setComp("svg");
    flush();
    expect(div.querySelector("svg")).toBeInstanceOf(SVGSVGElement);
    setComp("path");
    flush();
    expect(div.querySelector("path")).toBeInstanceOf(SVGElement);
  });
});

describe("Testing Dynamic with state spread", () => {
  let div!: HTMLDivElement, disposer: () => void;

  interface ExampleProps {
    id: string;
  }
  const [comp, setComp] = createSignal<Component<ExampleProps> | IntrinsicElement>(),
    [state, setState] = createStore({
      id: "Smith"
    });
  const Component = () => (
      <div ref={div}>
        <Dynamic component={comp()} {...state} />
      </div>
    ),
    CompA: Component<ExampleProps> = props => <div>Hi {props.id}</div>,
    CompB: Component<ExampleProps> = props => <span>Yo {props.id}</span>;

  beforeEach(() => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });
  });

  afterEach(() => disposer());

  test("Toggle Dynamic control flow", () => {
    expect(div.innerHTML).toBe("");
    setComp(() => CompA);
    flush();
    expect(div.innerHTML).toBe("<div>Hi Smith</div>");
    setState(s => {
      s.id = "Smithers";
    });
    flush();
    expect(div.innerHTML).toBe("<div>Hi Smithers</div>");
    setComp(() => CompB);
    flush();
    expect(div.innerHTML).toBe("<span>Yo Smithers</span>");
    setComp("h1");
    flush();
    expect(div.innerHTML).toBe(`<h1 id="Smithers"></h1>`);
    setState(s => {
      s.id = "Sunny";
    });
    flush();
    expect(div.innerHTML).toBe(`<h1 id="Sunny"></h1>`);
    expect(div.querySelector("h1")).toBeInstanceOf(HTMLElement);
  });
});

describe("Dynamic intrinsic child granularity", () => {
  let disposer!: () => void;

  afterEach(() => disposer());

  test("does not rerun unrelated child slots for intrinsic strings", () => {
    let div!: HTMLDivElement;
    let setShow!: (value: boolean | ((prev: boolean) => boolean)) => boolean;
    const rendered = vi.fn(() => undefined);

    createRoot(dispose => {
      disposer = dispose;
      const [show, _setShow] = createSignal(true);
      setShow = _setShow;

      <div ref={div}>
        <Dynamic component="div">
          <button />
          {rendered()}
          <Show when={show()}>{show() ? "hide" : "show"}</Show>
        </Dynamic>
      </div>;
    });
    flush();

    expect(rendered).toHaveBeenCalledTimes(1);
    expect(div.innerHTML).toBe("<div><button></button>hide</div>");

    setShow(false);
    flush();
    expect(rendered).toHaveBeenCalledTimes(1);
    expect(div.innerHTML).toBe("<div><button></button></div>");
  });

  test("keeps raw array children reactive", () => {
    let div!: HTMLDivElement;
    let setList!: (value: string[] | ((prev: string[]) => string[])) => string[];

    createRoot(dispose => {
      disposer = dispose;
      const [list, _setList] = createSignal(["a", "b"]);
      setList = _setList;

      <div ref={div}>
        <Dynamic component="div">{list()}</Dynamic>
      </div>;
    });
    flush();

    expect(div.innerHTML).toBe("<div>ab</div>");

    setList(["x"]);
    flush();
    expect(div.innerHTML).toBe("<div>x</div>");
  });
});

describe("dynamic factory", () => {
  let disposer!: () => void;
  afterEach(() => disposer());

  test("returns a stable Component usable directly in JSX with children", () => {
    let div!: HTMLDivElement;
    const CompA: Component<{ children?: JSX.Element }> = props => <div>Hi {props.children}</div>;

    createRoot(dispose => {
      disposer = dispose;
      const User = dynamic(() => CompA);
      expect(typeof User).toBe("function");

      <div ref={div}>
        <User>Smith</User>
      </div>;
    });
    flush();

    expect(div.innerHTML).toBe("<div>Hi Smith</div>");
  });

  test("swaps component reactively from a signal source", () => {
    let div!: HTMLDivElement;
    const CompA: Component<{ id: string }> = props => <div>A {props.id}</div>;
    const CompB: Component<{ id: string }> = props => <span>B {props.id}</span>;
    let setComp!: any;

    createRoot(dispose => {
      disposer = dispose;
      const [comp, _setComp] = createSignal<Component<{ id: string }> | undefined>();
      setComp = _setComp;
      const User = dynamic<Component<{ id: string }>>(() => comp() ?? CompA);

      <div ref={div}>
        <User id="x" />
      </div>;
    });
    flush();

    expect(div.innerHTML).toBe("<div>A x</div>");
    setComp(() => CompB);
    flush();
    expect(div.innerHTML).toBe("<span>B x</span>");
  });

  test("component identity is stable across renders", () => {
    const CompA: Component = () => <div>A</div>;
    let User1: Component<any>;
    let User2: Component<any>;

    createRoot(dispose => {
      disposer = dispose;
      User1 = dynamic(() => CompA);
      User2 = dynamic(() => CompA);
    });

    expect(User1!).toBe(User1!);
    expect(User1!).not.toBe(User2!);
  });

  test("supports string tags through the factory", () => {
    let div!: HTMLDivElement;
    let setTag!: (v: "div" | "span") => "div" | "span";

    createRoot(dispose => {
      disposer = dispose;
      const [tag, _setTag] = createSignal<"div" | "span">("div");
      setTag = _setTag;
      const El = dynamic(() => tag());

      <div ref={div}>
        <El>hi</El>
      </div>;
    });
    flush();

    expect(div.innerHTML).toBe("<div>hi</div>");
    setTag("span");
    flush();
    expect(div.innerHTML).toBe("<span>hi</span>");
  });

  test("renders nothing when source returns null, false, or undefined, and swaps back", () => {
    let div!: HTMLDivElement;
    const CompA: Component = () => <div>A</div>;
    let setComp!: any;

    createRoot(dispose => {
      disposer = dispose;
      const [comp, _setComp] = createSignal<Component | null | undefined | false>();
      setComp = _setComp;
      const User = dynamic(() => comp());

      <div ref={div}>
        <User />
      </div>;
    });
    flush();

    expect(div.innerHTML).toBe("");
    setComp(() => CompA);
    flush();
    expect(div.innerHTML).toBe("<div>A</div>");
    setComp(null);
    flush();
    expect(div.innerHTML).toBe("");
    setComp(() => CompA);
    flush();
    expect(div.innerHTML).toBe("<div>A</div>");
    setComp(false);
    flush();
    expect(div.innerHTML).toBe("");
    setComp(() => CompA);
    flush();
    expect(div.innerHTML).toBe("<div>A</div>");
    setComp(undefined);
    flush();
    expect(div.innerHTML).toBe("");
  });

  test("async source suspends through Loading and resolves", async () => {
    let div!: HTMLDivElement;
    const CompA: Component<{ children?: JSX.Element }> = props => (
      <div>loaded {props.children}</div>
    );
    let resolve!: (value: Component<{ children?: JSX.Element }>) => void;
    const pending = new Promise<Component<{ children?: JSX.Element }>>(r => (resolve = r));

    createRoot(dispose => {
      disposer = dispose;
      const User = dynamic(() => pending);

      <div ref={div}>
        <Loading fallback={<span>loading...</span>}>
          <User>now</User>
        </Loading>
      </div>;
    });
    flush();

    expect(div.innerHTML).toBe("<span>loading...</span>");

    resolve(CompA);
    await pending;
    flush();

    expect(div.innerHTML).toBe("<div>loaded now</div>");
  });
});
