/**
 * Direct coverage of the built CJS artifacts — dist/node.cjs (prod, the
 * `require` default) and dist/node.dev.cjs (the `development` condition on
 * the `require` branch). The suite otherwise imports source under vitest's
 * `__DEV__: true` define, so it cannot see whether each artifact's replace
 * ran. `DEV` is the observable: defined in dev, `undefined` in prod. The dev
 * CJS exists so a CJS host that resolves solid-js's `dist/server.dev.cjs`
 * also gets a signals with a live `DEV.diagnostics` — one dev flag per
 * process, not one per module format. Requires a prior build (the turbo
 * `test` task depends on `build`).
 */
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);

describe("@solidjs/signals CJS artifacts", () => {
  test("dist/node.cjs (prod) exports DEV as undefined", () => {
    const prod = require("../dist/node.cjs");
    expect(prod.DEV).toBeUndefined();
  });

  test("dist/node.dev.cjs exports a live DEV with the diagnostics channel", () => {
    const dev = require("../dist/node.dev.cjs");
    expect(dev.DEV).toBeDefined();
    expect(typeof dev.DEV.diagnostics.subscribe).toBe("function");
    expect(typeof dev.DEV.diagnostics.capture).toBe("function");
  });

  test("the two artifacts export the same surface", () => {
    const prod = require("../dist/node.cjs");
    const dev = require("../dist/node.dev.cjs");
    expect(Object.keys(dev).sort()).toEqual(Object.keys(prod).sort());
  });
});
