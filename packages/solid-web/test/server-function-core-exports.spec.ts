import {
  clearFlashCookie,
  getServerFunctionMetadata,
  getServerFunctionRPC,
  hasFlashCookie,
  isServerFunction
} from "../src/index.js";
import { createServerReference, withMeta } from "../server-functions/src/client.js";

describe("server-function core exports", () => {
  it("exposes metadata without importing the transport from core", () => {
    const reference = withMeta(createServerReference("core-exports-0"), {
      scope: "test"
    });

    expect(isServerFunction(reference)).toBe(true);
    expect(getServerFunctionMetadata(reference)).toEqual({ scope: "test" });
    expect(getServerFunctionRPC()).toBeDefined();
  });

  it("owns flash cookie helpers", () => {
    expect(hasFlashCookie("flash=value; other=1")).toBe(true);
    expect(hasFlashCookie("other=1")).toBe(false);
    expect(clearFlashCookie()).toBe("flash=; Max-Age=0; Path=/");
  });
});
