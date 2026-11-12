/**
 * A15 for lanes (#3335, lanes.ts `linkLanes`): lanes one pass derives from
 * are one reveal unit — each blocked while any is. Two link groups can form
 * apart (two pairs of actions, each pair read by its own memo) and a later
 * reader of one lane from each group joins the two groups into one. The
 * observable: a re-guess in the first group's lane waits for a flight in
 * the second group's lane, as it would had every lane been read by one
 * memo. Found reachable 2026-11-10 (the unreached-arm inventory,
 * reader-seat-rebuild.md §9.5): the merge arm fired in no suite and no
 * generator case until this shape.
 */
import { expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};
const never = () => new Promise<never>(() => {});

it("a later reader across two link groups makes one reveal unit: a re-guess in one waits for the other's flight", async () => {
  const g = [0, 1, 2, 3].map(() => createOptimistic(0));
  const [open, setOpen] = createSignal(false);
  const seen: string[] = [];
  let resolveD: (v: number) => void = () => {};
  const dispose = createRoot(dispose => {
    const X = createMemo(() => g[0][0]() + g[1][0]());
    const Y = createMemo(() => g[2][0]() + g[3][0]());
    // D's own derivation in flight blocks lane D (lane rule 3).
    const dd = createMemo(async () => {
      const v = g[3][0]();
      return v === 0 ? v : new Promise<number>(r => (resolveD = r));
    });
    createRenderEffect(
      () => `X ${X()}`,
      v => void seen.push(v)
    );
    createRenderEffect(
      () => `Y ${Y()} dd ${dd()}`,
      v => void seen.push(v)
    );
    const Z = createMemo(() => (open() ? g[1][0]() + g[2][0]() : -1));
    createRenderEffect(
      () => `Z ${Z()}`,
      v => void seen.push(v)
    );
    return dispose;
  });
  try {
    flush();
    const acts = [0, 1, 2, 3].map(i =>
      action(function* (v: number) {
        g[i][1](v);
        yield never();
      })
    );
    // Lanes A, B (read together by X: one group) and C, D (by Y: another).
    for (let i = 0; i < 3; i++) {
      acts[i](i + 1);
      flush();
      await tick();
    }
    acts[3](4);
    flush();
    await tick();
    expect(seen).toEqual(["X 0", "Z -1", "X 1", "Y 0 dd 0", "X 3", "Y 3 dd 0"]);
    // Z mounts reading B and C: the two groups are one unit, blocked with D.
    setOpen(true);
    flush();
    await tick();
    // A re-guess in A waits with the unit: nothing shows until D's flight lands.
    acts[0](10);
    flush();
    await tick();
    expect(seen.length).toBe(6);
    resolveD(4);
    await tick();
    await tick();
    expect(seen.slice(6)).toEqual(["Y 7 dd 4", "X 12", "Z 5"]);
  } finally {
    dispose();
  }
});
