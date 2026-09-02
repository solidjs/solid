/**
 * The decode boundary strips the keys that turn an ordinary merge into
 * prototype pollution — all of them, on every road (#3168, #3202).
 *
 * #3168 stripped `__proto__` because `Object.assign` merges by [[Set]], so
 * the key fires the inherited setter and re-prototypes the merged copy.
 * That reasoning covers a SHALLOW merge. A recursive merge — at least as
 * common in configuration and patch handling — walks into an own
 * `constructor`, finds `prototype`, and writes onto `Object.prototype`
 * itself: strictly worse than the case that was fixed, because it escapes
 * the copy and reaches the whole process.
 *
 * Half-covering the class is the failure mode this table exists to prevent:
 * an author who read #3168 and concluded the boundary was handled is wrong
 * for the recursive spelling. So the assertion is not "`__proto__` is
 * gone" but "`Object.prototype` is untouched after a naive recursive merge
 * of a decoded argument", across every key and every road that decodes one.
 *
 * A field named `constructorName` is the control: the strip must not eat
 * ordinary data.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import { serializeString } from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
  delete (Object.prototype as any).polluted;
});

const provideEvent = <T,>(_event: unknown, run: () => T): T => run();

/** The naive recursive merge #3168's own rationale names as the sink. */
function deepMerge(target: any, source: any) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object") {
      target[key] ??= {};
      deepMerge(target[key], source[key]);
    } else target[key] = source[key];
  }
  return target;
}

/**
 * A hostile peer's codec frame. The codec's OWN encoder refuses to
 * serialize an object with an own `constructor` key, so no honest client
 * can produce one — but the frame is just text, and nothing stops a peer
 * from writing it by hand. Encode under placeholder names, rename them in
 * the payload, re-length the frame header.
 */
const HOSTILE_RENAME: Record<string, string> = {
  ctorKey: "constructor",
  protoKey: "__proto__",
  prototypeKey: "prototype"
};

async function hostileFrame(value: unknown) {
  const framed = await serializeString(value);
  let json = framed.slice(framed.indexOf(";", 1) + 1);
  for (const [from, to] of Object.entries(HOSTILE_RENAME))
    json = json.split(`"${from}"`).join(`"${to}"`);
  const length = new TextEncoder().encode(json).byteLength;
  return `;0x${length.toString(16).padStart(8, "0")};${json}`;
}

type Road = "json-query" | "json-body" | "codec-query" | "codec-body";

let seq = 0;

/** Runs one call and hands back the argument exactly as the function saw it. */
async function decodeArgument(road: Road, payload: unknown) {
  const id = `proto-keys-${seq++}`;
  let seen: unknown;
  registerServerFunction(id, async (first: unknown) => {
    seen = first;
    return "ok";
  });
  const address = `https://app.example/_server/data/${id}`;
  const headers: Record<string, string> = { "Sec-Fetch-Site": "same-origin" };
  let request: Request;
  if (road === "json-query") {
    request = new Request(`${address}?args=${encodeURIComponent(JSON.stringify([payload]))}`, {
      method: "POST",
      headers
    });
  } else if (road === "json-body") {
    request = new Request(address, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "X-Server-Function-Format": "8" },
      body: JSON.stringify([payload])
    });
  } else if (road === "codec-query") {
    request = new Request(`${address}?args=${encodeURIComponent(await hostileFrame([payload]))}`, {
      method: "POST",
      headers
    });
  } else {
    request = new Request(address, {
      method: "POST",
      headers: { ...headers, "Content-Type": "text/plain", "X-Server-Function-Format": "0" },
      body: await hostileFrame([payload])
    });
  }
  const response = await handleServerFunctionRequest(request, { provideEvent });
  return { status: response.status, seen };
}

/**
 * The same payload in the two spellings the two decode roads can carry: the
 * JSON road takes the dangerous names literally; the codec road takes
 * placeholders that `hostileFrame` renames back.
 */
