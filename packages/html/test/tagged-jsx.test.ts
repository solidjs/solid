import { createRoot, createSignal, flush, createMemo } from "solid-js";
import htmlTag from "../src/tagged-jsx.js";
import { expect, it, describe, beforeEach } from "vitest";
import { insert, render, registerElementClaim } from "@solidjs/web";

const For = (props: any) => {
  return createMemo(() => props.each.map((v: any) => props.children(v))) as any;
};

const Show = (props: any) => {
  return createMemo(() => (props.when ? props.children : null)) as any;
};

const html = htmlTag.define({ For, Show });

// tagged JSX returns a scalar when a template resolves to a single node/value, and
// an array when it resolves to multiple. Tests that need to iterate or spread
// normalize via this helper.
const arrify = (v: any): Node[] => (Array.isArray(v) ? v : [v]);

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Tagged JSX Integration Tests", () => {
  describe("Basic Element Rendering", () => {
    it("renders simple text content", () =>
      createRoot(dispose => {
        const result = html`Hello World!`;
        expect(result).toBe("Hello World!");
        dispose();
      }));

    it("renders simple elements", () =>
      createRoot(dispose => {
        const el = html`<div>Test</div>` as HTMLElement;
        expect(el.tagName).toBe("DIV");
        expect(el.textContent).toBe("Test");
        dispose();
      }));

    it("renders self-closing elements", () =>
      createRoot(dispose => {
        const input = html`<input type="text" />` as HTMLInputElement;
        expect(input.tagName).toBe("INPUT");
        expect(input.type).toBe("text");
        dispose();
      }));

    it("renders nested elements", () =>
      createRoot(dispose => {
        const div = html`<div><span>Nested</span></div>` as HTMLElement;
        const span = div.querySelector("span");
        expect(span?.textContent).toBe("Nested");
        dispose();
      }));
  });

  describe("Attributes and Props", () => {
    it("handles complex attribute names and mixed values", () => {
      const [cls, setCls] = createSignal("active");
      let el!: HTMLElement;
      const dispose = createRoot(d => {
        el = html`<div
          class=${() => `base ${cls()}`}
          data-test-id="main-div"
          aria-hidden="false"
        ></div>` as HTMLElement;
        return d;
      });

      expect(el.className).toBe("base active");
      expect(el.getAttribute("data-test-id")).toBe("main-div");

      setCls("inactive");
      flush();

      expect(el.className).toBe("base inactive");
      dispose();
    });

    it("handles boolean attributes correctly", () => {
      const [disabled, setDisabled] = createSignal(true);
      let btn!: HTMLButtonElement;
      const dispose = createRoot(d => {
        btn = html`<button disabled=${disabled} autofocus>Click</button>` as HTMLButtonElement;
        return d;
      });

      expect(btn.disabled).toBe(true);
      expect(btn.hasAttribute("autofocus")).toBe(true);

      setDisabled(false);
      flush();

      expect(btn.disabled).toBe(false);
      dispose();
    });

    it("handles spread props with static before spread", () =>
      createRoot(dispose => {
        const props = { id: "spread", class: "blue", "data-attr": "val" };
        const el = html`<div id="static" class="red" ...${props}></div>` as HTMLElement;

        expect(el.id).toBe("spread");
        expect(el.className).toBe("blue");
        expect(el.getAttribute("data-attr")).toBe("val");
        dispose();
      }));

    it("handles spread props with static after spread", () =>
      createRoot(dispose => {
        const props = { id: "spread", class: "blue", "data-attr": "val" };
        const el = html`<div ...${props} id="static" class="red"></div>` as HTMLElement;

        expect(el.id).toBe("static");
        expect(el.className).toBe("red");
        expect(el.getAttribute("data-attr")).toBe("val");
        dispose();
      }));

    it("respects override order with spreads and static attributes", () =>
      createRoot(dispose => {
        const props = { id: "from-spread", "data-info": "hidden" };
        const el = html`<div ...${props} id="final-id"></div>` as HTMLElement;

        expect(el.id).toBe("final-id");
        expect(el.getAttribute("data-info")).toBe("hidden");
        dispose();
      }));

    it("handles explicit properties and attributes via namespaces", () => {
      const [val, setVal] = createSignal("initial");
      let input!: HTMLInputElement;
      const dispose = createRoot(d => {
        input = html`<input prop:value=${val} title=${"hello"} />` as HTMLInputElement;
        return d;
      });

      expect(input.value).toBe("initial");
      expect(input.getAttribute("title")).toBe("hello");

      setVal("updated");
      flush();

      expect(input.value).toBe("updated");
      dispose();
    });

    it("handles mixed static and dynamic attribute parts", () =>
      createRoot(dispose => {
        const [welcoming] = createSignal("hello");
        const h1 = html`
          <h1 title=${() => `${welcoming()} John ${"Smith"}`}></h1>
        ` as HTMLHeadingElement;

        expect(h1.title).toBe("hello John Smith");
        dispose();
      }));

    it("handles multi-line, complex, and unquoted-style attributes", () =>
      createRoot(dispose => {
        const div = html` <div
          multiline="
            foo
            bar
          "
          lorem
          ipsum
        ></div>` as HTMLElement;

        expect(div.getAttribute("multiline")).toContain("foo");
        expect(div.getAttribute("multiline")).toContain("bar");
        expect(div.hasAttribute("lorem")).toBe(true);
        expect(div.hasAttribute("ipsum")).toBe(true);
        dispose();
      }));

    it("correctly handles JSON-like strings in attributes", () =>
      createRoot(dispose => {
        const el = html`
          <lume-box uniforms='{ "iTime": { "value": 0 } }'></lume-box>
        ` as HTMLElement;

        expect(el.getAttribute("uniforms")).toBe('{ "iTime": { "value": 0 } }');
        dispose();
      }));
  });

  describe("Expressions and Reactivity", () => {
    it("handles expressions inside text", () =>
      createRoot(dispose => {
        const name = "World";
        const el = html`<div>Hello ${name}!</div>` as HTMLElement;
        expect(el.textContent).toBe("Hello World!");
        dispose();
      }));

    it("handles multiple expressions", () => {
      const [count, setCount] = createSignal(0);
      let el!: HTMLElement;
      const dispose = createRoot(d => {
        const name = "Counter";
        el = html`<div>${name}: ${count}</div>` as HTMLElement;
        return d;
      });

      expect(el.textContent).toBe("Counter: 0");
      setCount(5);
      flush();

      expect(el.textContent).toBe("Counter: 5");
      dispose();
    });

    it("handles top level expressions", () => {
      const [count, setCount] = createSignal(0);
      const dispose = createRoot(d => {
        const nodes = html`<div></div>
          ${() => count()}` as HTMLElement;
        insert(document.body, nodes);
        return d;
      });

      expect(document.body.textContent).toContain("0");
      setCount(5);
      flush();

      expect(document.body.textContent).toContain("5");
      dispose();
    });

    it("handles sibling expressions and static text correctly", () =>
      createRoot(dispose => {
        const [a] = createSignal("A");
        const [b] = createSignal("B");

        const el = html`<div>${a} - ${b} !</div>` as HTMLDivElement;

        expect(el.textContent).toBe("A - B !");
        dispose();
      }));

    it("trims whitespace correctly while preserving nested spaces", () =>
      createRoot(dispose => {
        const name = "John";
        const div = html`
          <div>
            <b>Hello, my name is: <i> ${name}</i></b>
          </div>
        ` as HTMLElement;

        const b = div.querySelector("b")!;
        expect(b.textContent).toBe("Hello, my name is: John");
        dispose();
      }));

    it("handles dynamic attributes", () => {
      const [visible, setVisible] = createSignal(true);
      let el!: HTMLElement;
      const dispose = createRoot(d => {
        el = html`<div hidden=${!visible}>Content</div>` as HTMLElement;
        return d;
      });

      expect(el.hasAttribute("hidden")).toBe(false);
      setVisible(false);
      flush();

      expect(el.hasAttribute("hidden")).toBe(false);
      dispose();
    });
  });

  describe("Logic and Control Flow", () => {
    it("works with Solid's <Show> component", () => {
      const [visible, setVisible] = createSignal(false);
      const container = document.createElement("div");
      const dispose = createRoot(d => {
        const result = html`<div>
          <Show when=${visible}>
            <span id="target">I am visible</span>
          </Show>
        </div>`;
        container.append(...arrify(result));
        document.body.appendChild(container);
        return d;
      });

      expect(container.querySelector("#target")).toBeNull();

      setVisible(true);
      flush();

      expect(container.querySelector("#target")).not.toBeNull();
      expect(container.querySelector("#target")?.textContent).toBe("I am visible");
      dispose();
    });

    it("works with Solid's <For> component", () => {
      const [items, setItems] = createSignal(["A", "B"]);
      const container = document.createElement("div");
      const dispose = createRoot(d => {
        const result = html` <ul>
          <For each=${items}> ${(item: string) => html`<li>${item}</li>`} </For>
        </ul>`;
        container.append(...arrify(result));
        return d;
      });

      expect(container.querySelectorAll("li").length).toBe(2);

      setItems(["A", "B", "C"]);
      flush();

      expect(container.querySelectorAll("li").length).toBe(3);
      dispose();
    });
  });

  describe("Events and Refs", () => {
    it("handles refs and event listeners correctly", () =>
      createRoot(dispose => {
        let elementRef: HTMLDivElement | undefined;
        let clickCount = 0;
        const ref = (el: HTMLDivElement) => {
          elementRef = el;
          el.addEventListener("click", () => clickCount++);
        };

        const el = html` <div ref=${ref}>Click me</div>` as HTMLDivElement;

        expect(elementRef).toBe(el);
        el.click();
        expect(clickCount).toBe(1);
        dispose();
      }));

    it("integrates ref listeners and delegated events", () => {
      const exec = { first: false, delegated: false, second: false };
      const container = document.createElement("div");
      document.body.append(container);
      const dispose = render(
        () => html`
          <div id="main">
            <button
              ref=${(node: HTMLButtonElement) =>
                node.addEventListener("click", () => (exec.first = true))}
            >
              Bound
            </button>
            <button onClick=${[(v: any) => (exec.delegated = v), true]}>Delegated</button>
            <button
              ref=${(node: HTMLButtonElement) =>
                node.addEventListener("click", () => (exec.second = true), {
                  capture: true
                })}
            >
              Ref Listener
            </button>
          </div>
        `,
        container
      );
      const el = container.firstElementChild as HTMLElement;

      const [btn1, btn2, btn3] = el.querySelectorAll("button");

      expect(btn1.textContent?.trim()).toBe("Bound");
      expect(btn2.textContent?.trim()).toBe("Delegated");
      expect(btn3.textContent?.trim()).toBe("Ref Listener");

      btn1.click();
      btn2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      btn3.click();

      expect(exec.first).toBe(true);
      expect(exec.delegated).toBe(true);
      expect(exec.second).toBe(true);
      dispose();
    });

    it("captures refs across components and elements", () =>
      createRoot(dispose => {
        let linkRef: HTMLAnchorElement | undefined;
        const div = html`
          <div>
            <a href="/" ref=${(el: HTMLAnchorElement) => (linkRef = el)}>Link</a>
          </div>
        ` as HTMLElement;

        expect(linkRef).toBe(div.querySelector("a"));
        dispose();
      }));
  });

  describe("Custom Components", () => {
    it("passes children correctly to registered components", () =>
      createRoot(dispose => {
        const Wrapper = (props: { children: any }) => html`<section>${props.children}</section>`;
        const localHtml = html.define({ Wrapper });

        const section = localHtml`
      <Wrapper>
        <span>Inside</span>
      </Wrapper>` as HTMLElement;

        expect(section.tagName).toBe("SECTION");
        expect(section.querySelector("span")?.textContent).toBe("Inside");
        dispose();
      }));

    it("handles deep nesting with custom components", () =>
      createRoot(dispose => {
        const Box = (props: any) => html`<div class="box">${props.children}</div>`;
        const localHtml = html.define({ Box });

        const result = localHtml`
        <Box>
          <ul>
            <li><Box>Item 1</Box></li>
            <li><Box>Item 2</Box></li>
          </ul>
        </Box>`;

        const container = document.createElement("div");
        container.append(...arrify(result));
        expect(container.querySelectorAll(".box").length).toBe(3);
        expect(container.querySelector("li")?.textContent).toBe("Item 1");
        dispose();
      }));
  });

  describe("Special Elements and Namespaces", () => {
    it("treats <script> and <style> as raw text", () =>
      createRoot(dispose => {
        const style = html` <style>
          body > div {
            color: red;
          }
        </style>` as HTMLStyleElement;

        expect(style.textContent).toContain("body > div");
        expect(style.tagName).toBe("STYLE");
        dispose();
      }));

    it("maintains SVG namespace across nested dynamic paths", () => {
      const [radius, setRadius] = createSignal(10);
      let circle!: SVGCircleElement;
      const dispose = createRoot(d => {
        const svg = html` <svg>
          <g>
            <circle r=${radius} />
          </g>
        </svg>` as SVGSVGElement;

        circle = svg.querySelector("circle")!;
        return d;
      });

      expect(circle.namespaceURI).toBe("http://www.w3.org/2000/svg");
      expect(circle.getAttribute("r")).toBe("10");

      setRadius(20);
      flush();
      expect(circle.getAttribute("r")).toBe("20");
      dispose();
    });

    it("handles template elements correctly", () =>
      createRoot(dispose => {
        const nodes = html`${"hole"}<template>Count: ${() => 1}</template>` as Node[];
        document.body.append(...nodes);
        expect((nodes[1] as HTMLTemplateElement).content.textContent).toEqual("Count: 1");
        dispose();
      }));

    it("handles mathml elements", () =>
      createRoot(dispose => {
        const Frac = () =>
          html`<mfrac>
            <mn>1</mn>
            <mn>3</mn>
          </mfrac>`;

        const p = html.define({ Frac }).jsx`<p>
      The fraction
      <math>
        <Frac />
      </math>
      is not a decimal number.
    </p>` as HTMLElement;

        document.body.append(p);
        expect(document.querySelector("math")).toBeTruthy();
        dispose();
      }));
  });

  describe("HTML Entities and Encoding", () => {
    it("handles html encodings", () =>
      createRoot(dispose => {
        const elem = html`&copy;<span>&gt;</span>` as Node[];

        expect(elem[0]).toEqual("\u00A9");
        expect(elem[1].textContent).toEqual(">");
        dispose();
      }));
  });

  describe("Edge Cases and Error Handling", () => {
    it("handles empty templates", () =>
      createRoot(dispose => {
        const result = html``;
        expect(result).toEqual([]);
        dispose();
      }));

    it("handles whitespace-only templates", () =>
      createRoot(dispose => {
        const result = html``;
        expect(result).toBe("   ");
        dispose();
      }));

    it("handles weird whitespace and line breaks in tags", () =>
      createRoot(dispose => {
        const el = html` <div
          id="test
          "
          class="spaced"
        >
          Text
        </div>` as HTMLElement;
        expect(el.id).toBe(`test
          `);
        expect(el.className).toBe("spaced");
        expect(el.textContent?.trim()).toBe("Text");
        dispose();
      }));

    it("throws for an unregistered capitalized component", () =>
      createRoot(dispose => {
        expect(() => html`<UnregisteredComponent />`).toThrow(/not found in registry/);
        dispose();
      }));

    it("throws for spread of a non-object value", () =>
      createRoot(dispose => {
        const invalid = 42;
        expect(() => html`<div ...${invalid}></div>`).toThrow(/Can only spread objects/);
        dispose();
      }));

    it("throws for dynamic component that is not a function", () =>
      createRoot(dispose => {
        const notAComponent = "not-a-function";
        expect(() => html`<${notAComponent} />`).toThrowError(/not found in registry/);
        dispose();
      }));

    it("ignores HTML comments and their contents", () =>
      createRoot(dispose => {
        const signal = () => "HIDDEN";
        const div = html` <div>
          <!-- This is a comment with an expression: ${signal()} -->
          <p>Visible</p>
        </div>` as HTMLElement;

        const container = document.createElement("div");
        container.append(div);
        expect(container.innerHTML).not.toContain("HIDDEN");
        expect(container.querySelector("p")?.textContent).toBe("Visible");
        dispose();
      }));
  });

  describe("Complex DOM Integration Tests", () => {
    describe("Advanced Attribute Scenarios", () => {
      it("handles multiple spread attributes with complex override behavior", () =>
        createRoot(dispose => {
          const baseProps = { class: "base", id: "base-id" };
          const overrideProps = { class: "override", "data-override": true };
          const finalId = "final-id";

          const el = html`<div ...${baseProps} ...${overrideProps} id=${finalId} class="final">
            Content
          </div>` as HTMLElement;

          expect(el.className).toBe("final");
          expect(el.id).toBe("final-id");
          expect(el.getAttribute("data-override")).toBe("");
          expect(el.textContent?.trim()).toBe("Content");
          dispose();
        }));

      it("handles mixed quoted and unquoted attributes with expressions", () => {
        const [dynamicClass, setClass] = createSignal("active");
        const [dynamicId] = createSignal("dynamic-123");
        const staticTitle = "Static Title";
        let button!: HTMLButtonElement;
        const dispose = createRoot(d => {
          button = html`<button
            class=${() => `btn-${dynamicClass()}`}
            id=${dynamicId}
            title=${staticTitle}
            disabled=${dynamicClass() === "active"}
          >
            Click
          </button>` as HTMLButtonElement;
          return d;
        });

        expect(button.className).toBe("btn-active");
        expect(button.id).toBe("dynamic-123");
        expect(button.title).toBe("Static Title");
        expect(button.disabled).toBe(true);
        expect(button.textContent?.trim()).toBe("Click");

        setClass("inactive");
        flush();

        expect(button.className).toBe("btn-inactive");
        dispose();
      });

      it("handles boolean attributes with dynamic expressions", () => {
        const [enabled, setEnabled] = createSignal(true);
        const [checked, setChecked] = createSignal(false);
        let input!: HTMLInputElement;
        const dispose = createRoot(d => {
          input = html`<input
            type="checkbox"
            disabled=${() => !enabled()}
            checked=${checked}
            readonly
          />` as HTMLInputElement;
          return d;
        });

        expect(input.disabled).toBe(false);
        expect(input.checked).toBe(false);
        expect(input.hasAttribute("readonly")).toBe(true);

        setEnabled(false);
        setChecked(true);
        flush();

        expect(input.disabled).toBe(true);
        expect(input.checked).toBe(true);
        dispose();
      });

      it("handles style attribute with mixed static and dynamic values", () => {
        const [color, setColor] = createSignal("red");
        let el!: HTMLElement;
        const dispose = createRoot(d => {
          el = html`<div style=${() => `color: ${color()}; background: blue; padding: ${10}px`}>
            Styled content
          </div>` as HTMLElement;
          return d;
        });

        expect(el.style.color).toBe("red");
        expect(el.style.backgroundColor).toBe("blue");
        expect(el.style.padding).toBe("10px");

        setColor("green");
        flush();

        expect(el.style.color).toBe("green");
        dispose();
      });

      it("handles class attribute with complex expressions", () => {
        const [isActive, setActive] = createSignal(true);
        const [theme, setTheme] = createSignal("dark");
        let el!: HTMLElement;
        const dispose = createRoot(d => {
          el = html`<div
            class=${() => `${isActive() ? "active" : "inactive"} theme-${theme()} static-class`}
          >
            Mixed classes
          </div>` as HTMLElement;
          return d;
        });

        expect(el.className).toBe("active theme-dark static-class");

        setActive(false);
        setTheme("light");
        flush();

        expect(el.className).toBe("inactive theme-light static-class");
        dispose();
      });
    });

    describe("Reactive DOM Updates", () => {
      it("updates DOM when multiple signals change simultaneously", () => {
        const [count, setCount] = createSignal(0);
        const [text, setText] = createSignal("Initial");
        const container = document.createElement("div");
        const dispose = createRoot(d => {
          const div = html`<div>
            <span class=${() => `count-${count()}`}>Count: ${count}</span>
            <span class=${() => `text-${text()}`}>Text: ${text}</span>
          </div>` as HTMLElement;
          container.append(div);
          return d;
        });

        const countSpan = container.querySelector(".count-0")!;
        const textSpan = container.querySelector(".text-Initial")!;

        expect(countSpan.className).toBe("count-0");
        expect(countSpan.textContent).toBe("Count: 0");
        expect(textSpan.className).toBe("text-Initial");
        expect(textSpan.textContent).toBe("Text: Initial");

        setCount(5);
        setText("Updated");
        flush();

        expect(countSpan.className).toBe("count-5");
        expect(countSpan.textContent).toBe("Count: 5");
        expect(textSpan.className).toBe("text-Updated");
        expect(textSpan.textContent).toBe("Text: Updated");
        dispose();
      });

      it("handles conditional attributes with boolean logic", () => {
        const [visible, setVisible] = createSignal(true);
        const [disabled, setDisabled] = createSignal(false);
        let button!: HTMLButtonElement;
        const dispose = createRoot(d => {
          button = html`<button
            hidden=${() => !visible()}
            disabled=${disabled}
            aria-hidden=${() => !visible()}
            class=${() => (visible() ? "visible" : "hidden")}
          >
            Button
          </button>` as HTMLButtonElement;
          return d;
        });

        expect(button.hidden).toBe(false);
        expect(button.disabled).toBe(false);
        expect(button.getAttribute("aria-hidden")).toBe(null);
        expect(button.className).toBe("visible");

        setVisible(false);
        setDisabled(true);
        flush();

        expect(button.hidden).toBe(true);
        expect(button.disabled).toBe(true);
        expect(button.getAttribute("aria-hidden")).toBe("");
        expect(button.className).toBe("hidden");
        dispose();
      });
    });

    describe("Event Handling Integration", () => {
      it("handles multiple event types with proper cleanup", () =>
        createRoot(dispose => {
          let clickCount = 0;
          let mouseOverCount = 0;
          const div = html`<div>
            <button
              ref=${(node: HTMLButtonElement) => node.addEventListener("click", () => clickCount++)}
            >
              Click me
            </button>
            <span
              ref=${(node: HTMLSpanElement) =>
                node.addEventListener("mouseover", () => mouseOverCount++)}
              >Hover me</span
            >
          </div>` as HTMLElement;
          const container = document.createElement("div");
          container.append(div);
          document.body.append(container);

          const button = container.querySelector("button")!;
          const hoverDiv = container.querySelector("span")!;

          button.click();
          hoverDiv.dispatchEvent(new MouseEvent("mouseover"));

          expect(clickCount).toBe(1);
          expect(mouseOverCount).toBe(1);
          dispose();
        }));

      it("handles event delegation with stopPropagation", () => {
        const events: string[] = [];
        const container = document.createElement("div");
        document.body.append(container);
        const dispose = render(
          () =>
            html`<div onClick=${() => events.push("parent")}>
              <button
                onClick=${(e: Event) => {
                  e.stopPropagation();
                  events.push("child");
                }}
              >
                Child
              </button>
            </div>`,
          container
        );

        const button = container.querySelector("button")!;
        button.click();

        expect(events.length).toBeGreaterThan(0);
        dispose();
      });
    });

    describe("Form Element Integration", () => {
      it("handles form controls with reactive values", () => {
        const [value, setValue] = createSignal("initial");
        const [checked, setChecked] = createSignal(false);
        const container = document.createElement("div");
        const dispose = createRoot(d => {
          const form = html`<form>
            <input type="text" value=${value} />
            <input type="checkbox" checked=${checked} />
            <select value=${value}>
              <option value="initial">Option 1</option>
              <option value="updated">Option 2</option>
            </select>
          </form>` as HTMLFormElement;
          container.append(form);
          document.body.append(container);
          return d;
        });

        const textInput = container.querySelector("input[type='text']") as HTMLInputElement;
        const checkboxInput = container.querySelector("input[type='checkbox']") as HTMLInputElement;
        const select = container.querySelector("select") as HTMLSelectElement;

        expect(textInput.value).toBe("initial");
        expect(checkboxInput.checked).toBe(false);
        expect(select.value).toBe("initial");

        setValue("updated");
        setChecked(true);
        flush();

        expect(textInput.value).toBe("updated");
        expect(checkboxInput.checked).toBe(true);
        expect(select.value).toBe("updated");
        dispose();
      });

      it("handles textarea with raw text content", () => {
        const [content, setContent] = createSignal("Initial content");
        const container = document.createElement("div");
        const dispose = createRoot(d => {
          const textarea = html`<textarea>${content}</textarea>` as HTMLTextAreaElement;
          container.append(textarea);
          return d;
        });

        const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
        expect(textarea.value).toBe("Initial content");

        setContent("Updated content");
        flush();

        expect(textarea.value).toBe("Updated content");
        dispose();
      });
    });

    describe("List and Table Rendering", () => {
      it("renders table with dynamic rows and cells", () =>
        createRoot(dispose => {
          const [rows] = createSignal([
            ["Cell 1", "Cell 2", "Cell 3"],
            ["Cell 4", "Cell 5", "Cell 6"]
          ]);

          const table = html`<table>
            <thead>
              <tr>
                <th>Col 1</th>
                <th>Col 2</th>
                <th>Col 3</th>
              </tr>
            </thead>
            <tbody>
              <For each=${rows}>
                ${(row: string[]) => html`
                  <tr>
                    <For each=${row}> ${(cell: string) => html`<td>${cell}</td>`} </For>
                  </tr>
                `}
              </For>
            </tbody>
          </table>` as HTMLTableElement;
          const container = document.createElement("div");
          container.append(table);

          const tbody = table.querySelector("tbody")!;
          const trElements = tbody.querySelectorAll("tr");

          expect(trElements.length).toBe(2);

          const firstRowCells = trElements[0].querySelectorAll("td");
          expect(firstRowCells.length).toBe(3);
          expect(firstRowCells[0].textContent).toBe("Cell 1");
          expect(firstRowCells[1].textContent).toBe("Cell 2");
          expect(firstRowCells[2].textContent).toBe("Cell 3");
          dispose();
        }));

      it("renders ordered and unordered lists with nested items", () =>
        createRoot(dispose => {
          const [items] = createSignal([
            { text: "Item 1", children: ["Subitem 1.1", "Subitem 1.2"] },
            { text: "Item 2", children: [] }
          ]);

          const div = html`<div>
            <ul>
              <For each=${items}>
                ${(item: any) => html`
                  <li class="parent-item">
                    ${item.text}
                    <ol>
                      <For each=${item.children}>
                        ${(child: string) => html`<li class="child-item">${child}</li>`}
                      </For>
                    </ol>
                  </li>
                `}
              </For>
            </ul>
          </div>` as HTMLElement;
          const container = document.createElement("div");
          container.append(div);

          const parentItems = container.querySelectorAll(".parent-item");
          expect(parentItems.length).toBe(2);

          const childItems = container.querySelectorAll(".child-item");
          expect(childItems.length).toBe(2);
          expect(childItems[0].textContent).toBe("Subitem 1.1");
          expect(childItems[1].textContent).toBe("Subitem 1.2");
          dispose();
        }));
    });

    describe("Media and Resource Elements", () => {
      it("handles img element with reactive src and alt", () => {
        const [src, setSrc] = createSignal("image1.jpg");
        const [alt, setAlt] = createSignal("Image 1");
        const container = document.createElement("div");
        const dispose = createRoot(d => {
          const img = html`<img
            src=${src}
            alt=${alt}
            width="100"
            height="100"
          />` as HTMLImageElement;
          container.append(img);
          return d;
        });

        const img = container.querySelector("img") as HTMLImageElement;
        expect(img.src).toContain("image1.jpg");
        expect(img.alt).toBe("Image 1");
        expect(img.width).toBe(100);
        expect(img.height).toBe(100);

        setSrc("image2.jpg");
        setAlt("Image 2");
        flush();

        expect(img.src).toContain("image2.jpg");
        expect(img.alt).toBe("Image 2");
        dispose();
      });

      it("handles link and meta elements correctly", () =>
        createRoot(dispose => {
          const head = html`<head>
            <link rel="stylesheet" href="style.css" />
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
          </head>` as HTMLElement;
          const container = document.createElement("div");
          container.append(head);

          const link = container.querySelector("link") as HTMLLinkElement;
          expect(link.rel).toBe("stylesheet");
          expect(link.href).toContain("style.css");

          const charsetMeta = container.querySelector("meta[charset]") as HTMLMetaElement;
          expect(charsetMeta.getAttribute("charset")).toBe("utf-8");

          const viewportMeta = container.querySelector('meta[name="viewport"]') as HTMLMetaElement;
          expect(viewportMeta.content).toBe("width=device-width, initial-scale=1");
          dispose();
        }));
    });
  });

  describe("Dynamic Components", () => {
    it("renders dynamic component with expression as tag name", () =>
      createRoot(dispose => {
        const Comp = (props: any) => html`<div>Dynamic</div>`;
        const result = html.define({ Comp }).jsx`<${Comp} />`;
        const container = document.createElement("div");
        container.append(...arrify(result));
        expect(container.innerHTML).toBe("<div>Dynamic</div>");
        dispose();
      }));

    it("renders dynamic component with children", () =>
      createRoot(dispose => {
        const Comp = (props: any) => html`<section>${props.children}</section>`;
        const result = html.define({ Comp }).jsx`<${Comp}><span>content</span></${Comp}>`;
        const container = document.createElement("div");
        container.append(...arrify(result));
        expect(container.querySelector("section")?.innerHTML).toContain("<span>content</span>");
        dispose();
      }));

    // it("renders dynamic component with shorthand close tag", () => {
    //   const Comp = (props: any) => html`<section>${props.children}</section>`;
    //   const result = html.define({ Comp }).jsx`<Comp>text<//>`;
    //   const container = document.createElement("div");
    //   container.append(...arrify(result));
    //   expect(container.querySelector("section")?.textContent).toBe("text");
    // });

    it("renders dynamic component with shorthand close tag", () =>
      createRoot(dispose => {
        const Comp = (props: any) => html`<section>${props.children}</section>`;
        const result = html.define({ Comp }).jsx`<${Comp}>text<//>`;
        const container = document.createElement("div");
        container.append(...arrify(result));
        expect(container.querySelector("section")?.textContent).toBe("text");
        dispose();
      }));
  });

  describe("GitHub Issues Compatibility", () => {
    it("https://github.com/ryansolid/dom-expressions/issues/156", () =>
      createRoot(dispose => {
        const div = html`<div>
          <For each=${() => [1, 2, 3]}>${(n: number) => html`<h1>${n}</h1>`}</For>
        </div>` as HTMLElement;
        const container = document.createElement("div");
        container.append(div);
        expect(container.innerHTML).toBe(
          "<div><h1>1<!--+--></h1><h1>2<!--+--></h1><h1>3<!--+--></h1><!--For--></div>"
        );
        dispose();
      }));

    it("https://github.com/ryansolid/dom-expressions/issues/248", () =>
      createRoot(dispose => {
        const Comp = (props: any) => html`<div>${props.children}</div>`;
        const result = html.define({ Comp }).jsx`<Comp>test "ups"</Comp>`;
        const container = document.createElement("div");
        container.append(...arrify(result));
        expect(container.innerHTML).toBe('<div>test "ups"<!--+--></div>');
        dispose();
      }));

    it("https://github.com/ryansolid/dom-expressions/issues/268", () =>
      createRoot(dispose => {
        const elements = html`
          <div id="div">Test</div>
          <style>
            #div {
              color: ${() => "red"};
              background-color: blue;
            }
          </style>
        ` as Node[];
        const container = document.createElement("div");
        container.append(...elements);
        document.body.append(container);
        expect(container.innerHTML).toEqual(
          `<div id="div">Test</div><style>
            #div {
              color: red<!--+-->;
              background-color: blue;
            }
          </style>`
        );
        dispose();
      }));

    it("https://github.com/ryansolid/dom-expressions/issues/269", () =>
      createRoot(dispose => {
        const elements = html``;
        expect(elements).toEqual([]);
        dispose();
      }));

    it("https://github.com/ryansolid/dom-expressions/issues/399", () =>
      createRoot(dispose => {
        const Foo = (props: any) => html`${props.bar}`;
        const result = html.define({ Foo }).jsx`<Foo bar></Foo>`;
        expect(result).toEqual(true);
        dispose();
      }));

    // it("https://github.com/solidjs/solid/issues/1996", () => {
    //   const elem = html`<some-el attr:foo="123">inspect element</some-el>` as HTMLElement;
    //   expect(elem.hasAttribute("foo")).toEqual(true);
    // });

    it("https://github.com/solidjs/solid/issues/2299", () =>
      createRoot(dispose => {
        const nodes = html` foo: ${123} bar: ${456} ` as Node[];

        expect(nodes[0]).toEqual(" foo: ");
        expect(nodes[1]).toEqual(123);
        dispose();
      }));

    it("template element edge case", () =>
      createRoot(dispose => {
        const elem = html`
          <div>
            <template>
              <h1>${123}</h1>
            </template>
          </div>
        `;
        const template = (elem as HTMLElement).querySelector("template")!;
        expect(template.content.querySelector("h1")?.textContent).toBe("123");
        dispose();
      }));
  });

  describe("Element Claims", () => {
    const withClaims = (fn: (claimed: Element[]) => void) =>
      createRoot(dispose => {
        const claimed: Element[] = [];
        const unregister = registerElementClaim(el => claimed.push(el));
        try {
          fn(claimed);
        } finally {
          unregister();
          dispose();
        }
      });

    it("claims a top-level anchor with a static href baked into the template", () =>
      withClaims(claimed => {
        const a = html`<a href="/about">About</a>` as HTMLAnchorElement;
        expect(claimed).toEqual([a]);
      }));

    it("claims a nested anchor with a static href", () =>
      withClaims(claimed => {
        const nav = html`<nav><a href="/about">About</a><span>plain</span></nav>` as HTMLElement;
        expect(claimed).toEqual([nav.querySelector("a")]);
      }));

    it("claims a form with a static action", () =>
      withClaims(claimed => {
        const form = html`<form action="/submit"><input name="q" /></form>` as HTMLFormElement;
        expect(claimed).toEqual([form]);
      }));

    it("claims anchors with dynamic hrefs through the attribute write", () => {
      const claimed: Element[] = [];
      const unregister = registerElementClaim(el => claimed.push(el));
      const [href, setHref] = createSignal("/a");
      let a!: HTMLAnchorElement;
      const dispose = createRoot(d => {
        a = html`<a href=${href}>Link</a>` as HTMLAnchorElement;
        return d;
      });
      expect(claimed).toEqual([a]);
      setHref("/b");
      flush();
      // the href recheck re-claims on change
      expect(claimed).toEqual([a, a]);
      unregister();
      dispose();
    });

    it("does not claim anchors without an href or unrelated elements", () =>
      withClaims(claimed => {
        html`<div><a name="anchor">No href</a><button type="button">B</button></div>`;
        expect(claimed).toEqual([]);
      }));

    it("claims every clone of a cached template independently", () =>
      withClaims(claimed => {
        const make = () => html`<a href="/about">About</a>` as HTMLAnchorElement;
        const first = make();
        const second = make();
        expect(first).not.toBe(second);
        expect(claimed).toEqual([first, second]);
      }));
  });
});
