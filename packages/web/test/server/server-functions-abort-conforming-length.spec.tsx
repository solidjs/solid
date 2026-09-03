/**
 * A client that hangs up mid-upload must settle the request and tear down
 * the upload source — on the road that carries the traffic.
 *
 * Fetch does not couple a `Request`'s signal to its body stream, so nothing
 * wakes a pending `read()` when the host abandons the request: the handler
 * never settles and the source is never cancelled (#3217/#3219). The fix in
 * e220cfae wires `request.signal` to the reader — but it wires it inside
 * `bufferBodyWithin`, which dispatch only reaches under the
 * `if (!(declared > 0))` gate. So the coupling is installed exactly on the
 * bodies that declared no length (chunked uploads), and skipped for a
 * conforming `Content-Length` — which is what every ordinary browser POST,
 * `fetch` with a string/FormData body, and the shipped client stub sends.
 * The leak was fixed on the side road and left open on the main one.
 *
 * Observed on HEAD with the abort fired 60 ms into a stalled upload and
 * 800 ms of grace:
 *
 *   no content-length : settled=400     source cancelled, reason AbortError
 *   content-length=200: settled=PENDING source live, never cancelled
 *
 * A never-settling handler is not a slow one: the connection's request task,
 * its buffered chunks and the upload source all stay resident for as long as
 * the process lives, and a peer that can abort can open another. That is the
 * whole point of #3218 — it just has to hold for both declarations, since
 * the abort has nothing to do with how the body's length was framed.
 *
 * These pin the coupling, not a buffering strategy: whatever a fix decides
 * to do with the body, it must install the coupling on the road that
 * declared a length too. What it may not buy the coupling with is the
 * declaration check itself — "refuses a declared length past the limit
 * without reading the body" in server-functions-request-bounds pins that a
 * peer announcing an oversized payload is still answered before a byte is
 * read, and the sibling spec (server-functions-body-cap-declaration-trust)
 * pins from the other side that the bound is measured on the bytes that
 * arrive.
 *
 * The settled answer is spelled 400 to match the undeclared road: an upload
 * that ended early is an incomplete argument encoding, not a handler
 * failure (#3217).
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
const JSON_FORMAT = "8";

const dispatched = vi.fn(async () => "reached");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
  registerServerFunction("abort-coupling-sink", dispatched);
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const PENDING = Symbol("pending");

async function within<T>(promise: Promise<T>, ms: number) {
  let timer!: ReturnType<typeof setTimeout>;
  const outcome = await Promise.race([
    promise,
    new Promise<typeof PENDING>(resolve => {
      timer = setTimeout(() => resolve(PENDING), ms);
    })
  ]);
  clearTimeout(timer);
  return outcome;
}

/**
 * Starts an upload that enqueues one byte and then stalls forever, aborts
 * the request once dispatch is actually reading it, and reports what the
 * runtime did with the abort.
 */
async function abortMidUpload(declaration: string | null) {
  dispatched.mockClear();
  const abort = new AbortController();
  let sourceController!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  let cancelReason: any = null;
  let signalPullStarted!: () => void;
  const pullStarted = new Promise<void>(resolve => (signalPullStarted = resolve));
  const body = new ReadableStream({
    start(controller) {
      sourceController = controller;
      controller.enqueue(new Uint8Array([91])); // "["
    },
    pull() {
      // the upload the client is still sending when it disappears
      signalPullStarted();
      return new Promise<void>(() => {});
    },
    cancel(reason) {
      cancelled = true;
      cancelReason = reason;
    }
  });
  const headers: Record<string, string> = {
    "Sec-Fetch-Site": "same-origin",
    "X-Server-Function-Instance": "server-function:test",
    [BODY_FORMAT_HEADER]: JSON_FORMAT
  };
  // A conforming declaration is the ONLY difference between the two rows.
  if (declaration !== null) headers["content-length"] = declaration;

  const pending = handleServerFunctionRequest(
    new Request("https://app.example/_server/data/abort-coupling-sink", {
      method: "POST",
      body,
      duplex: "half",
      signal: abort.signal,
      headers
    } as RequestInit)
  ).then(
    response => `status=${response.status}` as const,
    error => `threw=${error?.name ?? error}` as const
  );

  await pullStarted;
  await new Promise(resolve => setTimeout(resolve, 60));
  abort.abort(new DOMException("client gone", "AbortError"));

  const outcome = await within(pending, 800);
  // Release the stalled source so a failing row cannot leave the reader (or
  // the test run) parked, and so the assertions below describe the state at
  // the deadline rather than after cleanup.
  if (outcome === PENDING) {
    sourceController.error(new Error("test cleanup"));
    await within(pending, 1000);
  }
  return {
    settled: outcome === PENDING ? "PENDING" : outcome,
    ran: dispatched.mock.calls.length,
    cancelled,
    reason: cancelReason?.name ?? (cancelReason === null ? "none" : String(cancelReason))
  };
}

function row(
  declaration: string | null,
  r: { settled: string; ran: number; cancelled: boolean; reason: string }
) {
  return `content-length ${declaration ?? "(absent)"}: settled=${r.settled} ran=${
    r.ran
  } sourceCancelled=${r.cancelled} cancelReason=${r.reason}`;
}

describe("an aborted upload", () => {
  it("settles the request and cancels the source whether or not the body declared a length", async () => {
    const undeclared = await abortMidUpload(null);
    const declared = await abortMidUpload("200");
    // Rendered as a pair so the failure names the asymmetry itself: the
    // undeclared row is the behaviour #3218 already secured, the declared
    // row is the same request on the road the browsers use.
    expect([row(null, undeclared), row("200", declared)]).toEqual([
      "content-length (absent): settled=status=400 ran=0 sourceCancelled=true cancelReason=AbortError",
      "content-length 200: settled=status=400 ran=0 sourceCancelled=true cancelReason=AbortError"
    ]);
  });

  it("does not park the handler forever when the body declared a length", async () => {
    // The half of the invariant that costs a process: even setting the
    // cancellation aside, the response promise must resolve. On HEAD this
    // one never does.
    const declared = await abortMidUpload("200");
    expect(row("200", declared)).not.toContain("settled=PENDING");
    expect(declared.settled).toBe("status=400");
  });
});
