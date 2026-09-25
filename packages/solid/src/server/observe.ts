// `OBSERVE.server` — the object behind the server runtime's observe surface
// — and the `"boundary"` record this runtime delivers on `OBSERVE.records`.
//
// The records channel itself is the core's (`OBSERVE.records`, one for both
// platforms, process-wide): this entry EMITS into it — the `"boundary"`
// record below, from `ssrLoadingBoundary` — and DECLARES the record onto
// the core's `RecordTypes` by augmentation, so a consumer's `subscribe(
// "boundary", …)` is typed. `@solidjs/web` declares its records the same
// way, onto `HostRecordTypes` through `"solid-js"` (one augmenter per
// interface: see `RecordTypes` in the core for why).
//
// What only the server has — the trace-context provider slot — lives on
// `OBSERVE.server`, whose OBJECT is created HERE, once per PROCESS, under a
// registered symbol on `globalThis` — not by the core (one artifact per tier
// for both platforms; the client would pay for it) and not by web (see
// below). Two things fixed the placement (Sentry spike, SHAPE-NOTES
// J.23/J.24):
//
// - Order. Web's server entry is what asks the trace provider, but an
//   observer's `init()` runs before any request and imports only
//   `solid-js`; while web's module init created the slot,
//   `OBSERVE.server.trace` was `undefined` until something happened to import
//   web first (J.23). This module is part of `solid-js`'s server entry, so the
//   slot exists the moment `solid-js` is importable on the server.
// - Copies. A host that bundles the runtime into its server build (`link:`ed
//   packages, `noExternal`, workers) and instruments through a `--import`ed
//   module holds two `solid-js` instances; a per-instance `OBSERVE.server`
//   made the provider installed on one invisible to the render running on the
//   other (J.24). The registered key makes every copy find the same provider,
//   the way the web runtime's own bundles already share state.
//
// The container is deliberately generic — a single replaceable provider —
// and carries no knowledge of what a provider is; web reads it through the
// same registered symbol (the key string below is that contract — it
// re-creates it with `Symbol.for`, it does not import from here) and types
// it by augmenting `ServerTrace`, declared at the end of this module.
//
// The types here are re-exported by the CLIENT entry too (`solid-js`'s
// published types resolve to it under every condition), so an observer that
// imports only `solid-js` types its listener — which is why this module
// imports nothing of the server runtime.
import type { ServerObserve } from "@solidjs/signals";
import type { RecoveryEvent, RecoveryLive } from "../recovery.js";

const SERVER_SLOTS = Symbol.for("solid-js/observe/server");
const SERVER_PROVIDER = Symbol.for("solid-js/observe/server/provider");

/** The process-wide slots, created on first call from any copy of `solid-js`. */
export function serverSlots(): ServerObserve {
  const g = globalThis as { [SERVER_SLOTS]?: ServerObserve };
  if (g[SERVER_SLOTS]) return g[SERVER_SLOTS];
  const trace: { [SERVER_PROVIDER]?: Function; provide(p: Function): () => void } = {
    provide(provider) {
      trace[SERVER_PROVIDER] = provider;
      return () => {
        if (trace[SERVER_PROVIDER] === provider) trace[SERVER_PROVIDER] = undefined;
      };
    }
  };
  return (g[SERVER_SLOTS] = { trace } as unknown as ServerObserve);
}

/**
 * One `<Loading>` boundary that WAITED during a server render — discovered
 * with pending async, then settled — delivered on
 * `OBSERVE.records.subscribe("boundary", …)` once it settled and, when a
 * `<Reveal>` group held its swap, once it was revealed. A boundary whose
 * content rendered on its first pass emits nothing: there was no wait to
 * attribute, the same rule as the client's `hold` records.
 */
export interface BoundaryEvent {
  /**
   * The boundary's hydration id — the id `SSR_RENDER_ERROR_CONTAINED` names
   * in `data.boundary`, and the `<template id="pl-…">` placeholder's.
   */
  id: string;
  /** `performance.now()` at discovery: the first render pass began. */
  at: number;
  /**
   * Discovery → settle, in milliseconds: from the first render pass to the
   * content being complete (`"settled"`), or to the decision that the
   * server will not produce it (the other outcomes).
   */
  durationMs: number;
  /**
   * Settle → reveal: how long a `<Reveal>` group held the finished content
   * back for its siblings (`order="together"`, a sequential tail). `0` when
   * the swap was issued as the boundary settled, including every boundary
   * outside a group.
   */
  heldMs: number;
  /**
   * Render passes over the boundary's content: the discovery pass plus one
   * per wait. `2` is one round of async; a higher count is a sequential
   * chain — a read that depended on the answer to the previous one.
   */
  passes: number;
  /**
   * `"settled"` — the content rendered on the server and swapped in.
   * `"fallback"` — the renderer had no stream to settle into
   * (`renderToString`, or a collapsed slot under it): the fallback shipped
   * final and the client renders the content. `"client"` — the content is
   * client-only (`ssrSource: "client"`): the client renders it after
   * hydration. `"error"` — the content threw; `live.error` is the value as
   * thrown, and the paired `SSR_RENDER_ERROR_CONTAINED` finding says where
   * it went.
   */
  outcome: "settled" | "fallback" | "client" | "error";
  /**
   * `true` when the outcome reached the client after the shell had flushed
   * — the user saw the fallback, then the swap. `false` when the boundary
   * settled in time to inline into the shell (or never streamed at all).
   */
  streamed: boolean;
  /** The `<Reveal>` group coordinating this boundary's swap, if any. */
  revealGroup?: string;
  /** Root-first component labels enclosing the boundary, as on diagnostics. */
  ownerPath?: string[];
}

/** The live half of a boundary record. */
export interface BoundaryLive {
  /** The thrown value, when `outcome` is `"error"`. */
  error?: unknown;
}

export type BoundaryListener = (event: BoundaryEvent, live: BoundaryLive) => void;

/**
 * The trace-provider slot — `OBSERVE.server.trace`. The CONTAINER is this
 * runtime's (a single replaceable provider, see `serverSlots`); what a
 * provider is — its argument, its answer — is the web runtime's, which
 * augments this interface with `provide` (`trace.ts` in `@solidjs/web`).
 * Declared empty here so that runtime has one place to type it.
 */
export interface ServerTrace {}

// This runtime's record, onto the core's catalogue; and the server surface's
// member, onto the core's empty `ServerObserve`. These are the ONE
// augmentation of each; web augments `HostRecordTypes` and `ServerTrace`,
// through `"solid-js"`.
declare module "@solidjs/signals" {
  interface RecordTypes {
    /** `<Loading>` boundaries that waited during a server render — see `BoundaryEvent`. */
    boundary: { event: BoundaryEvent; live: BoundaryLive };
    /** The client rendering a boundary the server handed over — see `RecoveryEvent`. */
    recovery: { event: RecoveryEvent; live: RecoveryLive };
  }
  interface ServerObserve {
    /** The trace-context provider slot — see `ServerTrace`. */
    trace: ServerTrace;
  }
}
