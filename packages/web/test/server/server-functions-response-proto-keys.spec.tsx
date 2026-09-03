/**
 * The strip belongs to the decode BOUNDARY, not to the request leg.
 *
 * #3168/#3200/#3202 taught the argument decoder to delete `__proto__`,
 * `constructor` and `prototype` from every decoded argument graph, on the
 * stated grounds that the handler's most ordinary downstream move —
 * merging a decoded object — turns the key into prototype pollution. The
 * response leg decodes with the same primitives (`decodeResponse` ->
 * `extractBody` -> `JSON.parse` for the fast path, `deserializeStream` for
 * a codec frame) and stripped nothing: the walk sat in server.ts behind
 * the argument decoder, and the client bundle carried no mirror of it. A
 * guard that exists on one leg and was never mirrored on the other is the
 * whole finding; these specs pin the missing half, now held by a single
 * strip at the shared decode boundary — `extractBody`, the one function an
 * argument body and a response body both pass through.
 *
 * The peer supplying the key is NOT a hostile server. It is the most
 * ordinary server function there is —
 *
 *     const loadProfile = async (raw: string) => JSON.parse(raw);
 *
 * — handing back a document the user wrote. `JSON.parse` makes
 * `"__proto__"` an ordinary own property, the encoder puts it on the wire
 * verbatim on both roads, and the client's decoder hands it to the caller
 * with the own descriptor intact. The sink is the same one #3168 named,
 * and it now fires in the BROWSER, on the page's single shared
 * `Object.prototype`, which every framework internal and every third-party
 * script on that page reads through. The blast radius grew; the guard did
 * not follow.
 *
 * So the assertions are not "the client happens to be safe today" but
 * "`Object.prototype` is untouched after a naive merge of a decoded
 * RESULT" and "the response decoder removes exactly the keys the argument
 * decoder removes" — across both wire roads, the collections the codec
 * revives, the single-flight envelope routers seed caches from, and
 * `decodeResponse` itself, which is the decoder integrations call by hand.
 *
 * `constructorName` rides along in the key-parity table as the control:
 * the strip must not eat ordinary data.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs),
 * so they check the artifacts the package actually publishes.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import {
  createServerReference,
  decodeResponse,
  serializeString,
  subscribeFlightData
} from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

// Nothing here may leave the shared prototype dirty for the next file in
// the worker — a leaked key would make an unrelated spec fail somewhere
// else entirely.
afterEach(() => {
  delete (Object.prototype as any).polluted;
});

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

/** Reads and clears the pollution flag in one move. */
function takePollution() {
  const leaked = (Object.prototype as any).polluted;
  delete (Object.prototype as any).polluted;
  return leaked;
}

/**
 * The two roads a successful result can travel. `json` is the fast path
 * (format 8, `JSON.stringify` on the way out and `JSON.parse` on the way
 * back); `codec` is a serialized frame (format 0), which an honest result
 * takes as soon as it carries anything JSON cannot spell — here a `Date`
 * sibling, the most banal reason a real payload leaves the fast path.
 */
type Road = "json" | "codec";

let seq = 0;
/** Body format observed on the wire, per road, so the roads are provably distinct. */
const observedFormat: Record<string, string | null> = {};
/** Proves the registered function body ran rather than the call short-circuiting. */
let invocations = 0;

/**
 * One real round trip: the built client stub calls out through `fetch`,
 * the built server handler answers, and the value comes back through
 * `decodeResponse` exactly as an application would receive it.
 */
async function callServerFunction(road: Road, result: unknown) {
  const id = `response-proto-${seq++}`;
  registerServerFunction(id, async () => {
    invocations++;
    // The codec road needs one non-JSON value somewhere in the graph; the
    // payload itself is identical on both roads.
    return road === "codec" ? { payload: result, at: new Date(0) } : result;
  });
  const original = globalThis.fetch;
  let status = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const request = new Request(new URL(url, "http://localhost"), init);
    request.headers.set("Sec-Fetch-Site", "same-origin");
    const response = await handleServerFunctionRequest(request);
    status = response.status;
    observedFormat[road] = response.headers.get(BODY_FORMAT_HEADER);
    return response;
  }) as typeof fetch;
  try {
    const decoded: any = await createServerReference(id)();
    return { status, value: road === "codec" ? decoded.payload : decoded };
  } finally {
    globalThis.fetch = original;
  }
}

const ROADS: Road[] = ["json", "codec"];

