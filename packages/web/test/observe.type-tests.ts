// Acceptance test for the `OBSERVE.records` type layering: the core declares
// the channel (`Records`) generic over a catalogue split in two — it
// declares `RecordTypes` (which solid-js augments, once, through
// `@solidjs/signals`, with its `"boundary"` record) extending
// `HostRecordTypes` (which this package augments, once, through `solid-js`,
// with `"invocation"`, `"call"` and `"frame"`). Beside it, `OBSERVE.server`:
// the core declares it empty, solid-js augments it with `trace:
// ServerTrace`, and this package's trace.ts augments `ServerTrace` with
// `provide`.
// Each merge has to follow a re-export alias to its declaration: a consumer
// reading `OBSERVE.records` off the `solid-js` import must find EVERY record
// type, and the event/live types must be the ones each package exports.
// Compile-only — runs under `test-types` against the BUILT package types via
// the self-link (`pnpm types` first), so the augmentations are checked
// exactly as published.
import {
  OBSERVE,
  type BoundaryEvent,
  type BoundaryLive,
  type ChangeOrigin,
  type RecordType,
  type Records,
  type RecoveryEvent,
  type RecoveryLive,
  type ServerTrace
} from "solid-js";
import type {
  CallEvent,
  CallLive,
  FrameAppliedEvent,
  FrameEvent,
  FrameLive,
  FrameProducedEvent,
  InvocationEvent,
  InvocationLive,
  TraceContext,
  TraceProvider
} from "@solidjs/web";
import { getTraceContext } from "@solidjs/web";

declare const observe: NonNullable<typeof OBSERVE>;

// The channel surfaces with its declared type, not as an error on an empty
// interface.
observe.records satisfies Records;

// The catalogue is the union of the attribution engine's records (declared by
// the core beside the channel) and what the loaded runtimes declared —
// through both augmentation paths.
type Declared =
  | "rerun"
  | "create"
  | "effect"
  | "flush"
  | "flight"
  | "fallback"
  | "interaction"
  | "hold"
  | "navigation"
  | "graph"
  | "boundary"
  | "recovery"
  | "invocation"
  | "call"
  | "frame";
const declared: Declared = "boundary" as RecordType;
declared;
const known: RecordType = "call" as Declared;
known;

// A consumer's listener sees the record and the live handles typed.
observe.records.subscribe("invocation", (event, live) => {
  event satisfies InvocationEvent;
  live satisfies InvocationLive;
  event.id satisfies string;
  event.direct satisfies boolean;
  event.durationMs satisfies number;
  event.outcome satisfies "ok" | "error";
  event.deferred satisfies true | undefined;
  event.boundary satisfies string | undefined;
  live.event.request satisfies Request;
  live.request satisfies Request | undefined;
  live.args satisfies unknown[];
});

// solid-js's own record merges onto the same channel, from its module.
observe.records.subscribe("boundary", (event, live) => {
  event satisfies BoundaryEvent;
  live satisfies BoundaryLive;
  event.id satisfies string;
  event.durationMs satisfies number;
  event.heldMs satisfies number;
  event.passes satisfies number;
  event.outcome satisfies "settled" | "fallback" | "client" | "error";
  event.streamed satisfies boolean;
  event.revealGroup satisfies string | undefined;
  event.ownerPath satisfies string[] | undefined;
  live.error satisfies unknown;
});

// The client's recovery record — the other end of a boundary the server handed over.
observe.records.subscribe("recovery", (event, live) => {
  event satisfies RecoveryEvent;
  live satisfies RecoveryLive;
  event.id satisfies string;
  event.at satisfies number;
  event.waitedMs satisfies number;
  event.renderMs satisfies number;
});

