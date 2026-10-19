/**
 * @jsxImportSource @solidjs/web
 */
// Dependency edges — client half, deferred hydration: a write before the idle
// pass mounts only the unmounted occurrences the server recorded as reading
// the written signal, before the write applies. Hydrates the document
// test/server/frame-dependency-edges.spec.tsx rendered.
import { describe, expect, test } from "vitest";
import { flush } from "solid-js";
import { shop } from "../harness/frame-dependency-edges.jsx";
import { drain } from "./frame-live-document-helpers.js";
import { bootEdges, deferredHydration } from "./frame-dependency-edges-helpers.jsx";

deferredHydration();

describe("document face — dependency edges — deferred hydrate", () => {
  test("a named write mounts only the occurrences that read it", async () => {
    const page = bootEdges();
    expect(page.seen()).toEqual([]);
    shop.setCart(1);
    // The cart widget, and `late` (the server could not see its reads, so it
    // mounts on every named write); none of the items.
    expect(page.seen()).toEqual(["cart", "late"]);
    flush();
    expect(page.text("cart")).toBe("cart:1");
    shop.setCurrency("EUR");
    // Every item reads the currency; the rest stays unmounted.
    expect(page.seen()).toEqual(["cart", "item:a", "item:b", "item:c", "item:d", "late"]);
    flush();
    expect(page.text("item-c")).toBe("c:EUR:0:0");
    expect(page.text("store")).toBe("store:0");
    await drain();
    expect(page.warnings).toEqual([]);
    page.dispose();
  });
});
