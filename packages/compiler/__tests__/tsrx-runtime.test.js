/**
 * @vitest-environment jsdom
 */

const fs = require("fs");
const path = require("path");
const { TextDecoder, TextEncoder } = require("util");

// jsdom supplies realm-local encoding globals whose Uint8Array fails
// esbuild's host-realm invariant check.
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
const runtimeFixtureRoot = path.join(
  repoRoot,
  "packages/babel-plugin/test/__tsrx_runtime_fixtures__"
);
const builtIns = ["For", "Show", "Switch", "Match", "Errored", "Loading", "Dynamic"];

function readRuntimeFixture(mode) {
  return fs.readFileSync(path.join(runtimeFixtureRoot, mode, "code.tsrx"), "utf8");
}

function compileRuntime(source, compiler, generate) {
  const options = {
    moduleName: "@solidjs/web",
    builtIns,
    generate,
    wrapConditionals: true,
    contextToCustomElements: true,
    requireImportSource: false
  };
  return compiler === "babel"
    ? compileBabel(source, options, `${generate}-runtime.tsrx`)
    : compileOxc(source, `${generate}-runtime`, options, ".tsrx");
}

async function loadRuntimeModule(code, generate) {
  const aliases = new Map([
    [
      "@solidjs/web",
      path.join(repoRoot, "packages/web/src", generate === "ssr" ? "index.server.ts" : "index.ts")
    ],
    ["solid-js", path.join(repoRoot, "packages/solid/src/index.ts")],
    ["@solidjs/signals", path.join(repoRoot, "packages/signals/src/index.ts")]
  ]);
  const result = await build({
    stdin: {
      contents: code,
      resolveDir: compilerDir,
      sourcefile: `${generate}-runtime.js`
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    write: false,
    define: {
      __DEV__: "false",
      __TEST__: "false"
    },
    plugins: [
      {
        name: "workspace-runtime-sources",
        setup(esbuild) {
          esbuild.onResolve({ filter: /^(?:@solidjs\/web|solid-js|@solidjs\/signals)$/ }, args => ({
            path: aliases.get(args.path)
          }));
        }
      }
    ]
  });

  // Each generated module bundles an isolated runtime copy. Reset the dev
  // duplicate-instance sentinel so running Babel and Oxc side by side does
  // not produce a false warning.
  delete globalThis.Solid$$;
  const runtimeModule = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    require,
    runtimeModule,
    runtimeModule.exports
  );
  return runtimeModule.exports;
}

afterEach(() => {
  document.body.textContent = "";
  delete globalThis.Solid$$;
});

afterAll(() => {
  Object.assign(globalThis, environmentEncoding);
});

describe.each(["babel", "oxc"])("%s TSRX runtime behavior", compiler => {
  test("updates keyed DOM rows, events, control flow, and lazy write targets", async () => {
    const source = readRuntimeFixture("dom");
    const runtime = await loadRuntimeModule(compileRuntime(source, compiler, "dom"), "dom");
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = runtime.mount(root);

    const button = root.querySelector("button");
    expect(button.textContent).toBe("Count: 0");
    expect(root.querySelector(".status").textContent).toBe("idle");
    expect([...root.querySelectorAll("li")].map(node => node.textContent)).toEqual(["one", "two"]);

    button.click();
    runtime.settle();
    expect(button.textContent).toBe("Count: 1");
    expect(root.querySelector(".status").textContent).toBe("active");

    const retained = root.querySelector('[data-id="2"]');
    runtime.replaceRows([
      { id: 2, label: "TWO" },
      { id: 3, label: "three" }
    ]);
    expect(root.querySelector('[data-id="2"]')).toBe(retained);
    expect([...root.querySelectorAll("li")].map(node => node.textContent)).toEqual([
      "TWO",
      "three"
    ]);

    runtime.replaceRows([]);
    expect(root.querySelector("li.empty").textContent).toBe("empty");

    expect(runtime.modelVersion()).toBe(0);
    expect(runtime.bumpVersion()).toBe(1);
    expect(runtime.modelVersion()).toBe(1);

    dispose();
  });

  test("renders SSR branches, keyed lists, and empty fallbacks", async () => {
    const source = readRuntimeFixture("ssr");
    const runtime = await loadRuntimeModule(compileRuntime(source, compiler, "ssr"), "ssr");

    expect(
      runtime.renderPage({
        show: true,
        items: [
          { id: 1, label: "one" },
          { id: 2, label: "two" }
        ]
      })
    ).toBe("<main><ul><li>one</li><li>two</li></ul></main>");
    expect(runtime.renderPage({ show: true, items: [] })).toBe(
      "<main><ul><li>empty</li></ul></main>"
    );
    expect(runtime.renderPage({ show: false, items: [] })).toBe("<main><p>hidden</p></main>");
  });
});
