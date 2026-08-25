import { describe, expect, test } from "vitest";
import {
  createMemo,
  createSignal,
  createRoot,
  createRenderEffect,
  createErrorBoundary,
  flush,
  isPending
} from "../src/index.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// #2987: a NotReadyError REJECTION (vs a sync throw) is treated as pending,
// retried by the settle sweep over the source's subscribers. That retry
// requires the dependency edge a tracked read creates — a source FIRST read
// after an `await` is untracked, has no edge, and would stay "pending"
// forever (with isPending reading false, and its Loading boundary hung).
// Dev builds fail loud instead; these tests run against the dev build.
describe("untracked async read after await (#2987)", () => {
  test("post-await first-read of an unready source errors instead of wedging", async () => {
    await createRoot(async () => {
      const m = createMemo(async () => {
        await sleep(15);
        return "m-value";
      });

      const [s] = createSignal<Promise<number>, number>(async () => {
        await Promise.resolve();
        m(); // first-ever read of m — untracked, m still loading
        return 42;
      });

      const seen: any[] = [];
      let caught: Error | undefined;
      const guarded = createErrorBoundary(
        () => s(),
        err => {
          caught = err() as Error;
          return "errored";
        }
      );
      createRenderEffect(
        () => guarded(),
        (v: any) => {
          seen.push(v);
        }
      );
      flush();

      await sleep(40);
      flush();
      await sleep(10);
      flush();

      // The boundary caught a descriptive error — no eternal fallback.
      expect(seen).toContain("errored");
      expect(caught?.message).toMatch(/after an `await`/);
      expect(isPending(s)).toBe(false);
    });
  });

  test("memo form errors identically", async () => {
    await createRoot(async () => {
      const m = createMemo(async () => {
        await sleep(15);
        return "m-value";
      });

      const s = createMemo(async () => {
        await Promise.resolve();
        m();
        return 42;
      });

      let caught: Error | undefined;
      const guarded = createErrorBoundary(
        () => s(),
        err => {
          caught = err() as Error;
          return "errored";
        }
      );
      const seen: any[] = [];
      createRenderEffect(
        () => guarded(),
        (v: any) => {
          seen.push(v);
        }
      );
      flush();

      await sleep(40);
      flush();
      await sleep(10);
      flush();

      expect(seen).toContain("errored");
      expect(caught?.message).toMatch(/after an `await`/);
    });
  });

  test("post-await re-read of a source tracked before the await still retries", async () => {
    await createRoot(async () => {
      const m = createMemo(async () => {
        await sleep(15);
        return "m-value";
      });

      const s = createMemo(async () => {
        const sync = m(); // tracked — rejects run 1 with NotReady, edge exists for the retry
        await Promise.resolve();
        return `s-saw:${sync}`;
      });

      const seen: any[] = [];
      const guarded = createErrorBoundary(
        () => s(),
        () => "errored"
      );
      createRenderEffect(
        () => guarded(),
        (v: any) => {
          seen.push(v);
        }
      );
      flush();

      await sleep(40);
      flush();
      await sleep(10);
      flush();

      // The rejection-pending retried when m settled — no error, real value.
      expect(seen).toContain("s-saw:m-value");
      expect(seen).not.toContain("errored");
    });
  });
});
