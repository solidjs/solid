import { createRoot, createSignal, flush } from "solid-js";
import { createHyperScript } from "../src/hyperscript.js";
import * as r from "../../web/src/client.js";

const h = createHyperScript(r);

// `h(...)` always returns a tagged zero-arity thunk; the tests below
// invoke it inside a `createRoot` to materialize DOM in a proper reactive
// owner, matching the shape real consumers use via `r.render(h(App), root)`.
const mount = fn => createRoot(() => fn()());

const FIXTURES = [
  '<div id="main"><h1>Welcome</h1><p>10Symbol($)</p><span style="color: rgb(85, 85, 85);">555</span><label for="entry" class="name">Edit:</label><input id="entry" type="text" readonly=""></div>',
  '<div id="main" refset="true" class="selected"><h1 title="hello" style="background-color: red;"><a href="/">Welcome</a></h1></div>',
  '<div id="main"><button>Click Bound</button><button>Click Delegated</button></div>',
  "<div>First</div>middle<div>Last</div>",
  '<div id="main"><div>John R.<span>Smith</span></div></div>',
  '<div id="main"><div name="John"><span>Smith</span></div></div>',
  '<div id="main"><div class="a b"></div></div>'
];

describe("Test HyperScript", () => {
  test("Simple Elements", () => {
    const dollar = Symbol("$");
    const template = mount(() =>
      h("#main", [
        h("h1", "Welcome"),
        h("p", 10n, dollar),
        h("span", { style: "color: #555" }, 555),
        h("label.name", { for: "entry" }, "Edit:"),
        h("input#entry", { type: "text", readonly: true })
      ])
    );
    expect(template.outerHTML).toBe(FIXTURES[0]);
  });

  test("Attribute Expressions", () => {
    const [selected] = createSignal(true),
      [welcoming] = createSignal("hello");
    let link;

    const template = mount(() =>
      h(
        "#main",
        {
          class: () => ({ selected: selected() }),
          ref: el => {
            el.setAttribute("refset", "true");
          }
        },
        h(
          "h1",
          {
            title: welcoming,
            style: () => ({ "background-color": "red" })
          },
          h("a", { href: "/", ref: r => (link = r) }, "Welcome")
        )
      )
    );
    expect(template.outerHTML).toBe(FIXTURES[1]);
  });

  test("Event Expressions", () => {
    const exec = {};

    const template = mount(() =>
      h("#main", [
        h("button", { onclick: () => (exec.bound = true) }, "Click Bound"),
        h("button", { onClick: () => (exec.delegated = true) }, "Click Delegated")
      ])
    );
    expect(template.outerHTML).toBe(FIXTURES[2]);
    document.body.appendChild(template);
    r.registerDelegatedRoot(document.body);
    var event = new MouseEvent("click", { bubbles: true });
    template.firstChild.dispatchEvent(event);
    event = new MouseEvent("click", { bubbles: true });
    template.firstChild.nextSibling.dispatchEvent(event);
    expect(exec.bound).toBe(true);
    expect(exec.delegated).toBe(true);
    r.unregisterDelegatedRoot(document.body);
    document.body.textContent = "";
  });

  test("Fragments", () => {
    const [inserted] = createSignal("middle");

    const div = createRoot(() => {
      const template = [h("div", "First"), inserted, h("div", "Last")];
      const div = document.createElement("div");
      r.insert(div, template);
      return div;
    });
    expect(div.innerHTML).toBe(FIXTURES[3]);
  });

  test("Components", () => {
    const Comp = props => h("div", () => props.name + " " + props.middle, props.children);
    const div = createRoot(() => {
      const template = h("#main", [
        h(Comp, { name: () => "John", middle: "R." }, h("span", "Smith"))
      ])();
      const div = document.createElement("div");
      div.appendChild(template);
      return div;
    });
    expect(div.innerHTML).toBe(FIXTURES[4]);
  });

  test("Component Spread", () => {
    const Comp = props => h("div", props);
    const div = createRoot(() => {
      const template = h("#main", [h(Comp, { name: () => "John" }, h("span", "Smith"))])();
      const div = document.createElement("div");
      div.appendChild(template);
      return div;
    });
    expect(div.innerHTML).toBe(FIXTURES[5]);
  });

  test("Class Spread", () => {
    const div = createRoot(() => {
      const template = h("#main", [h("div.a", { class: "b" })])();
      const div = document.createElement("div");
      div.appendChild(template);
      return div;
    });
    expect(div.innerHTML).toBe(FIXTURES[6]);
  });

  // --- Previously uncovered branches ---

  test("h() with a single array arg returns the array as-is", () => {
    const arr = [h("span", "a"), h("span", "b")];
    expect(h(arr)).toBe(arr);
  });

  test("h.Fragment returns its children through createComponent", () => {
    const first = h("span", "A");
    const second = h("span", "B");
    // Fragment is a component whose body returns props.children.
    const result = mount(() => h(h.Fragment, null, first, second));
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([first, second]);
  });

  test("#id-only selector defaults to a div", () => {
    const el = mount(() => h("#main"));
    expect(el.tagName).toBe("DIV");
    expect(el.id).toBe("main");
  });

  test(".class-only selector defaults to a div", () => {
    const el = mount(() => h(".a.b"));
    expect(el.tagName).toBe("DIV");
    expect(el.className).toBe("a b");
  });

  test("SVG tag names go through the svg namespace", () => {
    const el = mount(() => h("svg", h("circle")));
    expect(el.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(el.firstChild.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });

  test("MathML tag names go through the mathml namespace", () => {
    const el = mount(() => h("mi", "x"));
    expect(el.namespaceURI).toBe("http://www.w3.org/1998/Math/MathML");
  });

  test("Date children render via toString", () => {
    const date = new Date(0);
    const el = mount(() => h("p", date));
    expect(el.textContent).toBe(date.toString());
  });

  test("RegExp children render via toString", () => {
    const el = mount(() => h("p", /foo/g));
    expect(el.textContent).toBe("/foo/g");
  });

  test("boolean children render via toString", () => {
    const el = mount(() => h("p", true, " ", false));
    expect(el.textContent).toBe("true false");
  });

  test("null and undefined children are no-ops", () => {
    const el = mount(() => h("div", null, undefined, "content"));
    expect(el.textContent).toBe("content");
    expect(el.childNodes.length).toBe(1);
  });

  test("an existing Element passed as a child is inserted", () => {
    const existing = document.createElement("b");
    existing.textContent = "hi";
    const el = mount(() => h("div", existing));
    expect(el.firstChild).toBe(existing);
  });

  test("function child other than the first position inserts dynamically", () => {
    const [text, setText] = createSignal("hello");
    const el = mount(() => h("div", "prefix:", () => text()));
    expect(el.textContent).toBe("prefix:hello");
    setText("world");
    flush();
    expect(el.textContent).toBe("prefix:world");
  });

  test("nested-array children with functions are detected as multiExpression", () => {
    const [val, setVal] = createSignal("a");
    const el = mount(() => h("div", "x", ["y", () => val()]));
    expect(el.textContent).toBe("xya");
    setVal("z");
    flush();
    expect(el.textContent).toBe("xyz");
  });

  test("component invoked with only children arg (no props) wraps args as props.children", () => {
    const Comp = props => h("p", props.children);
    const el = mount(() => h(Comp, "just-text"));
    expect(el.outerHTML).toBe("<p>just-text</p>");
  });

  test("component invoked with an Element as the second arg skips the props step", () => {
    // An Element instance is neither null nor a plain object, so the
    // props slot is skipped and that Element becomes `props.children`.
    const existing = document.createElement("span");
    existing.textContent = "inner";
    const Comp = props => h("section", props.children);
    const el = mount(() => h(Comp, existing));
    expect(el.firstChild).toBe(existing);
  });

  test("component with multiple extra args bundles them into props.children array", () => {
    const Comp = props => h("ul", props.children);
    const el = mount(() => h(Comp, null, h("li", "a"), h("li", "b"), h("li", "c")));
    expect(el.children.length).toBe(3);
    expect(el.children[0].textContent).toBe("a");
    expect(el.children[2].textContent).toBe("c");
  });

  test("props with a getter route through r.spread (reactive updates)", () => {
    const [value, setValue] = createSignal("first");
    const props = {};
    Object.defineProperty(props, "title", {
      get() {
        return value();
      },
      enumerable: true,
      configurable: true
    });

    const el = mount(() => h("span", props));
    expect(el.getAttribute("title")).toBe("first");

    setValue("second");
    flush();
    expect(el.getAttribute("title")).toBe("second");
  });

  test("class option is merged with selector classes when both are present", () => {
    // The selector `.sel` adds class "sel"; the object `class: "opt"`
    // should merge rather than overwrite. Exercises the `classes.length !== 0`
    // branch where the existing classes array is folded into the value.
    const el = mount(() => h("div.sel", { class: "opt" }));
    expect(el.classList.contains("sel")).toBe(true);
    expect(el.classList.contains("opt")).toBe(true);
  });
});
