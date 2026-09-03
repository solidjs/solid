/**
 * A body-format tag the client does not RECOGNISE is not the same thing as
 * a body-format tag being present (#3173, one layer down).
 *
 * The transport's two "is this ours?" guards test the header's PRESENCE: a
 * 4xx/5xx without `X-Server-Function-Format` is the peer refusing, and a
 * 2xx without it (or without `X-Content-Raw`) is infrastructure answering
 * in the origin's place. Both then hand the response to `extractBody`,
 * which matches the tag by exact VALUE and falls through to `undefined` for
 * anything it has no case for. So a tag that is present but unrecognised
 * passes the presence guards, decodes to nothing, and RESOLVES the call —
 * the phantom void result #3173 closed, reopened by a header the runtime
 * never wrote.
 *
 * Two ways in, neither hostile:
 *
 *  - a duplicated header. Intermediaries append rather than replace, and
 *    `Headers.get` joins the duplicates with a comma, so two perfectly
 *    valid tags read back as the single unrecognised value `"8, 9"`.
 *  - version skew. The tag is a small integer that grows with the runtime;
 *    the day a `BodyFormat` past `Void` ships, every client from the
 *    previous build reads the new tag, recognises nothing, and resolves
 *    `undefined` where the truth is "this build cannot read that answer".
 *    #3110 made an unknown *id* legible for exactly this reason; an unknown
 *    *encoding* deserves the same honesty, and silence is the one answer it
 *    must not give.
 *
 * The contrast that makes this a defect rather than a design: the same
 * responses with NO tag at all fail loudly (status 500 rejects with the
 * status; 200 rejects with "no recognized encoding"). Adding a header the
 * client cannot read must not turn a failure into a success.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import { createServerReference } from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
const JSON_FORMAT = "8";
const VOID_FORMAT = "9";
/** The next tag the runtime ships — today's clients have no case for it. */
const FUTURE_FORMAT = "10";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const disconnects: (() => void)[] = [];
afterEach(() => {
  while (disconnects.length) disconnects.pop()!();
});

/**
 * Routes the client stub's fetch into the built handler, or — with
 * `answer` — into a response that came from somewhere else on the way.
 */
function connectTransport(answer?: () => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (answer) return Promise.resolve(answer());
    const address = input instanceof Request ? input.url : input.toString();
    const request = new Request(
      new URL(address, "http://localhost"),
      input instanceof Request ? input : init
    );
    request.headers.set("Sec-Fetch-Site", "same-origin");
    return handleServerFunctionRequest(request);
  }) as typeof fetch;
  disconnects.push(() => {
    globalThis.fetch = original;
  });
}

/** A response tagged with one format value, whatever the client makes of it. */
const tagged = (status: number, tag: string, body: BodyInit | null, type?: string) => () =>
  new Response(body, {
    status,
    headers: { [BODY_FORMAT_HEADER]: tag, ...(type ? { "content-type": type } : {}) }
  });

/**
 * The shape an intermediary produces: the origin's tag plus one appended by
 * something on the path. `Headers.get` joins them, and the join is the value
 * the client actually reads.
 */
const doubleTagged = (status: number, body: BodyInit | null) => () => {
  const headers = new Headers();
  headers.append(BODY_FORMAT_HEADER, JSON_FORMAT);
  headers.append(BODY_FORMAT_HEADER, VOID_FORMAT);
  return new Response(body, { status, headers });
};

describe("unrecognised body-format tags", () => {
  it("fails a success answer whose format tag it cannot read", async () => {
    registerServerFunction("tag-success", async () => "ok");
    for (const answer of [
      tagged(200, FUTURE_FORMAT, '{"total":3}', "application/json"),
      tagged(200, "nonsense", '{"total":3}', "application/json"),
      tagged(201, FUTURE_FORMAT, null)
    ]) {
      connectTransport(answer);
      const status = answer().status;
      const tag = answer().headers.get(BODY_FORMAT_HEADER);
      await expect(
        createServerReference("tag-success")(),
        `status ${status} tagged ${tag} must not resolve`
      ).rejects.toBeInstanceOf(Error);
      connectTransport(answer);
      await expect(createServerReference("tag-success")()).rejects.toMatchObject({ status });
    }
    // the control the tags above are read against: the two tags this build
    // does know still decode, so the pin is on recognition, not presence
    connectTransport(tagged(200, JSON_FORMAT, '{"total":3}', "application/json"));
    expect(await createServerReference("tag-success")()).toEqual({ total: 3 });
    connectTransport(tagged(200, VOID_FORMAT, null));
    expect(await createServerReference("tag-success")()).toBeUndefined();
  });

  it("fails a refusal whose format tag it cannot read", async () => {
    registerServerFunction("tag-refusal", async () => "ok");
    // The presence guard at 400-and-up exists to tell a peer's refusal from
    // an authored status; a tag nothing in this build can read is no
    // evidence the runtime wrote the answer, and a 500 that resolves
    // `undefined` is the worst outcome available.
    for (const answer of [
      tagged(500, FUTURE_FORMAT, null),
      tagged(502, "nonsense", "<html>bad gateway</html>", "text/html"),
      tagged(403, FUTURE_FORMAT, null)
    ]) {
      connectTransport(answer);
      const status = answer().status;
      await expect(
        createServerReference("tag-refusal")(),
        `status ${status} tagged ${answer().headers.get(BODY_FORMAT_HEADER)} must not resolve`
      ).rejects.toMatchObject({ status });
    }
    // the control: the same statuses with a tag this build reads are the
    // author's own answer and keep resolving (#3097)
    connectTransport(tagged(500, JSON_FORMAT, '{"field":"required"}', "application/json"));
    expect(await createServerReference("tag-refusal")()).toEqual({ field: "required" });
  });

  it("fails a call whose format header arrived twice", async () => {
    registerServerFunction("tag-doubled", async () => "ok");
    // Nothing here is malformed on the wire: both values are tags the
    // runtime writes. `Headers.get` hands the client `"8, 9"`, which is
    // neither, and a proxy that appends its own copy of a header is
    // ordinary — this needs no hostile peer, only a hop.
    for (const status of [200, 500]) {
      connectTransport(doubleTagged(status, null));
      await expect(
        createServerReference("tag-doubled")(),
        `duplicated format header at status ${status} must not resolve`
      ).rejects.toMatchObject({ status });
    }
  });
});
