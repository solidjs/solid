import { describe, expect, test, beforeEach } from "vitest";
import { createSignal, flush, For } from "solid-js";
import { render } from "@solidjs/web";
import html from "@solidjs/html";

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  return () => {
    root.remove();
  };
});

function firstNode(result: ReturnType<typeof html>): Node {
  return Array.isArray(result) ? result[0] : result;
}

describe("@solidjs/html", () => {
  test("renders a static template", () => {
    render(() => html`<div id="static">hello</div>`, root);
    expect(root.innerHTML).toBe(`<div id="static">hello</div>`);
  });

  test("dynamic attribute and text update on flush", () => {
    const [name, setName] = createSignal("solid");
    render(() => html`<span data-name=${() => name()}>${() => name()}</span>`, root);

    const span = root.querySelector("span")!;
    expect(span.getAttribute("data-name")).toBe("solid");
    expect(span.textContent).toBe("solid");

    setName("html");
    flush();
    expect(span.getAttribute("data-name")).toBe("html");
    expect(span.textContent).toBe("html");
  });

  test("inline component hole composes children", () => {
    function Button(props: { children: any; type?: string }) {
      return html`<button type=${() => props.type ?? "button"}>${() => props.children}</button>`;
    }

    render(() => html`<${Button} type="submit">click<//>`, root);

    const btn = root.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("type")).toBe("submit");
    expect(btn!.textContent).toBe("click");
  });

  test("html.define registers components by tag name", () => {
    function Item(props: { label: string }) {
      return html`<li>${() => props.label}</li>`;
    }
    const tpl = html.define({ For, Item });

    const [items] = createSignal([
      { id: 1, label: "a" },
      { id: 2, label: "b" }
    ]);

    render(
      () =>
        tpl`<ul><For each=${() => items()}>${(item: () => { label: string }) =>
          tpl`<Item label=${() => item().label}/>`}</For></ul>`,
      root
    );

    const lis = Array.from(root.querySelectorAll("li")).map(li => li.textContent);
    expect(lis).toEqual(["a", "b"]);
  });

  test("multi-root templates return an iterable of nodes", () => {
    const result = html`<span class="a"></span><span class="b"></span>`;
    expect(Array.isArray(result)).toBe(true);
    const nodes = result as Node[];
    expect(nodes).toHaveLength(2);
    expect((nodes[0] as HTMLElement).className).toBe("a");
    expect((nodes[1] as HTMLElement).className).toBe("b");
  });

  test("single-root template returns a single node", () => {
    const result = html`<span class="solo"></span>`;
    expect(Array.isArray(result)).toBe(false);
    expect((firstNode(result) as HTMLElement).className).toBe("solo");
  });
});
