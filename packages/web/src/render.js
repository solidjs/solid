import { createMemo, createRenderEffect } from "solid-js";

const transparentOptions = { transparent: true, sync: true };
const syncOptions = { sync: true };

// `scope: true` (set by insert for compiler-tagged hole accessors) makes the
// render effect non-transparent so the hole gets its own id scope, mirroring
// the server's ssrScope owner.
export const effect = (fn, effectFn, options) =>
  createRenderEffect(
    fn,
    effectFn,
    options ? { sync: true, ...options, transparent: !options.scope } : transparentOptions
  );

// NOT transparent, despite the temptation (#3033): the compiler emits
// `_$memo` in two roles, and one is id-load-bearing. Besides pure condition
// memos (`() => !!cond`), the ssr generate wraps whole hole bodies in
// `_$memo` — the compute CREATES the branch's templates (`ssrHydrationKey()`
// mints inside it), so the memo's id slot is the retry-stable scope a
// deferred hole re-runs under. Making it transparent leaks the branch keys
// onto the parent's live counter and breaks async-hole parity (pinned by the
// async-cond-before-for harness scenario).
export const memo = fn => createMemo(() => fn(), syncOptions);
