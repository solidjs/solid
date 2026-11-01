import { createMemo, createRenderEffect, getOwner } from "solid-js";

// Replaced with a boolean literal by the build (see rollup.config.js); the cast
// keeps the typed module honest about it being a build-time flag.
const IS_DEV = "_SOLID_DEV_" as unknown as boolean;
const IS_OBSERVE = "_SOLID_OBSERVE_" as unknown as boolean;

const transparentOptions = { transparent: true, sync: true };

// Observe/dev: the element tag a `spread` is being applied for, while its
// body runs (`spread` sets it, see client.ts). The effects and inserts the
// body creates take their labels from it — `<tag>.spread` for the attribute
// effect, `<tag>.children` for the children insert — instead of `spread`
// passing an options argument to each of its call sites, which would leave a
// trailing `undefined` argument in the production artifact. Synchronous:
// `spread` creates its nodes before it returns and restores the outer value.
export let spreadName: string | undefined;
// Its source site, carried the same way (`loc` on the nodes the body creates).
export let spreadLoc: string | undefined;
export function setSpreadName(name: string | undefined, loc?: string): void {
  spreadName = name;
  spreadLoc = loc;
}
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
// the server's ssrScope owner. `name` is the binding's target as the
// compiler wrote it under `sourceNames.bindings` (`span.textContent`,
// `div.class:active`) and `loc` its source site (`src/App.tsx:14:7`, the
// `locations` kind); the dev and observe runtimes carry both on the effect
// node (the options spread straight into the node's), production ignores
// them.
export function effect<T>(
  fn: (prev?: T) => T,
  effectFn: (value: T, prev?: T) => void | (() => void),
  options?: { scope?: boolean; name?: string; loc?: string }
): void {
  if (
    IS_OBSERVE &&
    spreadName !== undefined &&
    (options === undefined || options.name === undefined)
  )
    options = { ...options, name: spreadName + ".spread", loc: spreadLoc };
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
  if (collector !== null && getOwner() === collector) return fn;
  return createMemo(() => fn(), syncOptions);
}

// The spread effect collecting its props right now (client.ts `spread`), set
// outside hydration only. A condition memo created directly under it — a
// compiled getter's `memo(() => !!cond)()` — would be rebuilt on every rerun,
// and the effect already reruns every getter, so it resolves inline instead.
let collector: unknown = null;
export function setCollector(owner: unknown): unknown {
  const outer = collector;
  collector = owner;
  return outer;
}
