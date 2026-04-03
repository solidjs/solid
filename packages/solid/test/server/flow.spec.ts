/** @vitest-environment node */
import { describe, expect, test } from "vitest";
import {
  createRoot,
  For,
  Repeat,
  Show,
  Switch,
  Match,
  Errored,
  Loading,
  getOwner,
  mapArray,
  ssrRunInScope
} from "../../src/server/index.js";

describe("Server For", () => {
  test("maps array to elements", () => {
    createRoot(
      () => {
        const result = For({
          each: [1, 2, 3] as const,
          children: (item, index) => `${item()}-${index()}`
        });
        // mapArray wraps its read in createMemo (same shape as client signals)
        expect(typeof result === "function" ? (result as any)() : result).toEqual([
          "1-0",
          "2-1",
          "3-2"
        ]);
      },
      { id: "test" }
    );
  });

  test("returns fallback for empty array", () => {
    createRoot(
      () => {
        const result = For({
          each: [] as number[],
          fallback: "empty",
          children: (item, index) => `${item()}`
        });
        expect(typeof result === "function" ? (result as any)() : result).toEqual(["empty"]);
      },
      { id: "test" }
    );
  });
});

describe("Server Repeat", () => {
  test("repeats count times", () => {
    const result = Repeat({
      count: 3,
      children: (i: number) => `item-${i}`
    });
    // repeat() returns a memo-backed accessor like mapArray()
    const val = typeof result === "function" ? (result as any)() : result;
    expect(val).toEqual(["item-0", "item-1", "item-2"]);
  });
});

describe("Server Show", () => {
  test("shows children when truthy", () => {
    const result = Show({
      when: true,
      children: "visible"
    });
    // Show returns a createMemo accessor matching the client
    expect(typeof result === "function" ? (result as any)() : result).toBe("visible");
  });

  test("shows fallback when falsy", () => {
    const result = Show({
      when: false,
      fallback: "hidden",
      children: "visible"
    });
    expect(typeof result === "function" ? (result as any)() : result).toBe("hidden");
  });

  test("passes accessor to function children", () => {
    const result = Show({
      when: "hello",
      children: ((item: () => string) => `got: ${item()}`) as any
    });
    expect(typeof result === "function" ? (result as any)() : result).toBe("got: hello");
  });
});

describe("Server Switch/Match", () => {
  test("renders matching case", () => {
    createRoot(
      () => {
        const result = Switch({
          children: [
            Match({ when: false, children: "first" }),
            Match({ when: true, children: "second" }),
            Match({ when: true, children: "third" })
          ] as any
        });
        // Switch wraps in createMemo, so result is an accessor
        expect(typeof result === "function" ? (result as any)() : result).toBe("second");
      },
      { id: "test" }
    );
  });

  test("renders fallback when no match", () => {
    createRoot(
      () => {
        const result = Switch({
          fallback: "default",
          children: [Match({ when: false, children: "first" })] as any
        });
        expect(typeof result === "function" ? (result as any)() : result).toBe("default");
      },
      { id: "test" }
    );
  });
});

describe("Server Errored", () => {
  test("renders children when no error", () => {
    createRoot(
      () => {
        const result = Errored({
          fallback: "error",
          children: "ok"
        });
        // Errored wraps createErrorBoundary which returns an accessor
        expect(typeof result === "function" ? (result as any)() : result).toBe("ok");
      },
      { id: "test" }
    );
  });

  // Note: Errored catches errors thrown during rendering/evaluation of children.
  // In SSR, errors in children would be caught by the error boundary during rendering.
  // A direct throw in the children prop value happens before Errored runs.
  // This is tested via createErrorBoundary in signals.spec.ts instead.
});

