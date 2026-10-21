/**
 * Files and blobs anywhere in the arguments of a codec call. With
 * `enableRichArguments()`, a call whose arguments hold files sends multipart
 * form data: the codec output in the `args` field and each file in its own
 * `file<index>` part. The handler decodes `args` with a plugin made for that
 * request, which turns each index back into its part.
 *
 * Ported from SolidStart (solidjs/solid-start#2359). Like the other
 * server-function specs, these run against the built bundles.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import { createServerReference } from "@solidjs/web/server-functions/client";
// @ts-ignore — the rich-args dist has no adjacent type declarations.
import { enableRichArguments } from "../../server-functions/dist/rich-args.js";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
const SERIALIZED_FORMAT = "0";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
  enableRichArguments();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

/** Routes the client's fetch into the built handler and keeps each request. */
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

/** A request to the same address as `captured`, with `form` as its body. */
function resend(captured: Request, form: FormData | string, format = SERIALIZED_FORMAT) {
  const headers: Record<string, string> = {
    [BODY_FORMAT_HEADER]: format,
    "Sec-Fetch-Site": "same-origin"
  };
  if (typeof form === "string") headers["Content-Type"] = "text/plain";
  return handleServerFunctionRequest(
    new Request(captured.url, { method: "POST", body: form, headers })
  );
}

const describeFile = async (value: unknown) =>
  value instanceof File
    ? { file: value.name, type: value.type, text: await value.text() }
    : { notAFile: String(value) };

