/**
 * @vitest-environment jsdom
 *
 * The serialized-value latch after the root hydration pass: a node that
 * adopted its server value and sits outside every pending streamed boundary
 * recomputes on a client write; a node under a boundary still pending keeps
 * the server value until that boundary resumes.
 */
import { afterEach, expect, test } from "vitest";
import { createRoot, flush } from "@solidjs/signals";
import {
  enableHydration,
  sharedConfig,
  createMemo,
  createSignal
} from "../src/client/hydration.js";
import { Loading } from "../src/client/flow.js";

enableHydration();

function startHydration(data: Record<string, any>) {
  (globalThis as any)._$HY = {
    modules: {},
    loading: {},
    r: data,
    events: [],
    completed: new WeakSet()
  };
  sharedConfig.hydrating = true;
  (sharedConfig as any).has = (id: string) => id in data;
  (sharedConfig as any).load = (id: string) => data[id];
  (sharedConfig as any).gather = () => {};
  (sharedConfig as any).registry = new Map();
}

function stopHydration() {
  sharedConfig.hydrating = false;
  (sharedConfig as any).has = undefined;
  (sharedConfig as any).load = undefined;
  (sharedConfig as any).gather = undefined;
  delete (globalThis as any)._$HY;
}

afterEach(() => stopHydration());

test("after the root pass, a write reaches a shell node outside the pending boundary", () => {
  // `t1` is the streamed boundary, still pending; `t0` the shell memo and
  // `t10` a memo its fallback creates, both serialized as 100.
  const fr: any = new Promise(() => {});
  fr.s = 0;
  startHydration({ t0: 100, t1_fr: fr, t10: 100 });
  let shell!: () => number, held!: () => number, setS!: (v: number) => void;
  const dispose = createRoot(
    d => {
      const [s, set] = createSignal(1, { ownedWrite: true });
      setS = set;
      shell = createMemo(() => s());
      Loading({
        get fallback() {
          held = createMemo(() => s());
          return "loading";
        },
        get children() {
          return (() => s()) as any;
        }
      });
      return d;
    },
    { id: "t" }
  );
  flush();
  expect([shell(), held()]).toEqual([100, 100]);
  // hydrate()'s `finally`: the root pass is over, the boundary still pending.
  sharedConfig.hydrating = false;

  setS(2);
  flush();
  expect(shell()).toBe(2);
  expect(held()).toBe(100);
  expect(sharedConfig.isHydrationInProgress!()).toBe(true);
  dispose();
});
