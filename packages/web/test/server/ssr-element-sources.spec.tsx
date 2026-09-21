/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString, ssrElement } from "@solidjs/web";
import { $PROXY, createStore, merge, omit } from "solid-js";

// `ssrElement(tag, [a, b, c], ...)` serializes straight from several prop
// sources. Its contract is the merged one — byte-for-byte what
// `ssrElement(tag, merge(a, b, c), ...)` produces, attribute order included —
// without an intermediate object, and without ever reading a getter whose
// key a later source owns.

const stripKeys = (html: string) => html.replace(/ _hk=[^\s>]+/g, "");
const hydrationKeys = (html: string) => [...html.matchAll(/_hk=([^\s>]+)/g)].map(m => m[1]);

/** A source whose every getter counts its reads. */
function counting<T extends Record<string, unknown>>(
  values: T
): { source: T; reads: Record<string, number> } {
  const reads: Record<string, number> = {};
  const source = {} as T;
  for (const key of Object.keys(values)) {
    reads[key] = 0;
    Object.defineProperty(source, key, {
      enumerable: true,
      get() {
        reads[key]++;
        return values[key];
      }
    });
  }
  return { source, reads };
}

function render(
  tag: string,
  props: any,
  children?: any,
  needsId = false,
  skip?: (k: string) => boolean
) {
  return renderToString(() => ssrElement(tag, props, children, needsId, skip));
}

