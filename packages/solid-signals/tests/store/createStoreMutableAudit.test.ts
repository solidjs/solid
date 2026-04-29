import { createEffect, createProjection, createRoot, createStore, flush } from "../../src/index.js";

describe("createStore mutable write audit", () => {
  afterEach(() => flush());

  describe("presence and key tracking", () => {
    test.fails("setting undefined on an absent key preserves property presence", () => {
      const [store, setStore] = createStore<{ value?: string }>({});
      const effect = vi.fn();

      createRoot(() =>
        createEffect(
          () => "value" in store,
          value => effect(value)
        )
      );
      flush();

      setStore(s => {
        s.value = undefined;
      });
      flush();

      expect("value" in store).toBe(true);
      expect(effect).toHaveBeenCalledTimes(2);
      expect(effect).toHaveBeenLastCalledWith(true);
    });

    test("deleting a missing key does not notify key iteration", () => {
      const [store, setStore] = createStore<{ value?: string }>({});
      const effect = vi.fn();

      createRoot(() =>
        createEffect(
          () => Object.keys(store),
          value => effect(value)
        )
      );
      flush();

      setStore(s => {
        delete s.value;
      });
      flush();

      expect(effect).toHaveBeenCalledTimes(1);
      expect(effect).toHaveBeenLastCalledWith([]);
    });

    test("deleting an undefined key notifies presence checks", () => {
      const [store, setStore] = createStore<{ value?: string }>({ value: undefined });
      const effect = vi.fn();

      createRoot(() =>
        createEffect(
          () => "value" in store,
          value => effect(value)
        )
      );
      flush();

      setStore(s => {
        delete s.value;
      });
      flush();

      expect("value" in store).toBe(false);
      expect(effect).toHaveBeenCalledTimes(2);
      expect(effect).toHaveBeenLastCalledWith(false);
    });

    test.fails("hasOwnProperty tracks property additions", () => {
      const [store, setStore] = createStore<{ value?: string }>({});
      const effect = vi.fn();

      createRoot(() =>
        createEffect(
          () => store.hasOwnProperty("value"),
          value => effect(value)
        )
      );
      flush();

      setStore(s => {
        s.value = "set";
      });
      flush();

      expect(store.hasOwnProperty("value")).toBe(true);
      expect(effect).toHaveBeenCalledTimes(2);
      expect(effect).toHaveBeenLastCalledWith(true);
    });
  });

  describe("accessor and descriptor writes", () => {
    test.fails("assigning through an accessor property calls its setter", () => {
      const source = {
        _value: 0,
        get value() {
          return this._value;
        },
        set value(next: number) {
          this._value = next;
        }
      };
      const [store, setStore] = createStore(source);
      const effect = vi.fn();

      createRoot(() =>
        createEffect(
          () => store.value,
          value => effect(value)
        )
      );
      flush();

      setStore(s => {
        s.value = 1;
      });
      flush();

      expect(store.value).toBe(1);
      expect(store._value).toBe(1);
      expect(effect).toHaveBeenCalledTimes(2);
      expect(effect).toHaveBeenLastCalledWith(1);
    });

    test.fails("setting a getter-only property does not invoke the getter repeatedly", () => {
      let reads = 0;
      const [store, setStore] = createStore({
        get value() {
          reads++;
          return 1;
        }
      });

      expect(store.value).toBe(1);
      expect(reads).toBe(1);

      setStore(s => {
        // @ts-expect-error audit runtime behavior for getter-only descriptors
        s.value = 2;
      });
      flush();

      expect(store.value).toBe(2);
      expect(reads).toBe(1);
    });

    test("objects returned by store methods remain reactive when they come from the store graph", () => {
      const [store, setStore] = createStore({
        child: { value: 0 },
        getChild() {
          return this.child;
        }
      });
      const effect = vi.fn();

      createRoot(() =>
        createEffect(
          () => store.getChild().value,
          value => effect(value)
        )
      );
      flush();

      setStore(s => {
        s.child.value = 1;
      });
      flush();

      expect(effect).toHaveBeenCalledTimes(2);
      expect(effect).toHaveBeenLastCalledWith(1);
    });
  });

  describe("prototype and class accessors", () => {
    test("prototype getters track instance field updates", () => {
      class Model {
        value = 0;
        get doubled() {
          return this.value * 2;
        }
      }
      const [store, setStore] = createStore(new Model());
      const effect = vi.fn();

      createRoot(() =>
        createEffect(
          () => store.doubled,
          value => effect(value)
        )
      );
      flush();

      setStore(s => {
        s.value = 2;
      });
      flush();

      expect(store.doubled).toBe(4);
      expect(effect).toHaveBeenCalledTimes(2);
      expect(effect).toHaveBeenLastCalledWith(4);
    });

    test("prototype getters track through projection stores seeded from another store", () => {
      class Model {
        value = 0;
        get doubled() {
          return this.value * 2;
        }
      }
      const [base, setBase] = createStore(new Model());
      const projection = createProjection<Model>(() => {}, base);
      const effect = vi.fn();

      createRoot(() =>
        createEffect(
          () => projection.doubled,
          value => effect(value)
        )
      );
      flush();

      setBase(s => {
        s.value = 3;
      });
      flush();

      expect(projection.doubled).toBe(6);
      expect(effect).toHaveBeenCalledTimes(2);
      expect(effect).toHaveBeenLastCalledWith(6);
    });

    test.fails("prototype setters are honored by draft writes", () => {
      class Model {
        value = 0;
        get doubled() {
          return this.value * 2;
        }
        set doubled(next: number) {
          this.value = next / 2;
        }
      }
      const [store, setStore] = createStore(new Model());

      setStore(s => {
        s.doubled = 10;
      });
      flush();

      expect(store.value).toBe(5);
      expect(store.doubled).toBe(10);
    });
  });

  describe("arrays and identity", () => {
    test.fails("array identity search methods match raw values from the source array", () => {
      const item = { id: 1 };
      const [store] = createStore([item]);

      expect(store.includes(item)).toBe(true);
      expect(store.indexOf(item)).toBe(0);
      expect(store.lastIndexOf(item)).toBe(0);
    });

    test("array identity search methods match store values", () => {
      const [store] = createStore([{ id: 1 }]);
      const item = store[0];

      expect(store.includes(item)).toBe(true);
      expect(store.indexOf(item)).toBe(0);
      expect(store.lastIndexOf(item)).toBe(0);
    });

    test("array mutators do not recursively notify themselves", () => {
      const [store, setStore] = createStore<number[]>([]);
      const effect = vi.fn();

      createRoot(() =>
        createEffect(
          () => store.length,
          value => {
            effect(value);
            if (value === 0) {
              setStore(s => {
                s.push(1);
              });
            }
          }
        )
      );
      flush();

      expect(store.length).toBe(1);
      expect(effect).toHaveBeenCalledTimes(2);
      expect(effect).toHaveBeenLastCalledWith(1);
    });
  });

  describe("equality", () => {
    test.fails("NaN to NaN does not notify observers", () => {
      const [store, setStore] = createStore({ value: NaN });
      const effect = vi.fn();

      createRoot(() =>
        createEffect(
          () => store.value,
          value => effect(value)
        )
      );
      flush();

      setStore(s => {
        s.value = NaN;
      });
      flush();

      expect(effect).toHaveBeenCalledTimes(1);
    });
  });
});
