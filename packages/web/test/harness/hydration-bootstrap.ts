/**
 * The `_$HY` global as the real bootstrap installs it
 * (`generateHydrationScript()` / `<HydrationScript />` in src/server.ts), for
 * hydrate specs that replay server output without running the bootstrap.
 *
 * What a plain `{ r: {} }` stub misses: since #3769 `r` is a Proxy that
 * attaches a no-op catch to every promise filed under it, so a record the
 * client reads only later (a memo created when a boundary resumes, or a
 * client bundle that runs after the inline scripts) does not raise
 * `unhandledrejection` when the stream rejects it first. A consumer still
 * meets the rejection.
 */
export function bootstrapHydrationGlobal(): any {
  return ((globalThis as any)._$HY = {
    events: [],
    completed: new WeakSet(),
    r: new Proxy({} as Record<string, unknown>, {
      set: (r, k, v) => (v instanceof Promise && v.catch(() => {}), (r[k as string] = v), true)
    }),
    fe() {}
  });
}
