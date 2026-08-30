/**
 * Bounds on what a server-function call may send (#3115). The argument
 * payload is buffered and decoded before dispatch, so its cost is paid
 * before application code can decline it — these pin that the runtime
 * declines first: `bodySizeLimit` (default 1 MiB) refuses an oversized
 * POST body or `?args=` encoding with 413 before any decoding, and
 * `maxArguments` (default 1000) refuses an argument list no function could
 * survive being spread into with 400.
 *
 * The decode depth cap rides along (#3119): the seroval path enforces
 * `depthLimit: 64` because payloads come from untrusted peers, but the
 * body FORMAT is the caller's choice, and selecting plain JSON handed the
 * payload to a bare JSON.parse with no cap at all.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  configureServerFunctionsServer,
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
const JSON_FORMAT = "8";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
  registerServerFunction("bounds-sink", async (...args: unknown[]) => ({ argc: args.length }));
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

function post(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("https://app.example/_server/data/bounds-sink", {
    method: "POST",
    body,
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "X-Server-Function-Instance": "server-function:test",
      ...headers
    }
  });
}

// A bodyless POST carrying the `?args=` url encoding — the shape of a
// scripted call whose bound arguments were rendered into the url (a GET
// helper would need a GET-declared function; the url path is the same).
function urlArgs(args: string) {
  return new Request(
    `https://app.example/_server/data/bounds-sink?args=${encodeURIComponent(args)}`,
    {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        "X-Server-Function-Instance": "server-function:test"
      }
    }
  );
}

describe("the body size bound", () => {
  it("refuses a body past the default limit before decoding", async () => {
    // No declared length (undici only sends Content-Length at fetch time),
    // so this exercises the counting read.
    const response = await handleServerFunctionRequest(
      post(JSON.stringify(["x".repeat(2 * 1024 * 1024)]))
    );
    expect(response.status).toBe(413);
  });

  it("refuses a declared length past the limit without reading the body", async () => {
    const response = await handleServerFunctionRequest(
      post("[]", { "content-length": String(64 * 1024 * 1024) })
    );
    expect(response.status).toBe(413);
  });

  it("accepts a body under the limit", async () => {
    const response = await handleServerFunctionRequest(post(JSON.stringify(["hello"])));
    expect(response.status).toBe(200);
  });

  it("applies the same ceiling to the ?args= encoding", async () => {
    const response = await handleServerFunctionRequest(urlArgs(JSON.stringify(["y"])), {
      bodySizeLimit: 4
    });
    expect(response.status).toBe(413);
  });

  it("honors a per-handler override in both directions", async () => {
    expect(
      (await handleServerFunctionRequest(post("[1,2,3]", {}), { bodySizeLimit: 4 })).status
    ).toBe(413);
    expect(
      (
        await handleServerFunctionRequest(post(JSON.stringify(["x".repeat(2 * 1024 * 1024)])), {
          bodySizeLimit: Infinity
        })
      ).status
    ).toBe(200);
  });

  it("honors the configured default", async () => {
    configureServerFunctionsServer({ bodySizeLimit: 8 });
    try {
      expect((await handleServerFunctionRequest(post("[1,2,3,4,5,6]"))).status).toBe(413);
    } finally {
      configureServerFunctionsServer({ bodySizeLimit: 1_048_576 });
    }
    expect((await handleServerFunctionRequest(post("[1,2,3,4,5,6]"))).status).toBe(200);
  });
});

describe("the argument count bound", () => {
  it("refuses an argument list past the default limit as malformed", async () => {
    const response = await handleServerFunctionRequest(
      post(JSON.stringify(Array.from({ length: 1001 }, (_, i) => i)), {
        [BODY_FORMAT_HEADER]: JSON_FORMAT
      })
    );
    expect(response.status).toBe(400);
  });

  it("accepts a list at the limit", async () => {
    const response = await handleServerFunctionRequest(
      post(JSON.stringify(Array.from({ length: 1000 }, (_, i) => i)), {
        [BODY_FORMAT_HEADER]: JSON_FORMAT
      })
    );
    expect(response.status).toBe(200);
  });

  it("honors a per-handler override", async () => {
    const response = await handleServerFunctionRequest(
      post("[1,2,3,4]", { [BODY_FORMAT_HEADER]: JSON_FORMAT }),
      { maxArguments: 3 }
    );
    expect(response.status).toBe(400);
  });
});

describe("the decode depth cap on caller-chosen formats", () => {
  function nested(depth: number) {
    const root: any = {};
    let cursor = root;
    for (let i = 0; i < depth; i++) {
      cursor.a = {};
      cursor = cursor.a;
    }
    return root;
  }

  it("caps a plain-JSON body", async () => {
    const response = await handleServerFunctionRequest(
      post(JSON.stringify([nested(500)]), { [BODY_FORMAT_HEADER]: JSON_FORMAT })
    );
    expect(response.status).toBe(400);
  });

  it("caps a plain-JSON ?args= encoding", async () => {
    const response = await handleServerFunctionRequest(urlArgs(JSON.stringify([nested(500)])));
    expect(response.status).toBe(400);
  });

  it("passes a payload under the cap", async () => {
    const response = await handleServerFunctionRequest(
      post(JSON.stringify([nested(10)]), { [BODY_FORMAT_HEADER]: JSON_FORMAT })
    );
    expect(response.status).toBe(200);
  });

  it("refuses a non-array plain-JSON body as malformed", async () => {
    const response = await handleServerFunctionRequest(
      post(JSON.stringify({ not: "an array" }), { [BODY_FORMAT_HEADER]: JSON_FORMAT })
    );
    expect(response.status).toBe(400);
  });
});

describe("what the bounds must not disturb", () => {
  it("leaves a form post under the limit alone", async () => {
    const form = new FormData();
    form.set("field", "value");
    const response = await handleServerFunctionRequest(post(form));
    expect(response.status).toBe(200);
  });
});
