/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from "vitest";
import { createSignal, flush, onCleanup } from "solid-js";
import { customElement } from "../src/index.js";

const nextTag = (name: string) => `${name}-${crypto.randomUUID()}`;

describe("solid-element", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("renders into a shadow root by default", () => {
    const tag = nextTag("shadow-render");
    customElement(tag, () => <span>Hello element</span>);

    const element = document.createElement(tag);
    document.body.append(element);

    expect(element.shadowRoot!.innerHTML).toBe("<span>Hello element</span>");
  });

  test("updates rendered output when element properties change", () => {
    const tag = nextTag("reactive-prop");
    customElement(tag, { count: 0 }, props => <span>{props.count}</span>);

    const element = document.createElement(tag) as HTMLElement & { count: number };
    document.body.append(element);
    element.count = 2;
    flush();

    expect(element.shadowRoot!.textContent).toBe("2");
  });

  test("parses observed attributes into reactive props", () => {
    const tag = nextTag("reactive-attr");
    customElement(tag, { label: "initial" }, props => <span>{props.label}</span>);

    const element = document.createElement(tag);
    element.setAttribute("label", "updated");
    document.body.append(element);

    expect(element.shadowRoot!.textContent).toBe("updated");
  });

  test("runs cleanup when the element disconnects", async () => {
    const tag = nextTag("cleanup");
    const [count, setCount] = createSignal(0);
    let cleanups = 0;

    customElement(tag, () => {
      onCleanup(() => cleanups++);
      return <span>{count()}</span>;
    });

    const element = document.createElement(tag);
    document.body.append(element);
    element.remove();
    await Promise.resolve();
    setCount(1);
    flush();

    expect(cleanups).toBe(1);
    expect(element.shadowRoot!.textContent).toBe("");
  });

  test("delegated events work when rendering a custom element inside a shadow root", () => {
    let clicks = 0;
    const tag = nextTag("shadow-event");

    customElement(tag, () => <button onClick={() => clicks++}>Click</button>);

    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const element = document.createElement(tag);
    document.body.append(host);
    shadow.append(element);

    const button = element.shadowRoot!.querySelector("button")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));

    expect(clicks).toBe(1);
  });
});
