// #3802: a render effect born held under an action, re-run by a write to a
// committed source, ran its callback with no committed value.

import { afterEach, expect, it, vi } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

afterEach(() => vi.restoreAllMocks());

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
}

it("a re-staging pass of a born-held effect does not run it before the commit", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const [value, setValue] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  const [title, setTitle] = createSignal("");
  let resolve!: () => void;
  const gate = new Promise<void>(r => (resolve = r));
  const runs: [boolean, string][] = [];

  const save = action(function* () {
    setValue(true);
    yield gate;
  });

  createRoot(() => {
    const child = createMemo(() => {
      if (!mounted()) return;
      createMemo(() => value());
      createRenderEffect(
        () => ({ v: value(), t: title() }),
        state => {
          runs.push([state.v, state.t]);
        }
      );
    });
    createRenderEffect(child, () => {});
  });
  flush();

  const pending = save();
  await settle();
  setMounted(true);
  await settle();
  setTitle("Updated");
  await settle();

  expect(error).not.toHaveBeenCalled();
  expect(runs).toEqual([]);

  resolve();
  await pending;
  await settle();

  expect(error).not.toHaveBeenCalled();
  expect(runs).toEqual([[true, "Updated"]]);
});

// The same effect re-derived by an optimistic write's lane rather than a
// mainline write: the lane's run had nothing committed to apply either.
it("a lane pass of a born-held effect does not run it with no committed value", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const [value, setValue] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  const [guess, setGuess] = createOptimistic(0);
  let resolveSave!: () => void;
  let resolveVote!: () => void;
  const runs: [boolean, number][] = [];

  const save = action(function* () {
    setValue(true);
    yield new Promise<void>(r => (resolveSave = r));
  });
  const vote = action(function* () {
    setGuess(5);
    yield new Promise<void>(r => (resolveVote = r));
  });

  createRoot(() => {
    const child = createMemo(() => {
      if (!mounted()) return;
      createMemo(() => value());
      createRenderEffect(
        () => ({ v: value(), g: guess() }),
        state => {
          runs.push([state.v, state.g]);
        }
      );
    });
    createRenderEffect(child, () => {});
  });
  flush();

  const saving = save();
  await settle();
  setMounted(true);
  await settle();
  const voting = vote();
  await settle();

  expect(error).not.toHaveBeenCalled();

  resolveVote();
  await voting;
  await settle();
  resolveSave();
  await saving;
  await settle();

  expect(error).not.toHaveBeenCalled();
  expect(runs.at(-1)).toEqual([true, 0]);
});
