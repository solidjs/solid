// #4362 / #4363: an uninitialized async memo whose compute reads `latest(s)`.
//
// A write to `s` re-asks the memo in a flush: its pass reads `s` through
// `latest`, so it is a verdict reader and runs as the write's verdict lane's
// work — a lane derivation (CONFIG_OVERRIDE) whose first pass is in flight
// and which has nothing in the lane yet. Two places fell back to the
// committed value of such a node, and an uninitialized node has none:
// - `latest(m)` / `isPending(m)` (verdictValue's lane arm) served `display`
//   / `laneValueOf` — `undefined` — and probed it pending (#4363);
// - the lane's end (`dissolveLane`, the parent landed) committed that
//   `undefined` as the node's answer, clearing STATUS_UNINITIALIZED with the
//   flight still up: a pending node with a fabricated value, which the
//   render effect then probed into the lane again every round (#4362's loop
//   guard; `[latest(m), isPending(m)]` in one effect).
// Both views of an uninitialized node throw NotReady until its first answer
// lands (A7; A19 exc. 1 — loading, not pending; S-28), however the reads are
// grouped into effects.
import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createTrackedEffect,
  flush,
  isPending,
  latest,
  untrack
} from "../src/index.js";

function show(f: () => unknown): string {
  try {
    return String(f());
  } catch (e) {
    return "throw:" + (e as Error).constructor.name;
  }
}

function setup() {
  const [s, set] = createSignal(1);
  const resolvers: Array<() => void> = [];
  let m!: () => number;
  createRoot(() => {
    m = createMemo(() => {
      const v = latest(s);
      return new Promise<number>(r => resolvers.push(() => r(v)));
    });
  });
  return { s, set, m, resolvers };
}

const NR = "throw:NotReadyError";

describe("uninitialized async memo over latest(s) (#4362, #4363)", () => {
  it("#4362: [latest(m), isPending(m)] in one render effect settles after the write", () => {
    const { set, m } = setup();
    const seen: string[] = [];
    createRoot(() =>
      createRenderEffect(
        () => show(() => [latest(m), isPending(m)]),
        v => {
          seen.push(v);
        }
      )
    );
    flush();
    set(2);
    expect(() => flush()).not.toThrow();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(v => v === NR)).toBe(true);
  });

  it("#4362: the issue's shape (no try/catch) does not trip the loop guard", () => {
    const [s, set] = createSignal(1);
    createRoot(() => {
      const m = createMemo(() => {
        const v = latest(s);
        return new Promise<number>(() => {}).then(() => v);
      });
      createRenderEffect(
        () => [latest(m), isPending(m)],
        () => {}
      );
    });
    flush();
    set(2);
    expect(() => flush()).not.toThrow();
  });

  it("#4363: latest(m) keeps throwing NotReady after its latest() input changes (A7)", () => {
    const { set, m } = setup();
    const log: string[] = [];
    createRoot(() =>
      createRenderEffect(
        () => show(() => latest(m)),
        v => {
          log.push(v);
        }
      )
    );
    flush();
    set(0);
    flush();
    // The issue's expectation: [NR, NR] (was [NR, "undefined"]).
    expect(log.length).toBeGreaterThan(0);
    expect(log.every(v => v === NR)).toBe(true);
  });

  it("each read shape keeps throwing NotReady, separate effects or grouped", () => {
    const shapes: Record<string, (m: () => number) => unknown> = {
      latest: m => latest(m),
      pending: m => isPending(m),
      latestPending: m => [latest(m), isPending(m)],
      pendingLatest: m => [isPending(m), latest(m)],
      pendingOfLatest: m => isPending(() => latest(m)),
      plain: m => m()
    };
    const { set, m } = setup();
    const last: Record<string, string> = {};
    createRoot(() => {
      for (const [name, f] of Object.entries(shapes))
        createRenderEffect(
          () => show(() => f(m)),
          v => {
            last[name] = v;
          }
        );
    });
    flush();
    set(2);
    flush();
    for (const name of Object.keys(shapes)) expect([name, last[name]]).toEqual([name, NR]);
  });

  it("the lane's end does not commit a value: a reader created after the write still loads", () => {
    const { set, m } = setup();
    createRoot(() =>
      createRenderEffect(
        () => show(() => [latest(m), isPending(m)]),
        () => {}
      )
    );
    flush();
    set(2);
    flush();
    expect(show(() => latest(m))).toBe(NR);
    expect(isPending(m)).toBe(false); // unowned: false (A16)
    let fresh = "";
    createRoot(() =>
      createRenderEffect(
        () => show(() => [latest(m), isPending(m)]),
        v => {
          fresh = v;
        }
      )
    );
    flush();
    expect(fresh).toBe(NR);
  });

  it("the re-ask's answer lands: latest(m) is the latest question's answer", async () => {
    const { set, m, resolvers } = setup();
    const log: string[] = [];
    createRoot(() =>
      createRenderEffect(
        () => show(() => [latest(m), isPending(m)]),
        v => {
          log.push(v);
        }
      )
    );
    flush();
    set(2);
    flush();
    expect(resolvers.length).toBe(2);
    resolvers[1]();
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(log[log.length - 1]).toBe("2,false");
    expect(show(() => latest(m))).toBe("2");
  });

  // A transaction held on other async keeps the verdict lane (and the memo
  // in it) alive past the flush: every reader that would be served the
  // lane's committed fallback — none exists — is NotReady instead.
  it("with the lane held: every read of the memo is NotReady", () => {
    const [s, set] = createSignal(1);
    let m!: () => number;
    createRoot(() => {
      m = createMemo(() => {
        const v = latest(s);
        return new Promise<number>(() => {}).then(() => v);
      });
      const h = createMemo(() => (s() === 1 ? 1 : new Promise<number>(() => {})));
      createRenderEffect(
        () => show(() => [h(), latest(m)]),
        () => {}
      );
    });
    flush();
    set(2);
    flush();
    const out: Record<string, string> = {
      plain: show(() => m()),
      untracked: show(() => untrack(m)),
      latest: show(() => latest(m))
    };
    createRoot(() => {
      out.rootBody = show(() => m());
      const memoUntrack = createMemo(() => show(() => untrack(m)));
      out.memoUntrack = memoUntrack();
      createTrackedEffect(() => {
        out.tracked = show(() => m());
      });
      createRenderEffect(
        () => show(() => [untrack(m), latest(m)]),
        v => {
          out.effect = v;
        }
      );
      // Loading, not pending (A19 exc. 1): owned, the probe propagates NotReady.
      out.probe = show(() => isPending(m));
      out.probeOfLatest = show(() => isPending(() => latest(m)));
    });
    flush();
    for (const [k, v] of Object.entries(out)) expect([k, v]).toEqual([k, NR]);
    expect(Object.keys(out).length).toBe(9);
    expect(isPending(m)).toBe(false); // unowned: false (A16)
  });
});
