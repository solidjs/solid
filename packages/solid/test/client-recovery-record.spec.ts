/**
 * The `"recovery"` record: the client rendering a boundary the server handed
 * over. Claim under test: when a `<Loading>` boundary's fragment rejects —
 * already rejected at hydration, or rejecting while the stream is still open
 * — the boundary renders its children as fresh client DOM and, when a
 * listener is subscribed, one record is emitted with the boundary's id, how
 * long the fallback stood (`waitedMs`) and what the fresh render cost
 * (`renderMs`). No listener, no clock read; a fragment that resolves emits
 * nothing.
 *
 * The numbers are cut from three `performance.now()` reads in the runtime:
 * at registration, when the rejection reaches the boundary, and after the
 * fresh render commits. On the wall clock the "already rejected" case read
 * 7–13ms between the first two on a loaded CI worker (a microtask hop under
 * coverage instrumentation), against a `< 5` bound — so the clock is the
 * test's (the #3598 pattern): it stands still unless the test advances it,
 * and every duration is asserted exactly. Real timers still let the
 * promises settle; only the stamps are ours.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

/** The test's clock: what `performance.now()` returns until the test moves it. */
const T0 = 1000;
let t = T0;
/** What the fresh render of the children costs on the test's clock. */
const RENDER_MS = 2;

/** The one live `"recovery"` subscription, torn down by `afterEach` whether or not the test reached its end. */
let off: (() => void) | undefined;

beforeEach(() => {
  t = T0;
  vi.spyOn(performance, "now").mockImplementation(() => t);
});

afterEach(() => {
  off?.();
  off = undefined;
  vi.restoreAllMocks();
  stopHydration();
  flush();
});

function listen() {
  const records: RecoveryEvent[] = [];
  off = OBSERVE!.records.subscribe("recovery", event => records.push(event));
  return records;
}

/**
 * A boundary over a serialized memo, hydrating against `t0_fr`. Rendering
 * the children advances the clock by `RENDER_MS`, so `renderMs` proves the
 * fresh render sits between the runtime's last two reads.
 */
function boundary() {
  let memo: any;
  let result: any;
  createRoot(
    () => {
      result = Loading({
        fallback: "loading...",
        get children() {
          t += RENDER_MS;
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
    const records = listen();
    let rejectFr!: (e: any) => void;
    const frPromise: any = new Promise<boolean>((_, rej) => (rejectFr = rej));
    frPromise.s = 0;
    startHydration({ t0_fr: frPromise, t0000: { s: 1, v: 7 } });
    const b = boundary();
    expect(b.result()).toBe("loading...");
    expect(records).toHaveLength(0);

    // The fallback stood for 30ms on the test's clock before the server gave up.
    t += 30;
    rejectFr(new Error("stream error"));
    await new Promise<void>(r => setTimeout(r, 20));
    flush();
    // Fresh client DOM: the serialized 7 was never adopted.
    expect(b.memo()).toBe(0);
    expect(records).toEqual([{ id: "t0", at: T0, waitedMs: 30, renderMs: RENDER_MS }]);
  });

  test("a fragment already rejected at hydration: no wait, a fresh render", async () => {
    const records = listen();
    const frPromise: any = Promise.reject(new Error("stream error"));
    frPromise.catch(() => {});
    frPromise.s = 2;
    startHydration({ t0_fr: frPromise, t0000: { s: 1, v: 7 } });
    const b = boundary();
    await new Promise<void>(r => setTimeout(r, 10));
    flush();
    expect(b.memo()).toBe(0);
    // The rejection had already arrived when the boundary registered: the
    // clock did not move between registration and the recovery, so the
    // person saw no fallback — `waitedMs` is exactly 0.
    expect(records).toEqual([{ id: "t0", at: T0, waitedMs: 0, renderMs: RENDER_MS }]);
  });

  test("a fragment that resolves is not a recovery", async () => {
    const records = listen();
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
    // The runtime never read the clock: `registeredAt` is -1 with no listener.
    expect(performance.now).not.toHaveBeenCalled();
  });
});
