import * as S from "s-js";
import { createHTML } from "../dist/lit-dom-expressions";
import * as r from "dom-expressions/src/runtime";

const html = createHTML(r);

const FIXTURES = [
  '<div id="main"><h1>Welcome</h1><span style="color: rgb(85, 85, 85);">555</span><label class="name" for="entry">Edit:</label><input id="entry" type="text"></div>',
  '<div id="main" class="selected also" refset="true"><h1 class="hello" title="hello" style="background-color: red;"><a href="/">Welcome</a></h1></div>',
  '<div id="main"><button>Click Bound</button><button>Click Delegated</button><button>Click Listener</button></div>',
  "<div>First</div>middle<p>after1</p><div>Last</div><p>after2</p>",
  '<div id="main"><div>John R.<span>Smith</span></div><div>After</div></div>',
  "<div>John R.<span>Smith</span></div>",
  "<div><div>Hi</div></div>",
  "<div><b>Hello, my name is: <i>John</i></b></div>",
  "<style>.something{color:red}</style>"
];

describe("Test HTML", () => {
  test("Simple Elements", () => {
    const template = html`
      <div id="main">
        <h1>Welcome</h1>
        <span style="color: rgb(85, 85, 85);">${555}</span>
        <label class="name" for="entry">Edit:</label>
        <input id="entry" type="text" />
      </div>
    `;
    expect(template.outerHTML).toBe(FIXTURES[0]);
  });

  test("Attribute Expressions", () => {
    const selected = S.data(true),
      welcoming = S.data("hello");
    let link;

    S.root(() => {
      const template = html`
        <div
          id="main"
          classList=${() => ({ "selected also": selected(), not: false })}
          ref=${el => {
            el.setAttribute("refset", "true");
          }}
        >
          <h1 class=${welcoming} title=${welcoming} style=${() => ({ "background-color": "red" })}>
            <a href="/" ref=${r => (link = r)}>Welcome</a>
          </h1>
        </div>
      `;
      expect(template.outerHTML).toBe(FIXTURES[1]);
    });
  });

  test("Event Expressions", () => {
    const exec = {};

    const template = html`
      <div id="main">
        <button onclick=${() => (exec.bound = true)}>Click Bound</button>
        <button onClick=${[v => (exec.delegated = v), true]}>
          Click Delegated
        </button>
        <button on=${{ click: () => (exec.listener = true) }}>
          Click Listener
        </button>
      </div>
    `;
    expect(template.outerHTML).toBe(FIXTURES[2]);
    document.body.appendChild(template);
    var event = new MouseEvent("click", { bubbles: true });
    template.firstChild.dispatchEvent(event);
    event = new MouseEvent("click", { bubbles: true });
    template.firstChild.nextSibling.dispatchEvent(event);
    event = new MouseEvent("click", { bubbles: true });
    template.firstChild.nextSibling.nextSibling.dispatchEvent(event);

    expect(exec.bound).toBe(true);
    expect(exec.delegated).toBe(true);
    expect(exec.listener).toBe(true);
    document.body.textContent = "";
    r.clearDelegatedEvents();
  });

  test("Fragments", () => {
    const inserted = S.data("middle"),
      after1 = S.data("after1"),
      after2 = S.data("after2");

    S.root(() => {
      const template = html`
        <div>First</div>
        ${inserted}
        <p>${after1}</p>
        <div>Last</div>
        <p>${after2}</p>
      `;
      const div = document.createElement("div");
      r.insert(div, template);
      expect(div.innerHTML.replace(/<!--#-->/g, "")).toBe(FIXTURES[3]);
    });
  });

  test("Components", () => {
    const Comp = props =>
      html`
        <div>${() => props.name + " " + props.middle}${props.children}</div>
      `;
    S.root(() => {
      const template = html`
        <div id="main">
          <${Comp} name=${() => "John"} middle="R."><span>Smith</span><//>
          <div>After</div>
        </div>
      `;
      const div = document.createElement("div");
      div.appendChild(template);
      expect(div.innerHTML.replace(/<!--#-->/g, "")).toBe(FIXTURES[4]);
    });
  });

  test("Top Level Components", () => {
    const Comp = props =>
      html`
        <div>${() => props.name + " " + props.middle}${props.children}</div>
      `;
    S.root(() => {
      const template = html`
        <${Comp} name=${() => "John"} middle="R."><span>Smith</span><//>
      `;
      const div = document.createElement("div");
      div.appendChild(template);
      expect(div.innerHTML.replace(/<!--#-->/g, "")).toBe(FIXTURES[5]);
    });
  });

  test("Nested Components", () => {
    const Comp = props =>
      html`
        <div>${() => props.children}</div>
      `;
    S.root(() => {
      const template = html`
        <${Comp}><${Comp}>Hi<//><//>
      `;
      const div = document.createElement("div");
      div.appendChild(template);
      expect(div.innerHTML.replace(/<!--#-->/g, "")).toBe(FIXTURES[6]);
    });
  });

  test("Test whitespace trim", () => {
    const name = "John";
    const template = html`
      <div>
        <b>Hello, my name is:     <i> ${name}</i></b>
      </div>
    `;
    const div = document.createElement("div");
    div.appendChild(template);
    expect(div.innerHTML.replace(/<!--#-->/g, "")).toBe(FIXTURES[7]);
  })
});

test("Test style tag", () => {
  const color = "red";
  const template = html`
    <style>.something{color:${color}}</style>
  `;
  const div = document.createElement("div");
  div.appendChild(template);
  expect(div.innerHTML.replace(/<!--#-->/g, "")).toBe(FIXTURES[8]);
});
