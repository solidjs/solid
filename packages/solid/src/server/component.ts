import {
  NotReadyError,
  createMemo,
  getNextChildId,
  getOwner,
  getContext,
  NoHydrateContext
} from "./signals.js";
import { sharedConfig } from "./shared.js";
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
 * Requires `moduleUrl` for SSR — the bundler plugin injects the module specifier
 * so the server can look up client chunk URLs from the asset manifest.
 */
export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>,
  moduleUrl?: string
): T & { preload: () => Promise<{ default: T }>; moduleUrl?: string } {
  let p: Promise<{ default: T }> & { v?: T; error?: unknown };
  let load = () => {
    if (!p) {
      p = fn() as any;
      p.then(
        mod => {
          p.v = mod.default;
        },
        err => {
          // Capture the rejection so the SSR render path can surface it to
          // `<Errored>` instead of leaving p.v `undefined` forever (which
          // would keep throwing `NotReadyError` and look like the module is
          // still loading) and instead of leaking the rejection as a
          // process-level `unhandledRejection` (#2780).
          p.error = err;
        }
      );
    }
    return p;
  };
  const wrap: Component<ComponentProps<T>> & {
    preload?: () => Promise<{ default: T }>;
    moduleUrl?: string;
  } = props => {
    const noHydrate = getContext(NoHydrateContext);
    if (!noHydrate && !moduleUrl) {
      throw new Error(
        "lazy() used in SSR without a moduleUrl. " +
          "All lazy() components require a moduleUrl for correct hydration. " +
          "This is typically injected by the bundler plugin."
      );
    }
    if (!noHydrate && !sharedConfig.context?.resolveAssets) {
      throw new Error(
        `lazy() called with moduleUrl "${moduleUrl}" but no asset manifest is set. ` +
          "Pass a manifest option to renderToStream/renderToString."
      );
    }
    load();
    const ctx = sharedConfig.context;
    if (!ctx?.registerAsset || !ctx.resolveAssets || !moduleUrl) return;
    const assets = ctx.resolveAssets(moduleUrl);
    if (assets) {
      for (let i = 0; i < assets.css.length; i++) ctx.registerAsset("style", assets.css[i]);
      if (!noHydrate) {
        for (let i = 0; i < assets.js.length; i++) ctx.registerAsset("module", assets.js[i]);
        ctx.registerModule?.(moduleUrl, assets.js[0]);
      }
    }
    if (ctx?.async) {
      ctx.block(
        p.then(
          () => {
            (p as any).s = "success";
          },
          () => {
            // Rejection is captured on `p.error` by `load()` and surfaced
            // through the memo below; swallow the rejection of this branch
            // so `ctx.block` doesn't propagate a second unhandled rejection.
          }
        )
      );
    }
    return createMemo(
      () => {
        if (p.error) throw p.error;
        if (!p.v) throw new NotReadyError(p);
        return p.v(props);
      },
      { sync: true }
    ) as unknown as SolidElement;
  };
  wrap.preload = load;
  wrap.moduleUrl = moduleUrl;
  return wrap as T & { preload: () => Promise<{ default: T }>; moduleUrl?: string };
}

export function createUniqueId(): string {
  const o = getOwner();
  if (!o) throw new Error(`createUniqueId cannot be used outside of a reactive context`);
  return getNextChildId(o);
}
