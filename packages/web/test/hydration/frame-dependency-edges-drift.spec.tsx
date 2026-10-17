/**
 * @jsxImportSource @solidjs/web
 */
// Dependency edges — client half, dev: a client that names a shared signal
// differently from the server (one extra client-only plain signal ahead of
// the shared ones in the shell) is warned about when an occurrence mounting
// reads a shared signal its record does not list.
import { describe, expect, test } from "vitest";
import { shop } from "../harness/frame-dependency-edges.jsx";
import { bootEdges, deferredHydration } from "./frame-dependency-edges-helpers.jsx";

deferredHydration();

describe("document face — dependency edges — deferred hydrate, identity drift", () => {
  test("dev: a shared signal named differently on the client is warned about", () => {
    const page = bootEdges({ drift: true });
    // The client's `cart` carries the server's name for `currency`.
    shop.setCart(1);
    // The wrong occurrences mounted, and the first one to read a shared
    // signal the server did not record for it says so — once.
    expect(page.seen()).toContain("item:a");
    expect(page.seen()).not.toContain("cart");
    const drift = page.warnings.filter(w => w.includes("the server did not record that read"));
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('"item#0"');
    page.dispose();
  });
});