/**
 * User documents, parsed by an ordinary handler, each paired with the
 * roads it can honestly travel. Written through `JSON.parse` rather than
 * as literals: an object literal's `__proto__` sets the prototype instead
 * of creating an own key, which is precisely the difference that makes the
 * parsed form dangerous.
 *
 * `constructor` is json-only, and not because the codec road is safe: the
 * codec's ENCODE half refuses an object with an own `constructor` (the
 * call answers 500 before anything is decoded), so no honest server can
 * put that key in a frame. A peer writing the frame by hand still can —
 * that cell is covered by the `decodeResponse` case below, the same
 * hand-built-frame technique the argument-leg spec uses.
 */
const PAYLOADS: [string, unknown, Road[]][] = [
  [
    "__proto__",
    JSON.parse('{"displayName":"ada","__proto__":{"polluted":"viaProto"},"n":1}'),
    ["json", "codec"]
  ],
  [
    "constructor",
    JSON.parse('{"displayName":"ada","constructor":{"prototype":{"polluted":"viaCtor"}},"n":1}'),
    ["json"]
  ],
  [
    "constructor nested one level",
    JSON.parse('{"a":{"constructor":{"prototype":{"polluted":"viaNested"}}},"n":1}'),
    ["json"]
  ],
  [
    "__proto__ inside an array",
    JSON.parse('[{"__proto__":{"polluted":"viaArray"}}]'),
    ["json", "codec"]
  ]
];