// Hydration key alignment tests
// These verify that server-side flow components create matching owner tree
// structures so hydration keys align with the client.
describe("Hydration key alignment", () => {
  test("Show (non-keyed) children run under value memo scope", () => {
    createRoot(
      () => {
        let childOwnerId: string | undefined;
        Show({
          when: true,
          get children() {
            childOwnerId = (getOwner() as any)?.id;
            return "content";
          }
        });
        // Client Show (non-keyed) creates: conditionValue(t0), condition(t1), value memo(t2)
        // Children are evaluated under the value memo
        expect(childOwnerId).toBe("t2");
      },
      { id: "t" }
    );
  });

  test("Show (keyed) children run under value memo scope", () => {
    createRoot(
      () => {
        let childOwnerId: string | undefined;
        Show({
          when: true,
          keyed: true,
          get children() {
            childOwnerId = (getOwner() as any)?.id;
            return "content";
          }
        });
        // Client Show (keyed) creates: conditionValue(t0), value memo(t1) — no condition memo
        expect(childOwnerId).toBe("t1");
      },
      { id: "t" }
    );
  });

  test("Show fallback also runs under value memo scope", () => {
    createRoot(
      () => {
        let fallbackOwnerId: string | undefined;
        Show({
          when: false,
          get fallback() {
            fallbackOwnerId = (getOwner() as any)?.id;
            return "fallback";
          },
          children: "content"
        });
        expect(fallbackOwnerId).toBe("t2");
      },
      { id: "t" }
    );
  });

  test("Errored children run under boundary with correct depth", () => {
    createRoot(
      () => {
        let childOwnerId: string | undefined;
        const result = Errored({
          fallback: "error",
          get children() {
            childOwnerId = (getOwner() as any)?.id;
            return "ok";
          }
        });
        const out = typeof result === "function" ? (result as any)() : result;
        // Without SSR context, createErrorBoundary returns a thunk; children run on read.
        expect(childOwnerId).toBe("t0");
        expect(out).toBe("ok");
      },
      { id: "t" }
    );
  });

  test("Loading children run directly without SSR context", () => {
    createRoot(
      () => {
        let childOwnerId: string | undefined;
        const read = (value: any): any => {
          while (typeof value === "function") value = value();
          return value;
        };
        const result = Loading({
          fallback: "loading",
          get children() {
            childOwnerId = (getOwner() as any)?.id;
            return "ok";
          }
        });
        expect(childOwnerId).toBe("t");
        expect(typeof result === "function" ? (result as any)() : result).toBe("ok");
      },
      { id: "t" }
    );
  });

  test("Errored inside Loading only adds Errored depth without SSR context", () => {
    createRoot(
      () => {
        let childOwnerId: string | undefined;
        const read = (value: any): any => {
          while (typeof value === "function") value = value();
          return value;
        };
        const result = Loading({
          fallback: "loading",
          get children() {
            return Errored({
              fallback: "error",
              get children() {
                childOwnerId = (getOwner() as any)?.id;
                return "ok";
              }
            }) as any;
          }
        });
        expect(read(result)).toBe("ok");
        expect(childOwnerId).toBe("t0");
      },
      { id: "t" }
    );
  });

  test("Repeat items run under per-item owners", () => {
    createRoot(
      () => {
        const itemOwnerIds: (string | undefined)[] = [];
        const result = Repeat({
          count: 3,
          children: (i: number) => {
            itemOwnerIds.push((getOwner() as any)?.id);
            return `item-${i}`;
          }
        });
        const val = typeof result === "function" ? (result as any)() : result;
        // count / mapFn run when the accessor is read (correct tracking for async SSR).
        expect(itemOwnerIds).toEqual(["t00", "t01", "t02"]);
        expect(val).toEqual(["item-0", "item-1", "item-2"]);
      },
      { id: "t" }
    );
  });

  test("Show consumes correct number of parent slots", () => {
    createRoot(
      () => {
        let firstShowChildId: string | undefined;
        let secondShowChildId: string | undefined;

        Show({
          when: true,
          get children() {
            firstShowChildId = (getOwner() as any)?.id;
            return "first";
          }
        });

        // Second Show starts after first consumed slots t0, t1, t2
        // So it gets t3 (conditionValue), t4 (condition), t5 (value owner)
        Show({
          when: true,
          get children() {
            secondShowChildId = (getOwner() as any)?.id;
            return "second";
          }
        });

        expect(firstShowChildId).toBe("t2");
        expect(secondShowChildId).toBe("t5");
      },
      { id: "t" }
    );
  });
});

