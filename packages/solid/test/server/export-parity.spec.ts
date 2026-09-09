/** @vitest-environment node */
import { describe, expect, test } from "vitest";
import * as client from "../../src/index.js";
import * as server from "../../src/server/index.js";

describe("Export parity: server mirrors client", () => {
  test("server exports every client export", () => {
    const clientExports = Object.keys(client).sort();
    const serverExports = Object.keys(server).sort();

    const missingFromServer = clientExports.filter(k => !serverExports.includes(k));
    if (missingFromServer.length > 0) {
      console.log("Missing from server:", missingFromServer);
    }
    expect(missingFromServer).toEqual([]);
  });

  test("all function exports are functions (DEV/OBSERVE are the same signals objects as the client's)", () => {
    for (const [key, value] of Object.entries(server)) {
      if (key === "DEV" || key === "OBSERVE") {
        // Both entries gate on the `"_SOLID_DEV_"`/`"_SOLID_OBSERVE_"`
        // literals (truthy here — source, not dist) and re-export
        // @solidjs/signals' objects, so the server's diagnostics channel IS
        // the client's. dist/server.js exports `undefined` for both; the dist
        // artifact specs pin that per tier.
        expect(value).toBeDefined();
        expect(value).toBe((client as any)[key]);
        continue;
      }
      if (typeof (client as any)[key] === "function") {
        expect(typeof value).toBe("function");
      }
    }
  });

  test("all symbol exports are symbols", () => {
    for (const [key, value] of Object.entries(server)) {
      if (typeof (client as any)[key] === "symbol") {
        expect(typeof value).toBe("symbol");
      }
    }
  });
});
