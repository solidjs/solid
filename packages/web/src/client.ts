// @ts-nocheck
// The client runtime's core: render / hydrate, the template and hydration-walk
// helpers, element claims, delegated-event dispatch, the asset and head
// registries. Two halves live in their own modules so a bundler can place
// them by importer rather than by file: the children runtime
// (client/insert.ts — `insert`, and the one-shot `insertExpression` the
// attribute runtime writes children through) and the attribute runtime
// (client/attributes.ts — `assign`, `spread`, the per-prop writers). This
// module imports from the former and never from the latter.
import { EVENT_KEY, $$SLOT, $$HOST } from "./constants.js";
import {
  getOwner,
  runWithOwner,
  createComponent,
  createOwner,
  createRoot as root,
  onCleanup,
  untrack,
  merge as mergeProps,
  flatten,
  createMemo,
  flush,
  enableHydration,
  enforceLoadingBoundary,
  resetErrorHalt,
  ROOT_ERROR_HOOK
} from "solid-js";
import type { ClientErrorHook } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { effect, memo, tagElement, dispatchAsInteraction } from "./render.js";
import {
  insert,
  installHydrationRuntime,
  isHydrating,
  hydrationRt,
  noteHydrationKeyMiss
} from "./client/insert.js";

import { JSX } from "../jsx/jsx.js";

import type { RequestEventLocals, HydrationWriter, HydrationValue } from "./server.js";
import type { TraceContext } from "./trace.js";

type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;

/**
 * A head tag descriptor. Props values may be getters (reactive on the
 * client); `children` is the text body. `key` overrides the built-in dedupe
 * identity (`title` is a hard singleton that `key` cannot fork).
 *
 * Getters must be plain reads: they evaluate inside registry-owned
 * computations here and at flush time on the server, so a getter that
 * allocates a reactive owner (`createMemo`, a `children()` helper) consumes
 * a hydration id slot on one side only and desyncs every id allocated after
 * the `useHead` call. Create such helpers eagerly at component position and
 * read them from the getter. See docs/head-management-rfc.md.
 */
export type HeadTag = {
  tag: "title" | "meta" | "link" | "style" | "script" | "base";
  props: Record<string, any>;
  key?: string | (() => string);
};

export type AssetDescriptor =
  | { type: "style"; href: string; attrs?: Record<string, string> }
  | { type: "inline-style"; id: string; content?: string; attrs?: Record<string, string> }
  | { type: "module"; href: string }
  | ExclusiveAssetDescriptor<any>;

export interface ExclusiveAssetDescriptor<T> {
  policy: "exclusive";
  key: string;
  value: T;
  get(): T;
  set(value: T): void;
}

/**
 * Registry entry returned by `warmAsset`. Stylesheet entries carry load
 * tracking for the client reveal gate (docs/client-css-reveal-gating.md):
 * `loadPromise` resolves on load OR error (never rejects) — an errored
 * sheet releases the gate, parity with the server gate.
 */
export interface AssetEntry {
  loadState?: "pending" | "loaded" | "errored";
  loadPromise?: Promise<void>;
}

/**
 * See the server entry's `ResponseStub` — the shape of the mutable response
 * head integrations expose as `event.response` via module augmentation.
 */
export interface ResponseStub {
  status?: number;
  statusText?: string;
  headers: Headers;
  /**
   * Set by the integration once the response head has been derived/sent
   * from this stub (status/headers can no longer change); consumers must
   * treat later writes and cleanup-time retractions as no-ops.
   */
  committed?: boolean;
}

/**
 * See the server entry's `RequestEventLocals` — the augmentable type of
 * `RequestEvent.locals`. Re-exported (not re-declared) so both entries
 * share ONE interface identity and a single augmentation reaches every
 * `locals`, whichever entry typed the event.
 */
export type { RequestEventLocals } from "./server.js";
export type { HydrationWriter, HydrationValue } from "./server.js";

export interface RequestEvent {
  request: Request;
  locals: RequestEventLocals;
}

export type { CookieOptions } from "./cookies.js";

// This runtime's records on `OBSERVE.records` (`"invocation"`, `"render"`,
// `"call"`, `"request"`, `"frame"`), and with them the `HostRecordTypes`
// augmentation that module declares: the published types resolve to this
// entry under every condition, so this re-export is what puts the
// augmentation in a consumer's program.
export type {
  CallEvent,
  CallListener,
  CallLive,
  CallRequestEvent,
  CallRequestListener,
  FrameAppliedEvent,
  FrameEvent,
  FrameListener,
  FrameLive,
  FrameProducedEvent,
  InvocationEvent,
  InvocationListener,
  InvocationLive,
  RenderEvent,
  RenderListener,
  RenderLive,
  RenderRoute
} from "./observe.js";
// The trace context's types (`getTraceContext()`, `OBSERVE.server.trace`),
// with the `ServerObserve.trace` augmentation, for the same reason.
export type { TraceContext, TraceProvider } from "./trace.js";

export type {
  ServerFunction,
  ServerFunctionMetadata,
  ServerFunctionRPC
} from "../server-functions/src/shared.js";

// Optional seam (docs/client-css-reveal-gating.md): throws the core's
// NotReadyError bound to the promise while it is unsettled so tracked
// contexts (transitions, boundary reveals) hold and retry on settle;
// no-op once settled.
const assetGates = new WeakMap();
export const waitAsset = (promise: Promise<unknown>): void => {
  let gate = assetGates.get(promise);
  if (!gate) {
    runWithOwner(null, () => {
      // NOT sync: the node must be async-aware (the promise is the value
      // being awaited; sync nodes reject thenable returns). Transparent: the
      // hydrating memo wrapper would otherwise peek an id off the null owner.
      gate = createMemo(() => promise, { transparent: true });
    });
    assetGates.set(promise, gate);
  }
  gate();
};

import {
  HEAD_ELIGIBLE_TAGS,
  HEAD_ATTR_NAME,
  classifyHeadTag,
  evalHeadProps,
  evalHeadValue,
  resourceIdentity,
  replaceableIdentity,
  resolveHead,
  RESOURCE_QUALIFIERS,
  qualifierValue,
  STYLESHEET_FETCH_META
} from "./head.js";
import { devCheck } from "./diagnostics.js";
export {
  DOMElements,
  SVGElements,
  MathMLElements,
  VoidElements,
  RawTextElements
} from "./constants.js";

// === Delegated-event wire contract ===
//
// Everything below is read off the DOM and the event object by whichever
// Solid runtime happens to be listening, so it is shared state between every
// Solid copy on a page: two bundles of the same major nested in each other,
// or a future major nested in this one. It is frozen. Changing any of it
// means choosing a new EVENT_KEY prefix (constants.ts; `addEvent` in
// client/attributes.ts writes under it) so the runtimes stop seeing each
// other's handlers, not a new shape under the old one.
//
// - `node[EVENT_KEY + type]` is the delegated handler: a function or an
//   object with `handleEvent`. `node[EVENT_KEY + type + "Data"]` is the
//   optional bound data; when defined the handler is called `(data, e)`,
//   otherwise `(e)`. Skipped while `node.disabled`.
// - `e[$$EVENT_OWNER]` marks an event a root has already walked: the owner
//   node, or `true` for an unscoped container. A listener that sees a mark
//   skips unless the mark is a descendant of its own container, in which
//   case it resumes from the marked node's parent.
// - The walk climbs `_$host || parentNode || host`, stops on `cancelBubble`,
//   and stops at the listener's own boundary or its direct child.
//
// v1 (`solid-js@1`) used `$$` + type for the key and delegated from
// `document`, so its listener saw every element on the page and fired any
// matching key it found. The prefix here is deliberately not `$$` so a v1
// copy on the same page (an older widget, a devtools panel) cannot find
// these handlers, and this runtime cannot find v1's.
const $$EVENT_OWNER = "_$SOLID_EVENT_OWNER";
const delegatedEvents = new Set();
const delegatedContainers = new Map();

function voidFn() {}

/** Client stub — hydration bootstrap is a server-only emit. */
export function generateHydrationScript(_options?: {
  eventNames?: string[];
  nonce?: string;
}): string {
  return "";
}

/** Client stub — valid JSX component, renders nothing. */
export function HydrationScript(_props?: { nonce?: string; eventNames?: string[] }): null {
  return null;
}

export { effect, memo, untrack, getOwner, createComponent };
/**
 * Compiler-emitted prop-spread helper. The JSX transform emits
 * `mergeProps(...)` when compiling prop spreads on components — not a
 * user-facing API. Application code should import `merge` from `solid-js`.
 * @internal
 */
export { mergeProps };
export const getRequestEvent: () => RequestEvent | undefined = voidFn;
/** Client stub — values are written by the server render. See the server entry. */
export const getHydrationWriter: () => HydrationWriter | undefined = voidFn;

