import { createRoot, getOwner } from "../../src/server/index.js";

/**
 * Runs `fn` in a root claimed for `context` the way `@solidjs/web`'s
 * renderers claim theirs: the root owner → the render's context in the
 * process-wide table under `Symbol.for("@solidjs/web/render-roots")`. Calls
 * made outside a render pass — `lazy()`'s `preload()` and `moduleUrl` —
 * resolve their render through it from the caller's owner, never from the
 * global `sharedConfig.context`.
 */
export function inClaimedRender<T>(context: object, fn: () => T): T {
  const g = globalThis as any;
  const key = Symbol.for("@solidjs/web/render-roots");
  const roots: WeakMap<object, object> = g[key] || (g[key] = new WeakMap());
  return createRoot(dispose => {
    const owner = getOwner()!;
    roots.set(owner, context);
    try {
      return fn();
    } finally {
      roots.delete(owner);
      dispose();
    }
  });
}