const PAYLOADS: [string, unknown, unknown][] = [
  [
    "__proto__",
    JSON.parse('{"__proto__":{"polluted":"viaProto"},"n":1}'),
    { protoKey: { polluted: "viaProto" }, n: 1 }
  ],
  [
    "constructor",
    JSON.parse('{"constructor":{"prototype":{"polluted":"viaCtor"}},"n":1}'),
    { ctorKey: { prototypeKey: { polluted: "viaCtor" } }, n: 1 }
  ],
  [
    "prototype",
    JSON.parse('{"prototype":{"polluted":"viaPrototype"},"n":1}'),
    { prototypeKey: { polluted: "viaPrototype" }, n: 1 }
  ],
  [
    "constructor nested one level",
    JSON.parse('{"a":{"constructor":{"prototype":{"polluted":"viaNested"}}},"n":1}'),
    { a: { ctorKey: { prototypeKey: { polluted: "viaNested" } } }, n: 1 }
  ],
  [
    "constructor inside an array",
    JSON.parse('[{"constructor":{"prototype":{"polluted":"viaArray"}}}]'),
    [{ ctorKey: { prototypeKey: { polluted: "viaArray" } } }]
  ]
];

const ROADS: Road[] = ["json-query", "json-body", "codec-query", "codec-body"];

describe("decoded arguments cannot reach Object.prototype (#3202)", () => {
  it("no dangerous key survives any decode road into a recursive merge", async () => {
    const rows: string[] = [];
    for (const [name, jsonPayload, codecPayload] of PAYLOADS) {
      for (const road of ROADS) {
        const { status, seen } = await decodeArgument(
          road,
          road.startsWith("codec") ? codecPayload : jsonPayload
        );
        // shallow merge — the sink #3168 closed
        const shallow: any = {};
        Object.assign(shallow, seen);
        const reprototyped = Object.getPrototypeOf(shallow) !== Object.prototype;
        // recursive merge — the sink #3168 left open
        deepMerge({}, seen);
        const leaked = (Object.prototype as any).polluted;
        delete (Object.prototype as any).polluted;
        rows.push(
          `${name} / ${road}: status=${status} reprototyped=${reprototyped} Object.prototype.polluted=${JSON.stringify(
            leaked
          )}`
        );
      }
    }
    expect(rows).toEqual(
      rows.map(
        r =>
          `${r.slice(0, r.indexOf(": ") + 2)}status=200 reprototyped=false Object.prototype.polluted=undefined`
      )
    );
  });

  it("a non-plain carrier does not shelter the payload underneath it (#3200)", async () => {
    // The reachable shape is not an unsafe key ON a carrier — seroval drops
    // that at encode — but a plain object one level UNDER one. The walk used
    // to stop at any non-plain prototype, so an `Error`, or any class the
    // codec revives with own properties, hid everything beneath it. Codec
    // road only: the JSON road cannot express a carrier.
    const rows: string[] = [];
    for (const road of ["codec-query", "codec-body"] as Road[]) {
      const carrier = Object.assign(new Error("validation failed"), {
        payload: { ctorKey: { prototypeKey: { polluted: "viaCarrier" } }, n: 1 }
      });
      const { status, seen } = await decodeArgument(road, carrier);
      const payload = (seen as any)?.payload;
      deepMerge({}, payload ?? {});
      const leaked = (Object.prototype as any).polluted;
      delete (Object.prototype as any).polluted;
      rows.push(
        `${road}: status=${status} payloadKeys=${JSON.stringify(
          Object.keys(payload ?? {})
        )} Object.prototype.polluted=${JSON.stringify(leaked)}`
      );
    }
    expect(rows).toEqual(
      rows.map(
        r =>
          `${r.slice(0, r.indexOf(": ") + 2)}status=200 payloadKeys=["n"] ` +
          `Object.prototype.polluted=undefined`
      )
    );
  });

  it("control: ordinary data with a similar name is not eaten", async () => {
    const rows: string[] = [];
    for (const road of ROADS) {
      const { status, seen } = await decodeArgument(road, { constructorName: "Widget", n: 1 });
      rows.push(`${road}: status=${status} ${JSON.stringify(seen)}`);
    }
    expect(rows).toEqual(
      ROADS.map(road => `${road}: status=200 {"constructorName":"Widget","n":1}`)
    );
  });
});
