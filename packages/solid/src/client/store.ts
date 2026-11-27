// Its own module so a lazy route that imports a store gets the store engine in its own chunk.
import {
  createProjection as coreProjection,
  createStore as coreStore,
  createOptimisticStore as coreOptimisticStore,
  type NoFn,
  type Refreshable,
  type Store,
  type StoreOptions,
  type StoreSetter
} from "@solidjs/signals";
import { sharedConfig, _hydrateStoreLike, type HydrationProjectionOptions } from "./hydration.js";

/**
 * Creates a derived (projected) store — `createMemo` for stores. The
 * derive function receives a mutable draft and either mutates it in
 * place (canonical) or returns a new value. Either way the result is
 * reconciled against the previous draft by `options.key` (default
 * `"id"`), so surviving items keep their proxy identity — only
 * added/removed items are created/disposed.
 *
 * Returns the projected store directly (no setter — reads only).
 *
 * Reach for this when you want the structural-sharing / per-property
 * tracking of a store on top of a derived computation. For simple
 * read-only derivations, `createMemo` is lighter.
 *
 * @example
 * ```ts
 * // Mutation form — update individual fields on the draft.
 * const summary = createProjection<{ total: number; active: number }>(
 *   draft => {
 *     draft.total = users().length;
 *     draft.active = users().filter(u => u.active).length;
 *   },
 *   { total: 0, active: 0 }
 * );
 *
 * // Return form — produce a derived collection. Reconciled by `id`
 * // so each surviving user keeps the same store identity.
 * const activeUsers = createProjection<User[]>(
 *   () => allUsers().filter(u => u.active),
 *   []
 * );
 * ```
 *
 * **Hydration:** `ProjectionOptions` accepts an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`) for the same client-vs-server
 * tradeoffs as the other primitives. See {@link HydrationProjectionOptions}.
 */
export const createProjection: {
  <T extends object = {}>(
    fn: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T>,
    seed?: null,
    options?: Omit<HydrationProjectionOptions, "seedLoadingValue">
  ): Refreshable<Store<T>>;
  <T extends object = {}>(
    fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    seed: NoFn<T> | Store<NoFn<T>>,
    options?: HydrationProjectionOptions
  ): Refreshable<Store<T>>;
} = ((...args: any[]) => {
  // `hydrating` can only be true once enableHydration() installed the
  // adapter slot (see createOptimistic in hydration.ts for the retention story).
  return sharedConfig.hydrating
    ? _hydrateStoreLike!(coreProjection, args[0], args[1] ?? {}, args[2])
    : (coreProjection as Function)(...args);
}) as any;

type NoArray<T> = Extract<T, readonly unknown[]> extends never ? unknown : never;

/**
 * Creates a deeply-reactive store backed by a Proxy. Reads track each
 * property accessed; only the parts that change trigger updates.
 *
 * Store properties hold **plain values**, not accessors. The proxy
 * already tracks reads per-property — wrapping a value in
 * `() => state.foo` produces a getter that *won't* track when called,
 * which looks like a reactivity bug but is just a category error. If
 * you have a signal-shaped piece of state, make it a property of the
 * store (`{ foo: 1 }`) rather than nesting an accessor inside
 * (`{ foo: () => signal() }`).
 *
 * The setter takes a **draft-mutating** function — mutate the draft
 * in place (canonical). The callback may also return a new value:
 * arrays are replaced by index (length adjusted), objects are
 * shallow-diffed at the top level (keys present in the returned value
 * are written, missing keys deleted). Use the return form for shapes
 * where mutation is awkward — most commonly removing items via
 * `filter`. The setter does **not** do keyed reconciliation; for
 * that, use the derived/projection form (or `createProjection`).
 *
 * - **Plain form** — `createStore(initialValue, options?)`: wraps a value in a
 *   reactive proxy.
 * - **Derived form** — `createStore(fn, seed, options?)`: a
 *   *projection store* whose contents are computed by `fn(draft)`.
 *   `fn` may be sync, async, or an `AsyncIterable`; the projection's
 *   result reconciles against the existing store by `options.key`
 *   (default `"id"`) for stable identity.
 *
 * @example
 * ```ts
 * const [state, setState] = createStore({
 *   user: { name: "Ada", age: 36 },
 *   todos: [] as { id: string; text: string; done: boolean }[]
 * });
 *
 * // Canonical: mutate the draft in place.
 * setState(s => { s.user.age = 37; });
 * setState(s => { s.todos.push({ id: "1", text: "x", done: false }); });
 *
 * // Return form: reach for it when mutation is awkward.
 * setState(s => s.todos.filter(t => !t.done));               // remove items
 * setState(s => ({ ...s, user: { name: "Grace", age: 85 } })); // shallow replace
 * ```
 *
 * @example
 * ```ts
 * // Derived store — auto-fetches & reconciles by `id`.
 * const [users] = createStore(
 *   async () => fetch("/users").then(r => r.json()),
 *   [] as User[]
 * );
 * ```
 *
 * **Hydration:** the derived form accepts `ProjectionOptions`, including
 * an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`). See {@link HydrationProjectionOptions}.
 *
 * @returns `[store: Store<T>, setStore: StoreSetter<T>]`
 */
