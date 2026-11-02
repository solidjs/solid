import { afterEach, expect, it } from "vitest";
import {
  createEffect,
  createRoot,
  createSignal,
  createTrackedEffect,
  flush,
  onSettled
} from "../src/index.js";

afterEach(() => flush());

async function settle() {
  flush();
  await Promise.resolve();
  flush();
}

it("re-runs for a write another effect makes on its first run", async () => {
  const log: number[] = [];
  createRoot(() => {
    const [s, setS] = createSignal(0);
    createEffect(
      () => 1,
      () => {
        setS(1);
      }
    );
    createTrackedEffect(() => {
      log.push(s());
    });
  });
  await settle();
  expect(log).toEqual([0, 1]);
});

it("re-runs for a write the creator's onSettled makes", async () => {
  const log: number[] = [];
  createRoot(() => {
    const [s, setS] = createSignal(0);
    onSettled(() => {
      setS(1);
    });
    createTrackedEffect(() => {
      log.push(s());
    });
  });
  await settle();
  expect(log).toEqual([0, 1]);
});

it("does not re-run for writes that net to the committed value", async () => {
  const log: number[] = [];
  createRoot(() => {
    const [s, setS] = createSignal(0);
    createEffect(
      () => 1,
      () => {
        setS(1);
        setS(0);
      }
    );
    createTrackedEffect(() => {
      log.push(s());
    });
  });
  await settle();
  expect(log).toEqual([0]);
});
