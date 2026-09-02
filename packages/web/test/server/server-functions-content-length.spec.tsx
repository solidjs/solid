/**
 * A `Content-Length` an author did not compute must never describe a body
 * the transport composed (#3197).
 *
 * Three producers merge author-supplied headers onto an answer whose body
 * the runtime encodes itself — the `respond()` envelope, a returned/thrown
 * `Response` on the scripted road, and the request event's response stub
 * gap-fill — and a stale length is not a cosmetic mismatch: RFC 9112 §6.3
 * has a recipient with a valid `Content-Length` read exactly that many
 * octets and stop, so the answer arrives truncated with no error anywhere,
 * and RFC 9110 §8.6 forbids forwarding a length "known to be incorrect" at
 * all. `createNoJSHandler` already reconciles this by deleting the header
 * from the redirect it builds; the other producers did not.
 *
 * The invariant asserted here is one line wide and holds for every answer
 * the handler can emit: either there is no `Content-Length`, or it equals
 * the number of bytes the response body actually carries. The controls
 * matter as much as the repros — a length the runtime did NOT invalidate
 * (an unscripted passthrough of the author's own body) must survive, and
 * the streaming road must stay length-free so it can still chunk.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestEvent, respond } from "@solidjs/web";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const provideEvent = <T,>(_event: unknown, run: () => T): T => run();

type Road = "scripted" | "plain" | "form";

async function call(id: string, { road = "scripted" as Road, stub = null as string | null } = {}) {
  const address = road === "scripted" ? `/_server/data/${id}` : `/_server/${id}`;
  const form = road === "form";
  const response = await handleServerFunctionRequest(
    new Request(`https://app.example${address}`, {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        ...(form
          ? {
              "Content-Type": "application/x-www-form-urlencoded",
              "Sec-Fetch-Mode": "navigate",
              Referer: "https://app.example/page"
            }
          : {})
      },
      ...(form ? { body: "a=1" } : {})
    }),
    {
      provideEvent,
      createEvent: request => {
        const event = createRequestEvent(request);
        // a middleware parking a length on the response stub
        if (stub !== null) event.response.headers.set("Content-Length", stub);
        return event;
      }
    }
  );
  const declared = response.headers.get("Content-Length");
  const encoding = response.headers.get("Content-Encoding");
  const bytes = response.body ? (await response.arrayBuffer()).byteLength : 0;
  return { status: response.status, declared, encoding, bytes };
}

/**
 * The whole contract in one line: a declared length is the length that was
 * sent. Rendered as a row so a failure names every producer at once rather
 * than only the first.
 */
function row(
  label: string,
  r: { status: number; declared: string | null; encoding: string | null; bytes: number }
) {
  return `${label}: status=${r.status} Content-Length=${r.declared ?? "absent"} Content-Encoding=${
    r.encoding ?? "absent"
  } body=${r.bytes} bytes`;
}
// The status is part of the contract: without it a handler that answers
// nothing at all renders as `absent / 0 bytes` and passes.
function expected(label: string, status: number, r: { declared: string | null; bytes: number }) {
  // A framing header the runtime did not compute must simply be absent: a
  // stale length truncates the answer, a stale encoding tells the peer to
  // decompress bytes nobody compressed.
  return `${label}: status=${status} Content-Length=${
    r.declared === null ? "absent" : r.bytes
  } Content-Encoding=absent body=${r.bytes} bytes`;
}

