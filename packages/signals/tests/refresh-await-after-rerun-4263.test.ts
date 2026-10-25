import { expect, test } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRoot,
  createSignal,
  flush,
  refresh,
  type SourceAccessor
} from "../src/index.js";

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms));

test("await refresh(memo) inside a yielded step resolves after an optimistic write and a dependency change (#4263)", async () => {
  let m!: SourceAccessor<{ likes: number }>;
  let likes!: () => number;
  let setLikes!: (v: number) => void;
  let setS!: (v: number) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [s, ss] = createSignal(0);
    setS = ss;
    m = createMemo(async () => {
      s();
      await tick(5);
      return { likes: 2 };
    });
    const [l, sl] = createOptimistic(() => m().likes);
    likes = l;
    setLikes = sl;
  });
  flush();
  await tick(50);
  expect(likes()).toBe(2);

  const run = action(function* () {
    setLikes(likes() + 1);
    yield (async () => {
      await tick(5);
      setS(1);
      await tick(30);
      await refresh(m);
    })();
  });

  const result = await Promise.race([
    run().then(() => "resolved"),
    tick(500).then(() => "timeout")
  ]);
  expect(result).toBe("resolved");
  flush();
  expect(likes()).toBe(2);
  dispose();
});
