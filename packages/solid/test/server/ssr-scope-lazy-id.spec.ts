/** @vitest-environment node */
/**
 * `ssrScope` — lazy id materialization (follow-up to #3599).
 *
 * Since #3599 every hole that is not provably primitive is scoped, and most
 * of those are text (`{row.label}`): nothing inside ever asks for a child
 * id. The scope therefore reserves its slot as a bare counter increment and
 * installs the pair (`id` = the enclosing owner's id, `_scopeSlot` = the
 * reserved slot) around the evaluation; the id STRING is only built —
 * through `materializeId` — when something inside derives from it.
 *
 * The contract these tests pin (documentation/hole-owner-id-matrix.md): a
 * scoped hole consumes exactly one slot from the parent counter at argument
 * evaluation time, and every id string produced anywhere is byte-identical
 * to the eager form's `formatChildId(prefix, slot)`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createMemo,
  createOwner,
  createRoot,
  createUniqueId,
  getNextChildId,
  getOwner,
  NotReadyError,
  ssrScope
} from "../../src/server/index.js";
import { ownerId } from "../../src/server/signals.js";
import { sharedConfig } from "../../src/server/shared.js";

/** The server owner's internals the tests observe. */
type Internals = { id?: string; _childCount: number; _scopeSlot: number };
const internals = () => getOwner() as unknown as Internals;

describe("ssrScope reserves the slot without formatting an id string", () => {
  test("a text hole consumes one slot and its scope id is never built", () => {
    let seen: Internals | undefined;
    createRoot(
      () => {
        const o = internals();
        expect(o._scopeSlot).toBe(-1);
        expect(o._childCount).toBe(0);
        const hole = ssrScope(() => {
          seen = { id: o.id, _childCount: o._childCount, _scopeSlot: o._scopeSlot };
          return "text";
        });
        // Reserved at argument evaluation: one slot, and nothing else moved.
        expect(o._childCount).toBe(1);
        expect(o.id).toBe("r");
        expect(o._scopeSlot).toBe(-1);

        expect(hole()).toBe("text");
        // While the hole ran, the owner carried the PAIR — prefix + slot —
        // not the formatted "r0", and its child counter was zeroed.
        expect(seen).toEqual({ id: "r", _childCount: 0, _scopeSlot: 0 });
        // Restored after: the reservation stands, the counter continues.
        expect(o.id).toBe("r");
        expect(o._scopeSlot).toBe(-1);
        expect(o._childCount).toBe(1);
        expect(getNextChildId(getOwner()!)).toBe("r1");
      },
      { id: "r" }
    );
  });

  test("the first derivation inside materializes exactly the eager form's id", () => {
    createRoot(
      () => {
        const o = internals();
        // Push the counter into formatChildId's letter-prefixed range so the
        // materialized string exercises the same encoding as before.
        o._childCount = 36;
        const hole = ssrScope(() => {
          const first = createUniqueId();
          // Folded in on that first ask: "r" + "A10" (slot 36), slot cleared.
          expect(o.id).toBe("rA10");
          expect(o._scopeSlot).toBe(-1);
          const second = createUniqueId();
          return [first, second];
        });
        expect(hole()).toEqual(["rA100", "rA101"]);
        expect(o.id).toBe("r");
        expect(o._scopeSlot).toBe(-1);
        expect(getNextChildId(getOwner()!)).toBe("rA11");
      },
      { id: "r" }
    );
  });

  test("materialization is idempotent across evaluations of the same hole", () => {
    createRoot(
      () => {
        const hole = ssrScope(() => createUniqueId());
        expect(hole()).toBe("00");
        expect(hole()).toBe("00");
        expect(hole()).toBe("00");
        expect(getNextChildId(getOwner()!)).toBe("1");
      },
      { id: "" }
    );
  });

  test("nested scoped holes: createUniqueId and memos inside get today's ids", () => {
    // Eager form, for reference (root ""): outer scope reserves "0"; inside
    // it createUniqueId → "00", the inner scope reserves "01" and its memo
    // owner is "010", its createUniqueId "011"; back in the outer scope the
    // next id is "02"; the root's next sibling is "1".
    const ids: string[] = [];
    createRoot(
      () => {
        const o = internals();
        const outer = ssrScope(() => {
          ids.push(createUniqueId());
          const inner = ssrScope(() => {
            // Reserving the inner slot materialized the outer scope's id.
            expect(o.id).toBe("0");
            expect(o._scopeSlot).toBe(1);
            const memo = createMemo(() => {
              ids.push(ownerId(getOwner()!)!);
              return 1;
            });
            memo();
            ids.push(createUniqueId());
            return "inner";
          });
          // Pending pair while the inner wrapper has not run yet.
          expect(o.id).toBe("0");
          expect(o._scopeSlot).toBe(-1);
          expect(inner()).toBe("inner");
          // The inner wrapper restored the outer's materialized state.
          expect(o.id).toBe("0");
          expect(o._scopeSlot).toBe(-1);
          ids.push(createUniqueId());
          return "outer";
        });
        expect(outer()).toBe("outer");
        ids.push(getNextChildId(getOwner()!));
      },
      { id: "" }
    );
    expect(ids).toEqual(["00", "010", "011", "02", "1"]);
  });

  test("a hole inside a pending scope that itself never derives keeps the outer lazy", () => {
    // The inner reservation materializes the outer (it needs the prefix);
    // the inner's own string is never built when nothing inside asks.
    createRoot(
      () => {
        const o = internals();
        let innerSeen: Internals | undefined;
        const outer = ssrScope(() => {
          const inner = ssrScope(() => {
            innerSeen = { id: o.id, _childCount: o._childCount, _scopeSlot: o._scopeSlot };
            return "leaf";
          });
          expect(inner()).toBe("leaf");
          return "outer";
        });
        outer();
        expect(innerSeen).toEqual({ id: "0", _childCount: 0, _scopeSlot: 0 });
        expect(getNextChildId(getOwner()!)).toBe("1");
      },
      { id: "" }
    );
  });
});

