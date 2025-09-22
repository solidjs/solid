/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createRoot, createSignal, Component, JSX, createStore, flush } from "solid-js";
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
