const fs = require("fs");
const path = require("path");
const { build } = require("esbuild");
const { compileBabel, compileOxc } = require("./parity/harness");

const repoRoot = path.resolve(__dirname, "../../..");
const source = `
import { renderToString, slotValue, SLOT_FACE_DATA } from "@solidjs/web";
export { renderToString };
export const slot = () => slotValue("row", "value", "filled", SLOT_FACE_DATA);
export const App = p => <div style={p.style} class={p.class} title={p.title} />;
export const Calls = p => <div style={p.style()} class={p.class()} />;
export const Nulls = () => <div style={null} class={undefined} />;
export const Statics = () => <div style={false} class="" />;
export const Objects = p => <div style={{ color: p.color }} class={{ active: p.active }} />;
export const SpreadObjects = p => <div style={{ ...p.style }} class={{ ...p.class }} />;
`;

// Execute the generated JSX against the real workspace SSR runtime. Bundle
// in memory so this suite does not depend on published or stale runtime builds.
async function loadRuntime(code, generate = "ssr") {
  const aliases = {
    "@solidjs/web": `packages/web/src/${generate === "ssr" ? "index.server.ts" : "index.ts"}`,
    "solid-js": `packages/solid/src/${generate === "ssr" ? "server/index.ts" : "index.ts"}`,
    "solid-js/internal": "packages/solid/src/internal.ts",
    "@solidjs/signals": "packages/signals/src/index.ts"
  };
  const result = await build({
    stdin: { contents: code, resolveDir: repoRoot, sourcefile: "nullish-ssr.js" },
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    minifySyntax: true,
    define: { __DEV__: "false", __OBSERVE__: "false", __TEST__: "false" },
    plugins: [
      {
        name: "workspace-ssr-runtime",
        setup(esbuild) {
          esbuild.onResolve(
            { filter: /^(?:@solidjs\/web|solid-js(?:\/internal)?|@solidjs\/signals)$/ },
            args => ({ path: path.join(repoRoot, aliases[args.path]) })
          );
          esbuild.onLoad({ filter: /\.ts$/ }, args => {
            if (!args.path.startsWith(path.join(repoRoot, "packages") + path.sep)) return;
            return {
              contents: fs
                .readFileSync(args.path, "utf8")
                .replaceAll('"_SOLID_DEV_"', "false")
                .replaceAll('"_SOLID_OBSERVE_"', "false"),
              loader: "ts"
            };
          });
        }
      }
    ]
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    require,
    mod,
    mod.exports
  );
  return mod.exports;
}

for (const compiler of ["babel", "oxc"]) {
  for (const hydratable of [false, true]) {
    for (const serverComponents of [false, true]) {
      describe(`${compiler}, hydratable=${hydratable}, serverComponents=${serverComponents}`, () => {
        let runtime;
        beforeAll(async () => {
          const options = {
            moduleName: "@solidjs/web",
            generate: "ssr",
            hydratable,
            serverComponents
          };
          const code =
            compiler === "babel"
              ? compileBabel(source, options)
              : compileOxc(source, "nullish-attributes", options);
          runtime = await loadRuntime(code);
        });
        const render = (name, props = {}) => runtime.renderToString(() => runtime[name](props));
        const div = attrs => `<div${hydratable ? " _hk=0" : ""}${attrs}></div>`;

        test.each([undefined, null])("omits nullish dynamic attributes: %s", value => {
          expect(render("App", { style: value, class: value, title: value })).toBe(div(""));
        });
        test("omits literal null and undefined", () => {
          expect(render("Nulls")).toBe(div(""));
        });
        test.each([false, "", {}, { color: null }])("preserves present empty values: %j", value => {
          expect(render("App", { style: value, class: value })).toBe(div(' style="" class=""'));
        });
        test("preserves static literals and object paths", () => {
          expect(render("Statics")).toBe(div(" class"));
          expect(render("Objects", { color: "red", active: true })).toBe(
            div(' style="color:red" class="active"')
          );
          expect(render("Objects")).toBe(div(' style="" class=""'));
          expect(render("SpreadObjects")).toBe(div(' style="" class=""'));
        });
        test("escapes strings and object keys once", () => {
          expect(render("App", { style: 'color:"red"&', class: 'a"&', title: 't"&' })).toBe(
            div(' style="color:&quot;red&quot;&amp;" class="a&quot;&amp;" title="t&quot;&amp;"')
          );
          expect(render("App", { style: { 'x"': "<&" }, class: { 'a"&': true } })).toBe(
            div(' style="x&quot;:&lt;&amp;" class="a&quot;&amp;"')
          );
          expect(
            render("App", { style: { color: "red" }, class: ["a", { b: true, c: false }] })
          ).toBe(div(' style="color:red" class="a b"'));
        });
        test("evaluates each getter and call once, in attribute order", () => {
          const reads = [];
          expect(
            render("App", {
              get style() {
                reads.push("style");
                return null;
              },
              get class() {
                reads.push("class");
                return "a";
              },
              get title() {
                reads.push("title");
                return undefined;
              }
            })
          ).toBe(div(' class="a"'));
          expect(reads).toEqual(["style", "class", "title"]);
          reads.length = 0;
          expect(
            render("Calls", {
              style() {
                reads.push("style");
                return undefined;
              },
              class() {
                reads.push("class");
                return "a";
              }
            })
          ).toBe(div(' class="a"'));
          expect(reads).toEqual(["style", "class"]);
        });
        test("keeps binding-slot behavior tied to serverComponents", () => {
          const value = runtime.slot();
          const html = render("App", { style: value, class: value });
          if (serverComponents) {
            expect(html).toContain('_s:style="row:value"');
            expect(html).toContain('_s:class="row:value"');
          } else {
            expect(html).toBe(div(' style="" class=""'));
            expect(render("Objects", { color: value, active: value })).toBe(
              div(' style="" class="active"')
            );
          }
        });
      });
    }
  }

  test(`${compiler} hydrates the existing node without adding nullish attributes`, async () => {
    const { JSDOM } = require("jsdom");
    const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
    const names = [
      "window",
      "document",
      "Node",
      "Element",
      "HTMLElement",
      "SVGElement",
      "MutationObserver",
      "_$HY",
      "Solid$$"
    ];
    const descriptors = new Map(
      names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
    );
    try {
      for (const name of names) {
        Object.defineProperty(globalThis, name, {
          configurable: true,
          writable: true,
          value: dom.window[name]
        });
      }
      const app = "export const App = p => <div style={p.style} class={p.class} />;";
      const compile = (code, generate) => {
        const options = { moduleName: "@solidjs/web", generate, hydratable: true };
        return compiler === "babel"
          ? compileBabel(code, options)
          : compileOxc(code, "nullish-hydration", options);
      };
      const server = await loadRuntime(
        compile('export { renderToString } from "@solidjs/web";' + app, "ssr")
      );
      const client = await loadRuntime(
        compile('export { hydrate } from "@solidjs/web";' + app, "dom"),
        "dom"
      );
      const props = { style: undefined, class: null };
      const root = document.getElementById("root");
      root.innerHTML = server.renderToString(() => server.App(props));
      const node = root.firstChild;
      globalThis._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
      const dispose = client.hydrate(() => client.App(props), root);
      try {
        expect(root.firstChild).toBe(node);
        expect(node.hasAttribute("style")).toBe(false);
        expect(node.hasAttribute("class")).toBe(false);
      } finally {
        dispose();
      }
    } finally {
      dom.window.close();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    }
  });
}