export const createStore: {
  <T extends object = {}>(
    initialValue: NoFn<T> | Store<NoFn<T>>,
    options?: StoreOptions
  ): [get: Store<T>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T>,
    seed?: null,
    options?: Omit<HydrationProjectionOptions, "seedLoadingValue">
  ): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    seed: NoFn<T> | Store<NoFn<T>>,
    options?: HydrationProjectionOptions
  ): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
} = ((...args: any[]) => {
  // `hydrating` can only be true once enableHydration() installed the
  // adapter slot (see createOptimistic in hydration.ts for the retention story).
  return typeof args[0] === "function" && sharedConfig.hydrating
    ? _hydrateStoreLike!(coreStore, args[0], args[1] ?? {}, args[2])
    : (coreStore as Function)(...args);
}) as any;

/**
 * The store equivalent of `createOptimistic`. Writes inside an
 * `action` transition are guesses: they show up immediately and always
 * revert when the transition settles, whether the action succeeded or
 * failed — including writes made after a `yield`. A guess never becomes
 * the value. What stays is the source of truth: refresh or write it in
 * the action, and the guesses revert onto it in the same frame.
 *
 * Use this for optimistic UI on collection-shaped data. For
 * single-value optimistic state, prefer `createOptimistic`.
 *
 * - **Derived form** — `createOptimisticStore(fn, seed, options?)`:
 *   a projection store whose value is recomputed by `fn` from the
 *   source of truth (a fetch, a store), with guesses laid over it. The
 *   usual form for data.
 * - **Plain form** — `createOptimisticStore(initialValue, options?)`:
 *   over a fixed value, so every guess reverts to it.
 *
 * In the derived form, `options.key` defaults to `"id"`; specify it only when your data
 * uses a different identity field (e.g. `{ key: "uuid" }` or
 * `{ key: t => t.slug }`). Restating the default just adds noise.
 *
 * @example
 * ```ts
 * const [todos, setTodos] = createOptimisticStore(() => api.listTodos(), []);
 *
 * // Mutation: guess the new row, save it, then re-fetch the truth.
 * const addTodo = action(function* (text: string) {
 *   setTodos(t => { t.push({ id: crypto.randomUUID(), text, pending: true }); });
 *   yield api.createTodo(text);
 *   refresh(todos); // the guess reverts onto the re-fetched list
 * });
 *
 * // Return form: filter is the natural shape for removal.
 * const removeTodo = action(function* (id: string) {
 *   setTodos(t => t.filter(x => x.id !== id));
 *   yield api.removeTodo(id);
 *   refresh(todos);
 * });
 * ```
 *
 * **Hydration:** the derived form accepts `ProjectionOptions`, including
 * an `ssrSource` field
 * (`"server"` | `"hybrid"` | `"client"`). See {@link HydrationProjectionOptions}.
 *
 * @returns `[store: Store<T>, setStore: StoreSetter<T>]`
 */
export const createOptimisticStore: {
  <T extends object = {}>(
    initialValue: NoFn<T> | Store<NoFn<T>>,
    options?: StoreOptions
  ): [get: Store<T>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T>,
    seed?: null,
    options?: Omit<HydrationProjectionOptions, "seedLoadingValue">
  ): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    seed: NoFn<T> | Store<NoFn<T>>,
    options?: HydrationProjectionOptions
  ): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
} = ((...args: any[]) => {
  // `hydrating` can only be true once enableHydration() installed the
  // adapter slot (see createOptimistic in hydration.ts for the retention story).
  return typeof args[0] === "function" && sharedConfig.hydrating
    ? _hydrateStoreLike!(coreOptimisticStore, args[0], args[1] ?? {}, args[2])
    : (coreOptimisticStore as Function)(...args);
}) as any;
