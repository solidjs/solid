import {
  createMemo,
  createRoot,
  getOwner,
  untrack,
  setContext,
  getContext,
  flatten
} from "@solidjs/signals";
import type { Accessor, EffectOptions } from "@solidjs/signals";
import type { ArrayElement, Element as SolidElement } from "../types.js";
import { FlowComponent, FlowProps } from "./component.js";

// replaced during build
export const IS_DEV = "_SOLID_DEV_" as string | boolean;
/**
 * Brand symbol marking dev-built components for `solid-devtools` /
 * AI-readiness instrumentation. Internal cross-package wiring.
 *
 * @internal
 */
export const $DEVCOMP = Symbol(IS_DEV ? "COMPONENT_DEV" : 0);

// Magic type that when used at sites where generic types are inferred from, will prevent those sites from being involved in the inference.
// https://github.com/microsoft/TypeScript/issues/14829
// TypeScript Discord conversation: https://discord.com/channels/508357248330760243/508357248330760249/911266491024949328
export type NoInfer<T extends any> = [T][T extends any ? 0 : never];

export type ContextProviderComponent<T> = FlowComponent<{ value: T }>;

// Context API
export interface Context<T> extends ContextProviderComponent<T> {
  id: symbol;
  defaultValue: T | undefined;
}

/**
 * Creates a Context for sharing state with descendants of a Provider in the
 * component tree.
 *
 * The returned `Context` is itself a provider component — pass it a `value`
 * prop to scope a value to its children. Read it inside descendants with
 * `useContext`.
 *
 * Two forms:
 *
 * - **`createContext<T>()`** (default-less, the canonical form). Reading via
 *   `useContext` outside an enclosing Provider throws `ContextNotFoundError`.
 *   Use this for everything that carries reactive state — signals, stores,
 *   `[state, actions]` tuples, services. The Provider is mandatory by
 *   construction; the throw makes a missing Provider a loud bug instead of a
 *   silent no-op. The annotation `<T>` is required because there is no value
 *   to infer from.
 * - **`createContext<T>(defaultValue)`** (default form). Reserved for the
 *   narrow case of contexts whose value is a primitive with a meaningful
 *   static fallback (theme, locale, frozen config). Outside any Provider,
 *   `useContext` returns `defaultValue`.
 *
 * If you want truly app-wide state, **don't use Context** — a module-scope
 * signal/store *is* a global. Context is for scoping state to a subtree;
 * that's why a Provider is required.
 *
 * @param defaultValue optional default; only meaningful for primitive
 *   fallbacks. Omit for any context carrying reactive state.
 * @param options `{ name }` for debugging in development
 * @returns a context object that doubles as its own provider component
 *
 * @example
 * ```tsx
 * // Reactive payload — default-less, throws if no Provider.
 * type TodosCtx = readonly [Store<Todo[]>, TodoActions];
 * const TodosContext = createContext<TodosCtx>();
 *
 * function App() {
 *   return (
 *     <TodosContext value={createTodos()}>
 *       <TodoList />
 *     </TodosContext>
 *   );
 * }
 *
 * function TodoList() {
 *   const [todos, { addTodo }] = useContext(TodosContext); // typed as TodosCtx
 *   // ...
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Primitive default — falls back to "light" outside a Provider.
 * const ThemeContext = createContext<"light" | "dark">("light");
 *
 * function Button() {
 *   const theme = useContext(ThemeContext); // "light" | "dark"
 *   return <button class={theme}>Click</button>;
 * }
 * ```
 *
 * @description https://docs.solidjs.com/reference/component-apis/create-context
 */
export function createContext<T>(defaultValue?: T, options?: EffectOptions): Context<T> {
  const id = Symbol((options && options.name) || "");
  function provider(props: FlowProps<{ value: unknown }>) {
    return createRoot(() => {
      setContext(provider, props.value);
      return children(() => props.children);
    });
  }
  provider.id = id;
  provider.defaultValue = defaultValue;
  return provider as unknown as Context<T>;
}

/**
 * Reads the current value of a context.
 *
 * - For `createContext<T>()` (default-less): returns the value from the
 *   nearest enclosing Provider, or throws `ContextNotFoundError` if none is
 *   mounted. Return type is `T` (no narrowing required).
 * - For `createContext<T>(defaultValue)`: returns the value from the nearest
 *   enclosing Provider, or `defaultValue` if none is mounted.
 *
 * In Solid, `useContext` is the canonical way to read context. There is no
 * need for a wrapper hook that throws on missing Provider — the default-less
 * form already does that, and its return type is `T`.
 *
 * @param context a context returned from `createContext`
 * @returns the value provided by the nearest enclosing Provider, or the
 *   default if one was supplied to `createContext`
 * @throws `ContextNotFoundError` if no Provider is mounted and the context
 *   was created without a default
 *
 * @example
 * ```tsx
 * const TodosContext = createContext<TodosCtx>();
 *
 * function TodoList() {
 *   const [todos, { addTodo }] = useContext(TodosContext); // throws if no Provider
 *   // ...
 * }
 * ```
 *
 * @description https://docs.solidjs.com/reference/component-apis/use-context
 */
export function useContext<T>(context: Context<T>): T {
  return getContext(context);
}

export type ResolvedElement = Exclude<SolidElement, ArrayElement>;
export type ResolvedChildren = ResolvedElement | ResolvedElement[];
export type ChildrenReturn = Accessor<ResolvedChildren> & { toArray: () => ResolvedElement[] };

/**
 * Resolves a `children` accessor and exposes the result as an accessor with
 * a `.toArray()` helper. Use this when a component needs to inspect or
 * iterate over its children rather than just render them through.
 *
 * @param fn an accessor for the children
 * @returns an accessor of the resolved children, with `.toArray()` for iteration
 *
 * @example
 * ```tsx
 * function List(props: { children: Element }) {
 *   const items = children(() => props.children);
 *   return <ul>{items.toArray().map(item => <li>{item}</li>)}</ul>;
 * }
 * ```
 *
 * @description https://docs.solidjs.com/reference/component-apis/children
 */
export function children(fn: Accessor<SolidElement>): ChildrenReturn {
  const c = createMemo(fn, { lazy: true });
  const memo = createMemo(
    () => flatten(c()),
    IS_DEV ? { name: "children", lazy: true } : { lazy: true }
  ) as unknown as ChildrenReturn;
  memo.toArray = () => {
    const v = memo();
    return Array.isArray(v) ? v : v != null ? [v] : [];
  };
  return memo;
}

// Dev
export function devComponent<P, V>(Comp: (props: P) => V, props: P): V {
  return createRoot(
    () => {
      const owner: any = getOwner();
      owner._component = {
        fn: Comp,
        props,
        name: Comp.name
      };
      Object.assign(Comp, { [$DEVCOMP]: true });
      return untrack(() => Comp(props), IS_DEV && `<${Comp.name || "Anonymous"}>`);
    },
    { transparent: true }
  );
}
