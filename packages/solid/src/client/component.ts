import { untrack, createSignal, createAsync, createMemo, getOwner } from "@solidjs/signals";
import { $DEVCOMP, IS_DEV, devComponent } from "../client/core.js";
import { sharedConfig } from "./hydration.js";
import type { JSX } from "../jsx.js";

let hydrationEnabled = false;
export function enableHydration() {
  hydrationEnabled = true;
}

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
 * type in JSX, `JSX.Element` (which allows elements, arrays, functions, etc.).
 * Use this for components that you want to accept children.
 */
export type ParentProps<P extends Record<string, any> = {}> = P & { children?: JSX.Element };
/**
 * `ParentComponent` allows an optional `children` prop with the usual
 * type in JSX, `JSX.Element` (which allows elements, arrays, functions, etc.).
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
export type ComponentProps<T extends ValidComponent> = T extends Component<infer P>
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

export function createComponent<T extends Record<string, any>>(
  Comp: Component<T>,
  props: T
): JSX.Element {
  if (IS_DEV) return devComponent(Comp, props || ({} as T));
  return untrack(() => Comp(props || ({} as T)));
}

// lazy load a function component asynchronously
export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>
): T & { preload: () => Promise<{ default: T }> } {
  let comp: () => T | undefined;
  let p: Promise<{ default: T }> | undefined;
  const wrap: T & { preload?: () => void } = ((props: any) => {
    // const ctx = sharedConfig.context;
    // if (ctx) {
    //   const [s, set] = createSignal<T>();
    //   sharedConfig.count || (sharedConfig.count = 0);
    //   sharedConfig.count++;
    //   (p || (p = fn())).then(mod => {
    //     !sharedConfig.done && setHydrateContext(ctx);
    //     sharedConfig.count!--;
    //     set(() => mod.default);
    //     setHydrateContext();
    //   });
    //   comp = s;
    // } else
    if (!comp) {
      const s = createAsync<T>(() => (p || (p = fn())).then(mod => mod.default));
      comp = s;
    }
    let Comp: T | undefined;
    return createMemo(() =>
      (Comp = comp())
        ? untrack(() => {
            if (IS_DEV) Object.assign(Comp!, { [$DEVCOMP]: true });
            return Comp!(props);
          })
        : ""
    ) as unknown as JSX.Element;
  }) as T;
  wrap.preload = () => p || ((p = fn()).then(mod => (comp = () => mod.default)), p);
  return wrap as T & { preload: () => Promise<{ default: T }> };
}

let counter = 0;
export function createUniqueId(): string {
  return sharedConfig.hydrating ? sharedConfig.getNextContextId() : `cl-${counter++}`;
}
