import { computed, read, recompute, signal } from "../src/core/core.js";
import { isPending, latest } from "../src/core/verdict.js";
import type { FirewallSignal } from "../src/core/types.js";

function countChildWalks<T>(child: FirewallSignal<T>): () => number {
  let walks = 0;
  Object.defineProperty(child, "_nextChild", {
    configurable: true,
    get() {
      walks++;
      return null;
    }
  });
  return () => walks;
}

it("skips firewall children without verdict companions", () => {
  const firewall = computed(() => 0);
  const child = signal(0, undefined, firewall);
  const walks = countChildWalks(child);

  recompute(firewall);
  expect(walks()).toBe(0);

  expect(isPending(() => read(child))).toBe(false);
  recompute(firewall);
  expect(walks()).toBe(1);
});

it("walks firewall children after latest creates a companion", () => {
  const firewall = computed(() => 0);
  const child = signal(0, undefined, firewall);
  const walks = countChildWalks(child);

  expect(latest(() => read(child))).toBe(0);
  recompute(firewall);
  expect(walks()).toBe(1);
});
