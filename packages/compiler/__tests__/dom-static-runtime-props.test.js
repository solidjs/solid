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

const views = {
  selectValue: () => (
    <div>
      <span />
      <select value="b">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
    </div>
  ),
  optionSelected: () => (
    <select>
      <option value="a">A</option>
      <option value="b" selected defaultSelected>B</option>
    </select>
  ),
  inputValue: () => (
    <div>
      <input value="a" />
      <input value="x" defaultValue="y" />
    </div>
  ),
  inputChecked: () => (
    <div>
      <input type="checkbox" />
      <input type="checkbox" checked defaultChecked />
    </div>
  ),
  videoMuted: () => (
    <div>
      <span />
      <video muted defaultMuted />
    </div>
  )
};

export function mount(root, view) {
  return render(views[view], root);
}
`;

const styleSource = `
import { render } from "@solidjs/web";

export function mount(root) {
  return render(
    () => (
      <div>
        <span />
        <p style="color: red" />
      </div>
    ),
    root
  );
}
`;

async function loadModule(code) {
  const result = await build({
    stdin: { contents: code, resolveDir: compilerDir, sourcefile: "static-runtime-props.js" },
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
  delete globalThis.Solid$$;
  const mod = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    require,
    mod,
    mod.exports
  );
  return mod.exports;
}

function compile(compiler, hydratable, code = source, extra = {}) {
  const options = { moduleName: "@solidjs/web", generate: "dom", hydratable, ...extra };
  return compiler === "babel"
    ? compileBabel(code, options, "static-runtime-props.jsx")
    : compileOxc(code, "static-runtime-props", options);
}

afterEach(() => {
  document.body.textContent = "";
  delete globalThis.Solid$$;
});

afterAll(() => {
  Object.assign(globalThis, environmentEncoding);
});

describe.each(["babel", "oxc"])("%s", compiler => {
  describe.each([false, true])("hydratable=%s", hydratable => {
    let runtime;
    beforeAll(async () => {
      runtime = await loadModule(compile(compiler, hydratable));
    });

    function mount(view) {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const dispose = runtime.mount(root, view);
      return { root, dispose };
    }

    test("a static select value after a sibling selects its option", () => {
      const { root, dispose } = mount("selectValue");
      try {
        expect(root.querySelector("select").value).toBe("b");
        expect(root.querySelector("span").value).toBeUndefined();
      } finally {
        dispose();
      }
    });

    test("a selected option beside defaultSelected is the one selected", () => {
      const { root, dispose } = mount("optionSelected");
      try {
        const select = root.querySelector("select");
        expect([...select.options].map(option => option.selected)).toEqual([false, true]);
        expect(select.value).toBe("b");
      } finally {
        dispose();
      }
    });

    test("an input value beside defaultValue lands on that input", () => {
      const { root, dispose } = mount("inputValue");
      try {
        const inputs = [...root.querySelectorAll("input")];
        expect(inputs.map(input => input.value)).toEqual(["a", "x"]);
        expect(inputs[1].defaultValue).toBe("y");
      } finally {
        dispose();
      }
    });

    test("a checked box beside defaultChecked is the one checked", () => {
      const { root, dispose } = mount("inputChecked");
      try {
        const boxes = [...root.querySelectorAll("input")];
        expect(boxes.map(box => box.checked)).toEqual([false, true]);
      } finally {
        dispose();
      }
    });

    test("a static style after a sibling lands on its element with inlineStyles off", async () => {
      const styled = await loadModule(
        compile(compiler, hydratable, styleSource, { inlineStyles: false })
      );
      const root = document.createElement("div");
      document.body.appendChild(root);
      const dispose = styled.mount(root);
      try {
        expect(root.querySelector("p").style.color).toBe("red");
        expect(root.querySelector("span").getAttribute("style")).toBeNull();
      } finally {
        dispose();
      }
    });

    test("a muted video beside defaultMuted is the one muted", () => {
      const { root, dispose } = mount("videoMuted");
      try {
        expect(root.querySelector("video").muted).toBe(true);
        expect(root.querySelector("span").muted).toBeUndefined();
      } finally {
        dispose();
      }
    });
  });
});
