/**
 * @jsxImportSource @solidjs/web
 *
 * Trace context (src/trace.ts): the W3C `traceparent` half of the HTTP
 * exchange — derived once per request, exposed through `getTraceContext()`,
 * emitted as `Server-Timing` entries at head commit and as `<meta>` tags in
 * the shell — and the observe-tier provider slot `OBSERVE.server.trace`.
 *
 * `@solidjs/web` here is the SOURCE server entry (observe tier: the
 * `"_SOLID_OBSERVE_"` literal is truthy unreplaced), so the provider path is
 * live. `@solidjs/web/server-functions/server` is the PROD artifact — its
 * commit seam proves the W3C half ships in every tier — and `dist/server.js`
 * is loaded directly for the prod `getTraceContext()`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import {
  commitEventResponse,
  createRequestEvent,
  createSSRResponse,
  getTraceContext,
  httpHeader,
  renderToStream,
  renderToString,
  useHead
} from "@solidjs/web";
import type { RequestEvent, ResponseStub, TraceContext, TraceProvider } from "@solidjs/web";
// Server-only integration seam with no client mock; the same module the
// `@solidjs/web` alias resolves through (index.server.ts re-exports it).
import { commitResponseStub } from "../../src/server.js";
import {
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";
import { OBSERVE } from "solid-js";

type HttpEvent = RequestEvent & { response: ResponseStub };

const RequestContext = Symbol.for("solid.RequestContext");
let storage: AsyncLocalStorage<HttpEvent>;

const webRoot = resolve(import.meta.dirname, "../..");
let prod: typeof import("@solidjs/web");

beforeAll(async () => {
  storage = new AsyncLocalStorage();
  (globalThis as any)[RequestContext] = storage;
  prod = await import(/* @vite-ignore */ pathToFileURL(resolve(webRoot, "dist/server.js")).href);
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const uninstalls: Array<() => void> = [];
function provide(provider: TraceProvider) {
  const off = OBSERVE!.server.trace.provide(provider);
  uninstalls.push(off);
  return off;
}
afterEach(() => {
  for (const off of uninstalls.splice(0)) off();
  vi.restoreAllMocks();
});

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT_ID = "00f067aa0ba902b7";
const INCOMING = `00-${TRACE_ID}-${PARENT_ID}-01`;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;

function event(headers: Record<string, string> = {}, url = "https://app.example/"): HttpEvent {
  return createRequestEvent(new Request(url, { headers }));
}

function inScope<T>(evt: HttpEvent, fn: () => T): T {
  return storage.run(evt, fn);
}

// The stub's `Server-Timing` split on the commas outside quoted strings,
// as `name -> full entry`.
function serverTiming(headers: Headers): Map<string, string> {
  const value = headers.get("server-timing");
  const out = new Map<string, string>();
  if (value === null) return out;
  let start = 0;
  let quoted = false;
  const push = (end: number) => {
    const entry = value.slice(start, end).trim();
    if (entry) out.set(entry.split(";")[0].trim(), entry);
  };
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      push(i);
      start = i + 1;
    }
  }
  push(value.length);
  return out;
}

const Doc = (props: { children?: any }) => (
  <html>
    <head>
      <meta charset="utf-8" />
      <title>doc</title>
    </head>
    <body>{props.children ?? <p>hi</p>}</body>
  </html>
);

