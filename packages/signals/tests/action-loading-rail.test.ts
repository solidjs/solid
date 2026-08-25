/**
 * #2937: the loading rail is invisible to transactions (#2933 ruling) — an
 * uninitialized async node has no committed value for a transaction to hold,
 * so its FIRST reveal must flow ambiently. The pending-node stamping sites
 * (initTransition adoption / reassignPendingTransition at stash) stamped
 * loading-rail nodes like value-holding pending ones; the node's settle then
 * re-activated the (incomplete) action transaction and the reveal — the
 * boundary swap, including the fallback's onCleanup — was stashed with it.
 * When the action's completion depended on that cleanup (the reported
 * hand-rolled "wait for the fallback to clear" transition), that was a
 * deadlock, with or without a flush between the write and the action call.
 *
 * Adoption itself is intended and untouched: writes made earlier in the same
 * tick — plain or optimistic — join the action's transaction (updates can be
 * mutation and navigation at once). Only the loading-rail stamp is exempt.
 */
import {
  action,
  createEffect,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  onCleanup
} from "../src/index.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function harness(log: string[]) {
  const [src, setSrc] = createSignal(1);
  const [isL, setIsL] = createSignal(false, { ownedWrite: 1 } as any);
  const [opt, setOpt] = createOptimistic(false);
  let resolveData!: (v: number) => void;
  let view: any;

  createRoot(() => {
    const data = createMemo(() => {
      const s = src();
      return new Promise<number>(r => (resolveData = v => r(v + s)));
    });
    const b = createLoadingBoundary(
      () => "content:" + data(),
      () => {
        setIsL(true);
        onCleanup(() => {
          log.push("fallback-cleanup");
          setIsL(false);
        });
        return "fallback";
      }
    );
    createRenderEffect(
      () => (view = b()),
      () => {}
    );
  });
  flush();
  return {
    setSrc,
    setOpt,
    opt,
    isL,
    resolve: (v: number) => resolveData(v),
    view: () => view
  };
}

async function drive(mode: "in-step" | "adopted", preFlush: boolean) {
  const log: string[] = [];
  const h = harness(log);
  expect(h.view()).toBe("fallback"); // initial load: loading regime

  const p = (Promise as any).withResolvers();

  // Watcher in its own root BEFORE the action: resolves the action's yielded
  // promise when the fallback cleans up (the issue's createTransition).
  createRoot(dispose => {
    createEffect(
      () => latest(h.isL),
      (v: boolean) => {
        if (!v) {
          p.resolve();
          dispose();
        }
      }
    );
  });

  if (mode === "adopted") h.setSrc(2); // same tick, before the action call
  if (preFlush) flush();

  const run = action(function* () {
    h.setOpt(true);
    if (mode === "in-step") h.setSrc(2);
    yield p.promise;
    log.push("action:end");
  });
  const done = run();

  await wait(10);
  flush();
  h.resolve(100); // uninitialized async settles: first reveal must flow
  await wait(10);
  flush();

  const result = await Promise.race([done.then(() => "done"), wait(300).then(() => "TIMEOUT")]);
  flush();
  return { log, result, view: h.view() };
}

for (const mode of ["in-step", "adopted"] as const) {
  for (const preFlush of [false, true]) {
    it(`boundary reveal settles the action (${mode} write, preFlush=${preFlush})`, async () => {
      const { log, result, view } = await drive(mode, preFlush);
      expect(result).toBe("done");
      expect(view).toBe("content:102");
      expect(log).toEqual(["fallback-cleanup", "action:end"]);
    });
  }
}

it("same-tick writes before the action are still adopted into the transaction", async () => {
  // The optimistic-before-action idiom (covered in depth by the
  // createOptimistic suites) — a bare optimistic write in the same tick must
  // revert when the action settles, proving it joined the transaction.
  const [opt, setOpt] = createOptimistic(0);
  const p = (Promise as any).withResolvers();

  setOpt(1); // before the action call, same tick
  const run = action(function* () {
    yield p.promise;
  });
  const done = run();
  flush();
  expect(opt()).toBe(1); // held by the action's transaction

  p.resolve();
  await done;
  await Promise.resolve();
  flush();
  expect(opt()).toBe(0); // reverted at settle: it was the transaction's write
});
