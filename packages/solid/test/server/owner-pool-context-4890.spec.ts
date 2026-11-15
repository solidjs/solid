/** @vitest-environment node */
import { expect, test } from "vitest";
import { createContext, createRoot, getOwner, useContext } from "../../src/server/index.js";

// #4890: `disposeOwner` returns owners to a module-level pool. An owner kept
// its `_context` while it sat there, so the values a finished render provided
// stayed reachable from the pool until a later allocation popped it.
test("a disposed, pooled owner does not keep the context of its render", () => {
  const Big = createContext<{ blob: number[] } | null>(null, { name: "Big" });
  const big = { blob: [1, 2, 3] };
  const seen: any[] = [];
  createRoot(
    dispose => {
      const out = (Big as any)({
        value: big,
        children: () => {
          // a leaf (fast path) and an owner with a child (slow path)
          createRoot(() => seen.push(getOwner()));
          createRoot(() => {
            seen.push(getOwner());
            createRoot(() => expect(useContext(Big)).toBe(big));
          });
          return "";
        }
      });
      out();
      expect(seen).toHaveLength(2);
      for (const o of seen) expect(o._context[(Big as any).id]).toBe(big);
      dispose();
    },
    { id: "r" }
  );
  for (const o of seen) {
    expect(o._disposed).toBe(true);
    expect(o._context[(Big as any).id]).toBeUndefined();
  }
});
