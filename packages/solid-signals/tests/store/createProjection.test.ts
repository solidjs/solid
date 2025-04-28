import {
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flushSync
} from "../../src/index.js";

describe("Projection basics", () => {
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

      expect($effect0()).toBe(false);
      expect($effect1()).toBe(true);
      expect($effect2()).toBe(false);

      expect(effect0).toHaveBeenCalledTimes(2);
      expect(effect1).toHaveBeenCalledTimes(2);
      expect(effect2).toHaveBeenCalledTimes(1);

      setSource(2);

      expect($effect0()).toBe(false);
      expect($effect1()).toBe(false);
      expect($effect2()).toBe(true);

      expect(effect0).toHaveBeenCalledTimes(2);
      expect(effect1).toHaveBeenCalledTimes(3);
      expect(effect2).toHaveBeenCalledTimes(2);

      setSource(-1);

      expect($effect0()).toBe(false);
      expect($effect1()).toBe(false);
      expect($effect2()).toBe(false);

      expect(effect0).toHaveBeenCalledTimes(2);
      expect(effect1).toHaveBeenCalledTimes(3);
      expect(effect2).toHaveBeenCalledTimes(3);

      dispose();

      setSource(0);
      setSource(1);
      setSource(2);

      // expect($effect0).toThrow();
      // expect($effect1).toThrow();
      // expect($effect2).toThrow();

      expect(effect0).toHaveBeenCalledTimes(2);
      expect(effect1).toHaveBeenCalledTimes(3);
      expect(effect2).toHaveBeenCalledTimes(3);
    });
  });

  it("should not self track", () => {
    const spy = vi.fn();
    const [bar, setBar] = createSignal("foo");
    const projection = createRoot(() =>
      createProjection(
        draft => {
          draft.foo = draft.bar;
          draft.bar = bar();
          spy();
        },
        { foo: "foo", bar: "bar" }
      )
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

  it("should work for chained projections", () => {
    const [$x, setX] = createSignal(1);

    const tmp = vi.fn();

    createRoot(() => {
      const a = createProjection(
        state => {
          state.v = $x();
        },
        {
          v: 0
        }
      );

      const b = createProjection(
        state => {
          state.v = a.v;
        },
        {
          v: 0
        }
      );

      createRenderEffect(() => b.v, (v, p) => tmp(v, p));
    });
    flushSync();

    expect(tmp).toBeCalledTimes(1);
    expect(tmp).toBeCalledWith(1, undefined);

    tmp.mockReset();
    setX(2);
    flushSync();

    expect(tmp).toBeCalledWith(2, 1);
    expect(tmp);
  });
});

describe("selection with projections", () => {
  test("simple selection", () => {
    let prev: number | undefined;
    const [s, set] = createSignal<number>();
    let count = 0;
    const list: Array<string> = [];

    createRoot(() => {
      const isSelected = createProjection<Record<number, boolean>>(state => {
        const selected = s();
        if (prev !== undefined && prev !== selected) delete state[prev];
        if (selected) state[selected] = true;
        prev = selected;
      });
      Array.from({ length: 100 }, (_, i) =>
        createRenderEffect(
          () => isSelected[i],
          v => {
            count++;
            list[i] = v ? "selected" : "no";
          }
        )
      );
    });
    expect(count).toBe(100);
    expect(list[3]).toBe("no");

    count = 0;
    set(3);
    flushSync();
    expect(count).toBe(1);
    expect(list[3]).toBe("selected");

    count = 0;
    set(6);
    flushSync();
    expect(count).toBe(2);
    expect(list[3]).toBe("no");
    expect(list[6]).toBe("selected");
    set(undefined);
    flushSync();
    expect(count).toBe(3);
    expect(list[6]).toBe("no");
    set(5);
    flushSync();
    expect(count).toBe(4);
    expect(list[5]).toBe("selected");
  });

  test("double selection", () => {
    let prev: number | undefined;
    const [s, set] = createSignal<number>();
    let count = 0;
    const list: Array<string>[] = [];

    createRoot(() => {
      const isSelected = createProjection<Record<number, boolean>>(state => {
        const selected = s();
        if (prev !== undefined && prev !== selected) delete state[prev];
        if (selected) state[selected] = true;
        prev = selected;
      });
      Array.from({ length: 100 }, (_, i) => {
        list[i] = [];
        createRenderEffect(
          () => isSelected[i],
          v => {
            count++;
            list[i][0] = v ? "selected" : "no";
          }
        );
        createRenderEffect(
          () => isSelected[i],
          v => {
            count++;
            list[i][1] = v ? "oui" : "non";
          }
        );
      });
    });
    expect(count).toBe(200);
    expect(list[3][0]).toBe("no");
    expect(list[3][1]).toBe("non");

    count = 0;
    set(3);
    flushSync();
    expect(count).toBe(2);
    expect(list[3][0]).toBe("selected");
    expect(list[3][1]).toBe("oui");

    count = 0;
    set(6);
    flushSync();
    expect(count).toBe(4);
    expect(list[3][0]).toBe("no");
    expect(list[6][0]).toBe("selected");
    expect(list[3][1]).toBe("non");
    expect(list[6][1]).toBe("oui");
  });
});
