/**
 * Build-id skew check.
 *
 * The unknown-id 404 (#3110) catches a function that a deploy removed or
 * renamed. It cannot catch one whose id survived but whose arguments or
 * result changed shape. When both halves are configured with a `buildId`,
 * the client sends its id on every call that is not GET-encoded, and a
 * server with another id answers `409` before the function runs. The
 * client names it on the error (`versionSkew: true`).
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  configureServerFunctionsServer,
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import {
  BUILD_HEADER,
  configureServerFunctionsClient,
  createServerReference,
  GET
} from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

afterEach(() => {
  // an empty id turns the check off on both halves
  configureServerFunctionsServer({ buildId: "" });
  configureServerFunctionsClient({ buildId: "" });
  while (disconnects.length) disconnects.pop()!();
});

function post(path: string, headers: Record<string, string> = {}) {
  return new Request(`https://app.example${path}`, {
    method: "POST",
    headers: { "Sec-Fetch-Site": "same-origin", ...headers }
  });
}

/** Routes the client stub's fetch straight into the handler, recording each request. */
function connectTransport() {
  const original = globalThis.fetch;
  const sent: Request[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const address = input instanceof Request ? input.url : input.toString();
    const request = new Request(
      new URL(address, "http://localhost"),
      input instanceof Request ? input : init
    );
    request.headers.set("Sec-Fetch-Site", "same-origin");
    sent.push(request.clone());
    return handleServerFunctionRequest(request);
  }) as typeof fetch;
  disconnects.push(() => {
    globalThis.fetch = original;
  });
  return sent;
}

const disconnects: (() => void)[] = [];

describe("build-id skew check", () => {
  it("refuses a call from another build without running the function", async () => {
    const fn = vi.fn(async () => "ran");
    registerServerFunction("refused-a1b2c3d4", fn);
    configureServerFunctionsServer({ buildId: "build-b" });

    const wire = await handleServerFunctionRequest(
      post("/_server/data/refused-a1b2c3d4", { [BUILD_HEADER]: "build-a" })
    );

    expect(wire.status).toBe(409);
    expect(wire.headers.get(BUILD_HEADER)).toBe("build-b");
    expect(wire.headers.get("Cache-Control")).toBe("no-store");
    expect(fn).not.toHaveBeenCalled();
  });

  it("runs a call from the same build", async () => {
    registerServerFunction("same-a1b2c3d4", async () => "ran");
    configureServerFunctionsServer({ buildId: "build-b" });

    const wire = await handleServerFunctionRequest(
      post("/_server/data/same-a1b2c3d4", { [BUILD_HEADER]: "build-b" })
    );

    expect(wire.status).toBe(200);
  });

  it("runs a call without a build id", async () => {
    const fn = vi.fn(async () => "ran");
    registerServerFunction("unlabelled-a1b2c3d4", fn);
    configureServerFunctionsServer({ buildId: "build-b" });

    const wire = await handleServerFunctionRequest(post("/_server/data/unlabelled-a1b2c3d4"));

    expect(wire.status).toBe(200);
    expect(fn).toHaveBeenCalled();
  });

  it("checks nothing when the server has no build id", async () => {
    registerServerFunction("unchecked-a1b2c3d4", async () => "ran");

    const wire = await handleServerFunctionRequest(
      post("/_server/data/unchecked-a1b2c3d4", { [BUILD_HEADER]: "build-a" })
    );

    expect(wire.status).toBe(200);
  });

  it("names the refusal on the client error", async () => {
    registerServerFunction("skewed-a1b2c3d4", async () => "ran");
    configureServerFunctionsServer({ buildId: "build-b" });
    configureServerFunctionsClient({ buildId: "build-a" });
    const sent = connectTransport();
    const skewed = createServerReference("skewed-a1b2c3d4") as () => Promise<unknown>;

    const outcome = await skewed().then(
      () => {
        throw new Error("resolved: the call from another build ran");
      },
      (error: any) => error
    );

    expect(sent[0]!.headers.get(BUILD_HEADER)).toBe("build-a");
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome.versionSkew).toBe(true);
    expect(outcome.unknownFunction).toBeUndefined();
    expect(outcome.status).toBe(409);
    expect(outcome.message).toMatch(/version skew/);
  });

  it("resolves a call when the builds match", async () => {
    registerServerFunction("matched-a1b2c3d4", async () => "ran");
    configureServerFunctionsServer({ buildId: "build-b" });
    configureServerFunctionsClient({ buildId: "build-b" });
    connectTransport();
    const matched = createServerReference("matched-a1b2c3d4") as () => Promise<unknown>;

    await expect(matched()).resolves.toBe("ran");
  });

  it("sends no build id on a GET-encoded read", async () => {
    // A read's url is its identity (#3406): caches and preloads match it
    // without the transport's headers, so the build id stays off it.
    registerServerFunction("read-a1b2c3d4", async () => "read");
    configureServerFunctionsClient({ buildId: "build-a" });
    const sent = connectTransport();
    const read = GET(createServerReference("read-a1b2c3d4")) as () => Promise<unknown>;

    await read().catch(() => {});

    expect(sent[0]!.method).toBe("GET");
    expect(sent[0]!.headers.get(BUILD_HEADER)).toBeNull();
  });

  it("sends no build id when the client has none", async () => {
    registerServerFunction("plain-a1b2c3d4", async () => "ran");
    const sent = connectTransport();
    const plain = createServerReference("plain-a1b2c3d4") as () => Promise<unknown>;

    await plain();

    expect(sent[0]!.headers.get(BUILD_HEADER)).toBeNull();
  });
});
