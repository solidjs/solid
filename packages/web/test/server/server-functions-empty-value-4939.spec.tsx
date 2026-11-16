/**
 * #4939: a lone argument whose encoding is no bytes (`''`, an empty
 * `URLSearchParams`, `Blob`, `ArrayBuffer` or `Uint8Array`) goes out as a
 * tagged zero-length body. A Node host hands that request on with a null
 * body (it attaches one only for a non-zero Content-Length), and the
 * bodyless-POST road read it as a zero-argument call: `echo('')` ran as
 * `echo(undefined)`. The tag says one argument was sent, so it decodes from
 * the empty body, null or not. An untagged empty POST stays a zero-argument
 * call (#3214), and a tag with no empty encoding still decodes as before.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";

let calls: unknown[][] = [];

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
  registerServerFunction("empty-value-sink", async (...args: unknown[]) => {
    calls.push(args);
    return args.length;
  });
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

function emptyStream() {
  return new ReadableStream({
    start(controller) {
      controller.close();
    }
  });
}

async function call(headers: Record<string, string>, body?: "null" | "stream") {
  calls = [];
  const response = await handleServerFunctionRequest(
    new Request("https://app.example/_server/data/empty-value-sink", {
      method: "POST",
      ...(body === "stream" ? { body: emptyStream(), duplex: "half" } : {}),
      headers: { "Sec-Fetch-Site": "same-origin", "content-length": "0", ...headers }
    } as RequestInit)
  );
  return { status: response.status, args: calls[0] };
}

describe("#4939: a tagged empty-value argument on a bodyless POST", () => {
  for (const body of ["null", "stream"] as const) {
    it(`'' arrives as '' (${body} body)`, async () => {
      const { status, args } = await call(
        { [BODY_FORMAT_HEADER]: "1", "content-type": "text/plain" },
        body
      );
      expect(status).toBe(200);
      expect(args).toEqual([""]);
    });
  }

  it("an empty URLSearchParams arrives as one", async () => {
    const { status, args } = await call({
      [BODY_FORMAT_HEADER]: "3",
      "content-type": "application/x-www-form-urlencoded"
    });
    expect(status).toBe(200);
    expect(args).toHaveLength(1);
    expect(args![0]).toBeInstanceOf(URLSearchParams);
    expect([...(args![0] as URLSearchParams)]).toEqual([]);
  });

  it("an empty Blob, ArrayBuffer and Uint8Array arrive as themselves", async () => {
    const blob = await call({ [BODY_FORMAT_HEADER]: "4" });
    expect(blob.status).toBe(200);
    expect(blob.args![0]).toBeInstanceOf(Blob);
    expect((blob.args![0] as Blob).size).toBe(0);

    const buffer = await call({ [BODY_FORMAT_HEADER]: "6" });
    expect(buffer.status).toBe(200);
    expect(buffer.args![0]).toBeInstanceOf(ArrayBuffer);
    expect((buffer.args![0] as ArrayBuffer).byteLength).toBe(0);

    const bytes = await call({ [BODY_FORMAT_HEADER]: "7" });
    expect(bytes.status).toBe(200);
    expect(bytes.args![0]).toBeInstanceOf(Uint8Array);
    expect((bytes.args![0] as Uint8Array).length).toBe(0);
  });

  it("an untagged bodyless POST stays a zero-argument call (#3214)", async () => {
    const { status, args } = await call({});
    expect(status).toBe(200);
    expect(args).toEqual([]);
  });
});
