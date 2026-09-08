import { expect, it } from "vitest";
import {
  action,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  deep,
  flush,
  snapshot
} from "../src/index.js";
import { Queue, globalQueue } from "../src/core/scheduler.js";

it("keeps writes and effects held when a boundary check re-enters an action", async () => {
  const gate = Promise.withResolvers<void>();
  const rendered: number[] = [];
  const [value, setValue] = createSignal(0);
  const [, setTick] = createSignal(0);
  const dispose = createRoot(dispose => {
    createRenderEffect(value, v => {
      rendered.push(v);
    });
    return dispose;
  });
  flush();

  const start = action(function* () {
    setValue(1);
    yield gate.promise;
  });
  // Park the action with value=1 staged but uncommitted.
  const done = start();
  flush();

  let checked = false;
  const boundary = Object.assign(new Queue(), {
    _checkSources() {
      if (checked) return;
      checked = true;
      // Writing a signal owned by the parked action re-enters its transaction.
      setValue(2);
    }
  });
  globalQueue.addChild(boundary);
  try {
    // Unrelated work starts an ambient flush that checks boundary sources.
    setTick(1);
    flush();
    expect.soft(value()).toBe(0);
    expect.soft(rendered).toEqual([0]);
  } finally {
    globalQueue.removeChild(boundary);
    gate.resolve();
    await done;
    flush();
    dispose();
    flush();
  }
  expect(rendered).toEqual([0, 2]);
});

it("releases a deep projection reader after store-commit re-entry during a refetch", async () => {
  const settingsResponse = Promise.withResolvers<{ pins: string[] }>();
  const configResponse = Promise.withResolvers<{ ready: boolean }>();
  const [refreshRequested, setRefreshRequested] = createSignal(false);
  const [, setTick] = createSignal(0);
  const rendered: string[][] = [];

  const dispose = createRoot(dispose => {
    const settings = createProjection<{ pins: string[] }>(
      () => (refreshRequested() ? settingsResponse.promise : { pins: [] }),
      { pins: [] }
    );
    const config = createProjection(
      () => (refreshRequested() ? configResponse.promise : { ready: false }),
      { ready: false }
    );
    const pins = createMemo(() => snapshot(deep(settings.pins)));
    createRenderEffect(pins, value => {
      rendered.push([...value]);
    });
    createRenderEffect(
      () => config.ready,
      () => {}
    );
    return dispose;
  });
  flush();

  try {
    // Both refetches join one transition.
    setRefreshRequested(true);
    flush();

    // Settings settles first; the config response still holds the render.
    settingsResponse.resolve({ pins: ["new pin"] });
    await Promise.resolve();
    flush();
    expect.soft(rendered).toEqual([[]]);

    // An unrelated flush commits the settings store backing. Its deep()
    // notification re-enters the held transaction from commitPendingNodes().
    setTick(1);
    flush();
    expect.soft(rendered).toEqual([[]]);

    // Completing the last refetch must release the parked render.
    configResponse.resolve({ ready: true });
    await Promise.resolve();
    flush();
    expect(rendered).toEqual([[], ["new pin"]]);
  } finally {
    settingsResponse.resolve({ pins: ["new pin"] });
    configResponse.resolve({ ready: true });
    await Promise.resolve();
    flush();
    dispose();
    flush();
  }
});
