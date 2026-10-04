import { expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  deep,
  flush,
  snapshot
} from "../src/index.js";

// L2 (was: a boundary `_checkSources` hook re-entering the parked action's
// transaction from an ambient flush). A write to a node an action holds,
// made from an unrelated flush — here a user effect of an unrelated tick —
// joins the hold (A34: a write on a held node entangles its tick): the
// written value stays held, nothing it dirtied shows, and it reveals with
// the action.
it("keeps writes and effects held when an unrelated flush re-enters an action's hold", async () => {
  const gate = Promise.withResolvers<void>();
  const rendered: number[] = [];
  const [value, setValue] = createSignal(0);
  const [tick, setTick] = createSignal(0);
  const dispose = createRoot(dispose => {
    createRenderEffect(value, v => {
      rendered.push(v);
    });
    // Writing a signal held by the parked action re-enters its transaction.
    createEffect(tick, t => {
      if (t === 1) setValue(2);
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

  try {
    // Unrelated work: its effect writes into the hold.
    setTick(1);
    flush();
    flush();
    expect.soft(value()).toBe(0);
    expect.soft(rendered).toEqual([0]);
  } finally {
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

// L2 (was: a `_checkSources` hook writing an ambient signal and then a held
// one, inside finalize). A tick that writes a plain signal and a node an
// action holds is one proposal (A34): both writes are held with the action
// and their effects release together — state and DOM stay consistent.
it("holds a pre-entry write and its effect together with the entered transaction", async () => {
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
    createEffect(tick, t => {
      if (t === 1) {
        setOther(1); // ambient, staged before the entry
        setValue(2); // enters the parked action
      }
    });
    return dispose;
  });
  flush();

  const start = action(function* () {
    setValue(1);
    yield gate.promise;
  });
  const done = start();
  flush();

  try {
    setTick(1);
    flush();
    flush();
    expect.soft(tick()).toBe(1);
    expect.soft(renderedTick).toEqual([0, 1]);
    expect.soft(value()).toBe(0);
    expect.soft(renderedValue).toEqual([0]);
    expect.soft(other()).toBe(0);
    expect.soft(renderedOther).toEqual([0]);
  } finally {
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
