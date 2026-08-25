/**
 * @vitest-environment jsdom
 *
 * The cookie codec on the client entry: the REAL implementation, shared
 * with the server entry — never a stub (a pure value transformer has
 * legitimate browser uses, e.g. `document.cookie`, and a no-op returning
 * fake values would be silent garbage). Identity against the codec module
 * pins "one implementation, two entries"; the round-trip pins that it
 * behaves in a browser environment exactly as it does on the server (the
 * behavioral contract lives in test/ssr/cookies.spec.js). Bundle weight is
 * separately guarded: the codec must tree-shake out of client builds that
 * don't call it (scripts/size-guard.mjs).
 */
import { parseCookieHeader, serializeCookie } from "../../src/client.js";
import * as codec from "../../src/cookies.js";

describe("cookie codec on the client entry", () => {
  it("is the same implementation the server entry exports", () => {
    expect(parseCookieHeader).toBe(codec.parseCookieHeader);
    expect(serializeCookie).toBe(codec.serializeCookie);
  });

  it("round-trips values in a browser environment", () => {
    const value = "sp ace;semi=eq,comma✓";
    const serialized = serializeCookie("session", value, { sameSite: "lax" });
    expect(serialized).toBe(`session=${encodeURIComponent(value)}; Path=/; SameSite=Lax`);
    expect(parseCookieHeader(serialized.split(";")[0]).session).toBe(value);
  });

  it("parses a document.cookie-shaped string", () => {
    expect(parseCookieHeader("a=1; b=sp%20ace")).toEqual({ a: "1", b: "sp ace" });
  });
});
