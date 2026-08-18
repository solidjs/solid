import { untrack, createMemo } from "@solidjs/signals";
import { $DEVCOMP, IS_DEV, devComponent } from "../client/core.js";
import { _lazyHydrationLookup, sharedConfig } from "./hydration.js";
import type { Element as SolidElement } from "../types.js";

/**
 * A general `Component` has no implicit `children` prop. If desired, specify
 * one explicitly, e.g. `Component<{ name: string; children: Element }>`.
 */
export type Component<P extends Record<string, any> = {}> = (props: P) => SolidElement;

/**
 * Extend props to forbid the `children` prop.
 * Use this to prevent accidentally passing `children` to components that
 * would silently throw them away.
 */
export type VoidProps<P extends Record<string, any> = {}> = P & { children?: never };
/**
 * `VoidComponent` forbids the `children` prop.
 * Use this to prevent accidentally passing `children` to components that
 * would silently throw them away.
 */
export type VoidComponent<P extends Record<string, any> = {}> = Component<VoidProps<P>>;

/**
 * Extend props to allow optional Solid children.
 * Use this for components that you want to accept children.
 */
export type ParentProps<P extends Record<string, any> = {}> = P & { children?: SolidElement };
/**
 * `ParentComponent` allows an optional `children` prop.
 * Use this for components that you want to accept children.
 */
export type ParentComponent<P extends Record<string, any> = {}> = Component<ParentProps<P>>;

/**
 * Extend props to require a `children` prop with the specified type.
 * Use this for components where you need a specific child type,
 * typically a function that receives specific argument types.
 */
export type FlowProps<P extends Record<string, any> = {}, C = SolidElement> = P & { children: C };
/**
 * `FlowComponent` requires a `children` prop with the specified type.
 * Use this for components where you need a specific child type,
 * typically a function that receives specific argument types.
 */
export type FlowComponent<P extends Record<string, any> = {}, C = SolidElement> = Component<
  FlowProps<P, C>
>;

export type ValidComponent = Component<any>;

/**
 * Takes the props of the passed component and returns its type
 *
 * Intrinsic element prop extraction is renderer-specific and lives in renderer
 * packages such as `@solidjs/web`.
 */
export type ComponentProps<T extends ValidComponent> = T extends Component<infer P> ? P : never;

/**
 * Type of `props.ref`, for use in `Component` or `props` typing.
 *
 * @example Component<{ref: Ref<Element>}>
 */
export type Ref<T> = T | ((val: T) => void) | undefined | Ref<T>[];

/**
 * Invokes a component, wrapping the call in `untrack` so that reactive reads
 * inside the component body don't subscribe the parent computation. Compiled
 * JSX uses this internally; manual calls are rarely needed unless authoring a
 * custom JSX factory or renderer.
 */
export function createComponent<T extends Record<string, any>>(
  Comp: Component<T>,
  props: T
): SolidElement {
  if (IS_DEV) return devComponent(Comp, props || ({} as T));
  return untrack(() => Comp(props || ({} as T)));
}

/**
 * Defines a code-split component. The returned component triggers its dynamic
 * import on first render and suspends through any enclosing `<Loading>`
 * boundary while the chunk is in flight. Call `.preload()` to start the
 * import early (e.g. on hover).
 *
 * @param fn dynamic import resolving the component's module. By default the
 *   component must BE the module's default export (same contract as
 *   React.lazy): hydration resolves it synchronously from the preloaded
 *   module, so wrappers that select a named export at runtime are not
 *   supported. To use a named export, pass `{ export: "Name" }` — the name is
 *   a call-site literal available on both server and client, so the
 *   synchronous hydration claim is preserved.
 * @param options `{ export?: string }` — which export of the resolved module
 *   is the component (defaults to `"default"`).
 * @param moduleUrl optional module specifier injected by the bundler
 *   integration; exposed as the component's `moduleUrl` property (islands)
 *   and used in hydration error messages. Hydration itself matches
 *   server-preloaded modules positionally by hydration id, so lazy
 *   components without a moduleUrl (e.g. via import.meta.glob) hydrate too.
 *
 * @example
 * ```tsx
 * const Profile = lazy(() => import("./Profile"));
 * const About = lazy(() => import("./pages"), { export: "About" });
 *
 * function App() {
 *   return (
 *     <Loading fallback={<Spinner />}>
 *       <Profile id="42" />
 *     </Loading>
 *   );
 * }
 *
 * // Preload before the user clicks
 * <button onMouseEnter={() => Profile.preload()}>Open profile</button>
 * ```
 */
