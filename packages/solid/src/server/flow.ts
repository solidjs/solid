import { children } from "./core.js";
import {
  createMemo,
  createOwner,
  mapArray,
  repeat,
  createErrorBoundary,
  getContext,
  getOwner,
  getNextChildId,
  runWithOwner,
  setContext
} from "./signals.js";
import { createLoadingBoundary, RevealGroupContext } from "./hydration.js";
import { sharedConfig } from "./shared.js";
import type { Accessor, RevealOrder } from "./signals.js";
import type { JSX } from "../jsx.js";
export type { RevealOrder };

type NonZeroParams<T extends (...args: any[]) => any> = Parameters<T>["length"] extends 0
  ? never
  : T;
type ConditionalRenderCallback<T> = (item: Accessor<NonNullable<T>>) => JSX.Element;
type ConditionalRenderChildren<
  T,
  F extends ConditionalRenderCallback<T> = ConditionalRenderCallback<T>
> = JSX.Element | NonZeroParams<F>;

/**
 * Creates a list of elements from a list
 *
 * @description https://docs.solidjs.com/reference/components/for
 */
export function For<T extends readonly any[], U extends JSX.Element>(props: {
  each: T | undefined | null | false;
  fallback?: JSX.Element;
  keyed?: boolean | ((item: T[number]) => any);
  children: (item: Accessor<T[number]>, index: Accessor<number>) => U;
}) {
  const options =
    "fallback" in props
      ? { keyed: props.keyed, fallback: () => props.fallback }
      : { keyed: props.keyed };
  return mapArray(() => props.each, props.children, options) as unknown as JSX.Element;
}

/**
 * Creates a list elements from a count
 *
 * @description https://docs.solidjs.com/reference/components/repeat
 */
export function Repeat<T extends JSX.Element>(props: {
  count: number;
  from?: number | undefined;
  fallback?: JSX.Element;
  children: ((index: number) => T) | T;
}) {
  const options: { fallback?: Accessor<JSX.Element>; from?: Accessor<number | undefined> } =
    "fallback" in props ? { fallback: () => props.fallback } : {};
  options.from = () => props.from;
  return repeat(
    () => props.count,
    index => (typeof props.children === "function" ? props.children(index) : props.children),
    options
  ) as unknown as JSX.Element;
}

/**
 * Conditionally render its children or an optional fallback component
 * @description https://docs.solidjs.com/reference/components/show
 */
export function Show<T, F extends ConditionalRenderCallback<T>>(props: {
  when: T | undefined | null | false;
  keyed?: boolean;
  fallback?: JSX.Element;
  children: ConditionalRenderChildren<T, F>;
}): JSX.Element {
  const o = getOwner();
  if (o?.id != null) {
    getNextChildId(o); // match client's conditionValue memo
    if (!props.keyed) getNextChildId(o); // match client's condition memo (non-keyed only)
  }
  return createMemo(() => {
    const when = props.when;
    if (when) {
      const child = props.children;
      if (typeof child === "function" && child.length > 0) {
        return (child as any)(() => when as NonNullable<T>);
      }
      return child as JSX.Element;
    }
    return props.fallback as JSX.Element;
  }) as unknown as JSX.Element;
}

type EvalConditions = readonly [number, unknown, MatchProps<unknown>];

/**
 * Switches between content based on mutually exclusive conditions
 * @description https://docs.solidjs.com/reference/components/switch-and-match
 */
export function Switch(props: { fallback?: JSX.Element; children: JSX.Element }): JSX.Element {
  const chs = children(() => props.children);
  const o = getOwner();
  if (o?.id != null) getNextChildId(o); // advance ID counter

  return createMemo(() => {
    let conds: MatchProps<unknown> | MatchProps<unknown>[] = chs() as any;
    if (!Array.isArray(conds)) conds = [conds];

    for (let i = 0; i < conds.length; i++) {
      const w = conds[i].when;
      if (w) {
        const c = conds[i].children;
        return typeof c === "function" && c.length > 0 ? (c as any)(() => w) : c;
      }
    }
    return props.fallback;
  }) as unknown as JSX.Element;
}

