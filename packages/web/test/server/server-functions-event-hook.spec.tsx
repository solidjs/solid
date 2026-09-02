/**
 * `createEvent`'s await (#3199). #3170 made the runtime tolerate an async
 * `createEvent` by awaiting its return — but it duck-types the value:
 *
 *   if (typeof event?.then === "function") event = await event;
 *
 * Anything carrying a `then` is treated as a promise. An event that merely
 * LOOKS thenable — a lazy-locals Proxy answering any unknown key, a tracing
 * wrapper — is awaited on a `then` nobody ever calls, and the request hangs
 * with no response, no timeout and no log. One spelling is worse: a `then`
 * that resolves with the event itself spins the promise-resolution
 * procedure forever and starves the whole event loop, not just the request.
 *
 * The second half is independent: the call sits outside every try, so a
 * rejecting `createEvent` — a session store that is down, which is exactly
 * the condition the hook exists to survive — escapes `handleServerFunctionRequest`
 * with no status at all.
 *
 * Like the other server-function specs, these run against the built
 * bundles (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  decodeResponse,
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

const stamp = (event: any) => {
  event.response.headers.append("Set-Cookie", "sid=abc; Path=/");
  return event;
};
const ForeignPromise = runInNewContext("Promise");

/** Answers within `ms` or reports the hang as a value, never as a timeout. */
async function within<T>(work: Promise<T>, ms = 1000): Promise<T | "HUNG"> {
  let timer: any;
  const result = await Promise.race([
    work,
    new Promise<"HUNG">(resolve => (timer = setTimeout(() => resolve("HUNG"), ms)))
  ]);
  clearTimeout(timer);
  return result;
}

describe("a thenable createEvent still dispatches (#3199)", () => {
  // Every spelling of "carries a then" that an integration can arrive at by
  // accident. None of them is a promise; all of them are awaited today.
  const thenables: [string, (request: Request) => unknown][] = [
    [
      "an own `then` that never settles",
      request => {
        const event: any = stamp(createRequestEvent(request));
        event.then = () => {};
        return event;
      }
    ],
    [
      "a non-enumerable own `then`",
      request => {
        const event: any = stamp(createRequestEvent(request));
        Object.defineProperty(event, "then", { value: () => {}, enumerable: false });
        return event;
      }
    ],
    [
      "`then` behind a getter",
      request => {
        const event: any = stamp(createRequestEvent(request));
        Object.defineProperty(event, "then", { get: () => () => {}, configurable: true });
        return event;
      }
    ],
    // the realistic shape: a lazy-locals / auto-stub proxy answers ANY
    // unknown key with something, and `then` is an unknown key
    [
      "a Proxy answering unknown keys",
      request => {
        const event: any = stamp(createRequestEvent(request));
        return new Proxy(event, {
          get: (target, key) =>
            key in target ? (target as any)[key] : key === "then" ? () => {} : undefined
        });
      }
    ],
    // NOTE: this row starves the event loop before the fix — the promise
    // resolution procedure re-adopts the same thenable forever. Post-fix it
    // is never awaited at all.
    [
      "a `then` that resolves with the event itself",
      request => {
        const event: any = stamp(createRequestEvent(request));
        event.then = (resolve: (v: unknown) => void) => resolve(event);
        return event;
      }
    ]
  ];

  test.each(thenables)("%s dispatches normally", async (label, createEvent) => {
    const id = "event-thenable-" + label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    let ran = 0;
    registerServerFunction(id, async () => {
      ran++;
      return "ok";
    });

    const response = await within(
      handleServerFunctionRequest(scriptedPost(id), { createEvent: createEvent as any })
    );

    expect(response).not.toBe("HUNG");
    expect((response as Response).status).toBe(200);
    expect(ran).toBe(1);
    // the event is still the integration's event: its stub folds as always
    expect((response as Response).headers.getSetCookie()).toContain("sid=abc; Path=/");
  });
});

describe("a failing createEvent is answered, not escaped (#3199)", () => {
  const failing: [string, (request: Request) => unknown][] = [
    [
      "a rejecting async createEvent",
      async () => {
        throw new Error("session store unreachable");
      }
    ],
    [
      "a rejecting cross-realm createEvent",
      () => ForeignPromise.reject(new Error("session store unreachable"))
    ],
    [
      "a synchronously throwing createEvent",
      () => {
        throw new Error("session store unreachable");
      }
    ]
  ];

  test.each(failing)("%s answers a sanitized 500", async (label, createEvent) => {
    const id = "event-failing-" + label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    let ran = 0;
    registerServerFunction(id, async () => {
      ran++;
      return "unreached";
    });

    const response = await within(
      handleServerFunctionRequest(scriptedPost(id), { createEvent: createEvent as any })
    );

    expect(response).not.toBe("HUNG");
    expect((response as Response).status).toBe(500);
    // sanitized: the store's own message is not the caller's business
    expect((response as Response).headers.get("X-Server-Function-Error")).toBe(
      "Internal Server Error"
    );
    expect((response as Response).headers.get("X-Server-Function-Format")).toBe("0");
    const decoded = await decodeResponse(response as Response);
    expect(decoded).toBeInstanceOf(Error);
    expect((decoded as Error).message).toBe("Internal Server Error");
    expect(ran).toBe(0);
  });
});

describe("the awaited shapes #3170 added keep working (#3199 baseline)", () => {
  const controls: [string, (request: Request) => unknown][] = [
    [
      "a genuinely async createEvent",
      async (request: Request) => {
        await Promise.resolve();
        return stamp(createRequestEvent(request));
      }
    ],
    [
      "a cross-realm Promise",
      request => ForeignPromise.resolve(stamp(createRequestEvent(request)))
    ],
    ["a plain synchronous createEvent", request => stamp(createRequestEvent(request))]
  ];

  test.each(controls)("%s still lands its cookies on the wire", async (label, createEvent) => {
    const id = "event-control-" + label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    let ran = 0;
    registerServerFunction(id, async () => {
      ran++;
      return "ok";
    });

    const response = await within(
      handleServerFunctionRequest(scriptedPost(id), { createEvent: createEvent as any })
    );

    expect(response).not.toBe("HUNG");
    expect((response as Response).status).toBe(200);
    expect(ran).toBe(1);
    expect((response as Response).headers.getSetCookie()).toContain("sid=abc; Path=/");
  });
});
