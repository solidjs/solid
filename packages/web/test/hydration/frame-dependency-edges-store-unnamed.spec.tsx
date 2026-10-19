/**
 * @jsxImportSource @solidjs/web
 */
// Dependency edges — client half: a write to a store with no name (created
// outside any owner) is one the records cannot vouch for: it mounts every
// occurrence left before it applies, as deferred hydration did before edges.
import { describe, expect, test } from "vitest";
import { flush } from "solid-js";
import { setLoose } from "../harness/frame-dependency-edges.jsx";
import { ALL, bootEdges, deferredHydration } from "./frame-dependency-edges-helpers.jsx";

deferredHydration();

describe("document face — dependency edges — deferred hydrate, fallback", () => {
  test("a write to an unnamed store mounts every occurrence left first", () => {
    const page = bootEdges();
    setLoose(s => void (s.n = 1));
    expect(page.seen()).toEqual(ALL);
    flush();
    expect(page.text("item-a")).toBe("a:USD:0:0");
    expect(page.warnings).toEqual([]);
    page.dispose();
  });
});
