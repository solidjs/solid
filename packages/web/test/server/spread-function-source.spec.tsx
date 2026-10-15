/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString, dynamic, mergeProps, ssrElement } from "@solidjs/web";
import { createSignal, createStore, omit } from "solid-js";

// Regression (#2815): SSR dropped props whose spread source is a function.
// The compiler passes spread sources lazily (`mergeProps({...static}, fn)`).
// dom-expressions' server entry used to ship its own merger that resolved a
// function source for key enumeration only — the per-key getter read
// `fn[key]` (undefined) and the attribute vanished from the HTML. The server
// entry now sources `mergeProps` from solid-js, exactly
// like the client and universal entries.
describe("SSR spread with function source (#2815)", () => {
  test("mergeProps resolves function sources for values, not just keys", () => {
    const fn = () => ({ "data-x": "1" });
    const html = renderToString(() => ssrElement("div", mergeProps({ id: "y" }, fn), "x", false));
    expect(html).toContain('data-x="1"');
    expect(html).toContain('id="y"');
  });

  test("object spread source still renders (no regression)", () => {
    const obj = { "data-x": "1" };
    const html = renderToString(() => ssrElement("div", mergeProps({ id: "y" }, obj), "x", false));
    expect(html).toContain('data-x="1"');
    expect(html).toContain('id="y"');
  });

  test("JSX spread of a function call result alongside a static attribute", () => {
    const html = renderToString(() => <div id="y" {...(() => ({ "data-x": "1" }))()} />);
    expect(html).toContain('data-x="1"');
    expect(html).toContain('id="y"');
  });

  test("textarea value from props merged around a spread becomes text content (#3286)", () => {
    const value = () => "something";
    const html = renderToString(() => <textarea {...{ "data-x": "x" }} value={value()} />);

    expect(html).toMatch(/data-x="x"\s*>something<\/textarea>/);
    expect(html).not.toContain(' value="something"');
  });

  test("textarea value supplied by a spread becomes text content (#3286)", () => {
    const html = renderToString(() => <textarea {...{ "data-x": "x", value: "something" }} />);

    expect(html).toMatch(/data-x="x"\s*>something<\/textarea>/);
    expect(html).not.toContain(' value="something"');
  });

  test("textarea value before a spread remains text content (#3286)", () => {
    const html = renderToString(() => <textarea value="something" {...{ "data-x": "x" }} />);

    expect(html).toMatch(/data-x="x"\s*>something<\/textarea>/);
    expect(html).not.toContain(' value="something"');
  });

  test("textarea defaultValue supplied by a spread becomes text content (#3286)", () => {
    const html = renderToString(() => (
      <textarea {...{ "data-x": "x", defaultValue: "something" }} />
    ));

    expect(html).toMatch(/data-x="x"\s*>something<\/textarea>/);
    expect(html).not.toContain(' defaultValue="something"');
  });

  test("a lone spread whose source is null or undefined is an empty spread (#3297)", () => {
    const [absent] = createSignal<{ value: string } | null>(null);
    const bare = /^<input(\s_hk=\d+)?\s*\/?>$/;
    expect(renderToString(() => <input {...absent()} />)).toMatch(bare);
    expect(renderToString(() => <input {...(undefined as any)} />)).toMatch(bare);
    expect(renderToString(() => ssrElement("input", () => null, undefined, false))).toMatch(bare);
  });

  test("a dynamic() tag routes spreads through mergeProps", () => {
    const props = { "data-x": "1", id: "y" };
    const Div = dynamic(() => "div");
    const html = renderToString(() => <Div {...props} />);
    expect(html).toContain('data-x="1"');
    expect(html).toContain('id="y"');
  });

  test("later function source overrides earlier static prop", () => {
    const fn = () => ({ id: "override" });
    const html = renderToString(() => ssrElement("div", mergeProps({ id: "y" }, fn), "x", false));
    expect(html).toContain('id="override"');
    expect(html).not.toContain('id="y"');
  });
});

