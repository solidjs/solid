import { createMemo, createRenderEffect, getOwner } from "solid-js";

// Replaced with a boolean literal by the build (see rollup.config.js); the cast
// keeps the typed module honest about it being a build-time flag.
const IS_DEV = "_SOLID_DEV_" as unknown as boolean;

const transparentOptions = { transparent: true, sync: true };
const syncOptions = { sync: true };

// Dev: the binding effect whose callback is currently writing the DOM. The
// DOM helpers (setAttribute, insertExpression, …) tag it with the element they
// touch, so a diagnostic about that effect can print a live element reference
// beside its message — hover highlights it, click jumps to Elements.
let bindingEffect: { _devElement?: Node } | null = null;

/** Dev: remember the element the running binding effect writes (first one wins). */
export function tagElement(node: Node): void {
  if (IS_DEV && bindingEffect !== null && bindingEffect._devElement === undefined)
    bindingEffect._devElement = node;
}

// `scope: true` (set by insert for compiler-tagged hole accessors) makes the
// render effect non-transparent so the hole gets its own id scope, mirroring
// the server's ssrScope owner.
export function effect<T>(
  fn: (prev?: T) => T,
  effectFn: (value: T, prev?: T) => void | (() => void),
  options?: { scope?: boolean }
): void {
  const nodeOptions = options
    ? { sync: true, ...options, transparent: !options.scope }
    : transparentOptions;
  if (IS_DEV) {
    // The compute half runs as the effect node's owner; capture it there and
    // surround the imperative half with it for tagElement.
    let node: { _devElement?: Node } | null = null;
    createRenderEffect(
      (prev?: T) => {
        node = getOwner() as typeof node;
        return fn(prev);
      },
      (value: T, prev?: T) => {
        const outer = bindingEffect;
        bindingEffect = node;
        try {
          // The callback's return (a cleanup) must pass through untouched.
          return effectFn(value, prev);
        } finally {
          bindingEffect = outer;
        }
      },
      nodeOptions
    );
    return;
  }
  createRenderEffect(fn, effectFn, nodeOptions);
}

// NOT transparent, despite the temptation (#3033): the compiler emits
// `_$memo` in two roles, and one is id-load-bearing. Besides pure condition
// memos (`() => !!cond`), the ssr generate wraps whole hole bodies in
// `_$memo` — the compute CREATES the branch's templates (`ssrHydrationKey()`
// mints inside it), so the memo's id slot is the retry-stable scope a
// deferred hole re-runs under. Making it transparent leaks the branch keys
// onto the parent's live counter and breaks async-hole parity (pinned by the
// async-cond-before-for harness scenario).
export function memo<T>(fn: () => T): () => T {
  return createMemo(() => fn(), syncOptions);
}
