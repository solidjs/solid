/**
 * @jsxImportSource @solidjs/web
 */
// Dependency edges — client half: a plain store goes by its root's name. A
// setter call on it mounts only the unmounted occurrences that read the
// store (any property, at any depth), before the write applies.
import { describe, expect, test } from "vitest";
import { flush } from "solid-js";
import { shop } from "../harness/frame-dependency-edges.jsx";
import { bootEdges, deferredHydration } from "./frame-dependency-edges-helpers.jsx";

deferredHydration();

describe("document face — dependency edges — deferred hydrate, stores", () => {
  test("a write to a named store mounts only the occurrences that read it", () => {
    const page = bootEdges();
    const before = page.container.querySelector("#store");
    shop.setStore(s => void (s.n = 1));
    // The store widget, and `late` (it mounts on every named write); the
    // items, the projection's reader and the rest stay unmounted.
    expect(page.seen()).toEqual(["late", "store"]);
    // Mounted against the server's markup before the write: hydrated in place.
    expect(page.text("store")).toBe("store:0");
    flush();
    expect(page.text("store")).toBe("store:1");
    expect(page.container.querySelector("#store")).toBe(before);
    expect(page.warnings).toEqual([]);
    page.dispose();
  });
});