export type MatchProps<T, F extends ConditionalRenderCallback<T> = ConditionalRenderCallback<T>> = {
  when: T | undefined | null | false;
  keyed?: boolean;
  children: ConditionalRenderChildren<T, F>;
};

/**
 * Selects a content based on condition when inside a `<Switch>` control flow
 * @description https://docs.solidjs.com/reference/components/switch-and-match
 */
export function Match<T, F extends ConditionalRenderCallback<T>>(props: MatchProps<T, F>) {
  return props as unknown as JSX.Element;
}

/**
 * Catches uncaught errors inside components and renders a fallback content
 * @description https://docs.solidjs.com/reference/components/error-boundary
 */
export function Errored(props: {
  fallback: JSX.Element | ((err: any, reset: () => void) => JSX.Element);
  children: JSX.Element;
}): JSX.Element {
  return createErrorBoundary(
    () => props.children,
    (err, reset) => {
      const f = props.fallback;
      return typeof f === "function" && f.length ? f(err, reset) : f;
    }
  ) as unknown as JSX.Element;
}

/**
 * Tracks all resources inside a component and renders a fallback until they are all resolved
 * @description https://docs.solidjs.com/reference/components/suspense
 */
export function Loading(props: {
  fallback?: JSX.Element;
  on?: any;
  children: JSX.Element;
}): JSX.Element {
  return createLoadingBoundary(
    () => props.children,
    () => props.fallback
  ) as unknown as JSX.Element;
}

export type RevealProps = {
  order?: RevealOrder;
  collapsed?: boolean;
  children: JSX.Element;
};

/**
 * Coordinates the reveal timing of sibling `<Loading>` boundaries during SSR.
 *
 * The `order` prop picks the reveal policy:
 * - `"sequential"` (default) — boundaries reveal in streamed order; out-of-order
 *   resolutions have their fragment HTML streamed into templates as data arrives,
 *   but the swap from fallback to content waits until the frontier reaches them.
 * - `"together"` — every direct slot holds its fallback until the whole group is
 *   "minimally ready" (every direct slot has its own first visible content
 *   available), then the whole group releases in a single activation.
 * - `"natural"` — each boundary's swap is triggered as its own data resolves. At
 *   the top level this is equivalent to omitting `<Reveal>`; the mode exists for
 *   nesting, where the group registers as a single composite slot in an enclosing
 *   `<Reveal>`.
 *
 * The `collapsed` prop is only consulted when `order="sequential"` (the default);
 * it is ignored under `"together"` and `"natural"`.
 *
 * Nesting: a nested `<Reveal>` is held on its fallbacks until its parent releases
 * the slot it occupies. HTML for resolved fragments still streams through normally;
 * only the `revealFragments` swap calls are deferred. Once released, the inner
 * group runs its own `order` locally over whatever is still pending. There is no
 * escape hatch.
 *
 * Engine support:
 * - `renderToString` fully supports `order="sequential"` (without `collapsed`) and
 *   `order="natural"` because neither requires streamed activation.
 * - `order="together"` and `collapsed` rely on streamed activation and require
 *   `renderToStream` / `renderToStringAsync`. Using them inside a nested `<Reveal>`
 *   under `renderToString` logs a warning.
 *
 * See `documentation/solid-2.0/03-control-flow.md` for the full outer/inner
 * nesting matrix and the "minimally ready" definition per order.
 *
 * @description https://docs.solidjs.com/reference/components/reveal
 */