export function lazy<M extends Record<string, any>, K extends keyof M & string>(
  fn: () => Promise<M>,
  options: { export: K },
  moduleUrl?: string
): M[K] & { preload: () => Promise<M>; moduleUrl?: string };
export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>,
  options?: { export?: string },
  moduleUrl?: string
): T & { preload: () => Promise<{ default: T }>; moduleUrl?: string };
export function lazy<T extends Component<any>>(
  fn: () => Promise<any>,
  options?: { export?: string },
  moduleUrl?: string
): T & { preload: () => Promise<any>; moduleUrl?: string } {
  const exportName = options?.export;
  if (IS_DEV && typeof options === "string")
    throw new Error(
      "lazy() moduleUrl moved to the third argument: lazy(fn, options?, moduleUrl?). " +
        "Pass { export } options second, or undefined."
    );
  let comp: (() => T | undefined) | undefined;
  let p: Promise<any> | undefined;
  const load = () => {
    if (p) return p;
    const cur = (p = fn());
    cur.then(
      (mod: any) => {
        comp = () => (exportName ? mod[exportName] : mod.default) as T;
      },
      // Failed loads must not be cached: the platform re-fetches a failed
      // dynamic import, and an Errored reset() remounts expecting a retry.
      // Clearing only if still current keeps an in-flight render (which
      // captured `cur`) throwing the original error while the next mount
      // or preload re-imports (#2999). Handling rejection here also stops
      // every failed load surfacing as an unhandled rejection.
      () => {
        if (p === cur) p = undefined;
      }
    );
    return cur;
  };
  const wrap: T & { preload?: () => void; moduleUrl?: string } = ((props: any) => {
    // `hydrating` can only be true once enableHydration() installed the slot.
    if (sharedConfig.hydrating)
      comp = _lazyHydrationLookup!(comp, moduleUrl, exportName) as () => T;
    // The import (`p`) is shared across instances, but the memo tracking it
    // must be owned per instance: a shared memo dies with whichever instance
    // rendered first, stranding survivors mid-flight (#2915). load() runs
    // INSIDE the compute: an Errored reset() retries by recomputing the
    // errored source in place, so each run must re-consult the module cache
    // (a rejection clears it) rather than replay a captured rejected import.
    let local = comp;
    if (!local) {
      load();
      local = createMemo<T>(() =>
        load().then((mod: any) => (exportName ? mod[exportName] : mod.default))
      );
    }

    let Comp: T | undefined;
    return createMemo(
      () =>
        (Comp = (comp || local)!())
          ? untrack(() => {
              if (IS_DEV) Object.assign(Comp!, { [$DEVCOMP]: true });
              return Comp!(props);
            })
          : "",
      { sync: true }
    ) as unknown as SolidElement;
  }) as T;
  wrap.preload = load;
  wrap.moduleUrl = moduleUrl;
  return wrap as T & { preload: () => Promise<{ default: T }>; moduleUrl?: string };
}

let counter = 0;
/**
 * Returns a stable id string that matches between server-rendered and
 * client-hydrated trees. Use it for `<label for>`, `aria-labelledby`, and
 * other attributes that need consistent ids across SSR.
 *
 * @example
 * ```tsx
 * function Field(props: { label: string }) {
 *   const id = createUniqueId();
 *   return (
 *     <>
 *       <label for={id}>{props.label}</label>
 *       <input id={id} />
 *     </>
 *   );
 * }
 * ```
 */
export function createUniqueId(): string {
  // `hydrating` can only be true once enableHydration() assigned the method.
  return sharedConfig.hydrating ? sharedConfig.getNextContextId!() : `cl-${counter++}`;
}
