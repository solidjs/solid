import {
  createEffect,
  createRoot,
  createSignal,
  createStore,
  flushSync,
  repeat
} from "../src/index.js";

it("should compute keyed map", () => {
  const [source, setSource] = createStore<Array<{ id: string }>>([
    { id: "a" },
    { id: "b" },
    { id: "c" }
  ]);

  const computed = vi.fn();

  const map = repeat(
    () => source.length,
    index => {
      computed();
      return {
        get id() {
          return source[index].id;
        },
        get index() {
          return index;
        }
      };
    }
  );

  const [a, b, c] = map();
  expect(a.id).toBe("a");
  expect(a.index).toBe(0);
  expect(b.id).toBe("b");
  expect(b.index).toBe(1);
  expect(c.id).toBe("c");
  expect(c.index).toBe(2);
  expect(computed).toHaveBeenCalledTimes(3);

  // Move values around
  setSource(p => {
    [p[0], p[1]] = [p[1], p[0]];
  });

  const [a2, b2, c2] = map();
  expect(a2.id).toBe("b");
  expect(a === a2).toBeTruthy();
  expect(a2.index).toBe(0);
  expect(b2.id).toBe("a");
  expect(b2.index).toBe(1);
  expect(b === b2).toBeTruthy();
  expect(c2.id).toBe("c");
  expect(c2.index).toBe(2);
  expect(c === c2).toBeTruthy();
  expect(computed).toHaveBeenCalledTimes(3);

  // Add new value
  setSource(p => p.push({ id: "d" }));

  expect(map().length).toBe(4);
  expect(map()[map().length - 1].id).toBe("d");
  expect(map()[map().length - 1].index).toBe(3);
  expect(computed).toHaveBeenCalledTimes(4);

  // Remove value
  setSource(p => p.pop());

  expect(map().length).toBe(3);
  expect(map()[0].id).toBe("b");
  expect(map()[0] === a2 && map()[0] === a).toBeTruthy();
  expect(computed).toHaveBeenCalledTimes(4);

  // Empty
  setSource(p => (p.length = 0));

  expect(map().length).toBe(0);
  expect(computed).toHaveBeenCalledTimes(4);
});

it("should notify observer", () => {
  const [source, setSource] = createStore([{ id: "a" }, { id: "b" }, { id: "c" }]);

  const map = repeat(
    () => source.length,
    index => {
      return {
        get id() {
          return source[index].id;
        }
      };
    }
  );

  const effect = vi.fn();
  createRoot(() => createEffect(map, effect));
  flushSync();

  setSource(prev => prev.pop());
  flushSync();
  expect(effect).toHaveBeenCalledTimes(2);
});

it("should compute map when key by index", () => {
  const [source, setSource] = createSignal([1, 2, 3]);

  const computed = vi.fn();
  const map = repeat(
    () => source().length,
    index => {
      computed();
      return {
        get id() {
          return source()[index] * 2;
        },
        get index() {
          return index;
        }
      };
    }
  );

  const [a, b, c] = map();
  expect(a.index).toBe(0);
  expect(a.id).toBe(2);
  expect(b.index).toBe(1);
  expect(b.id).toBe(4);
  expect(c.index).toBe(2);
  expect(c.id).toBe(6);
  expect(computed).toHaveBeenCalledTimes(3);

  // Move values around
  setSource([3, 2, 1]);

  const [a2, b2, c2] = map();
  expect(a2.index).toBe(0);
  expect(a2.id).toBe(6);
  expect(a === a2).toBeTruthy();
  expect(b2.index).toBe(1);
  expect(b2.id).toBe(4);
  expect(b === b2).toBeTruthy();
  expect(c2.index).toBe(2);
  expect(c2.id).toBe(2);
  expect(c === c2).toBeTruthy();
  expect(computed).toHaveBeenCalledTimes(3);

  // Add new value
  setSource([3, 2, 1, 4]);

  expect(map().length).toBe(4);
  expect(map()[map().length - 1].index).toBe(3);
  expect(map()[map().length - 1].id).toBe(8);
  expect(computed).toHaveBeenCalledTimes(4);

  // Remove value
  setSource([2, 1, 4]);

  expect(map().length).toBe(3);
  expect(map()[0].id).toBe(4);

  // Empty
  setSource([]);

  expect(map().length).toBe(0);
  expect(computed).toHaveBeenCalledTimes(4);
});
