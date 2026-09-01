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
  test.skip("supports dormant authored lazy bindings across lexical loops and var scopes", async () => {
    const source = `
      export function lazyLoops() @{
        const seen = [];
        const outer = { value: 10 };
        let &{ value } = outer;
        const counter = { value: 0 };
        for (let &{ value } = counter; value < 3; value++) {
          seen.push(value);
        }
        for (const &{ value } of [{ value: 3 }, { value: 4 }]) {
          seen.push(value);
        }
        for (var &{ item } of [{ item: "a" }, { item: "b" }]) {
          seen.push(item);
        }
        if (true) {
          var &{ blockValue } = { blockValue: "block" };
        }
        return {
          seen,
          counter: counter.value,
          outer: value,
          item,
          blockValue
        };
        <p />
      }

      export function lexicalRhsTdz() @{
        const outer = { value: 10 };
        let &{ value } = outer;
        for (const &{ value } of (value, [])) {}
        return value;
        <p />
      }
    `;
    const runtime = await loadRuntimeModule(compileRuntime(source, compiler, "dom"), "dom");

    expect(runtime.lazyLoops()).toEqual({
      seen: [0, 1, 2, 3, 4, "a", "b"],
      counter: 3,
      outer: 10,
      item: "b",
      blockValue: "block"
    });
    expect(() => runtime.lexicalRhsTdz()).toThrow(ReferenceError);
  });

  test.skip("keeps dormant authored lazy arrow parameters deferred", async () => {
    const source = `
      export const inspect = (
        prefix,
        &{ value = prefix, nested: &{ count }, ...rest }
      ) => {
        const before = count++;
        return { value, before, after: count, other: rest.other };
      };
    `;
    const runtime = await loadRuntimeModule(compileRuntime(source, compiler, "dom"), "dom");
    const input = { value: undefined, nested: { count: 2 }, other: 3 };

    expect(runtime.inspect("fallback", input)).toEqual({
      value: "fallback",
      before: 2,
      after: 3,
      other: 3
    });
    expect(input.nested.count).toBe(3);
  });

  test.skip("preserves dormant authored lazy destructuring semantics", async () => {
    const source = `
      export function defaults() @{
        let backing;
        let reads = 0;
        let writes = 0;
        let fallbacks = 0;
        const source = {
          get value() {
            reads++;
            return backing;
          },
          set value(next) {
            writes++;
            backing = next;
          }
        };
        let &{ value = ++fallbacks } = source;

        const first = value;
        const post = value++;
        const pre = ++value;
        value = undefined;
        const compound = value += 5;
        source.value = null;
        const nullValue = value;
        return { first, post, pre, compound, nullValue, backing, reads, writes, fallbacks };
        <p />
      }

      export function nestedAndRest() @{
        const source = { nested: { value: undefined }, selected: 1, other: 2 };
        let &{
          nested: { ["value"]: renamed = 3 },
          selected,
          ...rest
        } = source;
        const arrayLike = { 0: "a", 1: "b", 2: "c", length: 3 };
        let &[head, ...tail] = arrayLike;
        return { renamed, selected, restA: rest, restB: rest, head, tailA: tail, tailB: tail };
        <p />
      }

      export function embeddedBindings() @{
        const source = {};
        let &{ a = 1, b = a } = source;

        let keyReads = 0;
        const outer = {
          get key() {
            keyReads++;
            return "target";
          }
        };
        let &{ key } = outer;
        const computed = { target: undefined };
        let &{ [key]: value = key } = computed;

        return { a, b, first: value, second: value, keyReads };
        <p />
      }

      export function cyclicDefaults(source = {}) @{
        let &{ a = b, b = a } = source;
        return a;
        <p />
      }

      export function selfDefault(source = {}) @{
        let &{ value = value } = source;
        return value;
        <p />
      }

      export function legitimateReentry() @{
        const source = {};
        let &{ value = 1 } = source;
        const result = value += value;
        return { result, stored: source.value };
        <p />
      }

      export function standaloneAssignments() @{
        const source = { value: 1, other: 2, items: ["a", "b", "c"] };
        &{ value, ...rest } = source;
        &[first, ...tail] = source.items;
        const before = value;
        value++;
        return { before, after: value, stored: source.value, other: rest.other, first, tail };
        <p />
      }
    `;
    const runtime = await loadRuntimeModule(compileRuntime(source, compiler, "dom"), "dom");

    expect(runtime.defaults()).toEqual({
      first: 1,
      post: 2,
      pre: 4,
      compound: 8,
      nullValue: null,
      backing: null,
      reads: 5,
      writes: 5,
      fallbacks: 3
    });

    const nested = runtime.nestedAndRest();
    expect(nested).toEqual({
      renamed: 3,
      selected: 1,
      restA: { other: 2 },
      restB: { other: 2 },
      head: "a",
      tailA: ["b", "c"],
      tailB: ["b", "c"]
    });
    expect(nested.restA).not.toBe(nested.restB);
    expect(nested.tailA).not.toBe(nested.tailB);

    expect(runtime.embeddedBindings()).toEqual({
      a: 1,
      b: 1,
      first: "target",
      second: "target",
      keyReads: 4
    });

    expect(runtime.cyclicDefaults({ b: 2 })).toBe(2);
    expect(() => runtime.cyclicDefaults()).toThrow(ReferenceError);
    expect(() => runtime.selfDefault()).toThrow(ReferenceError);
    expect(runtime.legitimateReentry()).toEqual({ result: 2, stored: 2 });
    expect(runtime.standaloneAssignments()).toEqual({
      before: 1,
      after: 2,
      stored: 2,
      other: 2,
      first: "a",
      tail: ["b", "c"]
    });
  });

  test("executes statement containers in expression positions", async () => {
    const source = `
      import { render } from "@solidjs/web";

      export function View({ name }) @{
        const title = @{
          const label = name.toUpperCase();
          <span>{label}</span>
        };
        <main>
          {title}
          {@{
            const suffix = "!";
            <em>{name + suffix}</em>
          }}
        </main>
      }

      export function mount(root, name) {
        return render(() => <View name={name} />, root);
      }
    `;
    const runtime = await loadRuntimeModule(compileRuntime(source, compiler, "dom"), "dom");
    const root = document.createElement("div");
    const dispose = runtime.mount(root, "hello");

    expect(root.querySelector("span").textContent).toBe("HELLO");
    expect(root.querySelector("em").textContent).toBe("hello!");
    dispose();
  });

  test("keeps keyed destructuring and catch patterns deferred", async () => {
    const source = `
      import { createSignal, flush } from "solid-js";
      import { render } from "@solidjs/web";

      const [rows, setRows] = createSignal([
        { id: 1, label: "one", extra: "first" },
        { id: 2, extra: "second" }
      ]);

      function Broken() {
        const error = new Error("boom");
        error.code = "E_BROKEN";
        throw error;
      }

      export function App() @{
        <section>
          <ul>
            @for (const { id, label = id, ...rest } of rows(); key id) {
              <li data-id={id}>{label}:{rest.extra}</li>
            }
          </ul>
          @try {
            <Broken />
          } @catch ({ message = "fallback", ...details }) {
            <p class="error">{message}:{details.code}</p>
          }
        </section>
      }

      export function mount(target) {
        return render(App, target);
      }

      export function replaceRows(next) {
        setRows(next);
        flush();
      }
    `;
    const runtime = await loadRuntimeModule(compileRuntime(source, compiler, "dom"), "dom");
    const root = document.createElement("div");
    const dispose = runtime.mount(root);

    const retained = root.querySelector('[data-id="2"]');
    expect([...root.querySelectorAll("li")].map(node => node.textContent)).toEqual([
      "one:first",
      "2:second"
    ]);
    expect(root.querySelector(".error").textContent).toBe("boom:E_BROKEN");

    runtime.replaceRows([
      { id: 2, label: "TWO", extra: "updated" },
      { id: 3, extra: "third" }
    ]);
    expect(root.querySelector('[data-id="2"]')).toBe(retained);
    expect([...root.querySelectorAll("li")].map(node => node.textContent)).toEqual([
      "TWO:updated",
      "3:third"
    ]);
    dispose();
  });

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
