/**
 * #3883 — an optimistic store over a store: a property the inner store's
 * reconcile removed kept reading its last value through the view. The view's
 * node for the key is a subscription point (§7b); the absent-key read served
 * its cached value instead of reading through to the inner store.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush
} from "../../src/index.js";

type Card = { id: string; createFailed?: boolean };

function setup(optimistic = true) {
  const [source, setSource] = createSignal<Card[]>([{ id: "A", createFailed: true }]);
  let local!: Card[];
  let setLocal!: (fn: (draft: Card[]) => Card[] | void) => void;
  let cards!: Card[];
  let setCards!: (fn: (draft: Card[]) => Card[] | void) => void;
  const seen: (boolean | undefined)[] = [];
  const dispose = createRoot(d => {
    [local, setLocal] = createStore<Card[]>(() => source(), []);
    if (optimistic) [cards, setCards] = createOptimisticStore(local);
    else cards = local;
    createRenderEffect(
      () => cards[0]?.createFailed,
      value => void seen.push(value)
    );
    return d;
  });
  flush();
  return { source, setSource, local, setLocal, cards: () => cards, setCards, seen, dispose };
}

describe("#3883 a property reconciliation removes", () => {
  it("reads undefined through the optimistic view", () => {
    const { setSource, local, cards, seen, dispose } = setup();
    expect(cards()[0].createFailed).toBe(true);

    setSource([{ id: "A" }]);
    flush();
    expect(local[0].createFailed).toBeUndefined();
    expect(cards()[0].createFailed).toBeUndefined();
    expect(seen).toEqual([true, undefined]);
    dispose();
  });

  it("reads undefined through the derived store with no optimistic layer", () => {
    const { setSource, cards, seen, dispose } = setup(false);
    setSource([{ id: "A" }]);
    flush();
    expect(cards()[0].createFailed).toBeUndefined();
    expect(seen).toEqual([true, undefined]);
    dispose();
  });

  it("reads the re-added value after a remove", () => {
    const { setSource, cards, seen, dispose } = setup();
    setSource([{ id: "A" }]);
    flush();
    expect(cards()[0].createFailed).toBeUndefined();

    setSource([{ id: "A", createFailed: false }]);
    flush();
    expect(cards()[0].createFailed).toBe(false);

    setSource([{ id: "A" }]);
    flush();
    expect(cards()[0].createFailed).toBeUndefined();

    setSource([{ id: "A", createFailed: true }]);
    flush();
    expect(cards()[0].createFailed).toBe(true);
    expect(seen).toEqual([true, undefined, false, undefined, true]);
    dispose();
  });

  it("shows a guess on the removed key during an action, undefined after", async () => {
    const { setSource, setCards, cards, seen, dispose } = setup();
    let release!: () => void;
    const done = action(function* () {
      setCards(draft => {
        draft[0].createFailed = false;
      });
      yield new Promise<void>(resolve => (release = resolve));
    })();
    flush();
    expect(cards()[0].createFailed).toBe(false);

    setSource([{ id: "A" }]);
    flush();
    expect(cards()[0].createFailed).toBe(false);
    expect(seen.at(-1)).toBe(false);

    release();
    await done;
    flush();
    expect(cards()[0].createFailed).toBeUndefined();
    expect(seen.at(-1)).toBeUndefined();

    const done2 = action(function* () {
      setCards(draft => {
        draft[0].createFailed = false;
      });
      yield new Promise<void>(resolve => (release = resolve));
    })();
    flush();
    expect(cards()[0].createFailed).toBe(false);
    expect(seen.at(-1)).toBe(false);

    release();
    await done2;
    flush();
    expect(cards()[0].createFailed).toBeUndefined();
    expect(seen.at(-1)).toBeUndefined();
    dispose();
  });

  it("answers `in` and Object.keys through the view", () => {
    const { setSource, cards, dispose } = setup();
    const has: boolean[] = [];
    const keys: string[][] = [];
    const disposeReaders = createRoot(d => {
      createRenderEffect(
        () => "createFailed" in cards()[0],
        v => void has.push(v)
      );
      createRenderEffect(
        () => Object.keys(cards()[0]),
        v => void keys.push(v)
      );
      return d;
    });
    flush();
    expect("createFailed" in cards()[0]).toBe(true);

    setSource([{ id: "A" }]);
    flush();
    expect("createFailed" in cards()[0]).toBe(false);
    expect(Object.keys(cards()[0])).toEqual(["id"]);
    expect(has).toEqual([true, false]);
    expect(keys).toEqual([["id", "createFailed"], ["id"]]);
    disposeReaders();
    dispose();
  });

  it("reads undefined after an action retains the row and settles (the report)", async () => {
    const [source, setSource] = createSignal<Card[]>([]);
    let cards!: Card[];
    let setCards!: (fn: (draft: Card[]) => Card[] | void) => void;
    let setLocal!: (fn: (draft: Card[]) => Card[] | void) => void;
    let release!: () => void;
    let create!: () => Promise<void>;
    const seen: (boolean | undefined)[] = [];
    const dispose = createRoot(d => {
      let local: Card[];
      [local, setLocal] = createStore<Card[]>(draft => {
        const rows = source();
        const retained = draft.filter(row => row.createFailed && !rows.some(r => r.id === row.id));
        return [...rows, ...retained.map(row => ({ ...row }))];
      }, []);
      [cards, setCards] = createOptimisticStore(local);
      createRenderEffect(
        () => cards[0]?.createFailed,
        value => void seen.push(value)
      );
      create = action(function* () {
        setCards(draft => {
          draft.push({ id: "A" });
        });
        yield new Promise<void>(resolve => (release = resolve));
        setLocal(draft => {
          draft.push({ id: "A", createFailed: true });
        });
      });
      return d;
    });
    flush();

    const done = create();
    flush();
    expect(cards.map(c => c.id)).toEqual(["A"]);
    expect(cards[0].createFailed).toBeUndefined();

    release();
    await done;
    flush();
    expect(cards[0].createFailed).toBe(true);

    setSource([{ id: "A" }]);
    flush();
    expect(cards.map(c => c.id)).toEqual(["A"]);
    expect(cards[0].createFailed).toBeUndefined();
    expect(seen.at(-1)).toBeUndefined();
    dispose();
  });
});
