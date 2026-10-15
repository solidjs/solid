/**
 * What the argument road decodes, and what every server-function response
 * carries regardless of who built it.
 *
 * Arguments are client input. The codec's web plugin set exists for the
 * server → client direction (results, hydration), where `Response` and
 * `Request` are ordinary values to hand a page. On the way IN they are not
 * arguments any function has a use for — they are transport objects, and
 * the handler treats a `Response` it gets back from a function as the HTTP
 * answer. So the argument decoder refuses both, wherever they sit in the
 * payload (top level, nested, inside a promise or a stream), and the call is
 * answered as the malformed request it is: a `400`, before dispatch.
 *
 * Every response leaving the handler also carries
 * `X-Content-Type-Options: nosniff` unless the function named its own: a
 * body is what its `Content-Type` says it is, and a body-without-a-type
 * (bytes, a Blob) is never content-sniffed into something else.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GET as serverGET,
  createServerReference as createServerSideReference,
  handleServerFunctionRequest,
  registerServerReference
} from "@solidjs/web/server-functions/server";
import { createServerReference, serializeString } from "@solidjs/web/server-functions/client";
// @ts-ignore built entry without a test alias; its client import resolves through the alias above
import { enableRichArguments } from "../../server-functions/dist/rich-args.js";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
const SERIALIZED = "0";
const MARKUP = "<p>hello</p>";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

let count = 0;

/** Registers `fn` as a declared read (GET-callable) and as a POST function. */
function register(fn: (...args: any[]) => any) {
  const id = `arg-types-${count++}`;
  const calls: unknown[][] = [];
  const spy = (...args: unknown[]) => {
    calls.push(args);
    return fn(...args);
  };
  serverGET(createServerSideReference(registerServerReference(id, spy)));
  return { id, calls };
}

const encode = (args: unknown[]) => serializeString(args);

function getCall(path: string, encoded: string) {
  return handleServerFunctionRequest(
    new Request(`http://localhost/_server/${path}?args=${encodeURIComponent(encoded)}`, {
      headers: { "Sec-Fetch-Site": "same-origin" }
    })
  );
}

function postCall(path: string, encoded: string) {
  return handleServerFunctionRequest(
    new Request(`http://localhost/_server/${path}`, {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "text/plain",
        [BODY_FORMAT_HEADER]: SERIALIZED
      },
      body: encoded
    })
  );
}

const html = () => new Response(MARKUP, { headers: { "Content-Type": "text/html" } });
// Bodiless: a body-carrying Request fails to reconstruct on Node for an
// unrelated reason (no `duplex`), which would answer 400 without the refusal.
const request = () => new Request("http://localhost/elsewhere");

const shapes: [string, () => unknown[]][] = [
  ["a Response argument", () => [html()]],
  ["a Request argument", () => [request()]],
  ["a Response nested in an object", () => [{ deep: { value: html() } }]],
  ["a Request nested in an array", () => [[1, [request()]]]],
  ["a Response inside a promise", () => [Promise.resolve(html())]],
  ["a Request inside a promise in an object", () => [{ later: Promise.resolve(request()) }]],
  [
    "a Response inside a stream",
    () => [
      new ReadableStream({
        start(controller) {
          controller.enqueue("first");
          controller.enqueue(html());
          controller.close();
        }
      })
    ]
  ]
];

const roads: [string, (id: string, encoded: string) => Promise<Response>][] = [
  ["GET, plain address", (id, encoded) => getCall(id, encoded)],
  ["GET, data address", (id, encoded) => getCall(`data/${id}`, encoded)],
  ["POST, plain address", (id, encoded) => postCall(id, encoded)],
  ["POST, data address", (id, encoded) => postCall(`data/${id}`, encoded)]
];