describe("getTraceContext: derivation", () => {
  test("continues an incoming W3C traceparent, carries tracestate/baggage verbatim", () => {
    const evt = event({
      traceparent: INCOMING,
      tracestate: "vendor=opaque",
      baggage: "upstream=context"
    });
    const ctx = inScope(evt, () => getTraceContext())!;
    expect(ctx.traceId).toBe(TRACE_ID);
    expect(ctx.parentId).toBe(PARENT_ID);
    expect(ctx.sampled).toBe(true);
    expect(ctx.spanId).toMatch(HEX16);
    expect(ctx.spanId).not.toBe(PARENT_ID);
    expect(ctx.state).toBe("vendor=opaque");
    expect(ctx.baggage).toBe("upstream=context");
    // The runtime's own entry reflects the request's span, sampled as received.
    expect(ctx.entries).toEqual({ traceparent: `00-${TRACE_ID}-${ctx.spanId}-01` });
  });

  test("flags bit 0 is the sampled decision; a future version parses as version 00", () => {
    const notSampled = inScope(event({ traceparent: `00-${TRACE_ID}-${PARENT_ID}-00` }), () =>
      getTraceContext()
    )!;
    expect(notSampled.sampled).toBe(false);
    expect(notSampled.entries.traceparent.endsWith("-00")).toBe(true);
    const future = inScope(event({ traceparent: `01-${TRACE_ID}-${PARENT_ID}-01-extra` }), () =>
      getTraceContext()
    )!;
    expect(future.traceId).toBe(TRACE_ID);
    expect(future.parentId).toBe(PARENT_ID);
  });

  test.each([
    ["version ff", `ff-${TRACE_ID}-${PARENT_ID}-01`],
    ["all-zero trace id", `00-${"0".repeat(32)}-${PARENT_ID}-01`],
    ["all-zero parent id", `00-${TRACE_ID}-${"0".repeat(16)}-01`],
    ["short trace id", `00-${TRACE_ID.slice(1)}-${PARENT_ID}-01`],
    ["uppercase hex", `00-${TRACE_ID.toUpperCase()}-${PARENT_ID}-01`],
    ["version 00 with trailing fields", `${INCOMING}-extra`],
    ["garbage", "not-a-trace"]
  ])("a malformed traceparent (%s) is ignored and a trace is originated", (_, value) => {
    const ctx = inScope(event({ traceparent: value }), () => getTraceContext())!;
    expect(ctx.traceId).toMatch(HEX32);
    expect(ctx.traceId).not.toBe(TRACE_ID);
    expect(ctx.parentId).toBeUndefined();
    expect(ctx.sampled).toBeUndefined();
  });

  test("originates when nothing came in: random ids, flags 00, no parent", () => {
    const a = inScope(event(), () => getTraceContext())!;
    const b = inScope(event(), () => getTraceContext())!;
    expect(a.traceId).toMatch(HEX32);
    expect(a.spanId).toMatch(HEX16);
    expect(a.parentId).toBeUndefined();
    expect(a.entries.traceparent).toBe(`00-${a.traceId}-${a.spanId}-00`);
    expect(b.traceId).not.toBe(a.traceId);
  });

  test("is one object per request: repeated reads, and a derived event sharing the request", () => {
    const evt = event({ traceparent: INCOMING });
    const first = inScope(evt, () => getTraceContext());
    const again = inScope(evt, () => getTraceContext());
    // The shape a direct server-function call runs under (a spread copy
    // with its own locals) — the render's trace, not a fresh one.
    const derived = { ...evt, locals: { ...evt.locals }, serverOnly: true } as HttpEvent;
    const fromDerived = inScope(derived, () => getTraceContext());
    expect(again).toBe(first);
    expect(fromDerived).toBe(first);
  });

  test("outside a request scope and outside a render there is no trace", async () => {
    // Any prior renderToString has disposed by the time a macrotask ran.
    await new Promise(r => setTimeout(r));
    expect(getTraceContext()).toBeUndefined();
  });

  test("a render outside a request scope has its own trace, gone once the render disposed", async () => {
    let seen: Array<TraceContext | undefined> = [];
    const Reader = () => {
      seen.push(getTraceContext());
      return <span>{getTraceContext()!.traceId}</span>;
    };
    const html = renderToString(() => (
      <>
        <Reader />
        <Reader />
      </>
    ));
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeDefined();
    expect(seen[1]).toBe(seen[0]);
    expect(html).toContain(seen[0]!.traceId);
    await new Promise(r => setTimeout(r));
    expect(getTraceContext()).toBeUndefined();
  });
});

describe("tiers, in the built artifacts", () => {
  const PROVIDER_MARK = "@solidjs/web/observe/trace-provider";
  test.each(["dist", "server-functions/dist", "frames/dist"])(
    "%s: the W3C half ships in prod; the provider slot only in observe/dev",
    dir => {
      const read = (name: string) => readFileSync(resolve(webRoot, dir, name), "utf8");
      const prodSource = read("server.js");
      expect(prodSource).toContain("traceparent");
      expect(prodSource).not.toContain(PROVIDER_MARK);
      expect(read("server.observe.js")).toContain(PROVIDER_MARK);
      expect(read("server.dev.js")).toContain(PROVIDER_MARK);
    }
  );
});

