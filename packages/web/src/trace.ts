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
import { OBSERVE, type BoundaryEvent, type ServerTrace } from "solid-js";
import type { InvocationEvent, RenderEvent } from "./observe.js";

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

// `OBSERVE.server.trace` — the provider slot. One provider at a time: an
// observer installs its answer once at startup (Sentry's `init()`), and a
// later install replaces it — the single-plugin shape, not a chain.
//
// The member and its container are `solid-js`'s (`ServerTrace`, declared
// empty there); what a provider IS is this runtime's, so `provide` is typed
// here, by augmentation through `solid-js` — the peer every consumer of this
// package resolves, and the one module name solid-js's interfaces are
// augmented through (see the core's `RecordTypes` note on why one).
declare module "solid-js" {
  interface ServerTrace {
    /** Installs `provider`, replacing any current one. Returns the uninstall. */
    provide(provider: TraceProvider): () => void;
  }
}

/**
 * The request's server work as recorded — the `"invocation"` and
 * `"boundary"` records made while it was served, in completion order —
 * from which the `Server-Timing` metrics are projected at head commit
 * (`appendTraceServerTiming`): `solid-invocation;dur=<durationMs>;desc="<id>"`
 * for an execution, `solid-boundary;dur=<durationMs>;desc="<owner path>"` for
 * a `<Loading>` boundary the shell waited on (the `"render"` record on the
 * same `TraceRecord` gives `solid-shell;dur=<shellMs>`). One gate for record
 * and metric alike: a record is built in dev builds always, and in observe
 * builds while a listener is on its type (`OBSERVE.records.observed`), so
 * the header is a projection of what was recorded, never a second clock —
 * an app with no observer sees no wire change (the trace's rule). What
 * rides is what the server knew when the head left — the function that
 * produced a response; for a document, the shell and the boundaries that
 * settled inside it. The Performance-panel adapter paints these under the
 * matching client span (`@solidjs/web/performance-tracks`).
 */
export type TimedWork =
  | { type: "invocation"; event: InvocationEvent }
  | { type: "boundary"; event: BoundaryEvent };

/** A derived trace plus whether the browser is told about it (see the header note). */
export interface TraceRecord {
  context: TraceContext;
  emit: boolean;
  /** The request's recorded server work, in completion order (see `TimedWork`). */
  timing: TimedWork[];
  /**
   * The render this request is serving, while one is being recorded — the
   * `"render"` record as it fills (`RenderEvent`): `solid-shell` is its
   * `shellMs`, once the shell is complete.
   */
  render?: RenderEvent;
}

// Replaced per build; a module const so the gates below read as booleans.
const IS_OBSERVE = "_SOLID_OBSERVE_" as unknown as boolean;

// The slot object is `solid-js`'s (`serverSlots` in its server entry —
// created per process under a registered symbol, so a provider installed
// before this module loaded, or from another copy of it, is the one read
// here). Its state key is re-created by name; the registered string is the
// contract.
const PROVIDER = Symbol.for("solid-js/observe/server/provider");

type SlotState = ServerTrace & { [PROVIDER]?: TraceProvider };

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
  record = {
    context,
    emit: (incoming !== undefined && incoming.sampled) || answered,
    timing: []
  };
  store.set(key, record);
  return record;
}

/**
 * The trace record for a request event — keyed on its `request` (shared by
 * the derived events direct server-function calls run under, so a call
 * during a render sees the render's trace) or on the event itself.
 */
export function traceForEvent(event: { request?: Request }): TraceRecord {
  return traceFor(event.request || event, event.request);
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
// controls (a header value cannot carry them at all) and replace anything
// past printable ASCII with `?` — a header value is a byte string, and
// `Headers.append` throws on a code point above 0xFF; a throw here is
// inside the shell's first write, which would hang the response.
function quoteDesc(value: string): string {
  return value
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[\\"]/g, m => "\\" + m);
}

/** The shell metric's duration, once the render's shell is complete. */
function shellMs(record: TraceRecord): number | undefined {
  return record.render !== undefined ? record.render.shellMs : undefined;
}

/** Whether `appendTraceServerTiming` has anything to write for `record`. */
export function hasServerTiming(record: TraceRecord): boolean {
  return record.emit || record.timing.length > 0 || shellMs(record) !== undefined;
}

/**
 * Appends the record to `headers` as `Server-Timing` metrics — its trace
 * entries as `<name>;desc="<value>"` when the browser is told (see
 * `TraceRecord`), never duplicating a name the app already wrote; and the
 * server work it recorded as `<name>;dur=<ms>;desc="<desc>"`, each metric a
 * projection of one record (see `TimedWork`): `solid-shell` first, from the
 * render record, then the invocations and boundaries in completion order.
 * Metrics repeat their names by design (one `solid-boundary` per boundary),
 * so they are not name-deduplicated. Must run before the response head
 * commits.
 */
export function appendTraceServerTiming(headers: Headers, record: TraceRecord): void {
  if (record.emit) {
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
  const shell = shellMs(record);
  if (shell !== undefined) headers.append("Server-Timing", formatMetric("solid-shell", shell));
  for (const work of record.timing) headers.append("Server-Timing", metricOf(work));
}

/** The `Server-Timing` metric one recorded piece of server work projects to. */
function metricOf(work: TimedWork): string {
  if (work.type === "invocation")
    return formatMetric("solid-invocation", work.event.durationMs, work.event.id);
  // Labelled by owner path, the label the client's `fallback` record and
  // the findings carry — ASCII ` > ` on the wire (a header value is a byte
  // string; the adapter renders the artifact's ` › `); the hydration id when
  // the runtime knows no names.
  const boundary = work.event;
  return formatMetric(
    "solid-boundary",
    boundary.durationMs,
    boundary.ownerPath !== undefined ? boundary.ownerPath.join(" > ") : boundary.id
  );
}

/** `<name>;dur=<ms>;desc="<desc>"` — `name` an RFC 9110 token, `desc` quoted and ASCII-sanitised. */
function formatMetric(name: string, dur: number, desc?: string): string {
  // One decimal: the panel's resolution; a header is not a profiler.
  let out = `${name};dur=${Math.round(dur * 10) / 10}`;
  if (desc) out += `;desc="${quoteDesc(desc)}"`;
  return out;
}

/**
 * Folds a `Server-Timing` header value onto `target` entry by entry,
 * skipping names `target` already carries — the header is a list, so a
 * stub's trace entries and a response's own metrics (`db;dur=53`) coexist
 * instead of one replacing the other. Names repeated within `value` itself
 * (one `solid-boundary` per boundary) all fold: the skip is against what
 * the target had, not what this fold added.
 */
export function mergeServerTiming(target: Headers, value: string): void {
  const present = namesOnServerTiming(target);
  for (const entry of splitServerTiming(value)) {
    const trimmed = entry.trim();
    const name = metricName(trimmed);
    if (!name || present.has(name)) continue;
    target.append("Server-Timing", trimmed);
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
