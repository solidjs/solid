import {
  NotReadyError,
  createMemo,
  getNextChildId,
  getOwner,
  getContext,
  NoHydrateContext
} from "./signals.js";
import { sharedConfig } from "./shared.js";
import type { JSX } from "../jsx.js";

export function enableHydration() {}

/**
 * A general `Component` has no implicit `children` prop.  If desired, you can
 * specify one as in `Component<{name: String, children: JSX.Element}>`.
 */
export type Component<P extends Record<string, any> = {}> = (props: P) => JSX.Element;

/**
 * Extend props to forbid the `children` prop.
 */
export type VoidProps<P extends Record<string, any> = {}> = P & { children?: never };
/**
 * `VoidComponent` forbids the `children` prop.
 */
export type VoidComponent<P extends Record<string, any> = {}> = Component<VoidProps<P>>;

/**
 * Extend props to allow an optional `children` prop with the usual type in JSX.
 */
export type ParentProps<P extends Record<string, any> = {}> = P & { children?: JSX.Element };
/**
 * `ParentComponent` allows an optional `children` prop with the usual type in JSX.
 */
export type ParentComponent<P extends Record<string, any> = {}> = Component<ParentProps<P>>;

/**
 * Extend props to require a `children` prop with the specified type.
 */
export type FlowProps<P extends Record<string, any> = {}, C = JSX.Element> = P & { children: C };
/**
 * `FlowComponent` requires a `children` prop with the specified type.
 */
export type FlowComponent<P extends Record<string, any> = {}, C = JSX.Element> = Component<
  FlowProps<P, C>
>;

export type ValidComponent = keyof JSX.IntrinsicElements | Component<any> | (string & {});

/**
 * Takes the props of the passed component and returns its type
 */
export type ComponentProps<T extends ValidComponent> =
  T extends Component<infer P>
    ? P
    : T extends keyof JSX.IntrinsicElements
      ? JSX.IntrinsicElements[T]
      : Record<string, unknown>;

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
): JSX.Element {
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
  let p: Promise<{ default: T }> & { v?: T };
  let load = () => {
    if (!p) {
      p = fn() as any;
      p.then(mod => {
        p.v = mod.default;
      });
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
        p.then(() => {
          (p as any).s = "success";
        })
      );
    }
    return createMemo(() => {
      if (!p.v) throw new NotReadyError(p);
      return p.v(props);
    }) as unknown as JSX.Element;
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
