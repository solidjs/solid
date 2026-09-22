import {
  createMemo,
  createRoot,
  getOwner,
  untrack,
  setContext,
  getContext,
  flatten,
  OBSERVE
} from "@solidjs/signals";
import type { Accessor, EffectOptions } from "@solidjs/signals";
import type { ArrayElement, Element as SolidElement } from "../types.js";
import { FlowComponent, FlowProps } from "./component.js";

// Replaced during build. Two tiers (see @solidjs/signals globals.d.ts):
// IS_DEV gates checks (strict-read labels, dev-only errors, devtools brands);
// IS_OBSERVE gates wiring (owner labels that feed `ownerPath` and
// attribution). Dev builds set both; observe builds set only IS_OBSERVE;
// prod neither. IS_DEV implies IS_OBSERVE.
export const IS_DEV = "_SOLID_DEV_" as string | boolean;
export const IS_OBSERVE = "_SOLID_OBSERVE_" as string | boolean;
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
 * Context is for state that belongs to a subtree, which includes app-wide
 * state in an app that renders on the server: a value created inside a
 * component is created once per request, and the Provider owns and disposes
 * it. Module scope is shared by every request in the same process, so reserve
 * it for constants.
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
 *   return null;
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
 *   return null;
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
  // `fn` is the user's children expression — may resolve to async values, so
  // this memo stays async-shape aware (no `sync: true`).
  const c = createMemo(fn, { lazy: true });
  // Outer memo body is just `flatten(c())` — statically synchronous. `c()`
  // can throw NotReadyError, but that propagates regardless of `sync`.
  const memo = createMemo(
    () => flatten(c()),
    IS_OBSERVE ? { name: "children", lazy: true, sync: true } : { lazy: true, sync: true }
  ) as unknown as ChildrenReturn;
  memo.toArray = () => {
    const v = memo();
    return Array.isArray(v) ? v : v != null ? [v] : [];
  };
  return memo;
}

/**
 * Observe/dev component wrapper: runs the component inside a transparent
 * root that carries its label, so the owner tree reads as the component
 * tree. Observe tier: the root and its `_name` — what `ownerPath` and
 * attribution need (`["<App>", "<TodoRow>", "effect"]`). Dev tier adds the
 * non-function check, the devtools `_component` record and `$DEVCOMP` brand,
 * and the strict-read label. The prod build never calls this.
 *
 * `name` is the source tag the compiler emitted under `sourceNames.components`; it
 * wins over `Comp.name`, which a minifier rewrites and a `lazy()` or HMR
 * wrapper hides.
 */
/**
 * A `console.createTask` task (Chrome's async stack tagging API; no lib
 * typing yet): `run(fn)` executes `fn` with the task's creation stack as
 * the async parent of whatever `fn` reports.
 */
export interface ConsoleTask {
  run<T>(fn: () => T): T;
}

function createConsoleTask(name: string): ConsoleTask | undefined {
  const createTask = (console as { createTask?: (name: string) => ConsoleTask }).createTask;
  return typeof createTask === "function" ? createTask.call(console, name) : undefined;
}

/**
 * The dev-tier record a component root carries as `_component` — what
 * devtools read off the owner tree.
 */
export interface ComponentRecord<P = unknown> {
  fn: (props: P) => unknown;
  props: P;
  /** The source tag when the compiler emitted one, else `fn.name`. */
  name: string | undefined;
  /**
   * The JSX site as a console task — when the console supports it and an
   * attribution engine was installed when the component rendered (see
   * `createConsoleTask` and the note at its use).
   */
  task: ConsoleTask | undefined;
}

export function observedComponent<P, V>(Comp: (props: P) => V, props: P, name?: string): V {
  // A JSX tag whose component resolved to a non-function otherwise surfaces
  // as `Cannot read properties of undefined (reading 'name')` from inside the
  // dev build — a framework-shaped stack for an app-shaped mistake (#3005).
  if (IS_DEV && typeof Comp !== "function") {
    throw new Error(
      `createComponent: expected a component function but got ${
        Comp === null ? "null" : typeof Comp
      }. A JSX tag resolved to a non-function value — check the import: a missing or misnamed export resolves to undefined.`
    );
  }
  name ||= Comp.name;
  const label = `<${name || "Anonymous"}>`;
  return createRoot(
    () => {
      const owner: any = getOwner();
      // The component root carries its label as `_name`, the same field the
      // signals observe layer reads for owner names (reserved from property
      // mangling there for exactly this write) — so diagnostics locate scopes
      // by component and an owned-scope write in a component body reports
      // "(in <TodoRow>)".
      owner._name = label;
      if (IS_DEV) {
        // The JSX site as a console task (Chrome's async stack tagging):
        // an observer that later reports on this component's nodes — the
        // performance tracks painting a re-run span — runs its
        // `performance.measure` inside `task.run(...)`, and the entry's
        // stack in the panel points at where the component was rendered
        // rather than at the observer. Only while an attribution engine is
        // installed: `console.createTask` costs a stack capture per call
        // (about the component wrapper's own cost again, and ~90 B retained
        // per instance, DevTools open or not), and only an attribution
        // consumer ever reads the task — so a dev session with nothing
        // enabled pays nothing, and a consumer that enables before render
        // (the tracks at bootstrap) sees every component's site.
        const record: ComponentRecord<P> = {
          fn: Comp,
          props,
          name,
          task: OBSERVE!.attribution.installed !== null ? createConsoleTask(label) : undefined
        };
        owner._component = record;
        Object.assign(Comp, { [$DEVCOMP]: true });
        return untrack(() => Comp(props), label);
      }
      return untrack(() => Comp(props));
    },
    { transparent: true }
  );
}
