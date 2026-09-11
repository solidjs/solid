/**
 * `transformResult` and the failures it never saw (#3247).
 *
 * The hook documents itself as running "for returned and thrown results
 * alike (`context.thrown` distinguishes)" — and `context.thrown` exists for
 * no other reason. It is the seam an app hangs result policy on: mapping
 * internal errors to a wire shape, tagging a response, writing the audit
 * record that says this call failed.
 *
 * Dispatch honored that on the return path and on one half of the throw
 * path: a thrown `Response` or `ResponseEnvelope` was offered to the hook,
 * because the tail that handles those called it. The plain-thrown tail —
 * `respondThrown`, where a thrown `Error` or a thrown string goes — never
 * did. So the hook saw every SUCCESS and every failure an author already
 * shaped by hand, and none of the failures that happen to the app: a driver
 * error, a null dereference, an assertion, the ones a failure policy is
 * written for. Silently: nothing logged, and the 500 looked the same as it
 * would with no hook at all.
 *
 * The pairing matters as much as the pinning: giving the hook the raw error
 * must not become a way to leak it. The sanitized generic 500 is asserted
 * alongside, so a fix that hands the error to the hook and then forgets to
 * sanitize what it returns cannot go green here. A hook that itself throws
 * is contained the same way the return path contains it (#3171): a
 * sanitized 500, never an escape past the handler.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestEvent } from "@solidjs/web";
import {
  ERROR_HEADER,
  GENERIC_SERVER_ERROR_MESSAGE,
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

const createEvent = (request: Request) => createRequestEvent(request);

function post(id: string) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    body: "[]",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "content-type": "application/json",
      "X-Server-Function-Format": "8",
      "X-Server-Function-Instance": "server-function:test"
    }
  });
}

/** Dispatches `id` with a recording, pass-through `transformResult`. */
async function dispatchWithHook(id: string) {
  const seen: { thrown: boolean; result: string }[] = [];
  const response = await handleServerFunctionRequest(post(id), {
    createEvent,
    transformResult: (event, result, context) => {
      seen.push({
        thrown: context.thrown === true,
        result: result instanceof Error ? `Error: ${result.message}` : String(result)
      });
      return result;
    }
  });
  return { seen, response };
}

describe("the result policy hook sees every outcome it says it sees", () => {
  it("sees a returned value", async () => {
    registerServerFunction("transform-returned", async () => "a value");

    const { seen, response } = await dispatchWithHook("transform-returned");

    expect(response.status).toBe(200);
    expect(seen).toStrictEqual([{ thrown: false, result: "a value" }]);
  });

  it("sees a thrown Response — the half that already works", async () => {
    registerServerFunction("transform-thrown-response", async () => {
      throw new Response(null, { status: 418 });
    });

    const { seen, response } = await dispatchWithHook("transform-thrown-response");

    expect(response.status).toBe(418);
    expect(seen.map(entry => entry.thrown)).toStrictEqual([true]);
  });

  it("sees a thrown Error, the failure shape a failure policy is written for", async () => {
    registerServerFunction("transform-thrown-error", async () => {
      throw new Error("connection to shard 7 refused");
    });

    const { seen, response } = await dispatchWithHook("transform-thrown-error");

    // today: seen is [] — the audit record is never written and the error
    // mapping never runs
    expect(seen).toStrictEqual([{ thrown: true, result: "Error: connection to shard 7 refused" }]);
    // and the answer stays sanitized: the hook getting the real error is
    // not a road for it onto the wire
    expect(response.status).toBe(500);
    expect(response.headers.get(ERROR_HEADER)).toBe(GENERIC_SERVER_ERROR_MESSAGE);
    expect(await response.text()).not.toContain("shard 7");
  });

  it("sees a thrown non-Error value too", async () => {
    registerServerFunction("transform-thrown-string", async () => {
      throw "shard 7 refused";
    });

    const { seen, response } = await dispatchWithHook("transform-thrown-string");

    // today: seen is []
    expect(seen).toStrictEqual([{ thrown: true, result: "shard 7 refused" }]);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("shard 7");
  });

  it("can map a thrown error onto a wire shape by returning a Response", async () => {
    registerServerFunction("transform-thrown-mapped", async () => {
      throw new Error("connection to shard 7 refused");
    });

    const response = await handleServerFunctionRequest(post("transform-thrown-mapped"), {
      createEvent,
      transformResult: (event, result, context) =>
        context.thrown && result instanceof Error
          ? new Response(null, { status: 503, headers: { "Retry-After": "5" } })
          : result
    });

    // selecting the response tail from the hook's output is the point of
    // running it at catch entry: the mapping the docs describe works by
    // returning a Response
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.text()).not.toContain("shard 7");
  });

  it("contains a hook that itself throws, as the return path already does (#3171)", async () => {
    registerServerFunction("transform-thrown-hook-throws", async () => {
      throw new Error("connection to shard 7 refused");
    });

    const response = await handleServerFunctionRequest(post("transform-thrown-hook-throws"), {
      createEvent,
      transformResult: () => {
        throw new Error("audit sink unavailable: redis://cache:6379");
      }
    });

    const body = await response.text();
    expect(response.status).toBe(500);
    expect(response.headers.get(ERROR_HEADER)).toBe(GENERIC_SERVER_ERROR_MESSAGE);
    // neither the function's failure nor the hook's own rides the wire
    expect(body).not.toContain("shard 7");
    expect(body).not.toContain("redis://");
  });
});
