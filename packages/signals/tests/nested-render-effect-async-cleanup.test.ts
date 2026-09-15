import { describe, expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  onCleanup
} from "../src/index.js";

// Manual clock (see async-chain-supersession.test.ts).
let now = 0;
let timers: { at: number; run: () => void }[] = [];
function delay<T>(ms: number, value?: T): Promise<T> {
  return new Promise<T>(r => timers.push({ at: now + ms, run: () => r(value as T) }));
}
async function settle() {
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
  }
}
async function advanceTo(t: number) {
  while (true) {
    timers.sort((a, b) => a.at - b.at);
    const next = timers[0];
    if (!next || next.at > t) break;
    timers.shift();
    now = next.at;
    next.run();
    await settle();
  }
  now = t;
  await settle();
}
function reset() {
  now = 0;
  timers = [];
}

describe("#3404 nested render effect reading a downstream async value", () => {
  it("does not clean up the inner effect until the whole chain has settled", async () => {
    reset();
    const log: string[] = [];
    let setA!: (fn: (v: number) => number) => void;
    createRoot(() => {
      const [a, sa] = createSignal(1);
      setA = sa;
      const b = createMemo(() => delay(500, a()));
      const c = createMemo(() => delay(1000, b()));
      createLoadingBoundary(
        () => {
          createRenderEffect(
            () => {
              b();
              createRenderEffect(c, v => {
                log.push(`run ${v}@${now}`);
                return () => log.push(`cleanup ${v}@${now}`);
              });
            },
            () => {}
          );
        },
        () => {}
      );
    });
    flush();
    await advanceTo(2000);
    expect(log).toEqual(["run 1@1500"]);

    setA(x => x + 1);
    flush();
    await advanceTo(2400);
    expect(log).toEqual(["run 1@1500"]);
    // b lands at 2500 but c is still in flight until 3500: nothing observable.
    await advanceTo(3000);
    expect(log).toEqual(["run 1@1500"]);
    await advanceTo(4000);
    expect(log).toEqual(["run 1@1500", "cleanup 1@3500", "run 2@3500"]);
  });

  it("a memo's onCleanup registrations wait for the commit the same way", async () => {
    reset();
    const log: string[] = [];
    let setA!: (fn: (v: number) => number) => void;
    createRoot(() => {
      const [a, sa] = createSignal(1);
      setA = sa;
      const b = createMemo(() => delay(500, a()));
      const c = createMemo(() => delay(1000, b()));
      createLoadingBoundary(
        () => {
          const outer = createMemo(() => {
            const v = b();
            onCleanup(() => log.push(`cleanup ${v}@${now}`));
            return v;
          });
          createRenderEffect(
            () => [outer(), c()],
            ([o, cc]) => {
              log.push(`run ${o}/${cc}@${now}`);
            }
          );
        },
        () => {}
      );
    });
    flush();
    await advanceTo(2000);
    expect(log).toEqual(["run 1/1@1500"]);

    setA(x => x + 1);
    flush();
    await advanceTo(3000);
    expect(log).toEqual(["run 1/1@1500"]);
    await advanceTo(4000);
    expect(log).toEqual(["run 1/1@1500", "cleanup 1@3500", "run 2/2@3500"]);
  });

  it("children built under the hold are torn down on the next held re-run, the frame's at commit", async () => {
    reset();
    const log: string[] = [];
    let setA!: (fn: (v: number) => number) => void;
    let setTick!: (fn: (v: number) => number) => void;
    createRoot(() => {
      const [a, sa] = createSignal(1);
      const [tick, st] = createSignal(0);
      setA = sa;
      setTick = st;
      const b = createMemo(() => delay(500, a()));
      const c = createMemo(() => delay(1000, b()));
      createLoadingBoundary(
        () => {
          createRenderEffect(
            () => {
              const v = b();
              const t = tick();
              createRenderEffect(c, cv => {
                log.push(`run ${v}.${t}/${cv}@${now}`);
                return () => log.push(`cleanup ${v}.${t}/${cv}@${now}`);
              });
            },
            () => {}
          );
        },
        () => {}
      );
    });
    flush();
    await advanceTo(2000);
    expect(log).toEqual(["run 1.0/1@1500"]);

    setA(x => x + 1);
    flush();
    // b lands at 2500: the outer effect re-runs under the hold, building an
    // inner effect that never runs (c is in flight). A sync write while the
    // hold is open re-runs it mainline (contested, #3322): the held inner
    // effect dies silently, the frame's is replaced on the spot, and the
    // transaction's re-derive builds a fresh held one for the reveal.
    await advanceTo(2600);
    setTick(t => t + 1);
    flush();
    await advanceTo(3000);
    expect(log).toEqual(["run 1.0/1@1500", "run 1.1/1@2600", "cleanup 1.0/1@2600"]);
    await advanceTo(4000);
    expect(log).toEqual([
      "run 1.0/1@1500",
      "run 1.1/1@2600",
      "cleanup 1.0/1@2600",
      "cleanup 1.1/1@3500",
      "run 2.1/2@3500"
    ]);
  });

  it("a plain sync re-run still releases the previous children at its own commit", () => {
    const log: string[] = [];
    let setA!: (fn: (v: number) => number) => void;
    createRoot(() => {
      const [a, sa] = createSignal(1);
      setA = sa;
      createRenderEffect(
        () => {
          const v = a();
          createRenderEffect(
            () => v,
            cv => {
              log.push(`run ${cv}`);
              return () => log.push(`cleanup ${cv}`);
            }
          );
        },
        () => {}
      );
    });
    flush();
    expect(log).toEqual(["run 1"]);
    setA(x => x + 1);
    flush();
    expect(log).toEqual(["run 1", "run 2", "cleanup 1"]);
  });

  // #3444: a held `Show` removing its branch marks the branch's effects
  // zombies — they render mainline until the commit disposes them. Their
  // queued recomputes are cancelled when the parking batch IS the transaction
  // (the staged writes are a world a zombie never displays), but a zombie
  // dirtied through the lane channel displays exactly that: `latest(count)`
  // inside the branch stayed 0 while the same read outside showed 1.
  it("#3444 latest() inside a branch a held Show is removing follows the value outside", async () => {
    reset();
    const log: string[] = [];
    let save!: () => unknown;
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      save = action(function* () {
        setCount(1);
        yield delay(1000);
      });
      createRenderEffect(
        () => `Outside: ${latest(count)}`,
        v => {
          log.push(`${v}@${now}`);
        }
      );
      // Show: the branch's effects are owned by the run that built them.
      createRenderEffect(
        () => {
          if (count() === 0) {
            createRenderEffect(
              () => `Inside: ${latest(count)}`,
              v => {
                log.push(`${v}@${now}`);
              }
            );
            onCleanup(() => log.push(`Inside gone@${now}`));
          }
        },
        () => {}
      );
    });
    flush();
    await advanceTo(500);
    expect(log).toEqual(["Outside: 0@0", "Inside: 0@0"]);
    save();
    await settle();
    expect(log).toEqual(["Outside: 0@0", "Inside: 0@0", "Outside: 1@500", "Inside: 1@500"]);
    await advanceTo(2000);
    expect(log.slice(4)).toEqual(["Inside gone@1500"]);
  });
});
