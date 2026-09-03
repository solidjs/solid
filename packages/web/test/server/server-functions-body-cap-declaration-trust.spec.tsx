/**
 * The body cap must bound the bytes the runtime actually buffers, not the
 * bytes a peer SAYS it will send.
 *
 * `bodySizeLimit` exists because the argument payload is buffered and
 * decoded before dispatch, so its cost is paid before application code can
 * decline it (#3115). An over-declaration is refused before a byte is read
 * — that much a declaration is good for — and the bound itself is taken by
 * the counting read in `bufferBodyWithin`, which stops at the limit. It was
 * the declaration that decided which of those happened: the gate read
 * `if (!(declared > 0))`, so ANY positive digit string was trusted and the
 * counting read skipped entirely, and `Content-Length: 10` on a 2 MiB body
 * against a 1 MiB cap dispatched the whole 2 MiB into the function.
 *
 * The defence is internally inconsistent about the same header from the
 * same untrusted producer: #3153 already established that a `-1` must not
 * be believed — "an adapter that builds the Request itself, or a rewriting
 * proxy, delivers it here" — and routed it through the cap. A `10` on a
 * 2 MiB body is the same lie by the same producer, and is believed.
 *
 * This is defence in depth, not a live bypass: stock `node:http` frames the
 * body BY the declaration and rejects `Content-Length` + `Transfer-Encoding`
 * together, so llhttp truncates such a request at 10 bytes long before this
 * code sees it. The exposure is every producer that builds the `Request`
 * itself and is not llhttp — adapters, proxies, test harnesses, WinterCG
 * runtimes — which is exactly the population #3153 named when it decided a
 * non-conforming declaration is not evidence. The invariant pinned here is
 * the one the cap advertises and the one a reader assumes: no more than
 * `bodySizeLimit` bytes reach the decoder, whatever the header claims.
 *
 * The refusal is spelled 413 because that is what the counting read already
 * answers for an undeclared body of the same size; the substantive half of
 * each assertion is that the oversized payload never reached the function.
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

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
const JSON_FORMAT = "8";
const LIMIT = 1024 * 1024;

let received: number | null = null;

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
  registerServerFunction("cap-declaration-sink", async (payload: unknown) => {
    received = typeof payload === "string" ? payload.length : -1;
    return "reached";
  });
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

// A 2 MiB argument string — twice the cap the calls below configure — and
// its well-behaved counterpart, an ordinary 4 KiB POST.
const oversized = JSON.stringify(["x".repeat(2 * LIMIT)]);
const modest = JSON.stringify(["y".repeat(4096)]);

async function post(body: string, declaration: string | null) {
  received = null;
  const headers: Record<string, string> = {
    "Sec-Fetch-Site": "same-origin",
    "X-Server-Function-Instance": "server-function:test",
    [BODY_FORMAT_HEADER]: JSON_FORMAT
  };
  // undici only computes Content-Length at fetch time, so a Request built
  // here declares exactly what this line declares, and nothing when it
  // declares nothing — the two roads through the gate, side by side.
  if (declaration !== null) headers["content-length"] = declaration;
  const response = await handleServerFunctionRequest(
    new Request("https://app.example/_server/data/cap-declaration-sink", {
      method: "POST",
      body,
      headers
    }),
    { bodySizeLimit: LIMIT }
  );
  return { status: response.status, reachedFunction: received };
}

// One row per declaration so a failure names which declarations were
// believed rather than only the first.
const label = (declaration: string | null) => `Content-Length: ${declaration ?? "(absent)"}`;

function row(declaration: string | null, r: { status: number; reachedFunction: number | null }) {
  return `${label(declaration)} -> status=${r.status} bytesReachingFunction=${
    r.reachedFunction === null ? "none" : r.reachedFunction
  }`;
}

describe("the body cap against an under-declared Content-Length", () => {
  it("bounds the bytes it buffers by what arrives, not by what the declaration claims", async () => {
    // One table, because the controls are the point as much as the repros:
    // an honest declaration under the cap must still dispatch, intact, and
    // an honest over-declaration must still be refused before a byte is
    // read. Closing the hole may not cost either.
    const cases: Array<[string | null, string, string]> = [
      // declaration                body        expected row
      [null, oversized, "status=413 bytesReachingFunction=none"],
      ["0", oversized, "status=413 bytesReachingFunction=none"],
      ["10", oversized, "status=413 bytesReachingFunction=none"],
      ["1024", oversized, "status=413 bytesReachingFunction=none"],
      [String(LIMIT), oversized, "status=413 bytesReachingFunction=none"],
      ["999999999999", oversized, "status=413 bytesReachingFunction=none"],
      // an honest declaration of the oversized body: refused before the read
      [String(Buffer.byteLength(oversized)), oversized, "status=413 bytesReachingFunction=none"],
      // the control: an ordinary browser POST under the cap, delivered whole
      [String(Buffer.byteLength(modest)), modest, "status=200 bytesReachingFunction=4096"]
    ];
    const rows: string[] = [];
    for (const [declaration, body] of cases) {
      rows.push(row(declaration, await post(body, declaration)));
    }
    // Observed on HEAD: every positive declaration smaller than the body is
    // believed, so `Content-Length: 10` answers 200 with the whole
    // 2097152-byte argument delivered to the function — the cap is not
    // merely late, it is off.
    expect(rows).toEqual(
      cases.map(([declaration, , expected]) => `${label(declaration)} -> ${expected}`)
    );
  });
});
