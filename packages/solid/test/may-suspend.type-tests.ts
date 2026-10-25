import {
  createMemo,
  createProjection,
  createSignal,
  createStore,
  Accessor,
  MaySuspend
} from "../src/index.js";

declare const h: Accessor<number>;
declare const v: Accessor<boolean>;
const suspends = (x: MaySuspend) => x;

// async sources carry the brand
suspends(createMemo(async () => 1));
suspends(
  createMemo(async function* () {
    yield 1;
  })
);
suspends(createMemo(() => (h() ? Promise.resolve(1) : 2)));
suspends(createMemo(async () => 1, { name: "named" }));
suspends(createProjection(async () => ({ a: 1 })));
suspends(createProjection(async draft => void (draft.a = 1), { a: 0 }));
suspends(createSignal(async () => 1)[0]);
suspends(createStore(async () => ({ a: 1 }))[0]);
suspends(createStore(async draft => void (draft.a = 1), { a: 0 })[0]);

// sync sources, loading values and seed-as-loading-value do not
// @ts-expect-error
suspends(createMemo(() => 1));
// @ts-expect-error
suspends(createMemo(async () => 1, { loadingValue: 0 }));
// @ts-expect-error
suspends(createProjection(() => ({ a: 1 })));
// @ts-expect-error
suspends(createProjection(async draft => void (draft.a = 1), { a: 0 }, { seedLoadingValue: true }));
// @ts-expect-error
suspends(createSignal(() => 1)[0]);
// @ts-expect-error
suspends(createSignal(async () => 1, { loadingValue: 0 })[0]);
// @ts-expect-error
suspends(createSignal(1)[0]);
// @ts-expect-error
suspends(createStore({ a: 1 })[0]);
// @ts-expect-error
suspends(createStore(draft => void (draft.a = 1), { a: 0 })[0]);
// @ts-expect-error
suspends(createStore(async draft => void (draft.a = 1), { a: 0 }, { seedLoadingValue: true })[0]);
// @ts-expect-error explicit type arguments drop the brand (no partial inference)
suspends(createMemo<number>(async () => 1));
// @ts-expect-error a sync memo over an async one is not branded
suspends(createMemo(() => createMemo(async () => 1)() + 1));

// inference is unchanged
const t1: () => [number, boolean] = createMemo(() => [h(), v()]);
const t2: () => [number, boolean] = createMemo(async () => [h(), v()]);
const n1: number = createMemo(async () => 1)();
const n2: number = createMemo(prev => (prev ?? 0) + 1)();
const n3: number = createMemo<number>(async () => 1)();
const lit: "a" = createMemo(() => "a" as const)();
const asAccessor: Accessor<number> = createMemo(async () => 1);
const p1: number = createProjection(async () => ({ a: 1 })).a;
const [s1, setS1] = createSignal(async () => 1);
const s1n: number = s1();
setS1(2);
const [st1, setSt1] = createStore(async () => ({ a: 1 }));
const st1n: number = st1.a;
setSt1(d => void (d.a = 2));
// seeded draft forms infer T from the seed, not any
// @ts-expect-error
createProjection(async draft => void (draft.a = 1), { a: 0 }).b;
// @ts-expect-error
createStore(async draft => void (draft.a = 1), { a: 0 })[0].b;
// @ts-expect-error
createStore(draft => void (draft.a = 1), { a: 0 })[0].b;
// untyped arguments stay untyped, as before
declare const untyped: any;
createMemo(untyped)().anything;
createSignal(untyped)[0]().anything;
createStore(untyped)[0].anything;
createProjection(untyped).anything;
// @ts-expect-error wrong explicit type still errors
createMemo<string>(async () => 1);

export { t1, t2, n1, n2, n3, lit, asAccessor, p1, s1n, st1n };

declare const readCached: () => number;
declare const fetchFresh: () => Promise<number>;
declare const useCache: boolean;
suspends(createMemo(useCache ? readCached : fetchFresh));

// an untyped callback keeps the seed-inferred T
declare const untypedFn: any;
// @ts-expect-error
createStore(untypedFn, { a: 1 })[0].b;
// @ts-expect-error
createStore(untypedFn, { a: 1 })[1](d => void (d.a = "x"));
// @ts-expect-error
createProjection(untypedFn, { a: 1 }).b;
