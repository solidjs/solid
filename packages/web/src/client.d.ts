import { JSX } from "./jsx.js";
import type { RequestEventLocals } from "./server.js";
// Element/property classification tables consumed by the JSX compiler and
// custom renderers. Compiler/tooling surface; not for hand-written code.
/** Compiler/tooling table; not for hand-written code. @internal */
export const DOMWithState: Record<string, Record<string, 1 | 2>>;
/** Compiler/tooling table; not for hand-written code. @internal */
export const ChildProperties: Set<string>;
/** Compiler/tooling table; not for hand-written code. @internal */
export const DelegatedEvents: Set<string>;
/** Compiler/tooling table; not for hand-written code. @internal */
export const DOMElements: Set<string>;
/** Compiler/tooling table; not for hand-written code. @internal */
export const SVGElements: Set<string>;
/** Compiler/tooling table; not for hand-written code. @internal */
export const MathMLElements: Set<string>;
/** Compiler/tooling table; not for hand-written code. @internal */
export const VoidElements: Set<string>;
/** Compiler/tooling table; not for hand-written code. @internal */
export const RawTextElements: Set<string>;
/** Compiler/tooling table; not for hand-written code. @internal */
export const Namespaces: Record<string, string>;

type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;
export function render(
  code: () => JSX.Element,
  element: MountableElement,
  init?: JSX.Element,
  options?: { owner?: unknown }
): () => void;
/**
 * Compiler-emitted primitive; not for hand-written code.
 * @param flag
 * - `undefined` — clone the template as-is (uses `cloneNode`).
 * - `1` — use `document.importNode` instead of `cloneNode`.
 * - `2` — the template html is wrapped; the outer tag is stripped at clone time.
 * @internal
 */
export function template(html: string, flag?: 1 | 2): () => Element;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function scope<T extends () => any>(fn: T): T;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function effect<T>(fn: (prev?: T) => T, effect: (value: T, prev?: T) => void): void;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function memo<T>(fn: () => T, equal: boolean): () => T;
/**
 * Compiler-emitted primitive; not for hand-written code — import `untrack`
 * from `solid-js` instead.
 * @internal
 */
export function untrack<T>(fn: () => T): T;
/**
 * Compiler-emitted primitive; not for hand-written code.
 * @internal
 */
export function insert<T>(
  parent: MountableElement,
  accessor: (() => T) | T,
  marker?: Node | null,
  init?: JSX.Element,
  options?: {
    /**
     * Live accessor for the slot's logical host in the source tree (portals).
     * Each top-level node the slot manages is tagged with a `_$host` getter
     * backed by this accessor so delegated events retarget correctly.
     */
    host?: () => Node | null;
    /** Defer the insert effect to the queue instead of running it inline. */
    schedule?: boolean;
  }
): JSX.Element;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function createComponent<T>(Comp: (props: T) => JSX.Element, props: T): JSX.Element;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function delegateEvents(eventNames: string[]): void;
/** Event-delegation plumbing (Portal/custom-root wiring). Integration plumbing. @internal */
export function registerDelegatedRoot(root: MountableElement): void;
/** Event-delegation plumbing (Portal/custom-root wiring). Integration plumbing. @internal */
export function unregisterDelegatedRoot(root: MountableElement): void;
/** Event-delegation plumbing (Portal/custom-root wiring). Integration plumbing. @internal */
export function registerDelegatedContainer(
  container: MountableElement,
  owner?: MountableElement
): void;
/** Event-delegation plumbing (Portal/custom-root wiring). Integration plumbing. @internal */
export function unregisterDelegatedContainer(
  container: MountableElement,
  owner?: MountableElement
): void;
/** Event-delegation plumbing (Portal/custom-root wiring). Integration plumbing. @internal */
export function getDelegatedRoot(node: MountableElement): MountableElement | undefined;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function spread<T>(node: Element, accessor: T, skipChildren?: Boolean): void;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function assign(
  node: Element,
  props: any,
  skipChildren?: Boolean,
  prevProps?: any,
  skipRef?: Boolean
): void;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function setAttribute(node: Element, name: string, value: string): void;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function setAttributeNS(node: Element, namespace: string, name: string, value: string): void;
/**
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
 * Claim `node` for registered consumers (see `registerElementClaim`).
 * Emitted by the compiler at element creation; idempotent by contract.
 * @internal
 */
export function claimElement<T extends Element>(node: T): T;
/**
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
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function className(node: Element, value: JSX.ClassValue, prev?: JSX.ClassValue): void;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function setProperty(node: Element, name: string, value: any): void;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function setStyleProperty(node: Element, name: string, value: any): void;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function addEvent(
  node: Element,
  name: string,
  handler: EventListener | EventListenerObject | (EventListenerObject & AddEventListenerOptions),
  delegate: boolean
): void;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function style(
  node: Element,
  value: { [k: string]: string },
  prev?: { [k: string]: string }
): void;
/**
 * Compiler-emitted primitive; not for hand-written code — import `getOwner`
 * from `solid-js` instead.
 * @internal
 */
