// Capture rule for `broadcast(fn)`.
//
// A broadcast's outer body runs per caller, but the component it returns is
// rendered once and shared by every caller with the same arguments. So that
// component may read the function's parameters, its own locals and module
// scope, never the outer body: that would be the first caller's value, shown
// to everyone.

const path = require("path");

const compilerDir = path.resolve(__dirname, "..");
const { transformDirectives } = require(compilerDir);

const RUNTIME = "@solidjs/web/server-functions";
const ROOT = "/project";
const FILENAME = `${ROOT}/src/module.tsx`;

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

const IMPORT = `import { broadcast } from "${RUNTIME}";`;
const LEAK = /a broadcast\(\) render cannot read `user` from its server function's body/;

describe("broadcast() capture rule", () => {
  describe("errors", () => {
    it("rejects an outer-body local read by the returned component", () => {
      const code = [
        IMPORT,
        'import { getUser } from "./auth";',
        "export const room = broadcast(async (id) => {",
        '  "use server";',
        "  const user = await getUser();",
        "  return () => <p>{id} {user.name}</p>;",
        "});"
      ].join("\n");
      expect(() => compile(code)).toThrow(LEAK);
      expect(() => compile(code, { mode: "client" })).toThrow(LEAK);
    });

    it("names both locations", () => {
      const code = [
        IMPORT,
        "export const room = broadcast(async () => {",
        '  "use server";',
        "  const user = 1;",
        "  return () => user;",
        "});"
      ].join("\n");
      expect(() => compile(code)).toThrow(
        /module\.tsx:5:\d+: .*declared at \/project\/src\/module\.tsx:4:\d+/
      );
    });

    it("follows a local component the returned one renders", () => {
      const code = [
        IMPORT,
        "export const room = broadcast(async () => {",
        '  "use server";',
        "  const user = await load();",
        "  function Name() { return <b>{user.name}</b>; }",
        "  return () => <p><Name /></p>;",
        "});"
      ].join("\n");
      expect(() => compile(code)).toThrow(LEAK);
    });

    it("checks a returned local function, a conditional return, and a renamed import", () => {
      const named = [
        `import { broadcast as shared } from "${RUNTIME}";`,
        "export const room = shared(async (id) => {",
        '  "use server";',
        "  const user = await load();",
        "  if (!id) return null;",
        "  const View = () => user;",
        "  return View;",
        "});"
      ].join("\n");
      expect(() => compile(named)).toThrow(LEAK);
    });

    it("checks a server function declared apart from the call, and nested wrappers", () => {
      const code = [
        IMPORT,
        'import { liveQuery } from "@solidjs/router";',
        "async function room() {",
        '  "use server";',
        "  const user = await load();",
        "  return () => user;",
        "}",
        'export const getRoom = liveQuery(broadcast(room), "room");'
      ].join("\n");
      expect(() => compile(code)).toThrow(LEAK);
    });

    it("applies under a module-level directive", () => {
      const code = [
        '"use server";',
        IMPORT,
        "export const room = broadcast(async () => {",
        "  const user = await load();",
        "  return () => user;",
        "});"
      ].join("\n");
      expect(() => compile(code)).toThrow(LEAK);
    });
  });

  describe("allowed", () => {
    it("reads parameters, its own locals and module scope", () => {
      const code = [
        IMPORT,
        'import { createMemo } from "solid-js";',
        'import { watch, getUser } from "./db";',
        "const LIMIT = 10;",
        "export const room = broadcast(async (id, { kind } = {}) => {",
        '  "use server";',
        "  const user = await getUser();",
        '  if (!user) throw new Error("no");',
        "  return props => {",
        "    const rows = createMemo(() => watch(id, kind, LIMIT));",
        "    const each = row => <li>{row.name}{props.label}</li>;",
        "    return <ul>{rows().map(each)}</ul>;",
        "  };",
        "});"
      ].join("\n");
      expect(() => compile(code)).not.toThrow();
    });

    it("lets the outer body use its locals for gates", () => {
      const code = [
        IMPORT,
        "export const room = broadcast(async () => {",
        '  "use server";',
        "  const user = await load();",
        "  const allowed = user && user.admin;",
        '  if (!allowed) throw new Error("forbidden");',
        "  return () => <p>ok</p>;",
        "});"
      ].join("\n");
      expect(() => compile(code)).not.toThrow();
    });

    it("leaves a `broadcast` that is not imported alone", () => {
      const code = [
        "const broadcast = fn => fn;",
        "export const room = broadcast(async () => {",
        '  "use server";',
        "  const user = await load();",
        "  return () => user;",
        "});"
      ].join("\n");
      expect(() => compile(code)).not.toThrow();
    });

    it("leaves live() alone", () => {
      const code = [
        `import { live } from "${RUNTIME}";`,
        "export const room = live(async () => {",
        '  "use server";',
        "  const user = await load();",
        "  return () => user;",
        "});"
      ].join("\n");
      expect(() => compile(code)).not.toThrow();
    });
  });
});
