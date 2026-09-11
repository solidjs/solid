// Export validation for module-level `"use server"` directives.
//
// The client build of such a module is rebuilt from its traced server-function
// exports alone, so an export the pass cannot trace would be missing from the
// browser bundle while the server build still has it. Those shapes are
// compile errors naming the export and its position.

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
    mode: "client",
    env: "production",
    directive: "use server",
    register: { kind: "named", name: "registerServerReference", source: RUNTIME },
    create: { kind: "named", name: "createServerReference", source: RUNTIME },
    ...overrides
  });
}

const source = (...lines) => ['"use server";', ...lines].join("\n");

describe('module-level "use server" export validation', () => {
  describe("errors", () => {
    it("rejects a named re-export", () => {
      const code = source('export { helper } from "./helper";', "export const a = async () => 1;");
      expect(() => compile(code)).toThrow(
        /`helper` is re-exported from "\.\/helper"/
      );
    });

    it("rejects a star re-export", () => {
      const code = source('export * from "./other";');
      expect(() => compile(code)).toThrow(/`\*` is re-exported from "\.\/other"/);
    });

    it("rejects a namespace re-export", () => {
      const code = source('export * as ns from "./other";');
      expect(() => compile(code)).toThrow(/`ns` is re-exported from "\.\/other"/);
    });

    it("rejects a class export", () => {
      const code = source("export class Foo {}", "export const b = async () => 2;");
      expect(() => compile(code)).toThrow(/`Foo` is a class declaration/);
    });

    it("rejects a default class export", () => {
      const code = source("export default class Foo {}");
      expect(() => compile(code)).toThrow(/`default` is a class declaration/);
    });

    it("rejects an export declared without an initializer", () => {
      const code = source("export let later;", "later = async () => 1;");
      expect(() => compile(code)).toThrow(/`later` is declared without an initializer/);
    });

    it("rejects a destructured export", () => {
      const code = source("export const { a, b } = make();");
      expect(() => compile(code)).toThrow(/is bound by a destructuring pattern/);
    });

    it("rejects re-exporting an imported binding", () => {
      const code = source('import { x } from "./y";', "export { x };");
      expect(() => compile(code)).toThrow(
        /`x` does not resolve to a top-level binding with an initializer/
      );
    });

    it("rejects an enum export", () => {
      const code = source("export enum Color { Red }", "export const c = async () => 3;");
      expect(() => compile(code)).toThrow(/`Color` is an enum declaration/);
    });

    it("errors in server mode too", () => {
      // The server build would keep the export, so allowing it there would
      // mean the two builds disagree about the module's shape.
      const code = source('export * from "./other";');
      expect(() => compile(code, { mode: "server" })).toThrow(/is re-exported/);
    });

    it("reports the filename and the export's position", () => {
      const code = source("", 'export * from "./other";');
      expect(() => compile(code)).toThrow(/\/project\/src\/module\.ts:3:1: /);
    });

    it("names the configured directive", () => {
      const code = ['"use backend";', 'export * from "./other";'].join("\n");
      expect(() => compile(code, { directive: "use backend" })).toThrow(
        /a "use backend" module can only export server functions/
      );
    });
  });

  describe("allowed", () => {
    it("allows the ordinary export forms", () => {
      const code = source(
        'import { db } from "./db";',
        "export async function getUser(id) { return db.find(id); }",
        "export const remove = async id => db.remove(id);",
        "const impl = async () => db.raw();",
        "export { impl as runQuery };",
        "export default getUser;"
      );
      expect(compile(code).functions).toHaveLength(3);
    });

    it("allows wrapped exports and anonymous defaults", () => {
      const code = source(
        'import { withDelay } from "./wrappers";',
        "export const save = withDelay(async () => 1, 400);",
        'export default withDelay(async () => "mocked", 400);'
      );
      expect(compile(code).functions).toHaveLength(2);
    });

    it("allows type-only exports, which are erased", () => {
      const code = source(
        'export type { Session } from "./session";',
        "export type Id = string;",
        "export interface Shape { x: number }",
        "export const a = async () => 1;"
      );
      expect(compile(code).functions).toHaveLength(1);
    });

    it("allows ambient declarations, which are erased", () => {
      const code = source("export declare const ambient: number;", "export const a = async () => 1;");
      expect(compile(code).functions).toHaveLength(1);
    });

    it("leaves function-level directives alone", () => {
      // Only the module-level form rebuilds the client module, so a file with
      // a function-level directive keeps its other exports as written.
      const code = [
        "export function outer() {",
        "  return async () => {",
        '    "use server";',
        "    return 1;",
        "  };",
        "}",
        "export class Keep {}",
        'export * from "./other";'
      ].join("\n");
      expect(compile(code).valid).toBe(true);
    });
  });
});
