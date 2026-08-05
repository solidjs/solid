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
  createLoadingBoundary,
  createMemo,
  createOwner,
  createRenderEffect,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  sharedConfig
} from "solid-js";
import type { Element as SolidElement } from "solid-js";
// `insert` MUST resolve to the shared @solidjs/web instance the compiled app
// already uses — importing it from the runtime source instead bundles a second
// copy of `insert` and the reconcile/render machinery it drags in (~4kb the app
// already has). Kept external in rollup.config.js for the same reason the
// server-functions/client import below is.
import { insert } from "@solidjs/web";
import {
  createFrame,
  createFrameElement,
  createFrameHost,
  FRAME_ID_ATTR
} from "@dom-expressions/runtime/src/frame-client.js";
import { createServerComponentHandler } from "@dom-expressions/runtime/src/frame-transport.js";
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
import { createJSONDataTable } from "@dom-expressions/runtime/src/serializer.js";

export {
  createFrame,
  createFrameHost,
  createFrameElement,
  FRAME_APPLIED_EVENT
} from "@dom-expressions/runtime/src/frame-client.js";
export {
  FRAME_STREAM_HEADER,
  applyFrameResponse,
  isFrameStreamResponse,
  createServerComponentHandler
} from "@dom-expressions/runtime/src/frame-transport.js";
// `createJSONDataTable` is NOT re-exported here: its single public home is
// `@solidjs/web/serialization` (this entry consumes it internally for its
// per-response tables).
// Server components are authored in universal code, so the slot type has to
// resolve under the browser condition too. Type-only, so nothing crosses into
// the client bundle.
export type { Slot } from "./server.js";

// One host per app is the norm: one chunk router, with codec data tables
// rotated PER RESPONSE — the deserializer's cross-reference space is
// stream-scoped by contract, so each stream into a boundary gets a fresh
// table (routed by root frame id; nested region ids prefix-match to their
// root's table). Apps needing isolation pass their own host.
let sharedHost: any;
const tables = new Map<string, any>();
function tableFor(id: string) {
  const table = tables.get(id);
  if (table) return table;
  for (const [root, t] of tables) if (id.startsWith(root + ".")) return t;
  return undefined;
}
/** Rotate in a fresh response-scoped data table for a boundary's stream. */
function beginStream(frameId: string) {
  tables.set(frameId, createJSONDataTable());
}
/**
 * The app-wide shared frame host (created lazily): one chunk router with
 * per-response codec data tables.
 * @experimental
 */
