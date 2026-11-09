/**
 * A no-JS form post to a function answering `respond(value, { headers })`:
 * the dispatch unwraps the envelope and hands the no-JS handler only the
 * value, so the envelope's Set-Cookie (a session the mutation established)
 * never reaches the 303. A scripted call, an unscripted call and a
 * `respond(undefined, …)` form post all deliver it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { respond } from "@solidjs/web";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");
beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
  (globalThis as any).__SOLID_SECRET__ = "nojs-envelope-cookie";
});
afterAll(() => {
  delete (globalThis as any)[RequestContext];
  delete (globalThis as any).__SOLID_SECRET__;
});

const formPost = (id: string) =>
  new Request(`https://app.example/_server/${id}`, {
    method: "POST",
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://app.example/login"
    },
    body: "user=a"
  });

const sessions = (response: Response) =>
  response.headers.getSetCookie().filter(c => c.startsWith("session="));

describe("no-JS form post and a respond() envelope's cookies", () => {
  it("a returned envelope with a value keeps its Set-Cookie", async () => {
    registerServerFunction("nojs-envelope-cookie-return", async () =>
      respond({ ok: true }, { headers: { "Set-Cookie": "session=abc; Path=/" } })
    );
    const response = await handleServerFunctionRequest(formPost("nojs-envelope-cookie-return"));
    expect(response.status).toBe(303);
    expect(sessions(response)).toEqual(["session=abc; Path=/"]);
  });

  it("a thrown envelope with a value keeps its Set-Cookie", async () => {
    registerServerFunction("nojs-envelope-cookie-throw", async () => {
      throw respond(
        { error: "bad" },
        { status: 400, headers: { "Set-Cookie": "session=abc; Path=/" } }
      );
    });
    const response = await handleServerFunctionRequest(formPost("nojs-envelope-cookie-throw"));
    expect(sessions(response)).toEqual(["session=abc; Path=/"]);
  });

  it("a custom handleNoJS answer also keeps the envelope's Set-Cookie", async () => {
    registerServerFunction("nojs-envelope-cookie-custom", async () =>
      respond({ ok: true }, { headers: { "Set-Cookie": "session=abc; Path=/" } })
    );
    const response = await handleServerFunctionRequest(formPost("nojs-envelope-cookie-custom"), {
      handleNoJS: async () => Response.redirect("https://app.example/done", 303)
    });
    expect(response.headers.get("Location")).toBe("https://app.example/done");
    expect(sessions(response)).toEqual(["session=abc; Path=/"]);
  });

  it("control: a void envelope already keeps it", async () => {
    registerServerFunction("nojs-envelope-cookie-void", async () =>
      respond(undefined, { headers: { "Set-Cookie": "session=abc; Path=/" } })
    );
    const response = await handleServerFunctionRequest(formPost("nojs-envelope-cookie-void"));
    expect(sessions(response)).toEqual(["session=abc; Path=/"]);
  });
});
