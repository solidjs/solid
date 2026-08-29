// @ts-nocheck
import { ChildProperties } from "./constants.js";
import {
  sharedConfig,
  createRoot as root,
  ssrHandleError,
  getOwner,
  runWithOwner,
  creationStamp,
  inServerComponentScope,
  createComponent,
  untrack,
  merge as mergeProps,
  ssrScope as scope
} from "solid-js";
import { effect, memo } from "./render.js";
import {
  createHydrationSerializer,
  getLocalHeaderScript
} from "../serialization/src/serializer.js";
// Wire-protocol header names for the commit fold's gap-fill denylist
// (`commitEventResponse`): shared constants, not copies, so the fold can
// never drift from what the server-function handler actually sends.
import { REVALIDATE_HEADER } from "./response.js";
import {
  BODY_FORMAT_HEADER,
  ERROR_HEADER,
  REDIRECT_HEADER,
  SINGLE_FLIGHT_HEADER
} from "../server-functions/src/shared.js";
// The cookie codec (the platform-gap primitives — see cookies.js for the
// blessed read/write patterns). Re-exported, never wrapped: core owns the
// exchange and the codec, nothing ambient.
export { parseCookieHeader, serializeCookie } from "./cookies.js";
// The flash cookie's isomorphic half and the codec-free server-function
// layer (detection + the late-bound RPC seam) — mirrors of the client
// entry's exports, so integration code reading them stays universal (see
// the client entry and server-functions/registry.js for the reasoning).
export { clearFlashCookie, hasFlashCookie } from "./cookies.js";
export {
  getServerFunctionMetadata,
  getServerFunctionRPC,
  isServerFunction
} from "../server-functions/src/registry.js";
import {
  HEAD_ELIGIBLE_TAGS,
  HEAD_ATTR_NAME,
  classifyHeadTag,
  evalHeadProps,
  evalHeadValue,
  resourceIdentity,
  replaceableIdentity,
  resolveHead,
  STYLESHEET_FETCH_META
} from "./head.js";

import { JSX } from "../jsx/jsx.js";

import { SerializerPlugin } from "../serialization/src/serializer-decode.js";

type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;

/** An explicit `<link rel="preload">` emitted by the SSR asset pipeline. */
export type PreloadLink = {
  href: string;
  as: JSX.HTMLPreloadAs;
  type?: string;
  crossorigin?: JSX.HTMLCrossorigin;
  integrity?: string;
  referrerpolicy?: JSX.HTMLReferrerPolicy;
  fetchpriority?: JSX.HTMLFetchPriority;
  media?: string;
};

/** Static asset manifest produced by a build (e.g. parsed Vite manifest.json). */
export type AssetManifest = Record<
  string,
  {
    file: string;
    css?: string[];
    isEntry?: boolean;
    imports?: string[];
    preloads?: PreloadLink[];
  }
> & { _base?: string };

/** Inline style content, e.g. dev CSS collected from a bundler's module graph. */
export type InlineStyleAsset = {
  id: string;
  content: string;
  attrs?: Record<string, string>;
};

export type ResolvedAssets = {
  js: string[];
  css: (string | InlineStyleAsset)[];
  preloads?: PreloadLink[];
};

/**
 * Resolver form of the manifest option — the primitive a dev server
 * implements against its live module graph (a static manifest object is
 * normalized into a sync resolver internally). `resolve` may return a
 * promise (async resolvers require streaming rendering); CSS entries may be
 * URL strings (emitted as load-gated `<link>` tags) or inline-style
 * descriptors (emitted as `<style>` tags), and `preloads` carries explicit
 * preload links selected by the integration. A bare `resolve`-shaped
 * function is accepted as shorthand for `{ resolve }`.
 */
export type AssetResolver = {
  resolve(
    key: string
  ): ResolvedAssets | null | undefined | Promise<ResolvedAssets | null | undefined>;
  /**
   * Synchronous fast path answering with whatever is knowable without async
   * work (typically js URLs, omitting css). Sync consumers — e.g. a lazy
   * component's `moduleUrl` getter used by islands — use this when `resolve`
   * would return a promise, so adapters should provide it whenever possible.
   */
  resolveSync?(key: string): ResolvedAssets | null | undefined;
};

/** Bare-function shorthand for `AssetResolver` (no sync fast path). */
export type AssetResolverFn = (
  key: string
) => ResolvedAssets | null | undefined | Promise<ResolvedAssets | null | undefined>;

/**
 * CSP nonce for the tags a server render emits. A string applies to both
 * nonce-aware destinations. A `{ script, style }` pair routes each tag to
 * the directive governing its fetch (`script-src-elem` / `style-src-elem`,
 * falling back to `script-src` / `style-src` then `default-src`). Both
 * keys are required; `false` leaves that destination un-nonced. Worker
 * destinations take the script nonce, which only applies when their own
 * fallback reaches `script-src`. A nonce on a `useHead` tag's own props
 * always wins.
 *
 * Only `renderToString` / `renderToStream` take this shape. Surfaces that
 * emit one script (`HydrationScript`, `generateHydrationScript`,
 * `createSSRResponse`) take a string — project with `scriptNonce`.
 */
export type CSPNonce = string | { script: string | false; style: string | false };

/**
 * A head tag descriptor. Props values may be getters (evaluated lazily on
 * the server — at the owning flush boundary — and reactively on the client);
 * `children` is the text body (title text, inline style/script content).
 * `key` overrides the built-in dedupe identity (`title` is a hard singleton
 * that `key` cannot fork).
 *
 * Getters must be plain reads: they evaluate at flush time here (under no
 * component owner) and inside registry-owned computations on the client, so
 * a getter that allocates a reactive owner (`createMemo`, a `children()`
 * helper) consumes a hydration id slot on one side only and desyncs every
 * id allocated after the `useHead` call. Create such helpers eagerly at
 * component position and read them from the getter. See
 * docs/head-management-rfc.md.
 */
export type HeadTag = {
  tag: "title" | "meta" | "link" | "style" | "script" | "base";
  props: Record<string, any>;
  key?: string | (() => string);
};

/**
 * The mutable response head an integration's handler exposes on the request
 * event as `event.response`: status/statusText/headers it will apply when
 * sending the response. A scaffold, not a `Response` — application code
 * (e.g. JSX response components) writes to it during render, and the
 * handler reads it when the head goes out. Core does not declare the
 * `response` property on `RequestEvent` itself: integrations that provide
 * one declare it through module augmentation (as `@solidjs/router` does),
 * and this type names the shape they agree on. Core's server-function
 * handler folds it onto the outgoing response when present — its
 * `Set-Cookie` values (cookies appended during the call via
 * `serializeCookie`) append cookie-by-cookie, other headers fill gaps —
 * and reads it when folding single-flight cookies, but never requires it.
 */
export interface ResponseStub {
  status?: number;
  statusText?: string;
  headers: Headers;
  /**
   * Set once the response head has been derived/sent from this stub —
   * status and headers can no longer change. Flip it through
   * `commitResponseStub`, which also instruments the stub's `headers` so
   * a post-commit write fails loudly (dev build throws, production
   * reports + no-ops) instead of silently missing the wire. `status`/
   * `statusText` stay plain fields: consumers that write response
   * metadata during render (e.g. JSX response components) must still
   * treat later status writes and cleanup-time retractions as no-ops.
   */
  committed?: boolean;
}

/**
 * The type of `RequestEvent.locals` — a module-augmentable interface so
 * applications can type the state their middleware hangs on the event.
 * Augment it through the package that re-exports the event (interface
 * identity flows through the re-export chain):
 *
 * ```ts
 * declare module "@solidjs/web" {
 *   interface RequestEventLocals {
 *     user: User;
 *   }
 * }
 * ```
 *
 * The index signature keeps un-augmented usage permissive — `locals` is a
 * free-form bag by default — so augmentation adds precision for the keys
 * it names without gating existing code. The flip side: unaugmented keys
 * read as `any` rather than erroring, a deliberate trade (a strict-only
 * `locals` would break every untyped write that works today).
 */
export interface RequestEventLocals {
  [key: string | number | symbol]: any;
}

/**
 * The per-request context available on the server: the incoming `Request`
 * and a `locals` bag integrations and middleware can hang state on (typed
 * through the augmentable `RequestEventLocals`). Frameworks typically
 * extend this shape with richer fields (e.g. a `response` head — see
 * `ResponseStub`).
 */
export interface RequestEvent {
  request: Request;
  locals: RequestEventLocals;
}

export type { CookieOptions } from "./cookies.js";

export type {
  ServerFunction,
  ServerFunctionMetadata,
  ServerFunctionRPC
} from "../server-functions/src/shared.js";

export interface SSRResponseOptions {
  /** Base head; the stub's status/headers win over it. */
  responseInit?: ResponseInit;
  /** Nonce carried by the post-flush `<script>` redirect fallback. */
  nonce?: string;
  /** Rewrites each outgoing HTML chunk (entry script injection, ...). */
  transformChunk?: (chunk: string) => string;
}

/**
 * Fetch-style middleware: return a `Response` to answer the request, or
 * call `next()` (optionally with a substitute `Request`) to advance the
 * chain and observe/replace the eventual response.
 */
export type FetchMiddleware = (
  request: Request,
  next: (request?: Request) => Promise<Response>
) => Response | Promise<Response>;

// `mergeProps` comes from the framework like the client/universal entries —
// prop-merge semantics (function sources, precedence) belong to the reactive
// core, and a local copy here drifts from them (it resolved function sources
// for key enumeration only, dropping their values in SSR output).
export { createComponent, effect, memo, untrack, mergeProps, scope, getOwner };
// Read by compiled SSR output under the `serverComponents` compiler option:
// the claims-gate guard (`sharedConfig.context.claims ? ssrClaim(...) : ""`)
// needs the shared render context at template-evaluation time.
export { sharedConfig };

export {
  DOMWithState,
  ChildProperties,
  DOMElements,
  SVGElements,
  MathMLElements,
  VoidElements,
  RawTextElements,
  Namespaces,
  DelegatedEvents
} from "./constants.js";

// ---- Asset Manifest ----

// Join defensively rather than trusting the manifest's shape: dev manifests
// have answered `_base` with non-strings and emitted `file` values with a
// leading slash (solidjs/solid#2817 layers 1-2). Normalizing here keeps the
// emitted URLs sane for any reasonable manifest instead of playing contract
// ping-pong with bundler plugins.
function joinAssetPath(base, file) {
  // absolute (`https://cdn/x.js`) and protocol-relative (`//cdn/x.js`) pass through
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(file)) return file;
  if (typeof base !== "string" || !base) base = "/";
  if (base[base.length - 1] !== "/") base += "/";
  return base + (file[0] === "/" ? file.slice(1) : file);
}

function resolveAssets(moduleUrl, manifest) {
  if (!manifest) return null;
  const base = manifest._base;
  const entry = manifest[moduleUrl];
  if (!entry) return null;
  const css = [];
  const js = [];
  let preloads;
  const visited = new Set();
  const walk = key => {
    if (visited.has(key)) return;
    visited.add(key);
    const e = manifest[key];
    if (!e) return;
    js.push(joinAssetPath(base, e.file));
    if (e.css) for (let i = 0; i < e.css.length; i++) css.push(joinAssetPath(base, e.css[i]));
    if (e.preloads) {
      for (let i = 0; i < e.preloads.length; i++) {
        const link = e.preloads[i];
        if (!link || typeof link.href !== "string" || !link.href) continue;
        if (!preloads) preloads = [];
        preloads.push({ ...link, href: joinAssetPath(base, link.href) });
      }
    }
    if (e.imports) for (let i = 0; i < e.imports.length; i++) walk(e.imports[i]);
  };
  walk(moduleUrl);
  const assets = { js, css };
  if (preloads) assets.preloads = preloads;
  return assets;
}

function registerEntryAssets(manifest) {
  // Resolver manifests can't be enumerated for entries; consumers that want
  // SSR'd entry assets resolve their entry key themselves.
  if (!manifest || typeof manifest === "function" || typeof manifest.resolve === "function") return;
  const ctx = sharedConfig.context;
  if (!ctx?.registerAsset) return;
  for (const key in manifest) {
    if (manifest[key].isEntry) {
      const assets = resolveAssets(key, manifest);
      if (assets) {
        if (assets.preloads)
          for (let i = 0; i < assets.preloads.length; i++)
            ctx.registerAsset("preload", assets.preloads[i]);
        for (let i = 0; i < assets.css.length; i++) ctx.registerAsset("style", assets.css[i]);
        // js[0] is the entry itself, which the document loads with its own <script>;
        // preload only its static import closure.
        for (let i = 1; i < assets.js.length; i++) ctx.registerAsset("module", assets.js[i]);
      }
      return;
    }
  }
}

// ---- Asset Tracking ----

function createAssetTracking() {
  const boundaryModules = new Map();
  const boundaryStyles = new Map();
  const emittedAssets = new Set();
  const inlineStyles = new Map();
  let currentBoundaryId = null;
  return {
    boundaryModules,
    boundaryStyles,
    emittedAssets,
    inlineStyles,
    preloadLinks: null,
    // Inline styles (dev CSS collected from the module graph, critical CSS)
    // dedupe by `id` — repeated registrations reuse the same entry object so
    // boundary Sets and the head injection never emit the same style twice.
    registerInlineStyle(desc) {
      let entry = inlineStyles.get(desc.id);
      if (!entry) {
        entry = { id: desc.id, content: desc.content || "", attrs: desc.attrs, emitted: false };
        inlineStyles.set(desc.id, entry);
      }
      if (currentBoundaryId) {
        let styles = boundaryStyles.get(currentBoundaryId);
        if (!styles) {
          styles = new Set();
          boundaryStyles.set(currentBoundaryId, styles);
        }
        styles.add(entry);
      }
      return entry;
    },
    get currentBoundaryId() {
      return currentBoundaryId;
    },
    set currentBoundaryId(v) {
      currentBoundaryId = v;
    },
    // `key` is opaque to the runtime — the reactive library's server-side
    // lazy() picks it (e.g. a hydration id) and its client-side counterpart
    // looks preloaded modules up under the same key after loadModuleAssets.
    registerModule(key, entryUrl) {
      const id = currentBoundaryId || "";
      let map = boundaryModules.get(id);
      if (!map) {
        map = {};
        boundaryModules.set(id, map);
      }
      map[key] = entryUrl;
    },
    getBoundaryModules(id) {
      return boundaryModules.get(id) || null;
    },
    getBoundaryStyles(id) {
      return boundaryStyles.get(id) || null;
    }
  };
}

// Manifest contract guard. When `context.resolveAssets` answers null/undefined
// or with no client js entries for a module the render asked about,
// server-side lazy() has nothing to file into the hydration asset map
// (`registerModule` is never reached on a miss), the client cannot preload
// the module, and hydration fails far from the cause with a cryptic
// `lazy() module "…" was not preloaded before hydration` error. The
// resolution seam is the one choke point every consumer (solid's lazy,
// frames) passes through and the only place the miss is still observable —
// recording/serialization never sees the module at all. The warning is
// unconditional (the server bundle has no dev build variant, and an
// unanswered lookup for a rendered module is never benign in a hydrating
// render). Known scoping:
// - `noScripts` renders ship no hydration data (nothing can break), so the
//   caller skips the guard entirely.
// - `resolveAssetsSync` stays unguarded: sync probes (a lazy component's
//   `moduleUrl` getter) legitimately probe modules that may not resolve and
//   have graceful fallbacks.
// - A NoHydration/islands zone could one day legitimately resolve modules
//   absent from the client manifest (nothing hydrates there), but that scope
//   is invisible at this seam and no supported integration produces it today
//   (dev resolvers always answer; islands remain experimental). Revisit if
//   that changes.
function warnUnresolvedModuleAssets(moduleUrl, warned) {
  if (warned.has(moduleUrl)) return;
  warned.add(moduleUrl);
  console.error(
    `Asset manifest returned no client assets for module "${moduleUrl}". ` +
      "If this module is a server-rendered lazy() component, its entry will be missing from " +
      "the serialized hydration asset map, the client will be unable to preload it, and " +
      "hydration will fail with 'lazy() module \"…\" was not preloaded before hydration'. " +
      "This means the integration's asset resolver (dev manifest bridge or build client " +
      "manifest) failed to answer for this module — check the integration's server logs, " +
      "restart the dev server, or verify the module is included in the client build."
  );
}

function guardResolvedAssets(moduleUrl, result, warned) {
  if (result && typeof result.then === "function") {
    return result.then(assets => {
      if (!assets || !assets.js || !assets.js.length) warnUnresolvedModuleAssets(moduleUrl, warned);
      return assets;
    });
  }
  if (!result || !result.js || !result.js.length) warnUnresolvedModuleAssets(moduleUrl, warned);
  return result;
}

function applyAssetTracking(context, tracking, manifest, noScripts) {
  // Deduped per render: one warning per module, however many times it renders.
  const warned = new Set();
  const guard = noScripts
    ? resolve => resolve
    : resolve => moduleUrl => guardResolvedAssets(moduleUrl, resolve(moduleUrl), warned);
  Object.defineProperty(context, "_currentBoundaryId", {
    get() {
      return tracking.currentBoundaryId;
    },
    set(v) {
      tracking.currentBoundaryId = v;
    },
    configurable: true,
    enumerable: true
  });
  context.registerModule = tracking.registerModule;
  context.getBoundaryModules = tracking.getBoundaryModules;
  // A manifest can be the static object produced by a build (sync lookups,
  // entry enumeration) or a resolver — the primitive a dev server implements
  // against its live module graph: `{ resolve, resolveSync? }`, where
  // `resolve` may return a promise and may resolve css entries to
  // inline-style descriptors instead of URLs, and `resolveSync` answers with
  // what is knowable without async work (for sync consumers like a lazy
  // component's moduleUrl getter). A bare function is accepted as shorthand
  // for `{ resolve }`. Callers (the reactive library's lazy()) handle both
  // result shapes. Static manifests are sync by nature, so both context
  // paths point at the same lookup.
  if (typeof manifest === "function") {
    context.resolveAssets = guard(manifest);
  } else if (manifest && typeof manifest.resolve === "function") {
    context.resolveAssets = guard(key => manifest.resolve(key));
    if (typeof manifest.resolveSync === "function") {
      context.resolveAssetsSync = key => manifest.resolveSync(key);
    }
  } else if (manifest) {
    const resolve = moduleUrl => resolveAssets(moduleUrl, manifest);
    context.resolveAssets = guard(resolve);
    context.resolveAssetsSync = resolve;
  }
}

// ---- Head Management (useHead) ----
//
// Server half of the head registry (design: docs/head-management-rfc.md).
// Replaceable tags are recorded at registration and evaluated at the flush of
// their nearest enclosing flush boundary — the shell, or the owning suspense
// fragment (attributed via the same `_currentBoundaryId` seam as boundary
// asset tracking). Resource-class tags (preload/preconnect/… links,
// `script[src]`) evaluate immediately and stream eagerly: their value is
// earliness, so holding them for their boundary's flush would defeat them.