describe("Content-Length never describes a body the transport composed (#3197)", () => {
  it("holds across every producer that merges author headers onto an encoded body", async () => {
    // the proxy shape: `return await fetch(upstream)` — every fetch Response
    // carries a Content-Length, and the author wrote none of it
    registerServerFunction("cl-returned-response", async () => {
      return new Response("upstream body", {
        headers: { "Content-Type": "text/html", "Content-Length": "13" }
      });
    });
    registerServerFunction("cl-thrown-response", async () => {
      throw new Response("upstream body", {
        headers: { "Content-Type": "text/html", "Content-Length": "13" }
      });
    });
    registerServerFunction("cl-returned-envelope", async () =>
      respond({ ok: true, n: 42 }, { headers: { "Content-Length": "999" } })
    );
    registerServerFunction("cl-thrown-envelope", async () => {
      throw respond({ ok: true, n: 42 }, { headers: { "Content-Length": "999" } });
    });
    registerServerFunction("cl-redirect", async () => {
      throw new Response(null, {
        status: 302,
        headers: { Location: "/done", "Content-Length": "42" }
      });
    });
    registerServerFunction("cl-string", async () => "seven!!");
    // a Content-Encoding is the same defect wearing a different name: it
    // describes a compression the transport never applied
    registerServerFunction("cl-encoding-envelope", async () =>
      respond({ ok: true, n: 42 }, { headers: { "Content-Encoding": "gzip" } })
    );
    registerServerFunction(
      "cl-encoding-response",
      async () => new Response("upstream body", { headers: { "Content-Encoding": "gzip" } })
    );
    for (const status of [204, 205, 304]) {
      registerServerFunction(`cl-null-${status}`, async () =>
        respond(undefined, { status, headers: { "Content-Length": "5" } })
      );
    }

    const cases: [string, () => Promise<any>, number][] = [
      ["returned Response + Content-Length (codec road)", () => call("cl-returned-response"), 200],
      ["thrown Response + Content-Length", () => call("cl-thrown-response"), 200],
      ["returned respond() envelope (JSON road)", () => call("cl-returned-envelope"), 200],
      ["thrown respond() envelope", () => call("cl-thrown-envelope"), 200],
      ["thrown 302 carrying a Content-Length", () => call("cl-redirect"), 200],
      ["stub gap-fill: middleware sets 0", () => call("cl-string", { stub: "0" }), 200],
      ["stub gap-fill: middleware sets 999", () => call("cl-string", { stub: "999" }), 200],
      ["envelope + Content-Encoding", () => call("cl-encoding-envelope"), 200],
      ["Response + Content-Encoding", () => call("cl-encoding-response"), 200],
      ["204 + Content-Length", () => call("cl-null-204"), 204],
      ["205 + Content-Length", () => call("cl-null-205"), 205],
      ["304 + Content-Length", () => call("cl-null-304"), 304],
      // unscripted: the same producers, plain-HTTP road
      [
        "unscripted respond() envelope + Content-Length",
        () => call("cl-returned-envelope", { road: "plain" }),
        200
      ],
      ["unscripted stub gap-fill", () => call("cl-string", { road: "plain", stub: "999" }), 200],
      [
        "no-JS form post + Content-Length",
        () => call("cl-returned-response", { road: "form" }),
        303
      ]
    ];

    const actual: string[] = [];
    const want: string[] = [];
    for (const [label, run, status] of cases) {
      const r = await run();
      actual.push(row(label, r));
      want.push(expected(label, status, r));
    }
    expect(actual).toEqual(want);
  });

  it("controls: nothing that was already correct changes", async () => {
    registerServerFunction(
      "cl-ctl-response",
      async () => new Response("upstream body", { headers: { "Content-Type": "text/html" } })
    );
    registerServerFunction("cl-ctl-envelope", async () => respond({ ok: true, n: 42 }));
    registerServerFunction("cl-ctl-string", async () => "seven!!");
    registerServerFunction("cl-ctl-stream", async function* () {
      yield "a";
      yield "b";
    } as any);
    // the author serves their OWN body on the plain road: the runtime never
    // re-encodes it, so their length is the truth and must survive
    registerServerFunction(
      "cl-ctl-passthrough",
      async () =>
        new Response("upstream body", {
          headers: { "Content-Type": "text/html", "Content-Length": "13" }
        })
    );

    const passthrough = await call("cl-ctl-passthrough", { road: "plain" });
    expect(passthrough.declared).toBe("13");
    expect(passthrough.bytes).toBe(13);

    for (const [label, run] of [
      ["returned Response, no length", () => call("cl-ctl-response")],
      ["respond() envelope, no length", () => call("cl-ctl-envelope")],
      ["plain string result", () => call("cl-ctl-string")],
      ["streaming result stays length-free", () => call("cl-ctl-stream")]
    ] as [string, () => Promise<any>][]) {
      const r = await run();
      expect(`${label}: ${r.declared}`).toBe(`${label}: null`);
      expect(r.bytes).toBeGreaterThan(0);
    }
  });
});