/**
 * Removes and returns the value the server render wrote under `key` with
 * `getHydrationWriter().write(key, value)`, or `undefined` when the page
 * carries none (or it was already taken). A written promise arrives as
 * `"pending"` until its settlement streams in, then as `"resolved"` or
 * `"rejected"`. Readable before `hydrate()` runs and after hydration has
 * ended. Server: `undefined`.
 *
 * The page's values live on `globalThis._$HY.r`; a test seeds them with
 * `globalThis._$HY = { r: { "sq:key": value } }`.
 */
export function takeHydrationValue<T = unknown>(key: string): HydrationValue<T> | undefined;

export function takeHydrationValue(key) {
  const registry = globalThis._$HY && globalThis._$HY.r;
  if (!registry || !(key in registry)) return;
  const v = registry[key];
  delete registry[key];
  if (v !== null && typeof v === "object" && typeof v.then === "function") {
    // Settled serialized promises are stamped `s`/`v` (see solid-js's
    // readHydratedValue).
    if (v.s === 1) return { status: "resolved", value: v.v };
    if (v.s === 2) {
      // The stamp is the consumption: observe the promise's own rejection.
      v.then(undefined, voidFn);
      return { status: "rejected", error: v.v };
    }
    return { status: "pending", promise: v };
  }
  return { status: "resolved", value: v };
}
/**
 * Client stub — the trace a request belongs to is a server-side reading
 * (the incoming `traceparent`, the render's origination); the browser SDK
 * that continues it reads the document's `<meta>`/`Server-Timing` instead.
 */
export const getTraceContext: () => TraceContext | undefined = voidFn;

// The cookie codec (the platform-gap primitives — see cookies.js): the
// REAL implementation, not a stub — a pure value transformer has
// legitimate browser uses (`document.cookie`), and a no-op returning fake
// values would be silent garbage. Nothing in the client runtime imports
// it, so it costs a bundle exactly what user code asks for and
// tree-shakes away otherwise (guarded in scripts/size-guard.mjs).
export { parseCookieHeader, serializeCookie } from "./cookies.js";
// The flash cookie's isomorphic half (name/detection/clearing — cookie
// utilities, see cookies.js) and the codec-free server-function layer
// (detection + the late-bound RPC seam, see server-functions/registry.js).
// Exported from the CORE entries so integrations consuming them eagerly
// (routers) never import the server-functions entry — whose client half is
// the transport + codec — from their eager graph. Everything here is a few
// lines over registered symbols; the transport tree-shakes away with the
// references that would register it (guarded in scripts/size-guard.mjs).
export { clearFlashCookie, hasFlashCookie } from "./cookies.js";
export {
  getServerFunctionMetadata,
  getServerFunctionRPC,
  isServerFunction
} from "../server-functions/src/registry.js";

/**
 * Renders a component tree into a DOM element. Returns a dispose function
 * that tears the tree down and cleans up reactive scopes when called.
 *
 * The top-level insert is queued via `{ schedule: true }` so its initial
 * DOM attach goes through the effect queue rather than executing inline.
 * This lets the mount participate in transitions: if an uncaught async
 * read surfaces during the initial render (no `Loading` ancestor absorbs
 * it), the mount is held by the transition and attaches atomically once
 * all pending settles. On the no-async happy path the tail `flush()`
 * drains the queued callback so the attach is synchronous by the time
 * `render()` returns. The dev enforcement window scopes
 * `ASYNC_OUTSIDE_LOADING_BOUNDARY` to the initial mount only.
 */
export function render(
  code: () => JSX.Element,
  element: MountableElement,
  init?: JSX.Element,
  options?: {
    owner?: unknown;
    renderId?: string;
    /**
     * This root's client error hook, ahead of `configureClientErrors`':
     * every failure an error boundary under it renders a fallback for —
     * the one event no global handler sees (an uncaught error halts the
     * reactive system and reaches `reportError` / `window.onerror`). Once
     * per error object; no return — the client has no wire to map for.
     */
    onError?: ClientErrorHook;
  }
): () => void;

export function render(code, element, init, options = {}) {
  if ("_SOLID_DEV_" && !element) {
    throw new Error(
      "The `element` passed to `render(..., element)` doesn't exist. Make sure `element` exists in the document."
    );
  }
  // A fresh mount is a new app instance: revive scheduling if an earlier
  // uncaught error halted the reactive system (REACTIVITY_HALTED). Dev-only —
  // playgrounds and HMR re-render into the same runtime without a page
  // reload; in production a halt stays a hard crash.
  if ("_SOLID_DEV_") resetErrorHalt();
  if ("_SOLID_DEV_") enforceLoadingBoundary(true);
  let disposer;
  registerDelegatedRoot(element);
  try {
    root(
      dispose => {
        disposer = dispose;
        // Parked on the root owner under the registered key: the hook
        // machinery is retained only by a boundary or the app's own
        // `configureClientErrors` import (see signals' error-hooks).
        if (options.onError) getOwner()[ROOT_ERROR_HOOK] = options.onError;
        if (element === document) {
          const tree = code();
          effect(
            () => flatten(tree),
            () => {}
          );
        } else {
          const tree = code();
          insert(element, () => tree, element.firstChild ? null : undefined, init, {
            ...options.insertOptions,
            schedule: true
          });
        }
      },
      { id: options.renderId }
    );
    flush();
  } catch (err) {
    if (disposer) disposer();
    unregisterDelegatedRoot(element);
    throw err;
  } finally {
    if ("_SOLID_DEV_") enforceLoadingBoundary(false);
  }
  return () => {
    disposer();
    unregisterDelegatedRoot(element);
    element.textContent = "";
  };
}

function create(html, bypassGuard, flag) {
  if ("_SOLID_DEV_" && isHydrating() && !bypassGuard)
    throw new Error(
      "Failed attempt to create new DOM elements during hydration. Check that the libraries you are using support hydration."
    );
  // A document shell cannot be client-created: `<template>` contents parsing
  // ignores `<html>`/`<head>`/`<body>` start tags, so the markup would be
  // silently flattened and the emitted walk would bind the wrong nodes. The
  // validator deliberately accepts well-formed shells (#3259) because they
  // are legitimate under hydration — the failure belongs here, at the actual
  // broken act, not on every module that imports the component.
  if ("_SOLID_DEV_" && /^<(html|head|body)[\s>]/i.test(html))
    throw new Error(
      "Document shell templates (<html>, <head>, <body>) cannot be client-created: " +
        "a <template> parse strips those tags. Render this component through hydrate(), " +
        "where the document shell already exists."
    );
  const t = document.createElement("template");
  t.innerHTML = html;
  return flag === 2 ? t.content.firstChild.firstChild : t.content.firstChild;
} /**
 * Compiler-emitted primitive; not for hand-written code.
 * @param flag
 * - `undefined` — clone the template as-is (uses `cloneNode`).
 * - `1` — use `document.importNode` instead of `cloneNode`.
 * - `2` — the template html is wrapped; the outer tag is stripped at clone time.
 * @internal
 */
export function template(html: string, flag?: 1 | 2): () => Element;

export function template(html, flag) {
  let node;
  const fn =
    flag === 1
      ? bypassGuard => document.importNode(node || (node = create(html, bypassGuard, flag)), true)
      : bypassGuard => (node || (node = create(html, bypassGuard, flag))).cloneNode(true);

  if ("_SOLID_DEV_") fn._html = flag === 2 ? html.replace(/^<[^>]+>/, "") : html;
  return fn;
} /** Compiler-emitted primitive; not for hand-written code. @internal */
export function delegateEvents(eventNames: string[]): void;

export function delegateEvents(eventNames) {
  for (let i = 0, l = eventNames.length; i < l; i++) {
    const name = eventNames[i];
    if (!delegatedEvents.has(name)) {
      delegatedEvents.add(name);
      delegatedContainers.forEach((state, container) =>
        attachDelegatedEvent(name, container, state)
      );
    }
  }
} /** Event-delegation plumbing (Portal/custom-root wiring). Integration plumbing. @internal */
export function registerDelegatedRoot(root: MountableElement): void;

export function registerDelegatedRoot(root) {
  const state = registerDelegatedContainer(root, root);
  if (state) state.roots = (state.roots || 0) + 1;
} /** Event-delegation plumbing (Portal/custom-root wiring). Integration plumbing. @internal */
export function unregisterDelegatedRoot(root: MountableElement): void;

export function unregisterDelegatedRoot(root) {
  const state = delegatedContainers.get(root);
  if (state) state.roots > 1 ? state.roots-- : delete state.roots;
  unregisterDelegatedContainer(root, root);
} /** Event-delegation plumbing (Portal/custom-root wiring). Integration plumbing. @internal */
export function registerDelegatedContainer(
  container: MountableElement,
  owner?: MountableElement
): void;

