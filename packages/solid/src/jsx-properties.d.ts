/**
 * Shared type-level helpers used to derive `prop:*` attribute typings from
 * DOM element interfaces (e.g. `HTMLInputElement`, `HTMLButtonElement`).
 *
 * The wrapping of each value (`FunctionMaybe<T>` in `jsx-h.d.ts` vs. the
 * raw value in `jsx.d.ts`) is applied by each consumer when composing its
 * own `Properties<T>` mapped type. That way this file stays identical in
 * both reactive and non-reactive contexts and only needs to exist once.
 *
 * originally from
 * @url https://github.com/potahtml/pota
 */

/** Base-class properties shared by all elements — skipped from `prop:*`. */
export type SkipPropsFrom = HTMLUnknownElement & HTMLElement & Element & Node;

/**
 * Value types allowed on a `prop:*`. Primitives plus the writable
 * non-primitive DOM-object props worth exposing:
 *
 * - `HTMLMediaElement.srcObject`
 * - `HTMLButtonElement.popoverTargetElement` / `commandForElement` (and the same via
 *   `PopoverTargetAttributes` mixin on `HTMLInputElement`)
 */
export type PropValue =
  | string
  | number
  | boolean
  | null
  | MediaStream
  | MediaSource
  | Blob
  | File
  | Element;

/**
 * Ergonomics widening for emitted `prop:*` value types:
 *
 * - general `string` → `string | number` (HTML coerces numbers)
 * - string literal unions (`'on' | 'off'`) stay exact, so users still get autocomplete /
 *   narrowing
 * - other types pass through unchanged
 */
type WidenString<V> = string extends V ? string | number : V;
export type WidenPropValue<V> = [V] extends [string] ? WidenString<V> : V;

/**
 * Structurally identical → `Y`; distinct → `N`. Used by `IsReadonlyKey` to detect
 * readonly keys by comparing `Pick<T, K>` with `Readonly<Pick<T, K>>`.
 */
export type IfEquals<A, B, Y = unknown, N = never> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? Y : N;

/**
 * True when `K` is readonly on `T`. Singleton-constant properties (e.g.
 * `tagName: "INPUT"`, `nodeType: 1`) are always `readonly` in `lib.dom.d.ts`, so this
 * single check covers both readonly and singleton-literal cases.
 */
export type IsReadonlyKey<T, K extends keyof T> = IfEquals<
  Pick<T, K>,
  Readonly<Pick<T, K>>,
  true,
  false
>;

/**
 * Resolves to the `prop:K` string literal when `K` is a writable, element-specific
 * property suitable for a `prop:*` attribute; otherwise resolves to `never` so the
 * key is filtered out of the resulting mapped type.
 *
 * Filters out:
 *
 * - base-class keys (via `SkipPropsFrom`)
 * - aria-* keys (already typed via `AriaAttributes`)
 * - readonly keys
 * - keys whose value types fall outside `PropValue`
 * - the generic `string` index signature (e.g. `HTMLFormElement[name: string]: any`),
 *   which would otherwise shadow every key with an `any`-typed `prop:*`
 */
export type PropKey<T, K extends keyof T> = K extends keyof SkipPropsFrom
  ? never
  : K extends string
    ? string extends K
      ? never
      : K extends `aria${string}`
        ? never
        : T[K] extends PropValue
          ? IsReadonlyKey<T, K> extends true
            ? never
            : `prop:${K}`
          : never
    : never;
