/**
 * The JSON fast path is a negotiation, not a coercion: a value takes it
 * only when `JSON.stringify` carries it FAITHFULLY. That is the whole
 * contract of `isJSONSafe` (server-functions/shared.js), which both peers
 * consult — the client for argument lists, the server for results — so the
 * codec rides the wire exactly when a value actually needs it.
 *
 * `-0` is the one number that breaks the contract quietly. `JSON.stringify(-0)`
 * is `"0"`, but the guard admits any `Number.isFinite(v)`, so a signed zero
 * takes the fast path and arrives as `+0`. Status 200, the function runs,
 * the sign is simply gone — the failure mode the guard's own siblings were
 * written to prevent (`undefined` corrupted to `null`, a sparse hole read
 * back as `null`).
 *
 * `NaN` and `Infinity`, the other numbers stringify cannot carry, are
 * already refused and ride the codec instead — and the codec encodes `-0`
 * exactly, as its own constant. So this is not "JSON cannot carry it"; it
 * is the fast path claiming a value that belongs to the codec, and it is
 * the one leg of the finite-number guard nobody mirrored. Each test below
 * pairs its case with the `NaN` control that already behaves, so a reader
 * can see the two halves disagree rather than take the claim on faith.
 *
 * The sign is load-bearing wherever a signed zero is the value: a delta
 * that decreased to nothing, a coordinate approached from the negative
 * side, `1 / x` read back as a direction.
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
import {
  configureServerFunctionsClient,
  createServerReference,
  getServerFunctionsCodec,
  serializeString
} from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
  // What `enableRichArguments()` installs, spelled out here because the
  // rich-args entry has no alias in this config. It matters only for the
  // ARGUMENT direction: with the codec available for arguments, nothing
  // forces the fast path's hand, so the question these tests ask is purely
  // "which encoding does the guard choose for -0" and not "does the client
  // have anywhere else to put it". Results never needed the opt-in: the
  // handler always holds both halves of the codec.
  configureServerFunctionsClient({
    serializeArgs: args => serializeString(args, getServerFunctionsCodec())
  });
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

// The client transport's fetch dispatches into the built server handler, so
// each test is a full round trip through both published bundles, and every
// request is captured to show which encoding negotiation actually picked.
function connectTransport() {
  const original = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(input.toString(), "https://app.example"), init);
    request.headers.set("Sec-Fetch-Site", "same-origin");
    requests.push(request.clone());
    return handleServerFunctionRequest(request);
  }) as typeof fetch;
  return {
    requests,
    restore() {
      globalThis.fetch = original;
    }
  };
}

describe("a signed zero on the wire", () => {
  it("reaches the server function as -0, the way NaN already does", async () => {
    const seen: Record<string, unknown> = {};
    registerServerFunction("negative-zero-arg", async (n: number) => {
      seen.arg = n;
      return "ok";
    });
    registerServerFunction("nan-arg", async (n: number) => {
      seen.control = n;
      return "ok";
    });
    const transport = connectTransport();
    try {
      // the control: NaN is refused by the fast path, rides the codec, and
      // arrives intact — the behaviour -0 is measured against
      await createServerReference("nan-arg")(NaN);
      expect(Number.isNaN(seen.control), `NaN control arrived as ${String(seen.control)}`).toBe(
        true
      );

      await createServerReference("negative-zero-arg")(-0);
      expect(
        Object.is(seen.arg, -0),
        `the function was handed ${Object.is(seen.arg, -0) ? "-0" : String(seen.arg)}` +
          ` (1/x = ${1 / (seen.arg as number)}), sent as ${await transport.requests[1].clone().text()}` +
          ` under format ${transport.requests[1].headers.get(BODY_FORMAT_HEADER)}`
      ).toBe(true);
    } finally {
      transport.restore();
    }
  });

  it("comes back from the server function as -0, the way NaN already does", async () => {
    registerServerFunction("negative-zero-result", async () => -0);
    registerServerFunction("nan-result", async () => NaN);
    const transport = connectTransport();
    try {
      const control = await createServerReference("nan-result")();
      expect(Number.isNaN(control), `NaN control came back as ${String(control)}`).toBe(true);

      const result = await createServerReference("negative-zero-result")();
      expect(
        Object.is(result, -0),
        `the call resolved with ${Object.is(result, -0) ? "-0" : String(result)}` +
          ` (1/x = ${1 / (result as number)})`
      ).toBe(true);
    } finally {
      transport.restore();
    }
  });

  it("keeps its sign inside an otherwise JSON-safe object result", async () => {
    // the whole object rides one encoding, so a single unsafe value drags
    // the rest onto the codec: with NaN alongside it the -0 survives today,
    // and without it the same field is flattened. Same data, same shape —
    // only the company it keeps decides whether the sign lives.
    registerServerFunction("negative-zero-field", async () => ({ delta: -0 }));
    registerServerFunction("negative-zero-field-with-nan", async () => ({ delta: -0, other: NaN }));
    const transport = connectTransport();
    try {
      const dragged: any = await createServerReference("negative-zero-field-with-nan")();
      expect(
        Object.is(dragged.delta, -0),
        `the codec road lost the sign too: delta=${String(dragged.delta)}`
      ).toBe(true);

      const plain: any = await createServerReference("negative-zero-field")();
      expect(
        Object.is(plain.delta, -0),
        `the same field, alone, came back as ${String(plain.delta)}`
      ).toBe(true);
    } finally {
      transport.restore();
    }
  });
});