export function registerDelegatedContainer(container, owner = container) {
  if (!container || !owner) return;
  let state = delegatedContainers.get(container);
  if (!state)
    delegatedContainers.set(
      container,
      (state = {
        owners: new Map(),
        handlers: new Map()
      })
    );
  state.owners.set(owner, (state.owners.get(owner) || 0) + 1);
  delegatedEvents.forEach(name => attachDelegatedEvent(name, container, state));
  return state;
} /** Event-delegation plumbing (Portal/custom-root wiring). Integration plumbing. @internal */
export function unregisterDelegatedContainer(
  container: MountableElement,
  owner?: MountableElement
): void;

export function unregisterDelegatedContainer(container, owner = container) {
  const state = delegatedContainers.get(container);
  if (!state) return;
  const count = state.owners.get(owner);
  if (count > 1) state.owners.set(owner, count - 1);
  else state.owners.delete(owner);
  if (state.owners.size) return;
  state.handlers.forEach((handler, name) => container.removeEventListener(name, handler));
  delegatedContainers.delete(container);
}

function attachDelegatedEvent(name, container, state) {
  if (state.handlers.has(name)) return;
  const handler = "_SOLID_OBSERVE_"
    ? e => dispatchAsInteraction(e, () => eventHandler(e, container, state))
    : e => eventHandler(e, container, state);
  state.handlers.set(name, handler);
  container.addEventListener(name, handler);
}

/** Event-delegation plumbing (Portal/custom-root wiring). Integration plumbing. @internal */
export function getDelegatedRoot(node: MountableElement): MountableElement | undefined;

export function getDelegatedRoot(node) {
  while (node) {
    if (delegatedContainers.get(node)?.roots) return node;
    node = node._$host || node.parentNode || node.host;
  }
}

function findOwner(target, state) {
  let node = target;
  let distance = 0;
  while (node) {
    if (state.owners.has(node)) return { owner: node, distance };
    distance++;
    node = node._$host || node.parentNode || node.host;
  }
}

// === Element claims ===
//
// Compiled DOM output claims navigation-relevant elements (`a[href]`,
// `form[action]`) at creation via `claimElement`, and the write sites the
// compiler owns (binding effects and spread assigns, which both land in
// `setAttribute`) re-invoke the same handlers when an `href`/`action`
// attribute changes — handlers must be idempotent. Dormant by design: with
// no handler registered every hook is a null check, so apps without a
// consumer (e.g. a router's link-state layer) pay nothing at runtime.
//
// Handlers run during element creation, under whatever reactive owner is
// current — consumers scope their per-element state and cleanup through
// their own reactive system (e.g. onCleanup), not through this hook.
let claimHandlers = null;

// The live handler list is mirrored onto a registered symbol so the frame
// runtime — deliberately importless in both directions, like the FRAME
// brand — sweeps serialized server content against the SAME registry, even
// when the two land in separately bundled copies of this module.
const CLAIM_SEAM = Symbol.for("solid.element-claims"); /**
 * Register a consumer for compiler-emitted element claims. Compiled DOM
 * output claims navigation-relevant elements (`a[href]`, `form[action]`) at
 * creation, and compiler-owned writes to `href`/`action` re-invoke the same
 * handlers — so handlers must be idempotent and must check the element's
 * relevance themselves (rechecks can fire for any element whose
 * `href`/`action` is written, e.g. `<link href>`). Handlers run under the
 * reactive owner current at element creation; scope per-element state and
 * cleanup through your own reactive system. Dormant until registered —
 * without a handler the emitted claims are null checks. Returns an
 * unregister function.
 *
 * Integration plumbing (routers register the consumer); not meant for
 * application code.
 * @internal
 */
export function registerElementClaim(handler: (element: Element) => void): () => void;

/**
 * Register a consumer for compiler-emitted element claims. Returns an
 * unregister function.
 */
export function registerElementClaim(handler) {
  (claimHandlers || (claimHandlers = globalThis[CLAIM_SEAM] = [])).push(handler);
  return () => {
    const index = claimHandlers.indexOf(handler);
    index > -1 && claimHandlers.splice(index, 1);
  };
}

// Elements the claim contract covers, and the subtree sweep over them.
// Serialized server content (frame streams, adopted SSR ranges) becomes
// live DOM without per-element compiled creation code, so its producer
// claims whole subtrees at materialization instead. Claims fire
// indiscriminately per the attribute contract — filtering (external links,
// `download`, `target`, base paths) belongs to the consumer.
const CLAIMED_ELEMENTS = "a[href], form[action]"; /**
 * Sweep-claim every navigation-relevant element (`a[href]`, `form[action]`)
 * in `root` — the subtree equivalent of the per-element `claimElement`
 * compiled output emits, for content that becomes live DOM without compiled
 * creation code (frame streams, adopted SSR ranges). Dormant without a
 * registered consumer.
 *
 * Integration plumbing; not meant for application code.
 * @internal
 */
export function claimElementTree<T extends Node>(root: T): T;

/**
 * Sweep-claim every navigation-relevant element in `root` (an element or a
 * DocumentFragment) — the subtree equivalent of the per-element
 * `claimElement` compiled output emits. Dormant like every claim hook:
 * without a registered consumer this is one check and the selector never
 * runs.
 */
export function claimElementTree(root) {
  // Read through the seam (not the module-local) so a separately bundled
  // copy of this function still sees the registry consumers write to.
  const handlers = globalThis[CLAIM_SEAM];
  if (handlers === undefined || handlers.length === 0) return root;
  const isElement = root.nodeType === 1;
  if (!isElement && root.nodeType !== 11) return root;
  if (isElement && root.matches(CLAIMED_ELEMENTS)) {
    for (let i = 0; i < handlers.length; i++) handlers[i](root);
  }
  const found = root.querySelectorAll(CLAIMED_ELEMENTS);
  for (let i = 0; i < found.length; i++) {
    for (let j = 0; j < handlers.length; j++) handlers[j](found[i]);
  }
  return root;
} /**
 * Claim `node` for registered consumers (see `registerElementClaim`).
 * Emitted by the compiler at element creation; idempotent by contract.
 * @internal
 */
export function claimElement<T extends Element>(node: T): T;

/**
 * Claim `node` for registered consumers. Emitted by the compiler at element
 * creation and re-invoked (idempotently) from claimed-attribute writes.
 */
export function claimElement(node) {
  if (claimHandlers !== null) {
    for (let i = 0; i < claimHandlers.length; i++) claimHandlers[i](node);
  }
  return node;
}
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function dynamicProperty(props: unknown, key: string): unknown;

export function dynamicProperty(props, key) {
  const src = props[key];
  Object.defineProperty(props, key, {
    get() {
      return src();
    },
    enumerable: true
  });
  return props;
} /** Compiler-emitted primitive; not for hand-written code. @internal */
export function applyRef<T extends Element = Element>(
  r: ((element: NoInfer<T>) => void) | ((element: NoInfer<T>) => void)[],
  element: T
): void;

export function applyRef(r, element) {
  Array.isArray(r) ? r.flat(Infinity).forEach(f => f && f(element)) : r(element);
} /** Compiler-emitted primitive; not for hand-written code. @internal */
export function ref(
  fn: () => ((element: Element) => void) | ((element: Element) => void)[],
  element: Element
): void;

export function ref(fn, element) {
  const resolved = untrack(fn);
  runWithOwner(null, () => applyRef(resolved, element));
}

/** Compiler-emitted primitive; not for hand-written code. @internal */
export function scope<T extends () => any>(fn: T): T;

// Compiler tag for holes that can allocate hydration ids: the outer insert
// effect gets its own (non-transparent) id scope, mirroring the server's
// `scope()` owner. Keeps sibling ids stable no matter when the hole runs.
export function scope(fn) {
  fn.$s = true;
  return fn;
}

// ---- Asset Registry ----
//
// Ref-counted client-side ownership of shared document assets. Consumers
// (routers, lazy wrappers, metadata components) acquire an asset when content
// that needs it mounts and release it on cleanup; the element is created — or
// an SSR/stream-emitted one adopted — on the first acquire and removed
// shortly after the last release. The removal grace period lets quick
// release/re-acquire cycles (route transitions sharing CSS) reuse the live
// element instead of flashing unstyled content while it reloads.
//
// Descriptor forms:
//   { type: "style", href, attrs? }               → <link rel="stylesheet">
//   { type: "inline-style", id, content?, attrs? } → <style data-asset={id}>
//   { type: "module", href }                       → <link rel="modulepreload">
//   { policy: "exclusive", key, value, get, set }  → singleton slot
//
// Exclusive slots implement last-writer-wins with restore-on-release (the
// title/meta ownership model): the newest acquire's value is applied via
// `set`; releasing it re-applies the previous writer's value, and the
// original document value (captured with `get` on first acquire) once every
// writer has released.

const ASSET_REMOVAL_GRACE = 100;
const assetRegistry = new Map();

