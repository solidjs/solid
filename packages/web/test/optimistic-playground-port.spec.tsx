/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Faithful port of the #3141 playground program: no manual flush() anywhere,
 * real timers (scaled 1 playground second -> 30ms), scheduler auto-flush
 * only. The DOM is sampled on a fine timer into a deduped timeline.
 */
import { describe, expect, test } from "vitest";
import { action, createOptimisticStore, createRenderEffect, deep, Loading } from "solid-js";
import { render } from "../src/index.js";

const S = 30; // 1 playground second
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function run(enableBlock: boolean) {
  const container = document.createElement("div");
  const observed: string[] = [];

  const act = action(function* (ms: number) {
    yield sleep(ms);
  });

  function App() {
    const [s, ss] = createOptimisticStore<number[]>(
      async function* (draft) {
        yield [1, 2, 3];
        await sleep(2 * S);
        yield [3, 2, 1];
        await sleep(2 * S); // offset 4s
        draft.push(5);
        await sleep(1 * S); // offset 5s
        draft.push(666);
        await sleep(1 * S); // offset 6s
      },
      [1, 2]
    );

    setTimeout(() => {
      act(10 * S); // 10s transition
      setTimeout(() => {
        ss(draft => {
          draft.push(1111);
        });
      }, 3 * S); // offset 3s
    }, 0);

    if (enableBlock) {
      createRenderEffect(
        () => deep(s),
        v => {
          observed.push(JSON.stringify(v));
        }
      );
    }

    return (
      <div>
        <Loading>{JSON.stringify(s)}</Loading>
      </div>
    );
  }

  const dispose = render(() => <App />, container);

  const timeline: Array<{ at: number; dom: string }> = [];
  const start = Date.now();
  const deadline = 12 * S;
  let last: string | undefined;
  while (Date.now() - start < deadline) {
    const dom = container.textContent ?? "";
    if (dom !== last) {
      timeline.push({ at: Date.now() - start, dom });
      last = dom;
    }
    await sleep(2);
  }

  dispose();
  return { timeline, observed };
}

describe("playground port (#3141)", () => {
  test("the deep() observer does not change the rendered timeline", async () => {
    const baseline = await run(false);
    const withObserver = await run(true);

    // The sampler may or may not catch the momentary 1111 flash in any given
    // run, so exact timeline equality between the two runs would flake.
    // Assert order-based invariants that only the bug violates instead.
    const authoritative = ["[1,2,3]", "[3,2,1]", "[3,2,1,5,666]"];
    const authoritativeOrder = (doms: string[]) => doms.filter(d => authoritative.includes(d));

    for (const { timeline } of [baseline, withObserver]) {
      const doms = timeline.map(e => e.dom);
      // Truth progresses through every landing, in order, ending settled —
      // pre-fix the [3,2,1] landing never rendered on its own (it was held
      // by the unrelated action and only surfaced at 10s or under the flash).
      expect(authoritativeOrder(doms)).toEqual(authoritative);
      // The split-brain signature: the optimistic push composed over the
      // STALE base while deep() already saw the fresh one.
      expect(doms).not.toContain("[1,2,3,1111]");
      // The unowned push must not persist until the action settles: whatever
      // transients were sampled, the run ends on the settled truth.
      expect(doms.at(-1)).toBe("[3,2,1,5,666]");
    }
    expect(withObserver.observed).not.toContain("[1,2,3,1111]");
    expect(withObserver.observed.at(-1)).toBe("[3,2,1,5,666]");
  }, 20000);
});
