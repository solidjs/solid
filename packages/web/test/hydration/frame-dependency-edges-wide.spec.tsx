/**
 * @jsxImportSource @solidjs/web
 */
// Dependency edges — client half: a write the records cannot vouch for —
// a wide signal (read by a projection, whose readers are not tracked) — mounts every occurrence left before it applies, as deferred
// hydration did before edges.
import { describe, expect, test } from "vitest";
import { flush } from "solid-js";
import { shop } from "../harness/frame-dependency-edges.jsx";
import { ALL, bootEdges, deferredHydration } from "./frame-dependency-edges-helpers.jsx";

deferredHydration();

describe("document face — dependency edges — deferred hydrate, fallback", () => {
  test("a write to a wide signal (read by a projection, whose readers are not tracked) mounts every occurrence left first", () => {
    const page = bootEdges();
    shop.setCart(1);
    expect(page.seen()).toEqual(["cart", "late"]);
    shop.setWideSource(2);
    expect(page.seen()).toEqual(ALL);
    flush();
    expect(page.text("wide")).toBe("wide:2");
    expect(page.text("item-a")).toBe("a:USD:0:0");
    expect(page.warnings).toEqual([]);
    page.dispose();
  });
});
