import {
  createEffect,
  createRenderEffect,
  createMemo,
  Accessor,
  createSignal,
  Signal,
  Setter
} from "../src/index.js";

class Animal {
  #animal = null;
}
class Dog extends Animal {
  #dog = null;
}

//////////////////////////////////////////////////////////////////////////
// createEffect ///////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////

createEffect(
  () => "hello",
  () => {}
);
createEffect(
  prev => (prev ?? "") + "hello",
  () => {}
);
createEffect(
  (prev?: number) => (prev ?? 0) + 1,
  () => {}
);
createEffect<number>(
  () => 123,
  () => {}
);
createEffect<number | undefined>(
  (prev?: number) => prev ?? 1,
  () => {}
);
createEffect(
  (prev: Animal | undefined): Dog => (prev instanceof Dog ? prev : new Dog()),
  () => {}
);
createEffect(
  (prev?: number) => (prev ?? 0) + 1,
  () => {},
  {}
);

// @ts-expect-error the compute function must accept an undefined first prev
createEffect(
  (prev: number) => prev + 1,
  () => {}
);
createEffect(
  // @ts-expect-error void return is not assignable to number | undefined
  (prev?: number) => {},
  () => {}
);

//////////////////////////////////////////////////////////////////////////
// createRenderEffect /////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////

createRenderEffect(
  () => "hello",
  () => {}
);
createRenderEffect(
  prev => (prev ?? "") + "hello",
  () => {}
);
createRenderEffect(
  (prev?: number) => (prev ?? 0) + 1,
  () => {}
);
createRenderEffect<number>(
  () => 123,
  () => {}
);
createRenderEffect<number | undefined>(
  (prev?: number) => prev ?? 1,
  () => {}
);
createRenderEffect(
  (prev: Animal | undefined): Dog => (prev instanceof Dog ? prev : new Dog()),
  () => {}
);
createRenderEffect(
  (prev?: number) => (prev ?? 0) + 1,
  () => {},
  {}
);

// @ts-expect-error the compute function must accept an undefined first prev
createRenderEffect(
  (prev: number) => prev + 1,
  () => {}
);
createRenderEffect(
  // @ts-expect-error void return is not assignable to number | undefined
  (prev?: number) => {},
  () => {}
);

//////////////////////////////////////////////////////////////////////////
// createMemo /////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////

const memo1 = createMemo(() => "hello");
const memo1Value: string = memo1();

const memo2 = createMemo((prev?: number) => (prev ?? 0) + 1);
const memo2Value: number = memo2();

const memo3: Accessor<number | undefined> = createMemo<number | undefined>((prev?: number) => prev);
const memo3Value = memo3();
// @ts-expect-error memo3 may be undefined
const memo3Next = memo3Value + 1;

const memo4: Accessor<number> = createMemo<number>(() => 123);
const memo5: Accessor<number> = createMemo<number>((prev?: number | string) => 123);
const memo6 = createMemo(
  (prev: Animal | undefined): Dog => (prev instanceof Dog ? prev : new Dog())
);
const memo6Value: Dog = memo6();
const memo7 = createMemo((prev?: number) => {
  return (prev ?? 0) + 1;
}, {});
const memo7Value: number = memo7();

// @ts-expect-error the compute function must accept an undefined first prev
const memo8 = createMemo((prev: number) => prev + 1);
// @ts-expect-error void return is not assignable to number | undefined
const memo9 = createMemo((prev?: number) => {});

//////////////////////////////////////////////////////////////////////////
// createSignal ///////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////

const [count, setCount] = createSignal(1);
let countValue: number = count();
setCount(2);
setCount(prev => (countValue = prev + 1));
// @ts-expect-error initialized signal setter requires an argument
setCount();

const [maybeCount, setMaybeCount] = createSignal<number>();
// @ts-expect-error maybeCount can be undefined
const maybeCountValue: number = maybeCount();
setMaybeCount(1);
setMaybeCount(undefined);
setMaybeCount();

const [derived, setDerived] = createSignal((prev?: number) => (prev ?? count()) + 1);
const derivedValue: number = derived();
setDerived(10);
setDerived(prev => (prev ?? 0) + 1);

const [optimisticFnValue, setOptimisticFnValue] = createSignal<() => number>(() => () => 1);
// @ts-expect-error number is not assignable to function
setOptimisticFnValue(() => 1);
setOptimisticFnValue(() => () => 1);
const fnValue: () => number = optimisticFnValue();
const fnResult: number = optimisticFnValue()();

