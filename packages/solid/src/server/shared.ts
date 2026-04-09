import { getOwner, getNextChildId, getContext } from "@solidjs/signals";
import type { Context } from "@solidjs/signals";

export type SSRTemplateObject = { t: string[]; h: Function[]; p: Promise<any>[] };

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
  /** Register a client-side asset URL discovered during SSR (e.g. from lazy()). */
  registerAsset?: (type: "module" | "style", url: string) => void;
  /** Register a moduleUrl-to-entryUrl mapping for the current boundary. */
  registerModule?: (moduleUrl: string, entryUrl: string) => void;
  /** Resolve a module's JS and CSS assets from the asset manifest. Set by dom-expressions. */
  resolveAssets?: (moduleUrl: string) => { js: string[]; css: string[] } | null;
  /** Retrieve the moduleUrl-to-entryUrl map for a boundary. */
  getBoundaryModules?: (id: string) => Record<string, string> | null;
  /** @internal Tracks which Loading boundary is currently rendering. Set by dom-expressions via applyAssetTracking(). */
  _currentBoundaryId?: string | null;
  assets: any[];
  /** True only in renderToStream — enables async data serialization and streaming. */
  async?: boolean;
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
