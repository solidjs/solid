// @solidjs/web/frames — client half. Consume frame streams into live DOM
// boundaries (resident store, policy-A morphs, client-owned slot ranges).
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
// The one import that must resolve to the SHARED built instance, not a
// bundled copy: configuring the server-function client only counts if it's
// the same module the compiled reference proxies call through
// (`@solidjs/web/server-functions` resolves to this file in the browser).
// A private copy breaks instance identity — and, because this entry never
// calls that copy's readers, rollup would tree-shake the whole
// `configureServerFunctionsClient` call out of the dist as unobservable.
// Kept external in rollup.config.js for the same reason.
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
export { createJSONDataTable } from "@dom-expressions/runtime/src/serializer.js";

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
 * whose id chain reproduces the document producer's keys. No nodes in the
 * range → plain client render (CSR boot, post-load streams).
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

function claimRender(prefix: string, existing: Node[], render: () => any) {
  const sc: any = sharedConfig;
  if (!sc.getNextContextId) return render();
  const registry = new Map<string, Element>();
  for (const n of existing) {
    if (n.nodeType !== 1) continue;
    gatherClaims(n as Element, registry);
  }
  if (!registry.size) return render();
  const prevRegistry = sc.registry;
  const prevHydrating = sc.hydrating;
  sc.registry = registry;
  sc.hydrating = true;
  try {
    return runWithOwner(createOwner({ id: prefix }), render);
  } finally {
    sc.registry = prevRegistry;
    sc.hydrating = prevHydrating;
  }
}

