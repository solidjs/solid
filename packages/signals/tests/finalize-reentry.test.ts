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

// Effect ownership: a run applies with the commit of the transaction that
// computed its value. The flush that entered a transaction mid-finalize still
// applies everything it computed mainline — otherwise the write that caused the
// flush reads committed while its own render stays stale until the entered
// transaction settles.
it("applies mainline-computed effects in the flush that entered a transaction", async () => {
  const settingsResponse = Promise.withResolvers<{ pins: string[] }>();
  const configResponse = Promise.withResolvers<{ ready: boolean }>();
  const [refreshRequested, setRefreshRequested] = createSignal(false);
  const [tick, setTick] = createSignal(0);
  const rendered: string[][] = [];
  const ticks: number[] = [];

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
    createRenderEffect(tick, t => {
      ticks.push(t);
    });
    return dispose;
  });
  flush();

  try {
    setRefreshRequested(true);
    flush();
    settingsResponse.resolve({ pins: ["new pin"] });
    await Promise.resolve();
    flush();
    expect.soft(rendered).toEqual([[]]);

    // The tick flush commits the settings backing; its deep() notification
    // enters the held transaction from commitPendingNodes().
    setTick(1);
    flush();
    expect.soft(tick()).toBe(1);
    // Computed mainline before finalize → applied by this flush (no read/DOM split).
    expect.soft(ticks).toEqual([0, 1]);
    // Computed under the entered transaction → parked with it.
    expect.soft(rendered).toEqual([[]]);

    configResponse.resolve({ ready: true });
    await Promise.resolve();
    flush();
    expect(rendered).toEqual([[], ["new pin"]]);
    expect(ticks).toEqual([0, 1]);
  } finally {
    settingsResponse.resolve({ pins: ["new pin"] });
    configResponse.resolve({ ready: true });
    await Promise.resolve();
    flush();
    dispose();
    flush();
  }
});

// A write staged during finalize BEFORE the entry is adopted by the entered
// transaction (held). Finalize's heap runs after its hooks, so the dependent
// effect recomputes after the entry, owner-stamped, and parks with it: state
// and DOM stay consistent and release together.
it("holds a pre-entry hook write and its effect together with the entered transaction", async () => {
  const gate = Promise.withResolvers<void>();
  const [value, setValue] = createSignal(0);
  const [other, setOther] = createSignal(0);
  const [tick, setTick] = createSignal(0);
  const renderedValue: number[] = [];
  const renderedOther: number[] = [];
  const renderedTick: number[] = [];
  const dispose = createRoot(dispose => {
    createRenderEffect(value, v => void renderedValue.push(v));
    createRenderEffect(other, v => void renderedOther.push(v));
    createRenderEffect(tick, v => void renderedTick.push(v));
    return dispose;
  });
  flush();

  const start = action(function* () {
    setValue(1);
    yield gate.promise;
  });
  const done = start();
  flush();

  let checked = false;
  const boundary = Object.assign(new Queue(), {
    _checkSources() {
      if (checked) return;
      checked = true;
      setOther(1); // ambient, staged before the entry
      setValue(2); // enters the parked action
    }
  });
  globalQueue.addChild(boundary);
  try {
    setTick(1);
    flush();
    expect.soft(tick()).toBe(1);
    expect.soft(renderedTick).toEqual([0, 1]);
    expect.soft(value()).toBe(0);
    expect.soft(renderedValue).toEqual([0]);
    expect.soft(other()).toBe(0);
    expect.soft(renderedOther).toEqual([0]);
  } finally {
    globalQueue.removeChild(boundary);
    gate.resolve();
    await done;
    flush();
  }
  expect(value()).toBe(2);
  expect(other()).toBe(1);
  expect(renderedValue).toEqual([0, 2]);
  expect(renderedOther).toEqual([0, 1]);
  dispose();
  flush();
});
