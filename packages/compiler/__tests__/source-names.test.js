// The `sourceNames.primitives` pass (transformSourceNames): reactive
// primitives named after the identifier they are declared as, prefixed with
// the enclosing non-component function. Plain JS in and out.

const { transformSourceNames, transformSourceNamesAsync } = require("../index");

const IMPORT =
  'import { createSignal, createMemo, createStore, createProjection, createOptimistic } from "solid-js";\n';

function names(code, filename = "input.ts") {
  return transformSourceNames(IMPORT + code, { filename }).code;
}

describe("transformSourceNames", () => {
  describe("what gets named", () => {
    it("a signal after the first element of its array pattern", () => {
      expect(names("const [count, setCount] = createSignal(0);")).toContain(
        'createSignal(0, { name: "count" })'
      );
    });

    it("a memo after its binding, with `let`/`var`/export alike", () => {
      const out = names(
        [
          "const doubled = createMemo(() => 1);",
          "let tripled = createMemo(() => 2);",
          "export const quadrupled = createMemo(() => 3);"
        ].join("\n")
      );
      expect(out).toContain('createMemo(() => 1, { name: "doubled" })');
      expect(out).toContain('createMemo(() => 2, { name: "tripled" })');
      expect(out).toContain('createMemo(() => 3, { name: "quadrupled" })');
    });

    it("an object literal's property key and a class field", () => {
      const out = names(
        [
          "const state = { count: createSignal(0), 'total': createMemo(() => 1) };",
          "class Store { count = createSignal(0); }"
        ].join("\n")
      );
      expect(out).toContain('count: createSignal(0, { name: "count" })');
      expect(out).toContain('"total": createMemo(() => 1, { name: "total" })');
      expect(out).toContain('count = createSignal(0, { name: "count" });');
    });

    it("createOptimistic, createStore, createProjection, createOptimisticStore", () => {
      const out = transformSourceNames(
        [
          'import { createOptimistic, createStore, createProjection, createOptimisticStore } from "solid-js";',
          "const [opt] = createOptimistic(0);",
          "const [store, setStore] = createStore({ a: 1 });",
          "const [shallow] = createStore({ a: 1 }, { shallow: true });",
          "const [derived] = createStore(d => { d.x = 1; }, { x: 0 });",
          "const proj = createProjection(d => {}, {});",
          "const [optStore] = createOptimisticStore({ a: 1 });"
        ].join("\n"),
        { filename: "input.ts" }
      ).code;
      expect(out).toContain('createOptimistic(0, { name: "opt" })');
      expect(out).toContain('createStore({ a: 1 }, { name: "store" })');
      expect(out).toMatch(/createStore\(\{ a: 1 \}, \{\s*shallow: true,\s*name: "shallow"\s*\}\)/);
      expect(out).toMatch(/\}, \{ x: 0 \}, \{ name: "derived" \}\)/);
      expect(out).toContain('createProjection((d) => {}, {}, { name: "proj" })');
      expect(out).toContain('createOptimisticStore({ a: 1 }, { name: "optStore" })');
    });

    it("reaches the call through TypeScript wrappers and type arguments", () => {
      const out = names(
        [
          "const a = createMemo<number>(() => 1) as any;",
          "const b = createMemo(() => 1) satisfies unknown;",
          "const c = createMemo(() => 1)!;"
        ].join("\n")
      );
      expect(out).toContain('createMemo<number>(() => 1, { name: "a" }) as any');
      expect(out).toContain('createMemo(() => 1, { name: "b" }) satisfies unknown');
      expect(out).toContain('createMemo(() => 1, { name: "c" })!');
    });

    it("fills omitted positional arguments with `void 0`", () => {
      expect(names("const [empty] = createSignal();")).toContain(
        'createSignal(void 0, { name: "empty" })'
      );
    });
  });

  describe("what is left alone", () => {
    it("an explicit name, a spread that may carry one, and an opaque options argument", () => {
      const out = names(
        [
          'const a = createMemo(() => 1, { name: "explicit" });',
          "const b = createMemo(() => 1, { ...opts });",
          "const c = createMemo(() => 1, opts);",
          "const d = createSignal(...args);"
        ].join("\n")
      );
      expect(out).toContain('createMemo(() => 1, { name: "explicit" })');
      expect(out).not.toContain('"a"');
      expect(out).toContain("createMemo(() => 1, { ...opts })");
      expect(out).toContain("createMemo(() => 1, opts)");
      expect(out).toContain("createSignal(...args)");
      expect(out).not.toMatch(/name: "[bcd]"/);
    });

    it("an options literal without a name gains one beside the other keys", () => {
      expect(names("const [eq] = createSignal(1, { equals: false });")).toMatch(
        /createSignal\(1, \{\s*equals: false,\s*name: "eq"\s*\}\)/
      );
    });

    it("a call with no declared identifier: a hole in the pattern, an expression position", () => {
      const out = names(
        [
          "const [, setOnly] = createSignal(1);",
          "const { value } = createSignal(2);",
          "createSignal(3);",
          "use(createSignal(4));",
          "let late; late = createSignal(5);"
        ].join("\n")
      );
      expect(out).not.toContain("name:");
    });

    it("a createStore whose second argument could be a derive's seed", () => {
      const out = names(
        [
          "const [a] = createStore(deriveFn, {});",
          "const [b] = createStore(deriveFn, { todos: [] });",
          "const [c] = createStore(deriveFn, seed, {});"
        ].join("\n")
      );
      expect(out).not.toMatch(/name: "[ab]"/);
      // Three arguments pin the derived shape: options third.
      expect(out).toContain('createStore(deriveFn, seed, { name: "c" })');
    });

    it("calls that do not resolve to a Solid import", () => {
      const out = transformSourceNames(
        [
          'import { createSignal } from "solid-js";',
          'import { createSignal as other } from "other-lib";',
          "function local() { const createSignal = () => 1; const [shadowed] = createSignal(); return shadowed; }",
          "const [foreign] = other(0);",
          "const [mine] = createCounter(0);",
          "const [named] = createSignal(0);"
        ].join("\n"),
        { filename: "input.ts" }
      ).code;
      expect(out).not.toContain('"shadowed"');
      expect(out).not.toContain('"foreign"');
      expect(out).not.toContain('"mine"');
      expect(out).toContain('createSignal(0, { name: "named" })');
    });

    it("primitives without a nameable target (effects, roots, contexts)", () => {
      const out = transformSourceNames(
        [
          'import { createEffect, createRoot, createContext } from "solid-js";',
          "const dispose = createRoot(d => d);",
          "const Ctx = createContext();",
          "createEffect(() => 1, () => {});"
        ].join("\n"),
        { filename: "input.ts" }
      ).code;
      expect(out).not.toContain("name:");
    });
  });

  describe("the import binding", () => {
    it("follows an alias and a namespace import, from solid-js or @solidjs/signals", () => {
      const out = transformSourceNames(
        [
          'import { createSignal as sig } from "solid-js";',
          'import * as S from "@solidjs/signals";',
          "const [a] = sig(0);",
          "const [b] = S.createMemo(() => 1);",
          "const [c] = S.notAPrimitive(0);"
        ].join("\n"),
        { filename: "input.ts" }
      ).code;
      expect(out).toContain('sig(0, { name: "a" })');
      expect(out).toContain('S.createMemo(() => 1, { name: "b" })');
      expect(out).toContain("S.notAPrimitive(0)");
    });
  });

  describe("the enclosing-function prefix", () => {
    it("a non-component function prefixes its primitives; a component does not", () => {
      const out = names(
        [
          "export function createCounter() {",
          "  const [value, setValue] = createSignal(0);",
          "  return { value, twice: createMemo(() => value() * 2) };",
          "}",
          "function Counter() { const [n] = createSignal(0); return n; }",
          "const useTheme = () => { const [theme] = createSignal('d'); return theme; };",
          "const Themed = () => { const [theme] = createSignal('d'); return theme; };",
          "const api = { createThing() { const [t] = createSignal(0); return t; } };",
          "class Store { init() { const [x] = createSignal(1); return x; } }"
        ].join("\n")
      );
      expect(out).toContain('{ name: "createCounter.value" }');
      expect(out).toContain('{ name: "createCounter.twice" }');
      expect(out).toContain('createSignal(0, { name: "n" })');
      expect(out).toContain('{ name: "useTheme.theme" }');
      expect(out).toContain('createSignal("d", { name: "theme" })');
      expect(out).toContain('{ name: "createThing.t" }');
      expect(out).toContain('{ name: "init.x" }');
    });

    it("anonymous callbacks inherit the nearest named function; a named closure is its own", () => {
      const out = names(
        [
          "function createList() {",
          "  const rows = items.map(item => { const [sel] = createSignal(false); return sel; });",
          "  const helper = () => { const [inner] = createSignal(0); return inner; };",
          "  return [rows, helper];",
          "}",
          "function List() {",
          "  const rows = items.map(item => { const [sel] = createSignal(false); return sel; });",
          "  return rows;",
          "}"
        ].join("\n")
      );
      expect(out).toContain('{ name: "createList.sel" }');
      expect(out).toContain('{ name: "helper.inner" }');
      expect(out).toContain('createSignal(false, { name: "sel" })');
    });
  });

  describe("the pass as a whole", () => {
    it("returns the source untouched when nothing imports a primitive module", () => {
      const code = "const [count] = createSignal(0);\n";
      expect(transformSourceNames(code, { filename: "a.ts" }).code).toBe(code);
      const unrelated = 'import { x } from "solid-js";\nconst y = x();\n';
      expect(transformSourceNames(unrelated, { filename: "a.ts" }).code).toBe(unrelated);
    });

    it("keeps JSX intact in a .tsx module", () => {
      const out = transformSourceNames(
        IMPORT +
          "function App() { const [count] = createSignal(0); return <button onClick={() => count()}>{count()}</button>; }",
        { filename: "App.tsx" }
      ).code;
      expect(out).toContain('createSignal(0, { name: "count" })');
      expect(out).toContain("<button onClick={() => count()}>{count()}</button>");
    });

    it("emits a source map on request", () => {
      const result = transformSourceNames(IMPORT + "const [a] = createSignal(0);", {
        filename: "a.ts",
        sourceMap: true
      });
      expect(result.map).toBeTruthy();
      expect(JSON.parse(result.map).sources).toEqual(["a.ts"]);
      expect(
        transformSourceNames(IMPORT + "const [a] = createSignal(0);", { filename: "a.ts" }).map
      ).toBeNull();
    });

    it("validates its options", () => {
      expect(() => transformSourceNames(null)).toThrow(/expects source code as a string/);
      expect(() => transformSourceNames("", { roots: true })).toThrow(/unknown option `roots`/);
      expect(() => transformSourceNames("", { filename: 1 })).toThrow(
        /`filename` option must be a string/
      );
      expect(() => transformSourceNames("", { sourceMap: "yes" })).toThrow(
        /`sourceMap` option must be boolean/
      );
    });

    it("has an async twin", async () => {
      const result = await transformSourceNamesAsync(IMPORT + "const [a] = createSignal(0);", {
        filename: "a.ts"
      });
      expect(result.code).toContain('{ name: "a" }');
    });
  });
});
