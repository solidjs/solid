// Acceptance test for the `OBSERVE.server` augmentation point: signals
// declares `ServerObserve` empty, solid-js re-exports the type, and
// `@solidjs/web`'s server-observe module augments it THROUGH `solid-js` (the
// peer a consumer can resolve from this package's types) with the
// invocation channel. The merge has to follow the alias to the declaration
// in signals: a consumer reading `OBSERVE.server.invocations` off the
// `solid-js` import must find the channel typed, and the record/live types
// must be the ones this package exports. Compile-only — runs under
// `test-types` against the BUILT package types via the self-link (`pnpm
// types` first), so the augmentation is checked exactly as published.
import { OBSERVE } from "solid-js";
import type {
  InvocationChannel,
  InvocationEvent,
  InvocationLive,
  TraceContext,
  TraceProvider,
  TraceSlot
} from "@solidjs/web";
import { getTraceContext } from "@solidjs/web";

declare const observe: NonNullable<typeof OBSERVE>;

// The augmented member surfaces with its exact type, not as an error on an
// empty interface.
observe.server.invocations satisfies InvocationChannel;

// A consumer's listener sees the record and the live handles typed.
observe.server.invocations.subscribe("invocation", (event, live) => {
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

// The subscription type is closed: the channel carries invocations only
// (boundary/frame records join it in later work, by name).
// @ts-expect-error no such record type on the channel yet
observe.server.invocations.subscribe("boundary", () => {});

// The unsubscribe is a plain thunk.
const off: () => void = observe.server.invocations.subscribe("invocation", () => {});
off();

// The trace-provider slot (trace.ts) augments the same interface, from a
// second module: both merges land.
observe.server.trace satisfies TraceSlot;
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
