/**
 * #2930: `resolve()` created inside an `action()` never settled, deadlocking
 * the action.
 *
 * resolve() delivers its value from a user effect's apply phase. An
 * incomplete transition stashes its effect queues until it settles — but an
 * action yielding the resolve() promise is itself what keeps the transition
 * open: the stashed res() could never run. resolve() now delivers effect
 * applies on a microtask (immune to the stash) while the compute still runs
 * in place — under the transaction's view when created inside an action step
 * — and status/boundary notifications keep their normal queue route.
 */
import { action, affects, createMemo, createRoot, flush, refresh, resolve } from "../src/index.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function race(p: Promise<any>, ms = 250): Promise<string> {
  return Promise.race([
    p.then(
      v => "settled: " + v,
      e => "rejected: " + ((e as Error).message ?? e)
    ),
    wait(ms).then(() => "timed out")
  ]);
}

it("resolve of a sync memo inside an action settles (#2930)", async () => {
  let m!: () => number;
  createRoot(() => {
    m = createMemo(() => 1) as any;
  });
  flush();

  const run = action(function* () {
    return yield resolve(() => m());
  });
  expect(await race((run as any)())).toBe("settled: 1");
});

it("resolve of a rejecting async source inside an action rejects the action (#2930)", async () => {
  let m!: () => number;
  createRoot(() => {
    m = createMemo(async () => {
      await wait(10);
      throw new Error("boom");
    }) as any;
  });
  flush();

  const run = action(function* () {
    return yield resolve(() => m());
  });
  expect(await race((run as any)())).toBe("rejected: boom");
});

it("affects + refresh + yield resolve: settles stale-while-revalidate, commit still refetches (#2930)", async () => {
  let round = 0;
  let m!: () => number;
  createRoot(() => {
    m = createMemo(async () => {
      const r = ++round;
      await wait(20);
      return r;
    }) as any;
  });
  flush();
  await wait(40);
  flush();
  expect(m()).toBe(1);

  const run = action(function* () {
    affects(m as any);
    refresh(m as any);
    return yield resolve(() => m());
  });

  // refresh() is a quiet re-ask (stale-while-revalidate): m() stays settled
  // at its previous value while refetching, so resolve() settles with the
  // stale value instead of deadlocking. The affects() mark still gates the
  // transaction's commit on the refetch landing.
  expect(await race((run as any)(), 500)).toBe("settled: 1");

  await wait(60);
  flush();
  expect(m()).toBe(2);
  expect(round).toBe(2);
});

it("control: resolve outside an action still settles", async () => {
  let m!: () => number;
  createRoot(() => {
    m = createMemo(() => 1) as any;
  });
  flush();
  await expect(resolve(() => m())).resolves.toBe(1);
});