function assetEntryKey(descriptor) {
  if (descriptor.policy === "exclusive") return "x|" + descriptor.key;
  return descriptor.type === "inline-style"
    ? "i|" + descriptor.id
    : descriptor.type + "|" + descriptor.href;
}

// Attribute-compared lookup (instead of an attribute selector) so href/id
// values never need selector escaping.
// `qualifiers` narrows a match to the same request: two preloads sharing an
// href still differ if their destination, CORS mode or source set differ, so
// adopting across them would drop a link the server meant to emit. Both sides
// go through `qualifierValue`, the same canonicalization the identity uses —
// a server-emitted `crossorigin=""` and an authored `crossorigin="anonymous"`
// are one request, so adoption must see them as one.
function findAssetElement(selector, attr, value, qualifiers) {
  const nodes = document.querySelectorAll(selector);
  outer: for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].getAttribute(attr) !== value) continue;
    if (!qualifiers) return nodes[i];
    for (let q = 0; q < RESOURCE_QUALIFIERS.length; q++) {
      const name = RESOURCE_QUALIFIERS[q];
      if (
        qualifierValue(name, qualifiers[name]) !== qualifierValue(name, nodes[i].getAttribute(name))
      )
        continue outer;
    }
    return nodes[i];
  }
  return null;
}

function setAssetAttrs(el, attrs) {
  for (const name in attrs) el.setAttribute(name, attrs[name]);
}

function mountAssetElement(descriptor) {
  let el;
  if (descriptor.type === "inline-style") {
    el = findAssetElement("style[data-asset]", "data-asset", descriptor.id);
    if (!el) {
      el = document.createElement("style");
      el.setAttribute("data-asset", descriptor.id);
      el.textContent = descriptor.content || "";
    }
  } else {
    const rel = descriptor.type === "module" ? "modulepreload" : "stylesheet";
    el = findAssetElement(`link[rel="${rel}"]`, "href", descriptor.href);
    if (!el) {
      el = document.createElement("link");
      el.rel = rel;
      el.href = descriptor.href;
    }
  }
  if (descriptor.attrs) setAssetAttrs(el, descriptor.attrs);
  if (!el.isConnected) document.head.appendChild(el);
  return el;
}

// Load tracking for the reveal gate (docs/client-css-reveal-gating.md).
// `loadPromise` resolves on load OR error and never rejects — an errored
// sheet releases the gate, parity with the server gate's `error` listener;
// there is deliberately no timeout, same as the server. `adopted` elements
// (server-emitted or hand-authored, found in the document rather than
// created here) may have finished loading before we could listen: an applied
// stylesheet exposes `.sheet`, and a finished fetch — even a failed one —
// leaves a resource-timing entry. Both are checked before falling back to
// listeners. The resource-timing probe is restricted to adopted elements
// because a stale entry from an earlier fetch of the same URL would
// otherwise mislabel a fresh in-flight request as settled.
const assetLoadSettled = /*#__PURE__*/ Promise.resolve();
function trackAssetLoad(entry, adopted) {
  if (entry.loadPromise) return;
  const el = entry.element;
  let settled = el.sheet != null;
  if (!settled && adopted && typeof performance !== "undefined" && performance.getEntriesByName) {
    settled = performance.getEntriesByName(el.href).length > 0;
  }
  if (settled) {
    entry.loadState = "loaded";
    entry.loadPromise = assetLoadSettled;
    return;
  }
  entry.loadState = "pending";
  entry.loadPromise = new Promise(resolve => {
    const settle = state => {
      entry.loadState = state;
      resolve();
    };
    el.addEventListener("load", () => settle("loaded"), { once: true });
    el.addEventListener("error", () => settle("errored"), { once: true });
  });
} /**
 * @internal Warm half of `acquireAsset`: idempotent and refcount-free,
 * callable from a compute phase so the fetch starts at discovery and
 * overlaps a transition's data wait. Stylesheets warm as
 * `rel="preload" as="style"` and are flipped live by `acquireAsset` at
 * commit — a branch superseded before it commits leaks only an inert
 * preload, never an applied sheet. Only link-backed descriptors warm;
 * inline styles and exclusive slots return `undefined`.
 */
export function warmAsset(descriptor: AssetDescriptor): AssetEntry | undefined;

// Warm half of `acquireAsset` (docs/client-css-reveal-gating.md): idempotent
// and refcount-free, callable from a compute phase so the fetch starts at
// discovery and overlaps a transition's data wait instead of serializing
// after it. Stylesheets warm as `rel="preload" as="style"` — a branch
// superseded before commit leaks only an inert preload (and a warm cache
// entry), never an applied sheet; `acquireAsset` adopts the element and
// flips the preload live. Fetch-identity qualifiers (crossorigin,
// integrity) ride `descriptor.attrs` onto the preload so the flip hits the
// preload cache instead of refetching. Returns the registry entry carrying
// `loadState`/`loadPromise` for the reveal gate. Only link-backed types
// warm: inline styles apply the moment they mount (warming would apply a
// branch's CSS before it commits) and exclusive slots have nothing to
// fetch.
export function warmAsset(descriptor) {
  if (descriptor.policy === "exclusive" || descriptor.type === "inline-style") return;
  const key = assetEntryKey(descriptor);
  let entry = assetRegistry.get(key);
  if (!entry) {
    entry = { count: 0, element: null, timer: null };
    assetRegistry.set(key, entry);
  }
  let adopted = true;
  if (!entry.element || !entry.element.isConnected) {
    const rel = descriptor.type === "module" ? "modulepreload" : "stylesheet";
    let el = findAssetElement(`link[rel="${rel}"]`, "href", descriptor.href);
    if (!el && descriptor.type === "style") {
      // A hand-authored preload for the same sheet (shell markup): the fetch
      // is already in flight or done — adopt it instead of double-mounting.
      el = findAssetElement('link[rel="preload"][as="style"]', "href", descriptor.href);
    }
    if (!el) {
      adopted = false;
      el = document.createElement("link");
      if (descriptor.type === "style") {
        el.setAttribute("rel", "preload");
        el.setAttribute("as", "style");
      } else {
        el.setAttribute("rel", "modulepreload");
      }
      el.setAttribute("href", descriptor.href);
      // Pre-paint (the document still allows render-blocking elements):
      // stamp the native attribute so the browser's paint-hold on the
      // in-flight sheet is contractual rather than heuristic — script-
      // inserted links are not formally render-blocking without it.
      if (!document.body) el.setAttribute("blocking", "render");
    }
    // Fetch-identity qualifiers must be set before the append starts the
    // fetch, or a crossorigin/integrity sheet fetches without them.
    if (descriptor.attrs) setAssetAttrs(el, descriptor.attrs);
    if (!el.isConnected) document.head.appendChild(el);
    entry.element = el;
    entry.loadState = undefined;
    entry.loadPromise = undefined;
  }
  if (descriptor.type === "style") trackAssetLoad(entry, adopted);
  return entry;
} /**
 * @internal Ref-counted client asset ownership: acquire adopts or mounts the
 * asset, the returned release follows the owner (with a grace period for
 * back-and-forth navigation). Internal machinery, not a public CSS-lifecycle
 * API — per the head-management RFC (docs/head-management-rfc.md), ambient
 * bundler-injected CSS is never lifecycle-managed, and the head registry
 * owns the lifecycle of directly-mounted stylesheets outright. This keeps
 * its non-head roles (exclusive slots, owner-following DOM ownership).
 */
export function acquireAsset(descriptor: AssetDescriptor): () => void;

export function acquireAsset(descriptor) {
  const key = assetEntryKey(descriptor);
  let entry = assetRegistry.get(key);
  if (descriptor.policy === "exclusive") {
    if (!entry) {
      entry = { original: descriptor.get(), set: descriptor.set, writers: [] };
      assetRegistry.set(key, entry);
    }
    const writer = { value: descriptor.value };
    entry.writers.push(writer);
    entry.set(writer.value);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const index = entry.writers.indexOf(writer);
      const wasTop = index === entry.writers.length - 1;
      entry.writers.splice(index, 1);
      if (!wasTop) return;
      if (entry.writers.length) {
        entry.set(entry.writers[entry.writers.length - 1].value);
      } else {
        entry.set(entry.original);
        assetRegistry.delete(key);
      }
    };
  }
  if (!entry) {
    entry = { count: 0, element: null, timer: null };
    assetRegistry.set(key, entry);
  }
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  entry.count++;
  if (!entry.element || !entry.element.isConnected) {
    entry.element = mountAssetElement(descriptor);
  } else if (descriptor.type === "style" && entry.element.getAttribute("rel") === "preload") {
    // Warmed (or adopted hand-authored) preload: flip it live. The element
    // keeps its fetch-identity qualifiers, so the sheet applies straight
    // from the preload cache — no second fetch.
    entry.element.removeAttribute("as");
    entry.element.setAttribute("rel", "stylesheet");
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--entry.count > 0) return;
    entry.timer = setTimeout(() => {
      assetRegistry.delete(key);
      entry.element && entry.element.remove();
    }, ASSET_REMOVAL_GRACE);
  };
}