export function getOwner(): unknown;
/**
 * Compiler-emitted prop-spread helper; not for hand-written code — import
 * `merge` from `solid-js` instead.
 * @internal
 */
export function mergeProps(...sources: unknown[]): unknown;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function dynamicProperty(props: unknown, key: string): unknown;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function applyRef<T extends Element = Element>(
  r: ((element: NoInfer<T>) => void) | ((element: NoInfer<T>) => void)[],
  element: T
): void;
/** Compiler-emitted primitive; not for hand-written code. @internal */
export function ref(
  fn: () => ((element: Element) => void) | ((element: Element) => void)[],
  element: Element
): void;

export function hydrate(
  fn: () => JSX.Element,
  node: MountableElement,
  options?: { renderId?: string; owner?: unknown }
): () => void;
/** Hydration-walk primitive; not for hand-written code. @internal */
export function getHydrationKey(): string | undefined;
/** Hydration-walk primitive; not for hand-written code. @internal */
export function getNextElement(template?: () => Element): Element;
/** Hydration-walk primitive; not for hand-written code. @internal */
export function getNextMatch(start: Node, elementName: string): Element;
/** Hydration-walk primitive; not for hand-written code. @internal */
export function getNextMarker(start: Node): [Node, Array<Node>];
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
/**
 * Registers head tags with the ambient head registry under the current
 * owner. An array is a group — one replacement set; a function is a
 * reactive group whose membership is tracked and re-read on change.
 * Resolution is last-committed group per identity (reactive updates keep
 * the registration's original commit position); disposal restores the
 * previous winner. During hydration the server-flushed head state stays
 * authoritative until hydration completes. See docs/head-management-rfc.md.
 */
export function useHead(tag: HeadTag | HeadTag[] | (() => HeadTag | HeadTag[])): void;
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
 * @internal Ref-counted client asset ownership: acquire adopts or mounts the
 * asset, the returned release follows the owner (with a grace period for
 * back-and-forth navigation). Internal machinery, not a public CSS-lifecycle
 * API — per the head-management RFC (docs/head-management-rfc.md), ambient
 * bundler-injected CSS is never lifecycle-managed, and the head registry
 * owns the lifecycle of directly-mounted stylesheets outright. This keeps
 * its non-head roles (exclusive slots, owner-following DOM ownership).
 */
export function acquireAsset(descriptor: AssetDescriptor): () => void;
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
 * @internal Warm half of `acquireAsset`: idempotent and refcount-free,
 * callable from a compute phase so the fetch starts at discovery and
 * overlaps a transition's data wait. Stylesheets warm as
 * `rel="preload" as="style"` and are flipped live by `acquireAsset` at
 * commit — a branch superseded before it commits leaks only an inert
 * preload, never an applied sheet. Only link-backed descriptors warm;
 * inline styles and exclusive slots return `undefined`.
 */
export function warmAsset(descriptor: AssetDescriptor): AssetEntry | undefined;
/**
 * @internal Client CSS reveal gate: reading an unsettled asset promise
 * throws NotReadyError so tracked contexts hold and retry on settle.
 */
export function waitAsset(promise: Promise<unknown>): void;
export function HydrationScript(props?: { nonce?: string; eventNames?: string[] }): JSX.Element;
export function generateHydrationScript(options?: {
  nonce?: string;
  eventNames?: string[];
}): string;
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
export interface RequestEvent {
  request: Request;
  locals: RequestEventLocals;
}
/**
 * Registered symbol (`Symbol.for("solid.RequestContext")`) naming the global
 * slot where `provideRequestEvent` parks the AsyncLocalStorage scoping
 * request events. Integration plumbing — read the event through
 * `getRequestEvent()` instead.
 * @internal
 */
export declare const RequestContext: unique symbol;
export function getRequestEvent(): RequestEvent | undefined;
/**
 * The cookie codec (the platform-gap primitives — see cookies.d.ts for the
 * blessed patterns): the real implementation on both entries, never a
 * stub — a pure value transformer has legitimate browser uses
 * (`document.cookie`). Tree-shakes away when unused.
 */
export { parseCookieHeader, serializeCookie } from "./cookies.js";
export type { CookieOptions } from "./cookies.js";
/**
 * The flash cookie's isomorphic half (name/detection/clearing — cookie
 * utilities living beside the cookie codec) and the codec-free
 * server-function layer (reference detection + the late-bound RPC seam).
 * On the core entries so integrations consuming them eagerly (routers)
 * never import the server-functions entry — whose client half is the
 * transport + codec — from their eager graph. Declared through
 * server-functions/shared.d.ts, the declaration home published-types
 * layouts ship.
 */
export {
  clearFlashCookie,
  getServerFunctionMetadata,
  getServerFunctionRPC,
  hasFlashCookie,
  isServerFunction
} from "./server-functions/shared.js";
export type {
  ServerFunction,
  ServerFunctionMetadata,
  ServerFunctionRPC
} from "./server-functions/shared.js";
/** Hydration-walk primitive; not for hand-written code. @internal */
export function runHydrationEvents(): void;
