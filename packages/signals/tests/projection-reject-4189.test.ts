/**
 * #4189: a projection whose settling code writes a signal the derive reads
 * just before its promise rejects. The re-run derive throws synchronously,
 * replacing the still-pending flight; that error must still reach the error
 * boundary when the projection is read in a nested computation under a
 * loading boundary (what `insert` emits).
 */
import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

function source() {
  const [version, setVersion] = createSignal(0, { ownedWrite: true });
  const entry = {
    loading: false,
    error: undefined as Error | undefined,
    promise: undefined as Promise<unknown> | undefined
  };
  const load = () => {
    entry.loading = true;
    entry.promise = Promise.resolve().then(() => {
      entry.loading = false;
      entry.error = new Error("failed");
      setVersion(v => v + 1); // the cache event, before the promise rejects
      throw entry.error;
    });
    setVersion(v => v + 1); // the fetch-start event, inside the derive
    return entry.promise;
  };
  let chained: { base: Promise<unknown>; value: Promise<{ value: unknown }> } | undefined;
  const stable = (base: Promise<unknown>) =>
    chained?.base === base
      ? chained.value
      : (chained = { base, value: base.then(value => ({ value })) }).value;
  const store = createProjection<{ value?: unknown }>(() => {
    version();
    if (entry.loading) return stable(entry.promise!);
    if (entry.error) throw entry.error;
    return stable(load());
  }, {});
  return () => store.value;
}

for (const read of ["direct", "nested"] as const) {
  it(`#4189: a projection's sync throw replacing its flight reaches the error boundary (${read} read)`, async () => {
    const screen = { value: undefined as unknown };
    const dispose = createRoot(d => {
      const value = source();
      const errored = createErrorBoundary(
        () =>
          untrack(() =>
            createLoadingBoundary(
              () => {
                if (read === "direct") return String(value());
                const span = { text: undefined as unknown };
                createRenderEffect(
                  () => String(value()),
                  v => void (span.text = v)
                );
                return span;
              },
              () => "loading"
            )
          ),
        (e: () => any) => `errored: ${e().message}`
      );
      createRenderEffect(errored, v => void (screen.value = v));
      return d;
    });
    try {
      flush();
      await new Promise(r => setTimeout(r, 20));
      flush();
      expect(screen.value).toBe("errored: failed");
    } finally {
      dispose();
      flush();
    }
  });
}
