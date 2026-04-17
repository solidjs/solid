import {
  createStore,
  createProjection,
  createOptimisticStore,
  type Store
} from "../../src/index.js";

// ── createStore (non-projection) ──────────────────────────────────────

{
  const [store, setStore] = createStore({ name: "John", age: 30 });
  store.name satisfies string;
  store.age satisfies number;
  // @ts-expect-error readonly
  store.name = "Jake";
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
}
