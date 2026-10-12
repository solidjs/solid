/**
 * @vitest-environment jsdom
 *
 * The CSP nonce projection on the client entry: the REAL implementation,
 * shared with the server entry, never a stub. A document rendered on both
 * sides calls it with the request event's nonce on the server and with
 * nothing on the client. Identity against the server entry pins "one
 * implementation, two entries"; the table pins the projection itself,
 * `null` included (the type the vite plugin gives `event.nonce`).
 */
import { describe, expect, it } from "vitest";
import { scriptNonce, styleNonce } from "../../src/index.js";
import * as server from "../../src/server.js";

describe("CSP nonce projection on the client entry", () => {
  it("is the same implementation the server entry exports", () => {
    expect(scriptNonce).toBe(server.scriptNonce);
    expect(styleNonce).toBe(server.styleNonce);
  });

  it("projects each destination's half of a render nonce", () => {
    const cases = [
      ["n", "n", "n"],
      [{ script: "s", style: "t" }, "s", "t"],
      [{ script: "s", style: false }, "s", undefined],
      [{ script: false, style: "t" }, undefined, "t"],
      [{ script: false, style: false }, undefined, undefined],
      ["", undefined, undefined],
      [{ script: "", style: "" }, undefined, undefined],
      [null, undefined, undefined],
      [undefined, undefined, undefined]
    ] as const;

    for (const [nonce, script, style] of cases) {
      expect(scriptNonce(nonce)).toBe(script);
      expect(styleNonce(nonce)).toBe(style);
    }
    expect(scriptNonce()).toBeUndefined();
  });
});