// Transparent insert effect alignment tests
// On the client, insert() render effects are transparent (0 owner slots).
// ssrRunInScope must also consume 0 slots to match.
// Show must return an accessor (function) like the client.
describe("Transparent insert effect alignment", () => {
  test("Show returns an accessor function matching client behavior", () => {
    createRoot(
      () => {
        const result = Show({ when: true, children: "visible" });
        expect(typeof result).toBe("function");
        expect((result as any)()).toBe("visible");
      },
      { id: "t" }
    );
  });

  test("Show fallback returns via accessor", () => {
    createRoot(
      () => {
        const result = Show({ when: false, fallback: "hidden", children: "visible" });
        expect(typeof result).toBe("function");
        expect((result as any)()).toBe("hidden");
      },
      { id: "t" }
    );
  });

  test("ssrRunInScope does not consume parent owner slots", () => {
    createRoot(
      () => {
        ssrRunInScope(() => "dynamic value");

        let showChildId: string | undefined;
        Show({
          when: true,
          get children() {
            showChildId = (getOwner() as any)?.id;
            return "content";
          }
        });

        // Show: conditionValue(t0), condition(t1), value memo(t2)
        expect(showChildId).toBe("t2");
      },
      { id: "t" }
    );
  });

  test("ssrRunInScope array form does not consume parent slots", () => {
    createRoot(
      () => {
        ssrRunInScope([() => "a", () => "b"]);

        let showChildId: string | undefined;
        Show({
          when: true,
          get children() {
            showChildId = (getOwner() as any)?.id;
            return "content";
          }
        });

        // Show starts at slot 0: conditionValue(t0), condition(t1), value memo(t2)
        expect(showChildId).toBe("t2");
      },
      { id: "t" }
    );
  });

  test("multiple ssrRunInScope calls do not accumulate slots", () => {
    createRoot(
      () => {
        ssrRunInScope(() => "first dynamic");
        ssrRunInScope(() => "second dynamic");
        ssrRunInScope(() => "third dynamic");

        let showChildId: string | undefined;
        Show({
          when: true,
          get children() {
            showChildId = (getOwner() as any)?.id;
            return "content";
          }
        });

        // All three ssrRunInScope calls should consume 0 slots total.
        // Show: conditionValue(t0), condition(t1), value memo(t2)
        expect(showChildId).toBe("t2");
      },
      { id: "t" }
    );
  });

  test("flow components as siblings — IDs unaffected by dynamic expressions", () => {
    createRoot(
      () => {
        let firstShowChildId: string | undefined;
        let secondShowChildId: string | undefined;

        // Dynamic expression between two Shows
        ssrRunInScope(() => "dynamic before");

        Show({
          when: true,
          get children() {
            firstShowChildId = (getOwner() as any)?.id;
            return "first";
          }
        });

        ssrRunInScope(() => "dynamic between");

        Show({
          when: true,
          get children() {
            secondShowChildId = (getOwner() as any)?.id;
            return "second";
          }
        });

        // With pass-through ssrRunInScope (0 slots each):
        // First Show: conditionValue(t0), condition(t1), value memo(t2)
        // Second Show: conditionValue(t3), condition(t4), value memo(t5)
        expect(firstShowChildId).toBe("t2");
        expect(secondShowChildId).toBe("t5");
      },
      { id: "t" }
    );
  });
});

describe("Server mapArray ID parity (base-36)", () => {
  test("item owner IDs use base-36 encoding, not decimal", () => {
    createRoot(
      () => {
        const items = Array.from({ length: 12 }, (_, i) => i);
        const itemOwnerIds: (string | undefined)[] = [];
        const read = mapArray(
          () => items,
          (item, index) => {
            itemOwnerIds.push((getOwner() as any)?.id);
            return `item-${index()}`;
          }
        );
        // Force evaluation
        read();

        // mapArray: parent owner, then createMemo around the read; items are
        // children of the parent owner.
        // Base-36: 0-9 → "0"-"9", 10 → "a", 11 → "b"
        expect(itemOwnerIds.length).toBe(12);
        expect(itemOwnerIds[0]).toBe("t00");
        expect(itemOwnerIds[9]).toBe("t09");
        expect(itemOwnerIds[10]).toBe("t0a");
        expect(itemOwnerIds[11]).toBe("t0b");
      },
      { id: "t" }
    );
  });

  test("For with 11+ items produces base-36 owner IDs", () => {
    createRoot(
      () => {
        const items = Array.from({ length: 11 }, (_, i) => i);
        const itemOwnerIds: (string | undefined)[] = [];
        const result = For({
          each: items as readonly number[],
          children: (item, index) => {
            itemOwnerIds.push((getOwner() as any)?.id);
            return `v-${index()}`;
          }
        });
        typeof result === "function" ? (result as any)() : result;

        // For → mapArray (memo + parent owner); item owners under mapArray parent
        // Item owners under t1: t10, t11, ..., t19, t1a
        expect(itemOwnerIds[10]).toMatch(/a$/);
        expect(itemOwnerIds[10]).not.toMatch(/10$/);
      },
      { id: "t" }
    );
  });
});
