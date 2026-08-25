/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createContext, createSignal, flush, getOwner, onCleanup, useContext } from "solid-js";
import { customElement } from "../src/index.js";
import { render } from "@solidjs/web";

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

  test("HTML-authored provider and reader custom elements share context through slot markers", () => {
    const Context = createContext("missing");
    const providerTag = nextTag("library-provider");
    const readerTag = nextTag("library-reader");

    customElement(providerTag, () => (
      <Context value="slot">
        <slot />
      </Context>
    ));
    customElement(readerTag, () => <span>{useContext(Context)}</span>);

    document.body.innerHTML = `<${providerTag}><${readerTag}></${readerTag}></${providerTag}>`;
    const reader = document.body.querySelector(readerTag)!;

    expect(reader.shadowRoot!.textContent).toBe("slot");
  });

  test("Solid JSX-authored provider and reader custom elements share context through slot markers", () => {
    const Context = createContext("missing");
    const root = document.createElement("div");

    customElement("solid-element-provider-jsx", () => (
      <Context value="jsx-slot">
        <slot />
      </Context>
    ));
    customElement("solid-element-reader-jsx", () => <span>{useContext(Context)}</span>);

    document.body.append(root);
    const dispose = render(
      () => (
        <solid-element-provider-jsx>
          <solid-element-reader-jsx />
        </solid-element-provider-jsx>
      ),
      root
    );
    const reader = root.querySelector("solid-element-reader-jsx")!;

    expect(reader.shadowRoot!.textContent).toBe("jsx-slot");
    dispose();
    root.remove();
  });

  test("ancestor owner markers are found while walking up from custom elements", () => {
    const Context = createContext("missing");
    const childTag = nextTag("ancestor-marker-child");
    const root = document.createElement("div");

    customElement(childTag, () => <span>{useContext(Context)}</span>);

    function App() {
      const wrapper = document.createElement("section") as HTMLElement & { _$owner?: unknown };
      wrapper._$owner = getOwner()!;
      wrapper.append(document.createElement(childTag));
      return wrapper;
    }

    document.body.append(root);
    const dispose = render(
      () => (
        <Context value="ancestor">
          <App />
        </Context>
      ),
      root
    );
    const child = root.querySelector(childTag)!;

    expect(child.shadowRoot!.textContent).toBe("ancestor");
    dispose();
    root.remove();
  });

  test("falls back to an ownerless root when _$owner comes from a foreign runtime copy (#3053)", () => {
    const tag = nextTag("foreign-owner");
    customElement(tag, { label: "ok" }, props => <span>{props.label}</span>);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // A compiled element library bundles its own solid-js; a Solid host
      // page stamps `_$owner` with ITS copy's owner. Across copies the field
      // layout doesn't line up (prod builds are property-mangled), so owner
      // adoption dereferences undefined and used to crash connectedCallback,
      // leaving the shadow root empty. Mimic a mangled foreign owner: short
      // names, none of this copy's fields.
      const wrapper = document.createElement("section") as HTMLElement & { _$owner?: unknown };
      wrapper._$owner = { id: "0", ke: { ct: null } };
      const element = document.createElement(tag) as HTMLElement & { label: string };
      wrapper.append(element);
      document.body.append(wrapper);

      // Renders exactly as it would on a page with no Solid host at all.
      expect(element.shadowRoot!.textContent).toBe("ok");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("different copy"));

      // The ownerless root is fully live, not a one-shot render.
      element.label = "updated";
      flush();
      expect(element.shadowRoot!.textContent).toBe("updated");
    } finally {
      warn.mockRestore();
    }
  });

  test("HTML-authored elements without a provider create an independent root", () => {
    const Context = createContext("default");
    const childTag = nextTag("context-independent");

    customElement(childTag, () => <span>{useContext(Context)}</span>);

    const child = document.createElement(childTag);
    document.body.append(child);

    expect(child.shadowRoot!.textContent).toBe("default");
  });
});
