import { expect, test } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRoot,
  createSignal,
  flush,
  refresh,
  resolve,
  until,
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

// Authoritative delivery, not the transition's completion: refresh() answers
// like until() and resolve() — in #4263's await continuation, from outside the
// action, and when the action later supersedes the landing before committing.
function held() {
  let m!: SourceAccessor<{ v: number }>;
  let likes!: () => number;
  let setLikes!: (v: number) => void;
  let setS!: (v: number) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [s, ss] = createSignal(0);
    setS = ss;
    m = createMemo(async () => {
      const x = s();
      await tick(5);
      return { v: x };
    });
    [likes, setLikes] = createOptimistic(() => m().v);
  });
  return {
    m: () => m,
    likes: () => likes,
    setLikes: (v: number) => setLikes(v),
    setS: (v: number) => setS(v),
    dispose: () => dispose()
  };
}

const readers = {
  refresh: (m: SourceAccessor<{ v: number }>) => refresh(m),
  until: (m: SourceAccessor<{ v: number }>) => until(() => m().v >= 1 && m()),
  resolve: (m: SourceAccessor<{ v: number }>) => resolve(() => m())
};

for (const [name, wait] of Object.entries(readers))
  test(`${name}() in a yielded step's await continuation delivers the held landing (#4263)`, async () => {
    const h = held();
    flush();
    await tick(50);
    let got: { v: number } | undefined;
    const run = action(function* () {
      h.setLikes(h.likes()() + 10);
      yield (async () => {
        await tick(5);
        h.setS(1);
        await tick(30);
        got = (await wait(h.m())) as { v: number };
      })();
    });
    const result = await Promise.race([
      run().then(() => "resolved"),
      tick(300).then(() => "timeout")
    ]);
    expect(result).toBe("resolved");
    expect(got!.v).toBe(1);
    flush();
    expect(h.likes()()).toBe(1);
    h.dispose();
  });

for (const supersede of [false, true])
  for (const [name, wait] of Object.entries(readers))
    test(`${name}() from outside an action holding the landing delivers it before the commit${supersede ? " (the action supersedes it later)" : ""}`, async () => {
      const h = held();
      flush();
      await tick(50);
      let release!: () => void;
      const gate = new Promise<void>(r => (release = r));
      let committed = false;
      const run = action(function* () {
        h.setLikes(h.likes()() + 10);
        h.setS(1);
        yield tick(30);
        yield gate;
        if (supersede) {
          h.setS(2);
          yield tick(30);
        }
      });
      const done = run().then(() => (committed = true));
      await tick(40);
      let got: { v: number } | undefined;
      void wait(h.m()).then(v => (got = v as { v: number }));
      await tick(40);
      // Authoritative: the held landing answered; the screen still waits.
      expect(got?.v).toBe(1);
      expect(committed).toBe(false);
      expect(h.m()().v).toBe(0);
      release();
      await done;
      flush();
      expect(h.m()().v).toBe(supersede ? 2 : 1);
      h.dispose();
    });
