/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from "vitest";
import { createRoot, flush, isPending } from "@solidjs/signals";
import {
  enableHydration,
  sharedConfig,
  createDeferred,
  createSignal,
  createRenderEffect
} from "../src/client/hydration.js";

enableHydration();

function startHydration(data: Record<string, any>) {
  sharedConfig.hydrating = true;
  (sharedConfig as any).has = (id: string) => id in data;
  (sharedConfig as any).load = (id: string) => data[id];
  (sharedConfig as any).gather = () => {};
}
function stopHydration() {
  sharedConfig.hydrating = false;
  (sharedConfig as any).has = undefined;
  (sharedConfig as any).load = undefined;
  (sharedConfig as any).gather = undefined;
}
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

describe("createDeferred hydration (D-40)", () => {
  afterEach(stopHydration);

  test("the server's answer is its first: the first client refetch lags it", async () => {
    startHydration({ t0: 42 });
    let setN!: (v: number) => void;
    let d!: () => number;
    const fetches: number[] = [];
    const gates: Array<() => void> = [];
    const log: string[] = [];
    createRoot(
      () => {
        const [n, set] = createSignal(1);
        setN = set;
        d = createDeferred(() => {
          const v = n();
          fetches.push(v);
          return new Promise<number>(r => gates.push(() => r(v * 100)));
        });
        createRenderEffect(
          () => `${d()} ${isPending(d)}`,
          v => void log.push(v)
        );
      },
      { id: "t" }
    );
    flush();
    stopHydration();
    await tick();
    expect(log).toEqual(["42 false"]);

    setN(2);
    flush();
    expect(fetches[fetches.length - 1]).toBe(2);
    expect(log).toEqual(["42 false", "42 true"]);
    gates.pop()!();
    await tick();
    expect(log).toEqual(["42 false", "42 true", "200 false"]);
  });
});
