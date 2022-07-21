/** 
 * @jsxImportSource solid-js
 * @jest-environment jsdom
 */

import { createRoot, createSignal, Component, JSX } from "../../src";
import { createStore } from "../../store/src";
import { Dynamic } from "../src";

describe("Testing Dynamic control flow", () => {
  let div: HTMLDivElement, disposer: () => void;

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
  })

  afterEach(() => disposer());

  test("Toggle Dynamic control flow", () => {
    expect(div.innerHTML).toBe("");
    setComp(() => CompA);
    expect(div.innerHTML).toBe("<div>Hi Smith</div>");
    setName("Smithers");
    expect(div.innerHTML).toBe("<div>Hi Smithers</div>");
    setComp(() => CompB);
    expect(div.innerHTML).toBe("<span>Yo Smithers</span>");
    setComp("h1");
    expect(div.innerHTML).toBe(`<h1 id="Smithers"></h1>`);
    setName("Sunny")
    expect(div.innerHTML).toBe(`<h1 id="Sunny"></h1>`);
    expect(div.querySelector('h1')).toBeInstanceOf(HTMLElement);
  });

  test("Renders SVG elements", () => {
    setComp("svg")
    expect(div.querySelector('svg')).toBeInstanceOf(SVGSVGElement);
    setComp("path")
    expect(div.querySelector('path')).toBeInstanceOf(SVGElement);
  });
});


describe("Testing Dynamic with state spread", () => {
  let div: HTMLDivElement, disposer: () => void;

  interface ExampleProps {
    id: string;
  }
  const [comp, setComp] = createSignal<Component<ExampleProps> | keyof JSX.IntrinsicElements>(),
    [state, setState] = createStore({
      id: "Smith"
    });
  const Component = () => (
      <div ref={div}>
        <Dynamic component={comp()} {...state}  />
      </div>
    ),
    CompA: Component<ExampleProps> = props => <div>Hi {props.id}</div>,
    CompB: Component<ExampleProps> = props => <span>Yo {props.id}</span>;

  beforeEach(() => {
    createRoot(dispose => {
      disposer = dispose;
      <Component />;
    });
  })

  afterEach(() => disposer());

  test("Toggle Dynamic control flow", () => {
    expect(div.innerHTML).toBe("");
    setComp(() => CompA);
    expect(div.innerHTML).toBe("<div>Hi Smith</div>");
    setState("id", "Smithers");
    expect(div.innerHTML).toBe("<div>Hi Smithers</div>");
    setComp(() => CompB);
    expect(div.innerHTML).toBe("<span>Yo Smithers</span>");
    setComp("h1");
    expect(div.innerHTML).toBe(`<h1 id="Smithers"></h1>`);
    setState("id", "Sunny")
    expect(div.innerHTML).toBe(`<h1 id="Sunny"></h1>`);
    expect(div.querySelector('h1')).toBeInstanceOf(HTMLElement);
  });
});
