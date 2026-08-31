/**
 * Regression tests for #3104 — a latest()-mode isPending probe answered
 * differently depending on what had been read earlier in the tick.
 *
 * A probe through latest() answers for the SHADOW companion by design (the
 * read() dispatch collects it deliberately): the verdict reflects async
 * still in flight for the latest view, not the parent's held write — a
 * reader that sees the fresh staged value must not also be told it is
 * pending (#2831). But latestRead's untracked mid-tick pull (#2922) ran a
 * stale shadow's recompute with the probe still live, so the shadow's own
 * `read(parent)` collected the parent too and flipped the verdict to the
 * parent's held-write answer. Whether the shadow was stale depended on what
 * had pulled it earlier in the tick — reading `latest(m)` before the probe
 * flipped a later `latest(() => isPending(x))` from true to false.
 */
import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

describe("latest-mode probe order independence (#3104)", () => {
  function stage(withExternalLatestRead: boolean) {
    const [count, setCount] = createSignal(0);
    // Ownerless, like the issue's setTimeout-created memo.
    const m1 = createMemo(() => latest(() => isPending(count)));

    expect(m1()).toBe(false);
    expect(isPending(count)).toBe(false);

    setCount(v => v + 1);

    const reads = {
      m1Internal: m1(),
      m1External: withExternalLatestRead ? latest(m1) : undefined,
      direct: isPending(count),
      latestProbe: latest(() => isPending(count))
    };
    flush();
    return { reads, settled: { m1: m1(), direct: isPending(count) } };
  }

  it("latest(() => isPending(x)) answers the same whether or not latest(m) was read before it", () => {
    const withRead = stage(true);
    const without = stage(false);

    // The heisenberg: these two used to disagree (false vs true).
    expect(withRead.reads.latestProbe).toBe(without.reads.latestProbe);

    // The designed pre-flush answers for a plain staged write: the direct
    // probe reports the held write; every latest-flavored probe saw the
    // fresh value in the latest view, so it must not also report pending.
    expect(withRead.reads).toEqual({
      m1Internal: false, // memo created pre-write, no flush seen yet (#3078)
      m1External: false,
      direct: true,
      latestProbe: false
    });
    expect(without.reads).toMatchObject({
      m1Internal: false,
      direct: true,
      latestProbe: false
    });

    // Post-flush the plain write has committed everywhere.
    expect(withRead.settled).toEqual({ m1: false, direct: false });
    expect(without.settled).toEqual({ m1: false, direct: false });
  });

  // isPending probes running inside a latest() window (mizulu's memo is
  // exactly `latest(() => isPending(count))`) left latest mode active during
  // the probe's companion-verdict reads, so `read(getPendingSignal(...))`
  // dispatched through latestRead and built a shadow OF THE PENDING SIGNAL.
  // The next flush's updatePendingSignal wrote that companion-on-companion
  // from inside a recompute and halted dev with the owned-scope write guard.
  it("isPending inside a latest window survives subsequent flushes and stays coherent", async () => {
    const tick = async () => {
      await new Promise(r => setTimeout(r, 0));
      flush();
    };
    const log: string[] = [];
    let setA!: (v: number) => void;
    const resolvers: Array<() => void> = [];
    let dispose!: () => void;

    createRoot(d => {
      dispose = d;
      const [a, set] = createSignal(0);
      setA = set;
      const double = createMemo(async () => {
        const x = a();
        await new Promise<void>(r => {
          resolvers.push(r);
        });
        return x * 2;
      });
      createRenderEffect(
        () => {
          try {
            return double();
          } catch {
            return "THROWN";
          }
        },
        () => {}
      );
      createRenderEffect(
        () =>
          `plain=${isPending(() => a())} latestP=${latest(() =>
            isPending(() => a())
          )} latestPm=${latest(() => isPending(() => double()))}`,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    resolvers.splice(0).forEach(r => r());
    await tick(); // used to throw REACTIVE_WRITE_IN_OWNED_SCOPE here
    expect(log[log.length - 1]).toBe("plain=false latestP=false latestPm=false");

    // Refetch in flight: the direct probe reports the held input; the
    // latest-window probe of the SIGNAL saw the staged value (pairing rule,
    // #2831); the latest-window probe of the async MEMO stays pending — its
    // answer is still computing, so there is nothing fresher to see (#3028).
    setA(1);
    flush();
    expect(log[log.length - 1]).toBe("plain=true latestP=false latestPm=true");

    resolvers.splice(0).forEach(r => r());
    await tick();
    expect(log[log.length - 1]).toBe("plain=false latestP=false latestPm=false");
    dispose();
  });
});
