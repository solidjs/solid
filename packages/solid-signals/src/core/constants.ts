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
export const REACTIVE_MANUAL_WRITE = 1 << 10;
/**
 * The pending recompute is a re-ask of the same question: `refresh()` dirtied
 * the node while no tracked input changed value. Cleared whenever a real
 * value-change notification arrives (`insertSubs`), and consumed by
 * `recompute` into the node's `_reask` classification — a quiet (re-ask)
 * pending window does not read as pending (question-scoped pending model).
 */
export const REACTIVE_REASK = 1 << 11;

// Static configuration bits packed into Owner/Computed/Signal _config.
export const CONFIG_OWNED_WRITE = 1 << 0;
export const CONFIG_NO_SNAPSHOT = 1 << 1;
export const CONFIG_TRANSPARENT = 1 << 2;
export const CONFIG_IN_SNAPSHOT_SCOPE = 1 << 3;
export const CONFIG_CHILDREN_FORBIDDEN = 1 << 4;
export const CONFIG_AUTO_DISPOSE = 1 << 5;
export const CONFIG_SYNC = 1 << 6;

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
/**
 * Stand-in stored in `_overrideValue` for an optimistic write of literal
 * `undefined` (#2898). The slot doubles as the optimistic-node brand
 * (`undefined` = not optimistic, `NOT_PENDING` = at rest), so the raw value
 * would erase the node's optimistic identity: the write turns invisible and
 * follow-up writes route off the optimistic path and commit permanently.
 * Same shape as NO_SNAPSHOT. Sites that surface the override VALUE unwrap
 * via `visibleOverrideValue`; slot identity tests stay raw.
 */
export const OVERRIDE_UNDEFINED = {};

/** Unwrap an active override's stored value for surfacing to readers (#2898). */
export function unwrapOverride<T = any>(v: unknown): T {
  return (v === OVERRIDE_UNDEFINED ? undefined : v) as T;
}
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
 * Brand applied to values that participate in the `refresh()` re-run protocol.
 * Accessors receive this handle internally; projected stores expose it through
 * their public return type so user-defined hooks that wrap `createOptimisticStore`
 * / `createProjection` / projection-form `createStore` can have their return
 * types inferred without leaking the internal `$REFRESH` symbol into public type
 * signatures (TS4058).
 */
export type Refreshable<T> = T & { readonly [$REFRESH]: any };
