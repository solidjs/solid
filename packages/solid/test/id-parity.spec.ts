import { describe, expect, test } from "vitest";
import { createRoot, getOwner, createMemo, untrack } from "@solidjs/signals";
import { devComponent } from "../src/client/core.js";

/**
 * ID Parity Tests
 *
 * Verify that dev-mode wrappers (devComponent) produce the same owner IDs
 * as production code (no wrapper). This is critical for SSR/hydration: the
 * server runs without wrappers, the client runs with them in dev mode.
 * Transparent owners make the wrappers invisible to the ID scheme.
 */

describe("ID Parity: devComponent transparent wrapper", () => {
  test("devComponent produces same child IDs as direct call", () => {
    const idsWithWrapper: string[] = [];
    const idsWithoutWrapper: string[] = [];

    // With devComponent (dev mode, transparent wrapper)
    createRoot(
      () => {
        devComponent(() => {
          const a = createMemo(() => {
            idsWithWrapper.push(getOwner()!.id!);
            return "a";
          });
          const b = createMemo(() => {
            idsWithWrapper.push(getOwner()!.id!);
            return "b";
          });
          untrack(() => {
            a();
            b();
          });
          return undefined as any;
        }, {} as any);
      },
      { id: "t" }
    );

    // Without wrapper (production / server)
    createRoot(
      () => {
        const Comp = () => {
          const a = createMemo(() => {
            idsWithoutWrapper.push(getOwner()!.id!);
            return "a";
          });
          const b = createMemo(() => {
            idsWithoutWrapper.push(getOwner()!.id!);
            return "b";
          });
          untrack(() => {
            a();
            b();
          });
          return undefined as any;
        };
        Comp();
      },
      { id: "t" }
    );

    expect(idsWithWrapper).toEqual(idsWithoutWrapper);
    expect(idsWithWrapper.length).toBe(2);
  });

  test("devComponent does not shift sibling IDs", () => {
    const ids: string[] = [];

    createRoot(
      () => {
        // Component wrapped in devComponent
        devComponent(() => {
          const cm = createMemo(() => {
            ids.push("comp-memo:" + getOwner()!.id!);
            return "x";
          });
          untrack(cm);
          return undefined as any;
        }, {} as any);

        // Sibling memo created after the devComponent
        createMemo(() => {
          ids.push("sibling:" + getOwner()!.id!);
          return "y";
        })();
      },
      { id: "t" }
    );

    // comp-memo should be t0, sibling should be t1
    // Without transparent, comp wrapper would be t0, comp-memo would be t00,
    // and sibling would be t1. With transparent, comp-memo is t0 and sibling is t1.
    expect(ids).toContain("comp-memo:t0");
    expect(ids).toContain("sibling:t1");
  });

  test("nested devComponent wrappers produce correct IDs", () => {
    const ids: string[] = [];

    createRoot(
      () => {
        devComponent(() => {
          ids.push("outer-owner:" + getOwner()!.id!);

          devComponent(() => {
            const m = createMemo(() => {
              ids.push("inner-memo:" + getOwner()!.id!);
              return "nested";
            });
            untrack(m);
            return undefined as any;
          }, {} as any);
          return undefined as any;
        }, {} as any);
      },
      { id: "t" }
    );

    // The transparent devComponent root has id = parent's id ("t")
    // Inner memo should get id from the root's counter (delegated through transparent wrappers)
    expect(ids).toContain("outer-owner:t");
    expect(ids).toContain("inner-memo:t0");
  });

  test("multiple components produce sequential IDs matching server", () => {
    const serverIds: string[] = [];
    const clientIds: string[] = [];

    function MyComp(props: { label: string }) {
      const m = createMemo(() => {
        return getOwner()!.id!;
      });
      return untrack(m);
    }

    // Server-style: direct calls
    createRoot(
      () => {
        serverIds.push(MyComp({ label: "A" }));
        serverIds.push(MyComp({ label: "B" }));
        serverIds.push(MyComp({ label: "C" }));
      },
      { id: "t" }
    );

    // Client dev-style: wrapped in devComponent
    createRoot(
      () => {
        clientIds.push(devComponent(MyComp, { label: "A" }) as any);
        clientIds.push(devComponent(MyComp, { label: "B" }) as any);
        clientIds.push(devComponent(MyComp, { label: "C" }) as any);
      },
      { id: "t" }
    );

    expect(clientIds).toEqual(serverIds);
    expect(serverIds).toEqual(["t0", "t1", "t2"]);
  });
});

/**
 * Ternary / Conditional ID Parity Tests
 *
 * The compiler wraps dynamic conditional tests in memo() calls:
 *   memo(() => !!condition)() ? consequent : alternate
 *
 * Each memo creates an owner and consumes a child ID. These tests verify
 * that the owner-tree structure from compiled ternaries produces consistent
 * IDs, ensuring server/client hydration alignment.
 *
 * The compiler's `memo` is: fn => createMemo(() => fn())
 */
const memo = (fn: () => any) => createMemo(() => fn());

