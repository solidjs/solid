import { getOwner, getNextChildId, getContext } from "./signals.js";
import type { Context } from "./signals.js";

export type SSRTemplateObject =
  | { t: string[]; h: Function[]; p: Promise<any>[] }
  | { t: string; h?: undefined; p?: undefined };

/** Inline style content, e.g. dev CSS collected from a bundler's module graph. */
export type InlineStyleAsset = {
  id: string;
  content: string;
  attrs?: Record<string, string>;
};

export type ResolvedAssets = {
  js: string[];
  css: (string | InlineStyleAsset)[];
};

export type HydrationContext = {
  id: string;
  count: number;
  /**
   * Serialize a value for client hydration.
   * In renderToStream (async: true), accepts promises and async iterables.
   * In renderToString (async: false), only synchronous values are allowed —
   * passing async values will throw.
   */
  serialize: (id: string, v: any, deferStream?: boolean) => void;
  resolve(value: any): SSRTemplateObject;
  ssr(template: string[], ...values: any[]): SSRTemplateObject;
  escape(value: any): string;
  replace: (id: string, replacement: () => any) => void;
  block: (p: Promise<any>) => void;
  registerFragment: (
    v: string,
    options?: { revealGroup?: string }
  ) => (v?: string, err?: any) => boolean;
  revealFragments?: (groupOrKeys: string | string[]) => void;
  revealFallbacks?: (groupOrKeys: string | string[]) => void;
  /** Register a client-side asset discovered during SSR (e.g. from lazy()). */
  registerAsset?: {
    (type: "module" | "style", url: string): void;
    (type: "inline-style", style: InlineStyleAsset): void;
  };
  /** Register a moduleUrl-to-entryUrl mapping for the current boundary. */
  registerModule?: (moduleUrl: string, entryUrl: string) => void;
  /**
   * Resolve a module's JS and CSS assets from the asset manifest. Set by
   * dom-expressions. Resolver manifests (dev servers answering from a live
   * module graph) may return a promise and may resolve css entries to
   * inline-style descriptors instead of URLs.
   */
  resolveAssets?: (moduleUrl: string) => ResolvedAssets | null | Promise<ResolvedAssets | null>;
  /**
   * Synchronous resolution fast path. Set by dom-expressions for object
   * manifests (sync by nature) and for resolver manifests providing
   * `resolveSync`; used by sync consumers like lazy's moduleUrl getter.
   */
  resolveAssetsSync?: (moduleUrl: string) => ResolvedAssets | null | undefined;
  /** Retrieve the moduleUrl-to-entryUrl map for a boundary. */
  getBoundaryModules?: (id: string) => Record<string, string> | null;
  /** @internal Tracks which Loading boundary is currently rendering. Set by dom-expressions via applyAssetTracking(). */
  _currentBoundaryId?: string | null;
  /**
   * @internal Containment channel for errors surfacing in async resume loops
   * (boundary retries, flush passes), where nothing is on the stack to catch
   * a throw. Set by dom-expressions' renderToStream: reports through the
   * render's onError and winds the render down — the request fails, the
   * process survives.
   */
  failRender?: (err: any) => void;
  /**
   * @internal Per-request memo of `resolveAssets(moduleUrl)` results, keyed
   * by moduleUrl. lazy() consults it so a component re-created across
   * suspended render passes asks the manifest exactly once per module —
   * dev-server resolvers answer from the live module graph and can do real
   * work per call (SSR stack-overflow diagnosis amplifier).
   */
  _lazyAssets?: Map<string, ResolvedAssets | null | undefined | Promise<ResolvedAssets | null>>;
  /**
   * @internal True during a Loading discovery pass — the only render phase
   * with a retryable NotReady catch. Set/restored by
   * `runWithBoundaryErrorContext` when a boundaryId is passed; read by
   * dom-expressions' head registry to escalate pending head-tag props into a
   * boundary suspension instead of a flush-time warn-and-drop.
   */
  _loadingPhase?: boolean;
  /** True only in renderToStream — enables async data serialization and streaming. */
  async?: boolean;
  /**
   * Frame renders only (DR-2 case 1, set by the frame sink): signal that an
   * async value settled without a serialization flush the sink could see —
   * the binding ledger schedules an equality-gated sweep of watched slot
   * args. No-op semantics elsewhere; absent outside frame renders.
   */
  commit?: () => void;
  /**
   * Frame renders only (set alongside `commit`): the sink's commit epoch.
   * Sync-valued memos cache per epoch — cached within one sweep, recomputed
   * when pulled after a later commit — so watched-arg sweeps read current
   * derivations. Absent outside frame renders (memos then cache for the
   * render, the document-SSR contract).
   */
  commitEpoch?: () => number;
};

export const NoHydrateContext: Context<boolean> = {
  id: Symbol("NoHydrateContext"),
  defaultValue: false
};

type SharedConfig = {
  context?: HydrationContext;
  getNextContextId(): string | undefined;
};

export const sharedConfig: SharedConfig = {
  getNextContextId() {
    const o = getOwner();
    if (!o) throw new Error(`getNextContextId cannot be used under non-hydrating context`);
    if (getContext(NoHydrateContext)) return undefined;
    return getNextChildId(o);
  }
};
