import { describe, expect, it, vi } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import type { ServerFunctionCSRFOptions } from "@solidjs/web/server-functions/server";

const provideEvent = (_event: unknown, run: () => unknown) => run();

function request(id: string, headers: Record<string, string> = {}) {
  return new Request("https://app.example/_server", {
    method: "POST",
    headers: {
      ...headers,
      "X-Server-Function-Id": id,
      "X-Server-Function-Instance": "server-function:test"
    }
  });
}

describe("server-function CSRF bridge", () => {
  it("rejects cross-site calls before dispatch", async () => {
    const fn = vi.fn(async () => "ok");
    registerServerFunction("csrf-bridge-cross-site", fn);

    const rejected = await handleServerFunctionRequest(
      request("csrf-bridge-cross-site", { "Sec-Fetch-Site": "cross-site" }),
      { provideEvent }
    );
    expect(rejected.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();

    const accepted = await handleServerFunctionRequest(
      request("csrf-bridge-cross-site", { "Sec-Fetch-Site": "same-origin" }),
      { provideEvent }
    );
    expect(accepted.status).toBe(200);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("exposes trusted-origin configuration", async () => {
    registerServerFunction("csrf-bridge-origin", async () => "ok");
    const csrf: ServerFunctionCSRFOptions = { origin: "https://trusted.example" };

    const response = await handleServerFunctionRequest(
      request("csrf-bridge-origin", { Origin: "https://trusted.example" }),
      { csrf, provideEvent }
    );
    expect(response.status).toBe(200);
  });
});
