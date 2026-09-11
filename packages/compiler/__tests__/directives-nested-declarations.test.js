// Function declarations nested inside another function carrying a
// function-level `"use server"` directive.
//
// The bubbling pre-pass turns every function declaration into
// `const name = function name() {}` at the top of its block so the transform
// only has to handle expression forms. The Babel original skipped the body of
// each bubbled declaration, so a declaration nested inside another function
// was never bubbled and a directive on it was silently ignored: the body
// shipped to the client and ran there, while the capture validator (which
// walks every function) still rejected its captures. These tests pin that a
// nested declaration is extracted like any other marked function, in both
// modes, and that hoisting still holds after the rewrite.

const path = require("path");

const compilerDir = path.resolve(__dirname, "..");
const { transformDirectives } = require(compilerDir);

const RUNTIME = "@solidjs/web/server-functions";
const ROOT = "/project";
const FILENAME = `${ROOT}/src/module.js`;

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

const lines = code => code.split("\n").map(line => line.trim());

describe("nested function declarations", () => {
  const source = [
    "export function outer() {",
    "  async function inner() {",
    '    "use server";',
    "    return 1;",
    "  }",
    "  return inner;",
    "}"
  ].join("\n");

  it("extracts a marked declaration nested in a function (server)", () => {
    const result = compile(source);
    expect(result.valid).toBe(true);
    expect(result.functions.map(f => f.name)).toEqual(["outer.inner"]);
    const out = lines(result.code);
    // The body is registered at module top level and the binding inside
    // `outer` becomes a reference to it, exactly like a top-level function.
    expect(out).toContain(
      'const serverFunction_1 = registerServerReference_1("outer.inner-' +
        hashOf(result) +
        '", async function inner() {'
    );
    expect(out).toContain("const inner = createServerReference_1(serverFunction_1);");
    expect(result.code).not.toMatch(/"use server"/);
  });

  it("replaces the declaration with a proxy on the client", () => {
    const result = compile(source, { mode: "client" });
    expect(result.valid).toBe(true);
    const out = lines(result.code);
    expect(out).toContain(
      `const inner = createServerReference_1("outer.inner-${hashOf(result)}");`
    );
    // The server body is gone from the client build.
    expect(result.code).not.toMatch(/return 1/);
    expect(result.code).not.toMatch(/registerServerReference/);
  });

  it("keeps the declaration callable before its source position", () => {
    // A function declaration is hoisted to the top of its scope. The bubbled
    // `const` lands at the top of the block, so a use above the declaration
    // still resolves after the rewrite.
    const code = [
      "export function outer() {",
      "  const ref = inner;",
      "  async function inner() {",
      '    "use server";',
      "    return 1;",
      "  }",
      "  return ref;",
      "}"
    ].join("\n");
    const out = lines(compile(code).code);
    const declaration = out.indexOf("const inner = createServerReference_1(serverFunction_1);");
    const use = out.indexOf("const ref = inner;");
    expect(declaration).toBeGreaterThan(-1);
    expect(use).toBeGreaterThan(declaration);
  });

  it("extracts through several levels of nesting", () => {
    const code = [
      "export function outer() {",
      "  function mid() {",
      '    async function inner() { "use server"; return 1; }',
      "    return inner;",
      "  }",
      "  return mid;",
      "}"
    ].join("\n");
    const result = compile(code);
    expect(result.functions.map(f => f.name)).toEqual(["outer.mid.inner"]);
  });

  it("extracts a declaration inside a block inside a function", () => {
    const code = [
      "export function outer(flag) {",
      "  if (flag) {",
      '    async function inner() { "use server"; return 1; }',
      "    return inner;",
      "  }",
      "}"
    ].join("\n");
    const result = compile(code);
    expect(result.functions.map(f => f.name)).toEqual(["outer.inner"]);
  });

  it("rejects a nested declaration that captures an enclosing local", () => {
    // Extraction and validation agree: the same function that is now
    // extracted is the one whose captures were already being checked.
    const code = [
      "export function outer(db) {",
      '  async function inner() { "use server"; return db.x; }',
      "  return inner;",
      "}"
    ].join("\n");
    expect(() => compile(code)).toThrow(/`db` is declared in an enclosing function/);
  });

  it("leaves an unmarked nested declaration's body in place", () => {
    const code = [
      "export function outer() {",
      "  function helper() { return 2; }",
      '  const go = async () => { "use server"; return 1; };',
      "  return [helper, go];",
      "}"
    ].join("\n");
    const result = compile(code, { mode: "client" });
    expect(result.functions.map(f => f.name)).toEqual(["outer.go"]);
    expect(result.code).toMatch(/return 2/);
  });
});

// The file hash is whatever the pass produced; the scheme itself is pinned
// differentially in directives-id-scheme.test.js.
function hashOf(result) {
  return result.functions[0].id.split("-")[1];
}
