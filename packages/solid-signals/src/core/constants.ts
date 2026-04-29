export const REACTIVE_NONE = 0;
export const REACTIVE_CHECK = 1 << 0;
export const REACTIVE_DIRTY = 1 << 1;
export const REACTIVE_RECOMPUTING_DEPS = 1 << 2;
export const REACTIVE_IN_HEAP = 1 << 3;
export const REACTIVE_IN_HEAP_HEIGHT = 1 << 4;
export const REACTIVE_ZOMBIE = 1 << 5;
export const REACTIVE_DISPOSED = 1 << 6;
export const REACTIVE_OPTIMISTIC_DIRTY = 1 << 7;
export const REACTIVE_SNAPSHOT_STALE = 1 << 8;
export const REACTIVE_LAZY = 1 << 9;

// Static configuration bits packed into Owner/Computed/Signal _config.
export const CONFIG_OWNED_WRITE = 1 << 0;
export const CONFIG_NO_SNAPSHOT = 1 << 1;
export const CONFIG_TRANSPARENT = 1 << 2;
export const CONFIG_IN_SNAPSHOT_SCOPE = 1 << 3;
export const CONFIG_CHILDREN_FORBIDDEN = 1 << 4;
export const CONFIG_AUTO_DISPOSE = 1 << 5;

export const STATUS_NONE = 0;
export const STATUS_PENDING = 1 << 0;
export const STATUS_ERROR = 1 << 1;
export const STATUS_UNINITIALIZED = 1 << 2;

export const EFFECT_PURE = 0;
export const EFFECT_RENDER = 1;
export const EFFECT_USER = 2;
export const EFFECT_TRACKED = 3;

export const NOT_PENDING = {};
export const NO_SNAPSHOT = {};
export const STORE_SNAPSHOT_PROPS = "sp";

export const SUPPORTS_PROXY = typeof Proxy === "function";

export const defaultContext = {};

/**
 * Brand symbol used by `Refreshable<T>` values (projection stores, async
 * memos) to expose their underlying computation to `refresh()`. Not part of
 * the user-facing API.
 *
 * @internal
 */
export const $REFRESH = Symbol("refresh");

/**
 * Brand applied to derived/projected stores indicating they participate in
 * the `refresh()` re-run protocol. Use this alias instead of inlining
 * `T & { [$REFRESH]: any }` so that user-defined hooks that wrap
 * `createOptimisticStore` / `createProjection` / projection-form
 * `createStore` can have their return types inferred without leaking the
 * internal `$REFRESH` symbol into public type signatures (TS4058).
 */
export type Refreshable<T> = T & { readonly [$REFRESH]: any };
