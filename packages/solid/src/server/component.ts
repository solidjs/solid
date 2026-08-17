import {
  NotReadyError,
  createMemo,
  getNextChildId,
  peekNextChildId,
  getOwner,
  getContext,
  NoHydrateContext
} from "./signals.js";
import { sharedConfig, type ResolvedAssets } from "./shared.js";
import type { Element as SolidElement } from "../types.js";

export function enableHydration() {}

/**
 * A general `Component` has no implicit `children` prop. If desired, specify
 * one explicitly, e.g. `Component<{ name: string; children: Element }>`.
 */
export type Component<P extends Record<string, any> = {}> = (props: P) => SolidElement;

/**
 * Extend props to forbid the `children` prop.
 */
export type VoidProps<P extends Record<string, any> = {}> = P & { children?: never };
/**
 * `VoidComponent` forbids the `children` prop.
 */
export type VoidComponent<P extends Record<string, any> = {}> = Component<VoidProps<P>>;

/**
 * Extend props to allow optional Solid children.
 */
export type ParentProps<P extends Record<string, any> = {}> = P & { children?: SolidElement };
/**
 * `ParentComponent` allows an optional `children` prop with the usual type in JSX.
 */
export type ParentComponent<P extends Record<string, any> = {}> = Component<ParentProps<P>>;

/**
 * Extend props to require a `children` prop with the specified type.
 */
export type FlowProps<P extends Record<string, any> = {}, C = SolidElement> = P & { children: C };
/**
 * `FlowComponent` requires a `children` prop with the specified type.
 */
export type FlowComponent<P extends Record<string, any> = {}, C = SolidElement> = Component<
  FlowProps<P, C>
>;

export type ValidComponent = Component<any>;

/**
 * Takes the props of the passed component and returns its type
 */
export type ComponentProps<T extends ValidComponent> = T extends Component<infer P> ? P : never;

/**
 * Type of `props.ref`, for use in `Component` or `props` typing.
 */
export type Ref<T> = T | ((val: T) => void);

/**
 * Creates a component. On server, just calls the function directly (no untrack needed).
 */
export function createComponent<T extends Record<string, any>>(
  Comp: Component<T>,
  props: T
): SolidElement {
  return Comp(props || ({} as T));
}

/**
 * Lazy load a function component asynchronously.
 * On server, returns a createMemo that throws NotReadyError until the module resolves,
 * allowing resolveSSRNode to capture it as a fine-grained hole. The memo naturally
 * scopes the owner so hydration IDs align with the client's createMemo in lazy().
 * The bundler plugin injects `moduleUrl` (the module specifier) so the server
 * can look up client chunk URLs from the asset manifest. When no callsite
 * `moduleUrl` exists (e.g. `lazy` over an `import.meta.glob` entry), asset
 * resolution defers until the import resolves and reads the module's
 * bundler-injected `$$moduleUrl` export instead.
 *
 * The returned component's `moduleUrl` property resolves through the active
 * request's asset manifest: inside SSR it returns the client-loadable entry
 * URL for the module (e.g. `/assets/About-abc123.js`), suitable for stamping
 * into markup (island containers and similar). Outside a request context it
 * returns the raw module specifier. Reading it during SSR also registers a
 * modulepreload hint for the module's chunks — accessing the resolved client
 * URL on the server is treated as a declaration that the client will fetch it.
 */
