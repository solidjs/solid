/**
 * Reproduction for #3141: a generator-backed optimistic store, read by a
 * JSON-rendering effect (the DOM stand-in), renders DIFFERENTLY depending on
 * whether a second, passive `createRenderEffect(() => deep(s), ...)` observer
 * exists — and while an optimistic override is visible, the two readers can
 * disagree about the base state underneath the overlay in the same flush.
 *
 * Timeline mirrored from the report:
 *   1. generator yields [1,2,3]
 *   2. a long action transition starts
 *   3. generator yields [3,2,1] (mid-action)
 *   4. an optimistic setter pushes 1111 (mid-action)
 *   5. generator draft-mutates push(5), push(666), returns
 *   6. the action settles; the override drops
 *
 * Invariants pinned here:
 *   - the rendered sequence is identical with and without the deep observer
 *   - whenever both readers emit, they emit the same value
 */
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  deep,
  flush
} from "../../src/index.js";

afterEach(() => flush());

interface Gates {
  afterFirstYield: () => void;
  afterSecondYield: () => void;
  afterPush5: () => void;
}

function setup(withDeepObserver: boolean) {
  const rendered: string[] = [];
  const observed: string[] = [];
  const gates = {} as Gates;
  let setState!: (fn: (s: number[]) => void) => void;
  let resolveAction!: () => void;
  let start!: () => Promise<void>;
  let generatorDone!: Promise<void>;

  const gate1 = new Promise<void>(r => (gates.afterFirstYield = r));
  const gate2 = new Promise<void>(r => (gates.afterSecondYield = r));
  const gate3 = new Promise<void>(r => (gates.afterPush5 = r));

  const dispose = createRoot(disposer => {
    let markDone!: () => void;
    generatorDone = new Promise<void>(r => (markDone = r));

    const [s, ss] = createOptimisticStore<number[]>(
      async function* (draft) {
        yield [1, 2, 3];
        await gate1;
        yield [3, 2, 1];
        await gate2;
        draft.push(5);
        await gate3;
        draft.push(666);
        markDone();
      },
      [1, 2]
    );
    setState = ss;

    // The DOM stand-in: renders the whole array, like `{JSON.stringify(s)}`.
    createRenderEffect(
      () => JSON.stringify(s),
      v => {
        rendered.push(v);
      }
    );

    if (withDeepObserver) {
      // The passive observer from the report: subscribes to everything,
      // renders nothing.
      createRenderEffect(
        () => deep(s),
        v => {
          observed.push(JSON.stringify(v));
        }
      );
    }

    start = action(function* () {
      yield new Promise<void>(r => (resolveAction = r));
    });

    return disposer;
  });

  return {
    rendered,
    observed,
    gates,
    setState,
    dispose,
    begin: () => start(),
    settleAction: () => resolveAction(),
    generatorDone: () => generatorDone
  };
}

async function drive(t: ReturnType<typeof setup>) {
  // Step 1: first yield lands.
  flush();
  await Promise.resolve();
  flush();

  // Step 2: long action transition begins.
  const acting = t.begin();
  flush();

  // Step 3: second yield lands mid-action.
  t.gates.afterFirstYield();
  await new Promise(r => setTimeout(r, 0));
  flush();
  const atSecondYield = {
    rendered: t.rendered.at(-1),
    observed: t.observed.at(-1)
  };

  // Step 4: optimistic push mid-action.
  t.setState(draft => {
    draft.push(1111);
  });
  flush();
  const atOverride = {
    rendered: t.rendered.at(-1),
    observed: t.observed.at(-1)
  };

  // Step 5: generator draft mutations, then it returns.
  t.gates.afterSecondYield();
  await new Promise(r => setTimeout(r, 0));
  flush();
  t.gates.afterPush5();
  await new Promise(r => setTimeout(r, 0));
  flush();
  await t.generatorDone();
  flush();

  // Step 6: the action settles; the override drops.
  t.settleAction();
  await acting;
  await Promise.resolve();
  flush();

  return { atSecondYield, atOverride, final: t.rendered.at(-1) };
}

describe("optimistic store observer invariance (#3141)", () => {
  it("renders the same sequence with and without a passive deep() observer", async () => {
    const without = setup(false);
    const baseline = await drive(without);
    without.dispose();
    flush();

    const withObserver = setup(true);
    const observed = await drive(withObserver);
    withObserver.dispose();
    flush();

    // The mid-action yield must reach the renderer either way.
    expect(baseline.atSecondYield.rendered).toBe("[3,2,1]");
    expect(observed.atSecondYield.rendered).toBe("[3,2,1]");

    // The optimistic override overlays the same base either way.
    expect(observed.atOverride.rendered).toBe(baseline.atOverride.rendered);

    // Settling drops the override and lands the generator's final state.
    expect(baseline.final).toBe("[3,2,1,5,666]");
    expect(observed.final).toBe("[3,2,1,5,666]");
  });

  it("simultaneous readers agree on the base under an optimistic override", async () => {
    const t = setup(true);
    const { atOverride } = await drive(t);
    t.dispose();
    flush();

    // The DOM read and the deep() observer ran in the same flush; they must
    // describe the same array. (The report saw [1,2,3,1111] rendered while
    // the observer logged [3,2,1,1111].)
    expect(atOverride.rendered).toBe(atOverride.observed);
  });
});
