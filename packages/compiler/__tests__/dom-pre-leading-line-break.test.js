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
const aliases = server =>
  new Map([
    [
      "@solidjs/web",
      path.join(repoRoot, "packages/web/src", server ? "index.server.ts" : "index.ts")
    ],
    [
      "solid-js",
      path.join(repoRoot, "packages/solid/src", server ? "server/index.ts" : "index.ts")
    ],
    ["solid-js/internal", path.join(repoRoot, "packages/solid/src/internal.ts")],
    ["@solidjs/signals", path.join(repoRoot, "packages/signals/src/index.ts")]
  ]);

const source = `
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
export { flush };

const [value, setValue] = createSignal("x");
export { setValue };

const views = {
  lineBreak: () => <pre>{"\\n"}<b>{value()}</b></pre>,
  entity: () => <pre>&#10;<button onClick={() => setValue("clicked")}>{value()}</button></pre>,
  lineBreakAroundValue: () => <pre>{"\\n"}{value()}{"\\n"}</pre>
};

export function mount(root, view) {
  setValue("x");
  return render(views[view], root);
}
`;

const hydrationViews = `
import { createSignal, flush } from "solid-js";
export { flush };

const [value, setValue] = createSignal("x");
export { setValue };

export const views = {
  carriageReturnThenLineBreakEntity: () => <pre>{"\\r"}&#10;<b>{value()}</b></pre>,
  lineBreakAroundValue: () => <pre>{"\\n"}{value()}{"\\n"}</pre>
};
`;

async function loadModule(code, server = false) {
  const result = await build({
    stdin: { contents: code, resolveDir: compilerDir, sourcefile: "pre-leading-line-break.js" },
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
            args => ({ path: aliases(server).get(args.path) })
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
  delete globalThis.Solid$$;
  const mod = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    require,
    mod,
    mod.exports
  );
  return mod.exports;
}

function compile(compiler, hydratable, code = source, generate = "dom") {
  const options = { moduleName: "@solidjs/web", generate, hydratable };
  return compiler === "babel"
    ? compileBabel(code, options, "pre-leading-line-break.jsx")
    : compileOxc(code, "pre-leading-line-break", options);
}

afterEach(() => {
  document.body.textContent = "";
  delete globalThis.Solid$$;
  delete globalThis._$HY;
});

afterAll(() => {
  Object.assign(globalThis, environmentEncoding);
});

describe.each(["babel", "oxc"])("%s", compiler => {
  describe.each([false, true])("hydratable=%s", hydratable => {
    const code = compile(compiler, hydratable);
    let runtime;
    beforeEach(async () => {
      runtime = await loadModule(code);
    });

    function mount(view) {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const dispose = runtime.mount(root, view);
      runtime.flush();
      return { pre: root.querySelector("pre"), dispose };
    }

    test("a lone line break before an element leaves the element walk intact", () => {
      const { pre, dispose } = mount("lineBreak");
      try {
        expect(pre.textContent).toBe("x");
        runtime.setValue("z");
        runtime.flush();
        expect(pre.querySelector("b").textContent).toBe("z");
      } finally {
        dispose();
      }
    });

    test("an entity line break before an element keeps its handler attached", () => {
      const { pre, dispose } = mount("entity");
      try {
        pre.querySelector("button").click();
        runtime.flush();
        expect(pre.querySelector("button").textContent).toBe("clicked");
      } finally {
        dispose();
      }
    });

    test("a line break after a value survives the dropped leading line break", () => {
      const { pre, dispose } = mount("lineBreakAroundValue");
      try {
        runtime.setValue("z");
        runtime.flush();
        expect(pre.textContent).toBe("z\n");
      } finally {
        dispose();
      }
    });
  });
});

describe.each(["babel", "oxc"])("%s hydration", compiler => {
  test.each([
    ["carriageReturnThenLineBreakEntity", "\nz"],
    ["lineBreakAroundValue", "z\n"]
  ])("%s keeps the text node the parser keeps", async (view, text) => {
    const server = await loadModule(
      compile(
        compiler,
        true,
        `export { renderToString } from "@solidjs/web";${hydrationViews}`,
        "ssr"
      ),
      true
    );
    const client = await loadModule(
      compile(compiler, true, `export { hydrate } from "@solidjs/web";${hydrationViews}`)
    );
    const root = document.createElement("div");
    document.body.appendChild(root);
    root.innerHTML = server.renderToString(server.views[view]);
    globalThis._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const dispose = client.hydrate(client.views[view], root);
    try {
      client.setValue("z");
      client.flush();
      expect(root.querySelector("pre").textContent).toBe(text);
    } finally {
      dispose();
    }
  });
});
