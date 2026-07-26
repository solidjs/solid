import {
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  reconcile
} from "../../src/index.js";

describe("Projection basics", () => {
  it("should observe key changes", () => {
    let effect0, effect1, effect2, $effect0, $effect1, $effect2, setSource;
    const dispose = createRoot(dispose => {
      let previous;
      const [$source, set] = createSignal(0),
        selected = createProjection(
          draft => {
            const s = $source();
            if (s !== previous) draft[previous] = false;
            draft[s] = true;
            previous = s;
          },
          [false, false, false]
        );
      effect0 = vi.fn(() => selected[0]);
      effect1 = vi.fn(() => selected[1]);
      effect2 = vi.fn(() => selected[2]);
      setSource = set;
      $effect0 = createMemo(effect0);
      $effect1 = createMemo(effect1);
      $effect2 = createMemo(effect2);
      return dispose;
    });

    expect($effect0()).toBe(true);
    expect($effect1()).toBe(false);
    expect($effect2()).toBe(false);

    expect(effect0).toHaveBeenCalledTimes(1);
    expect(effect1).toHaveBeenCalledTimes(1);
    expect(effect2).toHaveBeenCalledTimes(1);

    setSource(1);
    flush();

    expect($effect0()).toBe(false);
    expect($effect1()).toBe(true);
    expect($effect2()).toBe(false);

    expect(effect0).toHaveBeenCalledTimes(2);
    expect(effect1).toHaveBeenCalledTimes(2);
    expect(effect2).toHaveBeenCalledTimes(1);

    setSource(2);
    flush();

    expect($effect0()).toBe(false);
    expect($effect1()).toBe(false);
    expect($effect2()).toBe(true);

    expect(effect0).toHaveBeenCalledTimes(2);
    expect(effect1).toHaveBeenCalledTimes(3);
    expect(effect2).toHaveBeenCalledTimes(2);

    setSource(-1);
    flush();

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

    expect(effect0).toHaveBeenCalledTimes(2);
    expect(effect1).toHaveBeenCalledTimes(3);
    expect(effect2).toHaveBeenCalledTimes(3);
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
    flush();
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

      createRenderEffect(
        () => b.v,
        (v, p) => tmp(v, p)
      );
    });

    expect(tmp).toBeCalledTimes(1);
    expect(tmp).toBeCalledWith(1, undefined);

    tmp.mockReset();
    setX(2);
    flush();

    expect(tmp).toBeCalledTimes(1);
    expect(tmp).toBeCalledWith(2, 1);
  });
  it("should fork a signals values", () => {
    const [$x, setX] = createSignal<{ v: number; y?: number }>({ v: 1 });

    const tmp = vi.fn();

    createRoot(() => {
      const a = createProjection($x, { v: 0 });

      createRenderEffect(
        () => a.v,
        (v, p) => tmp(v, p)
      );

      createRenderEffect(
        () => a.y,
        (v, p) => tmp(v, p)
      );
    });

    expect(tmp).toBeCalledTimes(2);
    expect(tmp).toHaveBeenNthCalledWith(1, 1, undefined);
    expect(tmp).toHaveBeenNthCalledWith(2, undefined, undefined);
    tmp.mockReset();

    setX({ v: 2 });
    flush();

    expect(tmp).toBeCalledTimes(1);
    expect(tmp).toHaveBeenNthCalledWith(1, 2, 1);
    tmp.mockReset();

    setX({ v: 2, y: 3 });
    flush();
    expect(tmp).toBeCalledTimes(1);
    expect(tmp).toHaveBeenNthCalledWith(1, 3, undefined);
  });

  it("preserves inline object property writes when splicing draft arrays", () => {
    type Todo = { id: string; title: string; status: string; deleted?: boolean };
    const [$todos, setTodos] = createSignal<Todo[]>([
      { id: "1", title: "T1", status: "todo" },
      { id: "2", title: "T2", status: "todo" },
      { id: "3", title: "T3", status: "todo" }
    ]);

    const projection = createRoot(() =>
      createProjection<Todo[]>(draft => {
        const todos = $todos();
        for (let i = 0; i < todos.length; i++) {
          const todo = todos[i];
          const index = draft.findIndex(existing => existing.id === todo.id);
          const target = index === -1 ? draft.length : index;
          draft[target] = { id: todo.id } as Todo;
          draft[target].title = todo.title;
          draft[target].status = todo.status;
        }
        for (let i = draft.length - 1; i >= 0; i--) {
          if (todos.findIndex(todo => todo.id === draft[i].id) === -1) draft.splice(i, 1);
        }
      }, [])
    );

    expect(projection.map(todo => ({ ...todo }))).toEqual([
      { id: "1", title: "T1", status: "todo" },
      { id: "2", title: "T2", status: "todo" },
      { id: "3", title: "T3", status: "todo" }
    ]);

    setTodos(todos => todos.filter(todo => todo.id !== "2"));
    flush();

    expect(projection.map(todo => ({ ...todo }))).toEqual([
      { id: "1", title: "T1", status: "todo" },
      { id: "3", title: "T3", status: "todo" }
    ]);
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
      }, {});
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
    flush();
    expect(count).toBe(1);
    expect(list[3]).toBe("selected");

    count = 0;
    set(6);
    flush();
    expect(count).toBe(2);
    expect(list[3]).toBe("no");
    expect(list[6]).toBe("selected");
    set(undefined);
    flush();
    expect(count).toBe(3);
    expect(list[6]).toBe("no");
    set(5);
    flush();
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
      }, {});
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
    flush();
    expect(count).toBe(2);
    expect(list[3][0]).toBe("selected");
    expect(list[3][1]).toBe("oui");

    count = 0;
    set(6);
    flush();
    expect(count).toBe(4);
    expect(list[3][0]).toBe("no");
    expect(list[6][0]).toBe("selected");
    expect(list[3][1]).toBe("non");
    expect(list[6][1]).toBe("oui");
  });
});