// ---- Head Registry (useHead) ----
//
// Client half of the head registry (design: docs/head-management-rfc.md).
// Registrations resolve by last-committed group per identity; the winning
// set is applied to document.head with ownership marking (`data-dh`) so
// static head content and third-party insertions are never clobbered.
//
// Server handoff: server-rendered winners carry the same ownership marker,
// so the DOM itself is the bootstrap state — the registry claims marked
// elements on its first post-hydration apply instead of recreating them.
// Streamed patches route through `_$HY.h` once the registry is live; before
// that the inline `$dh` runtime applies them directly (and marks them), so
// no patch is lost regardless of bundle timing. During hydration DOM writes
// are suppressed entirely — the server-flushed state stays authoritative
// until hydration completes, preventing revert/redo flicker.

let headRegistrations = null; // [{ seq, tags: [{ tag, props, identity }] }]
let headSeq = 0;
let headUid = 0;
let headOwned = null; // Map<identity, Element[]> — DOM the registry wrote/claimed
let headApplied = null; // Map<identity, signature> — skip no-op re-applies
let headFallbackTitle = null;
let headScheduled = false;
const headMountedResources = new Set(); // hint identities mounted this session

function initHeadRegistry() {
  if (headRegistrations) return;
  headRegistrations = [];
  headOwned = new Map();
  headApplied = new Map();
  // A <title> without an ownership marker is user-authored shell markup: the
  // fallback restored when every title registration has disposed. A marked
  // one is server-registry output — but if the server's retitle overwrote a
  // static shell title, the original text was stashed on `data-dhf` (by the
  // shell title script or the inline $dha runtime) and is still the fallback.
  const t = document.querySelector("title");
  headFallbackTitle = t
    ? t.hasAttribute("data-dh")
      ? t.getAttribute("data-dhf")
      : t.textContent
    : null;
  if (globalThis._$HY) globalThis._$HY.h = applyServerHeadOps;
}

// Server patch ops arriving after the registry is live (a boundary streamed
// in post-bundle-load). Identities the client owns are skipped — client
// registrations are newer commits by definition; everything else applies
// with the same semantics as the inline $dha runtime.
function applyServerHeadOps(ops) {
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const identity = op[0] === "t" ? "title" : op[1];
    if (headOwned.has(identity)) continue;
    if (op[0] === "t") setHeadTitle(op[1]);
    else if (op[0] === "r") {
      const els = headMarkedElements(identity);
      for (let j = 0; j < els.length; j++) els[j].remove();
    } else {
      const el = document.createElement(op[2]);
      for (const name in op[3]) el.setAttribute(name, op[3][name]);
      if (op[4] != null) el.textContent = op[4];
      el.setAttribute("data-dh", identity);
      document.head.appendChild(el);
    }
  }
}

// Attribute-compared lookup, same reasoning as findAssetElement: identity
// values never need selector escaping.
function headMarkedElements(identity) {
  const nodes = document.head.querySelectorAll("[data-dh]");
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].getAttribute("data-dh") === identity) out.push(nodes[i]);
  }
  return out;
}

function setHeadTitle(text) {
  let el = document.querySelector("title");
  if (!el) {
    el = document.createElement("title");
    document.head.appendChild(el);
  }
  el.textContent = text;
  el.setAttribute("data-dh", "title");
  return el;
}

function scheduleHeadApply() {
  if (headScheduled) return;
  headScheduled = true;
  queueMicrotask(flushHeadRegistry);
}

function flushHeadRegistry() {
  if (sharedConfig.hydrating) {
    // Collect, don't touch: server state stays authoritative until hydration
    // completes. Macrotask (not microtask) retry so an async hydration path
    // (module preloads) can make progress.
    setTimeout(flushHeadRegistry, 0);
    return;
  }
  headScheduled = false;
  const winners = resolveHead(headRegistrations);
  // Retractions: identities the registry owns that no longer resolve.
  for (const [identity, els] of headOwned) {
    if (winners.has(identity)) continue;
    headOwned.delete(identity);
    headApplied.delete(identity);
    if (identity === "title") {
      if (headFallbackTitle != null) {
        const el = setHeadTitle(headFallbackTitle);
        el.removeAttribute("data-dh");
        el.removeAttribute("data-dhf");
      }
    } else {
      for (let i = 0; i < els.length; i++) els[i].remove();
    }
  }
  for (const [identity, winner] of winners) {
    let sig = "";
    for (let i = 0; i < winner.tags.length; i++)
      sig += winner.tags[i].tag + JSON.stringify(winner.tags[i].props) + "|";
    if (headApplied.get(identity) === sig) continue;
    headApplied.set(identity, sig);
    if (identity === "base" || identity === "charset") {
      // Shell-only identities: not client-manageable (a charset or base that
      // changes after load is incoherent). Server-rendered ones stand.
      if ("_SOLID_DEV_")
        console.warn(
          `useHead: <${winner.tags[0].tag}> (${identity}) is shell-only and ignored on the client`
        );
      continue;
    }
    if (identity === "title") {
      const children = winner.tags[0].props.children;
      setHeadTitle(children == null ? "" : String(children));
      headOwned.set(identity, []);
      continue;
    }
    // Remove-and-rerender per identity (no attribute diffing — N is
    // head-sized), except elements that match exactly are claimed in place:
    // that is how server-rendered winners adopt without churn on first apply.
    const existing = headMarkedElements(identity);
    const els = [];
    for (let i = 0; i < winner.tags.length; i++) {
      els.push(renderHeadElement(winner.tags[i], identity, existing));
    }
    for (let i = 0; i < existing.length; i++) {
      if (els.indexOf(existing[i]) === -1) existing[i].remove();
    }
    headOwned.set(identity, els);
  }
}

// Shared filtered create: skips children/ref/onXxx handlers and invalid
// names, drops null/false values, sets the text body. Used by the
// replaceable render and the resource mount.
function createHeadElement(tag, props) {
  const el = document.createElement(tag);
  for (const name in props) {
    if (name === "children" || name === "ref" || /^on[A-Z]/.test(name)) continue;
    if (!HEAD_ATTR_NAME.test(name)) {
      if ("_SOLID_DEV_") console.warn(`useHead: ignoring invalid attribute name "${name}"`);
      continue;
    }
    const v = props[name];
    if (v == null || v === false) continue;
    el.setAttribute(name, v === true ? "" : String(v));
  }
  if (props.children != null) el.textContent = String(props.children);
  return el;
}

function renderHeadElement(t, identity, existing) {
  for (let i = 0; i < existing.length; i++) {
    if (headElementMatches(existing[i], t)) return existing.splice(i, 1)[0];
  }
  const el = createHeadElement(t.tag, t.props);
  el.setAttribute("data-dh", identity);
  document.head.appendChild(el);
  return el;
}

function headElementMatches(el, t) {
  if (el.tagName.toLowerCase() !== t.tag) return false;
  for (const name in t.props) {
    if (name === "children" || name === "ref" || /^on[A-Z]/.test(name)) continue;
    if (!HEAD_ATTR_NAME.test(name)) continue;
    const v = t.props[name];
    if (v == null || v === false) {
      if (el.hasAttribute(name)) return false;
    } else if (el.getAttribute(name) !== (v === true ? "" : String(v))) return false;
  }
  const children = t.props.children;
  return (children == null ? "" : String(children)) === el.textContent;
}

// Mount-once resources: hints (preload/preconnect/…) and scripts mount
// identity-deduped against server-emitted elements and are never removed on
// disposal — retracting a hint is pointless churn, and an executed script
// cannot be unexecuted.
function mountHeadResource(tag, props) {
  const identity = resourceIdentity(tag, props);
  if (headMountedResources.has(identity)) return;
  headMountedResources.add(identity);
  const url = props.href || props.src;
  let el = null;
  // Adopt a server-emitted element for the same resource. `rel` values are
  // constrained to the resource set, so embedding in a selector is safe.
  // A responsive image preload legitimately has no href — the source set is
  // the request — so it matches on a null href plus the identity qualifiers,
  // the same rule the frame client applies.
  if (tag === "link" && url == null && typeof props.imagesrcset === "string")
    el = findAssetElement(`link[rel="${props.rel}"]`, "href", null, props);
  else if (url != null) {
    if (tag === "link") el = findAssetElement(`link[rel="${props.rel}"]`, "href", url, props);
    else if (tag === "script") el = findAssetElement("script[src]", "src", url);
    else el = findAssetElement("style[href]", "href", url);
  }
  if (!el) document.head.appendChild(createHeadElement(tag, props));
}

