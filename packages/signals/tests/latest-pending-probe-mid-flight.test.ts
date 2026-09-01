/**
 * #3166: a tracked memo containing `latest(() => isPending(...))` created
 * DURING an active new-question flight must report the same verdict as an
 * equivalent probe that already existed. The lazy latest-shadow path was
 * creation-time dependent: the new probe's first compute encountered the
 * pending-uninitialized shadow before collecting the active pending source,
 * cached `false`, and received no true verdict for the rest of the flight.
 */
import { expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const tick = async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  flush();
};

it("a tracked latest(isPending()) probe created mid-flight sees the current flight (#3166)", async () => {
  const resolvers: Array<(value: number) => void> = [];
  let setId!: (value: number) => void;
  let source!: () => number;

  createRoot(() => {
    const [id, set] = createSignal(0);
    setId = set;

    source = createMemo(async () => {
      const current = id();
      const value = await new Promise<number>(resolve => resolvers.push(resolve));
      return value + current * 100;
    });

    // Keep the source observed and participating in the async lifecycle.
    createRenderEffect(
      () => {
        try {
          source();
        } catch {}
      },
      () => {}
    );
  });

  flush();
  resolvers.splice(0).forEach(resolve => resolve(1));
  await tick();

  setId(1);
  flush(); // new-question flight is active

  // Existing/bare probe forms agree the flight is pending.
  expect(isPending(() => source())).toBe(true);
  expect(latest(() => isPending(() => source()))).toBe(true);

  // The tracked probe created DURING the flight must agree.
  let probe!: () => boolean;
  createRoot(() => {
    probe = createMemo(() => latest(() => isPending(() => source())));
  });
  expect(probe()).toBe(true);

  resolvers.splice(0).forEach(resolve => resolve(2));
  await tick();
  expect(probe()).toBe(false);

  // The next flight behaves identically for the same probe.
  setId(2);
  flush();
  expect(probe()).toBe(true);
  resolvers.splice(0).forEach(resolve => resolve(3));
  await tick();
  expect(probe()).toBe(false);
});