export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>,
  moduleUrl?: string
): T & { preload: () => Promise<{ default: T }>; moduleUrl?: string } {
  type LoadingModule = Promise<{ default: T }> & {
    v?: T;
    mod?: { default: T };
    error?: unknown;
    errored?: boolean;
  };
  let p: LoadingModule | undefined;
  let load = () => {
    if (p) return p;
    const cur = (p = fn() as LoadingModule);
    cur.then(
      mod => {
        // The full namespace is kept alongside the default export so a
        // post-load re-creation can read `$$moduleUrl` synchronously (see
        // the deferred registration path below).
        cur.mod = mod;
        cur.v = mod.default;
      },
      err => {
        // Capture the rejection so the SSR render path can surface it to
        // `<Errored>` instead of leaving `v` undefined forever (which
        // would keep throwing `NotReadyError` and look like the module is
        // still loading) and instead of leaking the rejection as a
        // process-level `unhandledRejection` (#2780). Presence is a flag —
        // a falsy rejection value is still a rejection (#2857).
        cur.error = err;
        cur.errored = true;
        // But never CACHE the failure: `p` is module-scoped and shared
        // across requests, so a single transient import hiccup would poison
        // every subsequent SSR render for the process lifetime. Clearing
        // (only if still current) lets the next creation re-import, while
        // renders that captured `cur` still surface this error (#2999).
        if (p === cur) p = undefined;
      }
    );
    return cur;
  };
  const wrap: Component<ComponentProps<T>> & {
    preload?: () => Promise<{ default: T }>;
    moduleUrl?: string;
  } = props => {
    const noHydrate = getContext(NoHydrateContext);
    if (!noHydrate && !sharedConfig.context?.resolveAssets) {
      throw new Error(
        `lazy() called${moduleUrl ? ` with moduleUrl "${moduleUrl}"` : ""} but no asset manifest is set. ` +
          "Pass a manifest option to renderToStream/renderToString."
      );
    }
    // Capture the current load: a rejection clears `p` for future retries,
    // and this render must keep reading the promise it suspended on.
    const cur = load();
    const ctx = sharedConfig.context;
    // While set, the render memo below reports not-ready even after the module
    // itself has loaded. Only async work arms it: an in-flight resolver-
    // function manifest (dev servers answer asset lookups from their live
    // module graph) or the deferred `$$moduleUrl` path. Without this gate a
    // streamed fragment could flush before its assets registered, dropping
    // its styles/module map from the stream. Sync manifests never arm it.
    let assetsPending: Promise<void> | undefined;
    // Asset registration is separate from rendering: the manifest guard above
    // is waived for no-hydrate zones (nothing hydrates, so no assets are
    // needed), and those zones must still render their resolved module.
    // Fusing this into an early return dropped the content entirely for
    // exactly the waived cases (#2859).
    if (ctx?.registerAsset && ctx.resolveAssets) {
      // The module mapping is keyed by the hydration id the render memo below
      // will receive (peek — creating the memo consumes the slot). The
      // client's lazy() computes the same id positionally during hydration,
      // so no module identity needs to exist client-side.
      const o = getOwner();
      const hydrationKey = !noHydrate && o?.id != null ? peekNextChildId(o) : undefined;
      const applyAssets = (assets: ResolvedAssets | null | undefined) => {
        if (!assets) return;
        for (let i = 0; i < assets.css.length; i++) {
          const css = assets.css[i];
          if (typeof css === "string") ctx.registerAsset!("style", css);
          else ctx.registerAsset!("inline-style", css);
        }
        if (!noHydrate) {
          for (let i = 0; i < assets.js.length; i++) ctx.registerAsset!("module", assets.js[i]);
          if (hydrationKey != null) ctx.registerModule?.(hydrationKey, assets.js[0]);
        }
      };
      const registerLazyAssets = (id: string): Promise<void> | undefined => {
        // One resolver call per module per request. The component body — and
        // with it this registration — re-runs on every re-creation across
        // suspended render passes, and dev-server resolvers answer from the
        // live module graph with real work per call, so re-asking multiplied
        // that work by the retry count (and by every lazy() on the page).
        // Only the RESOLUTION is memoized: applyAssets below still runs per
        // creation, so per-boundary asset attribution is unchanged.
        const cache = (ctx._lazyAssets ??= new Map());
        let assets;
        if (cache.has(id)) {
          assets = cache.get(id);
        } else {
          assets = ctx.resolveAssets!(id);
          cache.set(id, assets);
        }
        if (assets && typeof (assets as Promise<ResolvedAssets | null>).then === "function") {
          // Restore the boundary that owned this render around the deferred
          // registration — by the time the resolver settles, other
          // boundaries may be rendering.
          const boundary = ctx._currentBoundaryId;
          return (assets as Promise<ResolvedAssets | null>).then(
            resolved => {
              // Upgrade the memoized entry to the settled VALUE. Leaving the
              // promise in the cache made every post-settle re-creation mint a
              // fresh `assetsPending` (a `.then` of an already-resolved
              // promise: pending at the render memo's compute, settled one
              // microtask later), so the memo threw NotReadyError on every
              // suspended-render retry pass and the boundary resume loop never
              // converged — an unbounded microtask livelock that ground dev
              // streaming SSR into heap exhaustion (async dev resolvers only;
              // sync manifests never enter this branch).
              cache.set(id, resolved ?? null);
              const current = ctx._currentBoundaryId;
              ctx._currentBoundaryId = boundary;
              try {
                applyAssets(resolved);
              } finally {
                ctx._currentBoundaryId = current;
              }
            },
            err => {
              cache.set(id, null);
              console.warn(`lazy() asset resolution failed for "${id}":`, err);
            }
          );
        }
        applyAssets(assets as ResolvedAssets | null);
      };
      if (moduleUrl) {
        assetsPending = registerLazyAssets(moduleUrl);
      } else if (!noHydrate) {
        // No callsite moduleUrl (e.g. lazy over an `import.meta.glob` entry) —
        // the module's identity lives in the module itself: the bundler's SSR
        // transform injects a `$$moduleUrl` export carrying the client
        // manifest key. Defer registration until the import resolves.
        if (cur.mod !== undefined) {
          // Already loaded (a re-creation across suspended render passes):
          // read `$$moduleUrl` synchronously instead of chaining another
          // `p.then`. The promise hop was pending at the render memo's
          // compute on EVERY re-creation — even after module and assets had
          // settled — so each retry pass re-suspended on a gate that resolved
          // one microtask later and the boundary resume loop never converged
          // (the same livelock as the cache upgrade in registerLazyAssets;
          // both paths must go sync once their async work is done).
          const id = (cur.mod as any)?.$$moduleUrl;
          if (typeof id === "string") {
            assetsPending = registerLazyAssets(id);
          } else {
            console.warn(
              "lazy() used in SSR without a moduleUrl and the loaded module has no " +
                "$$moduleUrl export, so its client assets cannot be resolved — the " +
                "component will load late during hydration. This is typically " +
                "injected by the bundler plugin."
            );
          }
        } else {
          const boundary = ctx._currentBoundaryId;
          assetsPending = cur.then(mod => {
            const id = (mod as any)?.$$moduleUrl;
            if (typeof id !== "string") {
              console.warn(
                "lazy() used in SSR without a moduleUrl and the loaded module has no " +
                  "$$moduleUrl export, so its client assets cannot be resolved — the " +
                  "component will load late during hydration. This is typically " +
                  "injected by the bundler plugin."
              );
              return;
            }
            const current = ctx._currentBoundaryId;
            ctx._currentBoundaryId = boundary;
            try {
              // May itself defer again (async resolver); the returned promise
              // keeps the memo gated until the whole chain settles.
              return registerLazyAssets(id);
            } finally {
              ctx._currentBoundaryId = current;
            }
          });
        }
      }
      if (assetsPending) {
        const clear = () => {
          assetsPending = undefined;
        };
        assetsPending = assetsPending.then(clear, clear);
      }
    }
    // The module promise is deliberately NOT registered as a renderer-blocking
    // promise. Doing so gates the shell flush on the module load, so an
    // enclosing boundary never shows its fallback and a slow module stalls the
    // whole document. Suspending on read (below) lets the nearest boundary own
    // the wait and stream the module in behind its placeholder; with no
    // boundary to defer to the read becomes a root hole and the renderer
    // blocks the shell on it anyway.
    //
    // Asset ordering does not depend on this: `assetsPending` gates the render
    // memo separately, so a fragment still cannot flush before its styles and
    // module map are registered.
    return createMemo(
      () => {
        if (cur.errored) throw cur.error;
        if (!cur.v) throw new NotReadyError(cur);
        if (assetsPending) throw new NotReadyError(assetsPending);
        return cur.v(props);
      },
      { sync: true }
    ) as unknown as SolidElement;
  };
  wrap.preload = load;
  Object.defineProperty(wrap, "moduleUrl", {
    get() {
      const ctx = sharedConfig.context;
      if (moduleUrl && ctx?.resolveAssets) {
        // A getter can't await, so prefer the sync resolution path (async
        // dev resolvers expose one carrying the js URLs); without one, fall
        // through to the raw specifier on a thenable result.
        const resolve = ctx.resolveAssetsSync || ctx.resolveAssets;
        const assets = resolve(moduleUrl);
        if (
          assets &&
          typeof (assets as Promise<ResolvedAssets | null>).then !== "function" &&
          (assets as ResolvedAssets).js.length
        ) {
          const resolved = assets as ResolvedAssets;
          // Lazy components under NoHydration (e.g. islands) skip module
          // registration during render, so this access is the only signal
          // that the client will fetch these chunks.
          if (ctx.registerAsset) {
            for (let i = 0; i < resolved.js.length; i++)
              ctx.registerAsset("module", resolved.js[i]);
          }
          return resolved.js[0];
        }
      }
      return moduleUrl;
    },
    configurable: true,
    enumerable: true
  });
  return wrap as T & { preload: () => Promise<{ default: T }>; moduleUrl?: string };
}

export function createUniqueId(): string {
  const o = getOwner();
  if (!o) throw new Error(`createUniqueId cannot be used outside of a reactive context`);
  return getNextChildId(o);
}
