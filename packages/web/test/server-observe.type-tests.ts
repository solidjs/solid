// Acceptance test for the `OBSERVE.server` augmentation layering: signals
// declares `ServerObserve` empty; solid-js augments it (once) with `records:
// ServerRecords` and `trace: ServerTrace`, declaring both interfaces itself
// with its own `"boundary"` record; and `@solidjs/web`'s server modules
// augment THOSE two, through `solid-js` (the peer a consumer can resolve
// from this package's types), with the `"invocation"` record and `provide`.
// Each merge has to follow a re-export alias to its declaration: a consumer
// reading `OBSERVE.server.records` off the `solid-js` import must find BOTH
// overloads, and the record/live types must be the ones each package
// exports. Compile-only — runs under `test-types` against the BUILT package
// types via the self-link (`pnpm types` first), so the augmentations are
// checked exactly as published.
import {
  OBSERVE,
  type BoundaryEvent,
  type BoundaryLive,
  type ServerRecords,
  type ServerTrace
} from "solid-js";
import type {
  InvocationEvent,
  InvocationLive,
  TraceContext,
  TraceProvider,
  TraceSlot
} from "@solidjs/web";
import { getTraceContext } from "@solidjs/web";

declare const observe: NonNullable<typeof OBSERVE>;

// The channel surfaces with its declared type, not as an error on an empty
// interface.
observe.server.records satisfies ServerRecords;

// A consumer's listener sees the record and the live handles typed.
observe.server.records.subscribe("invocation", (event, live) => {
  event satisfies InvocationEvent;
  live satisfies InvocationLive;
  event.id satisfies string;
  event.direct satisfies boolean;
  event.durationMs satisfies number;
  event.outcome satisfies "ok" | "error";
  event.deferred satisfies true | undefined;
  live.event.request satisfies Request;
  live.request satisfies Request | undefined;
  live.args satisfies unknown[];
});

// solid-js's own record merges onto the same channel, from its module.
observe.server.records.subscribe("boundary", (event, live) => {
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

// The subscription type is closed: the union of record types is what the
// loaded runtimes declared (frame records join it in later work, by name).
// @ts-expect-error no such record type on the channel yet
observe.server.records.subscribe("frame", () => {});

// The unsubscribe is a plain thunk.
const off: () => void = observe.server.records.subscribe("invocation", () => {});
off();

// The trace-provider slot: the member is solid-js's (`ServerTrace`), the
// `provide` on it is this package's augmentation (trace.ts) — a second
// solid-js interface filled in from a second module; both merges land.
observe.server.trace satisfies TraceSlot;
observe.server.trace satisfies ServerTrace;
const slot: TraceSlot = observe.server.trace;
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

// Nothing else was added to the slot: an unknown member is an error, which
// is what distinguishes a merged interface from a permissive one.
// @ts-expect-error not a member of ServerObserve
observe.server.somethingElse;