// Stylesheet/modulepreload links ride the ref-counted asset registry —
// removal follows the owner with the same grace period as tracked boundary
// CSS — through a per-resource child computation (the client analog of the
// server's `$dfs` gate, docs/client-css-reveal-gating.md): the compute warms
// the asset so the fetch starts at discovery and overlaps a transition's
// data wait, then a gateable stylesheet reads as not-ready until it has
// loaded (or errored) — the transition/boundary machinery holds the reveal
// and retries on settle with no mechanism of its own here. Ownership is
// taken at commit, so a branch superseded before it commits never acquires
// (and never applies) the sheet. Kept out of the group compute so a
// registration's replaceable tags (title/meta) never wait on CSS.
//
// `warmAsset` mutates document.head from a compute phase — a deliberate
// exception to compute purity: it is idempotent, registry-keyed, and the
// document head is outside the reactive graph.
function gateHeadResource(props) {
  const descriptor = {
    type: props.rel === "stylesheet" ? "style" : "module",
    href: props.href
  };
  // Gateability (shared classification with the server): extra attributes —
  // valid or not — must all be pure fetch metadata. Condition-changing
  // attributes (media, title/alternate, disabled) exclude a sheet: holding
  // a reveal on a sheet that may never apply is worse than FOUC.
  let gateable = props.rel === "stylesheet" && props.href != null;
  let attrs = null;
  for (const name in props) {
    if (name === "rel" || name === "href") continue;
    if (!STYLESHEET_FETCH_META.has(name)) gateable = false;
    if (!HEAD_ATTR_NAME.test(name)) continue;
    const v = props[name];
    if (v == null || v === false) continue;
    (attrs || (attrs = {}))[name] = v === true ? "" : String(v);
  }
  if (attrs) descriptor.attrs = attrs;
  effect(
    () => {
      const entry = warmAsset(descriptor);
      // Settledness is checked here, not inside the seam: a loaded (or
      // errored) sheet must acquire synchronously — cached sheets add zero
      // wait, adopted server-emitted sheets never stall — and even a
      // settled promise costs a microtask through the async machinery.
      // Hydrating content is already visible; the server gated its reveal.
      if (
        gateable &&
        !sharedConfig.hydrating &&
        entry.loadState === "pending" &&
        typeof waitAsset === "function"
      )
        waitAsset(entry.loadPromise);
    },
    () => acquireAsset(descriptor)
  );
} /**
 * Registers head tags with the ambient head registry under the current
 * owner. An array is a group — one replacement set; a function is a
 * reactive group whose membership is tracked and re-read on change.
 * Resolution is last-committed group per identity (reactive updates keep
 * the registration's original commit position); disposal restores the
 * previous winner. During hydration the server-flushed head state stays
 * authoritative until hydration completes. Stylesheet reveal gating is
 * skipped while `sharedConfig.hydrating` is true: hydration claims DOM the
 * browser already painted, and the server gated that paint — no FOUC is
 * introduced. See docs/head-management-rfc.md.
 */
export function useHead(tag: HeadTag | HeadTag[] | (() => HeadTag | HeadTag[])): void;

/**
 * Registers head tags with the ambient head registry. An array is a group —
 * one replacement set; a function is a reactive group whose membership is
 * re-read in the tracking scope (component-level grouping composes its list
 * after registration). Props values may be getters (reactive); updates keep
 * the registration's original commit position. Disposal removes the
 * registration and re-resolves (previous committed winner is restored).
 * Stylesheet reveal gating is skipped while `sharedConfig.hydrating` is
 * true: hydration claims DOM the browser already painted, and the server
 * gated that paint — no FOUC is introduced. See docs/head-management-rfc.md.
 */
export function useHead(tags) {
  initHeadRegistry();
  const reg = { seq: -1, tags: null };
  const uid = ++headUid;
  effect(
    () => {
      let list = typeof tags === "function" ? tags() : tags;
      if (!Array.isArray(list)) list = [list];
      const replaceable = [];
      const resources = [];
      for (let i = 0; i < list.length; i++) {
        const desc = list[i];
        if (!desc || !HEAD_ELIGIBLE_TAGS.has(desc.tag)) {
          if ("_SOLID_DEV_") console.warn(`useHead: ignoring non-head tag`, desc);
          continue;
        }
        const cls = classifyHeadTag(desc);
        const props = evalHeadProps(
          desc.props || {},
          cls.rel !== undefined ? { rel: cls.rel } : undefined
        );
        if (cls.resource) {
          if (
            desc.tag === "link" &&
            (props.rel === "stylesheet" || props.rel === "modulepreload")
          ) {
            // Owner-followed + reveal-gated, in a per-resource child
            // computation (recreated on membership reruns; warm is
            // idempotent and ownership is refcounted with a grace period,
            // so recreation is cheap and correct).
            gateHeadResource(props);
          } else if (desc.tag === "link") {
            // Hints (preload/preconnect/…) are inert: mounting at discovery
            // *is* the warm — fetch earliness with no side effect for a
            // branch that never commits (a leaked hint retracts nothing).
            mountHeadResource(desc.tag, props);
          } else {
            // Scripts execute and inline styles apply the moment they mount
            // — commit-time only, never warmed.
            resources.push({ tag: desc.tag, props });
          }
        } else {
          const key = evalHeadValue(desc.key);
          replaceable.push({
            tag: desc.tag,
            props,
            // Stable unique fallback per registration slot so reactive reruns
            // update in place instead of forking identities.
            identity: replaceableIdentity(desc.tag, props, key, "u:c" + uid + ":" + i)
          });
        }
      }
      return { replaceable, resources };
    },
    evaluated => {
      for (let i = 0; i < evaluated.resources.length; i++) {
        mountHeadResource(evaluated.resources[i].tag, evaluated.resources[i].props);
      }
      reg.tags = evaluated.replaceable;
      // Commit order is assigned once; a reactive rerun re-enters at the same
      // position (the cleanup below runs first, then this re-adds).
      if (reg.seq < 0) reg.seq = ++headSeq;
      if (headRegistrations.indexOf(reg) === -1) headRegistrations.push(reg);
      scheduleHeadApply();
      return () => {
        const idx = headRegistrations.indexOf(reg);
        if (idx > -1) headRegistrations.splice(idx, 1);
        scheduleHeadApply();
      };
    }
  );
}

// Module asset loading for hydration. `mapping` pairs opaque keys with
// client-loadable entry URLs. Keys are chosen by the reactive library's
// server-side lazy() (e.g. hydration ids) and are never interpreted here —
// they only need to match what the client-side lazy() looks up in
// `_$HY.modules` after preload.
function loadModuleAssets(mapping) {
  const hy = globalThis._$HY;
  if (!hy) return;
  const pending = [];
  for (const key in mapping) {
    if (hy.modules[key]) continue;
    // Vite adds `?import` to opaque dynamic imports of source files. Absolute
    // URLs bypass that rewrite and retain the same identity as literal imports.
    const entryUrl = new URL(mapping[key], document.baseURI).href;
    if (!hy.loading[key]) {
      hy.loading[key] = import(/* @vite-ignore */ entryUrl).then(
        mod => {
          hy.modules[key] = mod;
        },
        err => {
          // drop the rejected entry so a later boundary/navigation can retry
          delete hy.loading[key];
          throw err;
        }
      );
    }
    pending.push(hy.loading[key]);
  }
  return pending.length ? Promise.all(pending).then(() => {}) : undefined;
}
/**
 * Resumes a server-rendered tree on the client, attaching event listeners
 * and reactive bindings without reconstructing the DOM. Returns a `dispose`
 * function that tears down reactive scopes (DOM nodes are left in place).
 *
 * Use this when the page HTML was produced by `renderToString` or
 * `renderToStream`. For client-only apps, use `render` instead.
 *
 * Pass `options.renderId` to hydrate one of multiple roots emitted by a
 * server render that used the same id.
 *
 * When the server renders a full document but the client hydrates only the
 * app subtree, the server must give that subtree its own id namespace: wrap
 * the document shell in `<NoHydration>` and re-enter with `<Hydration>`
 * around the app. Otherwise the app's hydration ids are allocated under the
 * document component's owner tree and this walk can never claim them.
 */
export function hydrate(
  fn: () => JSX.Element,
  node: MountableElement,
  options?: { renderId?: string; owner?: unknown; onError?: ClientErrorHook }
): () => void;