describe("SSR form defaults supplied by spreads", () => {
  test("input defaults are present in the initial HTML", () => {
    const html = renderToString(() => (
      <>
        <input {...{ name: "name", defaultValue: "Ada" }} />
        <input {...{ type: "checkbox", defaultChecked: true }} />
      </>
    ));

    expect(html).toContain('name="name" value="Ada"');
    expect(html).toContain('type="checkbox" checked');
    expect(html).not.toContain("defaultValue");
    expect(html).not.toContain("defaultChecked");
  });

  test("option defaults remain selected under a bound select", () => {
    const html = renderToString(() => (
      <select value="other">
        <option {...{ value: "initial", defaultSelected: true }}>Initial</option>
        <option value="other">Other</option>
      </select>
    ));

    expect(html).toMatch(/value="initial" selected>Initial<\/option>/);
    expect(html).not.toMatch(/value="other"[^>]*selected/);
    expect(html).not.toContain("defaultSelected");
  });

  test("named attributes after a spread own the names its defaults would write", () => {
    const html = renderToString(() => (
      <>
        <input {...{ defaultValue: "spread" }} value="named" />
        <input {...{ defaultChecked: true }} checked />
        <option {...{ defaultSelected: true }} selected>
          Initial
        </option>
      </>
    ));

    expect(html.replace(/ _hk=[^\s>]+/g, "")).toBe(
      '<input value="named" /><input checked /><option selected>Initial</option>'
    );
  });

  test("false named attributes after a spread suppress its defaults", () => {
    const checked = () => false;
    const html = renderToString(() => (
      <>
        <input {...{ defaultChecked: true }} checked={checked()} />
        <select multiple>
          <option {...{ defaultSelected: true }} selected={false}>
            Initial
          </option>
        </select>
      </>
    ));

    expect(html.replace(/ _hk=[^\s>]+/g, "")).toBe(
      "<input /><select multiple><option>Initial</option></select>"
    );
  });

  test("false named defaults after a spread suppress its defaults", () => {
    const html = renderToString(() => (
      <>
        <input {...{ defaultChecked: true }} defaultChecked={false} />
        <select multiple>
          <option {...{ defaultSelected: true }} defaultSelected={false}>
            Initial
          </option>
        </select>
      </>
    ));

    expect(html.replace(/ _hk=[^\s>]+/g, "")).toBe(
      "<input /><select multiple><option>Initial</option></select>"
    );
  });

  test.each([
    ["input", "defaultValue", "value", ' value="named"', '<input value="named" />'],
    ["input", "defaultChecked", "checked", " checked", "<input checked />"],
    ["input", "defaultChecked", "checked", "", "<input />"],
    ["option", "defaultSelected", "selected", " selected", "<option selected></option>"],
    ["option", "defaultSelected", "selected", "", "<option></option>"]
  ])("%s skips %s when the compiled tail owns %s", (tag, prop, attr, tail, expected) => {
    const props = {
      get [prop]() {
        throw new Error("A default reserved by the compiled tail must not be read");
      }
    };
    for (const attrs of [tail, () => tail]) {
      expect(
        renderToString(() => ssrElement(tag, props, undefined, false, key => key === attr, attrs))
      ).toBe(expected);
    }
  });

  test.each([
    ["input", "defaultValue", 'Ada & "Grace"', '<input value="Ada &amp; &quot;Grace&quot;" />'],
    ["input", "defaultValue", "", "<input value />"],
    ["input", "defaultValue", 0, '<input value="0" />'],
    ["input", "defaultValue", null, "<input />"],
    ["input", "defaultValue", undefined, "<input />"],
    ["input", "defaultChecked", true, "<input checked />"],
    ["input", "defaultChecked", false, "<input />"],
    ["option", "defaultSelected", true, "<option selected></option>"],
    ["option", "defaultSelected", false, "<option></option>"]
  ] as const)("%s maps %s=%j across source forms", (tag, prop, value, expected) => {
    const props = { [prop]: value };
    const [store] = createStore(props);
    for (const source of [
      props,
      store,
      [props],
      [() => props],
      mergeProps({}, props),
      omit({ ...props, ignored: true }, "ignored")
    ]) {
      expect(renderToString(() => ssrElement(tag, source, undefined, false))).toBe(expected);
    }
  });

  test.each([
    ["input", "value", "defaultValue", "Ada", '<input value="Ada" />'],
    ["input", "checked", "defaultChecked", false, "<input />"],
    ["option", "selected", "defaultSelected", false, "<option></option>"],
    ["input", "value", "defaultValue", undefined, "<input />"]
  ] as const)(
    "%s %s yields to %s regardless of source order",
    (tag, prop, defaultProp, value, expected) => {
      const bound = {
        get [prop]() {
          throw new Error("The bound property must not be read when a default is present");
        }
      };
      const defaults = { [defaultProp]: value };
      const [store] = createStore({ [prop]: "bound", ...defaults });
      expect(renderToString(() => ssrElement(tag, store, undefined, false))).toBe(expected);
      for (const sources of [
        [bound, defaults],
        [defaults, bound]
      ]) {
        for (const source of [sources, mergeProps(...sources)]) {
          expect(renderToString(() => ssrElement(tag, source, undefined, false))).toBe(expected);
        }
        const single = Object.defineProperties(
          {},
          Object.assign({}, ...sources.map(source => Object.getOwnPropertyDescriptors(source)))
        );
        expect(renderToString(() => ssrElement(tag, single, undefined, false))).toBe(expected);
      }
    }
  );

  test("later defaults shadow earlier getters without consuming hydration ids", () => {
    let calls = 0;
    let reads = 0;
    const html = renderToString(() => [
      ssrElement(
        "input",
        [
          {
            get defaultValue() {
              throw new Error("The shadowed default must not be read");
            }
          },
          () => {
            calls++;
            return {
              get defaultValue() {
                reads++;
                return "Ada";
              }
            };
          }
        ],
        undefined,
        true
      ),
      ssrElement("input", { defaultChecked: true }, undefined, true)
    ]);
    const expected = renderToString(() => [
      ssrElement("input", { value: "Ada" }, undefined, true),
      ssrElement("input", { checked: true }, undefined, true)
    ]);

    expect(html).toBe(expected);
    expect(calls).toBe(1);
    expect(reads).toBe(1);
  });

  test("a skipped default leaves the bound attribute available", () => {
    const html = renderToString(() =>
      ssrElement(
        "input",
        { defaultValue: "initial", value: "current" },
        undefined,
        false,
        prop => prop === "defaultValue"
      )
    );
    expect(html).toBe('<input value="current" />');
  });

  test("default property names on other tags remain ordinary attributes", () => {
    const html = renderToString(() =>
      ssrElement(
        "custom-field",
        { defaultValue: "Ada", defaultChecked: true, defaultSelected: true },
        undefined,
        false
      )
    );
    expect(html).toBe(
      '<custom-field defaultValue="Ada" defaultChecked defaultSelected></custom-field>'
    );
  });
});
