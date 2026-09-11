import {
  createStore,
  createProjection,
  createOptimisticStore,
  refresh,
  type Store
} from "../../src/index.js";

// ── createStore (non-projection) ──────────────────────────────────────

{
  const [store, setStore] = createStore({ name: "John", age: 30 });
  store.name satisfies string;
  store.age satisfies number;
}

// ── stores preserve the supplied type ────────────────────────────────

{
  const [source] = createStore([{ id: 1 }]);
  const [store, setStore] = createStore(source);
  setStore(draft => {
    draft.push({ id: 2 });
  });
  store satisfies { id: number }[];
}

{
  type List = { readonly id: string; items: { title: string }[] };
  const [list] = createStore<List>({ id: "todos", items: [] });
  const [store, setStore] = createStore({ list });
  setStore(draft => {
    draft.list.items = [{ title: "Review PR" }];
    // @ts-expect-error User-authored readonly remains readonly through nesting.
    draft.list.id = "done";
  });
  store satisfies { list: List };
}

{
  type State = { readonly id: number; name: string };
  const [store, setStore] = createStore<State>({ id: 1, name: "John" });
  store satisfies State;
  setStore(draft => {
    draft.name = "Jane";
    // @ts-expect-error User-authored readonly properties remain readonly.
    draft.id = 2;
  });
}

// ── createStore (projection) — seed matches return type ───────────────

{
  const [store] = createStore(
    s => {
      s.count = 1;
    },
    { count: 0 }
  );
  store.count satisfies number;
}

{
  const [store] = createStore(() => ({ count: 1 }), { count: 0 });
  store.count satisfies number;
}

// ── createStore (projection) — partial seed ───────────────────────────

{
  const [store] = createStore(() => ({ foo: true }), {});
  store.foo satisfies boolean;
}

{
  const [store] = createStore(() => ({ a: 1, b: "hello" }), {});
  store.a satisfies number;
  store.b satisfies string;
}

{
  const [store] = createStore(() => ({ a: 1, b: "hello" }), { a: 0 });
  store.a satisfies number;
  store.b satisfies string;
}

// ── createProjection — mutation only (void return, T from seed) ───────

{
  const store = createProjection(
    s => {
      s.count = 1;
    },
    { count: 0 }
  );
  store.count satisfies number;
}

{
  const store = createProjection(
    s => {
      s.name = "hello";
      s.active = true;
    },
    { name: "", active: false }
  );
  store.name satisfies string;
  store.active satisfies boolean;
}

// ── createProjection — partial seed ───────────────────────────────────

{
  const store = createProjection(() => ({ foo: true }), {});
  store.foo satisfies boolean;
}

{
  const store = createProjection(() => ({ nested: { x: 1 } }), {});
  store.nested.x satisfies number;
}

// ── createProjection — empty array seed ───────────────────────────────

{
  const store = createProjection(
    () => [{ id: 1, name: "a" }],
    [] as { id: number; name: string }[]
  );
  store[0].id satisfies number;
  store[0].name satisfies string;
}

// ── createProjection — store as seed ──────────────────────────────────

{
  const [todos] = createStore([] as { id: number; done: boolean }[]);
  const proj = createProjection(() => todos.filter(t => !t.done), todos);
  proj[0].id satisfies number;
  proj[0].done satisfies boolean;
}

{
  const [state] = createStore({ count: 0 });
  const proj = createProjection(() => ({ count: 1 }), state);
  proj.count satisfies number;
}

// ── createOptimisticStore (projection) — partial seed ─────────────────

{
  const [store] = createOptimisticStore(() => ({ foo: true }), {});
  store.foo satisfies boolean;
}

// ── createOptimisticStore (projection) — seed matches return type ─────

{
  const [store] = createOptimisticStore(
    s => {
      s.value = 42;
    },
    { value: 0 }
  );
  store.value satisfies number;
  void refresh(store);
}

// ── createOptimisticStore (plain) — options preserve inference ───────

{
  const [store] = createOptimisticStore([{ id: 1, value: "one" }], { shallow: true });
  store[0].value satisfies string;
}

// @ts-expect-error Plain optimistic stores do not reconcile snapshots by key.
createOptimisticStore({ id: 1 }, { key: "id" });
