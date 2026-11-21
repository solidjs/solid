// #5139 (CS-R4): a write through a derived optimistic store stays in that view
// and leaves upstream stores untouched. Borrowing a row from another store in
// a guess and then applying a keyed answer in the derivation must not mutate
// the borrowed row in its source store.
import { test, expect } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  snapshot
} from "../src/index.js";

type Row = { id: number; value: number; done?: number };

test("#5139 sync: applying a keyed answer in a derived optimistic store leaves source untouched (CS-R4)", () => {
  const [source, setSource] = createStore<Row[]>([{ id: 1, value: 0 }]);
  const [answer, setAnswer] = createSignal<Row>();
  let derived!: Row[];
  let guess!: (fn: (draft: Row[]) => Row[] | void) => void;
  const dispose = createRoot(dispose => {
    [derived, guess] = createOptimisticStore<Row[]>(
      draft => {
        const row = answer();
        if (row) draft[0] = row;
      },
      [],
      { key: "id" }
    );
    return dispose;
  });
  flush();
  expect(source[0].value).toBe(0);
  expect(derived.length).toBe(0);

  guess(() => [source[0]]);
  setAnswer({ id: 1, value: 1 });
  flush();

  expect(source[0].value).toBe(0);
  expect(snapshot(source)[0].value).toBe(0);
  expect(derived[0].value).toBe(1);

  // Control: direct writes to source still update source without affecting derived.
  setSource(d => {
    d[0].value = 10;
  });
  flush();
  expect(source[0].value).toBe(10);
  expect(derived[0].value).toBe(1);

  // Subsequent answers update derived while leaving source untouched.
  setAnswer({ id: 1, value: 2 });
  flush();
  expect(source[0].value).toBe(10);
  expect(derived[0].value).toBe(2);
  dispose();
});

test("#5139 open action: applying a keyed answer while guess is held leaves source untouched (CS-R4)", async () => {
  const [source, setSource] = createStore<Row[]>([{ id: 1, value: 0 }]);
  const [answer, setAnswer] = createSignal<Row>();
  let derived!: Row[];
  let guess!: (fn: (draft: Row[]) => Row[] | void) => void;
  const dispose = createRoot(dispose => {
    [derived, guess] = createOptimisticStore<Row[]>(
      draft => {
        const row = answer();
        if (row) draft[0] = row;
      },
      [],
      { key: "id" }
    );
    return dispose;
  });
  flush();

  let resolve!: () => void;
  const gate = new Promise<void>(r => (resolve = r));
  const run = action(function* () {
    guess(() => [source[0]]);
    setAnswer({ id: 1, value: 1 });
    yield gate;
  });

  const p = run();
  flush();
  expect(source[0].value).toBe(0);
  expect(derived[0].value).toBe(0);

  resolve();
  await p;
  flush();
  expect(source[0].value).toBe(0);
  expect(derived[0].value).toBe(1);

  // Control: direct write to source still works after settlement.
  setSource(d => {
    d[0].value = 7;
  });
  flush();
  expect(source[0].value).toBe(7);
  expect(derived[0].value).toBe(1);
  dispose();
});

test("#5139 revert: borrowed row follows source while held and reverts cleanly when action settles (CS-R5, F-11)", async () => {
  const [source, setSource] = createStore<Row[]>([{ id: 1, value: 0 }]);
  const [answer] = createSignal<Row>();
  let derived!: Row[];
  let guess!: (fn: (draft: Row[]) => Row[] | void) => void;
  const dispose = createRoot(dispose => {
    [derived, guess] = createOptimisticStore<Row[]>(
      draft => {
        const row = answer();
        if (row) draft[0] = row;
      },
      [],
      { key: "id" }
    );
    return dispose;
  });
  flush();

  let resolve!: () => void;
  const gate = new Promise<void>(r => (resolve = r));
  const run = action(function* () {
    guess(() => [source[0]]);
    yield gate;
  });

  const p = run();
  flush();
  expect(derived.length).toBe(1);
  expect(derived[0].value).toBe(0);

  setSource(d => {
    d[0].value = 5;
  });
  flush();
  expect(source[0].value).toBe(5);
  expect(derived[0].value).toBe(5);

  resolve();
  await p;
  flush();
  expect(derived.length).toBe(0);
  expect(source[0].value).toBe(5);
  dispose();
});

