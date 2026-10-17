/**
 * @jsxImportSource @solidjs/web
 */
// Context through nested slot fills — client half (adoption-time mounting).
// Hydrates the document test/server/frame-nested-fill-context.spec.tsx
// rendered: the badge inside the panel's content reads the theme the panel
// provides, as it did on the server — no mismatch, the server's nodes
// adopted — and stays live. A drawer's badge lives as long as the drawer
// places its content: closing disposes it, opening mounts it afresh under
// the drawer's theme — the closed drawer's (occluded) badge included.
import { describe, expect, test } from "vitest";
import { flush } from "solid-js";
import { seen } from "../harness/frame-nested-fill-context.jsx";
import { bootNestedContext } from "./frame-nested-fill-context-helpers.jsx";

describe("document face — context through nested slot fills — hydrate", () => {
  test("the nested fill adopts under the enclosing fill's provider", async () => {
    const page = await bootNestedContext();
    flush();
    await page.drain();
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    expect(page.badge("in"), "badge in adopted").toBe(page.server.in);
    expect(page.badge("out"), "badge out adopted").toBe(page.server.out);
    expect(page.server.panel.isConnected, "panel adopted").toBe(true);
    await page.click("in");
    await page.click("out");
    expect(page.badge("in").textContent).toBe("dark:1");
    expect(page.badge("out").textContent).toBe("default:1");
    // Every adopted badge read its enclosing fill's theme; the closed
    // drawer's waits for its placement.
    expect([...seen].sort()).toEqual(["d1=drawer", "in=dark", "out=default"]);

    // Closing a drawer disposes its badge; opening mounts it afresh.
    const d1 = page.badge("d1");
    await page.click("d1");
    expect(d1.textContent).toBe("drawer:1");
    await page.toggle("d1");
    expect(page.badge("d1")).toBeNull();
    await page.toggle("d1");
    expect(page.badge("d1").textContent).toBe("drawer:0");
    await page.click("d1");
    expect(page.badge("d1").textContent).toBe("drawer:1");

    // The occluded drawer's badge mounts at its first placement.
    await page.toggle("d2");
    expect(page.badge("d2").textContent).toBe("drawer:0");
    await page.click("d2");
    expect(page.badge("d2").textContent).toBe("drawer:1");
    expect(seen.slice(3)).toEqual(["d1=drawer", "d2=drawer"]);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    page.dispose();
    page.container.remove();
  });
});
