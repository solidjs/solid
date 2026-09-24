/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "@solidjs/web";
import { createSignal, flush, OBSERVE } from "solid-js";
import { attribution } from "solid-js/attribution";

/**
 * Binding effects the compiler emits are tagged (dev only) with the element
 * they write, and a console diagnostic about such an effect prints that
 * element as a second argument — a live reference beside the message.
 */

// The channel's subscriptions are the consumer's — not dropped by `disable()`.
const offs: Array<() => void> = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

describe("diagnostic element references", () => {
  test("a hot binding effect's warning carries the element it writes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    attribution.enable({
      log: false,
      hotRuns: { count: 5, windowMs: 60_000 },
      hotTime: false,
      waterfalls: false
    });
    const [cls, setCls] = createSignal("a", { name: "cls" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <div id="target" class={cls()} />, container);
    flush();
    // Records never carry the node; the channel delivers it beside each record.
    const nodes: any[] = [];
    offs.push(OBSERVE!.records.subscribe("rerun", (e, live) => nodes.push(live)));

    for (let i = 0; i < 6; i++) {
      setCls(`c${i}`);
      flush();
    }

    const target = container.querySelector("#target")!;
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes[0]._devElement).toBe(target);
    const hot = warn.mock.calls.find(args => String(args[0]).includes("[HOT_SCOPE_RERUNS]"));
    expect(hot).toBeDefined();
    expect(hot![1]).toBe(target);
    dispose();
    container.remove();
  });
});