describe("OBSERVE.server.trace: the provider (observe tier)", () => {
  test("is asked once per request with the request, and its answer merges over the derivation", () => {
    const calls: Array<Request | undefined> = [];
    provide(request => {
      calls.push(request);
      return {
        traceId: "a".repeat(32),
        spanId: "b".repeat(16),
        sampled: true,
        entries: {
          "sentry-trace": `${"a".repeat(32)}-${"b".repeat(16)}-1`,
          baggage: "sentry-env=prod"
        }
      };
    });
    const evt = event();
    const ctx = inScope(evt, () => getTraceContext())!;
    inScope(evt, () => getTraceContext());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(evt.request);
    expect(ctx.traceId).toBe("a".repeat(32));
    expect(ctx.spanId).toBe("b".repeat(16));
    expect(ctx.sampled).toBe(true);
    // The runtime's entry follows the FINAL ids; the vendor pair rides beside it.
    expect(ctx.entries).toEqual({
      traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
      "sentry-trace": `${"a".repeat(32)}-${"b".repeat(16)}-1`,
      baggage: "sentry-env=prod"
    });
  });

  test("a provider's entries win by name; fields it leaves out keep the derivation", () => {
    provide(() => ({ entries: { traceparent: "vendor-shaped" } }));
    const ctx = inScope(event({ traceparent: INCOMING }), () => getTraceContext())!;
    expect(ctx.traceId).toBe(TRACE_ID);
    expect(ctx.parentId).toBe(PARENT_ID);
    expect(ctx.entries.traceparent).toBe("vendor-shaped");
  });

  test("uninstalling stops the merge; a later install replaces the current provider", () => {
    const off = provide(() => ({ traceId: "c".repeat(32) }));
    expect(inScope(event(), () => getTraceContext())!.traceId).toBe("c".repeat(32));
    off();
    expect(inScope(event(), () => getTraceContext())!.traceId).not.toBe("c".repeat(32));
    provide(() => ({ traceId: "d".repeat(32) }));
    provide(() => ({ traceId: "e".repeat(32) }));
    expect(inScope(event(), () => getTraceContext())!.traceId).toBe("e".repeat(32));
  });

  test("a throwing provider is reported and the derivation stands", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("provider failed");
    provide(() => {
      throw boom;
    });
    const ctx = inScope(event({ traceparent: INCOMING }), () => getTraceContext())!;
    expect(ctx.traceId).toBe(TRACE_ID);
    expect(error).toHaveBeenCalledWith(boom);
  });

  test("the prod artifact never consults the provider but continues a trace", () => {
    provide(() => ({ traceId: "f".repeat(32), entries: { "sentry-trace": "x" } }));
    const ctx = inScope(event({ traceparent: INCOMING }), () => prod.getTraceContext())!;
    expect(ctx.traceId).toBe(TRACE_ID);
    expect(ctx.parentId).toBe(PARENT_ID);
    expect(Object.keys(ctx.entries)).toEqual(["traceparent"]);
  });
});