// Stylesheet-vs-module classification for tracked asset URLs. Dev servers
// commonly serve CSS with cache-busting queries (`/src/foo.css?t=…`), so the
// suffix test runs against the path portion only.
function isCssUrl(url) {
  const q = url.search(/[?#]/);
  return (q === -1 ? url : url.slice(0, q)).endsWith(".css");
}

const PRELOAD_LINK_ATTRIBUTES = [
  "type",
  "crossorigin",
  "integrity",
  "referrerpolicy",
  "fetchpriority",
  "media"
];

// Normalize once for document/frame output and dedupe with useHead resources.
function registerPreloadLink(tracking, headRegistry, link, nonce) {
  if (!link || typeof link !== "object" || typeof link.href !== "string" || !link.href) {
    if ("_SOLID_DEV_") console.warn('registerAsset("preload") requires a non-empty string href.');
    return null;
  }
  if (typeof link.as !== "string") {
    if ("_SOLID_DEV_") console.warn('registerAsset("preload") requires an as destination.');
    return null;
  }
  const as = asciiLowerCase(link.as);
  let destination = null;
  switch (as) {
    case "script":
    case "style":
      destination = as;
      break;
    case "fetch":
    case "font":
    case "image":
    case "track":
      break;
    default:
      if ("_SOLID_DEV_")
        console.warn(
          `registerAsset("preload") received an unsupported as destination "${link.as}".`
        );
      return null;
  }
  const props = { rel: "preload", href: link.href, as };
  for (let i = 0; i < PRELOAD_LINK_ATTRIBUTES.length; i++) {
    const name = PRELOAD_LINK_ATTRIBUTES[i];
    const value = link[name];
    if (value == null || value === false) continue;
    props[name] = value === true ? "" : String(value);
  }
  const identity = resourceIdentity("link", props);
  if (headRegistry.resources.has(identity)) return null;
  // A different CORS or credentials mode has a different preload key.
  if ("_SOLID_DEV_" && props.crossorigin == null && (as === "font" || as === "fetch"))
    console.warn(
      `registerAsset("preload") with as="${as}" has no crossorigin and may not match the eventual request.`
    );

  const attrs = headAttrRecord(props, true);
  const nonceValue = destination && nonce && nonce[destination];
  if (typeof nonceValue === "string" && nonceValue) attrs.nonce = nonceValue;
  const entry = {
    href: props.href,
    attrs,
    attrHtml: renderHeadAttrHtml(props) + nonceAttr(nonce, destination)
  };
  headRegistry.resources.add(identity);
  let links = tracking.preloadLinks;
  if (!links) tracking.preloadLinks = links = [];
  links.push(entry);
  return entry;
}

function createHeadRegistry() {
  return {
    pending: [], // { boundary, tags: [raw descriptor (+ peeked link rel)] }
    committed: [], // { seq, tags: [{ tag, props, identity }] } in commit order
    seq: 0,
    uniq: 0,
    resources: new Set(), // resource identities already emitted
    eagerHtml: "", // pre-shell resource markup, joined into the shell head
    flushed: null, // Map<identity, signature> — post-shell resolution snapshot
    shellFlushed: false,
    parkedResources: [] // root resources pending at registration; drained by headShellReady
  };
}

// Registration entry point (context.registerHeadTags). `emitResource` is the
// post-shell eager write channel (null in renderToString, where everything is
// pre-shell by construction).
function registerHeadTags(registry, context, tracking, emitResource, nonce, tags) {
  const boundary = context._currentBoundaryId || "";
  if (typeof tags === "function") {
    // Reactive group: membership resolves at the boundary's flush, the same
    // moment as prop getters — component-level grouping composes its list
    // after registration (children register during their own render), so the
    // list cannot be read here. Resource tags inside a deferred group
    // evaluate at that flush too (trading earliness for late membership) and
    // take the plain eager path: parking a reveal-gate entry on a boundary
    // that is mid-flush is an ordering hazard, so gating is skipped.
    registry.pending.push({
      boundary,
      list: tags,
      resource: (desc, rel) =>
        emitHeadResource(registry, context, tracking, emitResource, nonce, desc, rel)
    });
    return;
  }
  if (!Array.isArray(tags)) tags = [tags];
  // Readiness probe, gated to Loading discovery passes (`_loadingPhase` is
  // set by the reactive library's boundary runner — the only render phase
  // with a retryable NotReady catch). Head props are lazy descriptors that
  // nothing reads during render, so an async value (`<title>{data()}</title>`)
  // would otherwise never suspend its enclosing boundary: the tag commits at
  // flush, where the pending read throws and the tag is warn-dropped. Probing
  // here rethrows NotReady into the discovery pass so the boundary suspends
  // like any other async content; the boundary retries once settled and the
  // re-registration sees ready values. The probe result is discarded — flush
  // evaluation stays authoritative, so boundary-scoped getters (the CSS
  // collector window) evaluate twice with the flush value winning. The flag
  // must be read from `sharedConfig.context`: Loading runs under an
  // `Object.create`d buffered context, so an own property there is invisible
  // from the base context captured by the render entry point. Outside a
  // Loading pass a NotReady has no retryable catch at component-argument
  // position (compiled SSR evaluates components eagerly as template
  // arguments), so probing would start a never-settling retry loop in
  // whatever wider scope re-renders (#2809's shape) — root-owned pending
  // props instead hold the streaming shell at flush time (headShellReady),
  // and renderToString keeps the flush-time warn-and-drop path.
  const probe = sharedConfig.context && sharedConfig.context._loadingPhase;
  let replaceable = null;
  for (let i = 0; i < tags.length; i++) {
    const desc = tags[i];
    if (!desc || !HEAD_ELIGIBLE_TAGS.has(desc.tag)) {
      if ("_SOLID_DEV_") console.warn(`useHead: ignoring non-head tag`, desc);
      continue;
    }
    const cls = classifyHeadTag(desc);
    if (probe && !cls.resource) {
      try {
        evalHeadProps(desc.props || {}, cls.rel !== undefined ? { rel: cls.rel } : undefined);
        evalHeadValue(desc.key);
      } catch (err) {
        // NotReady (ssrHandleError answers its promise): abort the pass so
        // the boundary suspends; nothing from this pass is registered.
        // Other errors route through ssrHandleError's handler chain like
        // any render error.
        if (ssrHandleError(err)) throw err;
      }
    }
    if (cls.resource) {
      emitHeadResource(registry, context, tracking, emitResource, nonce, desc, cls.rel);
    } else {
      (replaceable || (replaceable = [])).push(
        cls.rel !== undefined
          ? { tag: desc.tag, props: desc.props, key: desc.key, rel: cls.rel }
          : desc
      );
    }
  }
  if (replaceable) registry.pending.push({ boundary, tags: replaceable });
}

// Shell-attempt readiness pass for root-owned head registrations (called by
// doShell, same contract as resolveRootHoles): root-level async head props
// hold the shell instead of warn-dropping — the implicit-blocker semantics
// every other root-level async already has. A pending read adds its source
// to the shell's blocking set via `block` and reports not-ready; the flush
// loop re-awaits and re-attempts, which also covers chained pendings (each
// attempt blocks on whatever the getter pends on now) — exactly how root
// content holes retry. Descriptors stay lazy: this pass discards its reads
// and the shell commit stays authoritative, so real errors keep the
// commit-time warn-and-drop path. Parked root resources (see
// emitHeadResource) emit here as soon as their props read clean, and
// warn-drop on a real error. Function-form groups are never probed
// (membership getters compose after registration and must resolve exactly
// once, at commit).
function headShellReady(registry, block) {
  let ready = true;
  const pends = err => {
    const source = ssrHandleError(err, true);
    if (!source) return false;
    block(source);
    ready = false;
    return true;
  };
  const parked = registry.parkedResources;
  for (let i = parked.length - 1; i >= 0; i--) {
    const { desc, rel, emit } = parked[i];
    try {
      evalHeadProps(desc.props || {}, rel !== undefined ? { rel } : undefined);
    } catch (err) {
      if (pends(err)) continue;
      if ("_SOLID_DEV_") console.warn(`useHead: error evaluating resource tag props`, err);
      parked.splice(i, 1);
      continue;
    }
    parked.splice(i, 1);
    emit();
  }
  for (let i = 0; i < registry.pending.length; i++) {
    const reg = registry.pending[i];
    if (reg.boundary !== "" || reg.list) continue;
    for (let j = 0; j < reg.tags.length; j++) {
      const desc = reg.tags[j];
      try {
        evalHeadProps(desc.props || {}, desc.rel !== undefined ? { rel: desc.rel } : undefined);
        evalHeadValue(desc.key);
      } catch (err) {
        // Real errors: the commit-time warn-and-drop stays authoritative.
        pends(err);
      }
    }
  }
  return ready;
}

// Resource-class tag: evaluate now, dedupe by full resource identity, emit at
// the next flush opportunity. Plain stylesheet/modulepreload links (rel+href
// only) route through `registerAsset` so they share one identity set with
// manifest-driven asset emission — a user-authored preload must never
// duplicate a manifest link — and, for stylesheets, participate in the
// style-gated fragment reveal like tracked boundary CSS.
//
// Other stylesheets split by what their extra attributes mean: fetch metadata
// (crossorigin, integrity, …) doesn't change render-criticality, so those
// sheets — and plain sheets whose URL fails the `.css` suffix test the
// tracked path needs — carry their attributes through the boundary style set
// and gate fragment reveal like tracked CSS. Condition-changing attributes
// (media, alternate, disabled) take the ungated eager path: gating a reveal
// on a sheet that may never apply would block content on a low-priority
// fetch. Non-stylesheet resources (hints, scripts) always emit eagerly.
function emitHeadResource(registry, context, tracking, emitResource, nonce, desc, rel) {
  let props;
  try {
    props = evalHeadProps(desc.props || {}, rel !== undefined ? { rel } : undefined);
  } catch (err) {
    // In a Loading discovery pass a pending read suspends the boundary
    // (see the readiness probe in registerHeadTags); the retry re-emits
    // with ready values and identity dedupe absorbs any repeats.
    const loadingPhase = sharedConfig.context && sharedConfig.context._loadingPhase;
    if (loadingPhase && ssrHandleError(err)) throw err;
    // Root-owned pending read before the shell of a streaming render: park
    // the emission for the shell readiness pass (headShellReady), which
    // blocks the shell on the source and emits once the props read clean.
    if (
      !loadingPhase &&
      !context._currentBoundaryId &&
      !registry.shellFlushed &&
      typeof context.block === "function" &&
      ssrHandleError(err, true)
    ) {
      registry.parkedResources.push({
        desc,
        rel,
        emit: () => emitHeadResource(registry, context, tracking, emitResource, nonce, desc, rel)
      });
      return;
    }
    if ("_SOLID_DEV_") console.warn(`useHead: error evaluating resource tag props`, err);
    return;
  }
  const identity = resourceIdentity(desc.tag, props);
  if (registry.resources.has(identity)) return;
  registry.resources.add(identity);
  if (desc.tag === "link" && (rel === "stylesheet" || rel === "modulepreload")) {
    let plain = true;
    let gateable = rel === "stylesheet";
    for (const name in props) {
      if (name === "rel" || name === "href") continue;
      plain = false;
      if (!STYLESHEET_FETCH_META.has(name)) gateable = false;
    }
    // The asset-tracking emitters decide stylesheet-vs-modulepreload by the
    // `.css` suffix, so only suffix-conforming URLs can ride that path.
    if (plain && props.href != null) {
      const isCss = isCssUrl(props.href);
      if (rel === "stylesheet" ? isCss : !isCss) {
        context.registerAsset(rel === "stylesheet" ? "style" : "module", props.href);
        return;
      }
    }
    if (gateable && props.href != null) {
      const attrHtml = renderHeadAttrHtml(props);
      // `attrs` is the wire/DOM form (frame sink chunks, client adoption);
      // `attrHtml` is the pre-escaped document-sink form. `attrHtml` also
      // discriminates this shape from inline-style entries in the boundary
      // style set.
      const entry = { href: props.href, attrHtml, attrs: headAttrRecord(props, true) };
      if (tracking.currentBoundaryId) {
        let styles = tracking.boundaryStyles.get(tracking.currentBoundaryId);
        if (!styles) tracking.boundaryStyles.set(tracking.currentBoundaryId, (styles = new Set()));
        styles.add(entry);
      }
      const markup = `<link${attrHtml}${nonceAttr(nonce, "style")}>`;
      if (emitResource) emitResource(markup, entry);
      else {
        registry.eagerHtml += markup;
        entry.emitted = true;
      }
      return;
    }
  }
  const url = props.href || props.src;
  if (url != null && tracking.emittedAssets.has(url)) return;
  const markup = renderHeadTagMarkup(desc.tag, props, null, nonce);
  if (emitResource) emitResource(markup);
  else registry.eagerHtml += markup;
}

// Moves pending registrations for `boundary` into the committed list,
// evaluating props getters exactly once (this is the evaluation-timing
// contract: a deferred getter's collection window is its boundary's render).
// The shell ("" with an `isPendingFragment` probe) commits everything that
// does not belong to a still-pending fragment — including registrations from
// boundaries that resolved before first flush and inlined into the shell.
function commitHeadBoundary(registry, boundary, isPendingFragment) {
  const keep = [];
  const groups = [];
  for (let i = 0; i < registry.pending.length; i++) {
    const reg = registry.pending[i];
    const mine =
      boundary === ""
        ? !(isPendingFragment && reg.boundary !== "" && isPendingFragment(reg.boundary))
        : reg.boundary === boundary;
    if (!mine) {
      keep.push(reg);
      continue;
    }
    let descs = reg.tags;
    if (reg.list) {
      // Deferred group membership (see registerHeadTags): resolve the list
      // now, classify, and route resources through the registration-time
      // emission channel.
      let resolved;
      try {
        resolved = reg.list();
      } catch (err) {
        if ("_SOLID_DEV_") console.warn(`useHead: error evaluating head group membership`, err);
        continue;
      }
      if (!Array.isArray(resolved)) resolved = [resolved];
      descs = [];
      for (let j = 0; j < resolved.length; j++) {
        const desc = resolved[j];
        if (!desc || !HEAD_ELIGIBLE_TAGS.has(desc.tag)) {
          if ("_SOLID_DEV_") console.warn(`useHead: ignoring non-head tag`, desc);
          continue;
        }
        const cls = classifyHeadTag(desc);
        if (cls.resource) {
          reg.resource(desc, cls.rel);
        } else {
          descs.push(
            cls.rel !== undefined
              ? { tag: desc.tag, props: desc.props, key: desc.key, rel: cls.rel }
              : desc
          );
        }
      }
    }
    const tags = [];
    for (let j = 0; j < descs.length; j++) {
      const desc = descs[j];
      let props, key;
      try {
        props = evalHeadProps(
          desc.props || {},
          desc.rel !== undefined ? { rel: desc.rel } : undefined
        );
        key = evalHeadValue(desc.key);
      } catch (err) {
        if ("_SOLID_DEV_") console.warn(`useHead: error evaluating tag props`, err);
        continue;
      }
      const identity = replaceableIdentity(desc.tag, props, key, "u:" + registry.uniq++);
      if ((identity === "base" || identity === "charset") && registry.shellFlushed) {
        // Shell-only: a charset that changes mid-stream or a base that
        // changes after relative URLs resolved is incoherent by definition.
        if ("_SOLID_DEV_")
          console.warn(
            `useHead: <${desc.tag}> (${identity}) registered after shell flush is ignored`
          );
        continue;
      }
      tags.push({ tag: desc.tag, props, identity });
    }
    if (tags.length) groups.push({ seq: registry.seq++, tags });
  }
  registry.pending = keep;
  for (let i = 0; i < groups.length; i++) registry.committed.push(groups[i]);
  return groups;
}

// Reassigns a resolved child fragment's pending registrations to the parent
// that absorbed its payload (waitForFragments), so they evaluate and commit
// at the parent's flush — the nearest boundary that actually flushes.
function adoptHeadBoundary(registry, childKey, parentKey) {
  for (let i = 0; i < registry.pending.length; i++) {
    if (registry.pending[i].boundary === childKey) registry.pending[i].boundary = parentKey;
  }
}

// An errored fragment reveals no content; retitling the document for it
// would be wrong, so its registrations are dropped.
function dropHeadBoundary(registry, boundary) {
  registry.pending = registry.pending.filter(reg => reg.boundary !== boundary);
}

function headGroupSignature(winner) {
  let sig = "" + winner.seq;
  for (let i = 0; i < winner.tags.length; i++) {
    const t = winner.tags[i];
    sig += "|" + t.tag + JSON.stringify(t.props);
  }
  return sig;
}

// Shell flush: commit + resolve + render winning tags to markup. Returns
// `{ prelude, html, title }` for document assembly — `prelude` (charset/base)
// splices immediately after the `<head>` open tag to satisfy hard placement
// constraints; `html` splices before `</head>`, resources first (earliness),
// then replaceable tags by category: link/style, meta, others, script.
//
// `title` is the winning title's TEXT, not markup: the document shell may
// carry its own static `<title>` (the RFC's fallback, restored when every
// registration disposes), and emitting a second tag ships two titles — the
// browser honors the FIRST, so the fallback wins over the route's title in
// the served page. `assembleDocument` applies the winner instead: rewriting
// the shell's static <title> bytes in place (stashing its text on `data-dhf`
// for the client registry's restore) when it owns the `</head>` splice, or a
// retitle script for embedded (`onHead`) hosts whose bytes it cannot see.
// `noScripts` rides along for the embedded case — there is no script channel,
// so the title falls back to a literal tag in the delivered string.
function renderShellHead(registry, nonce, isPendingFragment, noScripts) {
  commitHeadBoundary(registry, "", isPendingFragment);
  registry.shellFlushed = true;
  const winners = resolveHead(registry.committed);
  registry.flushed = new Map();
  let prelude = "";
  let links = "";
  let metas = "";
  let others = "";
  let scripts = "";
  let title = null;
  for (const [identity, winner] of winners) {
    registry.flushed.set(identity, headGroupSignature(winner));
    if (identity === "title") {
      const children = winner.tags[0].props.children;
      title = children == null ? "" : String(children);
      continue;
    }
    for (let i = 0; i < winner.tags.length; i++) {
      const t = winner.tags[i];
      const markup = renderHeadTagMarkup(t.tag, t.props, identity, nonce);
      if (identity === "charset" || identity === "base") prelude += markup;
      else if (t.tag === "link" || t.tag === "style") links += markup;
      else if (t.tag === "meta") metas += markup;
      else if (t.tag === "script") scripts += markup;
      else others += markup;
    }
  }
  return { prelude, html: registry.eagerHtml + links + metas + others + scripts, title, noScripts };
}

// Fragment flush: commit the boundary's registrations, re-resolve, and diff
// against the flushed snapshot. Returns patch ops (or null) for the client
// `$dh` helper: `["t", text]` retitle, `["r", identity]` remove owned tags,
// `["a", identity, tag, attrs, children]` append. Only identities present in
// the newly committed groups can change (the server never disposes), so the
// diff walks just those.
function flushHeadFragment(registry, boundary, nonce) {
  const groups = commitHeadBoundary(registry, boundary);
  if (!groups.length) return null;
  const winners = resolveHead(registry.committed);
  const affected = new Set();
  for (let i = 0; i < groups.length; i++)
    for (let j = 0; j < groups[i].tags.length; j++) affected.add(groups[i].tags[j].identity);
  const ops = [];
  for (const identity of affected) {
    const winner = winners.get(identity);
    const sig = headGroupSignature(winner);
    if (registry.flushed.get(identity) === sig) continue;
    const existed = registry.flushed.has(identity);
    registry.flushed.set(identity, sig);
    if (identity === "title") {
      const children = winner.tags[0].props.children;
      ops.push(["t", children == null ? "" : String(children)]);
      continue;
    }
    if (existed) ops.push(["r", identity]);
    for (let i = 0; i < winner.tags.length; i++) {
      const t = winner.tags[i];
      const attrs = {};
      for (const name in t.props) {
        if (name === "children" || name === "ref" || name.slice(0, 2) === "on") continue;
        if (!HEAD_ATTR_NAME.test(name)) {
          if ("_SOLID_DEV_") console.warn(`useHead: ignoring invalid attribute name "${name}"`);
          continue;
        }
        const v = t.props[name];
        if (v == null || v === false) continue;
        attrs[name] = v === true ? "" : String(v);
      }
      // The client applies these with setAttribute, so the nonce must ride in
      // attrs — the shell path gets it from renderHeadTagMarkup instead.
      if (nonce && !hasNonceProp(t.props)) {
        const destination = nonceDestination(t.tag, t.props);
        const value = destination && nonce[destination];
        if (value) attrs.nonce = String(value);
      }
      const children = t.props.children;
      ops.push(["a", identity, t.tag, attrs, children == null ? null : String(children)]);
    }
  }
  return ops.length ? ops : null;
}

// Only script-src and style-src match nonces. The escaped attribute text is
// precomputed once per render; emission sites just concatenate it.
function normalizeNonce(nonce) {
  if (nonce == null) return undefined;
  if (typeof nonce === "string") {
    const attr = nonce ? ` nonce="${escape(nonce, true)}"` : "";
    return { script: nonce, style: nonce, scriptAttr: attr, styleAttr: attr };
  }
  const script = nonce.script;
  const style = nonce.style;
  if (!script && !style) return undefined;
  return {
    script,
    style,
    scriptAttr: typeof script === "string" && script ? ` nonce="${escape(script, true)}"` : "",
    styleAttr: typeof style === "string" && style ? ` nonce="${escape(style, true)}"` : ""
  };
}

function destinationNonce(nonce, destination) {
  if (nonce == null) return undefined;
  if (typeof nonce === "string") return nonce || undefined;
  const value = nonce[destination];
  return typeof value === "string" && value ? value : undefined;
} /** The script-destination half of a render `nonce`. */
export function scriptNonce(nonce?: CSPNonce): string | undefined;

/** The script-destination half of a render `nonce`. */
export function scriptNonce(nonce) {
  return destinationNonce(nonce, "script");
} /** The style-destination half of a render `nonce`. */
export function styleNonce(nonce?: CSPNonce): string | undefined;

/** The style-destination half of a render `nonce`. */
export function styleNonce(nonce) {
  return destinationNonce(nonce, "style");
}

// HTML compares rel/as ASCII case-insensitively; toLowerCase would fold a
// non-ASCII character onto an ASCII one the parser never matches.
function asciiLowerCase(value) {
  return value.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32));
}

// Attribute names are ASCII case-insensitive, so a caller-supplied `Nonce`
// counts as one too.
function hasNonceProp(props) {
  for (const name in props)
    if (name.length === 5 && asciiLowerCase(name) === "nonce" && props[name] != null) return true;
  return false;
}

// Directive governing a head tag's fetch. `as` keywords are the union of
// preload and module preload destinations; anything else is "no state", which
// modulepreload resolves to script and a plain preload treats as an error.
function nonceDestination(tag, props) {
  if (tag === "script") return "script";
  if (tag === "style") return "style";
  if (tag !== "link") return null;
  const rel = props.rel;
  if (typeof rel !== "string") return null;
  const rels = asciiLowerCase(rel).split(/[\t\n\f\r ]+/);
  // One element can create several links; stylesheet wins because a single
  // attribute cannot carry two nonces. Split the element if they differ.
  if (rels.includes("stylesheet")) return "style";
  const isModulePreload = rels.includes("modulepreload");
  if (!isModulePreload && !rels.includes("preload")) return null;
  const as = typeof props.as === "string" ? asciiLowerCase(props.as) : "";
  if (as === "style") return "style";
  if (as === "script") return "script";
  // A preload needs a valid `as`, and only script/style are nonce-aware.
  if (!isModulePreload) return null;
  switch (as) {
    case "fetch":
    case "font":
    case "image":
    case "json":
    case "text":
    case "track":
      return null;
    default:
      return "script";
  }
}

function nonceAttr(nonce, destination) {
  if (!nonce || !destination) return "";
  return destination === "script" ? nonce.scriptAttr : nonce.styleAttr;
}

function renderHeadAttrHtml(props) {
  let attrs = "";
  for (const name in props) {
    if (name === "children" || name === "ref" || name.slice(0, 2) === "on") continue;
    if (!HEAD_ATTR_NAME.test(name)) {
      if ("_SOLID_DEV_") console.warn(`useHead: ignoring invalid attribute name "${name}"`);
      continue;
    }
    const v = props[name];
    if (v == null || v === false) continue;
    attrs += v === true ? ` ${name}` : ` ${name}="${escape(String(v), true)}"`;
  }
  return attrs;
}

// Plain name→string record of the same filtered attributes, for consumers
// that apply via setAttribute (frame chunks, client adoption) rather than
// markup. `skipRelHref` drops the attributes implied by the element shape.
function headAttrRecord(props, skipRelHref) {
  let attrs = null;
  for (const name in props) {
    if (name === "children" || name === "ref" || name.slice(0, 2) === "on") continue;
    if (skipRelHref && (name === "rel" || name === "href")) continue;
    if (!HEAD_ATTR_NAME.test(name)) continue;
    const v = props[name];
    if (v == null || v === false) continue;
    (attrs || (attrs = {}))[name] = v === true ? "" : String(v);
  }
  return attrs;
}

function renderHeadTagMarkup(tag, props, identity, nonce) {
  let attrs = renderHeadAttrHtml(props);
  if (identity != null) attrs += ` data-dh="${escape(identity, true)}"`;
  // renderHeadAttrHtml already emitted a caller-supplied nonce; appending the
  // render one would duplicate the attribute.
  if (nonce && !hasNonceProp(props)) attrs += nonceAttr(nonce, nonceDestination(tag, props));
  if (tag === "meta" || tag === "link" || tag === "base") return `<${tag}${attrs}>`;
  let body = props.children == null ? "" : String(props.children);
  if (tag === "script") body = body.replace(/<\/(script)/gi, "<\\/$1");
  else if (tag === "style") body = escapeStyleContent(body);
  else body = escape(body);
  return `<${tag}${attrs}>${body}</${tag}>`;
} /**
 * Registers head tags with the render's head registry. An array is a group —
 * one replacement set; a single tag is a group of one; a function is a
 * reactive group whose membership resolves at the owning flush boundary
 * (resource tags inside it emit at that flush rather than eagerly).
 * Replaceable tags (title/meta/canonical/…) resolve by last-committed group
 * and stream as patches with their suspense boundary's reveal; resource tags
 * (preload and friends, stylesheets, `script[src]`) emit eagerly and dedupe
 * by identity. See docs/head-management-rfc.md.
 */
export function useHead(tag: HeadTag | HeadTag[] | (() => HeadTag | HeadTag[])): void;

/**
 * Registers head tags with the render's head registry. Replaceable tags
 * (title/meta/canonical/…) resolve by last-committed group and stream as
 * patches with their suspense boundary's reveal; resource tags (preload,
 * stylesheets, `script[src]`) emit eagerly. A function argument is a
 * reactive group whose membership resolves at the owning boundary's flush.
 * See docs/head-management-rfc.md.
 */
export function useHead(tags) {
  const ctx = sharedConfig.context;
  if (!ctx || !ctx.registerHeadTags) {
    if ("_SOLID_DEV_")
      console.warn("useHead() called outside of a server render; registration ignored.");
    return;
  }
  ctx.registerHeadTags(tags);
}

// Based on https://github.com/WebReflection/domtagger/blob/master/esm/sanitizer.js
const VOID_ELEMENTS =
  /^(?:area|base|br|col|embed|hr|img|input|keygen|link|menuitem|meta|param|source|track|wbr)$/i;
