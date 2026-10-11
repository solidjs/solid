import { expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  until
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

for (const via of ["direct", "memo"] as const)
  it(`until() ${via} resolves on the source confirming the guess (#3943)`, async () => {
    let setSource!: (v: number) => void;
    let save!: () => Promise<unknown>;
    createRoot(() => {
      const [source, ss] = createSignal(0);
      setSource = ss;
      const [count, guess] = createOptimistic(() => source());
      const doubled = createMemo(() => count() * 2);
      createRenderEffect(count, () => {});
      createRenderEffect(doubled, () => {});
      save = action(function* () {
        guess(1);
        yield Promise.resolve();
        yield until(() => (via === "memo" ? doubled() === 2 : count() === 1));
      });
    });
    flush();
    let done = false;
    save().then(() => (done = true));
    await tick();
    expect(done).toBe(false);
    setSource(1);
    flush();
    await tick();
    expect(done).toBe(true);
  });
