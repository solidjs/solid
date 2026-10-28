/**
 * @vitest-environment jsdom
 */

// #4017: compiled direct bindings must match the runtime from #4009. A nullish
// value/defaultValue on a checkbox or radio removes the `value` attribute, so a
// checked box submits its native "on" instead of ""; text inputs and textareas
// still clear to "" (#2957). Both compilers' client output is executed against
// the workspace runtime, in non-hydratable builds (the inline path this issue
// fixed) and hydratable ones (which already route through setProperty).

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
import { createSignal, flush } from "solid-js";
export { flush };

export function mount(form, kind, initial) {
  const [value, setValue] = createSignal("custom");
  const [type] = createSignal(kind);
  const dispose = render(
    () => [
      <input type="checkbox" name="checkbox-value" value={value()} checked />,
      <input type="radio" name="radio-value" value={value()} checked />,
      <input type="checkbox" name="checkbox-default" defaultValue={value()} checked />,
      <input type="RADIO" name="radio-default" defaultValue={value()} checked />,
      <input type={type()} name="reactive-type" value={value()} checked />,
      <input type={kind} name="static-expression-type" value={value()} checked />,
      <input type="checkbox" name="checkbox-static" value={initial} checked />,
      <input type="checkbox" name="checkbox-pair" value={value()} defaultValue={value()} checked />,
      <input type="text" name="text" value={value()} />,
      <input name="untyped" value={value()} />,
      <input type="text" name="text-default" defaultValue={value()} />,
      <textarea name="textarea" value={value()} />
    ],
    form
  );
  return { setValue, dispose };
}
`;

const checkable = [
  "checkbox-value",
  "radio-value",
  "checkbox-default",
  "radio-default",
  "reactive-type",
  "static-expression-type",
  "checkbox-pair"
];
const textual = ["text", "untyped", "text-default", "textarea"];

async function loadModule(code) {
  const result = await build({
    stdin: { contents: code, resolveDir: compilerDir, sourcefile: "nullish-input-value.js" },
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
  delete globalThis.Solid$$majors;
  const mod = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    require,
    mod,
    mod.exports
  );
  return mod.exports;
}

function compile(compiler, hydratable) {
  const options = { moduleName: "@solidjs/web", generate: "dom", hydratable };
  return compiler === "babel"
    ? compileBabel(source, options, "nullish-input-value.jsx")
    : compileOxc(source, "nullish-input-value", options);
}

afterEach(() => {
  document.body.textContent = "";
  delete globalThis.Solid$$majors;
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

    function mount(kind, initial) {
      const form = document.createElement("form");
      document.body.appendChild(form);
      const { setValue, dispose } = runtime.mount(form, kind, initial);
      const field = name => form.querySelector(`[name="${name}"]`);
      return { form, field, setValue, dispose };
    }

    test.each(["checkbox", "radio"])(
      "nullish values restore the %s default submission value",
      kind => {
        const { form, field, setValue, dispose } = mount(kind, "custom");
        try {
          for (const name of checkable) expect(new FormData(form).get(name)).toBe("custom");
          for (const absent of [undefined, null]) {
            setValue(absent);
            runtime.flush();
            for (const name of checkable) {
              expect(field(name).getAttribute("value"), name).toBeNull();
              expect(new FormData(form).get(name), name).toBe("on");
            }
            for (const name of textual) expect(field(name).value, name).toBe("");

            setValue("custom");
            runtime.flush();
            for (const name of checkable) expect(new FormData(form).get(name), name).toBe("custom");
            for (const name of textual) expect(field(name).value, name).toBe("custom");
          }
          setValue("");
          runtime.flush();
          for (const name of checkable) expect(new FormData(form).get(name), name).toBe("");
        } finally {
          dispose();
        }
      }
    );

    test.each([undefined, null])("an initial %s value submits the default", initial => {
      const { form, field, dispose } = mount("checkbox", initial);
      try {
        expect(field("checkbox-static").getAttribute("value")).toBeNull();
        expect(new FormData(form).get("checkbox-static")).toBe("on");
      } finally {
        dispose();
      }
    });

    test("an explicit empty value is preserved", () => {
      const { form, dispose } = mount("checkbox", "");
      try {
        expect(new FormData(form).get("checkbox-static")).toBe("");
      } finally {
        dispose();
      }
    });

    test("a type that is not checkable still clears to an empty string", () => {
      const { field, setValue, dispose } = mount("text", "custom");
      try {
        setValue(null);
        runtime.flush();
        expect(field("reactive-type").value).toBe("");
        expect(field("static-expression-type").value).toBe("");
      } finally {
        dispose();
      }
    });
  });
});
