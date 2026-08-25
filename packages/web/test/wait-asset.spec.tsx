/**
 * `waitAsset` client CSS reveal-gate contract
 * (docs/client-css-reveal-gating.md): a compute reading an unsettled asset
 * promise is held not-ready and retries when the promise settles; settled
 * this while the asset registry reports the promise pending, and the
 * registry's loadPromise resolves on load OR error — it never rejects.
 *
 * Two structural requirements from the design doc's implementation notes:
 * the gate node lives outside the calling compute (a node owned by the
 * computing owner would be disposed by the very retry it triggers), and it
 * must never consume a hydration id from the calling owner chain (server
 * useHead creates zero owners, so any client consumption desyncs every id
 * allocated after the call).
 */
import { describe, expect, test } from "vitest";
import { createRoot, createOwner, runWithOwner, getNextChildId, flush } from "solid-js";
import { effect } from "../src/render.js";
import { waitAsset } from "../src/client.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  // promise resolution → async node write → reactive flush
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

describe("waitAsset", () => {
  test("holds the apply until the promise settles, then retries", async () => {
    const { promise, resolve } = deferred();
    let applied = 0;
    createRoot(() => {
      effect(
        () => waitAsset(promise),
        () => {
          applied++;
        }
      );
    });
    flush();
    expect(applied).toBe(0);

    resolve();
    await settle();
    expect(applied).toBe(1);
  });

  test("shares one gate across readers and passes through once settled", async () => {
    const { promise, resolve } = deferred();
    let a = 0;
    let b = 0;
    createRoot(() => {
      effect(
        () => waitAsset(promise),
        () => {
          a++;
        }
      );
    });
    resolve();
    await settle();
    expect(a).toBe(1);

    // A reader arriving after settle applies in the same flush — no retry
    // turn, no extra frames.
    createRoot(() => {
      effect(
        () => waitAsset(promise),
        () => {
          b++;
        }
      );
    });
    flush();
    expect(b).toBe(1);
  });

  test("a gated branch disposed before settle never applies", async () => {
    const { promise, resolve } = deferred();
    let applied = 0;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      effect(
        () => waitAsset(promise),
        () => {
          applied++;
        }
      );
    });
    flush();
    dispose();

    resolve();
    await settle();
    // The cancelled apply stays cancelled (the runtime relies on this: a
    // superseded branch must never acquire its stylesheet).
    expect(applied).toBe(0);
  });

  test("consumes no hydration id slots from the calling owner chain", async () => {
    const { promise, resolve } = deferred();
    let owner!: ReturnType<typeof createOwner>;
    createRoot(() => {
      owner = createOwner({ id: "h" });
      runWithOwner(owner, () => {
        expect(getNextChildId(owner)).toBe("h0");
        effect(
          () => waitAsset(promise),
          () => {}
        );
        // Gate creation (detached) and the blocked compute consumed nothing:
        // the counter is consecutive.
        expect(getNextChildId(owner)).toBe("h1");
      });
    });
    flush();

    resolve();
    await settle();
    // The settle retry consumed nothing either.
    expect(getNextChildId(owner)).toBe("h2");
  });
});
