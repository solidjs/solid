/**
 * @jsxImportSource @solidjs/web
 */
// Dependency edges — client half: a write to a derived store (a projection)
// carries no name: it mounts every occurrence left before it applies, as
// deferred hydration did before edges.
import { describe, expect, test } from "vitest";
import { flush } from "solid-js";
import { shop } from "../harness/frame-dependency-edges.jsx";
import { ALL, bootEdges, deferredHydration } from "./frame-dependency-edges-helpers.jsx";

deferredHydration();

describe("document face — dependency edges — deferred hydrate, fallback", () => {
  test("a write to a projection store mounts every occurrence left first", () => {
    const page = bootEdges();
    shop.setCart(1);
    expect(page.seen()).toEqual(["cart", "late"]);
    shop.setDStore(s => void (s.v = 2));
    expect(page.seen()).toEqual(ALL);
    flush();
    expect(page.text("dstore")).toBe("dstore:2");
    expect(page.text("item-a")).toBe("a:USD:0:0");
    expect(page.warnings).toEqual([]);
    page.dispose();
  });
});
