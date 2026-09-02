/**
 * The descriptor literal in guardFailures' accessor materialization
 * (#3196, #3198). One line writes back every slot the walk rewrites:
 *
 *   { value, writable: true, enumerable: true, configurable: true }
 *
 * Two defects come out of it, and one fix settles both.
 *
 * - `enumerable: true` is unconditional, so a property the author hid from
 *   serialization with `enumerable: false` is now materialized as an
 *   enumerable data property and SHIPPED (#3198). Before #3176 it never
 *   left the server.
 * - The shell is rebuilt with `Object.create(prototype, descriptors)`, so
 *   a FROZEN original hands it non-configurable, non-writable slots — and
 *   redefining one is a TypeError. The call answers 500 after its side
 *   effects committed, carrying the mutation's own Set-Cookie on the same
 *   response (#3196).
 *
 * Both tables are the adjacent-shape map: the rows that fail today, and
 * the rows that pass today and a careless fix must not break.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import { createRequestEvent } from "@solidjs/web";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const H = {
  "Sec-Fetch-Site": "same-origin",
  "X-Server-Function-Format": "8",
  "X-Server-Function-Instance": "server-function:test"
};

function scriptedPost(id: string) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    body: "[]",
    headers: H
  });
}

/** Decodes a result response on whichever road it took. */
async function decode(response: Response) {
  if (response.headers.get("X-Server-Function-Format") === "8") return response.json();
  const { deserializeStream } = await import("@solidjs/web/server-functions/client");
  return deserializeStream(response);
}

describe("a frozen result is not a failed call (#3196)", () => {
  // Every row is a container whose walk REWRITES at least one slot — a
  // channel the guard wraps, or an accessor it materializes — on the codec
  // road. `Object.freeze` on a returned DTO is ordinary defensive
  // authoring, and the same value without the freeze round-trips fine.
  const rewriting: [string, () => unknown][] = [
    [
      "frozen object holding a promise",
      () => Object.freeze({ id: 9, receipt: Promise.resolve("R-9") })
    ],
    [
      "frozen object with a plain getter",
      () =>
        Object.freeze({
          a: 1,
          get computed() {
            return "cheap";
          }
        })
    ],
    [
      "frozen object with a non-enumerable getter beside a Date",
      () => {
        const row: any = { name: "widget", createdAt: new Date(0) };
        Object.defineProperty(row, "hidden", {
          get: () => "H",
          enumerable: false,
          configurable: true
        });
        return Object.freeze(row);
      }
    ],
    [
      "frozen object holding a ReadableStream",
      () =>
        Object.freeze({
          s: new ReadableStream({
            start(c) {
              c.enqueue("x");
              c.close();
            }
          })
        })
    ],
    [
      "frozen object holding an async iterable",
      () =>
        Object.freeze({
          it: (async function* () {
            yield 1;
          })()
        })
    ],
    [
      "frozen object nested inside an ordinary result",
      () => ({ outer: 1, inner: Object.freeze({ r: Promise.resolve("R") }) })
    ]
  ];

  // The shapes that already answer 200. A fix that reaches wider than the
  // rewritten slot — freezing the shell, or refusing frozen containers —
  // breaks these, so they are pinned as the baseline.
  const working: [string, () => unknown][] = [
    ["sealed object holding a promise", () => Object.seal({ r: Promise.resolve("R") })],
    [
      "writable:false alone",
      () => {
        const o: any = {};
        Object.defineProperty(o, "r", {
          value: Promise.resolve("R"),
          writable: false,
          enumerable: true,
          configurable: true
        });
        return o;
      }
    ],
    [
      "configurable:false alone",
      () => {
        const o: any = {};
        Object.defineProperty(o, "r", {
          value: Promise.resolve("R"),
          writable: true,
          enumerable: true,
          configurable: false
        });
        return o;
      }
    ],
    ["frozen array of a promise", () => Object.freeze([Promise.resolve("R")])],
    ["frozen Map holding a promise", () => Object.freeze(new Map([["r", Promise.resolve("R")]]))],
    ["frozen Set holding a promise", () => Object.freeze(new Set([Promise.resolve("R")]))],
    ["frozen plain data (JSON road)", () => Object.freeze({ n: 1 })],
    [
      "frozen object holding a Date (codec road, no slot rewritten)",
      () => Object.freeze({ d: new Date(0) })
    ],
    ["the same shape unfrozen", () => ({ id: 9, receipt: Promise.resolve("R-9") })]
  ];

  test.each([...rewriting, ...working])(
    "%s answers 200 and never reports a committed call as failed",
    async (label, make) => {
      const id = "descriptors-" + label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      let committed = 0;
      registerServerFunction(id, async () => {
        committed++;
        return make();
      });

      const response = await handleServerFunctionRequest(scriptedPost(id), {
        createEvent: (request: Request) => {
          const event = createRequestEvent(request);
          event.response.headers.append("Set-Cookie", "order=9; Path=/");
          return event;
        }
      });

      expect(committed).toBe(1);
      // the wire must not say "failed" and "succeeded" at once: the
      // mutation's own Set-Cookie is on this response either way
      expect(response.headers.getSetCookie()).toContain("order=9; Path=/");
      expect(response.headers.get("X-Server-Function-Error")).toBeNull();
      expect(response.status).toBe(200);
      // and the value actually round-trips, so a 200 built by dropping the
      // result would not pass either
      await expect(decode(response)).resolves.toBeDefined();
    }
  );

  test("a guarded rebuild preserves an authored own __proto__ property", async () => {
    registerServerFunction("descriptors-own-proto", async () => {
      const result: any = { receipt: Promise.resolve("R") };
      Object.defineProperty(result, "__proto__", {
        value: "kept",
        writable: false,
        enumerable: true,
        configurable: false
      });
      return Object.freeze(result);
    });

    const response = await handleServerFunctionRequest(scriptedPost("descriptors-own-proto"));
    const result = await decode(response);

    expect(response.status).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(true);
    expect(result["__proto__"]).toBe("kept");
  });
});

