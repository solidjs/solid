import { createMemo, createProjection, createRoot, createSignal, flushSync } from "../src/index.js";

it("should observe key changes", () => {
  createRoot(dispose => {
    let previous;
    const [$source, setSource] = createSignal(0),
      selected = createProjection(
        draft => {
          const s = $source();
          if (s !== previous) draft[previous] = false;
          draft[s] = true;
          previous = s;
        },
        [false, false, false]
      ),
      effect0 = vi.fn(() => selected[0]),
      effect1 = vi.fn(() => selected[1]),
      effect2 = vi.fn(() => selected[2]);

    let $effect0 = createMemo(effect0),
      $effect1 = createMemo(effect1),
      $effect2 = createMemo(effect2);

    expect($effect0()).toBe(true);
    expect($effect1()).toBe(false);
    expect($effect2()).toBe(false);

    expect(effect0).toHaveBeenCalledTimes(1);
    expect(effect1).toHaveBeenCalledTimes(1);
    expect(effect2).toHaveBeenCalledTimes(1);

    setSource(1);
    flushSync();

    expect($effect0()).toBe(false);
    expect($effect1()).toBe(true);
    expect($effect2()).toBe(false);

    expect(effect0).toHaveBeenCalledTimes(2);
    expect(effect1).toHaveBeenCalledTimes(2);
    expect(effect2).toHaveBeenCalledTimes(1);

    setSource(2);
    flushSync();

    expect($effect0()).toBe(false);
    expect($effect1()).toBe(false);
    expect($effect2()).toBe(true);

    expect(effect0).toHaveBeenCalledTimes(2);
    expect(effect1).toHaveBeenCalledTimes(3);
    expect(effect2).toHaveBeenCalledTimes(2);

    setSource(-1);
    flushSync();

    expect($effect0()).toBe(false);
    expect($effect1()).toBe(false);
    expect($effect2()).toBe(false);

    expect(effect0).toHaveBeenCalledTimes(2);
    expect(effect1).toHaveBeenCalledTimes(3);
    expect(effect2).toHaveBeenCalledTimes(3);

    dispose();

    setSource(0);
    flushSync();
    setSource(1);
    flushSync();
    setSource(2);
    flushSync();

    expect($effect0).toThrow();
    expect($effect1).toThrow();
    expect($effect2).toThrow();

    expect(effect0).toHaveBeenCalledTimes(2);
    expect(effect1).toHaveBeenCalledTimes(3);
    expect(effect2).toHaveBeenCalledTimes(3);
  });
});

it("should not self track", () => {
  const spy = vi.fn();
  const [bar, setBar] = createSignal("foo");
  const projection = createProjection(
    draft => {
      draft.foo = draft.bar;
      draft.bar = bar();
      spy();
    },
    { foo: "foo", bar: "bar" }
  );
  expect(projection.foo).toBe("bar");
  expect(projection.bar).toBe("foo");
  expect(spy).toHaveBeenCalledTimes(1);
  setBar("baz");
  flushSync();
  expect(projection.foo).toBe("foo");
  expect(projection.bar).toBe("baz");
  expect(spy).toHaveBeenCalledTimes(2);
});
