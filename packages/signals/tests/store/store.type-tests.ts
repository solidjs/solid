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

// ── projection seeds must be complete ────────────────────────────────

type UserState = { user: { name: string }; ready: boolean };

// @ts-expect-error An inferred seed cannot omit required properties.
createStore(() => ({ user: { name: "Ada" }, ready: true }), { ready: false });

// @ts-expect-error An explicit type argument cannot opt back into a partial seed.
createStore<UserState>(() => ({ user: { name: "Ada" }, ready: true }), {});

// ── callable store roots are rejected ────────────────────────────────

type CallableState = (() => void) & { count: number };
const callableState = Object.assign(() => {}, { count: 0 });

// @ts-expect-error A projection draft cannot represent a callable root.
createStore<CallableState>(() => callableState, callableState);

// @ts-expect-error A projection draft cannot represent a callable root.
createProjection<CallableState>(() => callableState, callableState);

// @ts-expect-error A projection draft cannot represent a callable root.
createOptimisticStore<CallableState>(() => callableState, callableState);

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

// @ts-expect-error createProjection also requires a complete seed.
createProjection(() => ({ user: { name: "Ada" }, ready: true }), { ready: false });

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

// @ts-expect-error createOptimisticStore also requires a complete seed.
createOptimisticStore(() => ({ user: { name: "Ada" }, ready: true }), { ready: false });

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