describe("ssrElement with multiple sources", () => {
  test("is equivalent to merge(...sources), attribute order included", () => {
    const shapes: Array<[string, any[]]> = [
      ["one source", [{ id: "a", class: "c", title: "t" }]],
      [
        "disjoint",
        [
          { id: "a", "data-x": "1" },
          { class: "c", title: "t" },
          { style: { color: "red" }, hidden: true }
        ]
      ],
      [
        "overlapping",
        [
          { id: "a", class: "c1", title: "t1", "data-x": "1" },
          { title: "t2", class: "c2", "data-y": "2" },
          { id: "b", "data-x": "3" }
        ]
      ],
      [
        "class and style objects",
        [
          { class: { a: true, b: false }, style: "color:red" },
          { style: { color: "blue", margin: "1px" }, class: ["x", "y"] }
        ]
      ],
      [
        "booleans, empty strings and nullish",
        [
          { disabled: false, title: "", "data-a": null },
          { disabled: true, "data-a": undefined, "data-b": "" }
        ]
      ],
      [
        "getters",
        [counting({ id: "a", title: "old" }).source, counting({ title: "new", class: "c" }).source]
      ],
      ["two sources, second empty", [{ id: "a" }, {}]],
      ["two sources, first empty", [{}, { id: "a" }]],
      ["escaping", [{ title: `a"b<c&d` }, { "data-x": `<&"` }]],
      [
        "client-only props",
        [
          { ref: () => {}, onClick: () => {} },
          { "prop:value": 1, id: "x" }
        ]
      ]
    ];
    for (const [name, sources] of shapes) {
      for (const tag of ["div", "input"]) {
        const fromSources = stripKeys(render(tag, sources, undefined, true));
        const fromMerge = stripKeys(render(tag, merge(...(sources as any[])), undefined, true));
        expect(fromSources, `${name} <${tag}>`).toBe(fromMerge);
      }
    }
  });

  test("later sources win and the shadowed getters are never read", () => {
    const a = counting({ id: "a", title: "old", "data-a": "1" });
    const b = counting({ title: "new", class: "c" });
    const c = counting({ id: "c" });
    const html = render("div", [a.source, b.source, c.source]);
    expect(html).toBe('<div data-a="1" title="new" class="c" id="c"></div>');
    expect(a.reads).toEqual({ id: 0, title: 0, "data-a": 1 });
    expect(b.reads).toEqual({ title: 1, class: 1 });
    expect(c.reads).toEqual({ id: 1 });
  });

  test("the winning getter is read exactly once", () => {
    const a = counting({
      class: "c",
      style: { color: "red" },
      "data-x": "x",
      hidden: true,
      onClick: () => {},
      title: "shadowed"
    });
    const b = counting({ title: "t" });
    render("div", [a.source, b.source]);
    expect(a.reads).toEqual({
      class: 1,
      style: 1,
      "data-x": 1,
      hidden: 1,
      onClick: 1,
      title: 0
    });
    expect(b.reads).toEqual({ title: 1 });
  });

  test("a later source answers the shadow check through `in`, not own keys", () => {
    // A merge()/omit() proxy owns its keys through its `has` trap; a plain
    // proxy with the same shape stands in for it here.
    const a = counting({ title: "a", id: "a" });
    const later = new Proxy({} as Record<string, string>, {
      has: (_, key) => key === "title",
      get: (_, key) => (key === "title" ? "proxied" : undefined),
      ownKeys: () => ["title"],
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true, value: "proxied" })
    });
    expect(render("div", [a.source, later])).toBe('<div id="a" title="proxied"></div>');
    expect(a.reads).toEqual({ title: 0, id: 1 });
  });

  test("skip drops a key from every source without reading it", () => {
    const a = counting({ id: "a", "data-x": "1", theme: "t" });
    const b = counting({ class: "c", "data-x": "2", $internal: 1 });
    const skip = (key: string) => key === "data-x" || key === "theme" || key[0] === "$";
    expect(render("div", [a.source, b.source], undefined, false, skip)).toBe(
      '<div id="a" class="c"></div>'
    );
    expect(a.reads).toEqual({ id: 1, "data-x": 0, theme: 0 });
    expect(b.reads).toEqual({ class: 1, "data-x": 0, $internal: 0 });
    // The single-object form takes the predicate too.
    expect(render("div", a.source, undefined, false, skip)).toBe('<div id="a"></div>');
  });

  test("children come from the sources when the argument is undefined", () => {
    expect(render("div", [{ children: "a" }, { id: "x" }])).toBe('<div id="x">a</div>');
    expect(render("div", [{ id: "x" }, { children: "<b>" }])).toBe('<div id="x">&lt;b></div>');
    expect(render("div", [{ innerHTML: "<b>raw</b>" }, { id: "x" }])).toBe(
      '<div id="x"><b>raw</b></div>'
    );
    expect(render("script", [{ children: "if (a < b) {}" }])).toBe(
      "<script>if (a < b) {}</script>"
    );

    // Later `children` wins; the earlier getter is never read.
    const a = counting({ children: "a" });
    const b = counting({ children: "b" });
    expect(render("div", [a.source, b.source])).toBe("<div>b</div>");
    expect(a.reads).toEqual({ children: 0 });
    expect(b.reads).toEqual({ children: 1 });
  });

  test("children getters stay unread on void tags and under a children argument", () => {
    const a = counting({ children: "a", value: "v" });
    expect(render("input", [a.source, { id: "x" }], undefined, true)).toMatch(
      /^<input _hk=\w+ value="v" id="x" \/>$/
    );
    expect(a.reads).toEqual({ children: 0, value: 1 });

    const b = counting({ children: "from-source", id: "x" });
    expect(render("div", [b.source, { title: "t" }], "from-arg")).toBe(
      '<div id="x" title="t">from-arg</div>'
    );
    expect(b.reads).toEqual({ children: 0, id: 1 });

    // textarea value is content, not an attribute, from any source (#3286).
    expect(render("textarea", [{ "data-x": "x" }, { value: "typed" }])).toBe(
      '<textarea data-x="x">typed</textarea>'
    );
    expect(
      render("textarea", [
        { value: "shadowed", id: "t" },
        { defaultValue: "d", value: "v" }
      ])
    ).toBe('<textarea id="t">v</textarea>');
  });

  test("nullish sources are empty and function sources resolve once, without ids", () => {
    let calls = 0;
    const thunk = () => {
      calls++;
      return { id: "x", title: "t" };
    };
    const html = renderToString(() => [
      ssrElement("span", [null, thunk, undefined], undefined, true),
      ssrElement("b", {}, "after", true)
    ]);
    const single = renderToString(() => [
      ssrElement("span", { id: "x", title: "t" }, undefined, true),
      ssrElement("b", {}, "after", true)
    ]);
    expect(calls).toBe(1);
    expect(html).toBe(single);
    expect(stripKeys(html)).toBe('<span id="x" title="t"></span><b>after</b>');
    // The element takes one key and the sibling the next: the thunk took none.
    const keys = hydrationKeys(html);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);

    // The caller's array is left as passed.
    const sources = [null, thunk];
    render("div", sources);
    expect(sources[1]).toBe(thunk);
    expect(render("div", [null, undefined])).toBe("<div></div>");
    expect(render("div", [])).toBe("<div></div>");
    expect(render("div", [() => null, () => undefined, { id: "x" }])).toBe('<div id="x"></div>');
  });

  test("the hydration key is allocated before any source getter runs", () => {
    const make = () => ({
      get children() {
        return ssrElement("i", {}, "c", true);
      }
    });
    const html = renderToString(() => [
      ssrElement("div", [{ id: "x" }, make()], undefined, true),
      ssrElement("b", {}, "after", true)
    ]);
    const single = renderToString(() => [
      ssrElement("div", merge({ id: "x" }, make()), undefined, true),
      ssrElement("b", {}, "after", true)
    ]);
    expect(html).toBe(single);
    expect(stripKeys(html)).toBe('<div id="x"><i>c</i></div><b>after</b>');
    // div, i, b — one id each, in document order.
    const keys = hydrationKeys(html).map(k => parseInt(k.split("-").pop()!));
    expect(keys).toEqual([keys[0], keys[0] + 1, keys[0] + 2]);
  });

  test("a thunk may yield the sources array, after the key is taken", () => {
    // The caller decides the sources only once the element owns its key —
    // e.g. computing them reads a getter that renders a child element.
    let calls = 0;
    const a = { id: "x" };
    const html = renderToString(() => [
      ssrElement(
        "div",
        () => {
          calls++;
          return [a, { class: "c", children: ssrElement("i", {}, "c", true) }];
        },
        undefined,
        true
      ),
      ssrElement("b", {}, "after", true)
    ]);
    expect(calls).toBe(1);
    expect(stripKeys(html)).toBe('<div id="x" class="c"><i>c</i></div><b>after</b>');
    const keys = hydrationKeys(html).map(k => parseInt(k.split("-").pop()!));
    expect(keys).toEqual([keys[0], keys[0] + 1, keys[0] + 2]);
    // ...and the predicate applies to it as well.
    expect(
      render(
        "div",
        () => [a, { class: "c" }],
        undefined,
        false,
        k => k === "id"
      )
    ).toBe('<div class="c"></div>');
  });

  test("nullish style and class from the winning source are omitted (#3382)", () => {
    const sources = [
      { class: "shadowed", style: "color:red", id: "x" },
      { class: undefined, style: null }
    ];
    expect(render("button", sources)).toBe('<button id="x"></button>');
    expect(render("button", sources)).toBe(render("button", merge(...(sources as any[]))));
    // ...and present ones from a later source replace the earlier value.
    expect(
      render("button", [
        { class: "a", style: { color: "red" } },
        { class: { b: true }, style: "margin:0" }
      ])
    ).toBe('<button class="b" style="margin:0"></button>');
  });

  test("the single-object and thunk forms are unchanged", () => {
    expect(render("div", { id: "x", class: "c" }, "kid")).toBe('<div id="x" class="c">kid</div>');
    expect(render("div", () => ({ id: "x" }))).toBe('<div id="x"></div>');
    expect(render("div", () => null)).toBe("<div></div>");
    expect(render("div", null)).toBe("<div></div>");
    expect(render("br", {}, undefined, true)).toMatch(/^<br _hk=\w+ \/>$/);
  });

  // A store, or any proxy that is not one of our views, is a single source
  // whose keys come from ONE `ownKeys` trap and whose values come from its
  // `get` trap — never enumerated through a descriptor trap per key.
  test("a store or foreign proxy source is walked through its traps", () => {
    const [state] = createStore({ id: "s", title: "T" });
    expect(render("div", state)).toBe('<div id="s" title="T"></div>');

    const traps: string[] = [];
    const sym = Symbol("hidden");
    const foreign = new Proxy({} as Record<PropertyKey, string>, {
      ownKeys() {
        traps.push("ownKeys");
        return ["id", sym, "data-x"];
      },
      get(_t, key) {
        traps.push(`get:${String(key)}`);
        if (key === $PROXY) return foreign;
        if (key === "id") return "f";
        if (key === "data-x") return "y";
        return undefined;
      },
      has(_t, key) {
        return key === $PROXY || key === "id" || key === "data-x";
      },
      getOwnPropertyDescriptor() {
        traps.push("descriptor");
        return { value: "", enumerable: true, configurable: true };
      }
    });
    expect(render("div", foreign)).toBe('<div id="f" data-x="y"></div>');
    expect(traps.filter(t => t === "ownKeys")).toHaveLength(1);
    expect(traps).not.toContain("descriptor");
    expect(traps).toContain("get:id");
    expect(traps).toContain("get:data-x");
  });

  // One string, a number, nothing, or one finished node joins the open and
  // close tags in place; anything else — arrays, pending nodes — goes through
  // the tree resolver. Same output either way; this pins the shapes.
  test("children of every shape serialize as the resolver would", () => {
    expect(render("p", {}, "text")).toBe("<p>text</p>");
    expect(render("p", {}, () => "thunked")).toBe("<p>thunked</p>");
    expect(render("p", {}, 42)).toBe("<p>42</p>");
    expect(render("p", {}, 0)).toBe("<p>0</p>");
    expect(render("p", {}, null)).toBe("<p></p>");
    expect(render("p", {}, undefined)).toBe("<p></p>");
    expect(render("p", {}, false)).toBe("<p></p>");
    expect(render("p", {}, true)).toBe("<p></p>");
    // a finished node from a nested element
    expect(render("p", {}, () => ssrElement("b", { id: "i" }, "in", false))).toBe(
      '<p><b id="i">in</b></p>'
    );
    // from the sources, escaped or raw
    expect(render("p", [{ children: 7 }])).toBe("<p>7</p>");
    expect(render("style", [{ children: "a > b {}" }])).toBe("<style>a > b {}</style>");
    // arrays take the resolver: an element's direct children are never
    // separated from each other, a nested array keeps the text separators the
    // client needs to claim two text nodes
    expect(render("p", {}, ["a", "b"])).toBe("<p>ab</p>");
    expect(render("p", {}, () => [1, 2])).toBe("<p>12</p>");
    expect(render("p", {}, ["a", ssrElement("i", {}, "x", false), "b"])).toBe("<p>a<i>x</i>b</p>");
    expect(render("p", {}, [["a", "b"]])).toBe("<p>a<!--!$-->b</p>");
    expect(
      renderToString(() => [ssrElement("p", {}, "a", false), ssrElement("p", {}, "b", false)])
    ).toBe("<p>a</p><p>b</p>");
  });
});

