/**
 * @vitest-environment node
 *
 * The cookie codec (`parseCookieHeader`/`serializeCookie` — the
 * platform-gap primitives, core's whole cookie surface), the committed
 * response stub's write loudness (`commitResponseStub`: a post-commit
 * header write throws in the dev build on every commit path), and the
 * multi-`Set-Cookie` guarantee: every path that materializes a response
 * stub (or merges response headers) must carry multiple `Set-Cookie`
 * values as separate entries — `getSetCookie()` + append, never `get`/
 * `set` folding — so cookies survive identically on Node/undici, workerd
 * and Deno. Cookie writes throughout use the blessed pattern:
 * `event.response.headers.append("set-cookie", serializeCookie(...))`.
 * Node environment for real Request/Response/Headers globals.
 */
import * as r from "../../src/server.js";
import { parseCookieHeader, serializeCookie } from "../../src/server.js";
import * as codec from "../../src/cookies.js";
import { redirect, respond } from "../../src/response.js";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "../../server-functions/src/server.js";
import { FLASH_COOKIE } from "../../server-functions/src/shared.js";
import { RequestContext } from "../../src/server.js";

class FakeStorage {
  constructor() {
    this.store = undefined;
  }
  getStore() {
    return this.store;
  }
  run(value, fn) {
    const prev = this.store;
    this.store = value;
    try {
      return fn();
    } finally {
      this.store = prev;
    }
  }
}

beforeEach(() => {
  globalThis[RequestContext] = new FakeStorage();
});

afterEach(() => {
  delete globalThis[RequestContext];
});

function eventWithCookies(cookieHeader) {
  const headers = cookieHeader ? { cookie: cookieHeader } : undefined;
  return r.createRequestEvent(new Request("http://localhost/", { headers }));
}

// The blessed write pattern, spelled once.
function appendCookie(event, name, value, options) {
  event.response.headers.append("set-cookie", serializeCookie(name, value, options));
}

describe("codec exports", () => {
  it("the server entry re-exports the one real implementation", () => {
    expect(parseCookieHeader).toBe(codec.parseCookieHeader);
    expect(serializeCookie).toBe(codec.serializeCookie);
  });
});

describe("serializeCookie", () => {
  it("defaults Path to / and nothing else", () => {
    expect(serializeCookie("a", "b")).toBe("a=b; Path=/");
  });

  it("emits every attribute the caller asked for", () => {
    const expires = new Date("2027-01-01T00:00:00Z");
    expect(
      serializeCookie("session", "abc", {
        path: "/app",
        domain: "example.com",
        maxAge: 3600.9,
        expires,
        httpOnly: true,
        secure: true,
        sameSite: "lax"
      })
    ).toBe(
      `session=abc; Path=/app; Domain=example.com; Max-Age=3600; Expires=${expires.toUTCString()}; HttpOnly; Secure; SameSite=Lax`
    );
  });

  it("normalizes sameSite casing", () => {
    expect(serializeCookie("a", "b", { sameSite: "none" })).toBe("a=b; Path=/; SameSite=None");
    expect(serializeCookie("a", "b", { sameSite: "Strict" })).toBe("a=b; Path=/; SameSite=Strict");
  });

  it("percent-encodes name and value so any string round-trips", () => {
    const value = "sp ace;semi=eq,comma✓";
    const serialized = serializeCookie("na;me", value);
    const pair = serialized.split(";")[0];
    expect(pair).not.toContain(" ");
    expect(parseCookieHeader(pair)["na;me"]).toBe(value);
  });
});