describe("a decoded RESULT cannot reach Object.prototype either", () => {
  it("no dangerous key survives a response into a recursive merge, on either road", async () => {
    const before = invocations;
    let calls = 0;
    const rows: string[] = [];
    for (const [name, payload, roads] of PAYLOADS) {
      for (const road of roads) {
        calls++;
        const { status, value } = await callServerFunction(road, payload);
        deepMerge({}, value);
        rows.push(
          `${name} / ${road}: status=${status} format=${observedFormat[road]} ` +
            `Object.prototype.polluted=${JSON.stringify(takePollution())}`
        );
      }
    }
    // the roads really were different wires, and every function body ran
    expect(observedFormat).toEqual({ json: "8", codec: "0" });
    expect(invocations - before).toBe(calls);
    expect(rows).toEqual(
      rows.map(
        row =>
          `${row.slice(0, row.indexOf(": ") + 2)}status=200 ` +
          `format=${row.includes("/ json:") ? "8" : "0"} Object.prototype.polluted=undefined`
      )
    );
  });

  it("removes each dangerous own key from a result while leaving lookalike data intact", async () => {
    // The invariant is key REMOVAL, not "this particular merge stayed
    // clean": an author who neutralizes one sink leaves every other merge
    // helper in the ecosystem holding the same key. `constructorName` is
    // the control in the same table, so a strip that over-reaches fails
    // here rather than in someone's application. The codec row carries one
    // key fewer for the encode-side reason noted above, not because the
    // decoder treats it differently.
    const CARRIERS: [Road, string][] = [
      [
        "json",
        '{"__proto__":{"polluted":"a"},"constructor":{"polluted":"b"},' +
          '"prototype":{"polluted":"c"},"constructorName":"Widget","n":1}'
      ],
      [
        "codec",
        '{"__proto__":{"polluted":"a"},"prototype":{"polluted":"c"},' +
          '"constructorName":"Widget","n":1}'
      ]
    ];
    const rows: string[] = [];
    for (const [road, document] of CARRIERS) {
      const { status, value } = await callServerFunction(road, JSON.parse(document));
      rows.push(`${road}: status=${status} ownKeys=${JSON.stringify(Object.keys(value))}`);
    }
    expect(rows).toEqual(
      CARRIERS.map(([road]) => `${road}: status=200 ownKeys=["constructorName","n"]`)
    );
  });

  it("a shallow merge of a decoded result cannot re-prototype the copy (#3168, response leg)", async () => {
    // Verbatim #3168, one leg over: `Object.assign` merges by [[Set]], so
    // an own `__proto__` on the source re-prototypes the destination with
    // attacker-supplied data. This is the exact case the argument decoder
    // was taught to close.
    const rows: string[] = [];
    for (const road of ROADS) {
      const { status, value } = await callServerFunction(
        road,
        JSON.parse('{"displayName":"ada","__proto__":{"isAdmin":true},"n":1}')
      );
      const copy: any = Object.assign({}, value);
      rows.push(
        `${road}: status=${status} reprototyped=${Object.getPrototypeOf(copy) !== Object.prototype} ` +
          `isAdmin=${JSON.stringify(copy.isAdmin)}`
      );
    }
    expect(rows).toEqual(
      ROADS.map(road => `${road}: status=200 reprototyped=false isAdmin=undefined`)
    );
  });

  it("reaches into the Maps and Sets the codec revived, not only plain objects", async () => {
    // The argument-side walk deliberately covers revived collections, and
    // a result is where collections actually show up: returning a `Map`
    // keyed by id is ordinary, and the values inside it are the same
    // user-parsed documents.
    const inMap = await callServerFunction(
      "codec",
      new Map([["ada", JSON.parse('{"__proto__":{"polluted":"inMap"},"n":1}')]])
    );
    deepMerge({}, (inMap.value as Map<string, unknown>).get("ada"));
    const fromMap = takePollution();

    const inSet = await callServerFunction(
      "codec",
      new Set([JSON.parse('{"__proto__":{"polluted":"inSet"},"n":1}')])
    );
    deepMerge({}, [...(inSet.value as Set<unknown>)][0]);
    const fromSet = takePollution();

    expect({ fromMap, fromSet }).toEqual({ fromMap: undefined, fromSet: undefined });
  });

  it("hands the single-flight data slice to its consumer with the key already gone", async () => {
    // The worst destination on this leg: a slice does not merely reach the
    // caller, it is written into the router's cache before the caller's
    // await resolves, from where every later reader picks it up.
    registerServerFunction("response-proto-flight", async () => {
      invocations++;
      return "mutated";
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const request = new Request(new URL(url, "http://localhost"), init);
      request.headers.set("Sec-Fetch-Site", "same-origin");
      return handleServerFunctionRequest(request, {
        collectFlightData: () =>
          JSON.parse('{"/notes":{"__proto__":{"polluted":"viaFlight"},"n":1}}')
      });
    }) as typeof fetch;
    const delivered: any[] = [];
    const unsubscribe = subscribeFlightData(data => {
      delivered.push(data);
    });
    try {
      const value = await createServerReference("response-proto-flight")();
      expect(value).toBe("mutated");
      expect(delivered).toHaveLength(1);
      deepMerge({}, delivered[0]["/notes"]);
      expect({
        sliceKeys: Object.keys(delivered[0]["/notes"]),
        polluted: takePollution()
      }).toEqual({ sliceKeys: ["n"], polluted: undefined });
    } finally {
      unsubscribe();
      globalThis.fetch = original;
    }
  });

  it("strips a hand-built frame decoded through decodeResponse, the integration-facing decoder", async () => {
    // Routers call `decodeResponse` themselves on the responses the
    // transport hands over whole (redirects, revalidation, single-flight
    // payloads without a consumer), so the guarantee has to hold at that
    // entry point too — not only inside the stub. The codec's own encoder
    // refuses an own `constructor`, so this frame is written by hand under
    // placeholder names and renamed, the same technique the argument-leg
    // spec uses: a frame is just text.
    const framed = await serializeString({
      ctorKey: { prototypeKey: { polluted: "viaFrame" } },
      n: 1
    });
    let json = framed.slice(framed.indexOf(";", 1) + 1);
    json = json
      .split('"ctorKey"')
      .join('"constructor"')
      .split('"prototypeKey"')
      .join('"prototype"');
    const length = new TextEncoder().encode(json).byteLength;
    const body = `;0x${length.toString(16).padStart(8, "0")};${json}`;

    const decoded: any = await decodeResponse(
      new Response(body, { headers: { [BODY_FORMAT_HEADER]: "0" } })
    );
    deepMerge({}, decoded);
    expect({ ownKeys: Object.keys(decoded), polluted: takePollution() }).toEqual({
      ownKeys: ["n"],
      polluted: undefined
    });
  });

  it("a `prototype` key in a result cannot re-prototype the class it is merged onto", async () => {
    // `prototype` is the third key the argument leg strips and the one
    // whose sink is a merge onto a constructor rather than onto a plain
    // object — settings folded onto a class, a plugin patching a widget.
    // The key reaches every instance ever made, so parity with the
    // argument leg is not decoration.
    const { status, value } = await callServerFunction(
      "json",
      JSON.parse('{"prototype":{"polluted":"onClass"},"n":1}')
    );
    function Widget(this: any) {}
    deepMerge(Widget, value);
    expect({ status, seenByInstance: (new (Widget as any)() as any).polluted }).toEqual({
      status: 200,
      seenByInstance: undefined
    });
  });
});