describe("a non-enumerable accessor is not serialized (#3198)", () => {
  const SECRET = "COST-SECRET-42";

  // `enumerable: false` is the mechanism JSON.stringify honours and the one
  // an author reaches for to keep a computed field server-side. Every row
  // asserts the wire body against that same baseline.
  const rows: [string, () => any, boolean][] = [
    // [label, factory, secret expected on the wire]
    ["non-enumerable accessor beside a Date", () => hidden("accessor", new Date(0)), false],
    ["non-enumerable accessor beside a Map", () => hidden("accessor", new Map([["a", 1]])), false],
    ["non-enumerable accessor beside a Set", () => hidden("accessor", new Set([1])), false],
    [
      "non-enumerable accessor beside a promise",
      () => hidden("accessor", Promise.resolve("R")),
      false
    ],
    ["non-enumerable accessor beside an undefined", () => hidden("accessor", undefined), false],
    [
      "non-enumerable accessor nested one level down",
      () => ({ wrap: hidden("accessor", new Date(0)) }),
      false
    ],
    // controls that already pass and must keep passing
    ["non-enumerable accessor alone (JSON road)", () => hidden("accessor", "plain"), false],
    ["non-enumerable DATA property beside a Date", () => hidden("data", new Date(0)), false],
    [
      "non-enumerable DATA property beside a promise",
      () => hidden("data", Promise.resolve("R")),
      false
    ],
    [
      "an ENUMERABLE accessor is still serialized",
      () => {
        const row: any = { name: "widget", extra: new Date(0) };
        Object.defineProperty(row, "visible", {
          get: () => SECRET,
          enumerable: true,
          configurable: true
        });
        return row;
      },
      true
    ]
  ];

  function hidden(kind: "accessor" | "data", companion: unknown) {
    const row: any = { name: "widget", extra: companion };
    Object.defineProperty(
      row,
      "internalCostBasis",
      kind === "accessor"
        ? { get: () => SECRET, enumerable: false, configurable: true }
        : { value: SECRET, enumerable: false, writable: true, configurable: true }
    );
    return row;
  }

  test.each(rows)("%s", async (label, make, onWire) => {
    const id = "nonenum-" + label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    registerServerFunction(id, async () => make());

    const response = await handleServerFunctionRequest(scriptedPost(id));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body.includes(SECRET)).toBe(onWire);
  });

  test("a non-enumerable getter is not invoked while another slot is guarded", async () => {
    let reads = 0;
    registerServerFunction("nonenum-getter-not-read", async () => {
      const result: any = { receipt: Promise.resolve("R") };
      Object.defineProperty(result, "hidden", {
        get() {
          reads++;
          throw new Error("hidden getter must stay unread");
        },
        enumerable: false,
        configurable: true
      });
      return result;
    });

    const response = await handleServerFunctionRequest(scriptedPost("nonenum-getter-not-read"));

    expect(response.status).toBe(200);
    expect(reads).toBe(0);
  });
});
