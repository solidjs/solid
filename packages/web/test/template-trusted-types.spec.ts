/**
 * @vitest-environment jsdom
 *
 * Template creation under Trusted Types.
 *
 * A page that enforces `require-trusted-types-for 'script'` rejects a plain
 * string assigned to `innerHTML`, so `template()` passes its static markup
 * through a policy named `solid`.
 */
import { afterEach, describe, expect, test, vi } from "vitest";

const load = () => import("../src/client.js");

afterEach(() => {
  delete (globalThis as any).trustedTypes;
  vi.resetModules();
});

describe("template() under Trusted Types", () => {
  test("creates templates through the `solid` policy", async () => {
    const createHTML = vi.fn((html: string) => ({ toString: () => html }));
    const createPolicy = vi.fn((_name: string, _rules: { createHTML(html: string): string }) => ({
      createHTML
    }));
    (globalThis as any).trustedTypes = { createPolicy };
    const { template } = await load();

    const first = template("<div>First</div>")();
    const second = template("<span>Second</span>")();

    expect(first.outerHTML).toBe("<div>First</div>");
    expect(second.outerHTML).toBe("<span>Second</span>");
    expect(createPolicy).toHaveBeenCalledTimes(1);
    expect(createPolicy.mock.calls[0][0]).toBe("solid");
    expect(createPolicy.mock.calls[0][1].createHTML("<p></p>")).toBe("<p></p>");
    expect(createHTML.mock.calls).toEqual([["<div>First</div>"], ["<span>Second</span>"]]);
  });

  test("assigns the string when the page does not allow the policy", async () => {
    const createPolicy = vi.fn(() => {
      throw new TypeError("Policy solid disallowed.");
    });
    (globalThis as any).trustedTypes = { createPolicy };
    const { template } = await load();

    expect(template("<div>First</div>")().outerHTML).toBe("<div>First</div>");
    expect(template("<span>Second</span>")().outerHTML).toBe("<span>Second</span>");
    expect(createPolicy).toHaveBeenCalledTimes(1);
  });

  test("assigns the string without Trusted Types support", async () => {
    const { template } = await load();

    expect(template("<div>First</div>")().outerHTML).toBe("<div>First</div>");
  });
});
