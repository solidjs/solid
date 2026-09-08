/**
 * @jsxImportSource @solidjs/web
 *
 * Direct coverage of the built DEV server artifact (dist/server.dev.js) — the
 * twin of dist-server-artifact.spec.tsx. Until this artifact existed, SSR had
 * no dev build: the only server bundle was `replaceDev(false)`, so the 26
 * `_SOLID_DEV_` gates in src/server.ts (head/preload validation, useHead
 * warnings, the late-header throw) were stripped from every deployment and
 * only ever ran in this suite, which imports source. The dev artifact is
 * selected by the `development` export condition nested under
 * node/worker/deno; this spec pins that the replace actually ran as `true`
 * (a string scan can't — babel's folding erases the marker either way), by
 * asserting the one gate whose dev and prod behaviors differ observably.
 * Requires a prior `pnpm build`.
 */
import { describe, expect, test, vi } from "vitest";
// Relative import on purpose: bypasses the `@solidjs/web` → source alias in
// vite.config.server.mjs so the built artifact itself is under test.
// @ts-ignore — the dist file has no adjacent type declarations.
import { commitEventResponse, createRequestEvent, isDev } from "../../dist/server.dev.js";

describe("dist/server.dev.js development artifact", () => {
  test("exports isDev === true, agreeing with its internal gates", () => {
    // The public flag and the bundle's `_SOLID_DEV_` gates come from the same
    // replace pass; this pins that the server entry no longer hard-codes it.
    expect(isDev).toBe(true);
  });

  test("post-commit header writes THROW (dev contract of #2982)", () => {
    const event = createRequestEvent(new Request("http://localhost/"));
    commitEventResponse(new Response("body"), event);
    expect(event.response.committed).toBe(true);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // The production artifact reports and drops; the dev artifact must
      // surface the bug loudly. Both are pinned so a build-mode swap in either
      // direction fails a test.
      expect(() => event.response.headers.set("x-late", "1")).toThrow(
        /ran after the response head was sent/
      );
      expect(errorSpy).not.toHaveBeenCalled();
      expect(event.response.headers.get("x-late")).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("append and delete throw on the same committed-stub guard", () => {
    const event = createRequestEvent(new Request("http://localhost/"));
    event.response.headers.set("x-early", "kept");
    commitEventResponse(new Response("body"), event);

    expect(() => event.response.headers.append("x-late", "1")).toThrow();
    expect(() => event.response.headers.delete("x-early")).toThrow();
    expect(event.response.headers.get("x-early")).toBe("kept");
    expect(event.response.headers.get("x-late")).toBeNull();
  });
});
