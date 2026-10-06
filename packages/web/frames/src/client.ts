// @solidjs/web/frames — client half. Consume frame streams into live DOM
// boundaries (resident store, policy-A morphs, client-owned slot ranges).
//
// EXPERIMENTAL — the frames/server-components surface ships as an
// experimental preview, excluded from the 2.0 stability guarantee: API
// shapes and the wire format may change between prereleases (RFC 11).
// Every export in this entry is @experimental.
//
// There is deliberately no server-component API in this module: calling
// installServerComponents() once in the client entry installs the transport
// policy that makes `dynamic` + server functions the whole client surface.
// A server-function call whose response is a frame
// stream resolves with a stable component — the same reference for every
// refetch from the same call site — so `dynamic(() => getStory(id()))`
// never remounts; the response streams into the boundary underneath and
// server content morphs in place while client-owned slot ranges and their
// state survive (policy A).

import {
  createMemo,
  createOwner,
  createRenderEffect,
  createSignal,
  DEV,
  getOwner,
  OBSERVE,
  onCleanup,
  runWithOwner,
  untrack
} from "solid-js";
import type { Element as SolidElement } from "solid-js";
// `insert` MUST resolve to the shared @solidjs/web instance the compiled app
// already uses — importing it from the runtime source instead bundles a second
// copy of `insert` and the reconcile/render machinery it drags in (~4kb the app
// already has). Kept external in rollup.config.js for the same reason the
// server-functions/client import below is.
import { insert, assign } from "@solidjs/web";
import { createFrame, createFrameElement, createFrameHost, FRAME_ID_ATTR } from "./frame-client.js";
import {
  COMPONENT_BINDING,
  callFor,
  contentAddress,
  createServerComponentHandler,
  stagedContent,
  type ServerComponentHandlerOptions
} from "./frame-transport.js";
// The container tier (DR-2 case 3): server projections cross the border as
// TRACES (snapshot + patch batches) and materialize back into live local
// projections. The materializer is solid's (it owns the patch protocol);
// this entry installs it and wires the host's literal-arg reviver (document
// face). The seroval plugin itself needs no wiring — it rides the codec's
// default plugin set, in the lazy codec chunk. These named imports pull
// only the eager core (hooks + revive walk + the WeakSet probe); the
// plugin object tree-shakes away.
import {
  isMaterializedContainer,
  reviveContainerTraces,
  setContainerTraceMaterializer
} from "./frame-container-plugin.js";
import { createLoadingBoundary, materializeContainerTrace, sharedConfig } from "solid-js/internal";

setContainerTraceMaterializer(materializeContainerTrace);

// Build-time literal (see diagnostics.ts): dev-only guidance folds out of prod.
const IS_DEV = "_SOLID_DEV_" as unknown as boolean;
// This import must resolve to the SHARED built instance, not a bundled
// copy: configuring the server-function client only counts if it's the same
// module the compiled reference proxies call through
// (`@solidjs/web/server-functions` resolves to this file in the browser).
// A private copy breaks instance identity — and, because this entry never
// calls that copy's readers, rollup would tree-shake the whole
// `configureServerFunctionsClient` call out of the dist as unobservable.
// Kept external in rollup.config.js — and the transport's own wire-layer
// imports are resolved to the same external entry there
// (externalizeSharedTransport), so the codec/flight config its defaults
// read is this instance by construction.
import { configureServerFunctionsClient } from "@solidjs/web/server-functions/client";
// The server-function registry's two seams, read through their registered
// symbols rather than imported (the pattern the frame runtime uses for
// every cross-bundle brand — `CLAIM_SEAM`, `COMPONENT_BINDING`): the
// late-bound RPC slot (registry.ts `provideServerFunctionRPC` — filled by
// the time any server function has been referenced, so by the time a
// response could have erred) and the declaration-metadata brand. Importing
// either from an entry would retain a registry copy in whichever bundle
// does not already carry one.
const SERVER_FUNCTION_RPC = Symbol.for("solid.ServerFunctionRPC");
const SERVER_FUNCTION_METADATA = Symbol.for("solid.ServerFunctionMetadata");
// The seroval codec is the frames client's heaviest dependency (~6 kB gz
// with the web plugin set) and the common frames traffic never needs it:
// HTML chunks, scalar slot args and document records (the hydration
// script's payloads are self-executing) all decode codec-free. So the
// serialization entry loads LAZILY, through the host's `prepareData` hook —
// the transport awaits the import before delivering the first `data` chunk
// of a response, and the sequential chunk loop queues every later chunk
// (the records referencing that data included) behind the load.

export {
  createFrame,
  createFrameHost,
  createFrameElement,
  FRAME_APPLIED_EVENT
} from "./frame-client.js";
export {
  FRAME_STREAM_HEADER,
  FRAME_HAVE_HEADER,
  FRAME_HAVE_BUDGET,
  applyFrameResponse,
  isFrameStreamResponse,
  createServerComponentHandler
} from "./frame-transport.js";
// `createJSONDataTable` is NOT re-exported here: its single public home is
// `@solidjs/web/serialization` (this entry consumes it internally for its
// per-response tables).
// Server components are authored in universal code, so the slot type has to
// resolve under the browser condition too. Type-only, so nothing crosses into
// the client bundle.
export type { Slot, BindingSlot, SlotOutput, SlotError } from "./server.js";

/**
 * Client-condition twin of the server face's `asyncArg` (DR-2 value tier):
 * the identity that types an async value crossing the slot border as its
 * settled value. Server component modules are authored in universal code and
 * may resolve under the browser condition at typecheck/bundle time — the
 * call never runs here (the `"use server"` body executes server-side), but
 * the symbol must exist.
 */
export function asyncArg<T>(value: PromiseLike<T> | AsyncIterable<T>): T {
  return value as T;
}

// One host per app is the norm: one chunk router, with codec data tables
// kept PER RESPONSE — the deserializer's cross-reference space is
// stream-scoped by contract, so each stream into a boundary gets a fresh
// table. A response is one version of one root frame id (the transport
// stamps every chunk of it), so tables are keyed by the id and the
// version: a chunk or a record of a response reads and writes its own
// response's table and no other's (frames-rulings 1.2, 1.3) — the shown
// response's and a staged refetch's coexist, each its own — and a version
// the address has moved past (`current`, the host's store version) has no
// reader left, so its table is dropped at the next use. Data and slot
// chunks both carry the ROOT id (a nested region's records live on the
// root sink), so no prefix routing is needed. Apps needing isolation pass
// their own host.
//
// Tables materialize lazily, at first use once the codec module is
// resident — `prepareData` guarantees that before any `data` chunk
// delivers. A `resolve` ahead of the codec (a record's `$ref` sighted
// before its data) answers undefined — "not delivered" — and the host hands
// the fill a pending read the data chunk settles (see `createFrameHost`).
let sharedHost: any;
let codec: any;
let codecLoading: Promise<unknown> | undefined;
function loadCodec() {
  // The decode-only entry: the data tables never encode, and the full
  // serialization module costs the encoder too (~13 vs ~6.5 kB gz).
  return (codecLoading ??= import("@solidjs/web/serialization/decode").then(m => {
    codec = m;
  }));
}
const tables = new Map<string, Map<number, any>>();
function tableFor(id: string, version: number, current: number | undefined) {
  let byVersion = tables.get(id);
  if (!byVersion) tables.set(id, (byVersion = new Map()));
  else for (const v of byVersion.keys()) if (v < current!) byVersion.delete(v);
  let t = byVersion.get(version);
  if (!t && codec) byVersion.set(version, (t = codec.createJSONDataTable()));
  return t;
}
/**
 * The render effect that follows a mount's address accessor. `dynamic`
 * writes the accessor from the resolution that lands the call, so the
 * write is held by the transaction that read the call and both halves of
 * this effect run as its work: the compute half in the pass that sees the
 * value, the effect half at the commit, with everything else it holds.
 *
 * The compute half is plumbing: a content TOKEN (a refetch of the address
 * shown, see createServerComponentHandler) has its slot args previewed into
 * the live fills (`stagedContent.preview`) — staged with the transaction,
 * so a fill deriving optimistic intent over an arg re-derives from the new
 * arg in the pass that dissolves the intent, never from the old one a
 * flush behind it (principles §9.2.2, `frames-optimistic-hold`). This is
 * the one write the token carries that the landing node (`landing` below)
 * does not: the landing is per address and reads warm for a refetch; the
 * fills' args are the record's, and the record is the token's.
 *
 * The effect half is display. It commits the token's content
 * (`stagedContent.commit`: the markup, the store, the mounts) and re-binds
 * the frame to the address — a warm store re-materializes at once; the same
 * address under a new version is not a switch and `rebind` no-ops. Both
 * wait for the commit so the region's answer never lands beside siblings
 * the transaction still holds (`frames-morph-in-transition`, C15).
 *
 * Ruling (maintainer, 2026-10-04, #3759 on L2): the switch IS display —
 * one reveal. The rebind morphs the DOM, so it runs in the effect half at
 * the commit. What keeps the boundary pending across a switch is not this
 * effect's business: the mount reads the address as a source (`landing`
 * below), and a switch is a new question on it.
 */
function followAddress(host: any, frame: { rebind(address: string): void }, binding: () => string) {
  createRenderEffect(
    () => {
      const token = binding();
      stagedContent.preview(token);
      return token;
    },
    token => {
      stagedContent.commit(token);
      frame.rebind(contentAddress(token));
    }
  );
}