// The client's call record.
observe.records.subscribe("call", (event, live) => {
  event satisfies CallEvent;
  live satisfies CallLive;
  event.id satisfies string;
  event.method satisfies "GET" | "POST";
  event.durationMs satisfies number;
  event.outcome satisfies "ok" | "error";
  event.status satisfies number | undefined;
  event.deferred satisfies true | undefined;
  // Provenance: the engine's own origin type, so it joins the attribution
  // records (`InteractionEvent.origin`, `HoldEvent.origin`) without a cast.
  event.origin satisfies ChangeOrigin | undefined;
  if (event.origin) event.origin.kind satisfies ChangeOrigin["kind"];
  live.args satisfies unknown[];
  live.response satisfies Response | undefined;
});

// The engine's one query, on the core's attribution slot: what the call
// record is stamped with, typed as the same origin.
observe.attribution.currentOrigin() satisfies ChangeOrigin | undefined;

// The frame record is one type from either side, discriminated by `side`.
observe.records.subscribe("frame", (event, live) => {
  event satisfies FrameEvent;
  live satisfies FrameLive;
  event.id satisfies string;
  event.version satisfies number;
  event.durationMs satisfies number;
  event.shellMs satisfies number | undefined;
  event.chunks satisfies number;
  event.fragments satisfies number;
  event.slots satisfies number;
  event.regions satisfies number;
  event.errors satisfies number;
  live.error satisfies unknown;
  live.response satisfies Response | undefined;
  if (event.side === "server") {
    event satisfies FrameProducedEvent;
    event.outcome satisfies "complete" | "error";
    // @ts-expect-error the address is the client's remap
    event.address;
  } else {
    event satisfies FrameAppliedEvent;
    event.side satisfies "client";
    event.outcome satisfies "complete" | "truncated" | "error";
    event.address satisfies string | undefined;
  }
});

// The subscription type is closed: the union of record types is what the
// loaded runtimes declared.
// @ts-expect-error no such record type on the channel
observe.records.subscribe("hydration", () => {});

// The emitter's half is typed by the same catalogue.
observe.records.observed("frame") satisfies boolean;
// @ts-expect-error no such record type on the channel
observe.records.observed("hydration");
declare const produced: FrameProducedEvent;
observe.records.emit("frame", produced, {});
// @ts-expect-error a boundary record is not a frame record
observe.records.emit("frame", {} as BoundaryEvent, {});

// The unsubscribe is a plain thunk.
const off: () => void = observe.records.subscribe("invocation", () => {});
off();

// The trace-provider slot: the member is solid-js's (`ServerTrace`), the
// `provide` on it is this package's augmentation (trace.ts) — a second
// solid-js interface filled in from a second module; both merges land.
observe.server.trace satisfies ServerTrace;
const slot: ServerTrace = observe.server.trace;
slot.provide satisfies (provider: TraceProvider) => () => void;
const provider: TraceProvider = request => {
  request satisfies Request | undefined;
  // A partial answer: fields and entries are both optional.
  return { sampled: true, entries: { "sentry-trace": "…" } };
};
const uninstall: () => void = observe.server.trace.provide(provider);
uninstall();
// A provider may decline.
observe.server.trace.provide(() => undefined);
// @ts-expect-error the answer is a Partial<TraceContext>, not arbitrary
observe.server.trace.provide(() => ({ traceId: 42 }));

// `getTraceContext()` — the core (every-tier) accessor — is typed the same
// on both entries: the server derives, the client stub answers undefined.
const trace: TraceContext | undefined = getTraceContext();
if (trace) {
  trace.traceId satisfies string;
  trace.spanId satisfies string;
  trace.parentId satisfies string | undefined;
  trace.sampled satisfies boolean | undefined;
  trace.entries satisfies Record<string, string>;
  trace.entries.traceparent satisfies string;
}

// Nothing else was added to the server surface: the records moved off it,
// and an unknown member is an error, which is what distinguishes a merged
// interface from a permissive one.
// @ts-expect-error not a member of ServerObserve
observe.server.somethingElse;
// @ts-expect-error the records channel is OBSERVE.records, not per platform
observe.server.records;
