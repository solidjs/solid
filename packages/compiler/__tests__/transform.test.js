const { transform } = require("../index");
const fs = require("fs");
const path = require("path");

const babelDomFixtures = path.resolve(__dirname, "../../babel-plugin-jsx/test/__dom_fixtures__");

function readFixture(name) {
  return fs.readFileSync(path.join(babelDomFixtures, name, "code.js"), "utf8");
}

describe("@solidjs/compiler transform", () => {
  it("lowers a simple native JSX element to a DOM template call", () => {
    const result = transform('const view = <div id="main">Hello</div>;', {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { template as _$template } from "r-dom";');
    expect(result.code).toContain("const view = _tmpl$();");
    expect(result.code).toContain("/* @__PURE__ */ _$template");
    expect(result.code).toContain("_$template(`<div id=main>Hello`)");
  });

  it("defaults moduleName to @solidjs/web and builtIns to the Solid control-flow set", () => {
    const result = transform("const view = <For each={list}>{item => item}</For>;", {
      filename: "input.jsx"
    });

    expect(result.code).toContain('from "@solidjs/web"');
    expect(result.code).toContain("For as _$For");
  });

  it("can preserve last closing tags when configured", () => {
    const result = transform('const view = <div id="main">Hello</div>;', {
      filename: "input.jsx",
      moduleName: "r-dom",
      omitLastClosingTag: false
    });

    expect(result.code).toContain("_$template(`<div id=main>Hello</div>`)");
  });

  it("lowers dynamic text children through insert", () => {
    const result = transform("const view = <div>Hello {name}</div>;", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { insert as _$insert } from "r-dom";');
    expect(result.code).toContain("_$insert(_el$, name, null);");
  });

  it("memoizes dynamic conditional DOM child predicates by default", () => {
    const result = transform("const view = <div>{state.dynamic ? good() : bad}</div>;", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { memo as _$memo } from "r-dom";');
    expect(result.code).toContain("var _c$ = _$memo");
    expect(result.code).toContain("return !!state.dynamic;");
    expect(result.code).toContain("return _c$() ? good() : bad;");
    expect(result.code).toContain("_$insert(_el$, (() =>");
  });

  it("wraps dynamic DOM child expressions without memoized predicates", () => {
    const optional = transform('const view = <div>{state?.dynamic ? "a" : "b"}</div>;', {
      filename: "input.jsx",
      moduleName: "r-dom"
    });
    expect(optional.code).toContain('return state?.dynamic ? "a" : "b";');
    expect(optional.code).toContain("_$insert(_el$, () =>");

    const nested = transform("const view = <div>{state.dynamic ?? <Comp />}</div>;", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });
    expect(nested.code).toContain('import { createComponent as _$createComponent } from "r-dom";');
    expect(nested.code).toContain("return state.dynamic ?? _$createComponent(Comp, {});");
  });

  it("lowers a simple component to createComponent", () => {
    const result = transform('<Child name="Jake" />;', {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { createComponent as _$createComponent } from "r-dom";');
    expect(result.code).toContain('_$createComponent(Child, { name: "Jake" });');
  });

  it("memoizes dynamic conditional component props by default", () => {
    const result = transform("const view = <Comp render={state.dynamic ? good() : bad} />;", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { memo as _$memo } from "r-dom";');
    expect(result.code).toContain("get render()");
    expect(result.code).toContain("_$memo(() =>");
    expect(result.code).toContain("return !!state.dynamic;");
    expect(result.code).toContain("() ? good() : bad");
  });

  it("memoizes dynamic fragment expressions by default", () => {
    const result = transform("const view = <>{state.dynamic}</>;", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { memo as _$memo } from "r-dom";');
    expect(result.code).toContain("const view = _$memo");
    expect(result.code).toContain("return state.dynamic;");
  });

  it("memoizes dynamic entries inside component child arrays", () => {
    const result = transform("const view = <Comp><div />{state.dynamic}</Comp>;", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { memo as _$memo } from "r-dom";');
    expect(result.code).toContain("get children()");
    expect(result.code).toContain("_$memo(() =>");
    expect(result.code).toContain("return state.dynamic;");
  });

  it("pre-evaluates component call refs for applyRef fallback", () => {
    const result = transform("const view = <Child ref={factory()} />;", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { applyRef as _$applyRef } from "r-dom";');
    expect(result.code).toContain("var _ref$ = factory();");
    expect(result.code).toContain("ref(r$)");
    expect(result.code).toContain("_$applyRef(_ref$, r$)");
  });

  it("drops optional component refs without emitting applyRef", () => {
    const result = transform("const view = <Child ref={binding?.[key]} />;", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).not.toContain("_$applyRef");
    expect(result.code).toContain("_$createComponent(Child, {})");
  });

  it("covers the static subset of the Babel simpleElements fixture", () => {
    const result = transform(
      'const template = <div id="main"><style>{"div { color: red; }"}</style><h1>Welcome</h1><label for={"entry"}>Edit:</label><input id="entry" type="text" /></div>;',
      {
        filename: "simpleElements.jsx",
        moduleName: "r-dom"
      }
    );

    expect(result.code).toContain("<style>div { color: red; }</style>");
    expect(result.code).toContain("<h1>Welcome</h1>");
    expect(result.code).toContain("<label for=entry>Edit:</label>");
    expect(result.code).toContain("<input id=entry type=text>");
  });

  it("covers basic textInterpolation dynamic text cases", () => {
    const result = transform("const trailingExpr = <span>Hello {name}</span>;", {
      filename: "textInterpolation.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain("_$template(`<span>Hello `)");
    expect(result.code).toContain("_$insert(_el$, name, null);");
  });

  it("serializes the current static DOM attribute subset", () => {
    const result = transform("<input disabled value={'saved'} maxLength={12} />;", {
      filename: "static-attributes.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain("<input disabled value=saved maxLength=12>");
    expect(result.code).not.toContain("</input>");
  });

  it("compiles the supported simpleElements fixture subset from Babel sources", () => {
    const source = readFixture("simpleElements");
    const subset = source.slice(
      source.indexOf("const template2"),
      source.indexOf("const template3")
    );
    const result = transform(subset, {
      filename: "simpleElements.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain("<span><a></a></span><span>");
  });

  it("compiles the supported textInterpolation fixture subset from Babel sources", () => {
    const source = readFixture("textInterpolation");
    const subset = source
      .split("\n")
      .filter(line => line.startsWith("const trailingExpr"))
      .join("\n");
    const result = transform(subset, {
      filename: "textInterpolation.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain("<span>Hello ");
    expect(result.code).toContain("_$insert(_el$, name, null);");
  });

  it("returns a source map when requested", () => {
    const result = transform("const view = <div>Hello</div>;", {
      filename: "source-map.jsx",
      moduleName: "r-dom",
      sourceMap: true
    });

    expect(result.map).toEqual(expect.any(String));
    expect(JSON.parse(result.map).sources).toContain("source-map.jsx");
  });

  it("accepts Solid-compatible Babel option defaults that do not change output", () => {
    const result = transform("const view = <div>Hello</div>;", {
      filename: "input.jsx",
      moduleName: "r-dom",
      delegateEvents: true,
      delegatedEvents: [],
      requireImportSource: false,
      wrapConditionals: true,
      contextToCustomElements: true,
      staticMarker: "@static",
      effectWrapper: "effect",
      memoWrapper: "memo",
      validate: true,
      inlineStyles: true
    });

    expect(result.code).toContain("_$template(`<div>Hello`)");
  });

  it("supports requireImportSource gating", () => {
    const matching = transform("/** @jsxImportSource r-dom */\nconst view = <div />;", {
      filename: "input.jsx",
      moduleName: "r-dom",
      requireImportSource: "r-dom"
    });
    expect(matching.code).toContain("_$template(`<div>`)");

    const mismatched = "/** @jsxImportSource other */\nconst view = <div />;";
    expect(
      transform(mismatched, {
        filename: "input.jsx",
        moduleName: "r-dom",
        requireImportSource: "r-dom"
      }).code
    ).toBe(mismatched);

    const absent = "const view = <div />;";
    expect(
      transform(absent, {
        filename: "input.jsx",
        moduleName: "r-dom",
        requireImportSource: "r-dom"
      }).code
    ).toBe(absent);
  });

  it("supports custom static markers for component props", () => {
    const result = transform(
      "const view = <Comp value={/*@once*/ state.value} other={state.other} />;",
      {
        filename: "input.jsx",
        moduleName: "r-dom",
        staticMarker: "@once"
      }
    );

    expect(result.code).toContain("value: /*@once*/ state.value");
    expect(result.code).toContain("get other()");
  });

  it("accepts validate false as an output-preserving option", () => {
    const result = transform("<button onClick={() => click()} />", {
      filename: "input.jsx",
      moduleName: "r-dom",
      hydratable: true,
      validate: false
    });

    expect(result.code).toContain("_$runHydrationEvents();");
    expect(result.code).toContain('_$delegateEvents(["click"]);');
  });

  it("supports opting out of delegated DOM events", () => {
    const result = transform("<button onClick={() => increment()} />", {
      filename: "input.jsx",
      moduleName: "r-dom",
      delegateEvents: false
    });

    expect(result.code).not.toContain("_$delegateEvents");
    expect(result.code).not.toContain("$$click");
    expect(result.code).toContain('_el$.addEventListener("click",');
  });

  it("supports adding custom delegated DOM events", () => {
    const result = transform("<button onChange={() => changed()} />", {
      filename: "input.jsx",
      moduleName: "r-dom",
      delegatedEvents: ["change"]
    });

    expect(result.code).toContain('import { delegateEvents as _$delegateEvents } from "r-dom";');
    expect(result.code).toContain("_el$.$$change =");
    expect(result.code).toContain('_$delegateEvents(["change"]);');
  });

  it("supports preserving static attribute quotes", () => {
    const result = transform('<input id="entry" type="text" />', {
      filename: "input.jsx",
      moduleName: "r-dom",
      omitQuotes: false
    });

    expect(result.code).toContain('_$template(`<input id="entry"type="text">`)');
  });

  it("supports preserving spacing between quoted static attributes", () => {
    const result = transform('<input id="entry" type="text" />', {
      filename: "input.jsx",
      moduleName: "r-dom",
      omitQuotes: false,
      omitAttributeSpacing: false
    });

    expect(result.code).toContain('_$template(`<input id="entry" type="text">`)');
  });

  it("supports disabling inline style template serialization", () => {
    const result = transform('<div style="color: red" />', {
      filename: "input.jsx",
      moduleName: "r-dom",
      inlineStyles: false
    });

    expect(result.code).toContain('import { style as _$style } from "r-dom";');
    expect(result.code).toContain('import { effect as _$effect } from "r-dom";');
    expect(result.code).toContain("_$template(`<div>`)");
    // Babel converts JSX string styles to template literals before wrapping.
    expect(result.code).toContain("return `color: red`;");
    expect(result.code).toContain("_$style(_el$, _v$, _$p);");
  });

  it("supports disabling the effect wrapper for dynamic DOM setters", () => {
    const result = transform("<div title={state.title} class={state.className} />", {
      filename: "input.jsx",
      moduleName: "r-dom",
      effectWrapper: false
    });

    expect(result.code).not.toContain("_$effect");
    expect(result.code).toContain('_$setAttribute(_el$, "title", state.title);');
    expect(result.code).toContain("_$className(_el$, state.className);");
  });

  it("supports custom effect and memo wrapper import names", () => {
    const result = transform("<div title={state.title}>{state.cond ? good() : bad}</div>", {
      filename: "input.jsx",
      moduleName: "r-dom",
      effectWrapper: "createRenderEffect",
      memoWrapper: "createMemo"
    });

    expect(result.code).toContain(
      'import { createRenderEffect as _$createRenderEffect } from "r-dom";'
    );
    expect(result.code).toContain('import { createMemo as _$createMemo } from "r-dom";');
    expect(result.code).toContain("_$createRenderEffect(() =>");
    expect(result.code).toContain("_$createMemo(() =>");
    expect(result.code).not.toContain("_$effect");
    expect(result.code).not.toContain("_$memo(");
  });

  it("supports wrapperless condition and memo options as a pair", () => {
    const conditional = transform("<div>{state.dynamic ? good() : bad}</div>", {
      filename: "input.jsx",
      moduleName: "r-dom",
      wrapConditionals: false,
      memoWrapper: false
    });
    expect(conditional.code).not.toContain("_$memo");
    expect(conditional.code).toContain("return state.dynamic ? good() : bad;");
    expect(conditional.code).toContain("_$insert(_el$, () =>");

    const fragment = transform("const view = <>{state.dynamic}</>;", {
      filename: "input.jsx",
      moduleName: "r-dom",
      wrapConditionals: false,
      memoWrapper: false
    });
    expect(fragment.code).toContain("const view = () =>");
    expect(fragment.code).toContain("return state.dynamic;");
    expect(fragment.code).not.toContain("_$memo");
  });

  it("supports unpaired wrapperless condition and memo options", () => {
    // `wrapConditionals: false` alone matches Babel (memo still wraps
    // fragment children).
    const conditional = transform("<div>{state.dynamic ? good() : bad}</div>", {
      filename: "input.jsx",
      moduleName: "r-dom",
      wrapConditionals: false
    });
    expect(conditional.code).toContain("return state.dynamic ? good() : bad;");

    // `memoWrapper: false` alone compiles memo-less in both compilers —
    // conditions keep their hoisted thunk without the memo wrap.
    const fragment = transform("const v = <>{state.dynamic ? good() : bad}</>;", {
      filename: "input.jsx",
      moduleName: "r-dom",
      memoWrapper: false
    });
    expect(fragment.code).not.toContain("_$memo");
  });

  it("skips files without the requireImportSource pragma, verbatim", () => {
    const source = "const view = <div>{x()}</div>;";
    const result = transform(source, {
      filename: "input.jsx",
      moduleName: "r-dom",
      requireImportSource: "my-lib"
    });

    expect(result.code).toBe(source);
    expect(result.map).toBeNull();
  });

  it("transforms files carrying the requireImportSource pragma", () => {
    const source = "/* @jsxImportSource my-lib */\nconst view = <div>{x()}</div>;";
    const result = transform(source, {
      filename: "input.jsx",
      moduleName: "r-dom",
      requireImportSource: "my-lib"
    });

    expect(result.code).toContain("_$template");

    // A different source in the pragma doesn't match.
    const other = transform(source, {
      filename: "input.jsx",
      moduleName: "r-dom",
      requireImportSource: "other-lib"
    });
    expect(other.code).toBe(source);
  });

  it("captures owner context for custom elements by default (Solid/Babel parity)", () => {
    const result = transform("const view = <my-element />;", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { getOwner as _$getOwner } from "r-dom";');
    expect(result.code).toContain("_$template(`<my-element>`, 1)");
    expect(result.code).toContain("_el$._$owner = _$getOwner();");
  });

  it("skips custom element owner context when opted out", () => {
    const result = transform("const view = <my-element />;", {
      filename: "input.jsx",
      moduleName: "r-dom",
      contextToCustomElements: false
    });

    expect(result.code).not.toContain("_$getOwner");
    expect(result.code).not.toContain("_$owner");
    expect(result.code).toContain("_$template(`<my-element>`, 1)");
  });

  it("rejects unknown options before native option conversion", () => {
    expect(() =>
      transform("const view = <div />;", {
        filename: "input.jsx",
        moduleName: "r-dom",
        notARealOption: true
      })
    ).toThrow(/unknown option `notARealOption`/);
  });

  it("rejects unsupported dynamic renderer config instead of ignoring it", () => {
    expect(() =>
      transform("const view = <div />;", {
        filename: "input.jsx",
        moduleName: "r-custom",
        generate: "dynamic",
        renderers: [{ name: "universal", elements: ["div"], moduleName: "r-custom" }]
      })
    ).toThrow(/only support the `dom` renderer override/);

    expect(() =>
      transform("const view = <div />;", {
        filename: "input.jsx",
        moduleName: "r-custom",
        generate: "dynamic",
        renderers: [{ name: "dom", elements: ["div"], moduleName: "r-dom", extra: true }]
      })
    ).toThrow(/unknown renderer option `extra`/);
  });

  it("does not HTML-escape a sole SSR component child; mixed children and element holes do", () => {
    const sole = transform("const view = <Comp>{state.dynamic}</Comp>;", {
      filename: "input.jsx",
      moduleName: "r-server",
      generate: "ssr"
    });
    expect(sole.code).toContain("return state.dynamic;");
    expect(sole.code).not.toContain("_$escape(state.dynamic)");

    const mixed = transform("const view = <Comp><div />{state.dynamic}</Comp>;", {
      filename: "input.jsx",
      moduleName: "r-server",
      generate: "ssr"
    });
    expect(mixed.code).toContain("_$escape(state.dynamic)");

    const element = transform("const view = <div>{state.dynamic}</div>;", {
      filename: "input.jsx",
      moduleName: "r-server",
      generate: "ssr"
    });
    expect(element.code).toContain("_$escape(state.dynamic)");
  });

  it("lowers static native JSX in SSR mode", () => {
    const result = transform('const view = <div id="main"><h1>Hello</h1></div>;', {
      filename: "input.jsx",
      moduleName: "r-server",
      generate: "ssr"
    });

    expect(result.code).toContain('import { ssr as _$ssr } from "r-server";');
    // Templates hoist to module scope like Babel's SSR output.
    expect(result.code).toContain('var _tmpl$ = "<div id=\\"main\\"><h1>Hello</h1></div>";');
    expect(result.code).toContain("const view = _$ssr(_tmpl$);");
  });

  it("scope-wraps deferred hydratable SSR child slots and keeps siblings eager", () => {
    const result = transform(
      `
      function OrderedParent(props) {
        return <section>{props.children}<OrderedSibling /></section>;
      }
      function OrderedSibling() {
        return <span>sibling</span>;
      }
      const view = <OrderedParent><span>child</span></OrderedParent>;
      `,
      {
        filename: "ordered.jsx",
        moduleName: "r-server",
        generate: "ssr",
        hydratable: true
      }
    );

    expect(result.code).toContain("return _$ssr(_tmpl$, _v$, _v$2, _v$3);");
    // The deferred id-allocating hole evaluates under its own owner scope so
    // retry timing can't skew sibling ids...
    expect(result.code).toContain("_$scope(() => {");
    expect(result.code).toContain("return _$escape(props.children);");
    // ...while component siblings stay eager (no orderedInsert thunking).
    expect(result.code).toContain("_$escape(OrderedSibling({}));");
  });

  it("lowers dynamic children in SSR mode through escape", () => {
    const result = transform("const view = <div>Hello {name}</div>;", {
      filename: "input.jsx",
      moduleName: "r-server",
      generate: "ssr"
    });

    expect(result.code).toContain('import { escape as _$escape } from "r-server";');
    expect(result.code).toContain('import { ssr as _$ssr } from "r-server";');
    expect(result.code).toContain('var _tmpl$ = ["<div>Hello ", "</div>"];');
    expect(result.code).toContain("_$ssr(_tmpl$, _v$)");
    expect(result.code).toContain("_$escape(name)");
  });

  it("escapes quotes in template-literal quasis used as SSR style values", () => {
    const result = transform(
      'const view = <div style={{ "background-image": `url("${src}")` }} />;',
      {
        filename: "input.jsx",
        moduleName: "r-server",
        generate: "ssr"
      }
    );

    expect(result.code).toContain("ssrStyleProperty");
    expect(result.code).toContain("url(&quot;");
    expect(result.code).not.toContain('url("${');
  });

  it("lowers DOM spread attributes through spread and mergeProps", () => {
    const result = transform('<div id="main" {...props} title={title()} />', {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { spread as _$spread } from "r-dom";');
    expect(result.code).toContain('import { mergeProps as _$mergeProps } from "r-dom";');
    expect(result.code).toContain("_$spread(");
    expect(result.code).toContain("_$mergeProps(");
    expect(result.code).toContain('id: "main"');
    expect(result.code).toContain("get title()");
  });

  it("lowers plain dynamic DOM attributes through effect and setAttribute", () => {
    const result = transform("<div title={title()} />", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { effect as _$effect } from "r-dom";');
    expect(result.code).toContain('import { setAttribute as _$setAttribute } from "r-dom";');
    expect(result.code).toContain("_$template(`<div>`)");
    expect(result.code).toContain("_$effect(() => title(),");
    expect(result.code).toContain('_$setAttribute(_el$, "title", _v$);');
  });

  it("lowers delegated inline event handlers and registers delegated events", () => {
    const result = transform("<button onClick={() => increment()} />", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { delegateEvents as _$delegateEvents } from "r-dom";');
    expect(result.code).toContain("_el$.$$click =");
    expect(result.code).toContain("increment();");
    expect(result.code).toContain('_$delegateEvents(["click"]);');
  });

  it("registers delegated events for member expression handlers", () => {
    const result = transform("<button onClick={counter.increment} />", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { addEvent as _$addEvent } from "r-dom";');
    expect(result.code).toContain('import { delegateEvents as _$delegateEvents } from "r-dom";');
    expect(result.code).toContain('_$addEvent(_el$, "click", counter.increment, true);');
    expect(result.code).toContain('_$delegateEvents(["click"]);');
  });

  it("replays queued hydration events for hydratable delegated handlers", () => {
    const result = transform("<button onClick={() => click()} />", {
      filename: "input.jsx",
      moduleName: "r-dom",
      hydratable: true
    });

    expect(result.code).toContain(
      'import { runHydrationEvents as _$runHydrationEvents } from "r-dom";'
    );
    expect(result.code).toContain("_$runHydrationEvents();");
    expect(result.code).toContain('_$delegateEvents(["click"]);');
  });

  it("lowers native inline event handlers with addEventListener", () => {
    const result = transform("<button onChange={() => changed()} />", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('_el$.addEventListener("change",');
    expect(result.code).toContain("changed()");
    expect(result.code).not.toContain("_$delegateEvents");
  });

  it("treats namespaced event attributes like Babel after the event update", () => {
    // The `on:`/`oncapture:` namespaces were removed on this branch; Babel's
    // `key.startsWith("on")` branch now sees the raw namespaced key.
    const result = transform("<button on:click={() => increment()} />", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('_el$.addEventListener(":click",');
    expect(result.code).not.toContain("_$delegateEvents");
  });

  it("lowers known namespaced DOM attributes through setAttributeNS", () => {
    const result = transform("<a xlink:href={url} />", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { setAttributeNS as _$setAttributeNS } from "r-dom";');
    expect(result.code).toContain(
      '_$setAttributeNS(_el$, "http://www.w3.org/1999/xlink", "xlink:href", url);'
    );
  });

  it("lowers unknown namespaced DOM attributes through setAttribute", () => {
    const result = transform("<div foo:bar={value()} />", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('_$setAttribute(_el$, "foo:bar", _v$);');
  });

  it("lowers prop:* DOM attributes as property assignments", () => {
    const result = transform('<div prop:htmlFor={thing} prop:number={123} prop:title="Hi" />', {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain("_el$.htmlFor = thing;");
    expect(result.code).toContain("_el$.number = 123;");
    expect(result.code).toContain('_el$.title = "Hi";');
    expect(result.code).not.toContain("prop:htmlFor");
  });

  it("lowers DOM refs with runtime ref helper or assignment fallback", () => {
    const functionRef = transform("<div ref={el => register(el)} />", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });
    expect(functionRef.code).toContain('import { ref as _$ref } from "r-dom";');
    expect(functionRef.code).toContain("_$ref(() => {");
    expect(functionRef.code).toContain("return (el) => register(el);");

    const identifierRef = transform("<div ref={target} />", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });
    expect(identifierRef.code).toContain("var _ref$ = target;");
    expect(identifierRef.code).toContain('typeof _ref$ === "function" || Array.isArray(_ref$)');
    expect(identifierRef.code).toContain("target = _el$");
  });

  it("lowers computed-member DOM refs with assignment fallback", () => {
    const result = transform("<div ref={foo[key]} />", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain("var _ref$ = foo[key];");
    expect(result.code).toContain("foo[key] = _el$");
  });

  it("lowers call-expression DOM refs without assignment fallback", () => {
    const result = transform("<div ref={refFactory()} />", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain("var _ref$ = refFactory();");
    expect(result.code).toContain("&& _$ref(() => {");
    expect(result.code).toContain("return _ref$;");
  });

  it("lowers child-property dynamic DOM attributes through effects", () => {
    const result = transform("<div textContent={label()} />", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    // Dynamic textContent writes to a dedicated placeholder text node's
    // `data` (Babel parity), not the element's textContent.
    expect(result.code).toContain('import { effect as _$effect } from "r-dom";');
    expect(result.code).toContain("_$template(`<div> `)");
    expect(result.code).toContain("var _el$2 = _el$.firstChild;");
    expect(result.code).toContain("_el$2.data = _v$;");
  });

  it("lowers dynamic style attributes through the style helper", () => {
    const result = transform("<div style={someStyle()} />", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { style as _$style } from "r-dom";');
    expect(result.code).toContain("_$style(_el$, _v$, _$p);");
  });

  it("lowers dynamic style object entries through setStyleProperty", () => {
    const result = transform(
      '<div style={{ background: "red", color: "green", border: signal() }} />',
      {
        filename: "input.jsx",
        moduleName: "r-dom"
      }
    );

    expect(result.code).toContain(
      'import { setStyleProperty as _$setStyleProperty } from "r-dom";'
    );
    expect(result.code).toContain("style=background:red;color:green");
    expect(result.code).toContain("_$effect(");
    expect(result.code).toContain('_$setStyleProperty(_el$, "border", _v$);');
  });

  it("lowers non-reactive style object entries without effects", () => {
    const result = transform(
      '<div style={{ background: "red", color: "green", border: somevalue }} />',
      {
        filename: "input.jsx",
        moduleName: "r-dom"
      }
    );

    expect(result.code).toContain('_$setStyleProperty(_el$, "border", somevalue);');
    expect(result.code).not.toContain("_$effect(");
  });

  it("folds static class arrays into the template", () => {
    const result = transform(
      '<button class={["static", { hi: "k" }]} type="button">Write</button>',
      {
        filename: "input.jsx",
        moduleName: "r-dom"
      }
    );

    expect(result.code).toContain('class="static hi"');
    expect(result.code).toContain("type=button");
    expect(result.code).not.toContain("_$className");
    expect(result.code).not.toContain("classList.toggle");
  });

  it("lowers dynamic class array object entries as classList toggles", () => {
    const result = transform('<div class={["todo", { active: isActive() }]} />', {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain("class=todo");
    expect(result.code).toContain("_$effect(");
    expect(result.code).toContain('_el$.classList.toggle("active", _v$);');
  });

  it("falls back to className helper for arbitrary class array entries", () => {
    const result = transform('<div class={["todo", props.active]} />', {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('import { className as _$className } from "r-dom";');
    expect(result.code).toContain("_$className(_el$, _v$, _$p);");
  });

  it("lowers static child-property DOM attributes as assignments", () => {
    const result = transform('<div innerHTML="<span />" />', {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('_el$.innerHTML = "<span />";');
  });

  it("rejects DOM state dynamic attributes using shared constants", () => {
    const result = transform('<input type="checkbox" checked={visible()} />', {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain("_el$.checked = _v$;");
  });

  it("lowers text-only fragments in the current milestone", () => {
    const result = transform("<>Hello</>", {
      filename: "input.jsx",
      moduleName: "r-dom"
    });

    expect(result.code).toContain('("Hello");');
  });

  it.each(["dom", "ssr", "universal"])(
    "lowers 12 nested component scopes without re-walking each body (%s)",
    generate => {
      let jsx = "<span>{x}</span>";
      for (let i = 0; i < 12; i++) jsx = `<Box a={${i}}>${jsx}</Box>`;

      const start = process.hrtime.bigint();
      const result = transform(`const C = x => (${jsx});`, {
        filename: "input.jsx",
        moduleName: "r-dom",
        generate
      });
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

      expect(result.code).toContain("Box");
      expect(elapsedMs).toBeLessThan(100);
    }
  );
});