export function hydrate(code, element, options = {}) {
  enableHydration();
  installHydrationRuntime();
  if (globalThis._$HY.done) return render(code, element, [...element.childNodes], options);
  // #3081: the server splices useHead's charset/base prelude immediately
  // after the <head> open tag — a byte-placement constraint (charset within
  // the first 1024 bytes, base before URL-bearing tags) the parser has
  // already consumed by now. The compiled walk reads head's children
  // positionally, so registry-INSERTED tags (data-dh without the data-dhf
  // in-place-rewrite stash) sitting ahead of the shell's authored children
  // shift every read by one. Move that leading run — inert metas in an
  // unrendered element — to the end of head before any claiming. For apps
  // without a prelude the loop exits on its first check.
  const head = (element.nodeType === 9 ? element : element.ownerDocument).head;
  if (head && element.contains(head)) {
    let n = head.firstChild;
    while (n && n.nodeType === 1 && n.hasAttribute("data-dh") && !n.hasAttribute("data-dhf")) {
      const next = n.nextSibling;
      head.appendChild(n);
      n = next;
    }
  }
  options.renderId ||= "";
  if (!globalThis._$HY.modules) globalThis._$HY.modules = {};
  if (!globalThis._$HY.loading) globalThis._$HY.loading = {};
  sharedConfig.completed = globalThis._$HY.completed;
  sharedConfig.events = globalThis._$HY.events;
  sharedConfig.load = id => globalThis._$HY.r[id];
  sharedConfig.has = id => id in globalThis._$HY.r;
  sharedConfig.gather = root => gatherHydratable(element, root);
  sharedConfig.loadModuleAssets = loadModuleAssets;
  sharedConfig.cleanupFragment = id => {
    const tpl = document.getElementById("pl-" + id);
    if (tpl) {
      let node = tpl.nextSibling;
      while (node) {
        const next = node.nextSibling;
        if (node.nodeType === 8 && node.nodeValue === "pl-" + id) {
          node.remove();
          break;
        }
        node.remove();
        node = next;
      }
      tpl.remove();
    }
  };
  sharedConfig.registry = new Map();
  // Multiple hydrate() roots share one sharedConfig, but each call replaces
  // registry/gather. A boundary that resumes after another root has started
  // must claim against the root it registered under (solidjs/solid#2917), so
  // the reactive library calls captureBoundaryScope at boundary-registration
  // time — the pair is unambiguous there, keyed by the full boundary id (no
  // prefix parsing: root id and counter path have no delimiter). The resume
  // path reads and removes the entry, falling back to the live globals when
  // none exists. The map is shared across roots, so create it only once.
  if (!sharedConfig.boundaryScopes) sharedConfig.boundaryScopes = new Map();
  sharedConfig.captureBoundaryScope = id => {
    if (sharedConfig.registry)
      sharedConfig.boundaryScopes.set(id, {
        registry: sharedConfig.registry,
        gather: sharedConfig.gather
      });
  };
  sharedConfig.hydrating = true;
  if ("_SOLID_DEV_") {
    sharedConfig.verifyHydration = () => {
      if (sharedConfig.registry && sharedConfig.registry.size) {
        const orphaned = [...sharedConfig.registry.values()].filter(node => node.isConnected);
        sharedConfig.registry.clear();
        if (!orphaned.length) return;
        console.warn(
          `Hydration completed with ${orphaned.length} unclaimed server-rendered node(s):\n` +
            orphaned.map(node => `  ${node.outerHTML.slice(0, 100)}`).join("\n")
        );
      }
    };
  }
  // Root module maps serialize under a renderId-scoped name — island
  // integrations run one render per island into the same document, and a
  // single page-global "_assets" name would leave only the last island's map
  // alive. The bare name remains as fallback for the OTHER islands shape: a
  // single document render (renderId "") whose islands re-enter through
  // Hydration ids — every island's modules live in that one root map, and
  // each hydrate() root preloads it (loadModuleAssets dedupes the fetches).
  const hyr = globalThis._$HY.r;
  const rootMapping = hyr && (hyr[options.renderId + "_assets"] || hyr["_assets"]);
  if (rootMapping && typeof rootMapping === "object") {
    const p = loadModuleAssets(rootMapping);
    if (p) {
      gatherHydratable(element, options.renderId);
      // This root's render is deferred behind the preload, but sharedConfig
      // is shared and LIVE: another hydrate() root can run its synchronous
      // prologue before this .then fires — islands entry-clients start
      // several roots in one tick — replacing registry/gather, and the first
      // deferred root to finish clears `hydrating` for everyone after it.
      // Re-install this root's scope around its deferred render so it claims
      // exactly what it gathered (the same per-root pairing a late boundary
      // resume gets from captureBoundaryScope).
      const registry = sharedConfig.registry;
      const gather = sharedConfig.gather;
      let disposer;
      p.then(
        () => {
          sharedConfig.registry = registry;
          sharedConfig.gather = gather;
          sharedConfig.hydrating = true;
          try {
            disposer = render(code, element, [...element.childNodes], options);
          } finally {
            sharedConfig.hydrating = false;
          }
        },
        err => {
          // A chunk failed to preload; hydration can't claim the server DOM
          // (lazy components have no module). Fall back to a fresh client
          // render replacing the server markup — lazy's own import() gets to
          // retry through normal channels — instead of a silently dead page.
          // A document root has no such fallback: the shell (<html>/<head>/
          // <body>) cannot be client-created, and rendering the document tree
          // fresh dies deep in the walk with an unrelated "Hydration Mismatch"
          // (#3338). Abandon hydration explicitly instead — the server markup
          // stays — and hand the failure to the platform's uncaught-error
          // channel (window.onerror / error monitoring) with its real cause,
          // the same way an uncaught reactive error is reported.
          sharedConfig.hydrating = false;
          sharedConfig.registry = undefined;
          if (element.nodeType === 9) {
            // The preload failure itself is what monitoring needs (which chunk,
            // why); the framing is dev-only so prod ships no wrapper Error.
            if ("_SOLID_DEV_")
              console.error(
                "Hydration module preload failed for a document root; a document shell cannot " +
                  "be client-rendered, so hydration was abandoned and the page is not interactive."
              );
            (globalThis.reportError || console.error)(err);
            return;
          }
          console.error("Hydration module preload failed, falling back to client render:", err);
          disposer = render(code, element, [...element.childNodes], options);
        }
      );
      return () => disposer && disposer();
    }
  }
  try {
    gatherHydratable(element, options.renderId);
    return render(code, element, [...element.childNodes], options);
  } finally {
    sharedConfig.hydrating = false;
  }
} /** Hydration-walk primitive; not for hand-written code. @internal */
export function getNextElement(template?: () => Element): Element;

export function getNextElement(template) {
  let node,
    key,
    hydrating = isHydrating();
  if (!hydrating || !(node = sharedConfig.registry.get((key = getHydrationKey())))) {
    if (!template) {
      throw new Error(`Hydration Mismatch. Unable to find DOM nodes for hydration key: ${key}`);
    }
    // A key miss during the hydration walk is a real mismatch: fresh renders
    // (portals, rejected fragments, post-hydration content) all run with the
    // hydrating flag off, so there is no legitimate way to get here. The
    // detached element returned below keeps the render alive but never lands
    // in the document — without a report that reads as a silently frozen
    // page (solidjs/solid#3000).
    if ("_SOLID_DEV_" && hydrating) {
      noteHydrationKeyMiss();
      console.warn(
        `Hydration key miss for "${key}": no server-rendered element carries this key` +
          (template._html ? ` (template: ${template._html.slice(0, 60)})` : "") +
          `. A detached element was created instead; its subtree will not appear in the ` +
          `document or become interactive. This usually means the server and client ` +
          `hydration id namespaces are misaligned — when hydrating a subtree of a larger ` +
          `server render, wrap the document shell in <NoHydration> and re-enter with ` +
          `<Hydration> around the hydrated subtree (or pass hydrate() a renderId matching ` +
          `the server's <Hydration id>).`
      );
    }
    return template(true);
  }
  if ("_SOLID_DEV_" && template && template._html) {
    const expected = template._html.match(/^<(\w+)/)?.[1];
    if (expected && node.localName !== expected) {
      console.warn(
        `Hydration tag mismatch for key "${key}": expected <${expected}> but found`,
        node
      );
    }
  }
  if (sharedConfig.completed) sharedConfig.completed.add(node);
  sharedConfig.registry.delete(key);
  return node;
} /** Hydration-walk primitive; not for hand-written code. @internal */
export function getNextMatch(start: Node, elementName: string): Element;

export function getNextMatch(el, nodeName) {
  while (el && el.localName !== nodeName) el = el.nextSibling;
  return el;
} /** Hydration-walk primitive; not for hand-written code. @internal */
export function getNextMarker(start: Node): [Node, Array<Node>];

export function getNextMarker(start) {
  let end = start,
    count = 0,
    current = [];
  if (isHydrating(start)) {
    while (end) {
      if (end.nodeType === 8) {
        const v = end.nodeValue;
        if (v === "$") count++;
        else if (v === "/") {
          if (count === 0) return [end, current];
          count--;
        }
      }
      current.push(end);
      end = end.nextSibling;
    }
  }
  return [end, current];
}

