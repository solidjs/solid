/**
 * Arguments that have a natural HTTP encoding — the upload path. A call
 * whose only argument is a `File`, `Blob`, `FormData`, `URLSearchParams`,
 * `Uint8Array` skips the codec entirely and rides the wire
 * as that body, and the handler hands the function back the same kind of
 * value. Nothing here is opt-in: this is what `upload(file)` does out of the
 * box, without `enableRichArguments`.
 *
 * The bound shape rides along: `action.with(id)` posting a form sends the
 * JSON-safe leading arguments in the url's `?args=` and the trailing value
 * AS the body, and the handler reassembles the list in the order the
 * function declared it — the same wire shape the no-JS form fallback
 * produces, which is why a bound form action needs no codec.
 *
 * `enableRichArguments`, the opt-in codec for Dates and cycles, is a
 * different surface and remains uncovered.
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
import { createServerReference } from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
const FILE_FORMAT = "5";
const BLOB_FORMAT = "4";
const BYTES_FORMAT = "7";
const FORM_DATA_FORMAT = "2";
const URL_PARAMS_FORMAT = "3";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

// The client transport's fetch dispatches into the built server handler —
// a full round trip through both published bundles — and every request is
// captured so the tests can assert what the encoding actually put on the
// wire, not only what came back.
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

describe("an argument with a natural HTTP encoding", () => {
  it("carries a File whole: name, type and bytes, as a File", async () => {
    let ran = 0;
    registerServerFunction("rich-file", async (upload: File) => {
      ran++;
      return {
        isFile: upload instanceof File,
        name: upload.name,
        type: upload.type,
        text: await upload.text()
      };
    });
    const transport = connectTransport();
    try {
      const call = createServerReference("rich-file");
      const result = await call(new File(["hello bytes"], "note.txt", { type: "text/plain" }));
      expect(ran).toBe(1);
      expect(result).toEqual({
        isFile: true,
        name: "note.txt",
        type: "text/plain",
        text: "hello bytes"
      });
      // the file kept its own branch: without it a File matches `instanceof
      // Blob` and ships as a bare Blob, losing its name
      expect(transport.requests[0].headers.get(BODY_FORMAT_HEADER)).toBe(FILE_FORMAT);
      expect(transport.requests[0].headers.get("content-type")).toMatch(/^multipart\/form-data/);
    } finally {
      transport.restore();
    }
  });

  it("keeps a Blob's content type — the half a bare byte body would lose", async () => {
    let ran = 0;
    registerServerFunction("rich-blob", async (blob: Blob) => {
      ran++;
      return { isBlob: blob instanceof Blob, type: blob.type, text: await blob.text() };
    });
    const transport = connectTransport();
    try {
      const call = createServerReference("rich-blob");
      expect(await call(new Blob(["blobby"], { type: "application/x-thing" }))).toEqual({
        isBlob: true,
        type: "application/x-thing",
        text: "blobby"
      });
      expect(ran).toBe(1);
      expect(transport.requests[0].headers.get(BODY_FORMAT_HEADER)).toBe(BLOB_FORMAT);
    } finally {
      transport.restore();
    }
  });

  it("sends a typed array's own bytes, not the buffer behind it", async () => {
    // A Uint8Array is a VIEW. `chunk.subarray(2, 5)` of an eight-byte
    // buffer is three bytes; sending the backing buffer would ship all
    // eight and silently shift every offset the function reads.
    let ran = 0;
    registerServerFunction("rich-bytes", async (bytes: Uint8Array) => {
      ran++;
      return { isBytes: bytes instanceof Uint8Array, bytes: Array.from(bytes) };
    });
    const transport = connectTransport();
    try {
      const call = createServerReference("rich-bytes");
      const backing = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(await call(backing.subarray(2, 5))).toEqual({ isBytes: true, bytes: [3, 4, 5] });
      expect(ran).toBe(1);
      expect(transport.requests[0].headers.get(BODY_FORMAT_HEADER)).toBe(BYTES_FORMAT);
    } finally {
      transport.restore();
    }
  });

  it("round-trips FormData and URLSearchParams as themselves", async () => {
    let ran = 0;
    registerServerFunction("rich-form", async (form: FormData) => {
      ran++;
      return { isForm: form instanceof FormData, title: form.get("title") };
    });
    registerServerFunction("rich-query", async (query: URLSearchParams) => {
      ran++;
      return { isQuery: query instanceof URLSearchParams, page: query.get("page") };
    });
    const transport = connectTransport();
    try {
      const form = new FormData();
      form.append("title", "a post");
      expect(await createServerReference("rich-form")(form)).toEqual({
        isForm: true,
        title: "a post"
      });
      const query = new URLSearchParams();
      query.set("page", "3");
      expect(await createServerReference("rich-query")(query)).toEqual({
        isQuery: true,
        page: "3"
      });
      expect(ran).toBe(2);
      expect(transport.requests[0].headers.get(BODY_FORMAT_HEADER)).toBe(FORM_DATA_FORMAT);
      expect(transport.requests[1].headers.get(BODY_FORMAT_HEADER)).toBe(URL_PARAMS_FORMAT);
    } finally {
      transport.restore();
    }
  });
});

describe("a bound call ending in a natural encoding", () => {
  it("puts the leading arguments in the url and the body last, in declared order", async () => {
    let ran = 0;
    let seen: unknown[] = [];
    registerServerFunction("rich-bound", async (...args: unknown[]) => {
      ran++;
      seen = args;
      const form = args[args.length - 1] as FormData;
      return { argc: args.length, album: args[0], caption: args[1], file: form.get("f") };
    });
    const transport = connectTransport();
    try {
      const call = createServerReference("rich-bound");
      const form = new FormData();
      form.append("f", "payload");
      // the transport normalizes `undefined` to null before the leading list
      // can ride the url — without it the list is not JSON-safe and the call
      // falls off the bound path entirely
      const result = await call("holiday", undefined, form);
      expect(ran).toBe(1);
      expect(result).toEqual({
        argc: 3,
        album: "holiday",
        caption: null,
        file: "payload"
      });
      // the trailing argument really is the body, and only the leading ones
      // are in the query
      expect(seen[2]).toBeInstanceOf(FormData);
      expect(new URL(transport.requests[0].url).searchParams.get("args")).toBe('["holiday",null]');
      expect(transport.requests[0].headers.get(BODY_FORMAT_HEADER)).toBe(FORM_DATA_FORMAT);
    } finally {
      transport.restore();
    }
  });

  it("keeps a File last behind its leading arguments", async () => {
    let ran = 0;
    registerServerFunction("rich-bound-file", async (folder: string, upload: File) => {
      ran++;
      return {
        folder,
        isFile: upload instanceof File,
        name: upload.name,
        text: await upload.text()
      };
    });
    const transport = connectTransport();
    try {
      const call = createServerReference("rich-bound-file");
      expect(
        await call("/inbox", new File(["scan"], "scan.pdf", { type: "application/pdf" }))
      ).toEqual({ folder: "/inbox", isFile: true, name: "scan.pdf", text: "scan" });
      expect(ran).toBe(1);
      expect(new URL(transport.requests[0].url).searchParams.get("args")).toBe('["/inbox"]');
      expect(transport.requests[0].headers.get(BODY_FORMAT_HEADER)).toBe(FILE_FORMAT);
    } finally {
      transport.restore();
    }
  });
});