describe("Projection root entity swap", () => {
  test("swaps in place when the derive returns a different entity", () => {
    const seen: string[] = [];
    let setId!: (v: number) => void;
    let user!: { id: number; name: string };

    createRoot(() => {
      const [id, set] = createSignal(1);
      setId = set;
      user = createProjection<{ id: number; name: string }>(
        () => ({ id: id(), name: `user ${id()}` }),
        {} as any
      );
      createRenderEffect(
        () => user.name,
        v => {
          seen.push(v);
        }
      );
    });

    flush();
    expect(seen).toEqual(["user 1"]);

    setId(2);
    flush();
    expect(seen).toEqual(["user 1", "user 2"]);
    expect(user.id).toBe(2);
  });

  test("does not merge children across an entity change", () => {
    // Both users own a post keyed `1`. They are different posts, so the row
    // must be a new proxy rather than user 2's title merged into user 1's.
    type Post = { id: number; title: string };
    const users: Record<number, { id: number; posts: Post[] }> = {
      1: { id: 1, posts: [{ id: 1, title: "one/a" }] },
      2: { id: 2, posts: [{ id: 1, title: "two/a" }] }
    };
    let setId!: (v: number) => void;
    let user!: { id: number; posts: Post[] };
    let firstPost!: Post;

    createRoot(() => {
      const [id, set] = createSignal(1);
      setId = set;
      user = createProjection<{ id: number; posts: Post[] }>(
        () => structuredClone(users[id()]),
        {} as any
      );
      createRenderEffect(
        () => user.posts[0],
        p => {
          firstPost = p;
        }
      );
    });

    flush();
    const beforeSwap = firstPost;
    expect(beforeSwap.title).toBe("one/a");

    setId(2);
    flush();
    expect(firstPost.title).toBe("two/a");
    expect(firstPost).not.toBe(beforeSwap);
    // The dropped entity's proxy keeps showing its own data.
    expect(beforeSwap.title).toBe("one/a");
  });

  test("keeps merging when identity is unchanged", () => {
    type User = { id: number; name: string; posts: { id: number; title: string }[] };
    let setName!: (v: string) => void;
    let user!: User;
    let firstPost!: { id: number; title: string };
    let postRuns = 0;

    createRoot(() => {
      const [name, set] = createSignal("Ada");
      setName = set;
      user = createProjection<User>(
        () => ({ id: 1, name: name(), posts: [{ id: 1, title: "a" }] }),
        {} as any
      );
      createRenderEffect(
        () => user.posts[0],
        p => {
          postRuns++;
          firstPost = p;
        }
      );
      createRenderEffect(
        () => user.name,
        () => {}
      );
    });

    flush();
    const before = firstPost;
    expect(postRuns).toBe(1);

    setName("Grace");
    flush();
    expect(user.name).toBe("Grace");
    // Same entity: the post keeps its proxy and the slot never re-notifies.
    expect(firstPost).toBe(before);
    expect(postRuns).toBe(1);
  });

  test("the outgoing raw stops resolving to the projection root", () => {
    const ONE = { id: 1, name: "one", self: null as any };
    const TWO = { id: 2, name: "two", self: null as any };
    // Each payload nests the previous entity, so a stale family-map entry for
    // the outgoing raw would surface the root proxy (showing the NEW entity)
    // where the OLD entity's data belongs.
    TWO.self = ONE;
    let setId!: (v: number) => void;
    let user!: { id: number; name: string; self: { id: number; name: string } | null };

    createRoot(() => {
      const [id, set] = createSignal(1);
      setId = set;
      user = createProjection<typeof TWO>(() => (id() === 1 ? ONE : TWO), {} as any);
      createRenderEffect(
        () => user.name,
        () => {}
      );
    });

    flush();
    setId(2);
    flush();
    expect(user.name).toBe("two");
    expect(user.self!.name).toBe("one");
    expect(user.self).not.toBe(user);
  });

  test("key: null merges positionally", () => {
    let setId!: (v: number) => void;
    let user!: { id: number; posts: { id: number; title: string }[] };
    let firstPost!: { id: number; title: string };

    createRoot(() => {
      const [id, set] = createSignal(1);
      setId = set;
      user = createProjection<typeof user>(
        () => ({ id: id(), posts: [{ id: id() * 10, title: `t${id()}` }] }),
        {} as any,
        { key: null }
      );
      createRenderEffect(
        () => user.posts[0],
        p => {
          firstPost = p;
        }
      );
    });

    flush();
    const before = firstPost;
    expect(before.title).toBe("t1");

    setId(2);
    flush();
    // Positional: slot 0 merges in place despite both ids changing.
    expect(user.id).toBe(2);
    expect(firstPost).toBe(before);
    expect(firstPost.title).toBe("t2");
  });

  test("reconcile() itself still rejects a root identity mismatch", () => {
    const [store, setStore] = createStore({ id: 1, name: "one" });
    expect(() => setStore(reconcile({ id: 2, name: "two" }))).toThrow(/different identity/);
  });
});
