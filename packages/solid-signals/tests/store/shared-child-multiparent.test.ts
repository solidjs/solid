/**
 * Rule test (INTERNALS-STORE-STATE.md RUL-12 / recon-snap R37 gap) — a shared
 * object reachable through two paths of the same store is ONE logical node:
 * a write through path A must be visible through path B on reads, snapshot,
 * and subscriptions. Under CoW this is the multi-parent (DAG) privatization
 * case: path-copying walks one ancestor chain, so correctness requires
 * per-object registration resolution during traversal, not blind raw-pointer
 * following.
 */
import { describe, expect, it } from "vitest";
import { createEffect, createRoot, createStore, flush, snapshot } from "../../src/index.js";

describe("shared child reachable via two parents", () => {
  it("write through path A is visible through path B: reads, snapshot, subscription", () => {
    const shared = { count: 1 };
    const [s, setS] = createStore({ a: { child: shared }, b: { child: shared } });
    const seen: number[] = [];
    createRoot(() => {
      createEffect(
        () => s.b.child.count,
        v => {
          seen.push(v);
        }
      );
    });
    flush();
    expect(seen).toEqual([1]);

    // Same logical node through both paths.
    expect(s.a.child).toBe(s.b.child);

    setS(d => {
      d.a.child.count = 2;
    });
    flush();

    // Path-B read, subscription, and snapshot all see the path-A write.
    expect(s.b.child.count).toBe(2);
    expect(seen).toEqual([1, 2]);
    expect(snapshot(s.b).child.count).toBe(2);
    expect(snapshot(s).b.child.count).toBe(2);

    // Snapshot coherence: the shared child is one object in the copy too.
    const snap = snapshot(s);
    expect(snap.a.child).toBe(snap.b.child);

    // Source object was never mutated.
    expect(shared.count).toBe(1);
  });

  it("cycle through two paths stays coherent after a write (reads)", () => {
    const node: any = { name: "n", self: null };
    node.self = node;
    const [s, setS] = createStore({ root: node });
    expect(s.root.self).toBe(s.root);

    setS(d => {
      d.root.name = "renamed";
    });
    flush();

    expect(s.root.self.name).toBe("renamed");
    const snap = snapshot(s.root);
    expect(snap.name).toBe("renamed");
    expect(snap.self.name).toBe("renamed");
    expect(node.name).toBe("n");
  });

  // FINDING-3 (rules-mining/FINDINGS.md): fails on shipped — snapshot of a
  // WRITTEN cyclic object breaks cycle identity: `snap.self` comes back as a
  // second copy (internally cyclic) instead of `snap` itself. The seen-map
  // handles symbol-key cycles on untouched objects (pinned, recon-snap R29)
  // but misses the written string-key self-cycle. Flip when the rewrite's
  // copy routine lands (R29 requires shared references to stay shared).
  it.fails("snapshot preserves cycle identity on a written cyclic object", () => {
    const node: any = { name: "n", self: null };
    node.self = node;
    const [s, setS] = createStore({ root: node });

    setS(d => {
      d.root.name = "renamed";
    });
    flush();

    const snap = snapshot(s.root);
    expect(snap.self).toBe(snap);
  });
});
