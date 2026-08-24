import {
  clearFlashCookie,
  getServerFunctionMetadata,
  hasFlashCookie,
  isServerFunction
} from "@solidjs/web";
import {
  createServerReference,
  registerServerReference,
  withMeta
} from "@solidjs/web/server-functions/server";

describe("server-function server core exports", () => {
  it("uses the Solid-owned registry and flash helpers", () => {
    const reference = withMeta(
      createServerReference(registerServerReference("server-core-exports-0", async () => null)),
      { scope: "server" }
    );

    expect(isServerFunction(reference)).toBe(true);
    expect(getServerFunctionMetadata(reference)).toEqual({ scope: "server" });
    expect(hasFlashCookie("flash=value")).toBe(true);
    expect(clearFlashCookie()).toBe("flash=; Max-Age=0; Path=/");
  });
});
