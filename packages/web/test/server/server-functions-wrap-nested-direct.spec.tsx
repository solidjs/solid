/**
 * ENTRY-ONLY SEMANTICS FOR THE PER-HANDLER WRAP, PINNED (#3240).
 *
 * A server function's body may call another server function directly — the
 * reference is in scope, and on the server calling it runs the original
 * in-process rather than going back out over HTTP. Both calls belong to
 * one request, so the question is which of them the request's
 * `wrapInvocation` names.
 *
 * The ruled answer keeps the current split:
 *
 *  - the per-handler OPTION is ENTRY-ONLY. It wraps the invocation the
 *    wire addressed and nothing the dispatched body reaches in-process;
 *    nested direct calls are not re-wrapped by it. (Its TSDoc says so
 *    explicitly.)
 *  - the CONFIGURED hook is ambient: `createServerReference`'s apply trap
 *    consults it for every direct call, nested ones included, so
 *    per-function middleware built on it cannot be bypassed by calling a
 *    function from inside another. An adapter that needs hop-by-hop policy
 *    installs it there, not per handler.
 *
 * No runtime behavior change rides this spec — it exists so the boundary
 * between the two hooks is a documented, regression-tested fact rather
 * than an accident of threading.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestEvent } from "@solidjs/web";
import {
  configureServerFunctionsServer,
  createServerReference as createServerSideReference,
  handleServerFunctionRequest,
  registerServerFunction,
  registerServerReference
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterEach(() => {
  // `undefined` is skipped by configure, so clearing takes a value: the
  // transparent hook is the sanctioned reset (#3238 made null invalid)
  configureServerFunctionsServer({ wrapInvocation: run => run() });
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

/** An entry function whose body calls a second server function in-process. */
function registerPair(prefix: string) {
  let innerRan = 0;
  const inner = createServerSideReference(
    registerServerReference(`${prefix}-inner`, () => {
      innerRan++;
      return "the inner value";
    })
  );
  registerServerFunction(`${prefix}-outer`, async () => (inner as any)());
  return { ranInner: () => innerRan };
}

describe("the per-handler wrapInvocation option is entry-only (#3240)", () => {
  it("wraps the entry invocation and does not re-wrap the nested direct call", async () => {
    const seen: string[] = [];
    const pair = registerPair("nested-option");

    const response = await handleServerFunctionRequest(post("nested-option-outer"), {
      createEvent,
      wrapInvocation: (run, context) => {
        seen.push(`${context.id}:${context.direct ? "direct" : "http"}`);
        return run();
      }
    });

    expect(response.status).toBe(200);
    // the nested body ran — the option gated the entry, not the reach
    expect(pair.ranInner()).toBe(1);
    // ENTRY-ONLY, as ruled: the option saw exactly the invocation the wire
    // addressed. Hop-by-hop policy belongs to the configured hook below.
    expect(seen).toStrictEqual(["nested-option-outer:http"]);
  });

  it("keeps the configured hook ambient: it names the nested direct call too", async () => {
    const seen: string[] = [];
    const pair = registerPair("nested-configured");
    configureServerFunctionsServer({
      wrapInvocation: (run, context) => {
        seen.push(`${context.id}:${context.direct ? "direct" : "http"}`);
        return run();
      }
    });

    const response = await handleServerFunctionRequest(post("nested-configured-outer"), {
      createEvent
    });

    expect(response.status).toBe(200);
    expect(pair.ranInner()).toBe(1);
    // the configured hook is the hop-by-hop seam: entry AND the in-process
    // call the entry made
    expect(seen).toStrictEqual(["nested-configured-outer:http", "nested-configured-inner:direct"]);
  });

  it("does not let a per-handler option displace the configured hook on the nested leg", async () => {
    const seen: string[] = [];
    const pair = registerPair("nested-both");
    configureServerFunctionsServer({
      wrapInvocation: (run, context) => {
        seen.push(`configured:${context.id}`);
        return run();
      }
    });

    const response = await handleServerFunctionRequest(post("nested-both-outer"), {
      createEvent,
      wrapInvocation: (run, context) => {
        seen.push(`option:${context.id}`);
        return run();
      }
    });

    expect(response.status).toBe(200);
    expect(pair.ranInner()).toBe(1);
    // the option owns the entry (it overrides the configured hook there);
    // the nested direct call still runs under the configured, ambient policy
    expect(seen).toStrictEqual(["option:nested-both-outer", "configured:nested-both-inner"]);
  });
});
