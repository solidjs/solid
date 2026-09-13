// Trace context: the W3C Trace Context (`traceparent` / `tracestate`) and
// `baggage` half of the HTTP exchange, derived once per request and handed
// on — down to the browser on the first response, and out to downstream
// services by application code (`getTraceContext().entries.traceparent`).
//
// Two halves, two tiers. The W3C half — parse the incoming headers,
// originate a trace when none came in, expose the result, emit the
// runtime's own entries — is core HTTP behavior in EVERY tier, beside
// `getRequestEvent()` / `httpHeader()`: a server function forwarding the
// trace to the service it calls must work in production with no observer
// installed. The provider slot (`OBSERVE.server.trace`) — an observer's
// way to override or extend what the runtime derived (Sentry answering from
// OTel's active span, adding its vendor entries) — is observe/dev only,
// like the rest of `OBSERVE`, and folds out of prod behind the
// `"_SOLID_OBSERVE_"` literal.
//
// One set of `entries`, two carriers: `Server-Timing` on the response head
// (frames, RPC responses and redirects have no `<head>`; also the carrier
// Sentry's browser SDK reads since 10.45) and `<meta>` tags in the HTML
// shell (what OTel web's document-load instrumentation reads). The browser
// is told about a trace only when something is RECORDING it — an incoming
// `traceparent` whose sampled flag is set (the caller says it recorded), or a
// provider that answered. Neither a trace the runtime originated alone nor
// an unsampled upstream one qualifies: there is no recorded server span for
// the browser to attach to, and advertising a parent with flags `00` would
// make a parent-based browser sampler DROP the pageload it would otherwise
// record. That last case is common infrastructure, not an edge: load
// balancers and meshes (GCP, Envoy/Istio, Azure Front Door) stamp
// `00-…-00` on every request they forward, and an app on them with no APM
// must see zero wire change. The unsampled trace is still the request's —
// `getTraceContext()` exposes it, and forwarding it downstream stays
// correct W3C propagation.
//
// State hangs off the shared `OBSERVE` object under a registered symbol for
// the same reason as `server-observe.ts`: each server bundle carries its own
// copy of this module.
import { OBSERVE } from "solid-js";

/**
 * The trace the current request belongs to — continued from the incoming
 * W3C `traceparent` when there was one, originated by the runtime
 * otherwise. Read with `getTraceContext()`.
 */
export interface TraceContext {
  /** 32 lowercase hex — the whole trace. */
  traceId: string;
  /** 16 lowercase hex — this request's span: runtime-generated unless a provider supplied it. */
  spanId: string;
  /** The incoming parent span, when the request continued a trace. */
  parentId?: string;
  /** The incoming `traceparent` sampled flag (bit 0); `undefined` when the runtime originated. */
  sampled?: boolean;
  /** The incoming `tracestate` header, verbatim. */
  state?: string;
  /** The incoming `baggage` header, verbatim. */
  baggage?: string;
  /**
   * Named entries handed to the browser on the first response — emitted
   * both as `Server-Timing` entries (`<name>;desc="<value>"`) and, for HTML
   * documents, as `<meta name="<name>" content="<value>">` in the shell.
   * The runtime fills `traceparent`; a provider adds its vendor pair
   * (`sentry-trace`, `baggage`). Also what application code forwards
   * downstream: `fetch(url, { headers: { traceparent: entries.traceparent } })`.
   */
  entries: Record<string, string>;
}

/**
 * An observer's answer for the trace a request belongs to, merged over the
 * runtime's default derivation: fields it returns replace the derived
 * ones (`traceId`/`spanId` from an APM's active span), its `entries` merge
 * by name over the runtime's. Called once per request (or per render, for
 * a render outside a request scope — `request` is then `undefined`), at
 * shell flush or the first `getTraceContext()`, whichever comes first.
 * Return `undefined` to leave the derivation alone.
 */
export type TraceProvider = (request: Request | undefined) => Partial<TraceContext> | undefined;

/**
 * `OBSERVE.server.trace` — the provider slot. One provider at a time: an
 * observer installs its answer once at startup (Sentry's `init()`), and a
 * later install replaces it — the single-plugin shape, not a chain.
 */
export interface TraceSlot {
  /** Installs `provider`, replacing any current one. Returns the uninstall. */
  provide(provider: TraceProvider): () => void;
}

declare module "solid-js" {
  interface ServerObserve {
    /** The trace-context provider slot — see `TraceSlot`. */
    trace: TraceSlot;
  }
}

