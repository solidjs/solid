/**
 * Removed Solid 1.x attribute forms (#4187).
 *
 * `on:`, `oncapture:`, `attr:`, `bool:`, `use:` and `classList` used to
 * compile silently into literal attributes. On native elements of the web
 * generates (`dom` / `ssr`) they are now a compile error naming the 2.0
 * replacement. Supported namespaces (`prop:`, the XML ones), components and
 * the universal generate are unaffected. The native compiler raises the same
 * messages (packages/compiler/__tests__/removed-namespaces-parity.test.js).
 */
const babel = require("@babel/core");
const plugin = require("../index");

const compile = (src, options = {}) =>
  babel.transformSync(src, {
    plugins: [[plugin, { generate: "dom", ...options }]],
    configFile: false,
    babelrc: false,
    // Plain code frames: CI forces color, which puts escape codes in the frame.
    highlightCode: false,
    filename: "removed.jsx"
  });

const webModes = {
  dom: { generate: "dom" },
  "dom hydratable": { generate: "dom", hydratable: true },
  ssr: { generate: "ssr" },
  "ssr hydratable": { generate: "ssr", hydratable: true }
};

const errors = {
  "on:": [
    "const v = <button on:click={() => {}} />;",
    "`on:click` on <button> uses the `on:` namespace, which was removed in Solid 2.0. Use a camelCase handler such as `onClick={handler}` for Solid events, or a `ref` callback that calls `addEventListener` for listener options or custom event names."
  ],
  "oncapture:": [
    "const v = <div oncapture:click={f} />;",
    "`oncapture:click` on <div> uses the `oncapture:` namespace, which was removed in Solid 2.0."
  ],
  "attr:": [
    'const v = <div attr:foo="x" />;',
    "`attr:foo` on <div> uses the `attr:` namespace, which was removed in Solid 2.0. Attributes are the default in 2.0: write `foo={value}` (or `prop:foo` to set a DOM property)."
  ],
  "bool:": [
    "const v = <div bool:hidden={true} />;",
    "`bool:hidden` on <div> uses the `bool:` namespace, which was removed in Solid 2.0. Boolean values add or remove the attribute in 2.0: write `hidden={condition}`."
  ],
  "use:": [
    "const v = <div use:tip={tip} />;",
    "`use:tip` on <div> uses the `use:` namespace, which was removed in Solid 2.0. Use a `ref` directive factory instead: `ref={tip(options)}`, or `ref={tip}` without options; arrays compose (`ref={[a, b]}`)."
  ],
  classList: [
    "const v = <div classList={{ active: true }} />;",
    '`classList` on <div> was removed in Solid 2.0. Use `class` with an object or array instead: `class={{ active: isActive() }}` or `class={["base", { active: isActive() }]}`.'
  ],
  "nested static child": [
    "const v = <div>\n  <p><span use:tip /></p>\n</div>;",
    "`use:tip` on <span> uses the `use:` namespace"
  ],
  "nested dynamic child": [
    "const v = <div>{x()}<span bool:hidden={h()}>{y()}</span></div>;",
    "`bool:hidden` on <span> uses the `bool:` namespace"
  ],
  "beside a spread": [
    "const v = <div {...props} on:click={f} />;",
    "`on:click` on <div> uses the `on:` namespace"
  ],
  "custom element": [
    "const v = <my-el attr:plain={p()} />;",
    "`attr:plain` on <my-el> uses the `attr:` namespace"
  ],
  "svg child": [
    "const v = <svg><rect use:tip /></svg>;",
    "`use:tip` on <rect> uses the `use:` namespace"
  ],
  "native child of a component": [
    "const v = <Comp><div classList={c()} /></Comp>;",
    "`classList` on <div> was removed in Solid 2.0."
  ]
};

const accepted = [
  "const v = <input prop:value={v()} />;",
  'const v = <svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a" /></svg>;',
  'const v = <div xml:lang="en" />;',
  "const v = <div class={{ active: a() }} onClick={f} ref={r} />;",
  'const v = <div classlist="x" onclick="go()" />;',
  'const v = <Comp on:click={f} use:tip={t} attr:x="1" bool:y classList={c} />;'
];

describe("removed 1.x attribute forms are compile errors (#4187)", () => {
  for (const [mode, options] of Object.entries(webModes)) {
    describe(mode, () => {
      for (const [name, [src, message]] of Object.entries(errors)) {
        test(name, () => {
          expect(() => compile(src, options)).toThrow(message);
        });
      }
      test.each(accepted)("accepts %s", src => {
        expect(() => compile(src, options)).not.toThrow();
      });
    });
  }

  test("the error points at the attribute", () => {
    expect(() => compile("const v = <div\n  use:tip={tip}\n/>;")).toThrow(
      /> 2 \|\s+use:tip=\{tip\}\n\s+\|\s+\^/
    );
  });

  test("the universal generate leaves attribute names to the renderer", () => {
    expect(() =>
      compile("const v = <node use:tip={t} classList={c} on:click={f} />;", {
        generate: "universal"
      })
    ).not.toThrow();
  });
});