describe("server-function arguments never decode Response or Request", () => {
  for (const [road, call] of roads) {
    for (const [shape, args] of shapes) {
      it(`refuses ${shape} with 400 before dispatch (${road})`, async () => {
        const { id, calls } = register(async (...received: unknown[]) => {
          for (const value of received) await value;
          return "ran";
        });
        const response = await call(id, await encode(args()));
        expect(response.status).toBe(400);
        expect(calls).toEqual([]);
        expect(response.headers.get("Content-Type")).not.toBe("text/html");
      });
    }
  }

  it("an echoing function cannot be made to answer with caller-chosen markup", async () => {
    const { id, calls } = register(async (value: unknown) => value);
    for (const [, call] of roads) {
      const response = await call(id, await encode([html()]));
      expect(response.status).toBe(400);
      expect(response.headers.get("Content-Type")).not.toBe("text/html");
      expect(await response.text()).not.toContain(MARKUP);
    }
    const thrower = register(async (value: unknown) => {
      throw value;
    });
    const thrown = await getCall(thrower.id, await encode([html()]));
    expect(thrown.status).toBe(400);
    expect(await thrown.text()).not.toContain(MARKUP);
    expect(calls).toEqual([]);
    expect(thrower.calls).toEqual([]);
  });

  it("still decodes the web values arguments do carry (Headers, URL, streams, promises)", async () => {
    const { id } = register(async (headers: Headers, url: URL, later: Promise<number>, stream) => {
      const chunks: unknown[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      return { header: headers.get("x-a"), href: url.href, later: await later, chunks };
    });
    const args = [
      new Headers({ "x-a": "1" }),
      new URL("http://localhost/x"),
      Promise.resolve(7),
      new ReadableStream({
        start(controller) {
          controller.enqueue("a");
          controller.enqueue("b");
          controller.close();
        }
      })
    ];
    const response = await postCall(`data/${id}`, await encode(args));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      header: "1",
      href: "http://localhost/x",
      later: 7,
      chunks: ["a", "b"]
    });
  });

  it("the development artifact names the refusal, at the top level and inside a promise", async () => {
    // @ts-ignore built entry without a test alias
    const dev = await import("../../server-functions/dist/server.dev.js");
    dev.registerServerReference("arg-types-dev", async (...args: unknown[]) => args.length);
    for (const args of [[html()], [Promise.resolve(request())]]) {
      const response = await dev.handleServerFunctionRequest(
        new Request("http://localhost/_server/data/arg-types-dev", {
          method: "POST",
          headers: {
            "Sec-Fetch-Site": "same-origin",
            "Content-Type": "text/plain",
            [BODY_FORMAT_HEADER]: SERIALIZED
          },
          body: await encode(args)
        })
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toMatch(/cannot carry Response or Request values/);
    }
  });

  it("an unregistered tag keeps its answers: a plain malformed 400 at the top level, a failed promise past it", async () => {
    // @ts-ignore built entry without a test alias
    const dev = await import("../../server-functions/dist/server.dev.js");
    class Thing {}
    const thingPlugin = {
      tag: "arg-types/Thing",
      test: (value: unknown) => value instanceof Thing,
      parse: { sync: () => ({}), async: async () => ({}), stream: () => ({}) },
      serialize: () => "new Thing()",
      deserialize: () => new Thing()
    };
    const seen: string[] = [];
    dev.registerServerReference("arg-types-unknown", async (value: unknown) => {
      try {
        await value;
        seen.push("resolved");
      } catch {
        seen.push("rejected");
      }
      return "ran";
    });
    const post = async (args: unknown[]) =>
      dev.handleServerFunctionRequest(
        new Request("http://localhost/_server/data/arg-types-unknown", {
          method: "POST",
          headers: {
            "Sec-Fetch-Site": "same-origin",
            "Content-Type": "text/plain",
            [BODY_FORMAT_HEADER]: SERIALIZED
          },
          body: await serializeString(args, { plugins: [thingPlugin as any] })
        })
      );
    const top = await post([new Thing()]);
    expect(top.status).toBe(400);
    expect(await top.text()).toBe("Malformed server function arguments");
    const later = await post([Promise.resolve(new Thing())]);
    expect(later.status).toBe(200);
    expect(seen).toEqual(["rejected"]);
  });

  it("the rich-args client refuses to encode a Response or Request argument before sending", async () => {
    const original = globalThis.fetch;
    const sent: unknown[] = [];
    globalThis.fetch = ((...args: unknown[]) => {
      sent.push(args);
      return Promise.resolve(new Response(null));
    }) as typeof fetch;
    try {
      enableRichArguments();
      const call = createServerReference("arg-types-client") as (...args: unknown[]) => any;
      await expect(call(html())).rejects.toThrow(/Response or Request/);
      await expect(call({ nested: [request()] })).rejects.toThrow(/Response or Request/);
      expect(sent).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("server-function responses default to nosniff", () => {
  it("every answer carries X-Content-Type-Options: nosniff — results, refusals, errors", async () => {
    const bytes = register(async () => new TextEncoder().encode(MARKUP));
    const json = register(async () => ({ ok: true }));
    const failing = register(async () => {
      throw new Error("boom");
    });
    const responses = [
      await getCall(bytes.id, "[]"),
      await getCall(`data/${json.id}`, "[]"),
      await getCall(failing.id, "[]"),
      await getCall("data/arg-types-missing", "[]"),
      await getCall(json.id, "not an encoding"),
      await handleServerFunctionRequest(
        new Request(`http://localhost/_server/${json.id}`, {
          method: "HEAD",
          headers: { "Sec-Fetch-Site": "same-origin" }
        })
      )
    ];
    for (const response of responses) {
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("never overrides a value the function set, on mutable and immutable headers", async () => {
    const own = register(
      async () =>
        new Response(MARKUP, {
          headers: { "Content-Type": "text/html", "X-Content-Type-Options": "nosniff" }
        })
    );
    const ownResponse = await getCall(own.id, "[]");
    expect(ownResponse.headers.get("X-Content-Type-Options")).toBe("nosniff");

    const custom = register(
      async () => new Response("x", { headers: { "X-Content-Type-Options": "custom" } })
    );
    expect((await getCall(custom.id, "[]")).headers.get("X-Content-Type-Options")).toBe("custom");

    const redirect = register(async () => Response.redirect("http://localhost/next", 302));
    const redirected = await getCall(redirect.id, "[]");
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("a Response the server code builds still passes through unchanged", async () => {
    const page = register(
      async () =>
        new Response(MARKUP, {
          status: 201,
          headers: { "Content-Type": "text/html; charset=utf-8", "X-Custom": "kept" }
        })
    );
    const response = await getCall(page.id, "[]");
    expect(response.status).toBe(201);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("X-Custom")).toBe("kept");
    expect(await response.text()).toBe(MARKUP);
  });
});