export function getFrameHost() {
  if (!sharedHost) {
    sharedHost = createFrameHost({
      applyData: (c: any) => tableFor(c.id)?.apply(c),
      resolve: (ref: any, id: string) => tableFor(id)?.resolve(ref)
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
 * Scoped hydration re-entry for one slot range (the late-boundary-resume
 * pattern): gather the range's `_hk` nodes into a registry, flip the
 * hydration window on for the synchronous render, and run under an owner
 * whose id chain reproduces the document producer's keys. No claimable
 * nodes in the range → plain client render (CSR boot, post-load streams).
 */
function gatherClaims(el: Element, registry: Map<string, Element>) {
  if (el.hasAttribute("_hk")) registry.set(el.getAttribute("_hk")!, el);
  // A nested frame region is server-owned and opaque: the occurrences inside
  // it run their own claims with their own registries. Not descending keeps
  // gathering linear over an adopted tree — a blanket querySelectorAll here
  // re-collected every nested comment's subtree once per enclosing level.
  if (el.hasAttribute(FRAME_ID_ATTR)) return;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) gatherClaims(c, registry);
}

// A deferred-fragment placeholder (`<template id="pl-*">`) in the range means
// a <Loading> inside this slot's content is still waiting on a streamed
// fragment. The claim scope must engage even when the visible fallback has no
// `_hk` elements to gather (plain text fallbacks): the boundary has to render
// under the producer's id chain so it finds its pending `<key>_fr`
// registration, goes on record as the fragment's claimant (#2964), and
// resumes into the swapped content instead of eagerly re-rendering on the
// client over a fragment that then has no owner.
function hasPendingFragment(existing: Node[]) {
  for (const n of existing) {
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (el.tagName === "TEMPLATE" && el.id.startsWith("pl-")) return true;
    if (el.querySelector?.('template[id^="pl-"]')) return true;
  }
  return false;
}

function claimRender(prefix: string, existing: Node[], render: () => any) {
  const sc: any = sharedConfig;
  if (!sc.getNextContextId) return render();
  const registry = new Map<string, Element>();
  for (const n of existing) {
    if (n.nodeType !== 1) continue;
    gatherClaims(n as Element, registry);
  }
  if (!registry.size && !hasPendingFragment(existing)) return render();
  const prevRegistry = sc.registry;
  const prevHydrating = sc.hydrating;
  const prevClaimRoots = sc.claimRoots;
  // The enclosing pass gathered these same nodes: gatherHydratable sweeps the
  // whole document for `_hk`, frame regions included, so every slot root ends
  // up in the root registry too. Only this scoped registry ever claims them,
  // so hand ownership over — otherwise the root's completion check reports
  // each claimed slot node as unclaimed server markup.
  if (prevRegistry) for (const key of registry.keys()) prevRegistry.delete(key);
  sc.registry = registry;
  sc.hydrating = true;
  // The range may be DETACHED right now (an async slot fill renders before
  // its boundary re-inserts it), and the runtime's hydration guards read
  // connectivity to tell claimed SSR nodes from fresh clones. Declaring the
  // range as claim roots keeps its interior walking as hydration either way.
  sc.claimRoots = existing;
  try {
    return runWithOwner(createOwner({ id: prefix }), render);
  } finally {
    sc.registry = prevRegistry;
    sc.hydrating = prevHydrating;
    sc.claimRoots = prevClaimRoots;
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
  const [args, setArgs] = createSignal(initial);
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
 * The props object handed to a render-prop occurrence. Plain values read
 * straight through (and stay reactive over `args` for live updates); an
 * async value reads through a lazily-created async memo, so the prop read
 * follows the normal async read path — it suspends into the reading
 * component's nearest `Loading` (the reveal seam's reconstructed boundary
 * when the fill has none of its own) and settles to the value when the
 * server's data chunk lands. Memos are created under the occurrence's owner
 * (not the reader's), so they live as long as the occurrence: a read from a
 * later effect or event handler reuses the same source.
 */
function slotArgsProxy(args: () => Record<string, any>) {
  const owner = getOwner();
  const asyncReads = new Map<PropertyKey, () => any>();
  return new Proxy(
    {},
    {
      get: (_, key) => {
        const v = (args() as any)[key];
        if (!isAsyncValue(v)) return v;
        let read = asyncReads.get(key);
        if (!read) {
          const make = () => createMemo(() => (args() as any)[key]);
          read = owner ? runWithOwner(owner, make)! : make();
          asyncReads.set(key, read);
        }
        return read();
      },
      has: (_, key) => key in args(),
      ownKeys: () => Reflect.ownKeys(args()),
      getOwnPropertyDescriptor: (_, key) =>
        key in args() ? { enumerable: true, configurable: true } : undefined
    }
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

function slotsFor(props: Record<string, any>) {
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
              return v(
                ctx.onUpdate ? liveSlotProps(slotProps, ctx) : slotArgsProxy(() => slotProps)
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
                adopted ? claimRender(prefix, ctx.existing, evaluate) : evaluate()
              )
            : adopted
              ? claimRender(prefix, ctx.existing, evaluate)
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
            runWithOwner(owner, () => (adopted ? claimRender(prefix, ctx.existing, bind) : bind()));
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

/**
 * Follow a live address binding (the identity split's delivery path): a
 * `dynamic` site whose call switched arguments keeps this instance and
 * pushes the new address through the accessor — the frame re-binds its pull
 * to the new address's resident store (warm content re-materializes
 * instantly; an in-flight stream morphs in; slot occurrences whose ids
 * persist keep their client state). `rebind` no-ops on the same address.
 */
function followBinding(frame: { rebind(id: string): void }, binding: () => string) {
  createRenderEffect(binding, address => frame.rebind(address));
}

function boundaryComponent(host: any, fnId: string) {
  return (props: Record<string, any>, binding?: () => string) => {
    // Element-claim sweeps (router link-state contract) run under this
    // boundary's owner: consumers' per-element onCleanup disposes with the
    // boundary, and streamed chunks — applied from microtasks with no owner
    // of their own — still claim with the right lifetime.
    const owner = getOwner();
    // Shell gate: a fresh mount's covering <Loading> must stay open until the
    // frame's FIRST content applies. The binding resolves at response-header
    // time while content streams in behind it — ungated, the boundary
    // resolves over an empty <dx-frame> (a flash), and it has LATCHED by the
    // time the shell's fills run, orphaning any pending async slot-arg read
    // (with no reveal seam to reconstruct, the mount's own boundary is the
    // covering one). Ordering makes the handoff seamless: the frame notifies
    // BEFORE it syncs slots, and the release only lands a microtask later —
    // by then the fills' pending reads hold the queue open.
    //
    // Only mounts a stream has BEGUN for gate (the transport rotates the
    // address's data table before the binding resolves, so a call-driven
    // mount always has one). A placeholder mount with no call in flight —
    // the exhausted late-boundary waiter, a client-only boot — must render
    // its empty frame NOW, ready for the stream a future call fills it with:
    // nothing is coming to release a gate.
    const id = binding ? binding() : fnId;
    let applied = !tables.has(id);
    let release!: () => void;
    const firstApply = new Promise<void>(r => (release = r));
    // The boundary is a DOM element (`<dx-frame>`), not a branded value:
    // `insert` places it natively in any position (array/fragment/single —
    // no #550), and the frame mounts INTO it. Return the element itself.
    const { element, frame, dispose } = createFrameElement({
      host,
      // The mount binds the ADDRESS's store (content is keyed by call, the
      // mount by site); an unbound render (no gated reader, e.g. a direct
      // placeholder mount) binds the function id — the argless address.
      id,
      slots: slotsFor(props),
      ownerScope: boundaryScope(owner),
      reveal: revealSeam(owner),
      // Any apply releases the gate — content ("materialize") is the normal
      // path; an error record must release too (surfacing the frame's error
      // state beats holding a fallback forever). The error reason requires
      // the runtime's error-apply notification; on runtimes without it a
      // failed stream holds the fallback.
      onApply: () => {
        applied = true;
        release();
      }
    });
    if (binding) followBinding(frame, binding);
    onCleanup(dispose);
    // A warm mount (resident store, registration flushed synchronously) has
    // its content before we return: no gate, no fallback flicker.
    if (applied) return element as unknown as SolidElement;
    const gate = createMemo(() => firstApply);
    return createMemo(() => (gate(), element)) as unknown as SolidElement;
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

// One document query indexes the SSR'd frame ELEMENTS by id; the intercept and
// adoption paths become map lookups. Boundaries are static document output
// carried as `<dx-frame data-fid>` elements — a single attribute query, no
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
  root.querySelectorAll(`[${FRAME_ID_ATTR}]`).forEach(el => {
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

// Boundaries whose element has not been delivered yet, waiting on the reveal
// that carries it. One waiter per id: a second mount while the first is still
// waiting takes the fresh-frame path, since only one frame may adopt an
// element.
const boundaryWaiters = new Map<string, (el?: Element) => void>();

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
 * Subscribe to the fragment ledger to learn when a late boundary lands.
 *
 * The ledger notifies on every fragment reveal — the only moment a boundary
 * element can enter the page after the initial parse — with the revealed
 * fragment's parent, and on truncation (no parent) so waiters the page can
 * no longer answer re-evaluate. Scoping the rescan to the revealed
 * fragment's parent (rather than the document) keeps this proportional to
 * what just arrived.
 */
function installRevealHook() {
  const hy = (globalThis as any)._$HY;
  if (!hy || hy.$sc || !hy.fr) return;
  hy.$sc = true;
  hy.fr.subscribe((_id: string, parent?: ParentNode) => {
    // Nothing has looked a boundary up yet, so there is nothing to keep
    // current — the first lookup scans the document as it stands then.
    if (!boundaryIndex) return;
    const root = parent || (typeof document !== "undefined" ? document.body : null);
    if (root) indexBoundaries(root);
    if (!boundaryWaiters.size) return;
    // A waiter the page can no longer answer must not wait forever: once the
    // document is done and no fragment is left outstanding (truncated ones
    // included), nothing else can deliver this element, so release the
    // waiter to mount fresh (the client-only shape) instead of holding the
    // fallback on screen.
    const exhausted = hy.done && !hy.fr.pending();
    for (const [id, notify] of boundaryWaiters) {
      const el = boundaryIndex && boundaryIndex.get(id);
      if (!el && !exhausted) continue;
      boundaryWaiters.delete(id);
      notify(el);
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
  if (!claimed && !boundaryWaiters.has(id) && boundaryMayArrive()) {
    const owner = getOwner();
    const arrival = new Promise<Element | undefined>(resolve => boundaryWaiters.set(id, resolve));
    onCleanup(() => boundaryWaiters.delete(id));
    return createMemo(() =>
      arrival.then(node =>
        runWithOwner(owner, () =>
          // No element after all (the page ran out of reveals): mount fresh,
          // exactly as an unwaited miss would have.
          node
            ? adoptBoundary(host, id, node, props, binding)
            : boundaryComponent(host, id)(props, binding)
        )
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
  const address = binding ? binding() : documentAddress(id);
  // Occlusion records (case 3, document face): content a client wrapper
  // never rendered during SSR shipped ONCE as hydration data instead of
  // markup. Apply the records BEFORE binding the frame — the host buffers
  // them per id and drains at registration, so the first slot sync claims
  // WITH real args and the wrapper can render the occluded region later
  // from the frame store. Re-drainable (each key applies once): nothing on
  // the wire formally orders a record's data script before the event that
  // triggers adoption, so the frame re-drains before classifying a
  // recordless occurrence it deferred (#2968 — the frame's recordsPending/
  // drainRecords seam below).
  const appliedRecords = new Set<string>();
  const drainRecords = () => {
    const hy = (globalThis as any)._$HY;
    if (!hy || !hy.r) return;
    const slotPrefix = `sc:slot:${id}:`;
    for (const key of Object.keys(hy.r)) {
      if (appliedRecords.has(key)) continue;
      if (key.startsWith(slotPrefix)) {
        appliedRecords.add(key);
        // Slot records land in the ADDRESS's store (where the frame binds);
        // the wire keys them by function id, the document's producer name.
        host.apply({
          type: "slot",
          id: address,
          version: 0,
          key: key.slice(slotPrefix.length),
          args: hy.r[key]
        });
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
  drainRecords();
  // ownerScope: element-claim sweeps — both the adoption sweep over the
  // SSR'd element (whose anchors never ran compiled creation) and later
  // streamed morphs — bind consumer cleanup to this boundary's owner (see
  // boundaryScope for the ambient-preserving rule).
  const owner = getOwner();
  const frame = createFrame(el, {
    adopt: true,
    host,
    id: address,
    slots: slotsFor(props),
    ownerScope: boundaryScope(owner),
    reveal: revealSeam(owner),
    // May the document still run scripts that assign records? While the
    // parser is running the answer is yes, and a held fragment's replay can
    // still deliver one — so a recordless occurrence defers instead of
    // misclassifying as content (the runtime re-checks until this flips
    // false). Deliberately NOT boundaryMayArrive(): its `!_$HY.done` term
    // answers a different question (can this boundary's ELEMENT still
    // appear), and holding classification until client hydration completes
    // pushes the adopted mount past the hydrate window — the claim then
    // adopts markup the client's state has already moved past (the
    // adopted-slot-live spec pins the working ordering).
    // Spread-cast: the published FrameOptions predates this seam; a runtime
    // without it simply never calls the hooks (drop once the pin catches up).
    ...({
      recordsPending: () => {
        if (document.readyState === "loading") return true;
        const hy = (globalThis as any)._$HY;
        return !!(hy && hy.fr && hy.fr.pending());
      },
      drainRecords,
      // The identity split binds the frame to the call ADDRESS (id + args
      // hash), but the document producer stamped `_hk` keys and region fids
      // under the wire name — the bare function id. Hydration-claim prefixes
      // must derive from what the producer wrote, so thread the wire id down
      // as the claim scope; without it every adopted claim misses and the
      // occurrence re-renders fresh clones that cannibalize the server DOM.
      claimScope: id
    } as {})
  });
  if (binding) followBinding(frame, binding);
  onCleanup(() => frame.dispose());
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
    g._$SC = {
      c: {},
      a: {},
      r(i: string, a?: string) {
        if (a) {
          g._$SC.a[a] = i;
          g._$SC.reg && g._$SC.reg(a, i);
        }
        return g._$SC.c[i] || (g._$SC.c[i] = (p: any, b?: () => string) => g._$SC.impl(i, p, b));
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
    onStream: (address: string) => beginStream(address),
    // The page IS the t=0 record: a call whose function has an unclaimed
    // SSR'd boundary in the document is answered locally — the source
    // re-runs during hydration per dynamic's contract, but no request
    // leaves the browser. The boundary is consumed on adoption, so
    // navigations fetch normally.
    intercept: ({ id }: { id: string }) => {
      if (claimedBoundaries.has(id) || !findBoundaryElement(id)) return undefined;
      return g._$SC.r(id);
    }
    // Single-flight delivery (the transport's `consumer`/`codec` defaults)
    // reads the server-function client's SHARED built instance: this
    // bundle resolves the transport's wire-layer imports to that external
    // entry (externalizeSharedTransport in rollup.config.js), so no getter
    // overrides are needed.
  });
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
  configureServerFunctionsClient({ responseHandler: handler });
}
