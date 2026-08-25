/**
 * #2926: a memo whose creation (and therefore eager first compute) happens
 * inside a `latest()` read window never re-ran.
 *
 * `read()` short-circuits every read through the latest-companion path while
 * `latestReadActive` is set — before dependency linking. So a memo eagerly
 * computed at creation inside `latest(fn)` (e.g. the community
 * "createLazyMemo" pattern that instantiates the memo on first access) came
 * out with an empty dependency set: no source write could ever invalidate it,
 * and it was permanently frozen at its first value. `compute()` now suspends
 * the latest window while a computed's own fn runs, matching what
 * `latestRead()` already did for pull-recomputes.
 */
import {
  createMemo,
  createRoot,
  createSignal,
  flush,
  getOwner,
  latest,
  runWithOwner
} from "../src/index.js";

it("memo created inside a latest() window still links its dependencies (#2926)", () => {
  let runs = 0;
  let m!: () => number;
  let set!: (v: number) => void;
  createRoot(() => {
    const [g, s] = createSignal(0, { equals: false });
    set = s;
    // The reporter's createLazyMemo pattern: memo instantiated on first read,
    // which here happens inside latest().
    const owner = getOwner();
    let memo: (() => number) | undefined;
    m = () =>
      (memo ??= runWithOwner(owner, () =>
        createMemo(() => {
          runs++;
          return g() + 1;
        })
      )!)();
  });

  expect(latest(m)).toBe(1);
  expect(runs).toBe(1);

  set(0); // equals: false — same value must still rerun the memo
  flush();
  expect(latest(m)).toBe(1);
  expect(runs).toBe(2);

  set(5);
  flush();
  expect(latest(m)).toBe(6);
  expect(runs).toBe(3);
});

it("memo created directly inside latest(fn) links its dependencies (#2926)", () => {
  const [g, set] = createSignal(1);
  let runs = 0;
  let memo!: () => number;
  const first = latest(() => {
    memo = createRoot(() =>
      createMemo(() => {
        runs++;
        return g() * 10;
      })
    );
    return memo();
  });
  expect(first).toBe(10);
  expect(runs).toBe(1);

  set(2);
  flush();
  expect(memo()).toBe(20);
  expect(runs).toBe(2);
});