describe("Server-Timing at head commit", () => {
  test("a continued trace rides createSSRResponse — string and stream paths", async () => {
    const evt = event({ traceparent: INCOMING });
    const html = inScope(evt, () => renderToString(() => <Doc />));
    const response = createSSRResponse(html, evt);
    const timing = serverTiming(response.headers);
    const ctx = inScope(evt, () => getTraceContext())!;
    expect(timing.get("traceparent")).toBe(`traceparent;desc="00-${TRACE_ID}-${ctx.spanId}-01"`);
    expect(evt.response.committed).toBe(true);

    const streamed = event({ traceparent: INCOMING });
    const stream = inScope(streamed, () => renderToStream(() => <Doc />));
    const streamResponse = await createSSRResponse(stream, streamed);
    const streamCtx = inScope(streamed, () => getTraceContext())!;
    expect(serverTiming(streamResponse.headers).get("traceparent")).toBe(
      `traceparent;desc="00-${TRACE_ID}-${streamCtx.spanId}-01"`
    );
  });

  test("a trace the runtime originated alone is NOT advertised to the browser", () => {
    const evt = event();
    const html = inScope(evt, () => renderToString(() => <Doc />));
    const response = createSSRResponse(html, evt);
    expect(response.headers.has("server-timing")).toBe(false);
    expect(html).not.toContain('name="traceparent"');
    // ...but it exists for the server's own use (downstream propagation, logs).
    expect(inScope(evt, () => getTraceContext())).toBeDefined();
  });

  test("a provider's answer is advertised, vendor entries included, commas quoted", () => {
    provide(() => ({
      sampled: true,
      entries: { "sentry-trace": "abc-def-1", baggage: 'sentry-release=1.0,sentry-env="prod"' }
    }));
    const evt = event();
    const html = inScope(evt, () => renderToString(() => <Doc />));
    const response = createSSRResponse(html, evt);
    const timing = serverTiming(response.headers);
    expect([...timing.keys()]).toEqual(["traceparent", "sentry-trace", "baggage"]);
    expect(timing.get("sentry-trace")).toBe('sentry-trace;desc="abc-def-1"');
    expect(timing.get("baggage")).toBe('baggage;desc="sentry-release=1.0,sentry-env=\\"prod\\""');
  });

  test("respects a name the app already wrote, beside its other metrics", () => {
    const evt = event({ traceparent: INCOMING });
    const Page = () => {
      httpHeader("Server-Timing", 'traceparent;desc="mine"');
      httpHeader("Server-Timing", "db;dur=53", { append: true });
      return <Doc />;
    };
    const html = inScope(evt, () => renderToString(() => <Page />));
    const response = createSSRResponse(html, evt);
    const timing = serverTiming(response.headers);
    expect(timing.get("traceparent")).toBe('traceparent;desc="mine"');
    expect(timing.get("db")).toBe("db;dur=53");
    expect(timing.size).toBe(2);
  });

  test("commitEventResponse: gap-fills onto a bare response, folds by name onto one with metrics", () => {
    const evt = event({ traceparent: INCOMING });
    const bare = inScope(evt, () => commitEventResponse(new Response("ok"), evt));
    const bareTiming = serverTiming(bare.headers);
    expect(bareTiming.has("traceparent")).toBe(true);

    const other = event({ traceparent: INCOMING });
    const withMetrics = inScope(other, () =>
      commitEventResponse(new Response("ok", { headers: { "Server-Timing": "db;dur=53" } }), other)
    );
    const timing = serverTiming(withMetrics.headers);
    expect(timing.get("db")).toBe("db;dur=53");
    expect(timing.has("traceparent")).toBe(true);
    expect(timing.size).toBe(2);
  });

  test("commitEventResponse: an event without a response stub still hands the trace on", () => {
    // The server-function handler's default event, a bare integration: the
    // trace is the request's, not the stub's.
    const bare = {
      request: new Request("https://app.example/", { headers: { traceparent: INCOMING } }),
      locals: {}
    };
    const out = inScope(bare as any, () => commitEventResponse(new Response("ok"), bare as any));
    expect(serverTiming(out.headers).has("traceparent")).toBe(true);
    // Nothing to say → the application's own Response object comes back.
    const quiet = { request: new Request("https://app.example/"), locals: {} };
    const original = new Response("ok");
    expect(inScope(quiet as any, () => commitEventResponse(original, quiet as any))).toBe(original);
  });

  test("a server-function response continues the caller's trace — one record across bundle copies", async () => {
    // The body reads through the main entry (source) and the prod
    // `dist/server.js`; the handler that commits the response is a THIRD
    // copy (`server-functions/dist/server.js`). All three must agree on the
    // request's span — the record is shared, not per copy.
    let seen: { source: TraceContext; dist: TraceContext } | undefined;
    registerServerFunction("trace#echo", () => {
      seen = { source: getTraceContext()!, dist: prod.getTraceContext()! };
      const ctx = seen.source;
      return { traceId: ctx.traceId, parentId: ctx.parentId };
    });
    const response = await handleServerFunctionRequest(
      new Request("https://app.example/_server/data/trace%23echo", {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "X-Server-Function-Instance": "server-function:test",
          "content-type": "application/json",
          "X-Server-Function-Format": "1",
          traceparent: INCOMING
        },
        body: "[]"
      })
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(TRACE_ID);
    expect(body).toContain(PARENT_ID);
    expect(seen!.dist).toBe(seen!.source);
    const timing = serverTiming(response.headers);
    expect(timing.get("traceparent")).toBe(
      `traceparent;desc="00-${TRACE_ID}-${seen!.source.spanId}-01"`
    );
  });

  test("commitResponseStub without an event falls back to the ambient event owning the stub", () => {
    const evt = event({ traceparent: INCOMING });
    inScope(evt, () => commitResponseStub(evt.response));
    expect(serverTiming(evt.response.headers).has("traceparent")).toBe(true);

    const stranger = event({ traceparent: INCOMING });
    const foreign = createRequestEvent(new Request("https://app.example/other")).response;
    inScope(stranger, () => commitResponseStub(foreign));
    expect(foreign.headers.has("server-timing")).toBe(false);
    expect(foreign.committed).toBe(true);
  });
});

