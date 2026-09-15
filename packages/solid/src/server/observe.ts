// `OBSERVE.server` — the objects behind the server runtime's observe surface.
//
// The core declares `ServerObserve` (with the `records` channel, typed empty)
// and ships `server: {}`; the runtimes that emit type the members —
// `solid-js` (this entry) the `"boundary"` record below, `@solidjs/web`'s
// server entries the `"invocation"` record and the trace-provider slot — and
// emit into them. The OBJECTS are created HERE, once per PROCESS, under
// registered symbols on `globalThis` — not by the core (one artifact per tier
// for both platforms; the client would pay for them) and not by web (see
// below). Two things fixed the placement (Sentry spike, SHAPE-NOTES
// J.23/J.24):
//
// - Order. Web's server entry is what emits invocations and asks the trace
//   provider, but an observer's `init()` runs before any request and imports
//   only `solid-js`; while web's module init created the slots,
//   `OBSERVE.server.trace` was `undefined` until something happened to import
//   web first (J.23). This module is part of `solid-js`'s server entry, so the
//   slots exist the moment `solid-js` is importable on the server.
// - Copies. A host that bundles the runtime into its server build (`link:`ed
//   packages, `noExternal`, workers) and instruments through a `--import`ed
//   module holds two `solid-js` instances; a per-instance `OBSERVE.server`
//   made the provider installed on one invisible to the render running on the
//   other (J.24). The registered key makes every copy find the same listener
//   set and provider, the way the web runtime's own bundles already share
//   state.
//
// The containers are deliberately generic — a listener set keyed by record
// type and a single replaceable provider — and carry no knowledge of the
// records or the provider; web reads them through the same registered
// symbols (the two key strings below are that contract — it re-creates them
// with `Symbol.for`, it does not import from here) and types what it emits
// by augmenting the interfaces declared at the end of this module.
//
// The types here are re-exported by the CLIENT entry too (`solid-js`'s
// published types resolve to it under every condition), so an observer that
// imports only `solid-js` types its listener — which is why this module
// imports nothing of the server runtime.
import type { ServerObserve } from "@solidjs/signals";

const SERVER_SLOTS = Symbol.for("solid-js/observe/server");
const SERVER_LISTENERS = Symbol.for("solid-js/observe/server/listeners");
const SERVER_PROVIDER = Symbol.for("solid-js/observe/server/provider");

type ListenerSets = Map<string, Set<Function>>;

/** The process-wide slots, created on first call from any copy of `solid-js`. */
export function serverSlots(): ServerObserve {
  const g = globalThis as { [SERVER_SLOTS]?: ServerObserve };
  if (g[SERVER_SLOTS]) return g[SERVER_SLOTS];
  const listeners: ListenerSets = new Map();
  const trace: { [SERVER_PROVIDER]?: Function; provide(p: Function): () => void } = {
    provide(provider) {
      trace[SERVER_PROVIDER] = provider;
      return () => {
        if (trace[SERVER_PROVIDER] === provider) trace[SERVER_PROVIDER] = undefined;
      };
    }
  };
  return (g[SERVER_SLOTS] = {
    records: {
      [SERVER_LISTENERS]: listeners,
      subscribe(type: string, listener: Function) {
        let set = listeners.get(type);
        if (!set) listeners.set(type, (set = new Set()));
        set.add(listener);
        return () => {
          set!.delete(listener);
        };
      }
    },
    trace
  } as unknown as ServerObserve);
}

/**
 * The listeners for one record type, or `undefined` when there are none —
 * an emitter's cheap pre-check before it builds a record. Reads the shared
 * slot (any copy's), never module state.
 */
export function recordListeners(type: string): Set<Function> | undefined {
  const slots = serverSlots() as unknown as { records: { [SERVER_LISTENERS]: ListenerSets } };
  const set = slots.records[SERVER_LISTENERS].get(type);
  return set !== undefined && set.size > 0 ? set : undefined;
}

/**
 * Delivers a completed record to its listeners, synchronously. Snapshot
 * iteration: a listener unsubscribing (itself or another) mid-delivery
 * neither skips nor double-calls anyone this round. A throwing listener is
 * reported and the rest run — an observer can't break the render.
 */
export function deliverRecord(listeners: Set<Function>, record: unknown, live: unknown): void {
  for (const listener of [...listeners]) {
    try {
      listener(record, live);
    } catch (error) {
      console.error(error);
    }
  }
}

/**
 * Root-first component labels enclosing `owner` — the `ownerPath` a record
 * carries, the same walk (`_parent` + `_name`) the core's diagnostics make
 * over these owners, so a boundary record and the finding it may pair with
 * locate to the same `<App> › <Page>`.
 */
export function ownerLabels(owner: { _parent: any; _name?: string } | null): string[] | undefined {
  const path: string[] = [];
  for (let o = owner; o !== null; o = o._parent) {
    const name = o._name;
    if (typeof name === "string" && name.length) path.push(name);
  }
  return path.length ? path.reverse() : undefined;
}

/**
 * One `<Loading>` boundary that WAITED during a server render — discovered
 * with pending async, then settled — delivered on
 * `OBSERVE.server.records.subscribe("boundary", …)` once it settled and,
 * when a `<Reveal>` group held its swap, once it was revealed. A boundary
 * whose content rendered on its first pass emits nothing: there was no wait
 * to attribute, the same rule as the client's `hold` records.
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
 * The server records channel — `OBSERVE.server.records.subscribe(type,
 * listener)`, the server twin of `OBSERVE.attribution.subscribe(type, …)`.
 * A record is a completed, serializable summary of one thing the server
 * did — a `<Loading>` boundary, a server-function execution — delivered
 * synchronously the moment it is complete, with the live handles an
 * in-process consumer may want (the thrown error, the request event)
 * passed BESIDE it rather than on it. Any number of listeners; none can
 * alter what it observes; one that throws is reported and the rest run.
 *
 * Declared here with the record this runtime emits; the runtimes above add
 * theirs by augmentation through `"solid-js"` — `@solidjs/web`'s server
 * entries the `"invocation"` record — so the union of record types is
 * whatever the loaded runtimes declared. (One augmenter per interface, one
 * module name: see `ServerObserve` in the core for why.)
 */
export interface ServerRecords {
  /** `<Loading>` boundaries that waited during a server render — see `BoundaryEvent`. */
  subscribe(type: "boundary", listener: BoundaryListener): () => void;
}

/**
 * The trace-provider slot — `OBSERVE.server.trace`. The CONTAINER is this
 * runtime's (a single replaceable provider, see `serverSlots`); what a
 * provider is — its argument, its answer — is the web runtime's, which
 * augments this interface with `provide` (`TraceSlot` in `@solidjs/web`).
 * Declared empty here so that runtime has one place to type it.
 */
export interface ServerTrace {}

// The server surface's members, onto the core's empty `ServerObserve`. This
// is the ONE augmentation of that interface; web augments the two members'
// interfaces above, through `"solid-js"`.
declare module "@solidjs/signals" {
  interface ServerObserve {
    /** Completed server records by type — see `ServerRecords`. */
    records: ServerRecords;
    /** The trace-context provider slot — see `ServerTrace`. */
    trace: ServerTrace;
  }
}