describe("retries keep the reserved slot", () => {
  test("a hole that throws NotReadyError and is re-run gets the same ids", () => {
    createRoot(
      () => {
        const o = internals();
        let attempts = 0;
        const ids: string[] = [];
        const hole = ssrScope(() => {
          attempts++;
          ids.push(createUniqueId());
          if (attempts === 1) throw new NotReadyError(Promise.resolve());
          return "ready";
        });
        // A sibling hole registered after it — source order — in the same
        // template, evaluated between the two attempts (as the eager
        // siblings of a deferred `$df` hole are).
        const sibling = ssrScope(() => createUniqueId());

        expect(() => hole()).toThrow(NotReadyError);
        // The throw unwound the swap: no pending pair leaks out.
        expect(o.id).toBe("");
        expect(o._scopeSlot).toBe(-1);
        expect(o._childCount).toBe(2);

        expect(sibling()).toBe("10");
        expect(hole()).toBe("ready");
        expect(ids).toEqual(["00", "00"]);
        expect(getNextChildId(getOwner()!)).toBe("2");
      },
      { id: "" }
    );
  });

  test("a deferred hole re-run while another scope is swapped on the same owner", () => {
    // Retry order is the stream's, not source order: a deferred hole may be
    // re-run while an unrelated hole of the same owner is mid-evaluation.
    // Each swap saves and restores the full pair.
    createRoot(
      () => {
        const o = internals();
        let attempts = 0;
        const deferredHole = ssrScope(() => {
          attempts++;
          if (attempts === 1) throw new NotReadyError(Promise.resolve());
          return createUniqueId();
        });
        const other = ssrScope(() => {
          const before = { id: o.id, _scopeSlot: o._scopeSlot };
          const retried = deferredHole();
          // The outer pending pair is intact after the nested retry.
          expect({ id: o.id, _scopeSlot: o._scopeSlot }).toEqual(before);
          return [retried, createUniqueId()];
        });
        expect(() => deferredHole()).toThrow(NotReadyError);
        expect(other()).toEqual(["00", "10"]);
        expect(getNextChildId(getOwner()!)).toBe("2");
      },
      { id: "" }
    );
  });
});

describe("readers of a possibly-pending owner", () => {
  let savedContext: any;
  beforeEach(() => {
    savedContext = sharedConfig.context;
  });
  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  test("a transparent owner created inside a pending scope copies the materialized id", () => {
    createRoot(
      () => {
        const o = internals();
        const hole = ssrScope(() => {
          const t = createOwner({ transparent: true }) as unknown as Internals;
          expect(t.id).toBe("0");
          expect(o.id).toBe("0");
          expect(o._scopeSlot).toBe(-1);
          return "x";
        });
        hole();
      },
      { id: "" }
    );
  });

  test("a transparent async memo inside a pending scope serializes under the scope id", () => {
    const serialize = vi.fn();
    sharedConfig.context = { async: true, serialize } as any;
    createRoot(
      () => {
        const hole = ssrScope(() => {
          createMemo(() => Promise.resolve(1), { transparent: true } as any);
          return "x";
        });
        hole();
      },
      { id: "" }
    );
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(serialize.mock.calls[0][0]).toBe("0");
  });

  test("a non-transparent async memo inside a pending scope serializes under its child id", () => {
    const serialize = vi.fn();
    sharedConfig.context = { async: true, serialize } as any;
    createRoot(
      () => {
        const hole = ssrScope(() => {
          createMemo(() => Promise.resolve(1));
          return "x";
        });
        hole();
      },
      { id: "" }
    );
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(serialize.mock.calls[0][0]).toBe("00");
  });

  test("dev: ownerId throws on a pending owner and reads it once materialized", () => {
    createRoot(
      () => {
        const o = getOwner()!;
        expect(ownerId(o)).toBe("");
        const hole = ssrScope(() => {
          expect(() => ownerId(o)).toThrow(/materializ/);
          createUniqueId();
          expect(ownerId(o)).toBe("0");
          return "x";
        });
        hole();
        expect(ownerId(o)).toBe("");
      },
      { id: "" }
    );
  });

  test("pooled owners come back with no pending slot", () => {
    let disposeFirst!: () => void;
    createRoot(
      dispose => {
        disposeFirst = dispose;
        // Leave the root pending-free but exercise the swap on it once.
        ssrScope(() => "x")();
      },
      { id: "" }
    );
    disposeFirst();
    createRoot(
      () => {
        const o = internals();
        expect(o._scopeSlot).toBe(-1);
        expect(o._childCount).toBe(0);
      },
      { id: "" }
    );
  });
});