export function Reveal(props: RevealProps): JSX.Element {
  const o = createOwner();
  const id = o.id!;
  const order: RevealOrder = props.order ?? "sequential";
  const collapsed = order === "sequential" && !!props.collapsed;

  if (!sharedConfig.context?.async) {
    const parent = getOwner();
    const parentGroup = parent ? runWithOwner(parent, () => getContext(RevealGroupContext)) : null;
    let collapsedByParent = false;
    if (parentGroup) {
      const reg = parentGroup.register(id);
      collapsedByParent = reg.collapseFallback;
      // Natural has no coordination requirement — it degrades cleanly to sync rendering.
      if (order === "together" || collapsed)
        console.warn(
          "Nested <Reveal> with collapsed/together won't coordinate correctly with renderToString. Use renderToStream for full support."
        );
    }
    let count = 0;
    return runWithOwner(o, () => {
      setContext(RevealGroupContext, {
        id,
        register(_key: string) {
          count++;
          const collapseFallback =
            collapsedByParent || (order === "sequential" && collapsed && count > 1);
          return { collapseFallback, held: false };
        },
        onResolved() {}
      });
      return props.children;
    }) as unknown as JSX.Element;
  }

  const ctx = sharedConfig.context;
  const keys: string[] = [];
  const resolved = new Set<string>();
  const minimallyResolved = new Set<string>();
  const composites = new Map<string, () => void>();
  const activated = new Set<string>();
  const stash: string[] = [];
  // Leaf children rendered with a collapsed fallback template. When the group is
  // released from a parent's hold, these need revealFallbacks to become visible.
  const collapsedLeafKeys: string[] = [];
  let frontier = 0;
  let heldByParent = false;
  let collapsedByParent = false;
  let selfMinimallyResolved = false;
  let notifiedParentDone = false;

  const parent = getOwner();
  const parentGroup = parent ? runWithOwner(parent, () => getContext(RevealGroupContext)) : null;

  if (parentGroup) {
    const reg = parentGroup.register(id, {
      onActivate: () => {
        if (!heldByParent) return;
        heldByParent = false;
        // If we were collapsed by the outer, uncollapse our own leaf children now
        // so their fallbacks become visible under our own order. Nested composite
        // children cascade through their own onActivate.
        if (collapsedByParent) {
          collapsedByParent = false;
          if (collapsedLeafKeys.length) {
            ctx.revealFallbacks?.([...collapsedLeafKeys]);
            collapsedLeafKeys.length = 0;
          }
        }
        // Resume our own order.
        if (order === "sequential") advanceFrontier();
        else if (order === "together") checkTogetherRelease();
        else naturalRelease();
      }
    });
    collapsedByParent = reg.collapseFallback;
    heldByParent = reg.held;
  }

  function notifyParentIfDone() {
    if (notifiedParentDone) return;
    if (parentGroup && resolved.size === keys.length) {
      notifiedParentDone = true;
      parentGroup.onResolved(id);
    }
  }

  function activateComposite(key: string) {
    if (activated.has(key)) return;
    activated.add(key);
    composites.get(key)!();
  }

  function updateSelfMinimallyResolved() {
    if (selfMinimallyResolved) return;
    if (keys.length === 0) selfMinimallyResolved = true;
    else if (order === "together") selfMinimallyResolved = minimallyResolved.size === keys.length;
    else if (order === "sequential") selfMinimallyResolved = minimallyResolved.has(keys[0]);
    // natural: any child being visible counts. Leaves: resolved == minimally ready;
    // composites: natural holds them until fully ready, so `resolved` is the right
    // signal for both.
    else selfMinimallyResolved = resolved.size > 0;
    if (selfMinimallyResolved) parentGroup?.onMinimallyResolved?.(id);
  }

  function advanceFrontier() {
    if (heldByParent) return;
    while (frontier < keys.length && resolved.has(keys[frontier])) {
      const k = keys[frontier];
      // A composite that we're walking past must be activated so it drains its
      // own stash (the inner subtree's stashed swaps).
      if (composites.has(k)) activateComposite(k);
      else ctx.revealFragments?.([k]);
      frontier++;
    }
    if (frontier < keys.length) {
      const k = keys[frontier];
      if (composites.has(k)) activateComposite(k);
      else if (order === "sequential" && collapsed) ctx.revealFallbacks?.([k]);
    }
    notifyParentIfDone();
  }

  function checkTogetherRelease() {
    if (order !== "together" || heldByParent) return;
    if (minimallyResolved.size < keys.length) return;
    // All direct slots minimally ready: drain stashed leaf swaps and cascade
    // into every inner composite (they're minimally ready too, so this releases
    // their own stashes in one pass).
    if (stash.length) {
      ctx.revealFragments?.([...stash]);
      stash.length = 0;
    }
    composites.forEach((_, key) => activateComposite(key));
    notifyParentIfDone();
  }

  function naturalRelease() {
    // Called when a natural group is released by its parent. Flush any leaves
    // that resolved while held (they're in `stash`), then release every
    // composite child to run its own order locally — matches the client spec
    // where natural does not hold composites back. `activateComposite` is
    // idempotent, and each inner's own order governs when its leaves reveal.
    if (stash.length) {
      ctx.revealFragments?.([...stash]);
      stash.length = 0;
    }
    composites.forEach((_, key) => activateComposite(key));
    notifyParentIfDone();
  }

  return runWithOwner(o, () => {
    setContext(RevealGroupContext, {
      id,
      register(key: string, options?: { onActivate?: () => void }) {
        keys.push(key);
        const isComposite = !!options?.onActivate;
        if (isComposite) composites.set(key, options!.onActivate!);
        const selfCollapse = order === "sequential" && collapsed && keys.length > 1;
        const collapseFallback = collapsedByParent || selfCollapse;
        // Track leaf keys that render collapsed so we can emit revealFallbacks
        // when our group is released by a parent hold.
        if (collapseFallback && !isComposite) collapsedLeafKeys.push(key);
        // Held: stash this child's own `revealFragments` calls until we activate
        // it. Only meaningful for nested Reveals (composites); Loadings ignore
        // `held`, since their swap is orchestrated by us anyway. We mark held
        // when our own order won't let this child reveal live.
        //   - together: hold every direct child.
        //   - sequential: frontier-0 reveals live; the tail waits.
        //   - natural: every child reveals live per its own policy (matches
        //     the client spec that releases nested composites immediately).
        let held = heldByParent;
        if (!held) {
          if (order === "together") held = true;
          else if (order === "sequential" && keys.length > 1) held = true;
        }
        return { collapseFallback, held };
      },
      onResolved(key: string) {
        resolved.add(key);
        const isLeaf = !composites.has(key);
        if (isLeaf) {
          // Queue the leaf's swap BEFORE marking minimally resolved, so any
          // release triggered by markMinimallyResolved sees it in the stash.
          if (order === "together") {
            // Together holds every direct child until the whole group releases.
            stash.push(key);
          } else if (order === "natural" && heldByParent) {
            // Natural reveals leaves live, but we're held by a parent — stash
            // until naturalRelease() drains it.
            stash.push(key);
          } else if (order === "natural") {
            ctx.revealFragments?.([key]);
          }
          // sequential: no stash needed — advanceFrontier re-reads `resolved`
          // when we're released (if held) or runs inline below.
          markMinimallyResolved(key);
          if (order === "sequential" && !heldByParent) advanceFrontier();
          if (order === "natural") updateSelfMinimallyResolved();
        } else {
          // Composite fully resolved.
          if (!heldByParent) {
            if (order === "sequential") advanceFrontier();
            else if (order === "natural") activateComposite(key);
            // together: checkTogetherRelease below cascades all composites at once.
          }
          if (order === "together") checkTogetherRelease();
          if (order === "natural") updateSelfMinimallyResolved();
        }
        notifyParentIfDone();
      },
      onMinimallyResolved(key: string) {
        markMinimallyResolved(key);
      }
    });
    const result = props.children;
    if (parentGroup && keys.length === 0) {
      parentGroup.onResolved(id);
    }
    return result;
  }) as unknown as JSX.Element;

  function markMinimallyResolved(key: string) {
    if (minimallyResolved.has(key)) return;
    minimallyResolved.add(key);
    updateSelfMinimallyResolved();
    if (order === "together") checkTogetherRelease();
  }
}
