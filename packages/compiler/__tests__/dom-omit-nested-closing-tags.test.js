/**
 * @vitest-environment jsdom
 */

const fs = require("fs");
const path = require("path");
const { TextDecoder, TextEncoder } = require("util");

const environmentEncoding = {
  TextEncoder: globalThis.TextEncoder,
  TextDecoder: globalThis.TextDecoder,
  Uint8Array: globalThis.Uint8Array
};
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
globalThis.Uint8Array = new TextEncoder().encode("").constructor;
const { build } = require("esbuild");
const { compileBabel, compileOxc } = require("./parity/harness");

const compilerDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(compilerDir, "../..");
const workspaceSourceRoots = ["solid", "web", "signals"].map(
  name => path.join(repoRoot, "packages", name, "src") + path.sep
);
const aliases = new Map([
  ["@solidjs/web", path.join(repoRoot, "packages/web/src/index.ts")],
  ["solid-js", path.join(repoRoot, "packages/solid/src/index.ts")],
  ["solid-js/internal", path.join(repoRoot, "packages/solid/src/internal.ts")],
  ["@solidjs/signals", path.join(repoRoot, "packages/signals/src/index.ts")]
]);

const source = `
import { render } from "@solidjs/web";
import { createSignal } from "solid-js";

const [value] = createSignal("ready");

const views = {
  form: () => (
    <div>
      <form>
        <label>
          Name <input />
        </label>
      </form>
      <p>{value()}</p>
    </div>
  ),
  twoForms: () => (
    <div>
      <section>
        <form>
          <input />
        </form>
      </section>
      <form>
        <button>{value()}</button>
      </form>
    </div>
  ),
  customElement: () => (
    <div>
      <my-card>
        <div>body</div>
      </my-card>
      <p>{value()}</p>
    </div>
  ),
  legend: () => (
    <fieldset>
      <legend>
        <h2>Title</h2>
      </legend>
      <p>{value()}</p>
    </fieldset>
  ),
  nestedList: () => (
    <ul>
      <li>
        Docs
        <ul>
          <li>Intro</li>
        </ul>
      </li>
      <li>{value()}</li>
    </ul>
  ),
  foreignObject: () => (
    <div>
      <div>
        <svg>
          <foreignObject>
            <div>x</div>
          </foreignObject>
        </svg>
      </div>
      <p>{value()}</p>
    </div>
  ),
  mathText: () => (
    <div>
      <p>
        <math>
          <mtext>
            <span>x</span>
          </mtext>
        </math>
      </p>
      <p>{value()}</p>
    </div>
  ),
  lowercaseForeignObject: () => (
    <div>
      <p>
        <svg>
          <foreignobject>
            <span>x</span>
          </foreignobject>
        </svg>
      </p>
      <p>{value()}</p>
    </div>
  )
};

export function mount(root, view) {
  return render(views[view], root);
}
`;

const rendered = {
  form: "<div><form><label>Name <input></label></form><p>ready</p></div>",
  twoForms: "<div><section><form><input></form></section><form><button>ready</button></form></div>",
  customElement: "<div><my-card><div>body</div></my-card><p>ready</p></div>",
  legend: "<fieldset><legend><h2>Title</h2></legend><p>ready</p></fieldset>",
  nestedList: "<ul><li>Docs<ul><li>Intro</li></ul></li><li>ready</li></ul>",
  foreignObject:
    "<div><div><svg><foreignObject><div>x</div></foreignObject></svg></div><p>ready</p></div>",
  mathText: "<div><p><math><mtext><span>x</span></mtext></math></p><p>ready</p></div>",
  lowercaseForeignObject:
    "<div><p><svg><foreignObject><span>x</span></foreignObject></svg></p><p>ready</p></div>"
};

async function loadModule(code) {
  const result = await build({
    stdin: { contents: code, resolveDir: compilerDir, sourcefile: "omit-nested-closing-tags.js" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    minifySyntax: true,
    write: false,
    define: { __DEV__: "false", __OBSERVE__: "false", __TEST__: "false" },
    plugins: [
      {
        name: "workspace-runtime-sources",
        setup(esbuild) {
          esbuild.onResolve(
            { filter: /^(?:@solidjs\/web|solid-js(?:\/internal)?|@solidjs\/signals)$/ },
            args => ({ path: aliases.get(args.path) })
          );
          esbuild.onLoad({ filter: /\.ts$/ }, args => {
            if (!workspaceSourceRoots.some(root => args.path.startsWith(root))) return;
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

afterEach(() => {
  document.body.textContent = "";
});

afterAll(() => {
  Object.assign(globalThis, environmentEncoding);
});

describe.each(["babel", "oxc"])("%s with omitNestedClosingTags", compiler => {
  const options = { moduleName: "@solidjs/web", generate: "dom", omitNestedClosingTags: true };
  const code =
    compiler === "babel"
      ? compileBabel(source, options, "omit-nested-closing-tags.jsx")
      : compileOxc(source, "omit-nested-closing-tags", options);
  let runtime;
  beforeAll(async () => {
    runtime = await loadModule(code);
  });

  test.each(Object.entries(rendered))(
    "%s renders the tree the full template parses to",
    (view, html) => {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const dispose = runtime.mount(root, view);
      try {
        expect(root.innerHTML).toBe(html);
      } finally {
        dispose();
      }
    }
  );
});
