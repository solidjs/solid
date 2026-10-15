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

// ── createStore (projection) — seedless ───────────────────────────────

{
  const [store] = createStore(() => ({ foo: true }));
  store.foo satisfies boolean;
}

{
  const [store] = createStore(async () => ({ a: 1, b: "hello" }));
  store.a satisfies number;
  store.b satisfies string;
}

{
  const [store] = createStore(async function* () {
    yield { a: 1 };
  });
  store.a satisfies number;
}

{
  // The seed slot takes `undefined` to reach the options.
  const [store, setStore] = createStore(async () => ({ email: "a", n: 1 }), undefined, {
    key: "email"
  });
  store.n satisfies number;
  setStore(s => {
    s.n satisfies number;
  });
}

// @ts-expect-error A seed is a complete T; drop it for the seedless form.
createStore(() => ({ a: 1, b: "hello" }), { a: 0 });

// @ts-expect-error An empty object is not a complete T either.
createStore(() => ({ a: 1 }), {});

// @ts-expect-error A seedless derive takes no draft.
createStore((s: { a: number }) => {
  s.a = 1;
});

// @ts-expect-error A seedless root is a plain object; seed arrays with `[]`.
createStore(async () => [{ id: 1 }]);

// @ts-expect-error seedLoadingValue needs a seed to promote.
createStore(() => ({ a: 1 }), undefined, { seedLoadingValue: true });

{
  // An array root keeps its `[]` seed.
  const [store] = createStore(async () => [{ id: 1 }], []);
  store[0].id satisfies number;
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

// ── createProjection — seedless ───────────────────────────────────────

{
  const store = createProjection(() => ({ foo: true }));
  store.foo satisfies boolean;
}

{
  const store = createProjection(async () => ({ nested: { x: 1 } }));
  store.nested.x satisfies number;
}

// @ts-expect-error A seed is a complete T.
createProjection(() => ({ foo: true }), {});

// @ts-expect-error A seedless root is a plain object.
createProjection(() => [1, 2]);

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

// ── createOptimisticStore (projection) — seedless ─────────────────────

{
  const [store] = createOptimisticStore(async () => ({ foo: true }));
  store.foo satisfies boolean;
}

// @ts-expect-error A seed is a complete T.
createOptimisticStore(() => ({ foo: true }), {});

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
