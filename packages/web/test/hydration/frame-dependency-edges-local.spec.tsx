/**
 * @jsxImportSource @solidjs/web
 */
// Dependency edges — client half: a write to an occurrence's own state (a
// named signal and a card-local store no record lists) mounts nothing
// beyond what the event woke.
import { describe, expect, test } from "vitest";
import { flush } from "solid-js";
import { bootEdges, deferredHydration } from "./frame-dependency-edges-helpers.jsx";

deferredHydration();

describe("document face — dependency edges — deferred hydrate, own state", () => {
  test("a write to an occurrence's own state mounts nothing else", () => {
    const page = bootEdges();
    page.container
      .querySelector("#item-b")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // The click mounted its occurrence; the handler wrote that occurrence's
    // counter and its card-local store, which no other occurrence read (`late` mounts on every named
    // write: the server could not see its reads).
    expect(page.seen()).toEqual(["item:b", "late"]);
    flush();
    expect(page.text("item-b")).toBe("b:USD:1:10");
    expect(page.warnings).toEqual([]);
    page.dispose();
  });
});
