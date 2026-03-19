/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { createRoot, createSignal, Component, JSX, createStore, flush, Show } from "solid-js";
import { Dynamic } from "../src/index.js";

describe("Testing Dynamic control flow", () => {
  let div!: HTMLDivElement, disposer: () => void;

  interface ExampleProps {
    id: string;
  }
  const [comp, setComp] = createSignal<Component<ExampleProps> | keyof JSX.IntrinsicElements>(),
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
  const [comp, setComp] = createSignal<Component<ExampleProps> | keyof JSX.IntrinsicElements>(),
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
