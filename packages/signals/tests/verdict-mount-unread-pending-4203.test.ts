/**
 * #4203: #4166 carries a verdict lane's mount through nested first passes,
 * so a render effect its content creates is held like a direct read. A
 * plain memo the content creates is not a render effect: one that reads a
 * signal the mount wrote (a staging) and never settles, with no reader,
 * holds nothing and reaches no boundary (Reader). Before, it was held, so
 * `<Show when={latest(gate) ?? gate()}><Loading>…` never revealed. A memo
 * that settles is still held like #4166's render effect.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack
} from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

describe("#4203: an unread pending memo does not hold a verdict-mounted boundary", () => {
  it("the boundary reveals its content", async () => {
    let slot: unknown;
    createRoot(() => {
      const content = () => {
        const [version, setVersion] = createSignal(0, { ownedWrite: true });
        setVersion(1);
        // Never read; never settles.
        createMemo(() => {
          version();
          return new Promise(() => {});
        });
        return "CHILD";
      };
      const gate = createMemo(async () => "x");
      const outer = createLoadingBoundary(
        () => {
          // <Show when={latest(gate) ?? gate()}>
          const when = createMemo(() => latest(gate) ?? gate());
          const condition = createMemo(() => !!when());
          const children = createMemo(() =>
            condition()
              ? untrack(() => createLoadingBoundary(content, () => "INNER LOADING"))
              : undefined
          );
          return () => {
            const c = children();
            return typeof c === "function" ? c() : c;
          };
        },
        () => "OUTER LOADING"
      );
      createRenderEffect(
        () => {
          let v: any = outer();
          while (typeof v === "function") v = v();
          return v;
        },
        v => {
          slot = v;
        }
      );
    });
    flush();
    await settle();
    expect(slot).toBe("CHILD");
  });

  it("a settled memo the content creates is still held (#4166)", async () => {
    const [x, setX] = createSignal(0);
    let screenX: unknown;
    let inner: unknown;
    let slot: unknown;
    createRoot(() => {
      createRenderEffect(x, v => {
        screenX = v;
      });
      // <Show when={latest(x) > 0}><Loading><p>{double()}</p></Loading></Show>
      const content = () => {
        const double = createMemo(() => x() * 2);
        createRenderEffect(double, v => {
          inner = v;
        });
        return "p";
      };
      const when = createMemo(() => latest(x) > 0);
      const children = createMemo(() =>
        when() ? untrack(() => createLoadingBoundary(content, () => "pending")) : "closed"
      );
      createRenderEffect(
        () => {
          const c = children();
          return typeof c === "function" ? c() : c;
        },
        v => {
          slot = v;
        }
      );
    });
    flush();
    let release!: () => void;
    const done = action(function* () {
      setX(1);
      yield new Promise<void>(r => (release = r));
    })();
    await settle();
    expect([screenX, slot, inner]).toEqual([0, "pending", undefined]);
    release();
    await done;
    await settle();
    expect([screenX, slot, inner]).toEqual([1, "p", 2]);
  });
});
