/** @vitest-environment node */
/**
 * Direct coverage of the built server artifacts across the three tiers —
 * dist/server.js (prod), dist/server.observe.js (the `observe` export
 * condition) and dist/server.dev.js (`development`), all nested under
 * node/worker/deno. The rest of the suite imports source, where the
 * `"_SOLID_DEV_"`/`"_SOLID_OBSERVE_"` literals are truthy, so it cannot see
 * whether the replace ran per artifact. `DEV` and `OBSERVE` are the
 * observables: the server entry gates them the same way the client does, so
 * each artifact must expose @solidjs/signals' objects for exactly its tier
 * (the diagnostics channel server-side findings report through) and
 * `undefined` otherwise. A string scan can't pin this — babel's constant
 * folding erases the marker either way. Requires a prior `pnpm build`.
 */
import { describe, expect, test } from "vitest";
// Relative imports on purpose: they bypass the `solid-js` → source alias in
// vite.config.mjs so the built artifacts themselves are under test.
// @ts-ignore — dist files have no adjacent type declarations.
import * as prod from "../../dist/server.js";
// @ts-ignore
import * as observe from "../../dist/server.observe.js";
// @ts-ignore
import * as dev from "../../dist/server.dev.js";
import { DEV as signalsDEV, OBSERVE as signalsOBSERVE } from "@solidjs/signals";

describe("solid-js server artifacts", () => {
  test("dist/server.js (prod) exports DEV and OBSERVE as undefined", () => {
    expect(prod.DEV).toBeUndefined();
    expect(prod.OBSERVE).toBeUndefined();
  });

  test("dist/server.observe.js exports @solidjs/signals' OBSERVE object and no DEV", () => {
    // Not a copy or a stub: the very object signals exports, so a subscriber
    // on `OBSERVE.diagnostics` sees server findings without a second channel.
    expect(observe.OBSERVE).toBe(signalsOBSERVE);
    expect(typeof observe.OBSERVE.diagnostics.subscribe).toBe("function");
    expect(observe.DEV).toBeUndefined();
  });

  test("dist/server.dev.js exports both @solidjs/signals objects", () => {
    expect(dev.OBSERVE).toBe(signalsOBSERVE);
    expect(dev.DEV).toBe(signalsDEV);
    expect(typeof dev.DEV.hooks).toBe("object");
  });

  test("the three artifacts export the same surface", () => {
    expect(Object.keys(observe).sort()).toEqual(Object.keys(prod).sort());
    expect(Object.keys(dev).sort()).toEqual(Object.keys(prod).sort());
  });
});
