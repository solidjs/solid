/**
 * #4784 — two overlapping actions write different existing indices of a
 * `createOptimisticStore([0, 0])`. When the first action ends, its guessed
 * value must revert even though the other action's guess is still out: a
 * write that changes no keys and no length belongs to the changed indices,
 * not to the whole array (the #4724 point-of-write ruling). The equivalent
 * object store already reverts each property independently; the array kept
 * showing the expired guess until the other action ended, because every
 * array write was recorded as a structural (arrangement) guess, so the
 * surviving guess's frame kept serving the expired index.
 */
import { expect, test } from "vitest";
import {
  action,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush
} from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

test("an expired index guess reverts while a disjoint index guess is still out (#4784)", async () => {
  const gate1 = deferred();
  const gate2 = deferred();
  let array!: number[];
  let setArray!: (fn: (draft: number[]) => void) => void;
  let object!: Record<number, number>;
  let setObject!: (fn: (draft: Record<number, number>) => void) => void;
  const seenArray: string[] = [];
  const seenObject: string[] = [];
  createRoot(() => {
    [array, setArray] = createOptimisticStore([0, 0]);
    [object, setObject] = createOptimisticStore({ 0: 0, 1: 0 });
    createRenderEffect(
      () => array.join(","),
      v => void seenArray.push(v)
    );
    createRenderEffect(
      () => `${object[0]},${object[1]}`,
      v => void seenObject.push(v)
    );
  });
  flush();
  expect(seenArray.at(-1)).toBe("0,0");
  expect(seenObject.at(-1)).toBe("0,0");

  const save = action(function* (index: 0 | 1, gate: Promise<void>) {
    setArray(draft => {
      draft[index] = index + 1;
    });
    setObject(draft => {
      draft[index] = index + 1;
    });
    yield gate;
  });

  const p1 = save(1, gate1.promise);
  flush();
  expect(seenArray.at(-1)).toBe("0,2");
  expect(seenObject.at(-1)).toBe("0,2");

  const p2 = save(0, gate2.promise);
  flush();
  expect(seenArray.at(-1)).toBe("1,2");
  expect(seenObject.at(-1)).toBe("1,2");

  // The first action ends: its index reverts, the other guess stays.
  gate1.resolve();
  await p1;
  flush();
  expect(seenObject.at(-1)).toBe("1,0");
  expect(seenArray.at(-1)).toBe("1,0");
  expect(array[1]).toBe(0);
  expect(array[0]).toBe(1);

  gate2.resolve();
  await p2;
  flush();
  expect(seenArray.at(-1)).toBe("0,0");
  expect(seenObject.at(-1)).toBe("0,0");
});

test("the reverse end order: the second action ends first (#4784)", async () => {
  const gate1 = deferred();
  const gate2 = deferred();
  let array!: number[];
  let setArray!: (fn: (draft: number[]) => void) => void;
  const seenArray: string[] = [];
  createRoot(() => {
    [array, setArray] = createOptimisticStore([0, 0]);
    createRenderEffect(
      () => array.join(","),
      v => void seenArray.push(v)
    );
  });
  flush();
  expect(seenArray.at(-1)).toBe("0,0");

  const save = action(function* (index: 0 | 1, gate: Promise<void>) {
    setArray(draft => {
      draft[index] = index + 1;
    });
    yield gate;
  });

  const p1 = save(1, gate1.promise);
  flush();
  expect(seenArray.at(-1)).toBe("0,2");

  const p2 = save(0, gate2.promise);
  flush();
  expect(seenArray.at(-1)).toBe("1,2");

  // The second action ends first: its index reverts, the first guess stays.
  gate2.resolve();
  await p2;
  flush();
  expect(seenArray.at(-1)).toBe("0,2");
  expect(array[0]).toBe(0);
  expect(array[1]).toBe(2);

  gate1.resolve();
  await p1;
  flush();
  expect(seenArray.at(-1)).toBe("0,0");
});

test("the lending action writing its own index again after the other guess was made (#4784)", async () => {
  const gate1a = deferred();
  const gate1b = deferred();
  const gate2 = deferred();
  let array!: number[];
  let setArray!: (fn: (draft: number[]) => void) => void;
  const seenArray: string[] = [];
  createRoot(() => {
    [array, setArray] = createOptimisticStore([0, 0]);
    createRenderEffect(
      () => array.join(","),
      v => void seenArray.push(v)
    );
  });
  flush();
  expect(seenArray.at(-1)).toBe("0,0");

  // The first action guesses index 1, then — after the second action's
  // guess is out — writes its own index again with a new value.
  const save1 = action(function* () {
    setArray(draft => {
      draft[1] = 2;
    });
    yield gate1a.promise;
    setArray(draft => {
      draft[1] = 11;
    });
    yield gate1b.promise;
  });
  const save2 = action(function* () {
    setArray(draft => {
      draft[0] = 1;
    });
    yield gate2.promise;
  });

  const p1 = save1();
  flush();
  expect(seenArray.at(-1)).toBe("0,2");

  const p2 = save2();
  flush();
  expect(seenArray.at(-1)).toBe("1,2");

  // The lending action's re-write wins over the other guess's borrowed
  // copy of the old value.
  gate1a.resolve();
  await new Promise(r => setTimeout(r, 0));
  flush();
  expect(seenArray.at(-1)).toBe("1,11");
  expect(array[1]).toBe(11);

  // The first action ends: its index reverts, the other guess stays.
  gate1b.resolve();
  await p1;
  flush();
  expect(seenArray.at(-1)).toBe("1,0");
  expect(array[1]).toBe(0);
  expect(array[0]).toBe(1);

  gate2.resolve();
  await p2;
  flush();
  expect(seenArray.at(-1)).toBe("0,0");
});
