// F6 (fuzz-findings-l2.test.ts) counts a boundary output forwarding its
// tree's pending as a frame reader of the lane. Its limits: an output that
// never committed (a mount the action staged, never shown) holds nothing —
// counting it strands the lane and the action's last write never publishes
// (fuzzer seed 91501 `latest` #138); a withdrawn mount's output is a zombie
// whose removal the action stages (A15); and nothing outlives a failed action.
import { expect, it } from "vitest";
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

const tick = () => new Promise<void>(r => setTimeout(r, 0));
async function drain(n = 4) {
  for (let i = 0; i < n; i++) {
    await tick();
    flush();
  }
}

function setup(fail = false) {
  const [s, setS] = createSignal(0);
  const [mounted, setMounted] = createSignal(true);
  const view = { out: "absent" as unknown };
  let resume!: () => void;
  let run!: () => Promise<void>;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const node0 = createMemo(() => Promise.resolve(latest(s)));
    createRenderEffect(
      () =>
        mounted()
          ? createRoot(dd => {
              const b = createLoadingBoundary(
                () => node0(),
                () => "loading"
              );
              createRenderEffect(b, v => {
                view.out = v;
              });
              onCleanup(() => {
                view.out = "absent";
              });
              return dd;
            })
          : undefined,
      dd => {
        if (dd) onCleanup(dd);
      }
    );
    run = action(function* () {
      setS(0);
      yield new Promise<void>(r => (resume = r));
      if (fail) throw new Error("cancelled");
      setS(1);
    });
  });
  return { s, setS, setMounted, view, run, resume: () => resume(), dispose };
}

it("an action's mount withdraw + restore over a Loading forwarding latest() completes", async () => {
  const t = setup();
  flush();
  await drain();
  const p = t.run();
  t.setMounted(false);
  flush();
  await drain();
  t.setMounted(true);
  flush();
  await drain();
  t.resume();
  await p;
  await drain(8);
  expect([t.view.out, t.s()]).toEqual([1, 1]);
  t.dispose();
});

it("an action's mount withdraw, not restored, completes with the mount gone", async () => {
  const t = setup();
  flush();
  await drain();
  const p = t.run();
  t.setMounted(false);
  flush();
  await drain();
  t.resume();
  await p;
  await drain(8);
  expect([t.view.out, t.s()]).toEqual(["absent", 1]);
  t.setMounted(true);
  flush();
  await drain(8);
  expect([t.view.out, t.s()]).toEqual([1, 1]);
  t.dispose();
});

for (const restore of [false, true]) {
  it(`an action failing after staging a mount withdraw${restore ? " + restore" : ""} leaves nothing held`, async () => {
    const t = setup(true);
    flush();
    await drain();
    const p = t.run().catch(e => e);
    t.setMounted(false);
    flush();
    await drain();
    if (restore) {
      t.setMounted(true);
      flush();
      await drain();
    }
    t.resume();
    expect(await p).toBeInstanceOf(Error);
    await drain(8);
    t.setMounted(true);
    t.setS(7);
    flush();
    await drain(8);
    expect([t.view.out, t.s()]).toEqual([7, 7]);
    t.setMounted(false);
    flush();
    await drain(8);
    expect(t.view.out).toBe("absent");
    t.dispose();
  });
}