describe("ID Parity: ternary conditional memos", () => {
  test("simple ternary: memo for condition test consumes one child ID", () => {
    const ids: string[] = [];

    createRoot(
      () => {
        // Simulates compiled: memo(() => !!state.dynamic)() ? good() : bad
        const condMemo = memo(() => !!true);
        ids.push("cond-memo:" + getOwner()!.id!);
        untrack(() => condMemo());

        // Sibling memo after the ternary
        const sibling = createMemo(() => {
          ids.push("sibling:" + getOwner()!.id!);
          return "s";
        });
        untrack(sibling);
      },
      { id: "t" }
    );

    // cond-memo should be t0, sibling should be t1
    expect(ids).toContain("cond-memo:t");
    expect(ids).toContain("sibling:t1");
  });

  test("ternary inside element child: IIFE+memo pattern produces correct IDs", () => {
    const ids: string[] = [];

    createRoot(
      () => {
        // Simulates compiled element-child ternary (non-inline / IIFE pattern):
        //   var _v$ = (() => {
        //     var _c$ = memo(() => !!state.dynamic);
        //     return () => (_c$() ? good() : bad);
        //   })();
        const _v$ = (() => {
          const _c$ = memo(() => !!true);
          ids.push("iife-cond:" + getOwner()!.id!);
          return () => (untrack(_c$) ? "good" : "bad");
        })();

        // Another element child after the ternary
        const _v$2 = createMemo(() => {
          ids.push("next-child:" + getOwner()!.id!);
          return "next";
        });
        untrack(_v$2);
      },
      { id: "t" }
    );

    // The IIFE memo gets t0, the next child memo gets t1
    expect(ids).toContain("iife-cond:t");
    expect(ids).toContain("next-child:t1");
  });

  test("nested ternary: each condition level consumes a child ID", () => {
    const ids: string[] = [];

    createRoot(
      () => {
        // Simulates compiled nested ternary:
        //   memo(() => state.count > 5)()
        //     ? memo(() => !!state.dynamic)() ? best : good()
        //     : bad
        const outerCond = memo(() => true);
        ids.push("outer-cond:" + getOwner()!.id!);

        // The inner cond is inline (deep=true in transformCondition)
        const innerCond = memo(() => true);
        ids.push("inner-cond:" + getOwner()!.id!);

        untrack(() => {
          outerCond();
          innerCond();
        });

        // Sibling after the nested ternary
        const sibling = createMemo(() => {
          ids.push("sibling:" + getOwner()!.id!);
          return "s";
        });
        untrack(sibling);
      },
      { id: "t" }
    );

    // outer-cond at t0, inner-cond at t1, sibling at t2
    expect(ids).toContain("outer-cond:t");
    expect(ids).toContain("inner-cond:t");
    expect(ids).toContain("sibling:t2");
  });

  test("ternary IDs match between direct call and devComponent", () => {
    const serverIds: string[] = [];
    const clientIds: string[] = [];

    function MyComp() {
      const condMemo = memo(() => !!true);
      untrack(condMemo);
      const after = createMemo(() => {
        return getOwner()!.id!;
      });
      return untrack(after);
    }

    // Server-style: direct call
    createRoot(
      () => {
        serverIds.push(MyComp());
      },
      { id: "t" }
    );

    // Client dev-style: devComponent wrapper
    createRoot(
      () => {
        clientIds.push(devComponent(MyComp, {} as any) as any);
      },
      { id: "t" }
    );

    expect(clientIds).toEqual(serverIds);
    // condMemo is t0, after-memo is t1
    expect(serverIds).toEqual(["t1"]);
  });

  test("multiple ternaries produce sequential IDs", () => {
    const ids: string[] = [];

    createRoot(
      () => {
        // First ternary
        const c1 = memo(() => !!true);
        // Second ternary
        const c2 = memo(() => !!false);
        // Third ternary
        const c3 = memo(() => !!true);

        untrack(() => {
          c1();
          c2();
          c3();
        });

        // Trailing memo
        const trailing = createMemo(() => {
          ids.push("trailing:" + getOwner()!.id!);
          return "t";
        });
        untrack(trailing);
      },
      { id: "t" }
    );

    // Three ternary memos at t0, t1, t2; trailing at t3
    expect(ids).toContain("trailing:t3");
  });

  test("ternary inside component child with devComponent parity", () => {
    const serverIds: string[] = [];
    const clientIds: string[] = [];

    function Parent() {
      // Simulates: {condition() ? <A/> : <B/>}
      const condMemo = memo(() => !!true);
      untrack(condMemo);

      // Simulates a second child element
      const secondChild = createMemo(() => getOwner()!.id!);
      return untrack(secondChild);
    }

    createRoot(
      () => {
        serverIds.push(Parent());
        serverIds.push(Parent());
      },
      { id: "t" }
    );

    createRoot(
      () => {
        clientIds.push(devComponent(Parent, {} as any) as any);
        clientIds.push(devComponent(Parent, {} as any) as any);
      },
      { id: "t" }
    );

    expect(clientIds).toEqual(serverIds);
  });
});