/**
 * The frame as one async value outward (A0, corollary 4): to its
 * surroundings a mount is one async source whose first landing is the
 * bound address's first flush, whose error is that value REJECTING, and
 * whose inside is the server's. The enclosing `<Loading>` pends on that
 * landing exactly as it pends on any async source's first landing
 * (`host.landing`: a promise while the response is in flight), and on
 * nothing inside the frame — a server-rendered `<Loading>` fallback in the
 * shell IS content. The enclosing `<Errored>` sees the frame's `:error`
 * exactly as it sees any `createAsync` that rejects (frames-rulings 3.3):
 * the landing promise rejects with the error record and this node throws
 * it; an error AFTER the landing — a later yield failing, a stream cut
 * off, a refetch's response erroring — is the L2 "errored flight after a
 * landing" case and errors the node the same way (what an async iterable
 * that yielded and then threw does: the shown value is not kept beside the
 * error). The error is announced to this node by the mount's frame
 * (`failed`, a tick written from its `onApply`); the node reads the record
 * off the frame bound to the address and surfaces each record once — the
 * applied state of 2.1, keyed by record identity, so a re-read of an error
 * this node already surfaced is not a re-throw but a RE-ASK.
 *
 * `reset` re-asks: the `<Errored>`'s `reset` recomputes the node that
 * threw — this one — and an errored landing is not a landing for a fresh
 * consumer: the re-read is a promise for the NEXT flight (`host.landing`),
 * and the flight is opened here (`reask`: the call behind the address,
 * re-invoked — `dynamic`'s factory is hoisted and never re-runs for a
 * `reset`, so the mount asks for itself). A re-ask whose call fails on the
 * wire (no response to land) rejects the node with that failure.
 *
 * Per bound address (frames-rulings 1.5, 1.6 (i)): a switch is a new
 * question on the source, read here through a FRESH node with no value, so
 * an unrevealed boundary stays on its fallback and a revealed one holds what
 * it shows until the new address lands (#2977: the binding resolves at
 * response-header time, which is not an answer); the superseded address's
 * late writes answer only their own question and release nothing — the
 * frame may still be bound there (the rebind runs at the commit the
 * boundary is holding) and may even morph them into its element; nothing
 * shows. Warm — the store shows a landing, or nothing is in flight to
 * produce one (a placeholder mount with no call out, the exhausted
 * late-boundary waiter, a client-only boot) — reads synchronously as
 * `value`: no pending beat, no fallback flicker, and a hydrating consumer
 * never sees the node go async.
 */
function landing<T>(host: any, address: string, value: T, failed: () => unknown): () => T {
  // What the address's store holds at creation is applied: a fresh
  // consumer of an errored address re-asks, it does not re-throw.
  let thrown = host.get(address)?.error;
  return createMemo(() => {
    failed();
    const error = host.get(address)?.error;
    if (error !== undefined && error !== thrown) {
      thrown = error;
      throw error;
    }
    const wait = host.landing(address);
    if (!wait) return value;
    // An errored address with no flight open (a flight's `start` clears
    // the mounts' error): this read is the re-ask.
    const asked = error !== undefined && reask ? reask(address) : undefined;
    return (asked ? asked.then(() => wait) : wait).then(() => value);
  });
}

// The re-ask (see `landing`): installed with the handler, it re-invokes the
// call behind an address and resolves when the call's response has been
// handled (the flight is open and will land through the host). Undefined
// until `installServerComponents` ran.
let reask: ((address: string) => Promise<unknown> | undefined) | undefined;

/**
 * A mount's error tick for `landing`: the read, and the frame `onApply`
 * that writes it once per error record the frame applies. `ownedWrite`:
 * the first apply may run inside the mount's own render (a warm store
 * seeds at registration), the rest from chunk microtasks and commits.
 */
function failing(): [() => number, (info: { reason: string }) => void] {
  const [failed, setFailed] = createSignal(0, { ownedWrite: true });
  return [failed, info => info.reason === "error" && setFailed(n => n + 1)];
}
/**
 * The app-wide shared frame host (created lazily): one chunk router with
 * per-response codec data tables.
 * @experimental
 */
export function getFrameHost() {
  if (!sharedHost) {
    sharedHost = createFrameHost({
      prepareData: loadCodec,
      applyData: (c: any, current?: number) => tableFor(c.id, c.version, current)?.apply(c),
      resolve: (ref: any, id: string, version: number, current?: number) =>
        tableFor(id, version, current)?.resolve(ref),
      // Document-face container traces ride slot records as inline literals
      // (never `{$ref}`s); this revives them into live stores at arg-read.
      revive: reviveContainerTraces
    });
  }
  return sharedHost;
}

/** Resolve Solid JSX slot content (thunks, arrays, primitives) to nodes. */
function normalizeSlotContent(value: any): Node | Node[] {
  while (typeof value === "function") value = value();
  if (Array.isArray(value)) {
    const out: Node[] = [];
    for (const v of value) {
      const n = normalizeSlotContent(v);
      Array.isArray(n) ? out.push(...n) : out.push(n);
    }
    return out;
  }
  if (value == null || typeof value === "boolean") return document.createTextNode("");
  return value instanceof Node ? value : document.createTextNode(String(value));
}

/**
 * The stable component minted once per boundary. Every mount creates its own
 * frame instance under the boundary id (mounting the same server component
 * twice fans the stream out to both), props are the slot ranges — a function
 * prop answers the server's render-prop slots with its args; any other prop
 * (JSX children included) fills its direct-insert position — and each
 * instance disposes with its owning scope.
 */
/**
 * The registry/gather pair a boundary adopts under — read at adoption, so
 * its occurrences' claims (which may run long after, under the frame's hold
 * or at a fragment's reveal) gather against the root that holds the frame
 * and not whichever `hydrate()` root replaced the live pair since (#2917).
 */
type ClaimScope = { registry?: Map<string, object>; gather?: (key: string) => void };

/**
 * Hydration re-entry for one adopted slot range: the fill renders inside a
 * claim window — `sharedConfig.hydrateWindow`, the same window a streamed
 * boundary's resume opens — under an owner whose id chain reproduces the
 * document producer's keys (`sc-<fid>-<occurrence>-`). The window gathers
 * the range's keys by that prefix, so the fill's components take the
 * server-rendered nodes by key; the range is declared as the window's claim
 * roots because it may be DETACHED right now (an async slot fill renders
 * before its boundary re-inserts it) and the runtime's hydration guards
 * read connectivity to tell claimed SSR nodes from fresh clones. A fill
 * whose range has no keyed node claims nothing and renders as it would
 * have; a `<Loading>` fallback in it still renders under the producer's
 * chain, finds its pending `<key>_fr` registration, and resumes into the
 * swapped content instead of re-rendering over a fragment nobody owns.
 * Plain render on a page that never hydrated (CSR boot, post-load streams).
 */
function claimRender(prefix: string, existing: Node[], render: () => any, scope?: ClaimScope) {
  const sc: any = sharedConfig;
  // No window, or no registry gathered yet (no `hydrate()` pass has run):
  // nothing to claim against — render fresh over the markup.
  if (!sc.hydrateWindow || !sc.registry) return render();
  const prevRoots = sc.claimRoots;
  sc.claimRoots = existing;
  try {
    // The claim owner too: the window claims this fill's subtree only.
    return runWithOwner(createOwner({ id: prefix }), () => sc.hydrateWindow(prefix, render, scope));
  } finally {
    sc.claimRoots = prevRoots;
  }
}

/**
 * Live props for an invoked render prop: a signal-backed proxy the frame
 * pushes re-resolved args into when a re-sent record's args CHANGE
 * (ctx.onUpdate) — instead of re-calling the occurrence. Prop reads are
 * reactive getters over the latest record, so the component instance (and
 * its client state) survives server morphs that change its args, and
 * effects over e.g. `props.title` fire on the change — the same "new props
 * into the same instance" semantic compiled components already have.
 */
function liveSlotProps(initial: Record<string, any>, ctx: any) {
  // `ownedWrite`: the record's writes arrive from wherever the frame flushes
  // — a chunk microtask, the commit of the transaction that delivered a
  // refetch (see followAddress), the document's reveal cascade — none of
  // them a read of this occurrence's.
  const [args, setArgs] = createSignal(initial, { ownedWrite: true });
  ctx.onUpdate((next: Record<string, any>) => setArgs(() => next));
  return slotArgsProxy(args);
}

/**
 * Whether a slot arg value is an async value passed whole (a promise or an
 * async iterable) — DR-2's value tier. The server never resolves these to
 * dead values; the client suspends at the consumption read.
 */
function isAsyncValue(v: any): boolean {
  return (
    v !== null &&
    typeof v === "object" &&
    (typeof v.then === "function" || typeof v[Symbol.asyncIterator] === "function")
  );
}

/**
 * Whether two values of one slot arg are the same value — the per-prop
 * memo's equality, and so the whole dedupe of a re-sent record (a record
 * whose refs decode to equal values churns no reader; one with a changed
 * arg moves exactly that arg's readers). Identity first; then structural
 * for the plain data the codec decodes (every prop of a record is a fresh
 * decode, so two equal records are never `===`). A live container (DR-2's
 * container tier) compares by identity ONLY — its reads carry the async
 * semantics and a pending one throws not-ready on any property probe, so
 * the container test comes before the async probe — and so does an async
 * value (two pending promises stringify alike and are different values)
 * and a DOM node (a region element; the frame caches those per arg, so an
 * unchanged one IS identical).
 */
