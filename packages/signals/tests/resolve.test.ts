/**
 * Pins `resolve()`'s settlement contract (#2842).
 *
 * `resolve(fn)` must settle for every terminal state of the expression:
 *   - resolves with the first fully-settled value (async or sync)
 *   - rejects with the original error when the async source rejects after
 *     having been pending
 *   - rejects when the expression throws synchronously
 * and it must dispose its internal root in all of those cases — a rejection
 * that leaves the promise forever-pending also leaks the root (#2842).
 */
import { describe, expect, it, vi } from "vitest";
import { createMemo, createRoot, createSignal, onCleanup, resolve } from "../src/index.js";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("resolve settlement (#2842)", () => {
  it("rejects with the original error when the async source rejects after pending", async () => {
    const boom = new Error("boom");
    await createRoot(async dispose => {
      const m = createMemo(async () => {
        await delay(5);
        throw boom;
      });

      await expect(resolve(() => m())).rejects.toBe(boom);
      dispose();
    });
  });

  it("disposes its internal root when the source rejects", async () => {
    const cleanupSpy = vi.fn();
    await createRoot(async dispose => {
      const m = createMemo(async () => {
        await delay(5);
        throw new Error("boom");
      });

      await resolve(() => {
        onCleanup(cleanupSpy);
        return m();
      }).catch(() => {});

      expect(cleanupSpy).toHaveBeenCalled();
      dispose();
    });
  });

  it("still resolves with the settled value when the source resolves", async () => {
    await createRoot(async dispose => {
      const [s] = createSignal(7);
      const m = createMemo(async () => {
        await delay(5);
        return s() * 2;
      });

      await expect(resolve(() => m())).resolves.toBe(14);
      dispose();
    });
  });

  it("rejects when the expression throws synchronously", async () => {
    const boom = new Error("sync-boom");
    await createRoot(async dispose => {
      await expect(
        resolve(() => {
          throw boom;
        })
      ).rejects.toBe(boom);
      dispose();
    });
  });
});