test("#5139 optimistic source with live guess: keyed answer in derived leaves source untouched while keeping source guess until settled (CS-R4, F-11)", async () => {
  const [source, guessSource] = createOptimisticStore<Row[]>([{ id: 1, done: 0, value: 0 }]);
  const [answer, setAnswer] = createSignal<Row>();
  let derived!: Row[];
  let guessDerived!: (fn: (draft: Row[]) => Row[] | void) => void;
  const dispose = createRoot(dispose => {
    [derived, guessDerived] = createOptimisticStore<Row[]>(
      draft => {
        const row = answer();
        if (row) draft[0] = row;
      },
      [],
      { key: "id" }
    );
    return dispose;
  });
  flush();

  let resolveToggle!: () => void;
  let resolveMove!: () => void;
  const toggleGate = new Promise<void>(r => (resolveToggle = r));
  const moveGate = new Promise<void>(r => (resolveMove = r));

  const toggle = action(function* () {
    guessSource(d => {
      d[0].done = 1;
    });
    yield toggleGate;
  });
  const move = action(function* () {
    guessDerived(() => [source[0]]);
    setAnswer({ id: 1, done: 0, value: 1 });
    yield moveGate;
  });

  const pToggle = toggle();
  flush();
  expect(source[0].done).toBe(1);
  expect(source[0].value).toBe(0);

  const pMove = move();
  flush();
  expect(source[0].done).toBe(1);
  expect(source[0].value).toBe(0);
  expect(derived[0].done).toBe(1);

  resolveMove();
  await pMove;
  flush();
  // Toggle is still in flight: its guess stays visible, source value stays 0.
  expect(source[0].done).toBe(1);
  expect(source[0].value).toBe(0);
  expect(derived[0].done).toBe(1);

  resolveToggle();
  await pToggle;
  flush();
  expect(source[0].done).toBe(0);
  expect(source[0].value).toBe(0);
  expect(derived[0].done).toBe(0);
  expect(derived[0].value).toBe(1);
  dispose();
});

test("#5139 local field guess on borrowed row stays isolated from source when keyed answer lands (CS-R4)", async () => {
  const [source] = createStore<Row[]>([{ id: 1, value: 0 }]);
  const [answer, setAnswer] = createSignal<Row>();
  let derived!: Row[];
  let guess!: (fn: (draft: Row[]) => Row[] | void) => void;
  let shown: number | undefined;
  const dispose = createRoot(dispose => {
    [derived, guess] = createOptimisticStore<Row[]>(
      draft => {
        const row = answer();
        if (row) draft[0] = row;
      },
      [],
      { key: "id" }
    );
    createRenderEffect(
      () => derived[0]?.value,
      v => {
        shown = v;
      }
    );
    return dispose;
  });
  flush();

  let resolve!: () => void;
  const gate = new Promise<void>(r => (resolve = r));
  const run = action(function* () {
    guess(() => [source[0]]);
    yield gate;
  });

  const p = run();
  flush();
  expect(derived[0].value).toBe(0);
  expect(shown).toBe(0);

  let resolveEdit!: () => void;
  const editGate = new Promise<void>(r => (resolveEdit = r));
  const edit = action(function* () {
    guess(d => {
      d[0].value = 99;
    });
    yield editGate;
  });
  const pEdit = edit();
  flush();
  expect(source[0].value).toBe(0);
  expect(derived[0].value).toBe(99);
  expect(shown).toBe(99);

  setAnswer({ id: 1, value: 1 });
  flush();
  expect(source[0].value).toBe(0);
  expect(derived[0].value).toBe(99);
  expect(shown).toBe(99);

  resolve();
  resolveEdit();
  await Promise.all([p, pEdit]);
  flush();
  expect(source[0].value).toBe(0);
  expect(derived[0].value).toBe(1);
  expect(shown).toBe(1);
  dispose();
});
