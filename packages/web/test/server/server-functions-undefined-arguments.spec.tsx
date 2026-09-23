// Runs against the built bundles (server-functions/dist/*, see vite.config.server.mjs).
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import {
  configureServerFunctionsClient,
  createServerReference,
  getServerFunctionsCodec,
  serializeString
} from "@solidjs/web/server-functions/client";

const RequestContext = Symbol.for("solid.RequestContext");
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
const SERIALIZED_FORMAT = "0";
const FORM_DATA_FORMAT = "2";
const URL_PARAMS_FORMAT = "3";
const FILE_FORMAT = "5";
const JSON_FORMAT = "8";

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

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

function registerSearch(id: string) {
  let ran = 0;
  const impl = async (id: number, limit = 10, q = "") => {
    ran++;
    return `id=${id} limit=${limit} q=${q}`;
  };
  registerServerFunction(id, impl);
  return {
    search: createServerReference(id) as unknown as typeof impl,
    runs: () => ran
  };
}

describe("without rich arguments", () => {
  it("refuses an undefined before a trailing string instead of sending null", async () => {
    const { search, runs } = registerSearch("undefined-args-default-string");
    const transport = connectTransport();
    try {
      await expect(search(1, undefined, "milk")).rejects.toThrow(/sent as JSON by default/);
      expect(runs()).toBe(0);
      expect(transport.requests).toHaveLength(0);
    } finally {
      transport.restore();
    }
  });

  it("refuses a trailing undefined the same way", async () => {
    const { search, runs } = registerSearch("undefined-args-default-trailing");
    const transport = connectTransport();
    try {
      await expect(search(1, undefined)).rejects.toThrow(/sent as JSON by default/);
      expect(runs()).toBe(0);
    } finally {
      transport.restore();
    }
  });

  it("sends a string call without undefined as a plain JSON body", async () => {
    const { search } = registerSearch("undefined-args-default-json");
    const transport = connectTransport();
    try {
      expect(await search(1, 5, "milk")).toBe("id=1 limit=5 q=milk");
      const [request] = transport.requests;
      expect(request.headers.get(BODY_FORMAT_HEADER)).toBe(JSON_FORMAT);
      expect(await request.text()).toBe('[1,5,"milk"]');
      expect(new URL(request.url).searchParams.has("args")).toBe(false);
    } finally {
      transport.restore();
    }
  });

  it("keeps a bound form action's wire shape, undefined included", async () => {
    let seen: unknown[] = [];
    registerServerFunction("undefined-args-bound-form", async (...args: unknown[]) => {
      seen = args;
      return "ok";
    });
    const transport = connectTransport();
    try {
      const form = new FormData();
      form.append("title", "milk");
      expect(
        await createServerReference("undefined-args-bound-form")("list", undefined, form)
      ).toBe("ok");
      expect(seen.slice(0, 2)).toEqual(["list", null]);
      expect((seen[2] as FormData).get("title")).toBe("milk");
      const [request] = transport.requests;
      expect(new URL(request.url).searchParams.get("args")).toBe('["list",null]');
      expect(request.headers.get(BODY_FORMAT_HEADER)).toBe(FORM_DATA_FORMAT);
    } finally {
      transport.restore();
    }
  });

  it("keeps the bound shape for a trailing URLSearchParams", async () => {
    let seen: unknown[] = [];
    registerServerFunction("undefined-args-bound-params", async (...args: unknown[]) => {
      seen = args;
      return "ok";
    });
    const transport = connectTransport();
    try {
      await createServerReference("undefined-args-bound-params")(
        7,
        undefined,
        new URLSearchParams("q=milk")
      );
      expect(seen.slice(0, 2)).toEqual([7, null]);
      expect(seen[2]).toBeInstanceOf(URLSearchParams);
      expect((seen[2] as URLSearchParams).get("q")).toBe("milk");
      const [request] = transport.requests;
      expect(new URL(request.url).searchParams.get("args")).toBe("[7,null]");
      expect(request.headers.get(BODY_FORMAT_HEADER)).toBe(URL_PARAMS_FORMAT);
    } finally {
      transport.restore();
    }
  });

  it("keeps the bound shape for a trailing File", async () => {
    let seen: unknown[] = [];
    registerServerFunction("undefined-args-bound-file", async (...args: unknown[]) => {
      seen = args;
      return "ok";
    });
    const transport = connectTransport();
    try {
      await createServerReference("undefined-args-bound-file")(
        "/inbox",
        undefined,
        new File(["scan"], "scan.pdf", { type: "application/pdf" })
      );
      expect(seen.slice(0, 2)).toEqual(["/inbox", null]);
      expect(seen[2]).toBeInstanceOf(File);
      expect((seen[2] as File).name).toBe("scan.pdf");
      const [request] = transport.requests;
      expect(new URL(request.url).searchParams.get("args")).toBe('["/inbox",null]');
      expect(request.headers.get(BODY_FORMAT_HEADER)).toBe(FILE_FORMAT);
    } finally {
      transport.restore();
    }
  });
});

// Last in the file: the client config has no way to remove serializeArgs.
describe("with rich arguments", () => {
  beforeAll(() => {
    configureServerFunctionsClient({
      serializeArgs: args => serializeString(args, getServerFunctionsCodec())
    });
  });

  it("delivers an undefined before a trailing string, so the default applies", async () => {
    const { search } = registerSearch("undefined-args-rich-string");
    const transport = connectTransport();
    try {
      expect(await search(1, undefined, "milk")).toBe("id=1 limit=10 q=milk");
      const [request] = transport.requests;
      expect(request.headers.get(BODY_FORMAT_HEADER)).toBe(SERIALIZED_FORMAT);
      expect(new URL(request.url).searchParams.has("args")).toBe(false);
    } finally {
      transport.restore();
    }
  });
});