// `ssrElement(tag, props, children, needsId, skip, attrs)`: `attrs` is
// attribute markup the caller already holds as a string, appended after the
// props' attributes as a last source would be — walked for nothing, escaped by
// nobody here.
describe("ssrElement with an attribute string", () => {
  const attrs = (props: any, s: string | undefined, skip?: (k: string) => boolean, tag = "div") =>
    renderToString(() => ssrElement(tag, props, undefined, false, skip, s));

  test("is appended after the props' attributes, verbatim", () => {
    expect(attrs({ id: "x" }, ' class="c d"')).toBe('<div id="x" class="c d"></div>');
    // not escaped: the caller vouches for it
    expect(attrs({}, ' data-raw="a&amp;b"')).toBe('<div data-raw="a&amp;b"></div>');
    // an empty string and undefined add nothing
    expect(attrs({ id: "x" }, "")).toBe('<div id="x"></div>');
    expect(attrs({ id: "x" }, undefined)).toBe('<div id="x"></div>');
  });

  test("is the same as a trailing source when its keys are kept off the props", () => {
    const { source, reads } = counting({ id: "x", class: "author", title: "t", style: "s" });
    const skip = (k: string) => k === "class" || k === "style";
    const html = attrs(source, ' class="computed" style="color:red"', skip);
    expect(html).toBe(
      renderToString(() =>
        ssrElement("div", [source, { class: "computed", style: "color:red" }], undefined, false)
      )
    );
    expect(html).toBe('<div id="x" title="t" class="computed" style="color:red"></div>');
    // the shadowed getters are never read, by either form
    expect(reads).toEqual({ id: 2, class: 0, title: 2, style: 0 });
  });

  test("takes the array-sources form, the thunk form, and void tags", () => {
    expect(attrs([{ id: "x" }, { title: "t" }], ' class="c"')).toBe(
      '<div id="x" title="t" class="c"></div>'
    );
    expect(attrs(() => ({ id: "x" }), ' class="c"')).toBe('<div id="x" class="c"></div>');
    expect(attrs({ type: "text" }, ' class="c"', undefined, "input")).toBe(
      '<input type="text" class="c" />'
    );
    // children from the props still follow it
    expect(attrs({ children: "kid", id: "x" }, ' class="c"')).toBe(
      '<div id="x" class="c">kid</div>'
    );
  });

  test("attribute names that escape are still escaped, and remembered only when clean", () => {
    // a key that needs escaping never lands as-is, however often it is seen
    for (let i = 0; i < 3; i++) {
      expect(attrs({ "a<b": "1", ok: "2" }, undefined)).toBe('<div a&lt;b="1" ok="2"></div>');
    }
  });
});

