/**
 * @jsxImportSource @solidjs/web
 *
 * Direct coverage of the built PRODUCTION server artifact (dist/server.js).
 * The rest of this suite aliases `@solidjs/web` to src/index.server.ts source,
 * so a build-only regression is invisible to it — which is exactly how the
 * main server Rollup target shipped without `replaceDev(false)`: babel
 * constant-folded the unreplaced truthy `"_SOLID_DEV_"` literal and the prod
 * bundle took the dev branch of the committed-stub header guard, turning a
 * late header write into a thrown error on a live production request
 * (#2982). A string scan of the output can't catch this (the folding erases
 * the `_SOLID_DEV_` marker whether or not the replace ran), so the contract is
 * pinned behaviorally here. Requires a prior `pnpm build`, like the
 * server-function specs that run against their dist bundles.
 */
import { describe, expect, test, vi } from "vitest";
// Relative import on purpose: it bypasses the `@solidjs/web` → source alias
// in vite.config.server.mjs so the built artifact itself is under test.
// @ts-ignore — the dist file has no adjacent type declarations; the runtime
// behavior is what's being asserted.
import { commitEventResponse, createRequestEvent } from "../../dist/server.js";

describe("dist/server.js production artifact", () => {
  test("post-commit header writes report through console.error and no-op (#2982)", () => {
    const event = createRequestEvent(new Request("http://localhost/"));
    commitEventResponse(new Response("body"), event);
    expect(event.response.committed).toBe(true);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Dev builds throw here by design; the production artifact must
      // report and drop the write so an already-streaming request survives.
      expect(() => event.response.headers.set("x-late", "1")).not.toThrow();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain("Response header write dropped");
      // The write was dropped, not applied.
      expect(event.response.headers.get("x-late")).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("append and delete take the same reported no-op path once committed (#2982)", () => {
    const event = createRequestEvent(new Request("http://localhost/"));
    event.response.headers.set("x-early", "kept");
    commitEventResponse(new Response("body"), event);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => event.response.headers.append("x-late", "1")).not.toThrow();
      expect(() => event.response.headers.delete("x-early")).not.toThrow();
      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(event.response.headers.get("x-early")).toBe("kept");
      expect(event.response.headers.get("x-late")).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