function sameArg(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (a instanceof Boxed || b instanceof Boxed)
    return a instanceof Boxed && b instanceof Boxed && a.c === b.c;
  if (isAsyncValue(a) || isAsyncValue(b) || a instanceof Node || b instanceof Node) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * A live container as a prop memo's value. The core probes a memo's result
 * for `.then`, and a pending container's property trap answers any read
 * with not-ready — so the memo holds the container boxed (identity is its
 * equality) and the prop read unboxes it.
 */
class Boxed {
  constructor(public c: unknown) {}
}

/**
 * The props object handed to a render-prop occurrence. Every prop reads
 * through a lazily-created memo over the record's value for it, so a read
 * is reactive over `args` (a re-sent record updates the live occurrence)
 * and deduped by the memo's equality (`sameArg`: an equal value, however
 * it was decoded, moves nothing — the dedupe a frame-side compare used to
 * do, now where a memo already does it). An async value makes the memo an
 * async one, so the prop read follows the normal async read path — it
 * suspends into the reading component's nearest `Loading` (the reveal
 * seam's reconstructed boundary when the fill has none of its own) and
 * settles to the value when the server's data chunk lands. Memos are
 * created under the occurrence's owner (not the reader's), so they live as
 * long as the occurrence: a read from a later effect or event handler
 * reuses the same source.
 */
function slotArgsProxy(args: () => Record<string, any>) {
  const owner = getOwner();
  const reads = new Map<PropertyKey, () => any>();
  return new Proxy(
    {},
    {
      get: (_, key) => {
        let read = reads.get(key);
        if (!read) {
          // TRANSPARENT: an adopted fill invokes during the hydrate window
          // under the occurrence's claim owner, and a plain memo minted
          // there consumes a hydration-key child slot the document producer
          // never allocated (its twin — `ssrAsyncValue` in
          // createDocumentSlotProps — wraps args OUTSIDE the keyed zone).
          // One stray slot shifts every subsequent key in the occurrence
          // namespace: the fill's `<Loading>` ids stop matching their `_fr`
          // records, settled branches read as pending, and the registry
          // misses every claim after the read (the chat welcome/status
          // hydration miss). Transparent shares the parent id — no slot
          // consumed, no serialized-record adoption for a memo whose value
          // comes from the revived args, not the page.
          //
          // STAMP FAST-ADOPT: a record-revived promise that already settled
          // carries the hydration serializer's stamp (`s`/`v` — the same
          // marks readHydratedValue adopts). The signals core treats every
          // thenable as pending-now/ready-next-microtask, but hydration's
          // claim walk is synchronous: without the sync adopt the fill
          // renders its fallback branch over a page whose markup settled
          // before flush — branch mismatch, key misses, dead range.
          //
          // Containers first (DR-2's container tier): the store IS the live
          // value — its own reads carry the async semantics — and the
          // `.then` probe would detonate a pending one (property reads
          // throw not-ready), so it is classified before the probe and
          // held BOXED (see `Boxed`). Mirrors the server sink's
          // classification order.
          const make = () =>
            createMemo(
              () => {
                const raw = (args() as any)[key];
                if (isMaterializedContainer(raw)) return new Boxed(raw);
                if (raw != null && typeof raw.then === "function") {
                  if (raw.s === 1) return raw.v;
                  if (raw.s === 2) throw raw.v;
                }
                return raw;
              },
              { transparent: true, equals: sameArg } as any
            );
          read = owner ? runWithOwner(owner, make)! : make();
          reads.set(key, read);
        }
        const v = read();
        return v instanceof Boxed ? v.c : v;
      },
      has: (_, key) => key in args(),
      ownKeys: () => Reflect.ownKeys(args()),
      getOwnPropertyDescriptor: (_, key) =>
        key in args() ? { enumerable: true, configurable: true } : undefined
    }
  );
}

interface ElementState {
  /** `assign`'s diff state: the props last written to the element. */
  prev: Record<string, any>;
  /** Bound handler props (`onclick`): the key and the value read at bind. */
  handlers: Record<string, { key: string; value: any }>;
  /** The ref dispatcher for the element's current ref keys, and those keys. */
  ref: ((el: Element) => void) | undefined;
  refId: string;
}

/**
 * The occurrence holding each handler prop of an element. A rebind can hand
 * an element from one occurrence to another (a positional id now names
 * another row's data), and a delegated handler is one slot on the element:
 * the outgoing occurrence's release must not clear what the incoming one set.
 */
const handlerOwners = new WeakMap<Element, Record<string, object>>();

/**
 * Bind a binding-slot occurrence (principles §9.2.3). The fill runs ONCE,
 * untracked, under the occurrence's owner — a component body: a top-level
 * read is a one-time read (dev names it through `untrack`'s label), and state
 * created in the body lives as long as the occurrence. Its object's value
 * positions are written by one render effect over every consuming element,
 * diffed per position by `assign`, so a getter's change re-reads the
 * occurrence and touches only what moved. Handlers and refs are read once
 * when an element binds and handed to `assign`, which binds them as client
 * JSX does (delegation, tuples). A consumer change (`ctx.onRebind`: the morph
 * replaced an element, a response bound a new position) rebinds without
 * re-running the fill.
 */
function bindDataOccurrence(
  fill: (args: any) => any,
  args: any,
  ctx: any,
  label: string | undefined
) {
  const [consumers, setConsumers] = createSignal<any[]>(ctx.positions);
  ctx.onRebind(setConsumers);
  const raw = untrack(() => fill(args), label);
  // Content where data was expected: a DOM node is an object, so it is
  // named here rather than read as one (its properties are the DOM's); an
  // async value has no properties to bind until it settles.
  const node = typeof Node === "function" && raw instanceof Node;
  const pending = isAsyncValue(raw);
  if (IS_DEV && (raw == null || typeof raw !== "object" || Array.isArray(raw) || node || pending)) {
    const shape = shapeOf(raw);
    slotShapeFinding(
      { reason: "fill-shape", occurrence: ctx.key, shape },
      `[BINDING_SLOT_POSITION] The fill for \`${ctx.key}\` returned ${shape}; server markup reads ` +
        `its properties at bound positions, so it must return an object (\`{ done, onToggle, … }\`). ` +
        `Nothing binds.`
    );
  }
  const out = raw == null || typeof raw !== "object" || node || pending ? {} : raw;
  const token = {};
  const state = new WeakMap<Element, ElementState>();
  // The elements written last time: one that drops out of the consumer
  // list on a rebind (its markers gone, the element kept by the morph) is
  // released so its handlers unbind.
  let bound = new Set<Element>();
  createRenderEffect(
    () => consumers().map(valuesFor),
    writes => {
      const next = new Set<Element>();
      for (const { element, positions, values, texts } of writes) {
        next.add(element);
        write(element, positions, values);
        for (const [start, v, key] of texts) writeText(start, v, key);
      }
      for (const element of bound) if (!next.has(element)) release(element);
      bound = next;
    }
  );
  // The occurrence's end (a later response dropped it, a positional id now
  // names another row's data) unbinds what it bound: the element may outlive
  // the occurrence (a morph keeps un-keyed elements) and another occurrence
  // may bind it next, so a handler left behind fires a disposed fill's.
  onCleanup(() => {
    for (const element of bound) release(element);
  });
  // Value positions are READ in the compute phase: a getter read here
  // tracks, so the occurrence re-writes when its sources move. Text
  // positions are values too, collected apart: they are nodes, not props.
  function valuesFor({ element, positions }: { element: Element; positions: any[] }) {
    const props: Record<string, any> = {};
    const texts: [Comment, unknown, string][] = [];
    let classNames: Record<string, boolean> | null = null;
    let styleProps: Record<string, any> | null = null;
    for (const { pos, key, name, start } of positions) {
      if (pos === "ref" || pos.startsWith("on:")) continue;
      if (pos === "text") texts.push([start, out[key], key]);
      else if (pos === "class" || pos === "style") {
        if (name === undefined) props[pos] = out[key];
        else if (pos === "class") (classNames || (classNames = {}))[name] = !!out[key];
        else (styleProps || (styleProps = {}))[name] = out[key];
      } else props[pos] = out[key];
    }
    if (classNames !== null && !("class" in props)) props.class = classNames;
    if (styleProps !== null && !("style" in props)) props.style = styleProps;
    return { element, positions, values: props, texts };
  }
  function write(element: Element, positions: any[], props: Record<string, any>) {
    let st = state.get(element);
    if (!st) state.set(element, (st = { prev: {}, handlers: {}, ref: undefined, refId: "" }));
    // Handler positions: the marker's event name (`onClick` compiled to
    // `click`) as the prop `assign` binds. The prop must be `on` + an
    // uppercase letter (`onClick`) — a lowercase `onclick` is an attribute
    // to `assign`. The server merges duplicate handlers last-wins, so a
    // position names one key; given more, the last. Several keys at a ref
    // position all fire, in marker order.
    const handlers: Record<string, string> = {};
    const refKeys: string[] = [];
    for (const { pos, key } of positions) {
      if (pos === "ref") refKeys.push(key);
      else if (pos.startsWith("on:")) handlers["on" + pos[3].toUpperCase() + pos.slice(4)] = key;
    }
    let owners = handlerOwners.get(element);
    if (!owners) handlerOwners.set(element, (owners = {}));
    for (const prop in handlers) {
      const key = handlers[prop];
      let h = st.handlers[prop];
      if (h === undefined || h.key !== key)
        st.handlers[prop] = h = { key, value: untrack(() => out[key]) };
      props[prop] = h.value;
      owners[prop] = token;
    }
    // A handler the server released (or this occurrence let go of) is
    // unbound through `assign`'s diff — unless another occurrence has taken
    // the element's handler since, which is then not ours to clear.
    const clearing: Record<string, true> = {};
    for (const prop in st.handlers) {
      if (prop in handlers) continue;
      delete st.handlers[prop];
      if (owners[prop] === token) {
        delete owners[prop];
        clearing[prop] = true;
      }
    }
    if (refKeys.length) {
      // One stable ref per key set: `assign` fires a ref when its value
      // changes; a rebind that changes the bound keys fires it once.
      const id = refKeys.join(",");
      if (st.refId !== id) {
        const refs = refKeys.map(k => untrack(() => out[k]));
        st.refId = id;
        st.ref = (el: Element) => {
          for (const r of refs) typeof r === "function" && r(el);
        };
      }
      props.ref = st.ref;
    }
    // A value position the server RELEASED (a rebind whose incoming markup
    // no longer marks it) is the server's again, and the morph already
    // wrote the server's value there. Drop it from the diff state so
    // `assign` does not null the attribute the morph just applied. The ref
    // is the client's alone: it stays in `prev` and clears through the diff.
    for (const k in st.prev) {
      if (k in props || k === "ref" || k in clearing) continue;
      delete st.prev[k];
    }
    assign(element, props, true, st.prev);
  }
  function release(element: Element) {
    if (!state.has(element)) return;
    write(element, [], {});
    state.delete(element);
  }
  // A text position renders as a client insert renders a primitive: a
  // string or number as text, nullish and booleans as nothing. Anything
  // else is content, which belongs in a template slot.
  function writeText(start: Comment, v: unknown, key: string) {
    let s = "";
    if (typeof v === "string" || typeof v === "number") s = "" + v;
    else if (IS_DEV && v != null && typeof v !== "boolean") {
      const shape = shapeOf(v);
      slotShapeFinding(
        { reason: "text-shape", occurrence: ctx.key, key, shape },
        `[BINDING_SLOT_POSITION] \`${key}\` of \`${ctx.key}\` is placed as text, but the fill ` +
          `returned ${shape} for it. A text position renders a string or number; markup belongs ` +
          `in a template slot. The text is cleared.`
      );
    }
    const n = start.nextSibling;
    if (n && n.nodeType === 3) {
      if ((n as Text).data !== s) (n as Text).data = s;
    } else if (s) start.after(s);
  }
}

/** A value's shape, as the binding-slot shape findings name it. */
function shapeOf(v: unknown): string {
  return v === null
    ? "null"
    : typeof Node === "function" && v instanceof Node
      ? "a DOM node"
      : Array.isArray(v)
        ? "an array"
        : isAsyncValue(v)
          ? "an async value"
          : typeof v;
}

/**
 * Dev finding (`BINDING_SLOT_POSITION`): the client side of a binding slot
 * has the wrong shape — the fill's return is not an object or the prop is
 * not a function (`fill-shape`), or a text position's value is not a
 * primitive (`text-shape`). Through the diagnostics channel, so an
 * observer captures it beside the server's findings.
 */
function slotShapeFinding(data: Record<string, string>, message: string) {
  DEV!.report(
    OBSERVE!.diagnostics.emit(
      { code: "BINDING_SLOT_POSITION", kind: "render", severity: "warn", message, data },
      null
    )
  );
}

/** Whether a resolved slot value is reactive at the top level. */
function isReactiveContent(value: any): boolean {
  if (typeof value === "function") return true;
  if (Array.isArray(value)) {
    for (const v of value) if (isReactiveContent(v)) return true;
  }
  return false;
}

/**
 * The slot fills of a boundary. `scope` (adopted boundaries): the
 * registry/gather pair the boundary adopted under, for its occurrences'
 * claims — see `claimRender`.
 */
function slotsFor(props: Record<string, any>, scope?: ClaimScope) {
  // Live range bindings, one per occurrence. A re-call replaces its
  // occurrence's binding (the frame only runs slot cleanups at unmount, not
  // between re-calls), so dispose the outgoing one before the incoming
  // invocation takes either path — a static re-call after a reactive one must
  // not leave a binding fighting the frame for the range.
  const bindings = new Map<string, { dispose(): void }>();
  // Each fill invocation's reactive scope, one per occurrence. The fill
  // renders under a PER-OCCURRENCE owner (a child of the ambient scope, so
  // context flows) whose disposal rides the frame's occurrence-level
  // cleanup: a fill's `onCleanup` and effects live and die with the
  // occurrence — a later response dropping it disposes right there — not
  // with the covering boundary, which outlives every occurrence it covers.
  const fillScopes = new Map<string, { dispose(): void }>();
  return new Proxy(
    {},
    {
      get(_, prop) {
        if (typeof prop !== "string" || !(prop in props)) return undefined;
        return (slotProps: any, ctx: any) => {
          const key = ctx && ctx.key;
          const prev = key !== undefined && bindings.get(key);
          if (prev) {
            bindings.delete(key);
            prev.dispose();
          }
          // A re-call replaces the invocation wholesale (same contract as
          // the binding above): the outgoing fill's scope disposes before
          // the incoming one renders.
          const prevFill = key !== undefined && fillScopes.get(key);
          if (prevFill) {
            fillScopes.delete(key);
            prevFill.dispose();
          }
          // Binding slot (§9.2.3): the occurrence's node is the set of server
          // elements reading its properties at bound positions. Always under
          // a per-occurrence owner: the binding must die with the occurrence
          // (a later response dropping it, or every consumer replaced by
          // the morph), and there are no placed nodes for the frame's zombie
          // heuristic to misread.
          if (ctx && ctx.positions) {
            const fill = props[prop];
            if (typeof fill !== "function") {
              if (IS_DEV) {
                slotShapeFinding(
                  { reason: "fill-shape", occurrence: key, shape: typeof fill },
                  `[BINDING_SLOT_POSITION] Server markup reads slot \`${prop}\` as data (\`${key}\`), ` +
                    `but the client prop is ${typeof fill === "object" ? "an object" : `a ${typeof fill}`}, ` +
                    `not a function. The fill is a function of the occurrence's args returning the object ` +
                    `the markup reads: \`${prop}={args => ({ … })}\`. Nothing binds until it is.`
                );
              }
              return undefined;
            }
            const owner = createOwner();
            fillScopes.set(key, owner);
            ctx.onCleanup(() => {
              if (fillScopes.get(key) === owner) fillScopes.delete(key);
              owner.dispose();
            });
            runWithOwner(owner, () => {
              const args = ctx.onUpdate
                ? liveSlotProps(slotProps, ctx)
                : slotArgsProxy(() => slotProps);
              bindDataOccurrence(
                fill,
                args,
                ctx,
                IS_DEV ? `the \`${prop}\` binding-slot fill` : undefined
              );
            });
            return undefined;
          }
          // Stream-mounted fills (no ambient owner at invocation — the frame
          // called from a chunk microtask) render under a PER-OCCURRENCE
          // owner whose disposal rides the frame's occurrence-level cleanup:
          // the fill's `onCleanup` and effects die when a later response
          // drops the occurrence, not at boundary dispose (they used to
          // register on the boundary owner and leak until teardown).
          //
          // Live-render invocations (a reveal boundary's content render, the
          // t=0 adoption sync) are deliberately NOT scoped this way: the
          // ambient owner — the reconstructed segment boundary's content
          // computation — already owns the fill with the right lifetime, and
          // handing it to frame cleanups instead is wrong there: the frame's
          // zombie heuristic reads "mounted nodes without a parent" as a
          // destroyed mount, but a pending fill's nodes are legitimately
          // detached while its covering boundary shows the fallback — the
          // cleanup would dispose the live pending effect and release the
          // boundary over a hole.
          const fillOwner = streamInvoke ? createOwner() : null;
          if (fillOwner && key !== undefined && ctx) {
            fillScopes.set(key, fillOwner);
            ctx.onCleanup(() => {
              if (fillScopes.get(key) === fillOwner) fillScopes.delete(key);
              fillOwner.dispose();
            });
          }
          // A render whose output is already inside the range (hydration
          // claims: the nodes ARE the server-rendered DOM) is a CLAIM —
          // return undefined per the frame contract so nothing moves.
          const settle = (out: Node | Node[]) => {
            const existing: Node[] = (ctx && ctx.existing) || [];
            if (existing.length) {
              const list = Array.isArray(out) ? out : [out];
              const inPlace = list.every(n =>
                existing.some(e => e === n || (e.nodeType === 1 && (e as Element).contains(n)))
              );
              if (inPlace) return undefined;
            }
            return out;
          };
          // The prop is read INSIDE the claim scope: compiled component props
          // are getters, so JSX evaluates lazily at access — deferring the
          // access into the scoped owner is what makes plain JSX (no thunks)
          // get the producer's hydration keys. A render-prop occurrence (the
          // server placed it with args, `ctx.invoked` — the args may be
          // empty) is CALLED here, so async fills throw inside the frame's
          // fill machinery where reveal seams catch them; a direct-insert
          // value is left as-is — for a reactive value (a boundary accessor,
          // changing route children) calling it here would snapshot ONE
          // state of it.
          const evaluate = () => {
            const v = props[prop];
            if (typeof v === "function" && ctx && ctx.invoked) {
              // Render-prop calls get LIVE props (see liveSlotProps): the
              // frame updates them in place on an args change rather than
              // re-calling, so occurrence state survives entity morphs.
              // Without live updates the same async-read wrap still applies
              // over the static args (DR-2: async values suspend at the
              // consumption read on every path).
              // Called untracked, as a component body is: a top-level read
              // is a one-time read, and dev names it.
              const fillProps = ctx.onUpdate
                ? liveSlotProps(slotProps, ctx)
                : slotArgsProxy(() => slotProps);
              return untrack(
                () => v(fillProps),
                IS_DEV ? `the \`${prop}\` template-slot fill` : undefined
              );
            }
            return v;
          };
          const adopted = !!(
            ctx &&
            ctx.frame &&
            ctx.adopted &&
            ctx.existing &&
            ctx.existing.length
          );
          const prefix = ctx && ctx.frame ? `sc-${ctx.frame}-${ctx.key}-` : "";
          // The claim: evaluate this occurrence under the SAME hydration-key
          // owner scope the document producer used — solid's registry hands
          // the render its server-rendered nodes by key, so the SSR'd wrapper
          // (interior included) becomes the live component's DOM. Templates
          // never ship as data; the claim IS the transfer. Adoption mounts a
          // microtask after the hydrate window closes, so this is a scoped
          // RE-ENTRY (the late-boundary-resume pattern): a registry gathered
          // from the range, swapped in for the synchronous render.
          //
          // ONLY for ctx.adopted (the hydration-attach sync): a stream-driven
          // re-call with existing nodes must render for real — claiming would
          // no-op its inserts and silently drop whatever the re-call
          // displaced, e.g. moved-out {$frame} region ranges (#547).
          const value = fillOwner
            ? runWithOwner(fillOwner, () =>
                adopted ? claimRender(prefix, ctx.existing, evaluate, scope) : evaluate()
              )
            : adopted
              ? claimRender(prefix, ctx.existing, evaluate, scope)
              : evaluate();
          // Static content (the common case: render props returning component
          // roots, plain JSX with no top-level control flow): today's
          // zero-cost path — claim in place or hand the frame the nodes. No
          // effect is created and hydration stays a no-op.
          if (!isReactiveContent(value)) {
            return settle(normalizeSlotContent(value));
          }
          // Reactive content (a boundary accessor, route children): snapshot-
          // ting it would freeze ONE state of it into the range, so own the
          // range instead — bind the value before the range's end marker with
          // insert() (the same primitive compiled JSX uses for `{expr}`
          // positions) and return undefined so the frame leaves the interior
          // alone. `existing` seeds insert's tracked array: an accessor that
          // yields the claimed nodes reconciles to a zero-mutation no-op, one
          // that yields new content swaps it in place.
          //
          // The claim scope wraps the insert CALL, not the accessor: the
          // binding's first evaluation is insert's own render effect computing
          // synchronously, so it still creates under the producer's hydration
          // keys — boundary-deferred children (route content behind
          // <Loading>) create on that read — while the reads it makes belong
          // to the effect and stay tracked. Claiming inside the accessor
          // instead put that first read inside runWithOwner's UNTRACKED window
          // (it clears `tracking` along with the owner). Whenever the value it
          // returned was not itself an accessor for insert to re-read — a
          // <Loading> answering a still-pending streamed fragment returns its
          // fallback NODES — the effect ended up with no dependency at all and
          // the range went permanently inert: the boundary's own resume still
          // claimed the swapped-in server markup, so the region looked right,
          // but nothing downstream (a route change out of it) ever re-rendered
          // it again.
          if (ctx && ctx.range) {
            const source = value;
            const owner = createOwner();
            bindings.set(key, owner);
            ctx.onCleanup(() => {
              if (bindings.get(key) === owner) bindings.delete(key);
              owner.dispose();
            });
            const end = ctx.range.end;
            const bind = () =>
              insert(
                end.parentNode as any,
                () => (typeof source === "function" ? source() : source),
                end,
                [...ctx.existing]
              );
            runWithOwner(owner, () =>
              adopted ? claimRender(prefix, ctx.existing, bind, scope) : bind()
            );
            return undefined;
          }
          // No range handle (a consumer-constructed frame without markers):
          // static placement is the only option — degrade to the snapshot.
          return settle(normalizeSlotContent(value));
        };
      }
    }
  );
}

// Boundary-driven segment reveal (the per-`<Loading>` model). A streamed
// segment's placeholder is the client footprint of the server `<Loading>` that
// produced it, so we reconstruct a client `<Loading>` right there: a FRESH
// loading boundary shows the server-rendered fallback while its children — the
// segment content plus its client fills — are pending, then reveals. Because
// the fills render INSIDE this boundary, an unboundaried async fill's
// `NotReadyError` propagates up the graph to it and is covered (not orphaned on
// the frame's already-latched outer boundary); a fill with its OWN `<Loading>`
// contains itself and this one reads it as resolved. One boundary per revealed
// segment — i.e. per author-placed `<Loading>` (a single high one for most
// apps) — so this is React's granularity, not a per-chunk tax. Runs under the
// frame's owner so the boundary disposes with the frame.
function revealSeam(owner: any) {
  return (seam: { before: Node; fallback: Node[]; content: () => Node }) =>
    runWithOwner(owner, () =>
      insert(
        (seam.before as any).parentNode,
        createLoadingBoundary(
          () => seam.content(),
          () => seam.fallback
        ) as any,
        seam.before as any
      )
    );
}

// The frame invokes slots and element-claim sweeps through `ownerScope`
// two ways: from stream microtasks with no owner of their own — those get
// the boundary's owner, so consumer cleanup disposes with the boundary —
// and from inside a live render (the t=0 adoption sync, a reveal
// boundary's content render), where the ambient owner is already the
// right scope and MUST stay it: the reconstructed segment `<Loading>`
// owns its content render, and re-parenting the fill to the frame's outer
// owner would let an unboundaried async fill escape the boundary that
// exists to cover it (revealing the segment with a hole instead of
// holding the server fallback).
//
// The stream path is flagged for the fill scope in `slotsFor`: only
// stream-mounted fills get a per-occurrence owner tied to frame cleanups
// (live-render fills are already owned by their covering render).
let streamInvoke = false;
function boundaryScope(owner: any) {
  return (fn: () => any) => {
    if (getOwner()) return fn();
    streamInvoke = true;
    try {
      return runWithOwner(owner, fn);
    } finally {
      streamInvoke = false;
    }
  };
}

function boundaryComponent(host: any, fnId: string) {
  return (props: Record<string, any>, binding?: () => string) => {
    // Element-claim sweeps (router link-state contract) run under this
    // boundary's owner: consumers' per-element onCleanup disposes with the
    // boundary, and streamed chunks — applied from microtasks with no owner
    // of their own — still claim with the right lifetime.
    const owner = getOwner();
    const id = binding ? contentAddress(binding()) : fnId;
    // The frame's error, announced to the mount's content node (`landing`).
    const [failed, onApply] = failing();
    // The boundary is a DOM element (`<solid-frame>`), not a branded value:
    // `insert` places it natively in any position (array/fragment/single —
    // no #550), and the frame mounts INTO it.
    const { element, frame, dispose } = createFrameElement({
      host,
      // The mount binds the ADDRESS's store (content is keyed by call, the
      // mount by site); an unbound render (no gated reader, e.g. a direct
      // placeholder mount) binds the function id — the argless address.
      id,
      slots: slotsFor(props),
      ownerScope: boundaryScope(owner),
      reveal: revealSeam(owner),
      onApply
    });
    onCleanup(dispose);
    // The shell: the covering <Loading> pends on the bound address's first
    // flush (`landing`), the enclosing <Errored> catches its error. The
    // binding resolves at response-header time while content streams in
    // behind it — read ungated, the boundary would resolve over an empty
    // <solid-frame> (a flash) and have LATCHED by the time the shell's
    // fills run, orphaning any pending async slot-arg read (with no reveal
    // seam to reconstruct, the mount's own boundary is the covering one). A
    // warm direct mount has its content before we return and IS the
    // element: the node reads it synchronously, no pending beat.
    if (!binding) return landing(host, id, element, failed) as unknown as SolidElement;
    // Follow the live address binding (the identity split's delivery
    // path): a `dynamic` site whose call switched arguments keeps this
    // instance and pushes the new address through the accessor — the frame
    // re-binds its pull to the new address's resident store (warm content
    // re-materializes instantly; slot occurrences whose ids persist keep
    // their client state) — and a refetch of the address shown pushes a
    // content token (the same address: not a new question, the landing
    // reads warm, and the refetch's pending is the transaction's).
    followAddress(host, frame, binding);
    return createMemo(() =>
      landing(host, contentAddress(binding()), element, failed)
    ) as unknown as SolidElement;
  };
}

/**
 * The document-adoption implementation behind `self._$SC.r(id)`
 * placeholders (see SERVER_COMPONENT_BOOTSTRAP): find the SSR'd
 * `frame:<id>` comment range in the document, bind an adopting frame over
 * it (slots claim/replace within their server-rendered ranges), and hand
 * hydration back the existing nodes so nothing re-renders. Registered per
 * function id so post-load streams (remapped onto the same id) morph the
 * adopted content.
 */
// Boundaries the page carried that a component has already bound to —
// intercepted calls consume them exactly once, so post-load navigations go
// to the network like any other call.
const claimedBoundaries = new Set<string>();

// ---- the document live-hole channel (Stage 4) --------------------------
//
// The document face ships live-hole re-emissions as ONE `sc:live` record
// whose value is a ReadableStream of ops ({ type: "hole" | "attr" |
// "error", key, ... } — chunk-shaped minus addressing). A stream has one
// reader, so the pump runs once at module level and BROADCASTS: every
// adopted boundary applies every op into its own store at its own address,
// and page geometry routes — hole ids are document-unique and each frame's
// apply searches only its own range (skipping nested bare frames), so
// exactly the owning boundary finds the target; everyone else's record
// stays pending, harmlessly. The op log replays to boundaries that adopt
// after ops arrived (the catch-up morph: a value that changed between
// shell flush and adoption lands right after the claim — never a
// hydration mismatch, hydration claimed V1 markup). Ops are last-value-
// wins per target, so the log COMPACTS on that key: a long generation
// leaves one entry per hole/attr/arg-record rather than its whole history,
// and catch-up replays the latest state instead of every stale morph.
const liveOps = new Map<string, any>();
const liveAppliers = new Set<(op: any) => void>();
let livePumped: any = null;
function pumpLiveChannel() {
  const stream = (globalThis as any)._$HY?.r?.["sc:live"];
  if (!stream || stream === livePumped || typeof stream.getReader !== "function") return;
  livePumped = stream;
  const reader = stream.getReader();
  const pump = (): Promise<void> =>
    reader.read().then((r: { done: boolean; value: any }) => {
      if (r.done) return;
      const op = r.value;
      // A sweep's `ops` unit is applied whole (one write per boundary) but
      // logged by its members: the log is last-value-wins per target, and
      // a member's target is the key, not the unit it rode in.
      for (const m of op.type === "ops" ? op.ops : [op])
        liveOps.set(`${m.type}:${m.fid || ""}:${m.key || ""}`, m);
      for (const apply of liveAppliers) apply(op);
      return pump();
    });
  pump().catch(() => {
    /* a truncated document stream latches at the last op applied */
  });
}

// One document query indexes the SSR'd frame ELEMENTS by id; the intercept and
// adoption paths become map lookups. Boundaries are static document output
// carried as `<solid-frame data-fid>` elements — a single attribute query, no
// per-boundary TreeWalk and no comment-pair depth-matching. Entries are
// consumed once (claimedBoundaries), so entries never need invalidation.
//
// The page is NOT a single snapshot, though: a server component whose source
// settles after the shell flush has its markup streamed in afterwards and
// swapped over the `<Loading>` fallback it left behind. So the index is seeded
// from what has parsed so far and EXTENDED at every reveal, and a miss while
// the document is still streaming means "not yet", not "never".
let boundaryIndex: Map<string, Element> | null = null;
// Region ids are `fn.occurrence.key`; only function ids are ever looked up as
// boundaries, so leaving regions out keeps this at a handful of entries rather
// than one per nested region (a large comment thread carries hundreds).
const isBoundaryId = (id: string) => !id.includes(".");
function indexBoundaries(root: ParentNode) {
  root.querySelectorAll(FRAME_SELECTOR).forEach(el => {
    const key = el.getAttribute(FRAME_ID_ATTR);
    if (key && isBoundaryId(key) && !boundaryIndex!.has(key)) boundaryIndex!.set(key, el);
  });
}
function findBoundaryElement(id: string): Element | undefined {
  if (!boundaryIndex) {
    boundaryIndex = new Map();
    if (typeof document !== "undefined" && document.body) indexBoundaries(document.body);
  }
  return boundaryIndex.get(id);
}

// The one deferred answer for "the page may still deliver this boundary":
// a boundary not in the document yet while the document can still deliver
// it (see boundaryMayArrive) is a LOCAL answer that has not landed, not a
// miss — a fetch now would render on the wire what the document is already
// streaming, and a fresh mount now would orphan the markup when it lands.
// One promise per id, shared by every asker while it is outstanding — the
// intercept answering a call, and a placeholder mount pending on its
// element (frames A5′, G9: the two waiters this used to be asked one
// question); it settles at the reveal that carries the element (true) or
// once the page has no reveal left to deliver it (false).
const arrivals = new Map<string, { promise: Promise<boolean>; resolve: (v: boolean) => void }>();

// Frame elements — adopted boundaries and the region elements inside them —
// whose mount has been disposed (see installRevealHook's ownership
// predicate): a placeholder under one is no longer anyone's content. The
// regions are marked with their boundary so the predicate's nearest-frame
// lookup is the whole check (a placeholder in a nested region sees the
// region first). Weak — an element that leaves the document is forgotten
// with it.
const FRAME_SELECTOR = `[${FRAME_ID_ATTR}]`;
const disposedFrames = new WeakSet<Element>();
function awaitBoundary(id: string) {
  let arrival = arrivals.get(id);
  if (!arrival) {
    let resolve!: (v: boolean) => void;
    const promise = new Promise<boolean>(r => (resolve = r));
    arrivals.set(id, (arrival = { promise, resolve }));
  }
  return arrival.promise;
}

/**
 * Whether the document may still deliver boundary elements — the hydration
 * runtime's fragment ledger's answer (`_$HY.fr.pending()`: any declared
 * `_fr` fragment not yet swapped in, held, style-gated, and in-flight
 * states included).
 *
 * `_$HY.done` alone stopped being that answer with the held-swap policy
 * (#2964): a fragment that settles after global hydration completes is HELD —
 * placeholder, fallback and template all left in place — until its boundary
 * registers as the claimant, and the replay that follows is what puts this
 * element in the page. A boundary rendering in that window (a frames slot fill
 * or lazy route module running after the root pass) would read done as "the
 * page is complete", mount a fresh frame, and orphan the markup on the way:
 * the region goes inert, and because the id is never claimed, every later call
 * for this function resolves back to the document placeholder instead of
 * fetching. So an outstanding fragment keeps the answer "not yet".
 */
function boundaryMayArrive() {
  const hy = (globalThis as any)._$HY;
  if (!hy) return false;
  return !hy.done || !!(hy.fr && hy.fr.pending());
}

/**
 * Install the frames client's two hooks on the hydration runtime's fragment
 * ledger (idempotent — `_$HY.$sc`):
 *
 * - Ownership by rendering (`_$HY.fa`, frames A5′ / rulings 3.3): a `pl-*`
 *   placeholder inside a server component's element is the component's
 *   content — the server rendered that `<Loading>` inside the component, so
 *   no client boundary will ever register as its claimant. The ledger asks
 *   this predicate before holding a post-done swap; an owned swap proceeds
 *   whether or not a client has adopted the element yet (an adoption that
 *   follows finds the settled markup in place and drains its records).
 *   Disposal is mostly geometry — a disposed boundary's element normally
 *   leaves the document, so the placeholder the ledger looks up is gone
 *   and the swap is held like any other — but an adopted element whose
 *   mount is disposed IN PLACE (the element is the component's return
 *   value; a root disposed without detaching it leaves it standing) is
 *   dead markup nobody drives, and a swap into it would be exactly the
 *   inert content #2964 holds against (contract C14: a reveal after
 *   disposal touches nothing). `disposedFrames` records those elements
 *   (the boundary and the region elements inside it, since a placeholder
 *   in a nested region sees the region's `data-fid` first); the predicate
 *   disowns a placeholder whose nearest frame element is one of them.
 *
 * - The reveal subscription, to learn when a late boundary lands. The
 *   ledger notifies on every fragment reveal — the only moment a boundary
 *   element can enter the page after the initial parse — with the revealed
 *   fragment's parent, and on truncation (no parent) so waiters the page
 *   can no longer answer re-evaluate. Scoping the rescan to the revealed
 *   fragment's parent (rather than the document) keeps this proportional
 *   to what just arrived.
 */
function installRevealHook() {
  const hy = (globalThis as any)._$HY;
  if (!hy || hy.$sc || !hy.fr) return;
  hy.$sc = true;
  hy.fa = (pl: Element) => {
    const el = pl.closest(FRAME_SELECTOR);
    return !!el && !disposedFrames.has(el);
  };
  hy.fr.subscribe((_id: string, parent?: ParentNode) => {
    // Nothing has looked a boundary up yet, so there is nothing to keep
    // current — the first lookup scans the document as it stands then.
    if (!boundaryIndex) return;
    const root = parent || (typeof document !== "undefined" ? document.body : null);
    if (root) indexBoundaries(root);
    if (!arrivals.size) return;
    // A waiter the page can no longer answer must not wait forever: once the
    // document is done and no fragment is left outstanding (truncated ones
    // included), nothing else can deliver this element, so release the
    // waiter — the caller mounts fresh (the client-only shape) or goes to
    // the wire — instead of holding the fallback on screen. (The ledger
    // reads the revealing fragment as delivered from its swap, so the LAST
    // reveal of a page is the exhaustion it looks like: the `_fr` stamp the
    // same batch executes after this notification is not what it waits on.)
    const exhausted = hy.done && !hy.fr.pending();
    for (const [id, arrival] of arrivals) {
      const el = boundaryIndex && boundaryIndex.get(id);
      if (!el && !exhausted) continue;
      arrivals.delete(id);
      arrival.resolve(!!el);
    }
  });
}

function documentBoundary(
  host: any,
  id: string,
  props: Record<string, any>,
  binding?: () => string
) {
  // The ledger installs with enableHydration(), which may postdate the
  // client entry's installServerComponents() call — re-attempt here, where
  // hydration is necessarily live (idempotent via the $sc flag).
  installRevealHook();
  const claimed = claimedBoundaries.has(id);
  const el = !claimed ? findBoundaryElement(id) : undefined;
  if (el) return adoptBoundary(host, id, el, props, binding);
  // Not in the page (yet). While the page can still deliver it (the document is
  // streaming, or a deferred fragment is still holding its markup — see
  // boundaryMayArrive), this is a boundary whose content settled after the
  // shell flush: its markup is on the way and will be swapped over the
  // fallback that is on screen right now. Mounting a fresh frame here is
  // unrecoverable — the markup arrives owned by nothing (visible but inert)
  // while the stream drives an element outside the page, so the boundary never
  // updates again. Suspend instead and adopt on delivery; the enclosing
  // <Loading> goes on showing the server's fallback, which is exactly what the
  // document is displaying.
  //
  // The wait is the intercept's deferred answer (`awaitBoundary`): one
  // promise per id, settled by the reveal hook when the element lands or
  // when the page has nothing left to deliver it. Every mount asking during
  // the wait shares it; at the answer the first to resume adopts and any
  // other finds the id claimed and mounts fresh (only one frame may adopt an
  // element). A mount disposed during the wait resumes nothing.
  if (!claimed && boundaryMayArrive()) {
    const owner = getOwner();
    let live = true;
    onCleanup(() => (live = false));
    return createMemo(() =>
      awaitBoundary(id).then(
        () =>
          live &&
          runWithOwner(owner, () => {
            const node = claimedBoundaries.has(id) ? undefined : findBoundaryElement(id);
            // No element after all (the page ran out of reveals, or another
            // mount took it): mount fresh, exactly as an unwaited miss would.
            return node
              ? adoptBoundary(host, id, node, props, binding)
              : boundaryComponent(host, id)(props, binding);
          })
      )
    ) as unknown as SolidElement;
  }
  // No SSR'd boundary on the page (client-only boot, or already claimed):
  // mount fresh — the pending/late stream fills it exactly like the
  // non-document path.
  return boundaryComponent(host, id)(props, binding);
}

/**
 * The address a document boundary's content is keyed under: the call's
 * address as the hydration references recorded it (`_$SC.a`, address -> id).
 * A mount without a live binding (a direct placeholder render at t=0) reads
 * it from those records; an argless call's address IS the function id, so
 * the common shell case needs no record at all.
 */
function documentAddress(id: string) {
  const records = (globalThis as any)._$SC?.a;
  if (records) {
    for (const address in records) if (records[address] === id) return address;
  }
  return id;
}

function adoptBoundary(
  host: any,
  id: string,
  el: Element,
  props: Record<string, any>,
  binding?: () => string
) {
  claimedBoundaries.add(id);
  // Content is keyed by the CALL's address (the identity split): the frame
  // binds the address's resident store, while `id` — the function id, the
  // document's wire name — stays the key records and region ids on the page
  // are written under.
  const address = binding ? contentAddress(binding()) : documentAddress(id);
  // Occlusion records (case 3, document face): content a client wrapper
  // never rendered during SSR shipped ONCE as hydration data instead of
  // markup. Apply the records BEFORE binding the frame — the host buffers
  // them per id and drains at registration, so the first slot sync claims
  // WITH real args and the wrapper can render the occluded region later
  // from the frame store. Re-drainable (each key is taken once): a reveal
  // brings its occurrences' records with it (the cascade below re-drains),
  // and a record the producer DECLARED but has not settled yet is awaited
  // through its `.then` — the record is a pending value under its key at
  // the marker, settled with the args (as a fragment's `<key>_fr` is), so
  // its arrival is a write the frame sees, never a plain assignment to
  // poll for (frames A4, S-record).
  const appliedRecords = new Set<string>();
  // Deferred fragments in the adopted markup (#2978): a <Loading> that
  // suspended inside the server component during document SSR left a `pl-*`
  // placeholder here, but its producer ran on the SERVER — no client
  // boundary will ever register as the fragment's claimant. The ledger
  // settles these by OWNERSHIP BY RENDERING (`_$HY.fa`, installRevealHook):
  // a placeholder inside a `data-fid` element is the component's content,
  // so its swap proceeds post-done whether or not this adoption has
  // happened yet — nothing here to claim, nothing to release at disposal.
  //
  // What remains of the region sweep is dev-only diagnosis. A server
  // `<Loading>` inside a server component is the SERVER's boundary (A0,
  // corollary 4 — inward): its outcome arrives as markup, and the client
  // shows whatever the server rendered for it — never a client-invented
  // error state. A rejected one has no client twin to surface its `<key>_fr`
  // rejection (hydratedCreateLoadingBoundary's `s === 2` arm runs only for a
  // boundary registered against it), so dev names it here — at adopt time
  // and for content revealed into the region later (an outer fragment's
  // payload can carry a nested pending one); the server's error path writes
  // a BLANK template for it today (web/src/server.ts, the `done` closure's
  // `" "`), which is the server half's gap, not a client state to invent.
  // (Every call site is `IS_DEV &&`-guarded so the sweep is 0 bytes in prod.)
  const reportedFragments = new Set<string>();
  const reportRegionFragments = (root: ParentNode) => {
    const hy = (globalThis as any)._$HY;
    if (!hy || !hy.r) return;
    root.querySelectorAll('template[id^="pl-"]').forEach(tpl => {
      const fragId = tpl.id.slice(3);
      if (reportedFragments.has(fragId)) return;
      reportedFragments.add(fragId);
      const ref = hy.r[fragId + "_fr"];
      ref &&
        typeof ref.then === "function" &&
        ref.then(undefined, (error: unknown) =>
          console.error(
            `Server <Loading> fragment "${fragId}" inside server component "${id}" rejected on ` +
              `the server; the frame shows what the server rendered for that outcome.`,
            error
          )
        );
    });
  };
  const drainRecords = () => {
    const hy = (globalThis as any)._$HY;
    if (!hy || !hy.r) return;
    // The live channel serializes eagerly at arming, so the adopt-time
    // drain normally starts the pump; attempted on every re-drain anyway —
    // idempotent, and a defensive catch for a record that lands late.
    pumpLiveChannel();
    const slotPrefix = `sc:slot:${id}:`;
    for (const key of Object.keys(hy.r)) {
      if (appliedRecords.has(key)) continue;
      if (key.startsWith(slotPrefix)) {
        appliedRecords.add(key);
        // Slot records land in the ADDRESS's store (where the frame binds);
        // the wire keys them by function id, the document's producer name.
        const apply = (args: unknown) =>
          host.apply({
            type: "slot",
            id: address,
            version: 0,
            key: key.slice(slotPrefix.length),
            args
          });
        const value = hy.r[key];
        // A declared record: settled reads its stamp synchronously (a
        // pending beat here would push an adopt-time claim past the
        // window — readHydratedValue's rule); pending is awaited; rejected
        // is observed (the stamp is the consumption, #2997) and nothing
        // applies — the occurrence has no args to run with.
        if (value && typeof value.then === "function") {
          if (value.s === 1) apply(value.v);
          else if (value.s === 2) value.then(undefined, () => {});
          else value.then(apply, () => {});
        } else apply(value);
      } else if (key.startsWith("sc:region:")) {
        const childId = key.slice("sc:region:".length);
        if (childId.startsWith(id + ".")) {
          appliedRecords.add(key);
          // Async-occluded regions arrive as promises (the producer held
          // the stream on them); regions keep their producer-relative ids
          // (the records reference them by those), and the store warms per
          // id either way, so a late apply still lands before the region
          // binds on expand.
          const val = hy.r[key];
          const apply = (html: any) => host.apply({ type: "html", id: childId, version: 0, html });
          val && typeof val.then === "function" ? val.then(apply) : apply(val);
        }
      }
    }
  };
  IS_DEV && reportRegionFragments(el);
  const fr = (globalThis as any)._$HY?.fr;
  // The adopting frame, bound below; the reveal cascade syncs it.
  let frame: ReturnType<typeof createFrame> | undefined;
  const unsubscribe = fr
    ? fr.subscribe((_fragId: string, parent?: ParentNode) => {
        // The cascade: a reveal into this region can itself carry a pl-*
        // (nested server async). Scoped to the revealed parent, so each
        // sweep is proportional to what just landed.
        const inside = !!parent && el.contains(parent as Node);
        IS_DEV && inside && reportRegionFragments(parent!);
        // A revealed fragment also brings its occurrences' ARGS RECORDS: a
        // slot invoked inside a server `<Loading>` ships its `sc:slot:`
        // declaration with the fragment, ~the async's own delay after this
        // boundary adopted — long after the adopt-time drain below ran.
        // Re-drainable by design (each key is taken once), so this is a
        // cheap no-op once caught up.
        drainRecords();
        // A reveal is an apply (frames-rulings 2.3): content that becomes
        // shown under a version is synced as content that arrived under it.
        // The document face's reveal engine (`$df`) knows nothing of the
        // frame, so the frame is told here — an empty write at its version
        // re-walks its content for occurrences and applies what the store
        // holds for them: a direct-insert range the fragment carried mounts
        // (C2 b), a record drained before its range was shown takes effect
        // now (C4 d), and a called occurrence whose record trails the
        // reveal waits for the declaration's settle — the drain above
        // subscribed to it, and that write re-syncs (C2 a2). "The record
        // arrived" and "the range is shown" are one event seen from two
        // sides; either one completes the pair.
        if (inside && frame) frame.apply({ version: frame.version ?? 0, r: {} });
      })
    : undefined;
  // Live-hole ops broadcast into this boundary's store at its bound
  // address (version 0, the adopted stream — a refetch's higher version
  // supersedes, so document ops go quiet the moment the boundary moves to
  // a call-driven stream). Hole and attr ops route themselves by DOM
  // geometry (document-unique keys, range-scoped search), but SLOT ops are
  // store-keyed — two boundaries can share an occurrence name — so they
  // carry the producing frame's id and only the owning boundary applies
  // (the stray `fid` field rides into the apply; records are built from
  // key/args, so it is ignored). So does a frame-addressed ERROR op — a
  // failure that escaped the server component (its `:error`, the outward
  // face; frames-rulings 3.3); hole-keyed errors stay geometry-routed.
  const applyLiveOp = (op: any) => {
    if (op.fid && op.fid !== id) return;
    host.apply({ ...op, id: address, version: 0 });
  };
  liveAppliers.add(applyLiveOp);
  onCleanup(() => {
    liveAppliers.delete(applyLiveOp);
    unsubscribe && unsubscribe();
  });
  drainRecords();
  // Catch-up: ops that arrived before this boundary adopted (the pump may
  // have started for an earlier boundary, or this is a re-mount over a
  // warm page). Applier registration and this replay are one synchronous
  // span — the pump's async reads can't interleave — so the log is exactly
  // the pre-adoption history, and store semantics make replay idempotent
  // (same key, last value wins).
  for (const op of liveOps.values()) applyLiveOp(op);
  // ownerScope: element-claim sweeps — both the adoption sweep over the
  // SSR'd element (whose anchors never ran compiled creation) and later
  // streamed morphs — bind consumer cleanup to this boundary's owner (see
  // boundaryScope for the ambient-preserving rule).
  const owner = getOwner();
  // The root this boundary adopts under (see ClaimScope): its occurrences
  // claim against this pair however late they mount.
  const sc: any = sharedConfig;
  // The frame's error, announced to the address source below (`landing`).
  const [failed, onApply] = failing();
  frame = createFrame(el, {
    adopt: true,
    host,
    id: address,
    slots: slotsFor(props, { registry: sc.registry, gather: sc.gather }),
    ownerScope: boundaryScope(owner),
    reveal: revealSeam(owner),
    onApply,
    // Hydration-done follows non-SC Solid 2 (frames-rulings 3.1, ruled):
    // an adopted occurrence the frame has not claimed yet — waiting for
    // its record — is a pending boundary in everything but a resume, and
    // registers as one through the same registration a streamed
    // `<Loading>` takes (`sharedConfig.holdBoundary`), under this
    // component's owner so disposal releases it, keyed where no fragment
    // is. No parallel accounting, no second "done": `onHydrationEnd` and
    // `isHydrationInProgress()` mean the same thing with or without server
    // components. Only while hydration is in progress: a hold taken on a
    // page that never hydrated (a client render adopting server markup) or
    // after it settled is the frame's business, not the page's. Untracked:
    // the registration reads its trigger once, which is not a read of this
    // component's.
    hold: () =>
      sc.isHydrationInProgress?.()
        ? runWithOwner(owner, () => untrack(() => sc.holdBoundary("sc:" + id)))
        : () => {},
    // The identity split binds the frame to the call ADDRESS (id + args
    // hash), but the document producer stamped `_hk` keys and region fids
    // under the wire name — the bare function id. Hydration-claim prefixes
    // must derive from what the producer wrote, so thread the wire id down
    // as the claim scope; without it every adopted claim misses and the
    // occurrence re-renders fresh clones that cannibalize the server DOM.
    // Spread-cast: the published FrameOptions predates this seam.
    ...({ claimScope: id } as {})
  });
  // Follow the live address binding (see boundaryComponent and
  // followAddress): a kept resolution delivers the new call's address, or a
  // content token for the address shown, and the adopted frame re-binds
  // its pull or commits the content at the delivering transaction's commit.
  //
  // An address SWITCH is a new question on the address source (#2977,
  // adopted face — the notes-search shape: t=0 adopted sidebar, then a
  // search param changes the call). Unlike the call-driven mount, this
  // component's return value is the raw SSR'd element (hydration must
  // claim it in place), so no reader in the render graph would ever see
  // the source pend or ERROR — the effect below exists to BE that reader:
  // while its compute pends on the new address's landing, the transition
  // that delivered the switch stays open (no-op effect half: the pend IS
  // the point); when the source errors — the switch's response, or the
  // adopted frame's own `:error` later (the document face's escaped
  // server error, frames-rulings 3.3) — the throw reaches the enclosing
  // client `<Errored>` from here, and its `reset` re-asks through the
  // same node (`landing`). A mount placed without a binding has no such
  // reader: its frame's error stays a record (`frame.error`).
  if (binding) {
    followAddress(host, frame, binding);
    const source = createMemo(() => landing(host, contentAddress(binding()), true, failed));
    createRenderEffect(
      () => source()(),
      () => {}
    );
  }
  onCleanup(() => {
    frame.dispose();
    // Disown the element's placeholders (ownership by rendering, see
    // installRevealHook): the boundary and every region element inside it
    // — nothing can be revealed into a disposed element later, so what is
    // inside it now is all there will be.
    disposedFrames.add(el);
    el.querySelectorAll(FRAME_SELECTOR).forEach(e => disposedFrames.add(e));
  });
  // The boundary IS the element — hand hydration the single SSR'd node so it
  // claims it in place rather than re-rendering.
  return el as unknown as SolidElement;
}

/**
 * Installs the server-component transport policy on the server-function
 * client — the identity split (DR-1): CONTENT is keyed by the call's
 * intrinsic (function, arguments) address — per-args, exactly like the
 * query cache, so a cached resolution always names the content it was
 * cached for — while the MOUNT belongs to the call site. Every call of a
 * function resolves a binding wrapping the same per-function component
 * (the document placeholder), so `dynamic` keeps its instance across both
 * refetches AND argument changes; the instance follows delivered addresses
 * by re-binding its frame's pull, and a preload for unshown args only ever
 * warms that address's resident store.
 *
 * Call once in the client entry (an explicit call — the package is
 * `sideEffects: false`, so a bare import would be tree-shaken away);
 * call again to rebind to a custom host.
 * @experimental
 */
export function installServerComponents(host: any = getFrameHost()) {
  // Upgrade the document shell's placeholder bootstrap (if present): the
  // hydration data scripts resolved server-component references to stable
  // per-id placeholders; installing `impl` makes them mount-adopting.
  const g = globalThis as any;
  if (!g._$SC) {
    // Mirror of the document bootstrap (frame-sink's
    // SERVER_COMPONENT_BOOTSTRAP_EXPR), for a page whose data scripts carried
    // no reference: an addressed read resolves to the call's binding, an
    // unaddressed one to the per-function placeholder.
    g._$SC = {
      c: {},
      a: {},
      b: {},
      r(i: string, a?: string) {
        const c = g._$SC.c[i] || (g._$SC.c[i] = (p: any, b?: () => string) => g._$SC.impl(i, p, b));
        if (!a) return c;
        g._$SC.a[a] = i;
        g._$SC.reg && g._$SC.reg(a, i);
        return (
          g._$SC.b[a] ||
          (g._$SC.b[a] = Object.assign((p: any) => c(p, () => a), {
            [COMPONENT_BINDING]: { component: c, address: a }
          }))
        );
      }
    };
  }
  g._$SC.impl = (id: string, props: any, binding?: () => string) =>
    documentBoundary(host, id, props, binding);
  // Late boundaries arrive with the reveals, so subscribe as early as the
  // ledger allows (it installs with enableHydration; when this entry call
  // precedes it, the first documentBoundary re-attempts).
  installRevealHook();
  const handler = createServerComponentHandler({
    host,
    // ONE mount component per function, and it IS the document placeholder:
    // hydration-data references, t=0 local answers, and post-load streams
    // all resolve bindings wrapping this same identity, so `dynamic`'s
    // equals-gate holds across every path. Its mounts adopt the SSR'd
    // boundary while one is unclaimed and mount fresh after — always bound
    // to the delivered call address.
    component: (fnId: string) => g._$SC.r(fnId),
    // The page IS the t=0 record: a call whose function has an unclaimed
    // SSR'd boundary in the document is answered locally — the source
    // re-runs during hydration per dynamic's contract, but no request
    // leaves the browser. The boundary is consumed on adoption, so
    // navigations fetch normally. A boundary the page may STILL deliver
    // (its content settled after the shell flush and is streaming in) is a
    // local answer that has not landed: a promise, settling at the reveal
    // — `true` (the mount adopts the element) or `false` (nothing is left
    // to deliver it; the caller fetches). Fetching instead would render on
    // the wire what the document is already streaming.
    intercept: ({ id }: { id: string }) => {
      if (claimedBoundaries.has(id)) return undefined;
      if (findBoundaryElement(id)) return true;
      if (!boundaryMayArrive()) return undefined;
      installRevealHook();
      return awaitBoundary(id);
    }
    // Single-flight delivery (the transport's `consumer`/`codec` defaults)
    // reads the server-function client's SHARED built instance: this
    // bundle resolves the transport's wire-layer imports to that external
    // entry (externalizeSharedTransport in rollup.config.js), so no getter
    // overrides are needed.
  } as ServerComponentHandlerOptions<any>);
  // Which calls the document is showing: hydration references carry their
  // call's address (`_$SC.r(id, address)`), and those records — never seen
  // by the transport, since hydration data seeds caches directly — are what
  // key a post-load refetch of the same call to the adopted content. Drain
  // what the bootstrap collected before this ran, then register live for
  // references still streaming in.
  const showing = (address: string, id: string) => handler.showing(address, id);
  const records = g._$SC.a || (g._$SC.a = {});
  for (const address in records) showing(address, records[address]);
  g._$SC.reg = showing;
  // The re-ask (see `landing`): the call behind the address, as the
  // handler recorded it, made again — through the same declaration shape
  // it was made with (a `GET`-declared read stays a GET; declared metadata
  // rides along), with no per-call options (those were the original
  // caller's; this call is the boundary's own). The callable is minted
  // through the late-bound RPC seam, never by importing the transport:
  // the seam is filled by the time any response has been handled. Its
  // response is handled like any other and lands through the host.
  reask = address => {
    const call = callFor(address);
    const rpc = g[SERVER_FUNCTION_RPC];
    if (!call || !rpc) {
      if (IS_DEV)
        console.error(
          `Server component boundary "${address}" errored, but no call is recorded for it; ` +
            `reset() cannot re-ask the server. (The address was written by hand, not by a call.)`
        );
      return undefined;
    }
    const meta: any = call.meta || {};
    const ref = rpc.createServerReference(call.id);
    Object.assign(ref[SERVER_FUNCTION_METADATA], meta);
    return (meta.method === "GET" ? rpc.GET(ref) : ref)(...call.args);
  };
  configureServerFunctionsClient({ responseHandler: handler });
}