describe("<meta> tags in the shell", () => {
  test("a document gets them inside <head>, after the shell's static charset — string and stream", async () => {
    const evt = event({ traceparent: INCOMING });
    const html = inScope(evt, () => renderToString(() => <Doc />));
    const ctx = inScope(evt, () => getTraceContext())!;
    const meta = `<meta name="traceparent" content="00-${TRACE_ID}-${ctx.spanId}-01">`;
    expect(html).toContain(meta);
    // The `</head>` splice, not the prelude: a static `<meta charset>` keeps
    // its place at the top of the head (its first-1024-bytes constraint).
    const charsetAt = html.indexOf('<meta charset="utf-8">');
    expect(charsetAt).toBeGreaterThan(-1);
    expect(html.indexOf(meta)).toBeGreaterThan(charsetAt);
    expect(html.indexOf(meta)).toBeLessThan(html.indexOf("</head>"));

    const streamed = event({ traceparent: INCOMING });
    const out = await inScope(streamed, () => renderToStream(() => <Doc />));
    const streamCtx = inScope(streamed, () => getTraceContext())!;
    expect(out).toContain(
      `<meta name="traceparent" content="00-${TRACE_ID}-${streamCtx.spanId}-01">`
    );
  });

  test("an embedded render hands them to onHead; a headless fragment drops them", () => {
    const evt = event({ traceparent: INCOMING });
    let head = "";
    const html = inScope(evt, () =>
      renderToString(() => <p>fragment</p>, {
        onHead: h => {
          head = h;
        }
      })
    );
    expect(html).toContain("fragment");
    expect(html).not.toContain("traceparent");
    expect(head).toContain('<meta name="traceparent" content="00-');

    const bare = event({ traceparent: INCOMING });
    const fragment = inScope(bare, () => renderToString(() => <p>fragment</p>));
    expect(fragment).toContain("fragment");
    expect(fragment).not.toContain("traceparent");
    // The header carrier still speaks for it.
    const response = createSSRResponse(fragment, bare);
    expect(serverTiming(response.headers).has("traceparent")).toBe(true);
  });

  test("a render outside any request scope asks the provider (with no request) and ships the metas", async () => {
    const calls: unknown[] = [];
    provide(request => {
      calls.push(request);
      return { entries: { "sentry-trace": "shell-only" } };
    });
    const out = await renderToStream(() => <Doc />);
    expect(calls).toEqual([undefined]);
    expect(out).toContain('<meta name="traceparent" content="00-');
    expect(out).toContain('<meta name="sentry-trace" content="shell-only">');
  });

  test("entry values are attribute-escaped; a name that is not a token is skipped in both carriers", () => {
    provide(() => ({
      entries: { baggage: 'a="<b>"&c', "bad name": "x", "bad<name>": "y" }
    }));
    const evt = event();
    const html = inScope(evt, () => renderToString(() => <Doc />));
    expect(html).toContain('<meta name="baggage" content="a=&quot;&lt;b&gt;&quot;&amp;c">');
    expect(html).not.toContain("bad name");
    expect(html).not.toContain("bad<name>");
    const response = createSSRResponse(html, evt);
    const timing = serverTiming(response.headers);
    expect([...timing.keys()]).toEqual(["traceparent", "baggage"]);
    expect(timing.get("baggage")).toBe('baggage;desc="a=\\"<b>\\"&c"');
  });

  test("useHead metas from the app are untouched by the trace's", () => {
    const evt = event({ traceparent: INCOMING });
    const Page = () => {
      useHead(() => [{ tag: "meta", props: { name: "description", content: "d" } }]);
      return <Doc />;
    };
    const html = inScope(evt, () => renderToString(() => <Page />));
    expect(html).toContain('name="description"');
    expect(html).toContain('name="traceparent"');
  });
});