/** A derived trace plus whether the browser is told about it (see the header note). */
export interface TraceRecord {
  context: TraceContext;
  emit: boolean;
}

// Replaced per build; a module const so the gates below read as booleans.
const IS_OBSERVE = "_SOLID_OBSERVE_" as unknown as boolean;

const PROVIDER = Symbol.for("@solidjs/web/observe/trace-provider");

type SlotState = TraceSlot & { [PROVIDER]: TraceProvider | undefined };

/** Creates the slot `installServerObserve` parks on `OBSERVE.server.trace`. Observe/dev only. */
export function createTraceSlot(): TraceSlot {
  const slot: SlotState = {
    [PROVIDER]: undefined,
    provide(provider) {
      slot[PROVIDER] = provider;
      return () => {
        if (slot[PROVIDER] === provider) slot[PROVIDER] = undefined;
      };
    }
  };
  return slot;
}

function currentProvider(): TraceProvider | undefined {
  if (!IS_OBSERVE || OBSERVE === undefined) return undefined;
  const slot = OBSERVE.server.trace as SlotState | undefined;
  return slot && slot[PROVIDER];
}

// --- W3C Trace Context ----------------------------------------------------

// `version-traceId-parentId-flags`, lowercase hex. Version `ff` is invalid;
// a future version may carry more fields after the flags and is read as
// version 00 (the spec's forward-compatibility rule); version 00 itself
// must end at the flags.
const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const ZERO_TRACE = "00000000000000000000000000000000";
const ZERO_SPAN = "0000000000000000";

function parseTraceparent(
  value: string | null
): { traceId: string; parentId: string; sampled: boolean } | undefined {
  if (!value) return undefined;
  const m = TRACEPARENT.exec(value.trim());
  if (!m) return undefined;
  const [, version, traceId, parentId, flags, rest] = m;
  if (version === "ff") return undefined;
  if (version === "00" && rest !== undefined) return undefined;
  if (traceId === ZERO_TRACE || parentId === ZERO_SPAN) return undefined;
  return { traceId, parentId, sampled: (parseInt(flags, 16) & 1) === 1 };
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let out = "";
  for (let i = 0; i < buffer.length; i++)
    out += (buffer[i] < 16 ? "0" : "") + buffer[i].toString(16);
  return out;
}

function randomTraceId(): string {
  let id = randomHex(16);
  while (id === ZERO_TRACE) id = randomHex(16);
  return id;
}

function randomSpanId(): string {
  let id = randomHex(8);
  while (id === ZERO_SPAN) id = randomHex(8);
  return id;
}

