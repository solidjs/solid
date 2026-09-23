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
  Loading,
  commitEventResponse,
  createRequestEvent,
  createSSRResponse,
  getTraceContext,
  httpHeader,
  renderToStream,
  renderToString,
  useHead
} from "@solidjs/web";
import { createMemo } from "solid-js";
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
// The OBSERVE-tier artifacts (`_SOLID_DEV_` false), for the timing metrics'
// gate: the source this suite runs as is the dev tier, which carries them
// always.
let observeWeb: typeof import("@solidjs/web");
let observeFns: typeof import("@solidjs/web/server-functions/server");

beforeAll(async () => {
  storage = new AsyncLocalStorage();
  (globalThis as any)[RequestContext] = storage;
  const load = (path: string) =>
    import(/* @vite-ignore */ pathToFileURL(resolve(webRoot, path)).href);
  prod = await load("dist/server.js");
  observeWeb = await load("dist/server.observe.js");
  observeFns = await load("server-functions/dist/server.observe.js");
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

// The `Server-Timing` list split on the commas outside quoted strings.
function serverTimingEntries(headers: Headers): string[] {
  const value = headers.get("server-timing");
  const out: string[] = [];
  if (value === null) return out;
  let start = 0;
  let quoted = false;
  const push = (end: number) => {
    const entry = value.slice(start, end).trim();
    if (entry) out.push(entry);
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

// The TRACE's entries on the stub's `Server-Timing`, as `name -> full
// entry` — the runtime's timing metrics (`solid-*`, the dev tier this
// suite runs as always carries them; see "the request's timed work" below)
// are set aside so these tests read the trace half alone.
function serverTiming(headers: Headers): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of serverTimingEntries(headers)) {
    const name = entry.split(";")[0].trim();
    if (!name.startsWith("solid-")) out.set(name, entry);
  }
  return out;
}

/** The runtime's timing metrics (`solid-*`), in list order, as `{ name, dur, desc }`. */
function timingMetrics(headers: Headers): { name: string; dur: number; desc?: string }[] {
  const out: { name: string; dur: number; desc?: string }[] = [];
  for (const entry of serverTimingEntries(headers)) {
    const [name, ...params] = entry.split(";").map(s => s.trim());
    if (!name.startsWith("solid-")) continue;
    const metric: { name: string; dur: number; desc?: string } = { name, dur: NaN };
    for (const param of params) {
      if (param.startsWith("dur=")) metric.dur = Number(param.slice(4));
      else if (param.startsWith("desc=")) metric.desc = param.slice(6, -1);
    }
    out.push(metric);
  }
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
    expect(notSampled.parentId).toBe(PARENT_ID);
    // Continued and formatted for forwarding — but see the emission block:
    // an unsampled upstream trace is not advertised to the browser.
    expect(notSampled.entries.traceparent).toBe(`00-${TRACE_ID}-${notSampled.spanId}-00`);
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
  // The provider slot lives on `OBSERVE.server` under a registered symbol
  // solid-js's server entry owns (one slot across every bundle copy); the web
  // runtime reaches it by the same name, which is the string that marks the
  // module.
  const PROVIDER_MARK = "solid-js/observe/server/provider";
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
    // No trace entry on the head (the dev tier's own timing metrics ride
    // regardless — the request's timed work, not the trace).
    expect(serverTiming(response.headers).size).toBe(0);
    expect(html).not.toContain('name="traceparent"');
    // ...but it exists for the server's own use (downstream propagation, logs).
    expect(inScope(evt, () => getTraceContext())).toBeDefined();
  });

  test("an UNSAMPLED upstream trace is continued but not advertised — infra-stamped traceparents are a no-op", () => {
    // What a load balancer / mesh (GCP, Envoy, Front Door) puts on every
    // request it forwards when nothing sampled it: flags `00`. Nobody is
    // recording this trace, so an app on that infra with no APM must see
    // zero wire change — and an OTel-web parent-based sampler must not be
    // handed an unsampled parent that would drop its pageload.
    const infra = `00-${TRACE_ID}-${PARENT_ID}-00`;
    const evt = event({ traceparent: infra });
    const html = inScope(evt, () => renderToString(() => <Doc />));
    const response = createSSRResponse(html, evt);
    expect(serverTiming(response.headers).size).toBe(0);
    expect(html).not.toContain("traceparent");
    // Still the request's trace, continued, for downstream forwarding.
    const ctx = inScope(evt, () => getTraceContext())!;
    expect(ctx.traceId).toBe(TRACE_ID);
    expect(ctx.parentId).toBe(PARENT_ID);
    expect(ctx.entries.traceparent).toBe(`00-${TRACE_ID}-${ctx.spanId}-00`);

    // The other exit says nothing either; the response comes back as-is.
    const bare = {
      request: new Request("https://app.example/", { headers: { traceparent: infra } }),
      locals: {}
    };
    const original = new Response("ok");
    expect(inScope(bare as any, () => commitEventResponse(original, bare as any))).toBe(original);

    // A provider's answer overrides that silence: it is the recorder now,
    // and propagating its own "not sampled" decision is its call.
    provide(() => ({ entries: { "sentry-trace": `${TRACE_ID}-${"c".repeat(16)}-0` } }));
    const observed = event({ traceparent: infra });
    const observedHtml = inScope(observed, () => renderToString(() => <Doc />));
    const timing = serverTiming(createSSRResponse(observedHtml, observed).headers);
    expect(timing.get("traceparent")).toMatch(/-00"$/);
    expect(timing.has("sentry-trace")).toBe(true);
    expect(observedHtml).toContain('name="sentry-trace"');
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

// The request's timed server work as `Server-Timing` metrics
// (`TimingMetric` in trace.ts; painted by `@solidjs/web/performance-tracks`
// under the matching client span): `solid-shell` and the `solid-boundary`s
// the shell waited on, on the document; `solid-invocation` on a
// server-function response. Gated like the trace: the dev tier carries them
// always; an observe build only while a listener is on the record the same
// measurement feeds, so an app with no observer sees no wire change.
describe("Server-Timing: the request's timed work", () => {
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
  const unsubscribes: Array<() => void> = [];
  afterEach(() => {
    for (const off of unsubscribes.splice(0)) off();
  });
  const listen = (type: "boundary" | "invocation") => {
    unsubscribes.push(OBSERVE!.records.subscribe(type, () => {}));
  };

  /** A boundary that waits, and holds the shell for its content (`deferStream`). */
  function Held(props: { ms: number; children: string }) {
    const data = createMemo(
      async () => {
        await delay(props.ms);
        return props.children;
      },
      { deferStream: true }
    );
    return <div>{data()}</div>;
  }
  /** A boundary that waits past the shell and streams. */
  function Late(props: { ms: number; children: string }) {
    const data = createMemo(async () => {
      await delay(props.ms);
      return props.children;
    });
    return <div>{data()}</div>;
  }

  /**
   * The document as a response: the head commits when the shell reaches
   * the sink, which is what `createSSRResponse`'s promise waits for.
   */
  async function respond(
    web: typeof import("@solidjs/web"),
    evt: HttpEvent,
    page: () => any
  ): Promise<Headers> {
    const stream = inScope(evt, () => web.renderToStream(page));
    const response = await web.createSSRResponse(stream, evt);
    return response.headers;
  }

  test("the document: solid-shell first, then each boundary the shell waited on, by owner path", async () => {
    function Page() {
      return (
        <Doc>
          <Loading fallback={<i>…</i>}>
            <Held ms={15}>in-shell</Held>
          </Loading>
          <Loading fallback={<i>…</i>}>
            <Late ms={40}>streamed</Late>
          </Loading>
        </Doc>
      );
    }
    const evt = event();
    const headers = await respond({ renderToStream, createSSRResponse } as any, evt, () => (
      <Page />
    ));
    const metrics = timingMetrics(headers);
    expect(metrics.map(m => m.name)).toEqual(["solid-shell", "solid-boundary"]);
    const [shell, boundary] = metrics;
    // The shell spans the wait it made; the streamed boundary settled after
    // the head left and is not on it.
    expect(boundary.dur).toBeGreaterThanOrEqual(14);
    expect(shell.dur).toBeGreaterThanOrEqual(boundary.dur);
    expect(shell.desc).toBeUndefined();
    // Labelled by owner path, as the client's `fallback` record and the
    // findings label the same boundary (`sourceNames` compiles the component
    // calls) — ASCII ` > ` on the wire, a header value being a byte string.
    expect(boundary.desc).toBe("<Page> > <Doc> > <Loading>");
    // A trace nobody records is still not advertised beside them.
    expect(serverTiming(headers).size).toBe(0);
  });

  test("a boundary decided on its first pass held nothing up and is not a metric", () => {
    function Page() {
      return (
        <Doc>
          <Loading fallback={<i>…</i>}>
            <Late ms={5}>never-on-server</Late>
          </Loading>
        </Doc>
      );
    }
    // renderToString: the fallback ships final, no pass past discovery.
    const evt = event();
    const html = inScope(evt, () => renderToString(() => <Page />));
    const response = createSSRResponse(html, evt);
    expect(timingMetrics(response.headers).map(m => m.name)).toEqual(["solid-shell"]);
  });

  test("a server-function response: solid-invocation with the function id, on the observe tier only while observed", async () => {
    observeFns.registerServerFunction("timing#work", async () => {
      await delay(10);
      return "done";
    });
    const call = () =>
      observeFns.handleServerFunctionRequest(
        new Request("https://app.example/_server/data/timing%23work", {
          method: "POST",
          headers: {
            "Sec-Fetch-Site": "same-origin",
            "content-type": "application/json",
            "X-Server-Function-Format": "1"
          },
          body: "[]"
        }),
        { createEvent: createRequestEvent }
      );

    // No listener on `"invocation"`: the observe build measures nothing and
    // the wire is unchanged.
    const quiet = await call();
    expect(quiet.status).toBe(200);
    expect(quiet.headers.has("server-timing")).toBe(false);

    listen("invocation");
    const observed = await call();
    expect(observed.status).toBe(200);
    const metrics = timingMetrics(observed.headers);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({ name: "solid-invocation", desc: "timing#work" });
    expect(metrics[0].dur).toBeGreaterThanOrEqual(9);
    expect(serverTiming(observed.headers).size).toBe(0);
  });

  test("the document on the observe tier: nothing without a boundary listener, the shell and its boundaries with one", async () => {
    function Page() {
      return (
        <Doc>
          <Loading fallback={<i>…</i>}>
            <Held ms={5}>in-shell</Held>
          </Loading>
        </Doc>
      );
    }
    const quiet = await respond(observeWeb, event(), () => <Page />);
    expect(quiet.has("server-timing")).toBe(false);

    listen("boundary");
    const observed = await respond(observeWeb, event(), () => <Page />);
    expect(timingMetrics(observed).map(m => m.name)).toEqual(["solid-shell", "solid-boundary"]);
  });

  test("metrics fold beside a response's own Server-Timing, repeated names included", () => {
    const evt = event();
    // Two boundaries' worth of metrics on the stub, the app's metric on the
    // response: the fold keeps every one (the by-name skip is against what
    // the response had, not what the fold added).
    evt.response.headers.append("Server-Timing", 'solid-boundary;dur=5;desc="<A>"');
    evt.response.headers.append("Server-Timing", 'solid-boundary;dur=7;desc="<B>"');
    const out = inScope(evt, () =>
      commitEventResponse(new Response("ok", { headers: { "Server-Timing": "db;dur=53" } }), evt)
    );
    const entries = serverTimingEntries(out.headers);
    expect(entries).toContain("db;dur=53");
    expect(entries.filter(e => e.startsWith("solid-boundary"))).toHaveLength(2);
  });

  test("dur is rounded to a tenth; desc is quoted", () => {
    const evt = event();
    const html = inScope(evt, () => renderToString(() => <Doc />));
    const response = createSSRResponse(html, evt);
    const [shell] = serverTimingEntries(response.headers);
    expect(shell).toMatch(/^solid-shell;dur=\d+(\.\d)?$/);
  });
});