const [stringOrFunc, setStringOrFunc] = createSignal<(() => number) | string>("");
// @ts-expect-error number should not be assignable to string
setStringOrFunc(() => 1);
const stringOrFuncResult1: () => 1 = setStringOrFunc(() => () => 1);
const stringOrFuncResult2: "oh yeah" = setStringOrFunc("oh yeah");
const stringOrFuncResult3: "oh yeah" = setStringOrFunc(() => "oh yeah");
// @ts-expect-error cannot set signal to undefined
setStringOrFunc();
// @ts-expect-error cannot set signal to undefined
setStringOrFunc(undefined);

function createGenericSignal<T>(): Signal<T | undefined> {
  const [generic, setGeneric] = createSignal<T>();
  return [generic, setGeneric as Setter<T | undefined>];
}

function createInitializedSignal<T>(init: T): Signal<T> {
  const [generic, setGeneric] = createSignal<T>(() => init);
  return [generic, setGeneric as Setter<T>];
}

interface KobalteBaseSelectProps<Option, OptGroup = never> {
  options: Array<Option | OptGroup>;
}

interface KobaltSingleSelectProps<T> {
  value?: T | null;
  onChange?: (value: T) => void;
  multiple?: false;
}

interface KobaltMultiSelectProps<T> {
  value?: T[];
  onChange?: (value: T[]) => void;
  multiple?: true;
}

type KobaltSelectProps<Option, OptGroup = never> = (
  | KobaltSingleSelectProps<Option>
  | KobaltMultiSelectProps<Option>
) &
  KobalteBaseSelectProps<Option, OptGroup>;

type Fruits = "apple" | "banana" | "orange";
const fruits: Fruits[] = ["apple", "banana", "orange"];
const [fruit, setFruit] = createSignal<Fruits>("apple");
const [fruitArr, setFruitArr] = createSignal<Fruits[]>(["apple"]);
function kobalteSelect<T>(props: KobaltSelectProps<T>) {}
kobalteSelect({ value: fruit(), onChange: setFruit, options: fruits });
kobalteSelect<Fruits>({
  value: fruitArr(),
  onChange: setFruitArr,
  options: fruits,
  multiple: true
});

//////////////////////////////////////////////////////////////////////////
// explicit generic args //////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////

const explicitMemo: Accessor<number> = createMemo<number>(() => count());
createEffect<number>(
  () => count(),
  () => {}
);
createRenderEffect<number>(
  () => count(),
  () => {}
);

const explicitMemoWithPrev: Accessor<number> = createMemo<number>((prev?: number) => count());
createEffect<number>(
  (prev?: number) => count(),
  () => {}
);
createRenderEffect<number>(
  (prev?: number) => count(),
  () => {}
);

const explicitMaybeMemo: Accessor<number | undefined> = createMemo<number | undefined>(() =>
  count()
);
createEffect<number | undefined>(
  () => count(),
  () => {}
);
createRenderEffect<number | undefined>(
  () => count(),
  () => {}
);

// @ts-expect-error the compute function must accept an undefined first prev
const badExplicitMemo: Accessor<number> = createMemo<number>((prev: number) => count());
createEffect<number>(
  // @ts-expect-error the compute function must accept an undefined first prev
  (prev: number) => count(),
  () => {}
);
createRenderEffect<number>(
  // @ts-expect-error the compute function must accept an undefined first prev
  (prev: number) => count(),
  () => {}
);

//////////////////////////////////////////////////////////////////////////
// test setter invariance /////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////

declare const setNumber: Setter<number>;
declare const setNumberOrUndefined: Setter<number | undefined>;
declare const setUndefined: Setter<undefined>;
// @ts-expect-error can't set string to number, function form receives number
const s1: Setter<string> = setNumber;
// @ts-expect-error can't set string | undefined to number, function form receives number
const s2: Setter<string | undefined> = setNumber;
// @ts-expect-error can't set undefined to number, function form receives number
const s3: Setter<undefined> = setNumber;
// @ts-expect-error can't set string to number | undefined, function form receives number | undefined
const s4: Setter<string> = setNumberOrUndefined;
// @ts-expect-error can't set string to number, function form receives number
const s5: Setter<string | undefined> = setNumberOrUndefined;
// @ts-expect-error function form receives number
const s6: Setter<undefined> = setNumberOrUndefined;
// @ts-expect-error can't set string to undefined, function form receives undefined
const s7: Setter<string> = setUndefined;
// @ts-expect-error can't set string to undefined
const s8: Setter<string | undefined> = setUndefined;
