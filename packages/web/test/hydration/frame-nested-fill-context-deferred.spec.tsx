/**
 * @jsxImportSource @solidjs/web
 */
// Context through nested slot fills — client half, deferred hydration. An
// event inside the nested occurrence mounts the occurrences enclosing it,
// outermost first: the panel, then the badge in its content — which reads
// the panel's theme and sees the event that woke it.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { flush } from "solid-js";
import { setDeferredHydration } from "../../frames/src/client.js";
import { seen } from "../harness/frame-nested-fill-context.jsx";
import { bootNestedContext } from "./frame-nested-fill-context-helpers.jsx";

beforeAll(() => setDeferredHydration(true));
afterAll(() => setDeferredHydration(false));

describe("document face — context through nested slot fills — deferred hydrate", () => {
  test("an event in the nested occurrence mounts it under the enclosing fill's provider", async () => {
    const page = await bootNestedContext();
    expect(seen).toEqual([]);
    // Nothing mounted yet: the click mounts panel, then badge, then lands.
    await page.click("in");
    expect(page.badge("in"), "badge in adopted").toBe(page.server.in);
    expect(page.badge("in").textContent).toBe("dark:1");
    // It mounted first (the handler's write then mounts every other
    // occurrence before it applies).
    expect(seen[0]).toBe("in=dark");
    // The idle pass mounts the rest.
    for (let i = 0; i < 4; i++) {
      flush();
      await new Promise(r => setTimeout(r));
    }
    await page.click("out");
    expect(page.badge("out"), "badge out adopted").toBe(page.server.out);
    expect(page.badge("out").textContent).toBe("default:1");
    expect(page.badge("in").textContent).toBe("dark:1");
    expect([...seen].sort()).toEqual(["d1=drawer", "in=dark", "out=default"]);
    await page.toggle("d2");
    expect(page.badge("d2").textContent).toBe("drawer:0");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    page.dispose();
    page.container.remove();
  });
});