describe("parseCookieHeader", () => {
  it("parses multiple pairs and trims whitespace", () => {
    expect(parseCookieHeader("a=1; b=2;c=3")).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("answers an empty map for null/empty input", () => {
    expect(parseCookieHeader(null)).toEqual({});
    expect(parseCookieHeader("")).toEqual({});
  });

  it("skips segments without an =", () => {
    expect(parseCookieHeader("garbage; a=1")).toEqual({ a: "1" });
  });

  it("unquotes quoted values", () => {
    expect(parseCookieHeader('a="quoted value"')).toEqual({ a: "quoted value" });
  });

  it("keeps raw text when decoding throws", () => {
    expect(parseCookieHeader("a=%zz")).toEqual({ a: "%zz" });
  });

  it("reads the blessed pattern off a request event", () => {
    const event = eventWithCookies("session=abc; name=sp%20ace%3B%E2%9C%93");
    const cookies = parseCookieHeader(event.request.headers.get("cookie"));
    expect(cookies.session).toBe("abc");
    expect(cookies.name).toBe("sp ace;✓");
    expect(cookies.missing).toBeUndefined();
  });
});

// Raw source is the dev build (`"_SOLID_DEV_"` is a truthy string until a
// bundler replaces it), so the never-silent policy surfaces as throws
// here; the production build reports through console.error and no-ops.
describe("commitResponseStub write loudness", () => {
  it("commits the stub and fails post-commit set/append/delete loudly (dev)", () => {
    const event = eventWithCookies();
    r.commitResponseStub(event.response);
    expect(event.response.committed).toBe(true);
    expect(() => event.response.headers.set("x-late", "1")).toThrow(
      /after the response head was sent/
    );
    expect(() => appendCookie(event, "late", "1")).toThrow(/after the response head was sent/);
    expect(() => event.response.headers.delete("x-late")).toThrow(
      /after the response head was sent/
    );
    expect(event.response.headers.getSetCookie()).toEqual([]);
  });

  it("keeps the Headers identity and its reads intact", () => {
    const event = eventWithCookies();
    const headers = event.response.headers;
    appendCookie(event, "a", "1");
    r.commitResponseStub(event.response);
    expect(event.response.headers).toBe(headers);
    expect(headers).toBeInstanceOf(Headers);
    expect(headers.getSetCookie()).toEqual(["a=1; Path=/"]);
    expect(headers.get("set-cookie")).toContain("a=1");
  });

  it("is idempotent: an already-committed stub is left alone", () => {
    const stub = r.createResponseStub();
    r.commitResponseStub(stub);
    const patched = stub.headers.set;
    r.commitResponseStub(stub);
    expect(stub.headers.set).toBe(patched);
  });

  it("allowLateLocation permits exactly the post-commit Location set", () => {
    const stub = r.createResponseStub();
    r.commitResponseStub(stub, { allowLateLocation: true });
    stub.headers.set("Location", "/next");
    expect(stub.headers.get("Location")).toBe("/next");
    expect(() => stub.headers.set("x-other", "1")).toThrow(/after the response head was sent/);
    expect(() => stub.headers.append("set-cookie", "a=1")).toThrow(
      /after the response head was sent/
    );
  });
});

describe("createSSRResponse carries multiple Set-Cookie values", () => {
  it("string result: stub cookies and base-init cookies all survive individually", async () => {
    const event = eventWithCookies();
    appendCookie(event, "a", "1");
    appendCookie(event, "b", "2");
    const base = new Headers();
    base.append("Set-Cookie", "c=3; Path=/");
    const response = r.createSSRResponse("<p/>", event, { responseInit: { headers: base } });
    expect(response.headers.getSetCookie()).toEqual(["c=3; Path=/", "a=1; Path=/", "b=2; Path=/"]);
    expect(event.response.committed).toBe(true);
  });

  it("redirect result: cookies ride the redirect head", () => {
    const event = eventWithCookies();
    appendCookie(event, "session", "fresh");
    event.response.headers.set("Location", "/next");
    const response = r.createSSRResponse("<p>never sent</p>", event);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/next");
    expect(response.headers.getSetCookie()).toEqual(["session=fresh; Path=/"]);
  });

  it("stream result: cookies set before the shell flush reach the head", async () => {
    const event = eventWithCookies();
    appendCookie(event, "a", "1");
    appendCookie(event, "b", "2");
    const response = await r.createSSRResponse(
      r.renderToStream(() => r.ssr`<p>sync</p>`),
      event
    );
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(event.response.committed).toBe(true);
  });

  it("string commit rejects late header writes (dev)", () => {
    const event = eventWithCookies();
    r.createSSRResponse("<p/>", event);
    expect(() => appendCookie(event, "late", "1")).toThrow(/after the response head was sent/);
  });

  it("shell-flush commit rejects late header writes (dev) but honors late Location", async () => {
    const event = eventWithCookies();
    const response = await r.createSSRResponse(
      r.renderToStream(() => r.ssr`<p>sync</p>`),
      event
    );
    expect(event.response.committed).toBe(true);
    expect(() => appendCookie(event, "late", "1")).toThrow(/after the response head was sent/);
    // the stream path's documented exception: a post-flush Location is
    // honored client-side through the completion script
    event.response.headers.set("Location", "/next");
    expect(event.response.headers.get("Location")).toBe("/next");
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe("handleServerFunctionRequest folds the event response stub", () => {
  const INSTANCE_HEADERS = {
    "X-Server-Function-Instance": "server-function:test"
  };

  function dispatch(id, event, extraHeaders = {}, options = {}) {
    return handleServerFunctionRequest(
      new Request(`http://localhost/_server?id=${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { ...INSTANCE_HEADERS, ...extraHeaders }
      }),
      { createEvent: () => event, csrf: false, ...options }
    );
  }

  it("cookies appended during the call reach the wire, and the commit seam rejects late writes (dev)", async () => {
    const event = eventWithCookies();
    registerServerFunction("cookie-set-0", async () => {
      appendCookie(event, "session", "abc", { httpOnly: true });
      appendCookie(event, "theme", "dark");
      return 1;
    });
    const response = await dispatch("cookie-set-0", event);
    expect(response.headers.getSetCookie()).toEqual([
      "session=abc; Path=/; HttpOnly",
      "theme=dark; Path=/"
    ]);
    expect(event.response.committed).toBe(true);
    expect(() => appendCookie(event, "late", "1")).toThrow(/after the response head was sent/);
    expect(() => event.response.headers.set("x-late", "1")).toThrow(
      /after the response head was sent/
    );
  });

  it("stub cookies append alongside a respond() envelope's own", async () => {
    const envelopeHeaders = new Headers();
    envelopeHeaders.append("Set-Cookie", "e1=1; Path=/");
    envelopeHeaders.append("Set-Cookie", "e2=2; Path=/");
    const event = eventWithCookies();
    registerServerFunction("cookie-envelope-0", async () => {
      appendCookie(event, "stub", "s");
      return respond({ ok: true }, { headers: envelopeHeaders });
    });
    const response = await dispatch("cookie-envelope-0", event);
    expect(response.headers.getSetCookie()).toEqual([
      "e1=1; Path=/",
      "e2=2; Path=/",
      "stub=s; Path=/"
    ]);
  });

  it("stub cookies ride a thrown redirect", async () => {
    const event = eventWithCookies();
    registerServerFunction("cookie-redirect-0", async () => {
      appendCookie(event, "session", "fresh");
      throw redirect("/next");
    });
    const response = await dispatch("cookie-redirect-0", event);
    expect(response.headers.get("Location")).toBe("/next");
    expect(response.headers.getSetCookie()).toEqual(["session=fresh; Path=/"]);
  });

  it("stub cookies merge onto a returned raw Response without folding its own", async () => {
    const event = eventWithCookies();
    registerServerFunction("cookie-raw-0", async () => {
      appendCookie(event, "stub", "s");
      const headers = new Headers();
      headers.append("Set-Cookie", "own1=1; Path=/");
      headers.append("Set-Cookie", "own2=2; Path=/");
      return new Response("body", { headers });
    });
    const response = await dispatch("cookie-raw-0", event);
    expect(response.headers.getSetCookie()).toEqual([
      "own1=1; Path=/",
      "own2=2; Path=/",
      "stub=s; Path=/"
    ]);
  });

  it("stub cookies ride the no-JS form redirect next to the flash cookie", async () => {
    const event = eventWithCookies();
    registerServerFunction("cookie-nojs-0", async () => {
      appendCookie(event, "session", "fresh");
      return "saved";
    });
    const response = await handleServerFunctionRequest(
      new Request("http://localhost/_server?id=cookie-nojs-0", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          referer: "http://localhost/page"
        },
        body: "x=1"
      }),
      { createEvent: () => event }
    );
    expect(response.status).toBe(303);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.some(c => c.startsWith(`${FLASH_COOKIE}=`))).toBe(true);
    expect(cookies).toContain("session=fresh; Path=/");
  });

  it("protocol-owned stub headers never gap-fill onto a response", async () => {
    const event = eventWithCookies();
    registerServerFunction("cookie-protocol-0", async () => {
      // A misbehaving write (or stale middleware state) parking
      // protocol-owned names on the stub must not leak onto the wire: a
      // stray Location would turn this success into a redirect signal.
      event.response.headers.set("X-Server-Function-Error", "phantom");
      event.response.headers.set("X-Server-Function-Format", "9");
      event.response.headers.set("X-Single-Flight", "true");
      event.response.headers.set("X-Revalidate", "everything");
      event.response.headers.set("Location", "/hijack");
      return 1;
    });
    const response = await dispatch("cookie-protocol-0", event);
    expect(response.headers.get("X-Server-Function-Error")).toBeNull();
    expect(response.headers.get("X-Single-Flight")).toBeNull();
    expect(response.headers.get("X-Revalidate")).toBeNull();
    expect(response.headers.get("Location")).toBeNull();
    // the encoder's own format tag (Json — `1` is JSON-safe), not the stub's
    expect(response.headers.get("X-Server-Function-Format")).toBe("8");
  });

  it("does not re-advertise body metadata on the bodiless no-JS redirect", async () => {
    const event = eventWithCookies();
    registerServerFunction("cookie-nojs-ct-0", async () => {
      event.response.headers.set("Content-Type", "text/never");
      appendCookie(event, "session", "fresh");
      return "saved";
    });
    const response = await handleServerFunctionRequest(
      new Request("http://localhost/_server?id=cookie-nojs-ct-0", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          referer: "http://localhost/page"
        },
        body: "x=1"
      }),
      { createEvent: () => event }
    );
    // the no-JS handler builds a bodiless redirect and strips body
    // metadata; the stub's Content-Type must not gap-fill it back
    expect(response.status).toBe(303);
    expect(response.body).toBeNull();
    expect(response.headers.get("Content-Type")).toBeNull();
    // cookies still ride
    expect(response.headers.getSetCookie()).toContain("session=fresh; Path=/");
  });

  it("stub headers fill gaps without overriding the call's own metadata", async () => {
    const event = eventWithCookies();
    registerServerFunction("cookie-headers-0", async () => {
      event.response.headers.set("X-Custom", "stub");
      event.response.headers.set("Content-Type", "text/never");
      return 1;
    });
    const response = await dispatch("cookie-headers-0", event);
    expect(response.headers.get("X-Custom")).toBe("stub");
    // the encoder's own content type (Json fast path) wins over the stub's
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });
});