describe("files in codec arguments", () => {
  it("sends a file next to other arguments as its own form part", async () => {
    registerServerFunction("upload-meta", async (file: File, meta: { tags: string[] }) => ({
      ...(await describeFile(file)),
      tags: meta.tags
    }));
    const transport = connectTransport();
    try {
      const call = createServerReference("upload-meta");
      const result = await call(new File(["hello"], "a.txt", { type: "text/plain" }), {
        tags: ["x"]
      });
      expect(result).toEqual({ file: "a.txt", type: "text/plain", text: "hello", tags: ["x"] });
      const [request] = transport.requests;
      expect(request.headers.get(BODY_FORMAT_HEADER)).toBe(SERIALIZED_FORMAT);
      expect(request.headers.get("content-type")).toMatch(/^multipart\/form-data/);
      const form = await request.formData();
      expect(typeof form.get("args")).toBe("string");
      // The bytes go in the part as they are, not base64 inside the codec output.
      expect(await (form.get("file0") as File).text()).toBe("hello");
      expect(form.get("args")).not.toContain("hello");
    } finally {
      transport.restore();
    }
  });

  it("finds files in arrays, objects, maps, sets and FormData entries", async () => {
    registerServerFunction(
      "upload-nested",
      async (
        list: File[],
        record: { doc: { file: File } },
        map: Map<string, File>,
        set: Set<File>,
        form: FormData,
        n: number
      ) => ({
        list: await Promise.all(list.map(describeFile)),
        record: await describeFile(record.doc.file),
        map: await describeFile(map.get("k")),
        set: await describeFile([...set][0]),
        form: await describeFile(form.get("doc")),
        field: form.get("name"),
        n
      })
    );
    const transport = connectTransport();
    try {
      const call = createServerReference("upload-nested");
      const f = (text: string) => new File([text], `${text}.txt`, { type: "text/plain" });
      const form = new FormData();
      form.set("doc", f("form"));
      form.set("name", "plain field");
      const result = await call(
        [f("a"), f("b")],
        { doc: { file: f("record") } },
        new Map([["k", f("map")]]),
        new Set([f("set")]),
        form,
        7
      );
      expect(result).toEqual({
        list: [
          { file: "a.txt", type: "text/plain", text: "a" },
          { file: "b.txt", type: "text/plain", text: "b" }
        ],
        record: { file: "record.txt", type: "text/plain", text: "record" },
        map: { file: "map.txt", type: "text/plain", text: "map" },
        set: { file: "set.txt", type: "text/plain", text: "set" },
        form: { file: "form.txt", type: "text/plain", text: "form" },
        field: "plain field",
        n: 7
      });
      const sent = await transport.requests[0].formData();
      expect([...sent.keys()].filter(key => key.startsWith("file"))).toHaveLength(6);
    } finally {
      transport.restore();
    }
  });

  it("sends a file used twice once, and it arrives as one value", async () => {
    registerServerFunction("upload-twice", async (a: File, holder: { again: File }) => ({
      same: a === holder.again,
      text: await a.text()
    }));
    const transport = connectTransport();
    try {
      const call = createServerReference("upload-twice");
      const file = new File(["once"], "once.txt");
      expect(await call(file, { again: file })).toEqual({ same: true, text: "once" });
      const sent = await transport.requests[0].formData();
      expect(sent.has("file0")).toBe(true);
      expect(sent.has("file1")).toBe(false);
    } finally {
      transport.restore();
    }
  });

  it("keeps a blob's type, and the blob arrives as a File named blob", async () => {
    registerServerFunction("upload-blob", async (blob: Blob, label: string) => ({
      isFile: blob instanceof File,
      name: (blob as File).name,
      type: blob.type,
      text: await blob.text(),
      label
    }));
    const transport = connectTransport();
    try {
      const call = createServerReference("upload-blob");
      expect(await call(new Blob(["bytes"], { type: "application/x-thing" }), "l")).toEqual({
        isFile: true,
        name: "blob",
        type: "application/x-thing",
        text: "bytes",
        label: "l"
      });
    } finally {
      transport.restore();
    }
  });

  it("copies a blob from another frame, found by its shape", async () => {
    registerServerFunction("upload-foreign", async (holder: { blob: Blob }) => ({
      type: holder.blob.type,
      text: await holder.blob.text()
    }));
    const transport = connectTransport();
    try {
      const call = createServerReference("upload-foreign");
      // Not an instance of this realm's Blob, as a blob from an iframe is not.
      const real = new Blob(["far"], { type: "text/x-far" });
      const foreign = {
        size: real.size,
        type: real.type,
        arrayBuffer: () => real.arrayBuffer(),
        slice: (...args: any[]) => real.slice(...args)
      };
      expect(await call({ blob: foreign })).toEqual({ type: "text/x-far", text: "far" });
      expect(transport.requests[0].headers.get(BODY_FORMAT_HEADER)).toBe(SERIALIZED_FORMAT);
    } finally {
      transport.restore();
    }
  });

  it("sends a call without files as codec text, as before", async () => {
    registerServerFunction("upload-none", async (date: Date) => date.toISOString());
    const transport = connectTransport();
    try {
      const call = createServerReference("upload-none");
      expect(await call(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
      expect(transport.requests[0].headers.get(BODY_FORMAT_HEADER)).toBe(SERIALIZED_FORMAT);
    } finally {
      transport.restore();
    }
  });

  it("still refuses a Response next to a file, before sending", async () => {
    registerServerFunction("upload-refused", async () => "ran");
    const transport = connectTransport();
    try {
      const call = createServerReference("upload-refused");
      await expect(call(new File(["x"], "x.txt"), new Response("no"))).rejects.toThrow(
        /cannot carry Response or Request/
      );
      expect(transport.requests).toHaveLength(0);
    } finally {
      transport.restore();
    }
  });

  it("applies bodySizeLimit to the whole upload", async () => {
    let ran = 0;
    registerServerFunction("upload-limit", async () => ++ran);
    const transport = connectTransport();
    try {
      const call = createServerReference("upload-limit");
      expect(await call(new File(["x".repeat(4096)], "big.txt"), 1)).toBe(1);
    } finally {
      transport.restore();
    }
    // The same upload as bytes. Refusing an in-memory FormData body part way
    // leaves undici writing to a closed stream, which is a test artifact.
    const sent = transport.requests[0];
    const response = await handleServerFunctionRequest(
      new Request(sent.url, {
        method: "POST",
        body: await sent.arrayBuffer(),
        headers: sent.headers
      }),
      { bodySizeLimit: 1024 }
    );
    expect(response.status).toBe(413);
    expect(ran).toBe(1);
  });
});

describe("malformed uploads", () => {
  // A real upload body, captured, so each case changes one thing about it.
  async function capture() {
    let ran = 0;
    registerServerFunction("upload-target", async (file: File, n: number) => {
      ran++;
      return [await file.text(), n];
    });
    const transport = connectTransport();
    try {
      const call = createServerReference("upload-target");
      expect(await call(new File(["ok"], "ok.txt"), 1)).toEqual(["ok", 1]);
    } finally {
      transport.restore();
    }
    const request = transport.requests[0];
    return { request, form: await request.clone().formData(), ran: () => ran };
  }

  it("refuses a body without the args field", async () => {
    const { request, form, ran } = await capture();
    form.delete("args");
    expect((await resend(request, form)).status).toBe(400);
    expect(ran()).toBe(1);
  });

  it("refuses an index with no part", async () => {
    const { request, form, ran } = await capture();
    form.delete("file0");
    expect((await resend(request, form)).status).toBe(400);
    expect(ran()).toBe(1);
  });

  it("refuses a part that is not a file", async () => {
    const { request, form, ran } = await capture();
    form.set("file0", "just text");
    expect((await resend(request, form)).status).toBe(400);
    expect(ran()).toBe(1);
  });

  it("refuses a file index in a plain codec body", async () => {
    const { request, form, ran } = await capture();
    const args = form.get("args") as string;
    expect((await resend(request, args, SERIALIZED_FORMAT)).status).toBe(400);
    expect(ran()).toBe(1);
  });
});
