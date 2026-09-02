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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    const response = await handleServerFunctionRequest(
      post(JSON.stringify(["hello"]), { [BODY_FORMAT_HEADER]: JSON_FORMAT })
    );
    expect(response.status).toBe(200);
  });

  it("routes a non-conforming Content-Length through the cap instead of trusting it (#3153)", async () => {
    // Number("-1") is -1: neither `> limit` nor falsy, so a negative
    // declaration satisfied neither guard and the body streamed in uncapped
    // — 195× the configured limit in the report. A stock node:http parser
    // refuses the header first; an adapter that builds the Request itself,
    // or a proxy that rewrites the header (a decompressor preserving the
    // compressed length), delivers it here.
    const fn = vi.fn(async (s: string) => s.length);
    registerServerFunction("bounds-negative-length", fn);
    const oversized = JSON.stringify(["x".repeat(200_000)]);

    // (" 5 " is unreachable here: the Headers layer itself trims OWS, so the
    // guard sees a conforming "5")
    for (const raw of ["-1", "+5", "abc,def"]) {
      const response = await handleServerFunctionRequest(
        new Request("https://app.example/_server/data/bounds-negative-length", {
          method: "POST",
          body: oversized,
          headers: {
            "Sec-Fetch-Site": "same-origin",
            "X-Server-Function-Instance": "server-function:test",
            "content-length": raw,
            [BODY_FORMAT_HEADER]: JSON_FORMAT
          }
        }),
        { bodySizeLimit: 1024 }
      );
      expect([raw, response.status]).toEqual([raw, 413]);
    }
    expect(fn).not.toHaveBeenCalled();

    // control: a conforming declaration within the limit still dispatches
    const body = JSON.stringify(["ok"]);
    const accepted = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/bounds-negative-length", {
        method: "POST",
        body,
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Instance": "server-function:test",
          "content-length": String(body.length),
          [BODY_FORMAT_HEADER]: JSON_FORMAT
        }
      }),
      { bodySizeLimit: 1024 }
    );
    expect(accepted.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
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
        await handleServerFunctionRequest(
          post(JSON.stringify(["x".repeat(2 * 1024 * 1024)]), {
            [BODY_FORMAT_HEADER]: JSON_FORMAT
          }),
          { bodySizeLimit: Infinity }
        )
      ).status
    ).toBe(200);
  });

  it("honors the configured default", async () => {
    const tagged = { [BODY_FORMAT_HEADER]: JSON_FORMAT };
    configureServerFunctionsServer({ bodySizeLimit: 8 });
    try {
      expect((await handleServerFunctionRequest(post("[1,2,3,4,5,6]", tagged))).status).toBe(413);
    } finally {
      configureServerFunctionsServer({ bodySizeLimit: 1_048_576 });
    }
    expect((await handleServerFunctionRequest(post("[1,2,3,4,5,6]", tagged))).status).toBe(200);
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

describe("an unusable body format (#3130)", () => {
  // The decode switch falling through used to answer `undefined`, and
  // dispatch spread that into the call as argument 0: the function ran,
  // committed, and answered 200 on an argument it was never sent. The
  // whole class is a malformed request and answers 400 before dispatch.
  it("refuses a format tag the runtime has never heard of", async () => {
    const fn = vi.fn(async () => "reached");
    registerServerFunction("bounds-format-unknown", fn);
    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/bounds-format-unknown", {
        method: "POST",
        body: "[1]",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Instance": "server-function:test",
          [BODY_FORMAT_HEADER]: "9999"
        }
      })
    );
    expect(response.status).toBe(400);
    expect(fn).not.toHaveBeenCalled();
  });

  it("a duplicated format header no longer turns a 400 into a 200", async () => {
    // `Headers` comma-joins duplicates silently: two copies of the JSON
    // tag arrive as `"8, 8"`, which names no format — the codec was never
    // consulted and the body was dropped on the floor.
    const fn = vi.fn(async () => "reached");
    registerServerFunction("bounds-format-dup", fn);
    const request = new Request("https://app.example/_server/data/bounds-format-dup", {
      method: "POST",
      body: "[1,2]",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        "X-Server-Function-Instance": "server-function:test"
      }
    });
    request.headers.append(BODY_FORMAT_HEADER, JSON_FORMAT);
    request.headers.append(BODY_FORMAT_HEADER, JSON_FORMAT);
    expect(request.headers.get(BODY_FORMAT_HEADER)).toBe(`${JSON_FORMAT}, ${JSON_FORMAT}`);

    const response = await handleServerFunctionRequest(request);
    expect(response.status).toBe(400);
    expect(fn).not.toHaveBeenCalled();
  });

  it("refuses an untagged body whose content-type names no decoding", async () => {
    // text/plain from a bare fetch(url, { body: "..." }): not a form
    // (those are content-type sniffed by design) and not a documented
    // direct-HTTP encoding, so there is nothing to call the function WITH.
    const fn = vi.fn(async () => "reached");
    registerServerFunction("bounds-format-untagged", fn);
    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/bounds-format-untagged", {
        method: "POST",
        body: "just some text",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Instance": "server-function:test"
        }
      })
    );
    expect(response.status).toBe(400);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("an adapter-provided empty POST body (#3214)", () => {
  function emptyStream() {
    return new ReadableStream({
      start(controller) {
        controller.close();
      }
    });
  }

  it("treats an untagged empty stream as a zero-argument call", async () => {
    const fn = vi.fn(async (...args: unknown[]) => args.length);
    registerServerFunction("bounds-empty-stream", fn);
    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/bounds-empty-stream", {
        method: "POST",
        body: emptyStream(),
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Instance": "server-function:test",
          "content-length": "0"
        },
        duplex: "half"
      } as RequestInit)
    );
    expect(response.status).toBe(200);
    expect(fn).toHaveBeenCalledWith();
  });

  it("does not trust a zero Content-Length when the stream has bytes", async () => {
    const fn = vi.fn(async () => "reached");
    registerServerFunction("bounds-false-empty-stream", fn);
    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/bounds-false-empty-stream", {
        method: "POST",
        body: "not empty",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Instance": "server-function:test",
          "content-length": "0"
        }
      })
    );
    expect(response.status).toBe(400);
    expect(fn).not.toHaveBeenCalled();
  });

  it("still refuses an empty body carrying an unknown format tag", async () => {
    const fn = vi.fn(async () => "reached");
    registerServerFunction("bounds-empty-unknown", fn);
    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/bounds-empty-unknown", {
        method: "POST",
        body: emptyStream(),
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Instance": "server-function:test",
          "content-length": "0",
          [BODY_FORMAT_HEADER]: "9999"
        },
        duplex: "half"
      } as RequestInit)
    );
    expect(response.status).toBe(400);
    expect(fn).not.toHaveBeenCalled();
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