// Fragment replacement helpers emitted into stream task scripts.
//
// Mechanics vs. policy: the inline script owns the parse-time MECHANICS only
// — it must work before any runtime loads (streamed content reveals with no
// JS at all). All reveal POLICY (late-arrival holds, boundary claims) lives
// in the hydration runtime: once it installs `_$HY.f`, every $df routes
// through it and the runtime decides when the raw swap ($dfr) runs. One
// owner at any moment, mirroring the `$dh`/`_$HY.h` head-patch handoff.
//
// - $df(id): route to the runtime's fragment policy (`_$HY.f`) when
//   installed, else swap immediately via $dfr. The runtime installs `_$HY.f`
//   before global hydration can complete, so an inline (pre-runtime) $df can
//   never run after `_$HY.done` — the raw path needs no done check.
// - $dfr(id): the raw swap — replace the `pl-*` marker range with the
//   template payload, record the reveal in the fragment ledger
//   (`_$HY.v[id] = 1` — with the `id_fr` declaration the serializer already
//   writes, this makes "which declared fragments are still outstanding" a
//   pure record read for the runtime: no promise introspection, no DOM
//   scan, valid across the pre-boot window), then announce it as
//   `_$HY.fe(id, parent)` — the parent scopes consumers that need to look
//   at what just landed (server-component boundaries adopt there) to the
//   revealed fragment instead of the document. A marker that isn't in the
//   live DOM yet (it
//   sits inside a flushed-but-unactivated ancestor template held by a reveal
//   group) queues the id in `_$HY.dq` for retry instead of dropping the
//   swap. A missing content template means the swap already ran — that stays
//   a plain no-op and is never queued. The runtime's policy calls back into
//   $dfr for swaps it approves, so the DOM mechanics exist exactly once.
// - $dfl(id): materialize fallback from `pl-*` template content without resolving.
//   Marker misses queue in `_$HY.dlq`, same reasoning as $dfr.
// - $dflj(ids): materialize fallback content for every id in the list.
// - $dfd(): drain both retry queues. Runs after every successful swap or fallback
//   materialization — the only events that can bring queued markers into the live
//   document. Content swaps ($df) drain before fallbacks ($dfl) so a settled
//   fragment wins over its own pending fallback. Each pass snapshots the queue,
//   so still-inert entries simply re-queue and wait for the next swap. Drains
//   route through $df, so queued swaps stay subject to runtime policy.
// - $dfs(id, count, defer): register pending stylesheet count for fragment `id`.
// - $dfc(id): style completion callback; reveals when the fragment/group is unblocked.
// - $dfg(id): group-style gate check; reveals a waiting group once all style counts hit zero.
// - $dfj(ids): reveal a group in registration order, waiting if any member still has pending styles.
const REPLACE_SCRIPT = `function $df(e){return _$HY.f?_$HY.f(e):$dfr(e)}function $dfr(e,n,o,t){if(!(n=document.getElementById(e)))return 0;if(!(o=document.getElementById("pl-"+e)))return(_$HY.dq=_$HY.dq||{})[e]=1,0;for(;o&&(8!==o.nodeType||o.nodeValue!=="pl-"+e);)t=o.nextSibling,o.remove(),o=t;t=o.parentNode,o.replaceWith(n.content),n.remove(),(_$HY.v=_$HY.v||{})[e]=1,_$HY.fe(e,t),_$HY.hp&&_$HY.hp[e]&&($dh(_$HY.hp[e]),delete _$HY.hp[e]),$dfd();return 1}function $dfl(e,o,n){if(!(o=document.getElementById("pl-"+e)))return(_$HY.dlq=_$HY.dlq||{})[e]=1,0;if(o._$fl)return 1;for(n=o.nextSibling;n;){if(8===n.nodeType&&n.nodeValue==="pl-"+e){o.parentNode&&o.parentNode.insertBefore(o.content.cloneNode(!0),n),o._$fl=1,$dfd();return 1}n=n.nextSibling}return 0}function $dflj(e,i){for(i=0;i<e.length;i++)$dfl(e[i])}function $dfd(e,i){if(e=_$HY.dq){_$HY.dq=0;for(i in e)$df(i)}if(e=_$HY.dlq){_$HY.dlq=0;for(i in e)$dfl(i)}}function $dfs(e,c,d){(_$HY.sc=_$HY.sc||{})[e]=c,d&&((_$HY.sd=_$HY.sd||{})[e]=1)}function $dfg(e,g,i,k){if(!(g=_$HY.sg&&_$HY.sg[e]))return;for(i=0;i<g.length;i++)if(_$HY.sc&&_$HY.sc[g[i]]>0)return;for(i=0;i<g.length;i++)k=g[i],delete _$HY.sg[k],$df(k)}function $dfc(e){if(--_$HY.sc[e]<=0){delete _$HY.sc[e],_$HY.sg&&_$HY.sg[e]?$dfg(e):!(_$HY.sd&&_$HY.sd[e])&&$df(e);_$HY.sd&&delete _$HY.sd[e]}}function $dfj(e,i,n){for(i=0;i<e.length;i++)if(_$HY.sc&&_$HY.sc[e[i]]>0){for(n=0;n<e.length;n++)(_$HY.sg=_$HY.sg||{})[e[n]]=e;return}for(i=0;i<e.length;i++)$df(e[i])}`;

// Head patch runtime, emitted once alongside the first head-patch task:
// - $dha(ops): apply patch ops to document.head — "t" sets the title (and
//   marks the element so the client registry can claim it), "r" removes tags
//   owned by an identity, "a" creates + appends a marked tag. Attribute
//   values apply via setAttribute and bodies via textContent, so nothing in
//   a payload is ever parsed as markup.
// - $dhr(identity): remove owned tags (attribute-compared, no selector
//   escaping — same reasoning as findAssetElement client-side).
// - $dh(ops): route — once the client registry is live it installs _$HY.h
//   and patches flow through it (registry state stays authoritative);
//   before that, ops apply directly. The DOM itself (ownership-marked tags)
//   is the bootstrap state the registry later adopts, so no separate queue
//   is needed.
// Patch application is triggered from $df when the owning fragment reveals
// (see _$HY.hp in REPLACE_SCRIPT), so head updates and content reveal stay
// atomic — including through style gates and deferred reveal groups.
// The "t" op stashes an unmarked title's text on `data-dhf` before the first
// overwrite: an unmarked <title> is user-authored shell markup — the fallback
// the client registry restores when every title registration disposes — and
// this op is the last reader that can still see it.
const HEAD_SCRIPT = `function $dha(o,i,e,n){for(i=0;i<o.length;i++)e=o[i],"t"==e[0]?((n=document.querySelector("title"))?n.hasAttribute("data-dh")||n.setAttribute("data-dhf",n.textContent):(n=document.createElement("title"),document.head.appendChild(n)),n.textContent=e[1],n.setAttribute("data-dh","title")):"r"==e[0]?$dhr(e[1]):(n=document.createElement(e[2]),Object.keys(e[3]).forEach(function(a){n.setAttribute(a,e[3][a])}),null!=e[4]&&(n.textContent=e[4]),n.setAttribute("data-dh",e[1]),document.head.appendChild(n))}function $dhr(v,l,i){for(l=document.head.querySelectorAll("[data-dh]"),i=0;i<l.length;i++)l[i].getAttribute("data-dh")==v&&l[i].remove()}function $dh(o){_$HY.h?_$HY.h(o):$dha(o)}`;
export function renderToString<T>(
  fn: () => T,
  options?: {
    nonce?: CSPNonce;
    renderId?: string;
    noScripts?: boolean;
    plugins?: SerializerPlugin[];
    manifest?: AssetManifest | AssetResolver | AssetResolverFn;
    onError?: (err: any) => void;
    /**
     * Embedded-render contract for hosts that own the document. When the
     * render output contains no `</head>`, everything head-bound (resolved
     * `useHead` winners, eager resources, tracked asset links, inline
     * styles) is delivered here as one HTML string — prelude (charset/base)
     * first — for the host to splice into its own `<head>` template, instead
     * of being dropped. Called synchronously before `renderToString`
     * returns; not called when the output has a `</head>` (splicing is
     * automatic then).
     */
    onHead?: (head: string) => void;
  }
): string;

