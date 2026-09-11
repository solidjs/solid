/**
 * An unknown body-format tag is version skew and must be refused — never
 * silently reinterpreted (#3245).
 *
 * `X-Server-Function-Format` names the encoding of a POST body. The decode
 * switch matches the tag by exact value, and #3130 made the fall-through a
 * 400 instead of calling the function on `undefined` — but only where the
 * fall-through actually fell through. `extractBody`'s content-type sniffing
 * branches (multipart, urlencoded — there for form posts that never saw the
 * client runtime) match REGARDLESS of the tag, so a tagged body whose tag
 * this build has no case for was silently decoded as a form: the function
 * ran on an argument shaped nothing like what the caller encoded, committed,
 * and answered 200. The ordinary way in is not hostile: a newer client build
 * shipping a `BodyFormat` past `Void` behind an older deployment (version
 * skew), or an intermediary duplicating the header (`Headers.get` joins two
 * valid tags into the single unknown value `"8, 9"`).
 *
 * The rule pinned here: a tag names the encoding, so a tag this build cannot
 * read refuses the call — 400, before dispatch — no matter what the
 * content-type would sniff to. Untagged bodies keep the sniffing (that is
 * what it is for), and an untagged empty body stays a zero-argument call
 * (#3214, covered in server-functions-request-bounds.spec.tsx alongside the
 * empty-body-with-unknown-tag refusal).
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs). The DEV
 * message assertion imports the dev artifact directly, the way
 * dist-server-artifact.spec.tsx pins build-only behavior.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
// @ts-ignore — no adjacent type declarations; the dev artifact's runtime
// behavior (the refusal message DEV builds carry) is what's being asserted.
import * as devServer from "../../server-functions/dist/server.dev.js";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
/** The next tag the runtime ships — this build has no case for it. */
const FUTURE_FORMAT = "10";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

function post(id: string, body: BodyInit, headers: Record<string, string> = {}) {
  return new Request(`https://app.example/_server/data/${id}`, {
    method: "POST",
    body,
    headers: {
      "Sec-Fetch-Site": "same-origin",
      "X-Server-Function-Instance": "server-function:test",
      ...headers
    }
  });
}

describe("an unknown format tag refuses the call as version skew (#3245)", () => {
  it("is not hijacked by urlencoded content-type sniffing", async () => {
    const fn = vi.fn(async () => "reached");
    registerServerFunction("skew-urlencoded", fn);
    const response = await handleServerFunctionRequest(
      post("skew-urlencoded", new URLSearchParams({ amount: "100" }).toString(), {
        "Content-Type": "application/x-www-form-urlencoded",
        [BODY_FORMAT_HEADER]: FUTURE_FORMAT
      })
    );
    expect(response.status).toBe(400);
    expect(fn).not.toHaveBeenCalled();
  });

  it("is not hijacked by multipart content-type sniffing", async () => {
    const fn = vi.fn(async () => "reached");
    registerServerFunction("skew-multipart", fn);
    const formData = new FormData();
    formData.append("amount", "100");
    const request = post("skew-multipart", formData);
    request.headers.set(BODY_FORMAT_HEADER, FUTURE_FORMAT);
    const response = await handleServerFunctionRequest(request);
    expect(response.status).toBe(400);
    expect(fn).not.toHaveBeenCalled();
  });

  it("still refuses where the fall-through already refused (#3130 control)", async () => {
    const fn = vi.fn(async () => "reached");
    registerServerFunction("skew-plain", fn);
    const response = await handleServerFunctionRequest(
      post("skew-plain", "[1]", { [BODY_FORMAT_HEADER]: FUTURE_FORMAT })
    );
    expect(response.status).toBe(400);
    expect(fn).not.toHaveBeenCalled();
  });

  it("leaves untagged form posts to the sniffing that exists for them", async () => {
    const fn = vi.fn(async (data: FormData) => data.get("amount"));
    registerServerFunction("skew-untagged-form", fn);
    const formData = new FormData();
    formData.append("amount", "100");
    const response = await handleServerFunctionRequest(post("skew-untagged-form", formData));
    expect(response.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("names version skew in the development refusal", async () => {
    devServer.registerServerFunction("skew-dev-message", async () => "reached");
    const response: Response = await devServer.handleServerFunctionRequest(
      post("skew-dev-message", "[1]", { [BODY_FORMAT_HEADER]: FUTURE_FORMAT })
    );
    expect(response.status).toBe(400);
    const message = await response.text();
    expect(message, `dev refusal read: "${message}"`).toContain("version skew");
    expect(message).toContain(FUTURE_FORMAT);
  });
});
