/**
 * @jsxImportSource @solidjs/web
 */
// Dependency edges — client half: a write the records cannot vouch for —
// a derived signal (no name) — mounts every occurrence left before it applies, as deferred
// hydration did before edges.
import { describe, expect, test } from "vitest";
import { flush } from "solid-js";
import { shop } from "../harness/frame-dependency-edges.jsx";
import { ALL, bootEdges, deferredHydration } from "./frame-dependency-edges-helpers.jsx";

deferredHydration();

describe("document face — dependency edges — deferred hydrate, fallback", () => {
  test("a write to a derived signal (no name) mounts every occurrence left first", () => {
    const page = bootEdges();
    shop.setCart(1);
    expect(page.seen()).toEqual(["cart", "late"]);
    shop.setDerived(3);
    expect(page.seen()).toEqual(ALL);
    flush();
    expect(page.text("derived")).toBe("derived:3");
    expect(page.text("item-a")).toBe("a:USD:0:0");
    expect(page.warnings).toEqual([]);
    page.dispose();
  });
});