export function renderToString(code, options = {}) {
  const { renderId = "", noScripts, manifest, onHead } = options;
  const nonce = normalizeNonce(options.nonce);
  let scripts = "";
  const serializer = createHydrationSerializer({
    scopeId: renderId,
    // The container trace plugin rides the DEFAULT plugin set (see
    // serializer-decode.js). In a sync render its value is its ERROR: no
    // stream exists for a container's later yields, and its message beats
    // a bare crash on the pending proxy's property walk.
    plugins: options.plugins,
    onData(script) {
      if (noScripts) return;
      if (!scripts) {
        scripts = getLocalHeaderScript(renderId);
      }
      scripts += script + ";";
    },
    onError: options.onError
  });
  const tracking = createAssetTracking();
  const headRegistry = createHeadRegistry();
  sharedConfig.context = {
    nonce: options.nonce,
    escape: escape,
    resolve: resolveSSRNode,
    ssr: ssr,
    registerHeadTags(tags) {
      // Sync render: everything is pre-shell, resources join the shell head.
      registerHeadTags(headRegistry, sharedConfig.context, tracking, null, nonce, tags);
    },
    serialize(id, p) {
      if (sharedConfig.context.noHydrate) return;
      if (
        p != null &&
        typeof p === "object" &&
        (typeof p.then === "function" || typeof p[Symbol.asyncIterator] === "function")
      ) {
        throw new Error(
          "Cannot serialize async value in renderToString (id: " +
            id +
            "). " +
            "Use renderToStream for async data."
        );
      }
      serializer.write(id, p);
    },
    registerAsset(type, value) {
      if (type === "preload") {
        registerPreloadLink(tracking, headRegistry, value, nonce);
        return;
      }
      if (type === "inline-style") {
        tracking.registerInlineStyle(value);
        return;
      }
      if (tracking.currentBoundaryId && type === "style") {
        let styles = tracking.boundaryStyles.get(tracking.currentBoundaryId);
        if (!styles) {
          styles = new Set();
          tracking.boundaryStyles.set(tracking.currentBoundaryId, styles);
        }
        styles.add(value);
      }
      tracking.emittedAssets.add(value);
    }
  };
  applyAssetTracking(sharedConfig.context, tracking, manifest, noScripts);
  registerEntryAssets(manifest);
  let html = root(
    d => {
      setTimeout(d);
      return resolveSSRSync(escape(code()));
    },
    { id: renderId }
  );
  serializeFragmentAssets("", tracking.boundaryModules, sharedConfig.context, renderId);
  sharedConfig.context.noHydrate = true;
  serializer.close();
  const head = renderShellHead(headRegistry, nonce, null, noScripts);
  return assembleDocument(
    resolveSSRSelectValues(html),
    tracking.emittedAssets,
    tracking.preloadLinks,
    tracking.inlineStyles,
    scripts.length ? scripts : "",
    nonce,
    head,
    onHead
  );
}
export function renderToStream<T>(
  fn: () => T,
  options?: {
    nonce?: CSPNonce;
    renderId?: string;
    noScripts?: boolean;
    plugins?: SerializerPlugin[];
    manifest?: AssetManifest | AssetResolver | AssetResolverFn;
    onCompleteShell?: (info: { write: (v: string) => void }) => void;
    onCompleteAll?: (info: { write: (v: string) => void }) => void;
    onError?: (err: any) => void;
    /**
     * Embedded-render contract for hosts that own the document. When the
     * shell contains no `</head>`, everything head-bound at first flush
     * (resolved `useHead` winners, eager resources, tracked asset links,
     * inline styles) is delivered here as one HTML string — prelude first —
     * before the shell chunk is emitted, so the host can write its own
     * `<head>` ahead of piping the stream. Post-shell head updates flow
     * through the stream itself and apply in the browser. Not called when
     * the shell has a `</head>` (splicing is automatic then).
     */
    onHead?: (head: string) => void;
  }
): {
  /**
   * Awaiting the stream resolves with the complete HTML once every boundary
   * settles — the fully-settled-string form of the render (`const html =
   * await renderToStream(...)`). Render errors route through `onError` and
   * the promise resolves with whatever HTML the render produced; it never
   * rejects.
   */
  then<TResult1 = string, TResult2 = never>(
    onfulfilled?: ((html: string) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
  pipe: (writable: { write: (v: string) => void; end: () => void }) => void;
  pipeTo: (writable: WritableStream) => Promise<void>;
  /**
   * Lazy `ReadableStream<Uint8Array>` view of the render — hand it straight
   * to `new Response(stream.readable)`. First access starts the render
   * piping through an internal `TransformStream` (chunks are UTF-8 encoded
   * bytes, the same as `pipeTo` writes) and the stream is cached, so
   * repeated access returns the same instance. Like `pipe`/`pipeTo`, this
   * consumes the render: use exactly one of the three — mixing distinct
   * consumers (`readable` after `pipe`/`pipeTo`, or vice versa) throws an
   * error naming the conflict.
   */
  readonly readable: ReadableStream<Uint8Array>;
};

export function renderToStream(code, options = {}) {
  let { onCompleteShell, onCompleteAll, renderId = "", noScripts, manifest, onHead } = options;
  const nonce = normalizeNonce(options.nonce);
  let dispose;
  let dead = false;
  // Client-disconnect teardown. A sink that throws from `write`/`end` (its
  // transport is gone) or a consumer cancelling the readable view means
  // nobody is listening anymore: stop touching the sink, mark the render
  // completed so pending fragment resolutions stop emitting and
  // serializing, and dispose in-flight reactive work. Containment matters
  // because deferred writes (`writeTasks`, late fragment flushes) run from
  // the microtask queue — an uncontained sink throw there escapes as an
  // unhandled error and can take the host process down.
  const abandon = () => {
    if (dead) return;
    dead = true;
    completed = true;
    buffer = { write() {} };
    writable = { end() {} };
    if (dispose) {
      const d = dispose;
      dispose = () => {};
      d();
    }
  };
  // A retry pass that throws a REAL error (not NotReady) can have nothing on
  // the stack to catch it: the initial render pass throws synchronously out
  // of renderToStream for the caller's try/catch, but retries run from flush
  // microtasks and boundary resume loops, where an escaped throw becomes an
  // unhandled rejection and takes the host process down. This is the render's
  // one containment channel for those: report through onError (falling back
  // to console.error so the failure is never silent), then wind the render
  // down exactly like a disconnect — the REQUEST fails, the process survives.
  // Exposed to the reactive library's boundary resume loop as
  // `context.failRender` (see the ssrLoadingBoundary finalizeError path).
  const failRender = err => {
    try {
      options.onError ? options.onError(err) : console.error(err);
    } catch (_) {}
    abandon();
  };
  // Chunk coalescing (stage-4 §13b): a settled boundary emits its template,
  // activation script, data script, and reveal as SEPARATE writes across one
  // resolution burst — uncoalesced, each becomes a consumer chunk and a
  // write syscall (measured: 41 chunks vs octane's 11 for the same page,
  // 4x the network frames). Writes buffer; a deferred flush riding AFTER
  // the burst's whole microtask chain emits ONE chunk per burst. The shell
  // flushes explicitly at handoff (TTFB is never deferred), end() flushes,
  // and >16KB flushes early for backpressure friendliness.
  const coalesceWrites = (writeRaw, endRaw) => {
    let buf = "";
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      if (!buf) return;
      const out = buf;
      buf = "";
      writeRaw(out);
    };
    return {
      write(payload) {
        buf += payload;
        if (buf.length >= 16384) return flush();
        if (!scheduled) {
          scheduled = true;
          deferFlush(flush);
        }
      },
      flush,
      end() {
        flush();
        endRaw();
      }
    };
  };
  // Wrap an integrator-supplied `pipe` sink: contain sync throws from
  // `write`/`end` and treat them as disconnection.
  const guardSink = w => ({
    write(payload) {
      if (dead) return;
      try {
        w.write(payload);
      } catch (_) {
        abandon();
      }
    },
    end() {
      if (dead) return;
      try {
        w.end();
      } catch (_) {
        abandon();
      }
    }
  });
  const blockingPromises = new Set();
  // Pre-shell pending-promise stubs (fragment `_fr` promises and thrown async
  // sources) batch into ONE seroval write at shell flush. Every
  // serializer.write() spins up a full crossSerializeStream session (plugin
  // resolution, parser context, ref bookkeeping) — ~30% of shell CPU on an
  // async-heavy page went to N of those sessions emitting formulaic deferred
  // stubs. One object write collapses the session cost; a spreader task files
  // each entry under its real `_$HY.r` key, and seroval's fulfillment
  // machinery is untouched because it parses the same promise instances.
  // Document-mode only: the serializer seam's keys are wire protocol for
  // custom serializers (the frame sink's keyed codec addresses records BY
  // key, no eval on the consumer), and the spreader task is a document
  // <script> construct. Any serializer/sink override opts out of batching
  // and gets the original per-key writes.
  const canBatchStubs = !options.serializer && !options.sink;
  let stubBatch = null;
  const STUB_BATCH_KEY = "$B";
  const flushStubBatch = () => {
    if (!stubBatch) return;
    const batch = stubBatch;
    stubBatch = null;
    if (batch.size === 1) {
      const [id, p] = batch.entries().next().value;
      serializer.write(id, p);
      return;
    }
    const obj = {};
    for (const [id, p] of batch) obj[id] = p;
    serializer.write(STUB_BATCH_KEY, obj);
    pushTask(
      `(b=>{for(var k in b)_$HY.r[k]=b[k];delete _$HY.r["${STUB_BATCH_KEY}"]})(_$HY.r["${STUB_BATCH_KEY}"])`
    );
  };
  let headerEmitted = false;
  const pushTask = task => {
    if (noScripts) return;
    if (!headerEmitted) {
      headerEmitted = true;
      tasks += getLocalHeaderScript(renderId);
    }
    tasks += task + ";";
    if (!timer && firstFlushed) {
      // Microtask (not timer) batching: tasks emitted in the same resolution
      // burst still coalesce into one <script>, without a macrotask of
      // latency between a fragment's template and its activation.
      timer = true;
      queue(() => queue(writeTasks));
    }
  };
  const onDone = () => {
    writeTasks();
    doShell();
    onCompleteAll &&
      onCompleteAll({
        write(v) {
          !completed && buffer.write(v);
        }
      });
    writable && writable.end();
    completed = true;
    if (firstFlushed) dispose();
  };
  // FrameSink seam (design in frame-sink.js): semantic emission routes through
  // a sink so the same render core can drive either document output (default)
  // or a transport-agnostic frame-chunk stream. Methods close over stream
  // state, so the document sink is assembled here rather than by a standalone
  // factory. `options.sink` overrides individual methods (experimental —
  // surface grows as seams extract; unlisted emission still writes document
  // output directly).
  const sink = {
    // One serialized data record: a Seroval script addressing one or more ids
    // (ids are embedded in the payload, not addressable here). Document
    // behavior: accumulate as a task, flush inside a <script>.
    data(payload) {
      pushTask(payload);
    },
    // An async fragment resolved post-shell with its normalized HTML payload.
    // Document behavior: <template id=key> plus, when the fragment carries
    // streamed style links, a $dfs gate and onload-$dfc stylesheet links
    // (inline styles apply as the parser sees them — no gating); eager
    // (ungrouped, link-free) fragments self-activate with $df. Grouped
    // fragments defer to reveal().
    fragment(key, value, meta) {
      const deferActivation = !!meta.revealGroup;
      const styles = meta.styles;
      for (let i = 0; i < styles.inline.length; i++) {
        buffer.write(renderInlineStyle(styles.inline[i], nonce));
      }
      if (styles.links.length) {
        const styleAttr = nonceAttr(nonce, "style");
        emitTask(`$dfs("${key}",${styles.links.length},${deferActivation ? 1 : 0})`);
        // Flush the $dfs gate before the links so their onload can't fire
        // ahead of the pending-style registration.
        writeTasks();
        for (const entry of styles.links) {
          buffer.write(
            typeof entry === "string"
              ? `<link rel="stylesheet" href="${entry}"${styleAttr} onload="$dfc('${key}')" onerror="$dfc('${key}')">`
              : `<link${entry.attrHtml}${styleAttr} onload="$dfc('${key}')" onerror="$dfc('${key}')">`
          );
        }
        buffer.write(`<template id="${key}">${value}</template>`);
      } else {
        buffer.write(`<template id="${key}">${value}</template>`);
        if (!deferActivation) {
          emitTask(`$df("${key}")`);
        }
      }
    },
    // Reveal a set of fragments (registration order). Document behavior:
    // $dfj task, or $dflj to materialize fallback content instead.
    reveal(keys, meta) {
      emitTask(`${meta.fallback ? "$dflj" : "$dfj"}(${JSON.stringify(keys)})`);
    },
    // A late-registered asset while streaming. Document behavior: style links
    // are handled per-fragment (see fragment()); modules preload immediately;
    // non-boundary inline styles write their <style> tag directly. Head
    // resource tags (useHead preload/preconnect/script[src]) arrive as
    // already-rendered markup and write through eagerly.
    asset(type, value) {
      if (type === "module") {
        buffer.write(`<link rel="modulepreload" href="${value}"${nonceAttr(nonce, "script")}>`);
      } else if (type === "preload") {
        buffer.write(`<link${value.attrHtml}>`);
      } else if (type === "inline-style") {
        buffer.write(renderInlineStyle(value, nonce));
      } else if (type === "head-tag") {
        buffer.write(value);
      }
    },
    // The resolved shell. Document behavior: head/script string surgery —
    // preload links spliced before </head>, accumulated tasks spliced at the
    // <!--xs--> marker — then one write. Injection order (preloads, scripts)
    // is part of the byte-exact document output. `onHead` fires synchronously
    // inside assembly, before the shell chunk is written — the host receives
    // its head content before any body output it could flush.
    shell(shellHtml, meta) {
      buffer.write(
        assembleDocument(
          shellHtml,
          meta.preloads,
          meta.preloadLinks,
          meta.inlineStyles,
          meta.tasks.length ? meta.tasks : "",
          nonce,
          meta.head,
          onHead
        )
      );
    },
    ...options.sink
  };
  // Serializer seam (companion to the sink seam): `options.serializer` is a
  // factory with the hydration serializer's contract — `write(id, value)` +
  // `flush()`, completion via onDone once everything pending settles. What
  // flows through onData is a contract between the serializer and the sink
  // (hydration scripts for the document sink, keyed codec records for the
  // frame sink); the core never inspects it.
  const serializer = (options.serializer || createHydrationSerializer)({
    scopeId: options.renderId,
    // Containers (projections) serialize as traces on BOTH faces — the
    // document's hydration serializer and the frame sink's codec resolve
    // their plugin sets through the codec defaults, which carry the trace
    // plugin (inert until the reactive core installs its resolver).
    plugins: options.plugins,
    onData: payload => sink.data(payload),
    onDone,
    onError: options.onError
  });
  let rootAssetsSerialized = false;
  const serializeRootAssets = () => {
    if (rootAssetsSerialized) return;
    rootAssetsSerialized = true;
    // Ensure the root boundary's module map is written to the serializer
    // before it flushes. A Loading boundary's resolve path can queue flushEnd
    // while the shell is still pending (cascading root holes), which would
    // otherwise call serializer.flush() before doShell() writes root _assets.
    // Seroval silently drops writes after flush, so the root module mapping
    // would be lost and lazy hydration would fail for root-level lazy modules.
    serializeFragmentAssets("", tracking.boundaryModules, context, renderId);
  };
  // Response-window holds (`ctx.hold`): live work with a knowable end that
  // isn't a fragment or a serialized promise — a server-consumed async
  // iterable feeding live holes / watched args (a bounded async trace, per
  // DR-2) — keeps the response open until it completes. Holds gate only the
  // END of the response (serializer flush → complete); shell and fragment
  // flushing proceed normally around them.
  let holds = 0;
  const flushEnd = () => {
    if (!registry.size && !holds) {
      serializeRootAssets();
      queue(() =>
        queue(() => {
          // The document face's live-hole latch (Stage 4): one final sweep
          // ships last values and the channel stream closes — BEFORE the
          // serializer flush, or the open stream would hold the response
          // forever (and post-flush writes are silently dropped).
          if (context.live.end) {
            const end = context.live.end;
            context.live.end = null;
            end();
          }
          // Fast-settling renders reach here before doShell() (registry
          // drained in microtasks); post-flush writes are silently dropped,
          // so the stub batch must land first. The task output still rides
          // the shell snapshot — `tasks` accumulates until doShell reads it.
          flushStubBatch();
          serializer.flush();
        })
      ); // double queue because of elsewhere
    }
  };
  const registry = new Map();
  // Abandonment ledger (#3165): every pending promise written through
  // context.serialize, keyed by hydration id. Seroval's onDone waits for
  // every serialized async value to settle, so a fragment that reaches its
  // terminal error state while a sibling in its subtree is still pending
  // would hold the response open forever — the subtree is discarded, nothing
  // will ever settle the deferred. Serialized promises are raced against a
  // per-id abandon hook so the errored fragment can terminally settle
  // serialization its subtree owns. Hydration ids are a prefix code (each
  // sibling ordinal is self-delimiting), so `startsWith` is exact ancestry.
  const pendingSerialized = new Map();
  const trackSerialized = (id, p) => {
    let settle;
    const raced = Promise.race([p, new Promise(r => (settle = r))]);
    pendingSerialized.set(id, settle);
    // Once the source settles the entry is dead weight; drop it. The
    // rejection arm also keeps an abandoned-then-rejected source from
    // surfacing as an unhandled rejection (seroval only sees the race).
    const drop = () => pendingSerialized.delete(id);
    p.then(drop, drop);
    return raced;
  };
  // A fragment settling with an error abandons its subtree: descendant
  // fragments still in the registry would gate flushEnd forever (their
  // resume loops may be parked on promises that never settle), and pending
  // serialized values under the errored key would gate seroval's onDone the
  // same way. Settle both. Descendant `_fr` stubs resolve clean (not
  // rejected) and abandoned data ids resolve undefined: the client re-renders
  // the errored region fresh off the OUTER fragment's rejection, so nothing
  // consumes these — a rejection would only raise unhandled-rejection noise.
  const abandonSubtree = key => {
    for (const [k, entry] of registry) {
      if (k.length > key.length && k.startsWith(key)) {
        registry.delete(k);
        entry.resolve();
      }
    }
    for (const [id, settle] of pendingSerialized) {
      if (id.startsWith(key)) {
        pendingSerialized.delete(id);
        settle();
      }
    }
  };
  const writeTasks = () => {
    if (tasks.length && !completed && firstFlushed) {
      buffer.write(`<script${nonceAttr(nonce, "script")}>${tasks}</script>`);
      tasks = "";
    }
    timer = null;
  };

  let context;
  let writable;
  let tmp = "";
  let tasks = "";
  let firstFlushed = false;
  let completed = false;
  let shellCompleted = false;
  let scriptFlushed = false;
  let headStyles;
  const revealGroups = new Map();
  let timer = null;
  const emitTask = task => {
    pushTask(`${task}${!scriptFlushed ? ";" + REPLACE_SCRIPT : ""}`);
    scriptFlushed = true;
  };
  function resolveRevealKeys(groupOrKeys, release, consume) {
    if (Array.isArray(groupOrKeys)) return groupOrKeys.slice();
    let group = revealGroups.get(groupOrKeys);
    if (!group) {
      if (!release) return;
      group = { order: [], keys: new Set(), released: true };
      revealGroups.set(groupOrKeys, group);
    } else if (release) group.released = true;
    if (!group.order.length) return;
    const keys = group.order.slice();
    if (consume) revealGroups.delete(groupOrKeys);
    return keys;
  }
  let rootHoles = null;
  let nextHoleId = 0;
  let buffer = {
    write(payload) {
      tmp += payload;
    }
  };
  const tracking = createAssetTracking();
  const headRegistry = createHeadRegistry();
  let headScriptFlushed = false;
  // Head patch ops park on `_$HY.hp[key]` and apply when the owning
  // fragment's `$df` reveal fires, so head updates stay atomic with content
  // reveal — through style gates and reveal groups alike. `emitTask` (not a
  // bare pushTask) because the ops are useless without $df's hook.
  const emitHeadOps = (key, ops) => {
    const payload = JSON.stringify(ops).replace(/</g, "\\u003C");
    emitTask(
      `${!headScriptFlushed ? HEAD_SCRIPT : ""}(_$HY.hp=_$HY.hp||{})[${JSON.stringify(key)}]=${payload}`
    );
    headScriptFlushed = true;
  };

  sharedConfig.context = context = {
    async: true,
    nonce: options.nonce,
    // The document face's live-hole carrier (Stage 4). Components render
    // under per-component context CLONES (spread copies), so a mutation on
    // the clone a server component armed under never reaches this root
    // object — but a mutation on this shared slot does: clones copy the
    // REFERENCE. Arming (frame-sink's armDocumentLiveHoles) dedupes through
    // it, and flushEnd reads `live.end` off the root to close the channel.
    live: {},
    registerHeadTags(tags) {
      registerHeadTags(
        headRegistry,
        context,
        tracking,
        // Resource-class tags stream eagerly: before first flush they join
        // the shell head; afterwards they write straight into the stream.
        // Gate entries (reveal-gated stylesheets) emitted into the shell are
        // marked so their fragment flush skips them; post-shell they stay
        // parked on the boundary's style set and flush load-gated with the
        // fragment instead of writing here.
        (markup, gateEntry) => {
          if (!firstFlushed) {
            headRegistry.eagerHtml += markup;
            if (gateEntry) gateEntry.emitted = true;
          } else if (!gateEntry || !tracking.currentBoundaryId) {
            sink.asset("head-tag", markup);
          }
        },
        nonce,
        tags
      );
    },
    registerAsset(type, value) {
      if (type === "preload") {
        const entry = registerPreloadLink(tracking, headRegistry, value, nonce);
        if (entry && firstFlushed) sink.asset("preload", entry);
        return;
      }
      if (type === "inline-style") {
        const entry = tracking.registerInlineStyle(value);
        // Boundary-attributed inline styles flush with their fragment; a late
        // registration outside any boundary has no other emission point, so
        // emit it immediately.
        if (firstFlushed && !tracking.currentBoundaryId && !entry.emitted) {
          entry.emitted = true;
          sink.asset("inline-style", entry);
        }
        return;
      }
      if (tracking.currentBoundaryId && type === "style") {
        let styles = tracking.boundaryStyles.get(tracking.currentBoundaryId);
        if (!styles) {
          styles = new Set();
          tracking.boundaryStyles.set(tracking.currentBoundaryId, styles);
        }
        styles.add(value);
      }
      if (!tracking.emittedAssets.has(value)) {
        tracking.emittedAssets.add(value);
        if (firstFlushed) sink.asset(type, value);
      }
    },
    block(p) {
      if (!firstFlushed) blockingPromises.add(p);
    },
    // Take a response-window hold (see `holds` above). Returns the release;
    // releasing when no other holds or fragments remain lets the response
    // end. Idempotent, so error and completion paths can both release.
    hold() {
      holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
        if (!holds) queue(flushEnd);
      };
    },
    replace(id, payloadFn) {
      if (firstFlushed) return;
      const placeholder = `<!--!$${id}-->`;
      const first = html.indexOf(placeholder);
      if (first === -1) return;
      const last = html.indexOf(`<!--!$/${id}-->`, first + placeholder.length);
      html =
        html.slice(0, first) +
        resolveSSRSync(escape(payloadFn())) +
        html.slice(last + placeholder.length + 1);
    },
    serialize(id, p, deferStream) {
      if (sharedConfig.context.noHydrate) return;
      if (p && typeof p === "object" && typeof p.then === "function") {
        if (!firstFlushed && deferStream) {
          blockingPromises.add(p);
          p.then(d => serializer.write(id, d)).catch(e => serializer.write(id, e));
          return;
        }
        // Every pending promise handed to seroval joins the abandonment
        // ledger (#3165) — pre-shell and streaming alike, since a fragment
        // can error terminally at any point after this write.
        p = trackSerialized(id, p);
        // `shellCompleted` (not `firstFlushed`) gates batching: doShell()
        // flushes the batch into the shell's task snapshot, and writes in the
        // microtask window between the two flags must go direct or they'd
        // strand in a batch nobody flushes.
        if (!firstFlushed && canBatchStubs && !shellCompleted) {
          (stubBatch ||= new Map()).set(id, p);
          return;
        }
      }
      serializer.write(id, p);
    },
    escape: escape,
    resolve: resolveSSRNode,
    ssr: ssr,
    registerFragment(key, options) {
      const revealGroup = options && options.revealGroup;
      if (revealGroup) {
        let group = revealGroups.get(revealGroup);
        if (!group) {
          group = { order: [], keys: new Set(), released: false };
          revealGroups.set(revealGroup, group);
        }
        if (!group.keys.has(key)) {
          group.keys.add(key);
          group.order.push(key);
        }
        if (group.released) {
          throw new Error(
            "registerFragment() for reveal group '" +
              revealGroup +
              "' was called after revealFragments(). Ensure template payload is emitted before grouped reveal."
          );
        }
      }
      if (!registry.has(key)) {
        let resolve, reject;
        const p = new Promise((r, rej) => ((resolve = r), (reject = rej)));
        // double queue to ensure that the fragment is last but in same flush
        registry.set(key, {
          resolve: err =>
            queue(() =>
              queue(() => {
                err ? reject(err) : resolve(true);
                queue(flushEnd);
              })
            )
        });
        if (canBatchStubs && !shellCompleted) (stubBatch ||= new Map()).set(key + "_fr", p);
        else serializer.write(key + "_fr", p);
      }
      return (value, error) => {
        if (registry.has(key)) {
          const item = registry.get(key);
          registry.delete(key);
          // Terminal error: the subtree is discarded — release everything in
          // it that would otherwise gate response completion (#3165).
          if (error) abandonSubtree(key);

          if (item.children) {
            for (const k in item.children) {
              value = replacePlaceholder(value, k, item.children[k]);
            }
          }

          const parentKey = waitForFragments(registry, key);
          if (parentKey) {
            const parent = registry.get(parentKey);
            parent.children ||= {};
            parent.children[key] = value !== undefined ? value : "";
            serializeFragmentAssets(key, tracking.boundaryModules, context);
            propagateBoundaryStyles(key, parentKey, tracking);
            // The parent is the boundary that actually flushes; head
            // registrations evaluate and commit there.
            adoptHeadBoundary(headRegistry, key, parentKey);
            item.resolve();
            return;
          }
          if (!completed) {
            if (error) dropHeadBoundary(headRegistry, key);
            if (!firstFlushed) {
              // Head registrations stay pending: a boundary that inlines into
              // the shell commits with the shell flush (its key is no longer
              // a pending fragment, so renderShellHead picks them up).
              queue(() => (html = replacePlaceholder(html, key, value !== undefined ? value : "")));
              serializeFragmentAssets(key, tracking.boundaryModules, context);
              item.resolve(error);
            } else {
              serializeFragmentAssets(key, tracking.boundaryModules, context);
              const styles = collectStreamStyles(key, tracking, headStyles);
              // Evaluate + commit + diff this boundary's head registrations
              // now (collection window closed), parking ops for the
              // fragment's $df so head update and reveal stay atomic. Must
              // precede sink.fragment so the ops land in the same task batch
              // as (and before) the activation call.
              const headOps = error ? null : flushHeadFragment(headRegistry, key, nonce);
              if (headOps) emitHeadOps(key, headOps);
              // The error rides the sink call: the document sink ignores it
              // (its protocol rejects `<key>_fr` via item.resolve below), but
              // transport sinks with no resume protocol need the signal.
              sink.fragment(key, resolveSSRSelectValues(value !== undefined ? value : " "), {
                styles,
                revealGroup,
                error
              });
              item.resolve(error);
            }
          }
        }
        return firstFlushed;
      };
    },
    revealFragments(groupOrKeys) {
      // Group reveal follows fragment registration order so visibility order
      // cannot be changed by resolve timing.
      const keys = resolveRevealKeys(groupOrKeys, true, true);
      if (!keys) return;
      sink.reveal(keys, { fallback: false });
    },
    revealFallbacks(groupOrKeys) {
      const keys = resolveRevealKeys(groupOrKeys, false, false);
      if (!keys) return;
      sink.reveal(keys, { fallback: true });
    }
  };
  applyAssetTracking(context, tracking, manifest, noScripts);
  // Internal containment seam, not part of the context contract (see
  // failRender above): the boundary resume loop lives in the reactive
  // library and has no other channel to fail the request from an async
  // retry.
  context.failRender = failRender;
  registerEntryAssets(manifest);

  let html = root(
    d => {
      dispose = d;
      const res = resolveSSRNode(escape(code()));
      if (!res.h.length) return res.t[0];
      rootHoles = [];
      let out = res.t[0];
      for (let i = 0; i < res.h.length; i++) {
        const id = nextHoleId++;
        rootHoles.push({ id, fn: res.h[i] });
        out += `<!--rh${id}-->` + res.t[i + 1];
      }
      for (const p of res.p) blockingPromises.add(p);
      return out;
    },
    { id: renderId }
  );
  // Re-pull pending root holes, splicing sync results into `html` and
  // re-queueing still-async ones (their retry promises join
  // `blockingPromises`). Returns true once no holes remain.
  function resolveRootHoles() {
    if (!rootHoles) return true;
    const pending = [];
    for (const { id, fn } of rootHoles) {
      const marker = `<!--rh${id}-->`;
      const res = resolveSSRNode(fn);
      if (!res.h.length) {
        html = html.replace(marker, res.t[0]);
      } else {
        let out = res.t[0];
        for (let j = 0; j < res.h.length; j++) {
          const newId = nextHoleId++;
          pending.push({ id: newId, fn: res.h[j] });
          out += `<!--rh${newId}-->` + res.t[j + 1];
        }
        html = html.replace(marker, out);
        for (const p of res.p) blockingPromises.add(p);
      }
    }
    if (pending.length) {
      rootHoles = pending;
      return false;
    }
    rootHoles = null;
    return true;
  }
  function doShell() {
    if (shellCompleted) return;
    // Async root holes can resume after another render replaced the global
    // context. Restore this stream before re-pulling them so hydration data
    // is serialized into the response that owns the rendered markup.
    sharedConfig.context = context;
    // A hole that completes by MOUNTING content can register new shell
    // blockers as it renders: a deferStream read under a boundary created
    // during this very re-invocation adds its source promise via
    // serialize() (solidjs/solid#3047 — the code-split lazy route shape).
    // This attempt already runs inside the previous allSettled snapshot's
    // continuation, so flushing now would ship the fallback deferStream
    // exists to prevent. Bail on growth; the flush loop re-awaits the grown
    // set, and the boundary's pre-flush replace() splices the resolved
    // content into the held shell before the retry flushes it.
    const blockersBefore = blockingPromises.size;
    if (!resolveRootHoles()) return;
    if (blockingPromises.size !== blockersBefore) return;
    // Root-owned head registrations join the shell-hole contract: a pending
    // prop blocks the shell on its source and this attempt bails; the flush
    // loop re-awaits and retries (#2975 follow-up).
    if (!headShellReady(headRegistry, p => blockingPromises.add(p))) return;
    headStyles = new Set();
    for (const url of tracking.emittedAssets) {
      if (isCssUrl(url)) headStyles.add(url);
    }
    // Root _assets serialization feeds sink.data → tasks, so it must run
    // before anything reads `tasks` for the shell snapshot.
    serializeRootAssets();
    // Batched pending-promise stubs ride the same snapshot (after the
    // root-hole/head gates above so this runs exactly once, on the attempt
    // that actually flushes).
    flushStubBatch();
    // Shell head flush: commits every registration not owned by a
    // still-pending fragment (those flush with their fragment later).
    const head = renderShellHead(headRegistry, nonce, k => registry.has(k), noScripts);
    sink.shell(resolveSSRSelectValues(html), {
      preloads: tracking.emittedAssets,
      preloadLinks: tracking.preloadLinks,
      inlineStyles: tracking.inlineStyles,
      tasks,
      head
    });
    tasks = "";
    onCompleteShell &&
      onCompleteShell({
        write(v) {
          !completed && buffer.write(v);
        }
      });
    shellCompleted = true;
  }
  // Flush attempts run on microtasks — never paying a macrotask of
  // first-byte latency — with two guards:
  //
  // 1. Registry drain: an already-settled async read (cached data,
  //    Promise.resolve) completes its whole retry chain in microtasks, so
  //    before flushing we keep yielding double-microtask turns while the
  //    pending-fragment registry is still shrinking. That preserves the
  //    "near-instant async inlines into the shell with no fallback flash"
  //    behavior, while genuinely-pending I/O leaves the registry stable and
  //    the shell flushes immediately.
  // 2. Timer fallback for the no-progress retry: a root hole whose promise
  //    has settled but that still cannot complete is waiting on some other
  //    macrotask, and a microtask-only loop would starve it. Progress is
  //    detected as growth of the (append-only) blocking set — new async
  //    means the next allSettled genuinely waits, yielding the event loop.
  // An already-settled read completes its retry chain in a handful of
  // microtask turns (promise .then → scheduler flush → recompute → fragment
  // resolve, itself double-queued). Grant at least that many turns — total
  // cost is nanoseconds — and keep extending while fragments are actually
  // completing (registry churn), so nested settled boundaries drain fully.
  const MIN_DRAIN_TURNS = 8;
  let lastBlockingSize = -1;
  let lastRegistrySize = -1;
  let drainTurn = 0;
  const scheduleFlush = fn => {
    const attempt = () => {
      // Flush batched stubs at the TOP of the drain, not at doShell: a
      // promise that already settled emits its fulfillment on a microtask
      // AFTER the batch write parses it, and the shell snapshot is
      // synchronous. Writing here gives those fulfillments the same
      // drain-turn runway they had when writes happened at registration
      // time, so a settled-before-shell record is visibly settled IN the
      // shell (client boundaries branch on `.s === 1` at hydrate time).
      flushStubBatch();
      if (registry.size !== lastRegistrySize || drainTurn++ < MIN_DRAIN_TURNS) {
        if (registry.size !== lastRegistrySize) drainTurn = 0;
        lastRegistrySize = registry.size;
        queue(attempt);
        return;
      }
      fn();
    };
    const progressed = blockingPromises.size !== lastBlockingSize;
    lastBlockingSize = blockingPromises.size;
    lastRegistrySize = -1;
    drainTurn = 0;
    progressed ? queue(attempt) : setTimeout(attempt);
  };
  let cachedReadable;
  // Which consumer has claimed the render. `pipe`/`pipeTo` hand the render
  // to a sink and `readable` builds one internally — mixing them would
  // silently split (and corrupt) the output, so the conflict throws instead.
  let consumer;
  const claimConsumer = name => {
    if (consumer && consumer !== name) {
      throw new Error(
        `renderToStream result was already consumed via \`${consumer}\`; cannot also consume it via \`${name}\`. Use exactly one of \`pipe\`, \`pipeTo\`, or \`readable\`.`
      );
    }
    consumer = name;
  };
  const pipeToImpl = w => {
    let resolve;
    const p = new Promise(r => (resolve = r));
    function flush() {
      allSettled(blockingPromises).then(() => {
        scheduleFlush(() => {
          if (dead) return resolve();
          // Root-hole retries and shell assembly run inside this microtask —
          // a real error here (see failRender) must fail the request, not
          // reject an unhandled promise.
          try {
            doShell();
          } catch (err) {
            failRender(err);
            return resolve();
          }
          if (!shellCompleted) return flush();
          const encoder = new TextEncoder();
          const writer = w.getWriter();
          // Writes are chained and awaited before the lock is released.
          // `writer.write()` returns a promise, and releasing the lock (or
          // closing) with one still in flight leaves that chunk's fate up to
          // the host's stream implementation — Node queues it anyway, workerd
          // drops it. The chunk at risk is the last one written, which for a
          // streamed boundary is its `_fr` resolution; losing that leaves the
          // client's boundary waiting on a promise that never resolves.
          let pendingWrites = Promise.resolve();
          let ended = false;
          // The destination dying under us — a rejected write, or `closed`
          // rejecting before our own end() (the consumer cancelled the
          // readable view, or the writable errored) — is a client
          // disconnect: wind the render down instead of computing fragments
          // for a dead stream, and settle the pipeTo promise so callers
          // don't hang. (`releaseLock()` in the normal end path also
          // rejects `closed`; `ended` keeps that from reading as failure.)
          const failed = () => {
            if (!ended) {
              abandon();
              resolve();
            }
          };
          writer.closed && writer.closed.catch(failed);
          buffer = writable = coalesceWrites(
            payload => {
              pendingWrites = pendingWrites
                .then(() => writer.write(encoder.encode(payload)))
                .catch(failed);
            },
            () => {
              pendingWrites.then(() => {
                ended = true;
                writer.releaseLock();
                w.close().catch(() => {});
                resolve();
              });
            }
          );
          buffer.write(tmp);
          // Shell TTFB is never deferred — flush the handoff synchronously.
          buffer.flush();
          firstFlushed = true;
          if (completed) {
            dispose();
            writable.end();
          } else flushEnd();
        });
      });
    }
    flush();
    return p;
  };
  return {
    // Proper thenable: `await renderToStream(...)` resolves with the full
    // HTML once every boundary settles — the replacement for the removed
    // renderToStringAsync. Render errors route through `onError` (the
    // promise resolves with whatever HTML the render produced; it never
    // rejects), matching the pipe/pipeTo contract.
    then(onFulfilled, onRejected) {
      const p = new Promise(resolve => {
        function complete() {
          dispose();
          resolve(tmp);
        }
        if (onCompleteAll) {
          let ogComplete = onCompleteAll;
          onCompleteAll = options => {
            ogComplete(options);
            complete();
          };
        } else onCompleteAll = complete;
        function flush() {
          allSettled(blockingPromises).then(() => {
            scheduleFlush(() => {
              // Same gates as doShell: pending root head props are shell
              // blockers, so flushEnd must not run ahead of them (their
              // source may not be serialized, so the serializer alone
              // wouldn't wait) — and a hole re-invocation that registers
              // new blockers (deferStream under a just-mounted boundary,
              // solidjs/solid#3047) must be re-awaited before completion.
              try {
                const blockersBefore = blockingPromises.size;
                if (
                  !resolveRootHoles() ||
                  blockingPromises.size !== blockersBefore ||
                  !headShellReady(headRegistry, p => blockingPromises.add(p))
                )
                  return flush();
              } catch (err) {
                // Contain retry-pass errors (see failRender); the thenable
                // contract already routes render errors through onError and
                // resolves with whatever HTML the render produced.
                failRender(err);
                return resolve(tmp);
              }
              queue(flushEnd);
            });
          });
        }
        flush();
      });
      return p.then(onFulfilled, onRejected);
    },
    pipe(w) {
      claimConsumer("pipe");
      function flush() {
        allSettled(blockingPromises).then(() => {
          scheduleFlush(() => {
            if (dead) return;
            try {
              doShell();
            } catch (err) {
              // Contain retry-pass errors (see failRender) and end the sink:
              // it is still alive — the RENDER died — and leaving it open
              // would hang the response.
              failRender(err);
              try {
                w.end();
              } catch (_) {}
              return;
            }
            if (!shellCompleted) return flush();
            const sink = guardSink(w);
            buffer = writable = coalesceWrites(sink.write, sink.end);
            buffer.write(tmp);
            // Shell TTFB is never deferred — flush the handoff synchronously.
            buffer.flush();
            firstFlushed = true;
            if (completed) {
              dispose();
              writable.end();
            } else flushEnd();
          });
        });
      }
      flush();
    },
    pipeTo(w) {
      claimConsumer("pipeTo");
      return pipeToImpl(w);
    },
    get readable() {
      claimConsumer("readable");
      if (!cachedReadable) {
        const t = new TransformStream();
        // Deliberately NOT awaited: the pipe settles only after the whole
        // render has been written, and nothing drains the readable side
        // until it is handed back — awaiting before returning would
        // deadlock. The pipe already encodes chunks (TextEncoder), so the
        // readable side yields Uint8Array bytes, Response-body ready.
        pipeToImpl(t.writable);
        cachedReadable = t.readable;
      }
      return cachedReadable;
    }
  };
}
export function HydrationScript(props: { nonce?: string; eventNames?: string[] }): JSX.Element;

