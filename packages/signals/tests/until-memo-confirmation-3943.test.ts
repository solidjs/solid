import { expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  until
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

for (const via of ["direct", "memo"] as const)
  it(`until() ${via} resolves on the source confirming the guess (#3943)`, async () => {
    let setSource!: (v: number) => void;
    let save!: () => Promise<unknown>;
    createRoot(() => {
      const [source, ss] = createSignal(0);
      setSource = ss;
      const [count, guess] = createOptimistic(() => source());
      const doubled = createMemo(() => count() * 2);
      createRenderEffect(count, () => {});
      createRenderEffect(doubled, () => {});
      save = action(function* () {
        guess(1);
        yield Promise.resolve();
        yield until(() => (via === "memo" ? doubled() === 2 : count() === 1));
      });
    });
    flush();
    let done = false;
    save().then(() => (done = true));
    await tick();
    expect(done).toBe(false);
    setSource(1);
    flush();
    await tick();
    expect(done).toBe(true);
  });

function setup() {
  let setSource!: (v: number) => void;
  let setX!: (v: number) => void;
  let api!: {
    count: () => number;
    doubled: () => number;
    sum: () => number;
    x: () => number;
    guess: (v: number) => void;
  };
  createRoot(() => {
    const [source, ss] = createSignal(0);
    const [x, sx] = createSignal(0);
    setSource = ss;
    setX = sx;
    const [count, guess] = createOptimistic(() => source());
    const doubled = createMemo(() => count() * 2);
    const sum = createMemo(() => count() + x());
    createRenderEffect(count, () => {});
    createRenderEffect(doubled, () => {});
    createRenderEffect(sum, () => {});
    api = { count, doubled, sum, x, guess };
  });
  flush();
  return { setSource, setX, ...api };
}

const watch = (p: Promise<unknown>) => {
  const s = { done: false };
  p.then(() => (s.done = true));
  return s;
};

// Review of #3978, 1: a truth staged beneath an earlier guess does not
// confirm the next guess — confirmed means the staged truth equals the guess.
for (const via of ["direct", "memo"] as const) {
  it(`until() ${via}: a re-guess the source has not confirmed keeps waiting (two saves)`, async () => {
    const m = setup();
    const save = action(function* (n: number) {
      m.guess(n);
      yield Promise.resolve();
      yield until(() => (via === "memo" ? m.doubled() === n * 2 : m.count() === n));
    });
    const first = watch(save(1));
    await tick();
    m.setSource(1);
    flush();
    await tick();
    expect(first.done).toBe(true);

    const second = watch(save(2));
    await tick();
    expect(second.done).toBe(false);
    m.setSource(2);
    flush();
    await tick();
    expect(second.done).toBe(true);
  });

  it(`until() ${via}: one action guessing twice waits for the second confirmation`, async () => {
    const m = setup();
    const save = action(function* () {
      m.guess(1);
      yield Promise.resolve();
      yield until(() => m.count() === 1);
      m.guess(2);
      yield Promise.resolve();
      yield until(() => (via === "memo" ? m.doubled() === 4 : m.count() === 2));
    });
    const s = watch(save());
    await tick();
    m.setSource(1);
    flush();
    await tick();
    expect(s.done).toBe(false);
    m.setSource(2);
    flush();
    await tick();
    expect(s.done).toBe(true);
  });
}

// Review of #3978, 2: a derivation that also reads a held plain write is not
// the truth — its lane value (guess + the old `x`) never commits.
it("until() does not resolve on a derivation mixing a confirmed guess with a held write", async () => {
  const m = setup();
  const seen: string[] = [];
  const run = action(function* () {
    m.setX(10);
    m.guess(1);
    yield Promise.resolve();
    yield until(() => m.x() === 10);
    seen.push("x");
    yield until(() => m.sum() === 1);
    seen.push("sum=1");
  });
  run();
  await tick();
  m.setSource(1);
  flush();
  await tick();
  expect(seen).toEqual(["x"]);
});

// Review of #3978, 3: confirmation is per dependency — an unconfirmed guess
// elsewhere in the action does not block a derivation that does not read it.
it("until() on a derivation of a confirmed guess ignores another, unconfirmed guess", async () => {
  let setA!: (v: number) => void;
  let save!: () => Promise<unknown>;
  createRoot(() => {
    const [a, sa] = createSignal(0);
    const [b] = createSignal(0);
    setA = sa;
    const [optA, guessA] = createOptimistic(() => a());
    const [optB, guessB] = createOptimistic(() => b());
    const doubledA = createMemo(() => optA() * 2);
    createRenderEffect(doubledA, () => {});
    createRenderEffect(optB, () => {});
    save = action(function* () {
      guessA(1);
      guessB(1);
      yield Promise.resolve();
      yield until(() => doubledA() === 2);
    });
  });
  flush();
  const s = watch(save());
  await tick();
  expect(s.done).toBe(false);
  setA(1);
  flush();
  await tick();
  expect(s.done).toBe(true);
});

// The store form of review 1: a field edited twice in one action waits for
// the second confirmation.
it("until() on an optimistic store field edited twice waits for the second confirmation", async () => {
  let setSource!: (v: string) => void;
  let save!: () => Promise<unknown>;
  createRoot(() => {
    const [source, ss] = createSignal("");
    setSource = ss;
    const [store, setStore] = createOptimisticStore(() => ({ text: source() }), { text: "" });
    const upper = createMemo(() => store.text.toUpperCase());
    createRenderEffect(upper, () => {});
    save = action(function* () {
      setStore(s => void (s.text = "a"));
      yield Promise.resolve();
      yield until(() => store.text === "a");
      setStore(s => void (s.text = "b"));
      yield Promise.resolve();
      yield until(() => upper() === "B");
    });
  });
  flush();
  const s = watch(save());
  await tick();
  setSource("a");
  flush();
  await tick();
  expect(s.done).toBe(false);
  setSource("b");
  flush();
  await tick();
  expect(s.done).toBe(true);
});

// A store row the server sends back as a fresh object confirms by content
// (the row echoes the guess, #3898), so a derivation over it is the truth too.
it("until() on a derivation of an optimistic store row confirmed by a fresh, equal row", async () => {
  type Row = { id: string; text: string };
  let setSource!: (v: Row[]) => void;
  let save!: () => Promise<unknown>;
  createRoot(() => {
    const [source, ss] = createSignal<Row[]>([]);
    setSource = ss;
    const [store, setStore] = createOptimisticStore(() => ({ items: source() }), {
      items: [] as Row[]
    });
    const texts = createMemo(() => store.items.map(i => i.text).join(","));
    createRenderEffect(texts, () => {});
    save = action(function* () {
      setStore(s => void s.items.push({ id: "1", text: "a" }));
      yield Promise.resolve();
      yield until(() => texts() === "a");
    });
  });
  flush();
  const s = watch(save());
  await tick();
  expect(s.done).toBe(false);
  setSource([{ id: "1", text: "a" }]);
  flush();
  await tick();
  expect(s.done).toBe(true);
});