function slotsFor(props: Record<string, any>) {
  return new Proxy(
    {},
    {
      get(_, prop) {
        if (typeof prop !== "string" || !(prop in props)) return undefined;
        return (slotProps: any, ctx: any) => {
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
          // The prop is read INSIDE the render: compiled component props are
          // getters, so JSX evaluates lazily at access — deferring the access
          // into the scoped owner is what makes plain JSX (no thunks) get the
          // producer's hydration keys.
          const render = () => {
            const v = props[prop];
            return settle(normalizeSlotContent(typeof v === "function" ? v(slotProps) : v));
          };
          if (ctx && ctx.frame && ctx.adopted && ctx.existing && ctx.existing.length) {
            // The claim: re-render this occurrence under the SAME
            // hydration-key owner scope the document producer used —
            // solid's registry hands the render its server-rendered nodes
            // by key, so the SSR'd wrapper (interior included) becomes the
            // live component's DOM. Templates never ship as data; the
            // claim IS the transfer. Adoption mounts a microtask after the
            // hydrate window closes, so this is a scoped RE-ENTRY (the
            // late-boundary-resume pattern): a registry gathered from the
            // range, swapped in for the synchronous render.
            //
            // ONLY for ctx.adopted (the hydration-attach sync): a
            // stream-driven re-call with existing nodes must render for
            // real — claiming would no-op its inserts and silently drop
            // whatever the re-call displaced, e.g. moved-out {$frame}
            // region ranges (#547).
            return claimRender(`sc-${ctx.frame}-${ctx.key}-`, ctx.existing, render);
          }
          return render();
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

function boundaryComponent(host: any, id: string) {
  return (props: Record<string, any>) => {
    // Element-claim sweeps (router link-state contract) run under this
    // boundary's owner: consumers' per-element onCleanup disposes with the
    // boundary, and streamed chunks — applied from microtasks with no owner
    // of their own — still claim with the right lifetime.
    const owner = getOwner();
    // The boundary is a DOM element (`<dx-frame>`), not a branded value:
    // `insert` places it natively in any position (array/fragment/single —
    // no #550), and the frame mounts INTO it. Return the element itself.
    const { element, dispose } = createFrameElement({
      host,
      id,
      slots: slotsFor(props),
      ownerScope: (fn: () => any) => runWithOwner(owner, fn),
      reveal: revealSeam(owner)
    });
    onCleanup(dispose);
    return element as unknown as SolidElement;
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
const boundaryWaiters = new Map<string, (el: Element) => void>();

/** Whether the document may still deliver boundary elements. */
function documentStreaming() {
  const hy = (globalThis as any)._$HY;
  return !!hy && !hy.done;
}

/**
 * Subscribe to fragment reveals to learn when a late boundary lands.
 *
 * `_$HY.fe(fragmentId, parent)` is called by the streaming layer's `$df`
 * immediately after it swaps a settled fragment's content into the live
 * document — the only moment a boundary element can enter the page after the
 * initial parse. It is a shared notification rather than our slot, so
 * whatever was installed stays installed.
 *
 * Scoping the rescan to the revealed fragment's parent (rather than the
 * document) keeps this proportional to what just arrived; older producers
 * that pass no parent fall back to the body.
 */
function installRevealHook() {
  const hy = (globalThis as any)._$HY;
  if (!hy || hy.$sc) return;
  hy.$sc = true;
  const prev = hy.fe;
  hy.fe = (fragmentId: string, parent?: ParentNode) => {
    if (prev) prev(fragmentId, parent);
    // Nothing has looked a boundary up yet, so there is nothing to keep
    // current — the first lookup scans the document as it stands then.
    if (!boundaryIndex) return;
    const root = parent || (typeof document !== "undefined" ? document.body : null);
    if (!root) return;
    indexBoundaries(root);
    for (const [id, notify] of boundaryWaiters) {
      const el = boundaryIndex.get(id);
      if (!el) continue;
      boundaryWaiters.delete(id);
      notify(el);
    }
  };
}

function documentBoundary(host: any, id: string, props: Record<string, any>) {
  const claimed = claimedBoundaries.has(id);
  const el = !claimed ? findBoundaryElement(id) : undefined;
  if (el) return adoptBoundary(host, id, el, props);
  // Not in the page (yet). While the document is still streaming, this is a
  // boundary whose content settled after the shell flush: its markup is on the
  // way and will be swapped over the fallback that is on screen right now.
  // Mounting a fresh frame here is unrecoverable — the markup arrives owned by
  // nothing (visible but inert) while the stream drives an element outside the
  // page, so the boundary never updates again. Suspend instead and adopt on
  // delivery; the enclosing <Loading> goes on showing the server's fallback,
  // which is exactly what the document is displaying.
  if (!claimed && !boundaryWaiters.has(id) && documentStreaming()) {
    const owner = getOwner();
    const arrival = new Promise<Element>(resolve => boundaryWaiters.set(id, resolve));
    onCleanup(() => boundaryWaiters.delete(id));
    return createMemo(() =>
      arrival.then(node => runWithOwner(owner, () => adoptBoundary(host, id, node, props)))
    ) as unknown as SolidElement;
  }
  // No SSR'd boundary on the page (client-only boot, or already claimed):
  // mount fresh — the pending/late stream fills it exactly like the
  // non-document path.
  return boundaryComponent(host, id)(props);
}

function adoptBoundary(host: any, id: string, el: Element, props: Record<string, any>) {
  claimedBoundaries.add(id);
  // Occlusion records (case 3, document face): content a client wrapper
  // never rendered during SSR shipped ONCE as hydration data instead of
  // markup. Apply the records BEFORE binding the frame — the host buffers
  // them per id and drains at registration, so the first slot sync claims
  // WITH real args and the wrapper can render the occluded region later
  // from the frame store.
  const hy = (globalThis as any)._$HY;
  if (hy && hy.r) {
    const slotPrefix = `sc:slot:${id}:`;
    for (const key of Object.keys(hy.r)) {
      if (key.startsWith(slotPrefix)) {
        host.apply({
          type: "slot",
          id,
          version: 0,
          key: key.slice(slotPrefix.length),
          args: hy.r[key]
        });
      } else if (key.startsWith("sc:region:")) {
        const childId = key.slice("sc:region:".length);
        if (childId.startsWith(id + ".")) {
          // Async-occluded regions arrive as promises (the producer held
          // the stream on them); the host buffers per id either way, so a
          // late apply still lands before the region binds on expand.
          const val = hy.r[key];
          const apply = (html: any) => host.apply({ type: "html", id: childId, version: 0, html });
          val && typeof val.then === "function" ? val.then(apply) : apply(val);
        }
      }
    }
  }
  // ownerScope: element-claim sweeps — both the adoption sweep over the
  // SSR'd element (whose anchors never ran compiled creation) and later
  // streamed morphs — bind consumer cleanup to this boundary's owner.
  const owner = getOwner();
  const frame = createFrame(el, {
    adopt: true,
    host,
    id,
    slots: slotsFor(props),
    ownerScope: (fn: () => any) => runWithOwner(owner, fn),
    reveal: revealSeam(owner)
  });
  onCleanup(() => frame.dispose());
  // The boundary IS the element — hand hydration the single SSR'd node so it
  // claims it in place rather than re-rendering.
  return el as unknown as SolidElement;
}

/**
 * Installs the server-component transport policy on the server-function
 * client: boundary identity derives from the reactive owner captured at
 * each call site (`getOwner`), so distinct `dynamic()` sources get
 * independent boundaries with nothing declared, refetches from the same
 * source resolve to the identical component, and ownerless calls fall back
 * to one boundary per function id.
 *
 * Call once in the client entry (an explicit call — the package is
 * `sideEffects: false`, so a bare import would be tree-shaken away);
 * call again to rebind to a custom host.
 */
export function installServerComponents(host: any = getFrameHost()) {
  // Upgrade the document shell's placeholder bootstrap (if present): the
  // hydration data scripts resolved server-component references to stable
  // per-id placeholders; installing `impl` makes them mount-adopting.
  const g = globalThis as any;
  if (!g._$SC) {
    g._$SC = {
      c: {},
      r(i: string) {
        return g._$SC.c[i] || (g._$SC.c[i] = (p: any) => g._$SC.impl(i, p));
      }
    };
  }
  g._$SC.impl = (id: string, props: any) => documentBoundary(host, id, props);
  // Late boundaries arrive with the reveals, so subscribe before the first one
  // can land (this runs from the client entry, during document parse).
  installRevealHook();
  configureServerFunctionsClient({
    responseHandler: createServerComponentHandler({
      host,
      capture: () => getOwner() ?? undefined,
      component: (frameId: string) => boundaryComponent(host, frameId),
      onStream: (frameId: string) => beginStream(frameId),
      documentComponent: (functionId: string) => g._$SC.c[functionId],
      // The page IS the t=0 record: a call whose function has an unclaimed
      // SSR'd boundary in the document resolves locally with the stable
      // placeholder — the source re-runs during hydration per dynamic's
      // contract, but no request leaves the browser. The boundary is
      // consumed on adoption, so navigations fetch normally and (via
      // documentComponent above) resolve to the SAME placeholder.
      intercept: ({ id }: { id: string }) => {
        if (claimedBoundaries.has(id) || !findBoundaryElement(id)) return undefined;
        return g._$SC.r(id);
      }
    })
  });
}