// components
export function HydrationScript(props) {
  const nonce = scriptNonce(sharedConfig.context && sharedConfig.context.nonce);
  return ssr(generateHydrationScript({ nonce, ...props }));
}
export function ssrGroup<T extends () => any[]>(fn: T, n: number): T;

// Compiler-emitted: tags `fn` so `ssr()` routes it through the grouped
// fast-path. One grouped fn per element collapses N attribute/textContent
// closures into one array-returning call.
export function ssrGroup(fn, n) {
  fn.$g = n;
  return fn;
}

// Cold-path NotReady catch + owner-capture wrap, shared by every site
// that escalates a sync throw to a streaming retry slot. Returns
// `{ fn, p }` on `NotReadyError` (with `fn` bound to the original owner
// so retries see the same id counter / contexts) or `null` for
// non-NotReady errors so callers can fall back to their contribute-
// nothing path.
function buildAsyncWrap(err, node) {
  const p = ssrHandleError(err);
  if (!p) return null;
  // A hole that suspends AGAIN on a retry pass arrives here already wrapped
  // (the $rw brand below). Reuse that wrapper: it restores the owner captured
  // at the ORIGINAL suspension — the one closest to the hole, which is also
  // the innermost (winning) restore the old nested form ended at. Wrapping it
  // again under whatever owner is ambient during the retry stacked one more
  // runWithOwner closure per pass, so a hole that re-suspended N times cost
  // O(N) stack frames per invocation and O(N²) over the render — a long
  // re-suspension chain overflowed the stack (SSR stack-overflow diagnosis).
  if (node.$rw) return { fn: node, p };
  const owner = getOwner();
  // A live hole's retry chain stays mint-suppressed end to end, and a
  // machinery-owned node's (`$lhSkip` — boundary outputs, slot getters)
  // stays opted out: every escalation re-wrap crosses this site, so
  // propagating the tags here covers all of them (ssr()'s inline path, the
  // tree resolver, group slots). An UNTAGGED node escalating inside an open
  // suppression window is interior to some suppressed resolve — its retry
  // is part of that chain, so it suppresses too (without this, a partial
  // interior escalation would mint on its later re-pull).
  const live = sharedConfig.context && sharedConfig.context.liveHoles;
  const suppress = node.$lhSuppress || (live && (live.suppressed || live.sweeping));
  if (!owner) {
    // No wrapper to carry tags — the node itself continues as the retry fn,
    // so the suppression latch lands on it directly ($lhSkip/$lhBinding
    // already live there).
    if (suppress) node.$lhSuppress = true;
    return { fn: node, p };
  }
  const fn = () => runWithOwner(owner, node);
  fn.$rw = true;
  if (suppress) fn.$lhSuppress = true;
  if (node.$lhSkip) fn.$lhSkip = true;
  if (node.$lhBinding) fn.$lhBinding = node.$lhBinding;
  return { fn, p };
}

// Cold-path helper for the first hit of a group. Isolates `try/catch`
// from the hot `ssr()` loop. Returns the value array on sync success,
// `{ fn, p }` on `NotReadyError` escalation, or `null` for non-NotReady
// errors (matches `tryResolveString`'s "" path).
function ssrFirstGroupHit(hole) {
  try {
    return hole();
  } catch (err) {
    return buildAsyncWrap(err, hole);
  }
}

function tryResolveFunctionHole(hole) {
  let value;
  try {
    value = hole();
  } catch (err) {
    return buildAsyncWrap(err, hole) || "";
  }
  const t = typeof value;
  if (t === "string") return value;
  if (t === "number") return "" + value;
  if (value == null || t === "boolean") return "";
  return tryResolveString(value);
}

// Cold-path: splice a nested `{ t, h, p }` template into `result` at
// its current last segment. Used when `tryResolveString` walks into a
// template object that itself carries async holes.
function mergeTemplateInto(result, node) {
  result.t[result.t.length - 1] += node.t[0];
  if (node.t.length > 1) {
    result.t.push(...node.t.slice(1));
    result.h.push(...node.h);
    result.p.push(...node.p);
  }
}

function appendResolvedNode(result, node) {
  if (node.fn !== undefined) {
    result.h.push(node.fn);
    result.p.push(node.p);
    result.t.push("");
  } else if (node.merge !== undefined) mergeTemplateInto(result, node.merge);
  else resolveSSRNode(node.bail, result);
}

// Module-scoped cache for grouped retry slots. Slots fire contiguously
// in queue order, so slot 0 evaluates `fn` once and caches `arr`
// (success) or `err` (NotReady) on the module slots; slots `1..N-1`
// short-circuit on `_lastGroupFn === fn`. Cache invalidates on a
// different fn (next group) or when slot 0 re-fires (next retry pass
// for the same group). Net: 1 evaluation per group per pass.
let _lastGroupFn = null;
let _lastGroupArr = null;
let _lastGroupErr = null;

function ssrGroupSlot(fn, idx) {
  return () => {
    if (idx > 0 && _lastGroupFn === fn) {
      if (_lastGroupArr !== null) return _lastGroupArr[idx];
      throw _lastGroupErr;
    }
    _lastGroupFn = fn;
    _lastGroupArr = null;
    _lastGroupErr = null;
    try {
      _lastGroupArr = fn();
      return _lastGroupArr[idx];
    } catch (err) {
      _lastGroupErr = err;
      throw err;
    }
  };
}

// ---- live markup holes (Stage 3): the DR-2 binding ledger generalized ----
//
// In a live frame render (the call-driven face), thunk-compiled content
// holes are wrapped in identified comment pairs (`<!--lh:N-->…<!--lh:/N-->`)
// and open ledger bindings: commits the response observes re-run the thunk,
// equality-gate the resolved HTML, and re-emit changed holes as keyed
// `hole` chunks the client morphs in place. Enabled per render context
// (`sharedConfig.context.liveHoles`). The document face (Stage 4) arms one
// engine per render, scope-gated to server-component interiors — plain
// document content never sets it locally and its bytes stay untouched (the
// t=0 first-value lock survives outside the barrier).
//
// What is deliberately NOT live here: eagerly-compiled holes (the compiler
// already made the static/dynamic split — statics arrive as values, not
// thunks); in-tag (attribute-position) holes, which cannot carry comment
// markers and are the attribute slice's element-addressed work; group
// (`$g`) slots, which mix attribute and content positions; and interiors
// of a sweep's re-evaluation (a re-emitted hole is morphed wholesale, so
// nested re-minting would only leak bindings).

// Per-template classification of hole positions, cached by template
// identity (a WeakMap — tagged-template arrays are frozen). Hole i sits
// between t[i] and t[i+1]; it is a content position iff the markup up to
// that point leaves us outside an open tag. The scan is quote-aware so a
// `>` inside a quoted attribute value doesn't close the tag.
//
// The same scan feeds the attr-hole slice with per-SEGMENT tag geometry:
//   - `openOff[i]`: offset within t[i] just after the tag NAME of the last
//     tag-open still open at the segment's end (the address-injection
//     point), or -1 — tag names are template-static, so this is exact;
//   - `closeOff[i]`: offset within t[i] of the `>` closing the tag that was
//     open coming INTO the segment (where an attr capture ends), or -1.
const holePositionCache = new WeakMap();
function holeContentPositions(t) {
  let cached = holePositionCache.get(t);
  if (cached) return cached;
  const pos = [];
  const openOff = [];
  const closeOff = [];
  let inTag = false;
  let quote = "";
  // The open tag's name-end, carried across segments while it stays open:
  // { seg, off } or null.
  let curOpen = null;
  let scanningName = false;
  for (let i = 0; i < t.length; i++) {
    const seg = t[i];
    let close = -1;
    const openAtStart = inTag;
    let reopened = false;
    for (let j = 0; j < seg.length; j++) {
      const ch = seg[j];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (inTag) {
        if (
          scanningName &&
          (ch === " " || ch === "\t" || ch === "\n" || ch === ">" || ch === "/")
        ) {
          scanningName = false;
          curOpen = { seg: i, off: j };
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ">") {
          inTag = false;
          if (openAtStart && !reopened && close === -1) close = j;
          curOpen = null;
        }
      } else if (ch === "<") {
        inTag = true;
        scanningName = true;
        reopened = true;
        curOpen = null;
      }
    }
    if (inTag && scanningName) {
      // Tag name runs to the segment's end (`<div` + hole next).
      scanningName = false;
      curOpen = { seg: i, off: seg.length };
    }
    closeOff.push(close);
    openOff.push(inTag && curOpen && curOpen.seg === i ? curOpen.off : -1);
    if (i < t.length - 1) pos.push(!inTag);
  }
  cached = { pos, openOff, closeOff };
  holePositionCache.set(t, cached);
  return cached;
}

/**
 * The live-hole engine for one frame response. Constructed by the frame
 * renderer (frame-sink) and published on the render context; `ssr()` and
 * `resolveSSRNode` route content holes through `content()` while it is
 * present. Bindings live in the sink's DR-2 ledger — same commit-driven
 * sweeps, same equality gating, same end-of-response latch as watched slot
 * args.
 *
 * Every state transition is commit-driven: the engine never chains its own
 * promises, so it cannot amplify commits or starve the event loop — a
 * pending re-evaluation simply waits for the next commit (async settles
 * commit through the render core, and the response's end-latch sweep is
 * always the last one).
 */
export function createLiveHoles(sink, scoped) {
  let nextId = 0;
  const stamp = typeof creationStamp === "function" ? creationStamp : () => 0;
  // The document-face arming gate: one engine serves the whole render, but
  // only holes minted inside a server component's scope may mark and bind —
  // plain document content keeps its t=0 latch and its exact bytes. Stream
  // renders pass nothing (the entire response is the component).
  const inScope =
    scoped && typeof inServerComponentScope === "function" ? inServerComponentScope : null;
  // Baselines compare marker-free: a first render's html carries nested
  // holes' markers, while sweep re-evaluations are mint-suppressed and
  // produce none — the equality gate must not read that as a change.
  const stripMarkers = html => html.replace(/<!--lh:\/?\d+-->/g, "");
  // Sweeps re-evaluate under the mint-time render CONTEXT as well as the
  // owner. `runWithOwner` restores only the owner; everything a compiled
  // template reads off `sharedConfig.context` (the behavior-claims arming
  // enum, key scopes) is a module global the render moves past. The stream
  // face never noticed — its whole response is one render, so the global
  // still points at the armed context when async sweeps fire. The document
  // face replaces it as the document renders past the component, so swept
  // re-emissions there lost every context-derived byte: `_bnd` claim
  // markers vanished from late holes (a copy button that compiled, streamed
  // its markup, and never armed).
  const swept = (owner, ctx, fn) => {
    const prev = sharedConfig.context;
    sharedConfig.context = ctx;
    try {
      return owner ? runWithOwner(owner, fn) : fn();
    } finally {
      sharedConfig.context = prev;
    }
  };
  // Resolve a hole thunk's value to a `{ t, h, p }` result. NotReady
  // escalations are absorbed into h/p (the caller decides pending
  // semantics); real errors propagate.
  function resolveHoleValue(hole) {
    const result = { t: [""], h: [], p: [] };
    try {
      resolveSSRNode(hole(), result);
    } catch (err) {
      const wrap = buildAsyncWrap(err, hole);
      if (!wrap) throw err;
      result.h.push(wrap.fn);
      result.p.push(wrap.p);
      result.t.push("");
    }
    return result;
  }
  // Supersession: a hole that re-emits replaces its previous output
  // wholesale, so bindings minted inside that output retire with it.
  // (A latched interior entry has no key — it never opened — but its own
  // children might have.)
  function closeChildren(b) {
    for (const c of b.children) {
      c.closed = true;
      if (c.key) sink.closeBinding(c.key);
      closeChildren(c);
    }
    b.children.length = 0;
  }
  const engine = {
    // In-tag routing from `ssr()` and retry-chain resolution (`$lhSuppress`)
    // suppress interception for the duration of one synchronous resolve;
    // sweeps suppress nested minting.
    suppressed: 0,
    sweeping: false,
    parent: null,
    // The impurity gates. Slot/region records are emit-once (occurrence
    // identity is positional), and reactive scopes are render-once (a memo
    // re-created per sweep re-subscribes its sources — for an async
    // iterable that is a fresh consumer and a fresh commit pump EVERY
    // sweep, a multiplying feedback loop): an evaluation that does either
    // is not re-runnable. First renders diff `recordStamp` / the
    // creation stamp and latch the hole; sweep evaluations diff them and
    // close the binding.
    recordStamp: 0,
    gateHit: false,
    /**
     * Intercept a thunk content hole: resolve it, and — when the evaluation
     * proves re-runnable — mint an id, wrap the output in its marker pair,
     * and open the ledger binding. Returns a string (sync resolve), a
     * marker-wrapped `{ t, h, p }` template (NotReady escalation — markers
     * ride the template so the retry's splice lands inside them), an
     * UNMARKED string/template (latched: slot positions, impure
     * evaluations), or null when interception is off for this evaluation.
     */
    content(hole) {
      // A retry fn of an escalated hole re-enters here on its re-pull —
      // through `ctx.ssr(pending.t, ...pending.h)` (boundary resume) or the
      // tree resolver (root holes). Its markers already ride the pending
      // template, so it resolves mint-free under a suppression window
      // (re-wraps keep the chain tagged through `buildAsyncWrap`). A sync
      // resolve here is the exact html that splices between the markers, so
      // capture it as the binding's baseline: emission is baseline-gated,
      // so what the client already has never re-ships. Never capture from a
      // sweep — a sweep's value doesn't ship, and a baseline the client
      // never saw would swallow a needed emission.
      if (hole.$lhSuppress) {
        const r = { t: [""], h: [], p: [] };
        engine.suppressed++;
        try {
          try {
            resolveSSRNode(hole(), r);
          } catch (err) {
            const wrap = buildAsyncWrap(err, hole);
            // Real error: contribute nothing, matching the resolver's
            // existing function-node semantics (ssrHandleError already ran).
            if (wrap) {
              r.h.push(wrap.fn);
              r.p.push(wrap.p);
              r.t.push("");
            }
          }
        } finally {
          engine.suppressed--;
        }
        const b = hole.$lhBinding;
        if (b && !b.closed && !r.h.length && !engine.sweeping) {
          b.last = stripMarkers(r.t[0]);
        }
        return r.h.length ? r : r.t[0];
      }
      if (engine.suppressed || engine.sweeping) return null;
      // Slot positions are client-owned constants — the server can never
      // re-render one, so a live binding over one would be permanently
      // inert and its markers pure tax. A tagged slot getter defers to the
      // normal path before evaluation…
      if (hole.$lhSkip) return null;
      // Outside the arming scope (document face, non-component content):
      // resolve on the normal path, unmarked and unbound.
      if (inScope && !inScope()) return null;
      const recordsBefore = engine.recordStamp;
      const ownersBefore = stamp();
      const owner = getOwner();
      const holeCtx = sharedConfig.context;
      const b = {
        key: null,
        children: [],
        last: null,
        closed: false,
        sweep() {
          if (b.closed) return;
          const prevSweeping = engine.sweeping;
          engine.sweeping = true;
          engine.gateHit = false;
          const sweepOwnersBefore = stamp();
          let res;
          try {
            res = swept(owner, holeCtx, () => resolveHoleValue(hole));
          } catch (err) {
            // A real error is terminal for the hole — the last emitted
            // markup stands and the failure surfaces as a keyed error.
            b.closed = true;
            sink.closeBinding(b.key);
            sink.error(b.key, String((err && err.message) || err));
            return;
          } finally {
            engine.sweeping = prevSweeping;
          }
          // An impure re-evaluation (slot records or reactive-scope
          // creation — reachable only when the first render escalated
          // before its impure part ran): the hole is not re-runnable.
          // Close and latch what the retry path shipped.
          if (engine.gateHit || stamp() !== sweepOwnersBefore) {
            b.closed = true;
            sink.closeBinding(b.key);
            return;
          }
          // Still pending: hold the last value and wait — the settle that
          // resolves this is itself a commit, which re-sweeps. No promise
          // chain here, by design (see the engine header).
          if (res.h.length) return;
          // Baseline-gated emission. An escalated binding with no baseline
          // yet (b.last === null) defers: its markers haven't shipped — the
          // retry splice in flight carries the client's first value and arms
          // the baseline when it resolves (the capture in `content()`), and
          // a later sweep is guaranteed (every commit sweeps; sink.end's
          // latch sweep is the floor), so nothing is lost — an emission now
          // would just re-ship what the splice is about to deliver.
          const html = res.t[0];
          if (b.last === null || html === b.last) return;
          b.last = html;
          closeChildren(b);
          sink.hole(b.key, html);
        }
      };
      if (engine.parent) engine.parent.children.push(b);
      const prevParent = engine.parent;
      // The parent frame spans EVALUATION as well as resolve: `ssr()`
      // resolves its holes at construction time, so a nested template's
      // interior holes mint during `hole()` itself — they must land in
      // `b.children` for supersession (a re-emission of this hole replaces
      // the ranges those children mark, so their bindings retire with it).
      engine.parent = b;
      let value;
      let escalated = null;
      try {
        value = hole();
      } catch (err) {
        const wrap = buildAsyncWrap(err, hole);
        if (!wrap) {
          // Real error at first render: existing content semantics are
          // "contribute nothing" — no marker, no binding. Interior holes
          // minted before the throw rode markup discarded with it.
          engine.parent = prevParent;
          closeChildren(b);
          return "";
        }
        escalated = wrap;
      }
      if (
        !escalated &&
        ((typeof value === "function" && value.$lhSkip) ||
          (value !== null && typeof value === "object" && value.$slot))
      ) {
        // …and a slot-tagged value resolves unmarked (suppressed, so a
        // wrapped getter isn't re-intercepted one level down).
        engine.parent = prevParent;
        const r = { t: [""], h: [], p: [] };
        engine.suppressed++;
        try {
          resolveSSRNode(value, r);
        } finally {
          engine.suppressed--;
        }
        return r.h.length ? r : r.t[0];
      }
      let res;
      if (escalated) {
        // The retry chain resolves mint-suppressed (`$lhSuppress`, which
        // `resolveSSRNode` honors and propagates through re-wraps): a retry
        // re-runs the whole thunk, so letting its interior mint would
        // duplicate bindings on every attempt. The binding link
        // (`$lhBinding`) lets the retry's resolving splice arm the baseline.
        // Interior mints from the failed first attempt rode discarded html
        // and the suppressed retry never re-mints them — retire them now.
        closeChildren(b);
        escalated.fn.$lhSuppress = true;
        escalated.fn.$lhBinding = b;
        res = { t: ["", ""], h: [escalated.fn], p: [escalated.p] };
      } else {
        res = { t: [""], h: [], p: [] };
        try {
          resolveSSRNode(value, res);
        } catch (_) {
          engine.parent = prevParent;
          closeChildren(b);
          return "";
        }
      }
      engine.parent = prevParent;
      // The impurity gate (see the engine fields): this evaluation emitted
      // records or created reactive scopes, so re-running it would duplicate
      // them. The hole latches: no marker, no binding. Interior holes minted
      // during this resolve stay live on their own bindings — which is the
      // intended granularity: component-position thunks latch, and the
      // expression holes inside the components they created are the live
      // ones (render-once, updated fine-grained — the client model's shape).
      if (engine.recordStamp !== recordsBefore || stamp() !== ownersBefore) {
        return res.h.length ? res : res.t[0];
      }
      const id = nextId++;
      const key = (b.key = "lh:" + id);
      const open = `<!--lh:${id}-->`;
      const close = `<!--lh:/${id}-->`;
      if (!res.h.length) {
        b.last = stripMarkers(res.t[0]);
        sink.openBinding(key, b);
        return open + res.t[0] + close;
      }
      // Escalated mint: markers ride the template so the retry's splice
      // lands inside them. The baseline arms when the retry chain sync-
      // resolves through `content()`'s suppress branch — that resolve IS
      // the spliced html, so the capture can never latch a value the client
      // didn't get. On the capture-less edge paths b.last stays null and
      // the first resolved sweep emits unconditionally — safe redundancy:
      // the client's hole apply is placeholder-guarded, so an emission
      // racing the fragment reveal defers rather than destroying the
      // pending range.
      const t = res.t.slice();
      t[0] = open + t[0];
      t[t.length - 1] += close;
      sink.openBinding(key, b);
      return { t, h: res.h, p: res.p };
    },
    /** The shared id counter — `ssr()` mints an attr address at injection
     *  time, before its capture completes. */
    mint() {
      return nextId++;
    },
    /** Whether interception may arm at the current evaluation point —
     *  `ssr()` asks before opening an attr capture (the `data-lha`
     *  injection must not touch out-of-scope bytes; content holes are
     *  gated inside `content()` itself). */
    active() {
      return !inScope || inScope();
    },
    /**
     * Register an element's attr-hole capture (built by `ssr()`'s in-tag
     * scan): the tag's attribute area as alternating static strings and
     * re-runnable parts (`{ f }` thunks, `{ g, i }` group positions). Sweeps
     * rebuild the text, equality-gate against the baseline, and ship
     * changes as an element-keyed `attr` chunk. Names that vanish between
     * rebuilds ride an explicit `removed` list — the server holds the
     * previous text, so the client never tracks name history.
     */
    attr(cap) {
      const owner = getOwner();
      const holeCtx = sharedConfig.context;
      const b = {
        key: "lha:" + cap.id,
        children: [],
        last: cap.base,
        closed: false,
        sweep() {
          if (b.closed) return;
          const prevSweeping = engine.sweeping;
          engine.sweeping = true;
          engine.gateHit = false;
          const sweepOwnersBefore = stamp();
          let html = "";
          try {
            let group = null;
            let groupVal = null;
            const run = () => {
              for (const part of cap.parts) {
                if (typeof part === "string") {
                  html += part;
                  continue;
                }
                let v;
                if (part.g) {
                  if (group !== part.g) {
                    group = part.g;
                    groupVal = part.g();
                  }
                  v = groupVal[part.i];
                } else {
                  v = part.f();
                }
                const vt = typeof v;
                if (vt === "string" || vt === "number") html += v;
              }
            };
            swept(owner, holeCtx, run);
          } catch (err) {
            // NotReady holds for a later commit (the end-latch sweep is the
            // floor); a real error is terminal, same rule as content holes.
            if (ssrHandleError(err, true)) return;
            b.closed = true;
            sink.closeBinding(b.key);
            sink.error("lha:" + cap.id, String((err && err.message) || err));
            return;
          } finally {
            engine.sweeping = prevSweeping;
          }
          if (engine.gateHit || stamp() !== sweepOwnersBefore) {
            b.closed = true;
            sink.closeBinding(b.key);
            return;
          }
          if (html === b.last) return;
          const before = attrNames(b.last);
          const after = attrNames(html);
          const removed = before.filter(n => !after.includes(n));
          b.last = html;
          sink.attr(String(cap.id), html, removed);
        }
      };
      sink.openBinding(b.key, b);
    }
  };
  return engine;
}

