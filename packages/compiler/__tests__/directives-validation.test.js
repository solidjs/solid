// Closure-capture validation for function-level `"use server"` directives.
//
// A server function is extracted out of its lexical position, so it may only
// reference its own parameters/locals, module top-level bindings, and
// globals. Capturing a binding from an intermediate enclosing scope is a
// compile error naming the variable and both locations.

const path = require("path");

const compilerDir = path.resolve(__dirname, "..");
const { transformDirectives } = require(compilerDir);

const RUNTIME = "@solidjs/web/server-functions";
const ROOT = "/project";
const FILENAME = `${ROOT}/src/module.ts`;

function compile(code, overrides = {}) {
  return transformDirectives(code, {
    filename: FILENAME,
    root: ROOT,
    mode: "server",
    env: "production",
    directive: "use server",
    register: { kind: "named", name: "registerServerReference", source: RUNTIME },
    create: { kind: "named", name: "createServerReference", source: RUNTIME },
    ...overrides
  });
}

describe('"use server" closure-capture validation', () => {
  describe("errors", () => {
    it("rejects capturing an enclosing function's local", () => {
      const code = [
        "function make() {",
        "  const secret = 1;",
        "  return async () => {",
        '    "use server";',
        "    return secret;",
        "  };",
        "}",
        "export { make };"
      ].join("\n");
      expect(() => compile(code)).toThrow(
        /server functions cannot capture non-top-level variables: `secret` is declared in an enclosing function/
      );
    });

    it("rejects capturing an enclosing function's parameter", () => {
      const code = [
        "export function make(user) {",
        "  return async () => {",
        '    "use server";',
        "    return user.id;",
        "  };",
        "}"
      ].join("\n");
      expect(() => compile(code)).toThrow(/`user` is declared in an enclosing function/);
    });

    it("rejects capturing a loop variable", () => {
      const code = [
        "export const handlers = [];",
        "for (const item of [1, 2, 3]) {",
        "  handlers.push(async () => {",
        '    "use server";',
        "    return item;",
        "  });",
        "}"
      ].join("\n");
      expect(() => compile(code)).toThrow(
        /server functions cannot capture non-top-level variables: `item` is declared in an enclosing block/
      );
    });

    it("rejects captures in a nested arrow inside the server function", () => {
      const code = [
        "function wrapper() {",
        "  let count = 0;",
        "  return async () => {",
        '    "use server";',
        "    return [1, 2].map(() => count);",
        "  };",
        "}",
        "export { wrapper };"
      ].join("\n");
      expect(() => compile(code)).toThrow(/`count` is declared in an enclosing function/);
    });

    it("reports the filename and reference position", () => {
      const code = [
        "function make() {",
        "  const secret = 1;",
        "  return async () => {",
        '    "use server";',
        "    return secret;",
        "  };",
        "}"
      ].join("\n");
      // `secret` reference is on line 5, column 12; declared line 2, column 9.
      expect(() => compile(code)).toThrow(
        /\/project\/src\/module\.ts:5:12: .* \(at \/project\/src\/module\.ts:2:9\)/
      );
    });

    it("errors in client mode too", () => {
      const code = [
        "function make() {",
        "  const secret = 1;",
        "  return async () => {",
        '    "use server";',
        "    return secret;",
        "  };",
        "}",
        "export { make };"
      ].join("\n");
      expect(() => compile(code, { mode: "client" })).toThrow(
        /`secret` is declared in an enclosing function/
      );
    });

    it("rejects function declarations capturing an enclosing local", () => {
      const code = [
        "export function outer() {",
        "  const conn = 1;",
        "  async function inner() {",
        '    "use server";',
        "    return conn;",
        "  }",
        "  return inner;",
        "}"
      ].join("\n");
      expect(() => compile(code)).toThrow(/`conn` is declared in an enclosing function/);
    });
  });

  describe("allowed", () => {
    it("allows capturing top-level const/let bindings", () => {
      const code = [
        "const API = '/api';",
        "let counter = 0;",
        "export const send = async () => {",
        '  "use server";',
        "  counter++;",
        "  return fetch(API);",
        "};"
      ].join("\n");
      const result = compile(code);
      expect(result.valid).toBe(true);
      expect(result.functions).toHaveLength(1);
    });

    it("allows capturing imports", () => {
      const code = [
        'import { db } from "./db";',
        "export const run = async q => {",
        '  "use server";',
        "  return db.query(q);",
        "};"
      ].join("\n");
      expect(compile(code).valid).toBe(true);
    });

    it("allows own parameters and locals, including nested scopes", () => {
      const code = [
        "export const sum = async items => {",
        '  "use server";',
        "  let total = 0;",
        "  for (const item of items) {",
        "    const weigh = value => value * 2;",
        "    total += weigh(item);",
        "  }",
        "  return total;",
        "};"
      ].join("\n");
      expect(compile(code).valid).toBe(true);
    });

    it("allows globals and unresolved references", () => {
      const code = [
        "export const report = async () => {",
        '  "use server";',
        "  console.log(process.env.NODE_ENV);",
        "  return globalThis.crypto.randomUUID();",
        "};"
      ].join("\n");
      expect(compile(code).valid).toBe(true);
    });

    it("allows top-level function and class declarations", () => {
      const code = [
        "function helper(value) { return value + 1; }",
        "class Box { constructor(v) { this.v = v; } }",
        "export const wrap = async v => {",
        '  "use server";',
        "  return new Box(helper(v));",
        "};"
      ].join("\n");
      expect(compile(code).valid).toBe(true);
    });

    it("leaves module-level directives unaffected", () => {
      const code = [
        '"use server";',
        "export function make(user) {",
        "  const local = user.id;",
        "  return () => local;",
        "}"
      ].join("\n");
      expect(compile(code).valid).toBe(true);
    });

    it("ignores directives nested inside an already-extracted server function", () => {
      // The transform never extracts the inner function (its subtree is
      // consumed whole), so its captures of the outer function's locals are
      // ordinary closures and must not error.
      const code = [
        "export const outer = async () => {",
        '  "use server";',
        "  const x = 1;",
        "  const inner = () => {",
        '    "use server";',
        "    return x;",
        "  };",
        "  return inner();",
        "};"
      ].join("\n");
      const result = compile(code);
      expect(result.valid).toBe(true);
      expect(result.functions).toHaveLength(1);
    });

    it("ignores object methods (never extracted by the transform)", () => {
      const code = [
        "export function factory() {",
        "  const state = 1;",
        "  return {",
        "    read() {",
        '      "use server";',
        "      return state;",
        "    }",
        "  };",
        "}"
      ].join("\n");
      // Not extracted, so no capture error and nothing transformed.
      const result = compile(code);
      expect(result.valid).toBe(false);
    });
  });
});