export function getFirstChild(node, expectedTag) {
  const child = node.firstChild;
  if ("_SOLID_DEV_" && isHydrating() && expectedTag && child?.localName !== expectedTag) {
    const isMissing = !child || child.nodeType !== 1;
    console.warn(
      "Hydration structure mismatch: expected <" + expectedTag + "> as first child of",
      node,
      "\n  " + describeSiblings(node, child, expectedTag, isMissing)
    );
  }
  return child;
}

export function getNextSibling(node, expectedTag) {
  const sibling = node.nextSibling;
  if ("_SOLID_DEV_" && isHydrating() && expectedTag && sibling?.localName !== expectedTag) {
    const parent = node.parentNode;
    const isMissing = !sibling || sibling.nodeType !== 1;
    console.warn(
      "Hydration structure mismatch: expected <" + expectedTag + "> after",
      node,
      "in",
      parent,
      "\n  " + describeSiblings(parent, sibling, expectedTag, isMissing)
    );
  }
  return sibling;
}

function describeSiblings(parent, mismatchChild, expectedTag, isMissing) {
  if (!parent) return `<${expectedTag} \u2190 parent unavailable>`;
  const children = [];
  let child = parent.firstChild;
  while (child) {
    if (child.nodeType === 1) children.push(child);
    child = child.nextSibling;
  }
  const pTag = parent.localName || "#fragment";
  if (isMissing) {
    const tags = children.map(c => `<${c.localName}>`).join("");
    return `<${pTag}>${tags}<${expectedTag} \u2190 missing></${pTag}>`;
  }
  const idx = children.indexOf(mismatchChild);
  let start = 0,
    end = children.length;
  let prefix = "",
    suffix = "";
  if (children.length > 6) {
    start = Math.max(0, idx - 2);
    end = Math.min(children.length, idx + 3);
    if (start > 0) prefix = "...";
    if (end < children.length) suffix = "...";
  }
  const tags = children
    .slice(start, end)
    .map(c =>
      c === mismatchChild ? `<${c.localName} \u2190 expected ${expectedTag}>` : `<${c.localName}>`
    )
    .join("");
  return `<${pTag}>${prefix}${tags}${suffix}</${pTag}>`;
} /** Hydration-walk primitive; not for hand-written code. @internal */
export function runHydrationEvents(): void;

export function runHydrationEvents() {
  if (sharedConfig.events && !sharedConfig.events.queued) {
    queueMicrotask(() => {
      const { completed, events } = sharedConfig;
      if (!events) return;
      events.queued = false;
      while (events.length) {
        const [el, e] = events[0];
        if (!completed.has(el)) return;
        events.shift();
        let matchContainer, matchState, matchDistance, matches;
        for (const [container, state] of delegatedContainers) {
          if (!state.handlers.has(e.type)) continue;
          const entry = findOwner(e.target, state);
          if (!entry) continue;
          if (matchContainer) {
            if (!matches)
              matches = [
                {
                  container: matchContainer,
                  state: matchState,
                  distance: matchDistance
                }
              ];
            matches.push({ container, state, distance: entry.distance });
          } else {
            matchContainer = container;
            matchState = state;
            matchDistance = entry.distance;
          }
        }
        if (matches) {
          // Replay innermost-first so queued hydration events follow the same
          // root-boundary handoff as live native bubbling.
          matches.sort((a, b) => a.distance - b.distance);
          for (let i = 0; i < matches.length; i++)
            eventHandler(e, matches[i].container, matches[i].state);
        } else if (matchContainer) eventHandler(e, matchContainer, matchState);
      }
      if (sharedConfig.done) {
        sharedConfig.events = _$HY.events = null;
        sharedConfig.completed = _$HY.completed = null;
      }
    });
    sharedConfig.events.queued = true;
  }
}

function eventHandler(e, container, state) {
  if (hydrationRt !== null && hydrationRt.dedupEvent(e)) return;
  const prev = e[$$EVENT_OWNER];
  let resumeNode;
  if (prev) {
    // An inner root already walked its segment. Ancestor roots resume from
    // that boundary; unrelated/shared containers must not see the event as
    // theirs. Native stopPropagation still prevents this listener from running.
    if (prev === true || prev === container || !container.contains(prev)) return;
    resumeNode = prev;
  }
  const owner =
    state &&
    (state.owners.size === 1 && state.owners.has(container)
      ? container
      : findOwner(e.target, state)?.owner);
  if (state && !owner) return;
  // Same owner as the walk that already completed: nothing remains. This is a
  // portal container sharing its app root's ownership (registerDelegatedContainer
  // with the root as owner) seeing an event from inside the root — the resume
  // path below assumes the boundary is an ancestor of the resume point, which
  // only holds for nested roots, and climbing past #document crashes (#3008).
  if (owner && owner === resumeNode) return;
  e[$$EVENT_OWNER] = owner || true;

  let node = resumeNode || e.target;
  const key = EVENT_KEY + e.type;
  const oriTarget = e.target;
  const boundary = owner || container || e.currentTarget;
  const retarget = value =>
    Object.defineProperty(e, "target", {
      configurable: true,
      value
    });
  const handleNode = () => {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[`${key}Data`];
      data !== undefined
        ? handler.call(node, data, e)
        : typeof handler === "function"
          ? handler.call(node, e)
          : handler.handleEvent(e);
      if (e.cancelBubble) return;
    }
    node.host &&
      typeof node.host !== "string" &&
      !node.host._$host &&
      node.contains(e.target) &&
      retarget(node.host);
    return true;
  };
  const walkUpTree = () => {
    while (node && handleNode()) {
      if (node === boundary || node.parentNode === boundary) break;
      node = node._$host || node.parentNode || node.host;
    }
  };

  // simulate currentTarget
  Object.defineProperty(e, "currentTarget", {
    configurable: true,
    get() {
      return node || boundary || document;
    }
  });
  if (resumeNode) {
    // If the boundary was the target, the inner walk already fired it.
    // Resume above it so boundary handlers do not run twice.
    if (resumeNode === e.target)
      node = resumeNode._$host || resumeNode.parentNode || resumeNode.host;
    if (node && node !== boundary) walkUpTree();
  } else if (e.composedPath) {
    const path = e.composedPath();
    if (path.length) {
      retarget(path[0]);
      for (let i = 0; i < path.length; i++) {
        node = path[i];
        if (!handleNode()) break;
        if (node._$host) {
          node = node._$host;
          // bubble up from portal mount instead of composedPath
          walkUpTree();
          break;
        }
        if (node === boundary || node.parentNode === boundary) {
          break; // don't bubble above root of event delegation
        }
      }
    } else walkUpTree();
  }
  // fallback for browsers that don't support composedPath
  else walkUpTree();
  // Mixing portals and shadow dom can lead to a nonstandard target, so reset here.
  retarget(oriTarget);
}

function gatherHydratable(element, root) {
  // A prefix-scoped gather (a boundary's late resume; an adopted frame
  // occurrence's claim window) names exactly what it owns — collect wherever
  // the keys sit, frame interiors included: keys are namespaced by their
  // producer chain, so a nested frame's content can never match a foreign
  // prefix. Selected natively: it runs once per resume or per occurrence,
  // and a full `_hk` sweep filtered in JS each time is a cost per
  // occurrence on the whole page.
  const templates = element.querySelectorAll(
    root ? `[_hk^="${root.replace(/["\\]/g, "\\$&")}"]` : `*[_hk]`
  );
  // The ambient sweep claims only what this hydration root itself walks.
  // Frame regions ("data-fid" — the frame runtime's element brand, an
  // importless duplicate like FRAME_ID_ATTR in frame-client/frame-sink)
  // are another layer's property: their fills claim through their own
  // windows on their own schedule (a lazy route module may adopt long
  // after this root completes), so collecting them here only sets up the
  // completion sweep to report legitimately-late claims as unclaimed.
  // Whether the root has frames is one question about the page, not one per
  // keyed node: find them once and test containment against the list, rather
  // than `closest("[data-fid]")` from every node — an ancestor walk to the
  // document root for each element, paid in full on pages with no frames.
  const frames = root ? null : element.querySelectorAll("[data-fid]");
  const frameCount = frames ? frames.length : 0;
  const registry = sharedConfig.registry;
  for (let i = 0; i < templates.length; i++) {
    const node = templates[i];
    const key = node.getAttribute("_hk");
    if (frameCount !== 0) {
      // `contains` is inclusive: a node that is itself a frame is skipped too,
      // as `closest` (which starts at the node) did before.
      let inFrame = false;
      for (let j = 0; j < frameCount; j++) {
        if (frames[j].contains(node)) {
          inFrame = true;
          break;
        }
      }
      if (inFrame) continue;
    }
    if (!registry.has(key)) registry.set(key, node);
  }
} /** Hydration-walk primitive; not for hand-written code. @internal */
export function getHydrationKey(): string | undefined;

export function getHydrationKey() {
  return sharedConfig.getNextContextId();
}

// experimental
export const RequestContext: unique symbol = Symbol() as any;
