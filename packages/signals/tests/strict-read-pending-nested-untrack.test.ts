import { describe, expect, it } from "vitest";
import { createMemo, createRoot, createSignal, flush, untrack } from "../src/index.js";
import { NotReadyError } from "../src/core/error.js";

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * A plain `untrack(fn)` inside a component body keeps the body's label for
 * the pending-read check. Without it, a body that creates an async memo and
 * reads it through `untrack` threw NotReady to its `<Loading>`, which re-ran
 * the body onto a fresh pending memo forever (a frozen page in TanStack
 * Form's port). Only a memo the same body created trips it: one created
 * outside keeps NotReady (D-23), and a sync untracked read stays quiet.
 */
describe("untrack inside a strict-read scope", () => {
  it("a pending async read through a nested plain untrack throws the dev error", async () => {
    createRoot(() => {
      untrack(() => {
        const a = createMemo(async () => {
          await wait(10);
          return 2;
        });
        expect(() => untrack(() => a())).toThrow("[PENDING_ASYNC_UNTRACKED_READ]");
        expect(() => untrack(() => untrack(() => a()))).toThrow("[PENDING_ASYNC_UNTRACKED_READ]");
      }, "<Page>");
    });
    await wait(20);
    flush();
  });

  it("a memo created outside the body keeps NotReady through untrack (D-23)", async () => {
    let a!: () => number;
    createRoot(() => {
      a = createMemo(async () => {
        await wait(10);
        return 2;
      });
    });
    createRoot(() => {
      untrack(() => {
        let caught: unknown;
        try {
          untrack(() => a());
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(NotReadyError);
      }, "<Page>");
    });
    await wait(20);
    flush();
  });

  it("an explicit untrack(fn, false) opts out: NotReady, as outside a body", async () => {
    createRoot(() => {
      untrack(() => {
        const a = createMemo(async () => {
          await wait(10);
          return 2;
        });
        let caught: unknown;
        try {
          untrack(() => a(), false);
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(NotReadyError);
      }, "<Page>");
    });
    await wait(20);
    flush();
  });

  it("a sync untracked read and a settled async read stay quiet", async () => {
    let a!: () => number;
    createRoot(() => {
      a = createMemo(async () => {
        await wait(5);
        return 2;
      });
    });
    await wait(20);
    flush();
    const [s] = createSignal(1);
    createRoot(() => {
      untrack(() => {
        expect(untrack(() => s())).toBe(1);
        expect(untrack(() => a())).toBe(2);
      }, "<Page>");
    });
  });

  it("a computation created under the nested untrack does not inherit the label", async () => {
    createRoot(() => {
      untrack(() => {
        const a = createMemo(async () => {
          await wait(10);
          return 2;
        });
        untrack(() => {
          // b's compute reads pending `a`: an ordinary pending read inside a
          // computation (NotReady), never the body's dev error.
          let seen: unknown;
          const b = createMemo(() => {
            try {
              return a() + 1;
            } catch (e) {
              seen = e;
              throw e;
            }
          });
          // Reading `b` itself here is a pending read in the body: dev error.
          expect(() => b()).toThrow("[PENDING_ASYNC_UNTRACKED_READ]");
          expect(seen).toBeInstanceOf(NotReadyError);
        });
      }, "<Page>");
    });
    await wait(20);
    flush();
  });
});
