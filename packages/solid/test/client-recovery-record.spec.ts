/**
 * The `"recovery"` record: the client rendering a boundary the server handed
 * over. Claim under test: when a `<Loading>` boundary's fragment rejects —
 * already rejected at hydration, or rejecting while the stream is still open
 * — the boundary renders its children as fresh client DOM and, when a
 * listener is subscribed, one record is emitted with the boundary's id, how
 * long the fallback stood (`waitedMs`) and what the fresh render cost
 * (`renderMs`). No listener, no clock read; a fragment that resolves emits
 * nothing.
 */
import { afterEach, describe, expect, test } from "vitest";
import { createRoot, flush, OBSERVE } from "@solidjs/signals";
import { createMemo, enableHydration, sharedConfig } from "../src/client/hydration.js";
import type { RecoveryEvent } from "../src/recovery.js";
import { Loading } from "../src/client/flow.js";

enableHydration();

let hydrationData: Record<string, any> = {};

function startHydration(data: Record<string, any>) {
  hydrationData = data;
  (globalThis as any)._$HY = {
    modules: {},
    loading: {},
    r: data,
    events: [],
    completed: new WeakSet()
  };
  sharedConfig.hydrating = true;
  (sharedConfig as any).has = (id: string) => id in hydrationData;
  (sharedConfig as any).load = (id: string) => hydrationData[id];
  (sharedConfig as any).gather = () => {};
}

function stopHydration() {
  sharedConfig.hydrating = false;
  (sharedConfig as any).has = undefined;
  (sharedConfig as any).load = undefined;
  (sharedConfig as any).gather = undefined;
  delete (globalThis as any)._$HY;
}

afterEach(() => {
  stopHydration();
  flush();
});

function listen() {
  const records: RecoveryEvent[] = [];
  const off = OBSERVE!.records.subscribe("recovery", event => records.push(event));
  return { records, off };
}

/** A boundary over a serialized memo, hydrating against `t0_fr`. */
function boundary() {
  let memo: any;
  let result: any;
  createRoot(
    () => {
      result = Loading({
        fallback: "loading...",
        get children() {
          memo = createMemo(() => 0);
          return (() => memo()) as any;
        }
      });
    },
    { id: "t" }
  );
  flush();
  return { result: () => result(), memo: () => memo() };
}

describe.skipIf(OBSERVE === undefined)("recovery record", () => {
  test("a fragment that rejects while streaming: the fallback's wait and the fresh render", async () => {
    const { records, off } = listen();
    let rejectFr!: (e: any) => void;
    const frPromise: any = new Promise<boolean>((_, rej) => (rejectFr = rej));
    frPromise.s = 0;
    startHydration({ t0_fr: frPromise, t0000: { s: 1, v: 7 } });
    const before = performance.now();
    const b = boundary();
    expect(b.result()).toBe("loading...");
    expect(records).toHaveLength(0);

    await new Promise<void>(r => setTimeout(r, 30));
    rejectFr(new Error("stream error"));
    await new Promise<void>(r => setTimeout(r, 20));
    flush();
    // Fresh client DOM: the serialized 7 was never adopted.
    expect(b.memo()).toBe(0);
    expect(records).toHaveLength(1);
    const [event] = records;
    expect(event.id).toBe("t0");
    expect(event.at).toBeGreaterThanOrEqual(before);
    expect(event.waitedMs).toBeGreaterThanOrEqual(25);
    expect(event.renderMs).toBeGreaterThanOrEqual(0);
    expect(event.renderMs).toBeLessThan(event.waitedMs);
    off();
  });

  test("a fragment already rejected at hydration: no wait, a fresh render", async () => {
    const { records, off } = listen();
    const frPromise: any = Promise.reject(new Error("stream error"));
    frPromise.catch(() => {});
    frPromise.s = 2;
    startHydration({ t0_fr: frPromise, t0000: { s: 1, v: 7 } });
    const b = boundary();
    await new Promise<void>(r => setTimeout(r, 10));
    flush();
    expect(b.memo()).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: "t0" });
    expect(records[0].waitedMs).toBeLessThan(5);
    off();
  });

  test("a fragment that resolves is not a recovery", async () => {
    const { records, off } = listen();
    let resolveFr!: (v: boolean) => void;
    const frPromise: any = new Promise<boolean>(r => (resolveFr = r));
    frPromise.s = 0;
    startHydration({ t0_fr: frPromise, t0000: { s: 1, v: 99 } });
    const b = boundary();
    resolveFr(true);
    await new Promise<void>(r => setTimeout(r, 20));
    flush();
    expect(b.memo()).toBe(99);
    expect(records).toHaveLength(0);
    off();
  });

  test("with no listener the boundary still recovers, and nothing is recorded", async () => {
    expect(OBSERVE!.records.observed("recovery")).toBe(false);
    const frPromise: any = Promise.reject(new Error("stream error"));
    frPromise.catch(() => {});
    frPromise.s = 2;
    startHydration({ t0_fr: frPromise, t0000: { s: 1, v: 7 } });
    const b = boundary();
    await new Promise<void>(r => setTimeout(r, 10));
    flush();
    expect(b.memo()).toBe(0);
  });
});