// Attribute NAMES in a rebuilt attr text. Values are attribute-escaped
// (no raw quotes), so a quote-aware token scan is exact.
function attrNames(text) {
  const names = [];
  const re = /(?:^|\s)([^\s=/>"']+)(?:="[^"]*")?/g;
  let m;
  while ((m = re.exec(text))) names.push(m[1]);
  return names;
}
export function ssr(template: string[] | string, ...nodes: any[]): { t: string };

// rendering
export function ssr(t) {
  // Inlined hole resolution — uses `arguments` instead of a `(t, ...nodes)`
  // rest parameter to avoid the per-call holes-array allocation. Inline
  // string/number/null/bool fast paths skip `tryResolveString` entirely
  // for the typical "all-static-after-eval" hole shape; only the heavy
  // path (async escalation) materializes the `{ t, h, p }` result shape.
  //
  // Group fast-path (`hole.$g` set by compiler `_$ssrGroup`): one call
  // returns an array of values for >=N hole positions. The check is at
  // the END of the typeof chain so non-function holes don't pay for it.
  const len = arguments.length;
  if (len === 1) return { t };
  let s = t[0];
  let result = null;
  let lastGroup = null;
  // Array on sync success, `{ fn, p }` on escalation, null otherwise.
  let lastGroupVal = null;
  let lastGroupIdx = 0;
  // ---- attr holes (live frame renders only; hp/lastOpen/cap stay null
  // otherwise and every hook below is a single falsy check) ----
  // In-tag holes can't carry comment markers, so a tag containing them is
  // ELEMENT-addressed: at its first in-tag thunk the engine mints an id,
  // ` data-lha="N"` splices into the accumulated output at the tag-open
  // point (known exactly — tag names are template-static), and a capture
  // collects the tag's attribute area as alternating statics and
  // re-runnable parts until the tag's `>`. The registered binding rebuilds
  // that text on commits and re-emits changes element-keyed.
  const live = sharedConfig.context && sharedConfig.context.liveHoles;
  const hp = live ? holeContentPositions(t) : null;
  // The still-open tag's insert point: { r: result-or-null, seg, off }.
  let lastOpen = null;
  let cap = null;
  if (live && hp.openOff[0] >= 0) lastOpen = { r: null, seg: -1, off: hp.openOff[0] };
  // Try to open a capture at an in-tag thunk. Returns true when capturing
  // (started or already active). Declines when the tag-open buffer is no
  // longer the current tail (an earlier hole of this tag escalated — the
  // tag latches) or interception is off for this evaluation.
  const captureStart = () => {
    if (cap) return true;
    if (!lastOpen || live.suppressed || live.sweeping || !live.active()) return false;
    if (lastOpen.r !== result || (result !== null && lastOpen.seg !== result.t.length - 1)) {
      return false;
    }
    const id = live.mint();
    const inject = ` data-lha="${id}"`;
    let prefix;
    if (result === null) {
      s = s.slice(0, lastOpen.off) + inject + s.slice(lastOpen.off);
      prefix = s.slice(lastOpen.off + inject.length);
    } else {
      const seg = result.t[lastOpen.seg];
      result.t[lastOpen.seg] = seg.slice(0, lastOpen.off) + inject + seg.slice(lastOpen.off);
      prefix = result.t[lastOpen.seg].slice(lastOpen.off + inject.length);
    }
    cap = { id, parts: [prefix], base: prefix };
    return true;
  };
  for (let i = 1; i < len; i++) {
    const hole = arguments[i];
    const ht = typeof hole;
    if (ht === "string") {
      if (result === null) s += hole;
      else result.t[result.t.length - 1] += hole;
      // In-tag eager strings (hydration keys, precomputed statics) are
      // constants for the response: they join the rebuild text verbatim.
      if (cap) {
        cap.parts.push(hole);
        cap.base += hole;
      }
    } else if (ht === "number") {
      if (result === null) s += hole;
      else result.t[result.t.length - 1] += hole;
      if (cap) {
        cap.parts.push("" + hole);
        cap.base += hole;
      }
    } else if (hole == null || ht === "boolean") {
      // skip
    } else if (ht === "function" && hole.$g) {
      let value;
      let hasValue = false;
      if (lastGroup !== hole) {
        const r = ssrFirstGroupHit(hole);
        if (r !== null) {
          lastGroup = hole;
          lastGroupVal = r;
          lastGroupIdx = 0;
          if (!Array.isArray(r) && result === null) {
            result = { t: [s], h: [], p: [] };
            s = "";
          }
        }
        // r === null: non-NotReady error, contribute nothing — matches
        // the `return ""` path in `tryResolveString`.
      }
      if (lastGroup === hole) {
        if (Array.isArray(lastGroupVal)) {
          value = lastGroupVal[lastGroupIdx++];
          hasValue = true;
          // A group can span elements; each element captures only its own
          // positions (by dequeue index — group order is positional).
          if (live && !hp.pos[i - 1] && captureStart()) {
            cap.parts.push({ g: hole, i: lastGroupIdx - 1 });
          }
        } else {
          // Group escalation: the tag (if one is being captured) went
          // async mid-attrs — it latches.
          cap = null;
          result.h.push(ssrGroupSlot(lastGroupVal.fn, lastGroupIdx++));
          result.p.push(lastGroupVal.p);
          result.t.push("");
        }
      }
      if (hasValue) {
        // Type dispatch on the dequeued value. textContent expressions
        // (e.g., `_$escape(item().title)`) can return arrays when the
        // input is an array, so we cannot assume strings here.
        const vt = typeof value;
        if (vt === "string" || vt === "number") {
          if (result === null) s += value;
          else result.t[result.t.length - 1] += value;
          if (cap && !hp.pos[i - 1]) cap.base += value;
        } else if (value == null || vt === "boolean") {
          // skip
        } else if (result !== null) {
          resolveSSRNode(value, result);
        } else {
          const rs = tryResolveString(value);
          if (typeof rs === "string") {
            s += rs;
          } else {
            result = { t: [s], h: [], p: [] };
            s = "";
            if (rs.merge !== undefined) mergeTemplateInto(result, rs.merge);
            else resolveSSRNode(rs.bail, result);
          }
        }
      }
    } else if (ht === "function") {
      // Live frame renders route thunk content holes through the live-hole
      // engine (mark + ledger binding). In-tag positions must never be
      // intercepted — a comment cannot sit inside a tag — including by the
      // nested resolve, hence the suppression around that route.
      let liveNode = null;
      if (live && hp.pos[i - 1] && (liveNode = live.content(hole)) !== null) {
        if (typeof liveNode === "string") {
          if (result === null) s += liveNode;
          else result.t[result.t.length - 1] += liveNode;
        } else {
          if (result === null) {
            result = { t: [s], h: [], p: [] };
            s = "";
          }
          resolveSSRNode(liveNode, result);
        }
      } else if (result !== null) {
        const inTag = live && !hp.pos[i - 1];
        const capturing = inTag && captureStart();
        const li = capturing ? result.t.length - 1 : 0;
        const before = capturing ? result.t[li].length : 0;
        if (live) live.suppressed++;
        try {
          resolveSSRNode(hole, result);
        } finally {
          if (live) live.suppressed--;
        }
        if (capturing) {
          if (result.t.length - 1 === li) {
            cap.base += result.t[li].slice(before);
            cap.parts.push({ f: hole });
          } else {
            // The hole escalated mid-attrs: the tag latches.
            cap = null;
          }
        }
      } else {
        // Capture opens BEFORE the value resolves — the prefix slice must
        // stop at the hole position, not swallow its first value.
        const capturing = live && !hp.pos[i - 1] && captureStart();
        const r = tryResolveFunctionHole(hole);
        if (typeof r === "string") {
          s += r;
          if (capturing) {
            cap.base += r;
            cap.parts.push({ f: hole });
          }
        } else {
          // The hole escalated mid-attrs: the tag latches.
          if (capturing) cap = null;
          result = { t: [s], h: [], p: [] };
          s = "";
          appendResolvedNode(result, r);
        }
      }
    } else if (result !== null) {
      resolveSSRNode(hole, result);
    } else {
      const r = tryResolveString(hole);
      if (typeof r === "string") {
        s += r;
      } else {
        // Escalation: allocate the heavy `{ t, h, p }` result shape and
        // splice in the sync prefix we accumulated.
        result = { t: [s], h: [], p: [] };
        s = "";
        appendResolvedNode(result, r);
      }
    }
    const next = t[i];
    if (live) {
      // Segment bookkeeping: close the active capture at the tag's `>`
      // (register its binding), then note a new tag-open insert point.
      if (cap) {
        const co = hp.closeOff[i];
        if (co >= 0) {
          const tail = next.slice(0, co);
          cap.parts.push(tail);
          cap.base += tail;
          live.attr(cap);
          cap = null;
        } else {
          cap.parts.push(next);
          cap.base += next;
        }
      }
      if (hp.openOff[i] >= 0) {
        lastOpen =
          result === null
            ? { r: null, seg: -1, off: s.length + hp.openOff[i] }
            : {
                r: result,
                seg: result.t.length - 1,
                off: result.t[result.t.length - 1].length + hp.openOff[i]
              };
      }
    }
    if (result === null) s += next;
    else result.t[result.t.length - 1] += next;
  }
  if (result === null) return { t: s };
  return result;
}
export function ssrClassName(value: string | { [k: string]: boolean } | Array<any>): string;

export function ssrClassName(value) {
  if (!value) return "";
  if (typeof value === "string") return escape(value, true);
  value = classListToObject(value);
  let classKeys = Object.keys(value),
    result = "";
  for (let i = 0, len = classKeys.length; i < len; i++) {
    const key = classKeys[i],
      classValue = !!value[key];
    if (!key || key === "undefined" || !classValue) continue;
    i && (result += " ");
    // Object keys land inside class="..." so they must be attribute-escaped.
    result += escape(key, true);
  }
  return result;
}
export function ssrStyle(value: string | { [k: string]: string }): string;

export function ssrStyle(value) {
  if (!value) return "";
  if (typeof value === "string") return escape(value, true);

  let result = "";
  const k = Object.keys(value);
  for (let i = 0; i < k.length; i++) {
    // Object keys land inside style="..." so they must be attribute-escaped
    // to prevent breaking out via `"`.
    const s = escape(k[i], true);
    const v = value[k[i]];
    if (v != undefined) {
      if (i) result += ";";
      const r = escape(v, true);
      if (r != undefined && r !== "undefined") {
        result += `${s}:${r}`;
      }
    }
  }
  return result;
}
export function ssrStyleProperty(name: string, value: any): string;

export function ssrStyleProperty(name, value) {
  // Compiler contract: for literal-key `style={{ color: v }}` the compiler
  // passes a fixed string like `"color:"`; for computed-key
  // `style={{ [k]: v }}` the compiler wraps the key with `_$escape(k, true)`
  // before concatenating the `:` suffix. Either way `name` is safe to splice
  // into style="..." without further escaping.
  return value != null ? name + value : "";
}
export function ssrElement(
  name: string,
  props: any,
  children: any,
  needsId: boolean
): { t: string };

// review with new ssr
export function ssrElement(tag, props, children, needsId) {
  // The hydration key must be allocated before the props thunk runs: dynamic
  // props (`mergeProps(() => ...)`) create a memo, which consumes a child id.
  // The client claims the element (getNextElement) before applying the spread,
  // so the server must allocate in the same order or the element's own id
  // shifts by one and it is left unclaimed on hydration.
  const hk = needsId ? ssrHydrationKey() : "";
  if (props == null) props = {};
  else if (typeof props === "function") props = props();
  const skipChildren = VOID_ELEMENTS.test(tag);
  const keys = Object.keys(props);
  let result = `<${tag}${hk} `;
  for (let i = 0; i < keys.length; i++) {
    const prop = keys[i];
    if (ChildProperties.has(prop)) {
      if (children === undefined && !skipChildren)
        children =
          tag === "script" || tag === "style" || prop === "innerHTML"
            ? props[prop]
            : escape(props[prop]);
      continue;
    }
    const value = props[prop];
    if (prop === "style") {
      result += `style="${ssrStyle(value)}"`;
    } else if (prop === "class") {
      result += `class="${ssrClassName(value)}"`;
    } else if (
      value == undefined ||
      prop === "ref" ||
      prop.slice(0, 2) === "on" ||
      prop.slice(0, 5) === "prop:"
    ) {
      // Behavior claims ride NAMED ref/on* positions only — the compiler
      // can't see through a spread, so a claim-carrying stub landing here
      // silently drops. Say so where the author can act on it.
      if (
        "_SOLID_DEV_" &&
        typeof value === "function" &&
        value[CLAIM_PROP] !== undefined &&
        (prop === "ref" || prop.slice(0, 2) === "on")
      ) {
        console.warn(
          `A spread on a server-rendered <${tag}> carries \`${prop}\` from client props — ` +
            `spreads don't participate in behavior claims, so this drops. ` +
            `Write the position out: \`${prop}={props.${String(value[CLAIM_PROP])}}\`.`
        );
      }
      continue;
    } else if (typeof value === "boolean") {
      if (!value) continue;
      result += escape(prop);
    } else {
      result += value === "" ? escape(prop) : `${escape(prop)}="${escape(value, true)}"`;
    }
    if (i !== keys.length - 1) result += " ";
  }

  if (skipChildren) return { t: result + "/>" };
  if (typeof children === "function") children = children();
  return ssr([result + ">", `</${tag}>`], resolveSSRNode(children, undefined, true));
}
export function ssrAttribute(key: string, value: any): string;

export function ssrAttribute(key, value) {
  // Compiler contract: `key` is always a compile-time string literal emitted
  // from a JSX attribute name (see setAttr in babel-plugin/src/ssr/element.js)
  // which can never contain `"`, `<`, `&`, or `>`. `value` is already
  // attribute-escaped by the compiler via `_$escape(..., true)`. Both are
  // trusted here so this hot path stays a pure string concatenation.
  return value == null || value === false ? "" : value === true ? ` ${key}` : ` ${key}="${value}"`;
}
export function ssrHydrationKey(): string;

export function ssrHydrationKey() {
  const hk = getHydrationKey();
  return hk ? ` _hk=${hk}` : "";
}

// ---- server-component behavior claims (Stage 6: ref/event props) ----
//
// Compiled SSR output (behind the `serverComponents` compiler option) emits
// `ctx.claims ? ssrClaim({ click: expr, ref: expr2 }) : ""` as a
// whole-attribute hole on intrinsic elements carrying ref/on* positions. The
// brand is the slot-props stub: a function-valued prop read off a server
// component's props proxy carries its prop name (CLAIM_PROP), and the marker
// simply names it — `_bnd="click=onCopy"`. Resolution happens client-side at
// dispatch/adoption time through the frame's LIVE props (nearest `data-fid`
// ancestor), which is what makes re-renders latest-props by construction: no
// binding table, no versioning, no supersession window.
//
// The gate has two layers, split between evaluation and mint:
// - `ctx.claims` (the compiled guard) is ARMING — a plain enum the frame
//   renderers set at server-component entry, so renders with no server
//   components never evaluate the expressions (a property miss), and
//   context clones carry it by spread.
// - the mint check here is SCOPE — on the document face (CLAIMS_DOCUMENT)
//   only owner chains inside the component barrier mint. Client fill
//   content re-enters the zone owner captured OUTSIDE the barrier, so
//   fills neither claim nor warn (their handlers are hydration's, and
//   legitimate). The stream face (CLAIMS_STREAM) mints unconditionally:
//   the whole response is the component and fills never render there.
export const CLAIM_PROP = /*#__PURE__*/ Symbol.for("solid.claim-prop");
export const CLAIMS_STREAM = 1;
export const CLAIMS_DOCUMENT = 2;

// `_bnd` value grammar: `pos=prop[,pos=prop]*`. Prop names are client-
// controlled strings landing in a quoted attribute that splits on `,`/`=`,
// so unsafe characters percent-encode — URI-style (UTF-8 %XX sequences),
// because unlike occurrence ids the CLIENT decodes these back to prop names
// (`decodeURIComponent` at dispatch). The passthrough alphabet is attribute-
// and grammar-safe; `%` itself encodes, so the mapping is injective.
// Position names come from static JSX attribute names and are grammar-safe
// by construction.
const CLAIM_UNSAFE = /[^A-Za-z0-9_.!~*'()-]/g;
function encodeClaimKey(key) {
  return String(key).replace(CLAIM_UNSAFE, c => encodeURIComponent(c));
}

export function ssrClaim(map) {
  const mode = sharedConfig.context && sharedConfig.context.claims;
  if (
    !mode ||
    (mode === CLAIMS_DOCUMENT &&
      !(typeof inServerComponentScope === "function" && inServerComponentScope()))
  ) {
    return "";
  }
  let out = "";
  for (const pos in map) {
    const value = map[pos];
    const list = Array.isArray(value) ? value : [value];
    for (const fn of list) {
      const prop = (typeof fn === "function" && fn[CLAIM_PROP]) || undefined;
      if (prop === undefined) {
        if ("_SOLID_DEV_") {
          console.warn(
            `A \`${pos}\` position on a server-rendered element received a server-local ` +
              `${typeof fn} — this handler can never run. Pass the function through the ` +
              `server component's props from the client (compose on the client before ` +
              `passing), or bind a mutation to \`action=\`.`
          );
        }
        continue;
      }
      out += `${out ? "," : ""}${pos}=${encodeClaimKey(prop)}`;
    }
  }
  return out ? ` _bnd="${out}"` : "";
}

// --- <select value> resolution (solidjs/solid#3013) ---------------------------
//
// HTML defines no `value` attribute for <select>: a browser's initial
// selection comes from `selected` on an <option>. The compiler (and the
// runtime spread path) emit the bound value as a `value` attribute in the
// markup; this flush-time pass resolves it into `selected` on the matching
// option(s) and strips the attribute — React SSR parity — so no-JS clients
// and crawlers see the right selection. Hydration still assigns the `value`
// property, so JS clients were already correct.
//
// String-scan safety: this only ever runs on our own serializer output.
// `escape(s, true)` guarantees `"` cannot appear inside an attribute value,
// so a quote-aware tag walk (skip "…" runs, then `>` really ends the tag)
// is exact — `<` / `>` ARE legal inside attribute values and a naive
// indexOf would mis-scan on them. Text content has `<` escaped, so between
// tags only comments (hydration markers) start with `<`. One deliberate
// blind spot: `multiple` as a word inside a quoted attribute value reads as
// the multiple attribute, which only matters when the bound value contains
// a comma. A select split across flush chunks (a Loading boundary inside
// it) is left untouched: its options stream later as a fragment template
// and hydration assigns the property.

// Decodes the entities our own escape() produces (attr and content forms).
function decodeSSREntities(s) {
  return s.indexOf("&") < 0
    ? s
    : s
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&");
}

// Matches the quoted form (`value="…"`) AND the bare form (`value` followed
// by a space, `>`, or end-of-attrs): empty attribute values serialize as
// bare attributes (see ssrSpread / compiled templates), and an empty-string
// bound value is a real bound value — a `value=""` option must match it
// (#3013 follow-up). Group 1 is undefined for the bare form → empty string.
const SELECT_VALUE_ATTR = /\svalue(?:="([^"]*)")?(?=[\s>]|$)/;

// True end (`>`) of the tag opening at `i`, skipping quoted attribute
// values. -1 when the tag never closes in this string.
function tagEnd(html, i) {
  for (let j = i + 1; j < html.length; j++) {
    const c = html.charCodeAt(j);
    if (c === 34) {
      j = html.indexOf('"', j + 1);
      if (j < 0) return -1;
    } else if (c === 62) return j;
  }
  return -1;
}

// Text content of an option starting at `from`, collecting across comment
// nodes (hydration markers around dynamic text) until a real tag starts.
function optionText(html, from) {
  let t = "";
  let i = from;
  for (;;) {
    const lt = html.indexOf("<", i);
    if (lt < 0) return t + html.slice(i);
    t += html.slice(i, lt);
    if (!html.startsWith("<!--", lt)) return t;
    const ce = html.indexOf("-->", lt);
    if (ce < 0) return t;
    i = ce + 3;
  }
}

// Whether the tag at `i` is `<name` at a proper name boundary.
function tagIs(html, i, name) {
  if (!html.startsWith(name, i + 1)) return false;
  const c = html.charCodeAt(i + 1 + name.length);
  return c === 32 || c === 62 || c === 9 || c === 10 || c === 13;
}

// Compiler-armed gate (stage-4 SSR): compiled output containing a
// `<select value=…>` (or a spread on a select) emits `_$ssrSelectValues()`
// once per module. Apps that never bind a select value never even SCAN —
// profiling showed the gate's own indexOf costing >50% of a select-free
// page's render, because the first pass over the freshly-assembled rope
// pays its flattening. Raw HTML injected around the compiler (innerHTML
// escape hatches) intentionally gets browser semantics — the select-value
// forms contract is a JSX-level promise.
let selectValuesActive = false;
export function ssrSelectValues() {
  selectValuesActive = true;
}

export function resolveSSRSelectValues(html) {
  // Region-jumping walk: attribute values escape `<` (ESCAPE_ATTR), so
  // every "<select" hit below is a genuine tag position — jump candidate to
  // candidate and walk tags ONLY inside value-carrying select regions;
  // everything between regions is copied verbatim. (The old form walked
  // EVERY tag in the document once any <select> existed — O(document) per
  // render and per streamed fragment.)
  if (!selectValuesActive) return html;
  let cand = html.indexOf("<select");
  if (cand < 0) return html;
  let out = "";
  let idx = 0; // emitted through idx
  while (cand >= 0) {
    // Word boundary — skips <selectedcontent> hits.
    if (!tagIs(html, cand, "select")) {
      cand = html.indexOf("<select", cand + 7);
      continue;
    }
    const e0 = tagEnd(html, cand);
    if (e0 < 0) break;
    const open = html.slice(cand, e0 + 1);
    const m = SELECT_VALUE_ATTR.exec(open);
    if (!m) {
      // No bound value: nothing to resolve in this select.
      cand = html.indexOf("<select", e0 + 1);
      continue;
    }
    const bound = decodeSSREntities(m[1] ?? "");
    const sel = {
      values: /\smultiple(?=[\s>=])/.test(open) ? bound.split(",") : [bound],
      strip: cand + m.index,
      stripEnd: cand + m.index + m[0].length,
      body: e0 + 1,
      marks: [],
      defaulted: false
    };
    // Tag walk scoped to the region: options and comments until the close.
    let committed = false;
    let i = html.indexOf("<", e0 + 1);
    while (i >= 0) {
      let e;
      if (html.charCodeAt(i + 1) === 33) {
        // Comment (hydration marker) or bare <!> placeholder.
        e = html.charCodeAt(i + 2) === 45 ? html.indexOf("-->", i) : html.indexOf(">", i);
        if (e < 0) break;
        if (html.charCodeAt(i + 2) === 45) e += 2;
      } else {
        e = tagEnd(html, i);
        if (e < 0) break;
        // "</select>" exactly: <selectedcontent>'s close also starts "</select".
        if (html.startsWith("</select>", i)) {
          // Commit: drop the value attribute, then mark the matched options —
          // unless an option carried `selected` already (a defaultSelected):
          // per the forms contract the DEFAULT is the SSR state and the bound
          // value applies at hydration, exactly like defaultValue + value on
          // an <input>.
          out += html.slice(idx, sel.strip) + html.slice(sel.stripEnd, sel.body);
          let seg = sel.body;
          if (!sel.defaulted) {
            for (let k = 0; k < sel.marks.length; k++) {
              out += html.slice(seg, sel.marks[k]) + " selected";
              seg = sel.marks[k];
            }
          }
          out += html.slice(seg, i);
          idx = i;
          committed = true;
          break;
        } else if (tagIs(html, i, "option")) {
          const attrs = html.slice(i + 7, e);
          if (/\sselected(?=[\s=]|$)/.test(attrs)) sel.defaulted = true;
          else {
            const vm = SELECT_VALUE_ATTR.exec(attrs);
            // Spec: no value attribute → text content, whitespace collapsed.
            // A bare `value` attribute (vm[1] undefined) IS a value: "".
            const value = vm
              ? decodeSSREntities(vm[1] ?? "")
              : decodeSSREntities(optionText(html, e + 1))
                  .replace(/\s+/g, " ")
                  .trim();
            if (sel.values.includes(value)) sel.marks.push(e);
          }
        }
      }
      i = html.indexOf("<", e + 1);
    }
    // A select that never closes in this chunk (a Loading boundary inside
    // it) never commits and stays byte-identical — matching the old walk,
    // which also never processed anything past an uncommitted select.
    if (!committed) break;
    cand = html.indexOf("<select", idx);
  }
  if (idx === 0) return html;
  return out + html.slice(idx);
}
export function escape(s: any, attr?: boolean): any;

export function escape(s, attr) {
  const t = typeof s;
  if (t !== "string") {
    if (!attr && Array.isArray(s)) {
      const joined = tryJoinPlainSSRArray(s);
      if (joined !== undefined) return joined;
      s = s.slice(); // avoids double escaping - https://github.com/ryansolid/dom-expressions/issues/393
      for (let i = 0; i < s.length; i++) s[i] = escape(s[i]);
      return s;
    }
    if (attr) {
      // Nullish and boolean values pass through so callers can omit the
      // attribute or emit it as a boolean attribute. Numbers can never
      // contain `&` or `"`. Everything else (arrays, objects, symbols)
      // would be stringified by the surrounding template literal anyway,
      // so coerce to the final string here first — matching what the
      // client DOM receives — and run it through the normal string path.
      if (s == null || t === "boolean" || t === "number") return s;
      return escape(String(s), attr);
    }
    return s;
  }
  // Fast path: one native regex scan. Most values (color names, ids, prop
  // strings, plain text) contain none of `&`, `<` / `"`, so we bail without
  // allocating; V8's regex scan is ~30x faster than a JS char loop on long
  // text runs (the dominant SSR payload). Slow path resumes from the first
  // hit so the clean prefix is never re-scanned.
  const i = s.search(attr ? ESCAPE_ATTR : ESCAPE_CONTENT);
  if (i < 0) return s;
  return escapeSlow(s, attr, i);
}

const ESCAPE_CONTENT = /[&<]/;
// `<` escapes in attribute values too (stage-4 SSR): it costs nothing on
// the fast path (same single regex scan) and guarantees that a raw
// "<select" byte sequence in the document is ALWAYS a genuine tag start —
// the invariant resolveSSRSelectValues' region-jumping depends on. Also
// matches React/octane escaping norms.
const ESCAPE_ATTR = /[&"<]/;

// Slow path: at least one escapable char was found at position `start`.
// Kept separate so `escape()` stays small and inlinable in the hot path.
function escapeSlow(s, attr, start) {
  if (attr) return escapeAttrSlow(s, start);
  const c0 = s.charCodeAt(start);
  let iDelim = c0 === 60 ? start : s.indexOf("<", start);
  let iAmp = c0 === 38 ? start : s.indexOf("&", start);

  let left = 0,
    out = "";

  while (iDelim >= 0 && iAmp >= 0) {
    if (iDelim < iAmp) {
      if (left < iDelim) out += s.substring(left, iDelim);
      out += "&lt;";
      left = iDelim + 1;
      iDelim = s.indexOf("<", left);
    } else {
      if (left < iAmp) out += s.substring(left, iAmp);
      out += "&amp;";
      left = iAmp + 1;
      iAmp = s.indexOf("&", left);
    }
  }

  if (iDelim >= 0) {
    do {
      if (left < iDelim) out += s.substring(left, iDelim);
      out += "&lt;";
      left = iDelim + 1;
      iDelim = s.indexOf("<", left);
    } while (iDelim >= 0);
  } else
    while (iAmp >= 0) {
      if (left < iAmp) out += s.substring(left, iAmp);
      out += "&amp;";
      left = iAmp + 1;
      iAmp = s.indexOf("&", left);
    }

  return left < s.length ? out + s.substring(left) : out;
}

// Attr slow path: three cached pointers (`"` `&` `<`), same
// advance-only-the-consumed-pointer structure as the content path.
function escapeAttrSlow(s, start) {
  const c0 = s.charCodeAt(start);
  let iQuot = c0 === 34 ? start : s.indexOf('"', start);
  let iAmp = c0 === 38 ? start : s.indexOf("&", start);
  let iLt = c0 === 60 ? start : s.indexOf("<", start);

  let left = 0,
    out = "";

  for (;;) {
    // Next hit = smallest non-negative pointer.
    let i = -1,
      ent;
    if (iQuot >= 0) {
      i = iQuot;
      ent = "&quot;";
    }
    if (iAmp >= 0 && (i < 0 || iAmp < i)) {
      i = iAmp;
      ent = "&amp;";
    }
    if (iLt >= 0 && (i < 0 || iLt < i)) {
      i = iLt;
      ent = "&lt;";
    }
    if (i < 0) break;
    if (left < i) out += s.substring(left, i);
    out += ent;
    left = i + 1;
    if (i === iQuot) iQuot = s.indexOf('"', left);
    else if (i === iAmp) iAmp = s.indexOf("&", left);
    else iLt = s.indexOf("<", left);
  }

  return left < s.length ? out + s.substring(left) : out;
}

function tryJoinPlainSSRArray(nodes) {
  if (nodes.length === 0) return undefined;
  let out = "";
  for (let i = 0, len = nodes.length; i < len; i++) {
    const node = nodes[i];
    if (node == null || typeof node !== "object" || node.h || typeof node.t !== "string") {
      return undefined;
    }
    out += node.t;
  }
  return out;
}
export function getHydrationKey(): string | undefined;

export function getHydrationKey() {
  const hydrate = sharedConfig.context;
  return hydrate && sharedConfig.getNextContextId();
}
export function applyRef(
  r: ((element: any) => void) | ((element: any) => void)[],
  element: any
): void;

export function applyRef(r, element) {
  Array.isArray(r) ? r.flat(Infinity).forEach(f => f && f(element)) : r(element);
}
export function generateHydrationScript(options?: {
  nonce?: string;
  eventNames?: string[];
}): string;

export function generateHydrationScript({ eventNames = ["click", "input"], nonce } = {}) {
  return `<script${
    nonce ? ` nonce="${escape(String(nonce), true)}"` : ""
  }>window._$HY||(e=>{let t=e=>e&&e.hasAttribute&&(e.hasAttribute("_hk")?e:t(e.host&&e.host.nodeType?e.host:e.parentNode));["${eventNames.join(
    '","'
  )}"].forEach((o=>document.addEventListener(o,(o=>{if(!e.events)return;let s=t(o.composedPath&&o.composedPath()[0]||o.target);s&&!e.completed.has(s)&&e.events.push([s,o])}))))})(_$HY={events:[],completed:new WeakSet,r:{},fe(){}});</script><!--xs-->`;
}

function queue(fn) {
  return Promise.resolve().then(fn);
}

// Macrotask defer for chunk coalescing: must ride AFTER an arbitrary-depth
// microtask chain (a boundary's template/data/reveal writes span several
// chained thens), which no microtask count can guarantee. setImmediate on
// Node; timer fallback for hosts without it (workerd, browsers).
const deferFlush = typeof setImmediate === "function" ? setImmediate : fn => setTimeout(fn, 0);

function allSettled(promises) {
  let size = promises.size;
  return Promise.allSettled(promises).then(() => {
    if (promises.size !== size) return allSettled(promises);
    return;
  });
}

// Single-pass document assembly. This replaced four sequential inject passes
// (assets, preload links, inline styles, scripts), each of which searched for
// its anchor and rebuilt the whole document — four full copies of the shell,
// or of a 400KB SSR body. Head content is concatenated once and spliced with
// the script tag in one construction. Order is preserved exactly: preload
// links, inline styles before `</head>`; accumulated tasks at the
// `<!--xs-->` marker, appended when the marker is absent. Inline-style entries
// are only marked emitted when something renders them — a `</head>` splice or
// an `onHead` delivery.
//
// Scans stay strictly demand-driven, which the old passes got for free from
// their early returns and a single pass has to reproduce deliberately: a
// missing-needle indexOf flattens the string and walks every character, so on a
// 400KB body one stray scan costs more than the render's own string work
// (measured ~0.75ms). An anchor is only searched for when there is content that
// needs it, keeping a body-only render a pure pass-through.
//
// `onHead` is the embedded-render contract (host owns the document): when the
// output contains no `</head>`, everything head-bound is delivered to the
// callback as one string — prelude first — instead of being dropped, and the
// output passes through with only the script splice. When the output does
// contain `</head>`, splicing is automatic and `onHead` is not called: one
// mode or the other, decided by the render output itself.
function assembleDocument(
  html,
  emittedAssets,
  preloadLinks,
  inlineStyles,
  scripts,
  nonce,
  headTags,
  onHead
) {
  const scriptTag = scripts ? `<script${nonceAttr(nonce, "script")}>${scripts}</script>` : "";
  const title = headTags ? headTags.title : null;
  let headTagsHtml = headTags ? headTags.html : "";
  const headPrelude = headTags ? headTags.prelude : "";
  if (
    !onHead &&
    title == null &&
    !headTagsHtml &&
    !headPrelude &&
    !(emittedAssets && emittedAssets.size) &&
    !preloadLinks &&
    !(inlineStyles && inlineStyles.size)
  ) {
    // Nothing head-bound: never look for `</head>`. Body-only renders (no
    // assets, no preloads, no inline styles) stay a pure pass-through.
    // (An `onHead` caller opted into the scan — it must learn which mode
    // this render is in even when there is nothing to deliver.)
    if (!scriptTag) return html;
    const xs = html.indexOf("<!--xs-->");
    return xs === -1 ? html + scriptTag : html.slice(0, xs) + scriptTag + html.slice(xs);
  }
  // The prelude (charset/base) splices right after the `<head>` open tag —
  // before any content the existing `</head>` splice could produce — so it is
  // applied first, shifting `</head>` but nothing this function has indexed.
  if (headPrelude) {
    const open = html.match(/<head(?:\s[^>]*)?>/);
    if (open) {
      const at = open.index + open[0].length;
      html = html.slice(0, at) + headPrelude + html.slice(at);
    }
  }
  let headIdx = html.indexOf("</head>");
  if (headIdx === -1) {
    if (onHead) {
      // Embedded mode: hand the host everything it would have received via
      // the `</head>` splice, prelude first (its placement constraints are
      // the host template's responsibility from here). The title winner can't
      // be byte-rewritten — the host's markup is not visible here — so it
      // ships as a retitle script (in-place rewrite of the host's static
      // <title>, stashing its text on `data-dhf` for the client registry's
      // restore), or as a literal tag for `noScripts` renders, where a host
      // static title would still shadow it (first tag wins) — the host owns
      // that dedup.
      let titleHtml = "";
      if (title != null) {
        titleHtml = headTags.noScripts
          ? `<title data-dh="title">${escape(title)}</title>`
          : `<script${nonceAttr(nonce, "script")}>(function(x,t){(t=document.querySelector("title"))?(t.hasAttribute("data-dh")||t.setAttribute("data-dhf",t.textContent),t.textContent=x):(document.title=x,t=document.querySelector("title"));t&&t.setAttribute("data-dh","title")})(${JSON.stringify(
              title
            ).replace(/</g, "\\u003C")})</script>`;
      }
      onHead(
        headPrelude +
          headTagsHtml +
          titleHtml +
          renderHeadAssets(emittedAssets, preloadLinks, inlineStyles, nonce)
      );
    }
    // No head to splice into: without `onHead`, assets/preloads/styles are
    // dropped and left unemitted, exactly as the individual helpers'
    // `index === -1` returns did.
    if (!scriptTag) return html;
    const xs = html.indexOf("<!--xs-->");
    return xs === -1 ? html + scriptTag : html.slice(0, xs) + scriptTag + html.slice(xs);
  }
  // Document mode: the title winner is applied to the BYTES. The shell may
  // carry its own static <title> (the RFC's fallback, restored when every
  // title registration disposes) — and since the browser honors the first
  // title tag, emitting a second one would let the fallback shadow the
  // route's winner in the served page. Rewrite the static tag in place:
  // winner text in the element, original text stashed on `data-dhf` for the
  // client registry's restore, `data-dh` marking registry ownership. With no
  // static title, a marked tag joins the `</head>` splice. Bytes, not a
  // script, so view-source, crawlers, and `noScripts` renders all see the
  // real title.
  if (title != null) {
    const winner = escape(title);
    const open = html.match(/<head(?:\s[^>]*)?>/);
    const from = open ? open.index + open[0].length : 0;
    const m = /<title(\s[^>]*)?>([\s\S]*?)<\/title>/.exec(html.slice(from, headIdx));
    if (m) {
      const at = from + m.index;
      // The stash is the raw inner bytes (already element-escaped by the
      // author); only quotes need attribute escaping on top.
      const stash = m[2].replace(/"/g, "&quot;");
      html =
        html.slice(0, at) +
        `<title${m[1] || ""} data-dh="title" data-dhf="${stash}">${winner}</title>` +
        html.slice(at + m[0].length);
      headIdx = html.indexOf("</head>");
    } else {
      headTagsHtml = `<title data-dh="title">${winner}</title>` + headTagsHtml;
    }
  }
  const head = headTagsHtml + renderHeadAssets(emittedAssets, preloadLinks, inlineStyles, nonce);
  if (!scriptTag) return html.slice(0, headIdx) + head + html.slice(headIdx);
  const xsIdx = html.indexOf("<!--xs-->");
  if (xsIdx === -1) return html.slice(0, headIdx) + head + html.slice(headIdx) + scriptTag;
  return xsIdx < headIdx
    ? html.slice(0, xsIdx) + scriptTag + html.slice(xsIdx, headIdx) + head + html.slice(headIdx)
    : html.slice(0, headIdx) + head + html.slice(headIdx, xsIdx) + scriptTag + html.slice(xsIdx);
}

// Tracked asset links (stylesheet/modulepreload by URL) and unconsumed inline
// styles, rendered for a head splice or an `onHead` delivery. Inline-style
// entries are consumed (marked emitted) by whichever path renders them first.
function renderHeadAssets(emittedAssets, preloadLinks, inlineStyles, nonce) {
  let head = "";
  const styleAttr = nonceAttr(nonce, "style");
  const scriptAttr = nonceAttr(nonce, "script");
  if (emittedAssets && emittedAssets.size) {
    for (const url of emittedAssets) {
      head += isCssUrl(url)
        ? `<link rel="stylesheet" href="${url}"${styleAttr}>`
        : `<link rel="modulepreload" href="${url}"${scriptAttr}>`;
    }
  }
  if (preloadLinks) {
    for (const entry of preloadLinks) head += `<link${entry.attrHtml}>`;
  }
  if (inlineStyles && inlineStyles.size) {
    for (const entry of inlineStyles.values()) {
      if (entry.emitted) continue;
      entry.emitted = true;
      head += renderInlineStyle(entry, nonce);
    }
  }
  return head;
}

// `name` diverges from `key` only for the root map: root modules are FILED
// under the "" boundary sentinel, but the bare "_assets" registry name is a
// page-global — island integrations run one renderToString per island into
// the same document, and each render's root write would clobber the previous
// island's map before any client code reads it. The render's id namespaces
// the name (`<renderId>_assets`), pairing each root map with the hydrate()
// call that owns it; whole-document renders (renderId "") keep the bare name.
// Boundary maps need no scoping: their keys are hydration ids, which already
// carry the renderId prefix.
// The map is serialized as a SNAPSHOT (`{ ...map }`), never as the live
// object. A boundary's module map keeps mutating after its first
// serialization — a nested lazy under a lazy layout registers during the
// template-hole drain loop, after the boundary already flushed — and seroval
// dedupes repeated references across stream writes: handing it the same
// (mutated) object again emits a bare back-reference to the stale first
// snapshot, silently dropping the new entries. The client then never learns
// the nested chunk's hydration-id mapping and lazy hydration halts.
function serializeFragmentAssets(key, boundaryModules, context, name = key) {
  const map = boundaryModules.get(key);
  if (!map || !Object.keys(map).length) return;
  context.serialize(name + "_assets", { ...map });
}

function propagateBoundaryStyles(childKey, parentKey, tracking) {
  const childStyles = tracking.getBoundaryStyles(childKey);
  if (!childStyles) return;
  let parentStyles = tracking.boundaryStyles.get(parentKey);
  if (!parentStyles) {
    parentStyles = new Set();
    tracking.boundaryStyles.set(parentKey, parentStyles);
  }
  for (const url of childStyles) {
    parentStyles.add(url);
  }
}

// Boundary style sets hold three kinds of entries: url strings (tracked
// stylesheet links, load-gated via $dfs), gate entries (`{ href, attrHtml,
// attrs }` — useHead stylesheets carrying fetch-metadata attributes, gated
// the same way with attributes intact), and inline style entry objects
// (emitted as <style> tags, ready as soon as parsed). Splits them for the
// fragment flush, consuming object entries so they emit at most once.
function collectStreamStyles(key, tracking, headStyles) {
  const styles = tracking.getBoundaryStyles(key);
  const links = [];
  const inline = [];
  if (!styles) return { links, inline };
  for (const entry of styles) {
    if (typeof entry === "string") {
      if (!headStyles || !headStyles.has(entry)) links.push(entry);
    } else if (entry.emitted) {
      continue;
    } else if (entry.attrHtml !== undefined) {
      entry.emitted = true;
      links.push(entry);
    } else {
      entry.emitted = true;
      inline.push(entry);
    }
  }
  return { links, inline };
}

// `</style` inside content would close the tag early; escaping the slash is
// valid CSS and neutralizes the sequence.
function escapeStyleContent(content) {
  return content.replace(/<\/(style)/gi, "<\\/$1");
}

function renderInlineStyle(entry, nonce) {
  let attrs = "";
  let hasNonce = false;
  if (entry.attrs) {
    for (const name in entry.attrs) {
      if (name.length === 5 && asciiLowerCase(name) === "nonce") hasNonce = true;
      attrs += ` ${name}="${escape(String(entry.attrs[name]), true)}"`;
    }
  }
  const nonceHtml = hasNonce ? "" : nonceAttr(nonce, "style");
  return `<style${nonceHtml} data-asset="${escape(entry.id, true)}"${attrs}>${escapeStyleContent(
    entry.content
  )}</style>`;
}

function waitForFragments(registry, key) {
  for (const k of [...registry.keys()].reverse()) {
    if (key.startsWith(k)) return k;
  }
  return false;
}

function replacePlaceholder(html, key, value) {
  const marker = `<template id="pl-${key}">`;
  const close = `<!--pl-${key}-->`;

  const first = html.indexOf(marker);
  if (first === -1) return html;
  const last = html.indexOf(close, first + marker.length);

  return html.slice(0, first) + value + html.slice(last + close.length);
}

function classListToObject(classList) {
  if (Array.isArray(classList)) {
    const result = {};
    flattenClassList(classList, result);
    return result;
  }
  return classList;
}

function flattenClassList(list, result) {
  for (let i = 0, len = list.length; i < len; i++) {
    const item = list[i];
    if (Array.isArray(item)) flattenClassList(item, result);
    else if (typeof item === "object" && item != null) Object.assign(result, item);
    else if (item || item === 0) result[item] = true;
  }
}

// Best-effort sync resolution. Returns a string when the entire `node`
// resolves synchronously to text. Otherwise returns one of three shapes
// shared with `ssrFirstGroupHit`:
//   `{ fn, p }` — function hole that threw `NotReadyError`; `fn` is
//                 wrapped in `runWithOwner(owner, ...)` so the streaming
//                 engine's retry sees the same context the original sync
//                 call did.
//   `{ merge }` — template object with non-empty `h`.
//   `{ bail }`  — interior contains async; `bail` carries the evaluated
//                 form (typically the array we walked) so the caller can
//                 hand it to `resolveSSRNode` without re-invoking the
//                 original closure. Re-invocation is unsafe — a hole may
//                 read stateful getters such as JSX `props.children`
//                 whose backing component rebuilds an owner subtree on
//                 each access, producing a divergent hydration tree.
function tryResolveString(node) {
  const t = typeof node;
  if (t === "string") return node;
  if (t === "number") return "" + node;
  if (node == null || t === "boolean") return "";
  if (t === "object") {
    if (Array.isArray(node)) {
      const joined = tryJoinPlainSSRArray(node);
      if (joined !== undefined) return joined;
      let s = "";
      let prevNonObj = false;
      for (let i = 0, len = node.length; i < len; i++) {
        const item = node[i];
        const itemNonObj = item !== null && typeof item !== "object";
        if (prevNonObj && itemNonObj) s += "<!--!$-->";
        prevNonObj = itemNonObj;
        const r = tryResolveString(item);
        if (typeof r !== "string") return { bail: node };
        s += r;
      }
      return s;
    }
    if (node.h && node.h.length > 0) return { merge: node };
    if (node.t === undefined) {
      // Not a template object — mirror the client's dev warn-and-skip
      // instead of crashing downstream on a malformed template shape.
      if ("_SOLID_DEV_") console.warn(`Unrecognized value. Skipped inserting`, node);
      return "";
    }
    return Array.isArray(node.t) ? node.t[0] : node.t;
  }
  if (t === "function") {
    let v;
    try {
      v = node();
    } catch (err) {
      return buildAsyncWrap(err, node) || "";
    }
    // Recurse on the evaluated value. If recursion bails, propagate the
    // bail object unchanged — its `bail` field already carries the
    // deepest evaluated form, so the caller never re-invokes `node`.
    return tryResolveString(v);
  }
  return "";
}
export function resolveSSRNode(node: any, result?: any, top?: boolean): any;

export function resolveSSRNode(
  node,
  result = {
    t: [""],
    h: [],
    p: []
  },
  top
) {
  const t = typeof node;
  if (t === "string" || t === "number") {
    result.t[result.t.length - 1] += node;
  } else if (node == null || t === "boolean") {
  } else if (Array.isArray(node)) {
    // A `$slot`-tagged array is a slot RANGE reaching the walker as a plain
    // child (the document face — fills nest under component wrappers rather
    // than arriving as a hole's value): its interior is client-owned DOM
    // the adopting frame claims, so it resolves mint-suppressed exactly
    // like the hole-valued slot shapes above — no markers, no bindings.
    const slotLive = node.$slot && sharedConfig.context && sharedConfig.context.liveHoles;
    if (slotLive) slotLive.suppressed++;
    try {
      let prevNonObj = false;
      for (let i = 0, len = node.length; i < len; i++) {
        const item = node[i];
        const itemNonObj = item !== null && typeof item !== "object";
        if (!top && prevNonObj && itemNonObj) result.t[result.t.length - 1] += `<!--!$-->`;
        prevNonObj = itemNonObj;
        resolveSSRNode(item, result);
      }
    } finally {
      if (slotLive) slotLive.suppressed--;
    }
  } else if (t === "object") {
    if (node.h) {
      result.t[result.t.length - 1] += node.t[0];
      if (node.t.length > 1) {
        result.t.push(...node.t.slice(1));
        result.h.push(...node.h);
        result.p.push(...node.p);
      }
    } else if (node.t !== undefined) {
      result.t[result.t.length - 1] += node.t;
    } else if ("_SOLID_DEV_") console.warn(`Unrecognized value. Skipped inserting`, node);
  } else if (t === "function") {
    // Function nodes reaching the tree resolver are content by construction
    // (in-tag holes route here only under `ssr()`'s suppression window), so
    // a live render routes them through the engine. The engine owns all
    // suppression decisions — retry-chain tags (`$lhSuppress`, resolved
    // mint-free with baseline capture), machinery opt-outs (`$lhSkip`), and
    // open windows all defer here via a null return.
    const live = sharedConfig.context && sharedConfig.context.liveHoles;
    let liveNode = null;
    if (live && (liveNode = live.content(node)) !== null) {
      if (typeof liveNode === "string") result.t[result.t.length - 1] += liveNode;
      else resolveSSRNode(liveNode, result);
    } else {
      try {
        resolveSSRNode(node(), result);
      } catch (err) {
        const wrap = buildAsyncWrap(err, node);
        if (wrap) {
          result.h.push(wrap.fn);
          result.p.push(wrap.p);
          result.t.push("");
        }
      }
    }
  }
  return result;
}

function resolveSSRSync(node) {
  const res = resolveSSRNode(node);
  if (!res.h.length) return res.t[0];
  throw new Error("This value cannot be rendered synchronously. Are you missing a boundary?");
}

// experimental
// Registered symbol: the AsyncLocalStorage parked on globalThis must be
// found by every copy of this module (core entry and server-functions entry
// bundle separately downstream).
export const RequestContext: unique symbol = Symbol.for("solid.RequestContext") as any; /**
 * The current request event, when called on the server inside a request
 * scope (established by `provideRequestEvent` from `@solidjs/web/storage`
 * or by the framework). Undefined on the client and outside a request.
 * Read it above `await` boundaries in partially-polyfilled environments.
 */
export function getRequestEvent(): RequestEvent | undefined;

export function getRequestEvent() {
  return (globalThis as any)[RequestContext]
    ? (globalThis as any)[RequestContext].getStore() ||
        (sharedConfig.context && sharedConfig.context.event) ||
        console.warn(
          "RequestEvent is missing. This is most likely due to accessing `getRequestEvent` non-managed async scope in a partially polyfilled environment. Try moving it above all `await` calls."
        )
    : undefined;
} /** A fresh, uncommitted response head. */
export function createResponseStub(): ResponseStub;

// --- HTTP response-head lifecycle ---------------------------------------
//
// The protocol half of serving an SSR render over HTTP: a mutable response
// head (`ResponseStub`) that render-time primitives write to (status,
// headers, redirect Location), and the lifecycle that derives the outgoing
// `Response` head from it at the moment it freezes on the wire. Handlers —
// a framework's, a plugin's generated one, a hand-written entry — compose
// these with `provideRequestEvent`; nothing here assumes a platform beyond
// web-standard Request/Response.

/** A fresh, uncommitted response head. */
export function createResponseStub() {
  return { status: undefined, statusText: undefined, headers: new Headers(), committed: false };
} /**
 * The canonical request event for HTTP handlers: the incoming `Request`, a
 * `locals` bag, and a `response` head stub the render writes to. `init`
 * spreads over the defaults so frameworks can extend the shape.
 */
export function createRequestEvent<T extends object = {}>(
  request: Request,
  init?: T
): RequestEvent & { response: ResponseStub } & T;

/**
 * The canonical request event for HTTP handlers: the incoming `Request`, a
 * `locals` bag, and a `response` head stub the render writes to (the
 * primitives `httpStatus`/`httpHeader`, integrations' redirects). `init`
 * spreads over the defaults, so a framework can extend the shape (or
 * substitute its own structurally-compatible `response`) while every event
 * still looks the same to code reading it.
 */
export function createRequestEvent(request, init) {
  return { request, locals: {}, response: createResponseStub(), ...init };
}

// --- Committed-stub write loudness ---
//
// Once the response head is on the wire, a header write on the stub can no
// longer reach the client — and that must never be silent. The enforcement
// lives on the stub itself so it covers EVERY writer uniformly (direct
// `event.response.headers` mutation included, not just code polite enough
// to check `committed` first): the moment a stub commits, its `headers`'
// mutating methods fail loudly — throw in the dev build, report through
// console.error and no-op otherwise (a late write must not crash a
// production request that is already on the wire).

function reportLostHeaderWrite(method, name) {
  const message =
    `Response header write dropped: headers.${method}(${JSON.stringify(String(name))}) ` +
    "ran after the response head was sent. Write headers before the shell flushes " +
    "(or before the handler returns).";
  if ("_SOLID_DEV_") throw new Error(message);
  console.error(message);
} /**
 * Flips a response stub to `committed` — the moment its head freezes on
 * the wire — and instruments the stub's `headers` mutating methods
 * (`set`/`append`/`delete`, patched in place; the `Headers` identity and
 * reads are untouched) so a post-commit write fails loudly instead of
 * silently missing the wire: it throws in the dev build and reports +
 * no-ops otherwise. Every head materialization path commits through here
 * (`createSSRResponse`, the server-function handler's commit seam);
 * integrations deriving their own heads should too.
 *
 * `allowLateLocation` is the stream path's documented exception: a
 * `Location` set after the shell flushed is still honored client-side
 * (stream completion appends a `window.location` script), so that one
 * write stays permitted there.
 */
export function commitResponseStub(
  stub: ResponseStub,
  options?: { allowLateLocation?: boolean }
): ResponseStub;

/**
 * Flips a response stub to `committed` — the moment its head freezes on
 * the wire — and instruments the stub's `headers` mutating methods
 * (`set`/`append`/`delete`, patched in place: the `Headers` instance keeps
 * its identity, reads are untouched) so a post-commit write fails loudly
 * instead of silently missing the wire: it throws in the dev build and
 * reports + no-ops otherwise. Every head materialization path commits
 * through here — `createSSRResponse` (string results and the stream's
 * shell flush) and the server-function handler's commit seam — so the
 * guarantee holds for every writer, not just core's own primitives.
 *
 * `allowLateLocation` is the stream path's documented exception: a
 * `Location` set after the shell flushed cannot ride the head but IS still
 * honored — stream completion appends a `window.location` script — so
 * that one write stays permitted there.
 */
export function commitResponseStub(stub, { allowLateLocation = false } = {}) {
  if (!stub || stub.committed) return stub;
  stub.committed = true;
  const headers = stub.headers;
  if (!headers || typeof headers.set !== "function") return stub;
  for (const method of ["set", "append", "delete"]) {
    const original = headers[method].bind(headers);
    headers[method] = function (name, ...rest) {
      if (allowLateLocation && method === "set" && String(name).toLowerCase() === "location") {
        return original(name, ...rest);
      }
      reportLostHeaderWrite(method, name);
    };
  }
  return stub;
}

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#redirection_messages
const validRedirectStatuses = /*#__PURE__*/ new Set([301, 302, 303, 307, 308]); /**
 * The status an outgoing redirect should use for a response head carrying
 * a `Location`: the stub's own status when it is a redirect status, 302
 * otherwise.
 */
export function getExpectedRedirectStatus(response: ResponseStub): number;

/**
 * The status an outgoing redirect should use for a response head carrying a
 * `Location`: the stub's own status when it is a redirect status, 302
 * otherwise (the stub's status was set for the page render, not the
 * redirect that preempts it).
 */
export function getExpectedRedirectStatus(response) {
  if (response.status && validRedirectStatuses.has(response.status)) return response.status;
  return 302;
}

// Merge the stub's headers over a base Headers. Set-Cookie is the one
// header where multiple values must survive as separate entries, so it is
// appended cookie-by-cookie rather than set.
function mergeStubHeaders(target, stub) {
  if (!stub) return target;
  stub.headers.forEach((value, key) => {
    if (key !== "set-cookie") target.set(key, value);
  });
  const setCookies = stub.headers.getSetCookie ? stub.headers.getSetCookie() : [];
  for (const cookie of setCookies) target.append("set-cookie", cookie);
  return target;
}

// Copy a base-headers init preserving multiple `Set-Cookie` values:
// Headers-to-Headers copying through the constructor folds them into one
// comma-joined entry on some runtimes (a folded Set-Cookie is corrupt).
// Plain-object inits cannot carry duplicates and pass through as-is.
function copyInitHeaders(init) {
  if (!init || !init.getSetCookie) return new Headers(init);
  const headers = new Headers();
  init.forEach((value, key) => {
    if (key !== "set-cookie") headers.append(key, value);
  });
  for (const cookie of init.getSetCookie()) headers.append("Set-Cookie", cookie);
  return headers;
}

// Stub gap-fill exclusions: the wire-protocol family the handlers themselves
// own must reflect THIS response's encoding, never a write parked on the
// stub — a stray stub `Location` would turn a success body into a redirect
// signal, a stale error/format/single-flight tag would misdescribe the
// body to the client transport, and `X-Revalidate` keys belong to the
// outcome that declared them. Header names via the shared wire constants;
// lowercased once because `Headers` iteration keys are lowercase.
const STUB_GAP_FILL_EXCLUDED = /*#__PURE__*/ new Set(
  [
    ERROR_HEADER,
    BODY_FORMAT_HEADER,
    SINGLE_FLIGHT_HEADER,
    REVALIDATE_HEADER,
    REDIRECT_HEADER,
    "Location"
  ].map(header => header.toLowerCase())
);

// Whether a stub header may gap-fill onto the outgoing response: not a
// cookie (those append), not protocol-owned, not body metadata on a
// bodiless response (the no-JS handler deliberately strips Content-Type/
// Length from the redirects it builds — don't re-advertise a body that
// isn't there), and not already answered by the response itself.
function fillsStubGap(key, headers, response) {
  if (key === "set-cookie" || STUB_GAP_FILL_EXCLUDED.has(key)) return false;
  if (response.body === null && (key === "content-type" || key === "content-length")) return false;
  return !headers.has(key);
} /**
 * Handler-lifecycle plumbing — a response's exit through the request
 * event's response-stub lifecycle: page results leave through
 * `createSSRResponse`, any other `Response` (a middleware early return, an
 * API result) leaves through `commitEventResponse`; application middleware
 * never calls this. Folds the event's stub onto the outgoing response —
 * `Set-Cookie` appends entry-by-entry alongside the response's own, other
 * stub headers fill gaps only (never the wire-protocol family the handlers
 * own, never `Content-Type`/`Content-Length` on a bodiless response), the
 * status is never taken from the stub — then commits the stub
 * (`commitResponseStub`: post-commit writes fail loudly). Responses with
 * immutable headers are rebuilt around merged copies.
 *
 * Idempotent at handler edges: an already-committed stub passes the
 * response through untouched, so a handler may apply this unconditionally
 * after its middleware chain unwinds — page responses from
 * `createSSRResponse` come back committed and do not double-fold.
 *
 * `event` defaults to the ambient `getRequestEvent()`.
 */
export function commitEventResponse(response: Response, event?: RequestEvent): Response;

/**
 * Handler-lifecycle plumbing — the exit for a `Response` that did NOT go
 * through `createSSRResponse` (a middleware early return, an API result,
 * the server-function handler's own responses): folds the request event's
 * response stub onto the outgoing response as its head freezes, and
 * commits the stub — later writes can no longer reach the client, so they
 * fail loudly (`commitResponseStub` instruments the stub's headers: dev
 * throws, prod reports + no-ops). Cookies append entry-by-entry alongside
 * the response's own; other stub headers only fill gaps (the response's
 * metadata wins, the protocol-owned family never fills — see
 * `fillsStubGap`); the status is never taken from the stub. Responses with
 * immutable headers (`Response.redirect`, integration-provided) are
 * rebuilt around merged copies.
 *
 * An already-committed stub passes the response through untouched, so
 * applying this unconditionally at the handler edge is safe: page results
 * come back from `createSSRResponse` committed (their stub already folded
 * into the head) and must not double-fold. `event` defaults to the ambient
 * `getRequestEvent()`. Application middleware never calls this — the
 * handler edge does, once, after the middleware chain fully unwinds.
 */
export function commitEventResponse(response, event = getRequestEvent()) {
  const stub = event && event.response;
  if (!stub || !stub.headers || stub.committed) return response;
  const cookies = stub.headers.getSetCookie ? stub.headers.getSetCookie() : [];
  commitResponseStub(stub);
  let hasGaps = false;
  stub.headers.forEach((value, key) => {
    if (fillsStubGap(key, response.headers, response)) hasGaps = true;
  });
  if (!cookies.length && !hasGaps) return response;
  // Always fold onto a rebuilt Response, never in place: the response is the
  // application's object, and an app may return the same one again — a
  // module-level redirect singleton, a memoized per-tenant Response. Folding
  // in place accumulates every request's cookies onto that shared object, so
  // one user's Set-Cookie is served to the next (#3155). Rebuilding also
  // absorbs immutable-headers responses (Response.redirect) for free; the
  // cost lands only on responses that were going to be modified anyway.
  const headers = copyInitHeaders(response.headers);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  stub.headers.forEach((value, key) => {
    if (fillsStubGap(key, headers, response)) headers.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function deriveHead(stub, responseInit = {}) {
  const headers = mergeStubHeaders(copyInitHeaders(responseInit.headers), stub);
  const status = (stub && stub.status) || responseInit.status || 200;
  const statusText = (stub && stub.statusText) || responseInit.statusText || undefined;
  return { status, statusText, headers };
} /**
 * Derives the outgoing `Response` for an SSR render result, running the
 * response-head lifecycle against `event.response`: commit at shell flush,
 * pre-flush `Location` becomes a real redirect, post-flush `Location`
 * appends a client-side script redirect before the stream closes.
 * Synchronous for string results; resolves at shell flush for stream
 * results.
 */
export function createSSRResponse(
  result: string,
  event: RequestEvent | undefined,
  options?: SSRResponseOptions
): Response;
export function createSSRResponse(
  result: { pipe(writable: { write: (v: string) => void; end: () => void }): void },
  event: RequestEvent | undefined,
  options?: SSRResponseOptions
): Promise<Response>;

/**
 * Derives the outgoing `Response` for an SSR render result, running the
 * response-head lifecycle against `event.response`:
 *
 * - String results (sync/async renders) commit the stub and return a
 *   `Response` synchronously; a `Location` on the stub becomes a real
 *   redirect (`getExpectedRedirectStatus`) instead of an HTML response.
 * - Stream results (`renderToStream(...)`) resolve at shell flush — the
 *   moment the head freezes: the stub is committed there (post-commit
 *   header writes fail loudly — see `commitResponseStub`), its
 *   status/headers merged over `options.responseInit`, and a pre-flush
 *   `Location` short-circuits to a redirect with no body (the render is
 *   abandoned). A `Location` set after the flush
 *   can only be honored client-side, so stream completion appends
 *   `<script>window.location=...</script>` (carrying `options.nonce` for
 *   strict `script-src` CSPs) before closing.
 *
 * `options.transformChunk(chunk)` rewrites each outgoing HTML chunk (entry
 * script injection, doctype prefixes, ...). The default `content-type` is
 * `text/html; charset=utf-8` unless the stub or `responseInit` named one.
 */
export function createSSRResponse(result, event, options = {}) {
  const stub = event && event.response;
  const { responseInit, transformChunk } = options;
  const nonce = normalizeNonce(options.nonce);

  if (typeof result === "string") {
    if (stub) commitResponseStub(stub);
    const head = deriveHead(stub, responseInit);
    if (stub && stub.headers.get("Location")) {
      return new Response(null, { status: getExpectedRedirectStatus(stub), headers: head.headers });
    }
    if (!head.headers.has("content-type")) {
      head.headers.set("content-type", "text/html; charset=utf-8");
    }
    return new Response(transformChunk ? transformChunk(result) : result, {
      status: head.status,
      statusText: head.statusText,
      headers: head.headers
    });
  }

  const encoder = new TextEncoder();
  return new Promise(resolve => {
    let controller;
    let closed = false;
    let flushed = false;
    // Enqueueing after the client disconnects throws; the render must
    // never crash the server over a consumer that went away.
    const enqueue = value => {
      if (closed || !controller) return;
      try {
        controller.enqueue(encoder.encode(value));
      } catch {
        closed = true;
      }
    };
    result.pipe({
      write(chunk) {
        if (!flushed) {
          flushed = true;
          // Late-Location stays writable: this path honors it client-side
          // through the completion script below.
          if (stub) commitResponseStub(stub, { allowLateLocation: true });
          const head = deriveHead(stub, responseInit);
          if (stub && stub.headers.get("Location")) {
            // Pre-flush redirect: the shell never reaches the wire.
            closed = true;
            resolve(
              new Response(null, { status: getExpectedRedirectStatus(stub), headers: head.headers })
            );
            return;
          }
          if (!head.headers.has("content-type")) {
            head.headers.set("content-type", "text/html; charset=utf-8");
          }
          resolve(
            new Response(
              new ReadableStream({
                start(c) {
                  controller = c;
                },
                cancel() {
                  closed = true;
                }
              }),
              { status: head.status, statusText: head.statusText, headers: head.headers }
            )
          );
        }
        enqueue(transformChunk ? transformChunk(chunk) : chunk);
      },
      end() {
        if (closed || !controller) return;
        // A Location that appears here was written after the head went out
        // (a pre-flush one short-circuited above) — client-side is the only
        // side that can still honor it.
        const location = stub && stub.headers.get("Location");
        if (location) {
          const attr = nonceAttr(nonce, "script");
          enqueue(
            `<script${attr}>window.location=${JSON.stringify(location).replace(
              /</g,
              "\\u003c"
            )}</script>`
          );
        }
        closed = true;
        try {
          controller.close();
        } catch {}
      }
    });
  });
} /**
 * Composes fetch-style middleware into one function of the same shape;
 * the terminal `next` dispatches to the actual handler. Runs in whatever
 * scope the caller established (`provideRequestEvent`), so
 * `getRequestEvent()` works exactly as in application code.
 */
export function composeMiddleware(
  middlewares: FetchMiddleware[]
): (
  request: Request,
  next: (request?: Request) => Response | Promise<Response>
) => Promise<Response>;

/**
 * Composes fetch-style middleware — `(request, next) => Response` — into a
 * single function of the same shape. `next()` advances the chain (an
 * optional `Request` argument substitutes the request downstream) and the
 * terminal `next` handed to the composed function dispatches to the actual
 * handler. Middleware runs inside whatever scope the caller established
 * (e.g. `provideRequestEvent`), so `getRequestEvent()` works exactly as it
 * does in application code; nothing reaches the wire until the outermost
 * middleware returns, so headers on the returned `Response` remain mutable
 * through the whole unwind — streamed bodies included.
 */
export function composeMiddleware(middlewares) {
  return function run(request, next) {
    let index = -1;
    function dispatch(i, req) {
      if (i <= index) return Promise.reject(new Error("next() called multiple times"));
      index = i;
      if (i === middlewares.length) return Promise.resolve(next(req));
      return Promise.resolve(middlewares[i](req, override => dispatch(i + 1, override || req)));
    }
    return dispatch(0, request);
  };
} /**
 * Server no-op: element claims are a client-only concern, but consumers may
 * register isomorphically. Returns a no-op unregister function.
 */
export function registerElementClaim(handler: (element: Element) => void): () => void;

// Element claims are a client-only concern (compiled DOM output claims
// navigation-relevant elements for consumers like a router's link-state
// layer), but consumers may register isomorphically — so these are silent
// no-ops rather than loud stubs. Claims never fire during SSR.
export function registerElementClaim() {
  return noopCleanup;
}
function noopCleanup() {} /** Server no-op: returns `node` unchanged. Claims never fire during SSR. */
export function claimElement<T extends Element>(node: T): T;

export function claimElement(node) {
  return node;
} /** Server no-op: returns `root` unchanged. Claims never fire during SSR. */
export function claimElementTree<T extends Node>(root: T): T;

export function claimElementTree(root) {
  return root;
}

// client-only APIs

export {
  notSup as style,
  notSup as insert,
  notSup as spread,
  notSup as delegateEvents,
  notSup as registerDelegatedRoot,
  notSup as unregisterDelegatedRoot,
  notSup as registerDelegatedContainer,
  notSup as unregisterDelegatedContainer,
  notSup as getDelegatedRoot,
  notSup as dynamicProperty,
  notSup as setAttribute,
  notSup as setAttributeNS,
  notSup as addEvent,
  notSup as render,
  notSup as template,
  notSup as setProperty,
  notSup as className,
  notSup as assign,
  notSup as hydrate,
  notSup as getNextElement,
  notSup as getNextMatch,
  notSup as getNextMarker,
  notSup as runHydrationEvents,
  notSup as ref,
  notSup as setStyleProperty,
  notSup as acquireAsset,
  // patchDriver executes only when a DOM template runs — same class as
  // `template` above (re-audit 9: dom-compiled modules must LINK under
  // Node; SSR renders through the ssr() pipeline instead).
  notSup as patchDriver
};

/** Server identity: rowProof wraps row functions at DEFINITION sites in
 * isomorphic modules — it must be callable, not just linkable. The stamp
 * is meaningless without the client list driver. */
export function rowProof<F>(fn: F): F;

export function rowProof(fn) {
  return fn;
}

function notSup() {
  throw new Error(
    "Client-only API called on the server side. Run client-only code in onMount, or conditionally run client-only component with <Show>."
  );
}