/** `00-<traceId>-<spanId>-<flags>` for a context. */
export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled === true ? "01" : "00"}`;
}

// Memoized per key — the request event's `request` when there is one (a
// direct SSR-time server-function call runs under a DERIVED event that
// shares it, and must see the render's trace), the render context otherwise.
// The map is parked on the global under a registered symbol, like
// `RequestContext`: the server-function handler (its own bundle copy of
// this module) commits the response a function body read the trace in
// through `@solidjs/web` (another copy), and both must find ONE record —
// a per-copy map would give the same request two span ids.
const RECORDS_KEY = Symbol.for("@solidjs/web/trace/records");

function records(): WeakMap<object, TraceRecord> {
  const g = globalThis as any;
  return g[RECORDS_KEY] || (g[RECORDS_KEY] = new WeakMap<object, TraceRecord>());
}

/**
 * The trace record for `key`, derived once: incoming `traceparent` /
 * `tracestate` / `baggage` from `request`, origination when absent, then
 * (observe/dev) the installed provider's answer merged over it.
 */
export function traceFor(key: object, request: Request | undefined): TraceRecord {
  const store = records();
  let record = store.get(key);
  if (record) return record;
  const headers = request ? request.headers : undefined;
  const incoming = headers ? parseTraceparent(headers.get("traceparent")) : undefined;
  const context: TraceContext = {
    traceId: incoming ? incoming.traceId : randomTraceId(),
    spanId: randomSpanId(),
    entries: {}
  };
  if (incoming) {
    context.parentId = incoming.parentId;
    context.sampled = incoming.sampled;
  }
  if (headers) {
    const state = headers.get("tracestate");
    if (state) context.state = state;
    const baggage = headers.get("baggage");
    if (baggage) context.baggage = baggage;
  }
  let answered = false;
  let providedEntries: Record<string, string> | undefined;
  if (IS_OBSERVE) {
    const provider = currentProvider();
    if (provider) {
      let answer: Partial<TraceContext> | undefined;
      try {
        answer = provider(request);
      } catch (error) {
        console.error(error);
      }
      if (answer !== undefined && answer !== null) {
        answered = true;
        if (answer.traceId !== undefined) context.traceId = answer.traceId;
        if (answer.spanId !== undefined) context.spanId = answer.spanId;
        if (answer.parentId !== undefined) context.parentId = answer.parentId;
        if (answer.sampled !== undefined) context.sampled = answer.sampled;
        if (answer.state !== undefined) context.state = answer.state;
        if (answer.baggage !== undefined) context.baggage = answer.baggage;
        providedEntries = answer.entries;
      }
    }
  }
  // The runtime's entry reflects the FINAL ids — a provider's included.
  // The incoming `baggage` is deliberately not echoed to the browser: it is
  // upstream context (a proxy's, a gateway's) that was never meant for the
  // page; a provider that wants its own `baggage` in the document adds it.
  context.entries.traceparent = formatTraceparent(context);
  if (providedEntries) Object.assign(context.entries, providedEntries);
  // Told to the browser only when something is recording the trace: a
  // SAMPLED upstream trace, or a provider that answered (its own vendor
  // entries may well carry a "not sampled" decision — that is the
  // provider's call to propagate). See the header note.
  record = { context, emit: (incoming !== undefined && incoming.sampled) || answered };
  store.set(key, record);
  return record;
}

// --- Emission --------------------------------------------------------------

// RFC 9110 token, the shape of a `Server-Timing` metric name. An entry a
// provider named outside it cannot ride the header (and would make
// `Headers.append` throw), so it is skipped there and in the metas alike.
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// Splits a `Server-Timing` list on the commas OUTSIDE quoted strings — a
// `desc` may carry commas (`baggage;desc="sentry-release=1,sentry-env=prod"`).
function splitServerTiming(value: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      entries.push(value.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(value.slice(start));
  return entries;
}

function metricName(entry: string): string {
  return entry.split(";")[0].trim().toLowerCase();
}

function namesOnServerTiming(headers: Headers): Set<string> {
  const names = new Set<string>();
  const existing = headers.get("server-timing");
  if (existing) {
    for (const entry of splitServerTiming(existing)) {
      const name = metricName(entry);
      if (name) names.add(name);
    }
  }
  return names;
}

// Quoted-string: escape the two characters it cannot carry raw, drop
// controls (a header value cannot carry them at all).
function quoteDesc(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, "").replace(/[\\"]/g, m => "\\" + m);
}

/**
 * Appends the record's entries to `headers` as `Server-Timing`
 * metrics — `<name>;desc="<value>"` — never duplicating a name the app
 * already wrote. Nothing when the browser is not told (see `TraceRecord`).
 * Must run before the response head commits.
 */
export function appendTraceServerTiming(headers: Headers, record: TraceRecord): void {
  if (!record.emit) return;
  const entries = record.context.entries;
  let present: Set<string> | undefined;
  for (const name in entries) {
    if (!TOKEN.test(name)) continue;
    if (!present) present = namesOnServerTiming(headers);
    if (present.has(name.toLowerCase())) continue;
    headers.append("Server-Timing", `${name};desc="${quoteDesc(entries[name])}"`);
    present.add(name.toLowerCase());
  }
}

/**
 * Folds a `Server-Timing` header value onto `target` entry by entry,
 * skipping names already present — the header is a list, so a stub's
 * trace entries and a response's own metrics (`db;dur=53`) coexist
 * instead of one replacing the other.
 */
export function mergeServerTiming(target: Headers, value: string): void {
  const present = namesOnServerTiming(target);
  for (const entry of splitServerTiming(value)) {
    const trimmed = entry.trim();
    const name = metricName(trimmed);
    if (!name || present.has(name)) continue;
    target.append("Server-Timing", trimmed);
    present.add(name);
  }
}

function escapeAttr(value: string): string {
  return value.replace(/[&"<>]/g, c =>
    c === "&" ? "&amp;" : c === '"' ? "&quot;" : c === "<" ? "&lt;" : "&gt;"
  );
}

/**
 * The record's entries as `<meta name content>` tags for the HTML shell's
 * prelude (after charset/base). Empty when the browser is not told.
 */
export function traceMetaMarkup(record: TraceRecord): string {
  if (!record.emit) return "";
  let markup = "";
  const entries = record.context.entries;
  for (const name in entries) {
    if (!TOKEN.test(name)) continue;
    markup += `<meta name="${name}" content="${escapeAttr(entries[name])}">`;
  }
  return markup;
}
