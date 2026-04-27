import { untrack, createMemo } from "@solidjs/signals";
import { $DEVCOMP, IS_DEV, devComponent } from "../client/core.js";
import { sharedConfig } from "./hydration.js";
import type { JSX } from "../jsx.js";

/**
 * A general `Component` has no implicit `children` prop.  If desired, you can
 * specify one as in `Component<{name: String, children: JSX.Element}>`.
 */
export type Component<P extends Record<string, any> = {}> = (props: P) => JSX.Element;

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
 * Extend props to allow an optional `children` prop with the usual
 * type in JSX, `JSX.Element` (which allows elements, arrays, strings, etc.).
 * Use this for components that you want to accept children.
 */
export type ParentProps<P extends Record<string, any> = {}> = P & { children?: JSX.Element };
/**
 * `ParentComponent` allows an optional `children` prop with the usual
 * type in JSX, `JSX.Element` (which allows elements, arrays, strings, etc.).
 * Use this for components that you want to accept children.
 */
export type ParentComponent<P extends Record<string, any> = {}> = Component<ParentProps<P>>;

/**
 * Extend props to require a `children` prop with the specified type.
 * Use this for components where you need a specific child type,
 * typically a function that receives specific argument types.
 * Note that all JSX <Elements> are of the type `JSX.Element`.
 */
export type FlowProps<P extends Record<string, any> = {}, C = JSX.Element> = P & { children: C };
/**
 * `FlowComponent` requires a `children` prop with the specified type.
 * Use this for components where you need a specific child type,
 * typically a function that receives specific argument types.
 * Note that all JSX <Elements> are of the type `JSX.Element`.
 */
export type FlowComponent<P extends Record<string, any> = {}, C = JSX.Element> = Component<
  FlowProps<P, C>
>;

export type ValidComponent = keyof JSX.IntrinsicElements | Component<any> | (string & {});

/**
 * Takes the props of the passed component and returns its type
 *
 * @example
 * ComponentProps<typeof Portal> // { mount?: Node; useShadow?: boolean; children: JSX.Element }
 * ComponentProps<'div'> // JSX.HTMLAttributes<HTMLDivElement>
 */
export type ComponentProps<T extends ValidComponent> =
  T extends Component<infer P>
    ? P
    : T extends keyof JSX.IntrinsicElements
      ? JSX.IntrinsicElements[T]
      : Record<string, unknown>;

/**
 * Type of `props.ref`, for use in `Component` or `props` typing.
 *
 * @example Component<{ref: Ref<Element>}>
 */
export type Ref<T> = T | ((val: T) => void);

/**
 * Invokes a component, wrapping the call in `untrack` so that reactive reads
 * inside the component body don't subscribe the parent computation. Compiled
 * JSX uses this internally; manual calls are rarely needed unless authoring a
 * custom JSX factory or renderer.
 */
export function createComponent<T extends Record<string, any>>(
  Comp: Component<T>,
  props: T
): JSX.Element {
  if (IS_DEV) return devComponent(Comp, props || ({} as T));
  return untrack(() => Comp(props || ({} as T)));
}

/**
 * Defines a code-split component. The returned component triggers its dynamic
 * import on first render and suspends through any enclosing `<Loading>`
 * boundary while the chunk is in flight. Call `.preload()` to start the
 * import early (e.g. on hover).
 *
 * @param fn dynamic import returning the module's default export
 * @param moduleUrl optional module URL used during hydration to look up
 *   preloaded chunks; usually injected by the bundler integration
 *
 * @example
 * ```tsx
 * const Profile = lazy(() => import("./Profile"));
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
export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>,
  moduleUrl?: string
): T & { preload: () => Promise<{ default: T }>; moduleUrl?: string } {
  let comp: () => T | undefined;
  let p: Promise<{ default: T }> | undefined;
  const wrap: T & { preload?: () => void; moduleUrl?: string } = ((props: any) => {
    if (sharedConfig.hydrating && moduleUrl) {
      const cached = (globalThis as any)._$HY?.modules?.[moduleUrl];
      if (!cached) {
        throw new Error(
          `lazy() module "${moduleUrl}" was not preloaded before hydration. ` +
            "Ensure it is inside a Loading boundary."
        );
      }
      comp = () => cached.default as T;
    }
    if (!comp) {
      p || (p = fn());
      p.then(mod => {
        comp = () => mod.default as T;
      });
      comp = createMemo<T>(() => p!.then(mod => mod.default));
    }

    let Comp: T | undefined;
    return createMemo(() =>
      (Comp = comp!())
        ? untrack(() => {
            if (IS_DEV) Object.assign(Comp!, { [$DEVCOMP]: true });
            return Comp!(props);
          })
        : ""
    ) as unknown as JSX.Element;
  }) as T;
  wrap.preload = () => p || ((p = fn()).then(mod => (comp = () => mod.default)), p);
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
  return sharedConfig.hydrating ? sharedConfig.getNextContextId() : `cl-${counter++}`;
}
