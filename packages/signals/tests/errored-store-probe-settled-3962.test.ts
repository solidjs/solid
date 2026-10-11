// #3962: a reader re-queued by a derived store's rejection does not see the
// errored store as settled (the #3954 mark it describes is gone; #3945 is
// fixed by skipping errored readers at a landing).
import { expect, it } from "vitest";
import {
  createEffect,
  createErrorBoundary,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending
} from "../src/index.js";
const drain = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
it("a reader re-queued by a derived store's rejection does not see it as settled", async () => {
  const inflight: PromiseWithResolvers<{ items: string[] }>[] = [];
  const [page, setPage] = createSignal(1);
  const [todos] = createStore(
    async () => {
      page();
      const d = Promise.withResolvers<{ items: string[] }>();
      inflight.push(d);
      return d.promise;
    },
    { items: [] as string[] }
  );
  const settled: boolean[] = [];
  const dispose = createRoot(d => {
    // "Has the store settled content?" — read inside isPending.
    createEffect(
      () => {
        let read = false;
        const pending = isPending(() => {
          void todos.items;
          read = true;
        });
        return !pending && read;
      },
      v => {
        settled.push(v);
      }
    );
    // The rows, behind an error boundary.
    const rows = createErrorBoundary(
      () => todos.items.join(","),
      () => "error"
    );
    createRenderEffect(rows, () => {});
    return d;
  });

  flush();
  inflight[0].resolve({ items: ["page 1"] });
  await drain(); // six rounds of setTimeout(0) + flush()
  expect(settled.at(-1)).toBe(true);

  setPage(2);
  flush();
  await drain();
  expect(settled.at(-1)).toBe(false);
  const before = settled.length;
  inflight[1].reject(new Error("page 2 unavailable"));
  await drain();
  // Page 2 has no content: the store is errored, not settled with page 1's.
  expect(settled.slice(before)).not.toContain(true); // next: [true]
  dispose();
});