// omit() and merge() results are walked as VIEWS — the underlying sources,
// filter attached — not enumerated through their proxies. Output is what the
// proxy would have produced; the getters behind hidden or shadowed keys are
// never read.
describe("ssrElement over omit() and merge() views", () => {
  test("a lone omit() of a plain object: hidden keys are skipped unread", () => {
    const { source, reads } = counting({
      id: "a",
      isActive: true,
      disabled: false,
      title: "t",
      children: "kid"
    });
    const html = render("li", omit(source, "isActive", "disabled"));
    expect(html).toBe('<li id="a" title="t">kid</li>');
    expect(reads).toEqual({ id: 1, isActive: 0, disabled: 0, title: 1, children: 1 });
  });

  test("a predicate omit hides by rule", () => {
    const { source, reads } = counting({ $props: 1, $theme: 2, id: "a", class: "c" });
    const html = render(
      "div",
      omit(source, k => typeof k === "string" && k[0] === "$")
    );
    expect(html).toBe('<div id="a" class="c"></div>');
    expect(reads.$props).toBe(0);
    expect(reads.$theme).toBe(0);
  });

  test("an omit() view inside a sources array follows later-wins", () => {
    const { source: rest, reads } = counting({
      id: "from-rest",
      type: "submit",
      "aria-label": "x",
      isActive: true
    });
    const html = render("button", [
      omit(rest, "isActive"),
      {
        type: "button",
        get class() {
          return "tab";
        }
      }
    ]);
    // merged order: each key at the position of the LAST source carrying it
    expect(html).toBe('<button id="from-rest" aria-label="x" type="button" class="tab"></button>');
    // `type` is owned by the later source: the view's getter is not read
    expect(reads).toEqual({ id: 1, type: 0, "aria-label": 1, isActive: 0 });
  });

  test("a merge() result among the sources contributes its flattened sources", () => {
    const { source: a, reads } = counting({ id: "a", title: "t-a", "data-a": "1" });
    const merged = merge(a, () => ({ title: "t-fn" }), { "data-b": "2" });
    expect(render("div", [merged, { "data-c": "3" }])).toBe(
      '<div id="a" data-a="1" title="t-fn" data-b="2" data-c="3"></div>'
    );
    expect(reads.title).toBe(0);
  });

  test("omit() over a merge() stays filtered (#3014) and reads each getter once", () => {
    const { source: dyn, reads } = counting({ value: "v", onChange: () => {}, placeholder: "p" });
    const props = merge({ label: "L", name: "n" }, dyn);
    const rest = omit(props, "name", "label", "value", "onChange");
    expect(render("input", [{ name: "n", value: "v" }, rest], undefined, false)).toBe(
      '<input name="n" value="v" placeholder="p" />'
    );
    expect(reads).toEqual({ value: 0, onChange: 0, placeholder: 1 });
  });

  test("a nested omit() flattens to one view", () => {
    const { source, reads } = counting({ a: "1", b: "2", c: "3" });
    expect(render("i", omit(omit(source, "a"), "b"))).toBe('<i c="3"></i>');
    expect(reads).toEqual({ a: 0, b: 0, c: 1 });
  });
});
