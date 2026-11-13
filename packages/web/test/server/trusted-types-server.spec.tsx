/**
 * Trusted Types on the server: a policy has nothing to create there, so an
 * isomorphic entry that sets one is a no-op, not a client-only throw, and the
 * markup Solid parses stays a plain string.
 */
import { describe, expect, test, vi } from "vitest";
import { setTrustedTypesPolicy, trustedHTML } from "../../src/server.js";

describe("Trusted Types on the server", () => {
  test("setTrustedTypesPolicy is a no-op", () => {
    const createHTML = vi.fn((html: string) => html);
    expect(() => setTrustedTypesPolicy({ createHTML })).not.toThrow();
    expect(trustedHTML("<p>x</p>")).toBe("<p>x</p>");
    expect(createHTML).not.toHaveBeenCalled();
  });
});
