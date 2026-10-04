/**
 * #3706 — reading a store key an ADOPTION left unchanged must not hold an
 * independent synchronous update.
 *
 * Two optimistic moves are invoked in one tick, so they share a transaction.
 * The first confirms: its authoritative write lands on `server`, and the
 * derived base store adopts the new array under the still-open transaction
 * (the second move is pending). A later, separate interaction writes an
 * independent `drag` signal. A memo reads `drag()` and `cards[0].id` — the
 * same logical row and the same string on both backings. The write touches
 * nothing the adoption changed: it publishes now.
 *
 * The fold-hold gate had this precision since #3688 (the trap's written-key
 * record); the adoption-hold arm of `readSource` held every key of an
 * adopted container and entered the reader into the transaction (A29), so
 * `drag` was stamped and `isPending(drag)` went true for the second move's
 * lifetime.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  untrack
} from "../src/index.js";

type Card = { id: string; column: number };
const tick = () => new Promise<void>(r => setTimeout(r, 0));

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

function board(read: (drag: () => string | undefined, cards: Card[]) => unknown) {
  const gates = new Map<string, ReturnType<typeof deferred>>();
  let move!: (id: string, column: number) => Promise<void>;
  let setDrag!: (v: string) => void;
  let drag!: () => string | undefined;
  let derived!: () => unknown;
  const views: string[] = [];
  const dispose = createRoot(d => {
    const [server, setServer] = createSignal<Card[]>([
      { id: "0", column: 0 },
      { id: "1", column: 1 }
    ]);
    const [base] = createStore<Card[]>(() => server(), []);
    const [cards, setCards] = createOptimisticStore(base);
    [drag, setDrag] = createSignal<string>();
    derived = createMemo(() => read(drag, cards));
    move = action(function* (id: string, column: number) {
      setCards(draft => {
        draft.find(item => item.id === id)!.column = column;
      });
      const gate = deferred();
      gates.set(id, gate);
      yield gate.promise;
      setServer(rows => rows.map(row => (row.id === id ? { ...row, column } : row)));
    });
    createRenderEffect(
      () =>
        `drag: ${drag() ?? "unset"} latest: ${latest(drag) ?? "unset"} pending: ${isPending(drag)}`,
      v => void views.push(v)
    );
    createRenderEffect(derived, () => {});
    return d;
  });
  flush();
  return {
    move,
    confirm: (id: string) => gates.get(id)!.resolve(),
    setDrag,
    drag,
    derived,
    views,
    dispose
  };
}

describe("#3706 unchanged key read under an adoption hold", () => {
  it("an independent sync write publishes while a second overlapping move is pending", async () => {
    const b = board((drag, cards) => drag() === cards[0].id);
    expect(b.views).toEqual(["drag: unset latest: unset pending: false"]);

    const first = b.move("0", 1);
    const second = b.move("1", 2);
    b.confirm("0");
    await first;
    await tick();

    // A separate interaction, unrelated to the pending move.
    b.setDrag("0");
    flush();
    expect(b.drag()).toBe("0");
    expect(latest(b.drag)).toBe("0");
    expect(isPending(b.drag)).toBe(false);
    expect(b.derived()).toBe(true);
    expect(b.views.at(-1)).toBe("drag: 0 latest: 0 pending: false");

    b.confirm("1");
    await second;
    flush();
    expect(b.derived()).toBe(true);
    expect(b.views.at(-1)).toBe("drag: 0 latest: 0 pending: false");
    b.dispose();
  });

  it("an inherited array method read (`cards.find`) derives nothing from the hold either", async () => {
    const b = board((drag, cards) => cards.find(c => c.id === drag()) !== undefined);
    const first = b.move("0", 1);
    const second = b.move("1", 2);
    b.confirm("0");
    await first;
    await tick();
    b.setDrag("0");
    flush();
    expect(isPending(b.drag)).toBe(false);
    expect(b.derived()).toBe(true);
    b.confirm("1");
    await second;
    b.dispose();
  });

  it("a stale pass (render effect) reading the unchanged key beside a changed one keeps its replay", async () => {
    const gate = deferred();
    const [server, setServer] = createSignal({ saved: false, stable: "same" });
    const [store] = createStore(() => server(), { saved: false, stable: "same" });
    const [enabled, setEnabled] = createSignal(false);
    const seen: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createRenderEffect(
        () => `${enabled()}:${store.stable}:${store.saved}`,
        v => void seen.push(v)
      );
    });
    flush();
    const save = action(function* save() {
      setServer(s => ({ ...s, saved: true }));
      yield gate.promise;
    });
    const p = save();
    flush();
    setEnabled(true);
    flush();
    // The independent write publishes with the committed frame; the changed
    // key stays committed and the effect is replayed at the action's settle.
    expect(seen.at(-1)).toBe("true:same:false");
    expect(isPending(enabled)).toBe(false);
    gate.resolve();
    await p;
    flush();
    expect(seen.at(-1)).toBe("true:same:true");
    dispose();
  });

  it("presence reads (`in`, descriptor) and an out-of-range index take the same gate", async () => {
    const gate = deferred();
    const [server, setServer] = createSignal<Card[]>([{ id: "0", column: 0 }]);
    const [store] = createStore<Card[]>(() => server(), []);
    const [enabled, setEnabled] = createSignal(false);
    let derived!: () => string;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      derived = createMemo(
        () =>
          `${enabled()}:${"id" in store[0]}:${Object.getOwnPropertyDescriptor(store[0], "id")?.value}:${store[5] === undefined}`
      );
      createRenderEffect(derived, () => {});
    });
    flush();
    const save = action(function* save() {
      setServer(rows => rows.map(row => ({ ...row, column: 1 })));
      yield gate.promise;
    });
    const p = save();
    flush();
    setEnabled(true);
    flush();
    expect(derived()).toBe("true:true:0:true");
    expect(isPending(enabled)).toBe(false);
    gate.resolve();
    await p;
  });

  it("contrast: a key the adoption ADDED or DELETED still holds the reader (A29)", async () => {
    for (const shape of ["added", "deleted"] as const) {
      const gate = deferred();
      const [server, setServer] = createSignal<{ extra?: number }>(
        shape === "added" ? {} : { extra: 1 }
      );
      const [store] = createStore<{ extra?: number }>(() => server(), {});
      const [enabled, setEnabled] = createSignal(false);
      let derived!: () => string;
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        derived = createMemo(() => `${enabled()}:${"extra" in store}`);
        createRenderEffect(derived, () => {});
      });
      flush();
      const save = action(function* save() {
        setServer(shape === "added" ? { extra: 1 } : {});
        yield gate.promise;
      });
      const p = save();
      flush();
      setEnabled(true);
      flush();
      expect(isPending(enabled), shape).toBe(true);
      gate.resolve();
      await p;
      flush();
      expect(isPending(enabled), shape).toBe(false);
      expect(derived(), shape).toBe(shape === "added" ? "true:true" : "true:false");
      dispose();
    }
  });

  it("contrast: a prototype swap still holds the reader (A29)", async () => {
    class A {
      label() {
        return "old";
      }
    }
    class B {
      label() {
        return "new";
      }
    }
    const gate = deferred();
    const [server, setServer] = createSignal<A | B>(new A());
    const [store] = createStore<A | B>(() => server(), new A());
    const [enabled, setEnabled] = createSignal(false);
    let dispose!: () => void;
    const seen: string[] = [];
    createRoot(d => {
      dispose = d;
      createRenderEffect(
        () => `${enabled()}:${store.label()}`,
        v => void seen.push(v)
      );
    });
    flush();
    const save = action(function* save() {
      setServer(new B());
      yield gate.promise;
    });
    const p = save();
    flush();
    setEnabled(true);
    flush();
    // The stale pass keeps the committed frame until the action settles.
    expect(seen.at(-1)).toBe("true:old");
    gate.resolve();
    await p;
    flush();
    expect(seen.at(-1)).toBe("true:new");
    dispose();
  });

  // Third playground: the row is first read AFTER the adoption, so it has no
  // target for slot equality and the container hold stands. Freeing it needs
  // the adoption to carry per-child held views: a positional lazy
  // materialization aliased reordered rows and split proxy identity by
  // reader context under review. Left as a design call, tracked in #3712.
  for (const read of ["find", "index-id"] as const) {
    it.fails(
      `a row first read AFTER the adoption (${read}) derives nothing from the hold (third playground)`,
      async () => {
        let release!: () => void;
        let drag!: () => string | undefined;
        let setDrag!: (v: string) => void;
        let move!: () => Promise<void>;
        let derived!: () => unknown;
        let serverCards!: () => { id: string; version: number }[];
        let dispose!: () => void;
        createRoot(d => {
          dispose = d;
          const [rows, setRows] = createSignal([{ id: "card", version: 0 }]);
          serverCards = createMemo(() => rows());
          const [localCards] = createStore(() => serverCards(), []);
          const [cards] = createOptimisticStore(localCards);
          [drag, setDrag] = createSignal<string>();
          move = action(function* () {
            setRows([{ id: "card", version: 1 }]);
            yield new Promise<void>(r => (release = r));
          });
          // The row is only read once `drag` is set — after the adoption.
          derived = createMemo(() =>
            read === "find" ? drag() && cards.find(c => c.id === drag())?.id : drag() && cards[0].id
          );
          createRenderEffect(derived, () => {});
        });
        flush();
        const p = move();
        flush();
        await tick();
        expect(isPending(serverCards)).toBe(true);
        setDrag("card");
        flush();
        const pending = isPending(drag);
        release();
        await p;
        flush();
        dispose();
        expect(pending).toBe(false);
      }
    );
  }

  it("a changed leaf of a row first read after the adoption holds (A29)", async () => {
    let release!: () => void;
    let setDrag!: (v: string) => void;
    let drag!: () => string | undefined;
    let move!: () => Promise<void>;
    let version!: () => unknown;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const [rows, setRows] = createSignal([{ id: "card", version: 0 }]);
      const [cards] = createStore(() => rows(), []);
      [drag, setDrag] = createSignal<string>();
      move = action(function* () {
        setRows([{ id: "card", version: 1 }]);
        yield new Promise<void>(r => (release = r));
      });
      version = createMemo(() => drag() && cards[0].version);
      createRenderEffect(version, () => {});
    });
    flush();
    const p = move();
    flush();
    await tick();
    setDrag("card");
    flush();
    expect(isPending(drag)).toBe(true);
    release();
    await p;
    flush();
    expect(isPending(drag)).toBe(false);
    expect(version()).toBe(1);
    dispose();
  });

  it("reordered unread rows hold and are never aliased to one child (A29)", async () => {
    const gate = deferred();
    const a = { id: "a" };
    const b = { id: "b" };
    const [server, setServer] = createSignal([a, b]);
    const [store] = createStore<{ id: string }[]>(() => server(), []);
    const [enabled, setEnabled] = createSignal(false);
    let first!: () => unknown;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      first = createMemo(() => enabled() && store[0].id);
      createRenderEffect(first, () => {});
    });
    flush();
    const swap = action(function* swap() {
      setServer([b, a]);
      yield gate.promise;
    });
    const p = swap();
    flush();
    setEnabled(true);
    flush();
    expect(isPending(enabled)).toBe(true);
    gate.resolve();
    await p;
    flush();
    expect(first()).toBe("b");
    expect(store[0].id).toBe("b");
    expect(store[1].id).toBe("a");
    expect(store[0]).not.toBe(store[1]);
    dispose();
  });

  it("a shallow derived store keeps the reference hold for a replaced unread row (A29)", async () => {
    const gate = deferred();
    const [server, setServer] = createSignal([{ id: "card", version: 0 }]);
    const [store] = createStore<{ id: string; version: number }[]>(() => server(), [], {
      shallow: true
    });
    const [enabled, setEnabled] = createSignal(false);
    let version!: () => unknown;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      version = createMemo(() => enabled() && store[0].version);
      createRenderEffect(version, () => {});
    });
    flush();
    const save = action(function* save() {
      setServer([{ id: "card", version: 1 }]);
      yield gate.promise;
    });
    const p = save();
    flush();
    setEnabled(true);
    flush();
    expect(isPending(enabled)).toBe(true);
    gate.resolve();
    await p;
    flush();
    expect(version()).toBe(1);
    expect(store[0].version).toBe(1);
    dispose();
  });

  it("contrast: a descriptor read of a key whose enumerability changed still holds (A29)", async () => {
    const gate = deferred();
    const [server, setServer] = createSignal<{ x: number }>({ x: 1 });
    const [store] = createStore<{ x: number }>(() => server(), { x: 1 });
    const [enabled, setEnabled] = createSignal(false);
    const seen: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createRenderEffect(
        () => `${enabled()}:${Object.getOwnPropertyDescriptor(store, "x")?.enumerable}`,
        v => void seen.push(v)
      );
    });
    flush();
    const hide = action(function* hide() {
      setServer(Object.defineProperty({}, "x", { value: 1, enumerable: false }) as { x: number });
      yield gate.promise;
    });
    const p = hide();
    flush();
    setEnabled(true);
    flush();
    expect(seen.at(-1)).toBe("true:true");
    gate.resolve();
    await p;
    flush();
    expect(seen.at(-1)).toBe("true:false");
    dispose();
  });

  it("contrast: an inherited accessor reading `this` still holds the reader (A29)", async () => {
    class Row {
      column = 0;
      get double() {
        return this.column * 2;
      }
    }
    const gate = deferred();
    const [server, setServer] = createSignal(new Row());
    const [store] = createStore<Row>(() => server(), new Row());
    const [enabled, setEnabled] = createSignal(false);
    const seen: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createRenderEffect(
        () => `${enabled()}:${store.double}`,
        v => void seen.push(v)
      );
    });
    flush();
    const bump = action(function* bump() {
      setServer(Object.assign(new Row(), { column: 1 }));
      yield gate.promise;
    });
    const p = bump();
    flush();
    setEnabled(true);
    flush();
    expect(seen.at(-1)).toBe("true:0");
    gate.resolve();
    await p;
    flush();
    expect(seen.at(-1)).toBe("true:2");
    dispose();
  });

  it("contrast: reading the key the adoption CHANGED still holds the reader (A29)", async () => {
    const b = board((drag, cards) => `${drag() ?? "unset"}:${cards[0].column}`);
    const first = b.move("0", 1);
    const second = b.move("1", 2);
    b.confirm("0");
    await first;
    await tick();

    b.setDrag("0");
    flush();
    // L2 / §28 (S4): the first move's landing is the first ACTION's — its
    // transaction landed when its body ended (`await first`), the guess it
    // confirmed with it; the second move's guess is its own lane's. The
    // adopted column is committed when the memo reads it: nothing to join,
    // the independent signal publishes at once. (Was: the adoption held
    // under the family's open transaction — `next`'s declared-flight
    // entanglement — and the memo joined it, A29.)
    expect(isPending(b.drag)).toBe(false);
    expect(b.drag()).toBe("0");
    expect(b.derived()).toBe("0:1");

    b.confirm("1");
    await second;
    flush();
    expect(isPending(b.drag)).toBe(false);
    expect(b.derived()).toBe("0:1");
    b.dispose();
  });

  it("control: the same memo without the store read publishes immediately", async () => {
    const b = board(drag => drag() === "0");
    const first = b.move("0", 1);
    const second = b.move("1", 2);
    b.confirm("0");
    await first;
    await tick();
    b.setDrag("0");
    flush();
    expect(isPending(b.drag)).toBe(false);
    expect(b.derived()).toBe(true);
    b.confirm("1");
    await second;
    b.dispose();
  });

  it("a plain derived store adopting under an open action holds only the changed keys", async () => {
    const gate = deferred();
    const [server, setServer] = createSignal({ saved: false, stable: "same" });
    const [store] = createStore(() => server(), { saved: false, stable: "same" });
    const [enabled, setEnabled] = createSignal(false);
    let unchanged!: () => boolean;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      unchanged = createMemo(() => enabled() && store.stable === "same");
      createRenderEffect(unchanged, () => {});
    });
    flush();
    const save = action(function* save() {
      setServer(s => ({ ...s, saved: true }));
      yield gate.promise;
    });
    const p = save();
    flush();

    setEnabled(true);
    flush();
    // The unchanged-key reader publishes; the adopted key itself stays held
    // (mainline sees the committed frame) until the action settles.
    expect(unchanged()).toBe(true);
    expect(isPending(enabled)).toBe(false);
    expect(store.saved).toBe(false);

    gate.resolve();
    await p;
    flush();
    expect(store.saved).toBe(true);
    dispose();
  });

  // The record is what the ADOPTION changed, not what changed since the hold
  // began: a mainline setter write during the hold replaces the backing, and
  // the key it wrote is not held with the adopting transaction.
  describe("a mainline setter write during the hold to a key the adoption left unchanged", () => {
    function heldSave(read: (n: number, stable: () => string) => string) {
      const gate = deferred();
      const [server, setServer] = createSignal({ saved: false, stable: "same" });
      const [store, setStore] = createStore(() => server(), { saved: false, stable: "same" });
      const [n, setN] = createSignal(0);
      let reader!: () => string;
      const dispose = createRoot(d => {
        reader = createMemo(() => read(n(), () => store.stable));
        createRenderEffect(reader, () => {});
        return d;
      });
      flush();
      const save = action(function* save() {
        setServer(s => ({ ...s, saved: true }));
        yield gate.promise;
      });
      const p = save();
      flush();
      setStore(s => void (s.stable = "edited"));
      flush();
      return {
        store,
        n,
        setN,
        reader,
        settle: async () => {
          gate.resolve();
          await p;
          flush();
          dispose();
        }
      };
    }

    it("a tracked memo reading it does not make an independent signal pending", async () => {
      const t = heldSave((n, stable) => `${n}:${stable()}`);
      t.setN(1);
      flush();
      expect(isPending(t.n)).toBe(false);
      expect(t.reader()).toBe("1:edited");
      expect(t.store.saved).toBe(false);
      await t.settle();
    });

    it("an untracked read serves the write", async () => {
      const t = heldSave((n, stable) => `${n}:${stable()}`);
      expect(untrack(() => t.store.stable)).toBe("edited");
      expect(t.store.stable).toBe("edited");
      expect(t.store.saved).toBe(false);
      await t.settle();
    });

    it("a fresh node, after the reader drops the key and reads it again, is not born holding", async () => {
      const t = heldSave((n, stable) => (n === 1 ? "off" : `${n}:${stable()}`));
      t.setN(1);
      flush();
      expect(t.reader()).toBe("off");
      t.setN(2);
      flush();
      expect(isPending(t.n)).toBe(false);
      expect(t.reader()).toBe("2:edited");
      await t.settle();
    });
  });
});
