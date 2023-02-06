import { mergeProps, splitProps } from "../src";

type Assert<T extends true> = never;
// from: https://github.com/Microsoft/TypeScript/issues/27024#issuecomment-421529650
type IsExact<T, U, I = never> = (<G>() => G extends T | I ? 1 : 2) extends <G>() => G extends U | I
  ? 1
  : 2
  ? true
  : false;

// m1: mergeProps multiple property case
const m1 = mergeProps(
  {} as {
    a: number;
    b: number;
    c: number;
    d?: number;
    e?: number;
    f?: number;
    i: number;
    j?: number;
    m: undefined;
    n: undefined;
    o?: undefined;
    p: number;
    q: 1;
    r: number;
    s: 1;
  },
  {} as {
    b: string;
    c?: string;
    e: string;
    f?: string;
    g: string;
    h?: string;
    i: undefined;
    j: undefined;
    k: undefined;
    l?: undefined;
    m: string;
    n?: string;
    o?: string;
    p: 1;
    q: number;
    r?: 1;
    s?: number;
  }
);
type M1 = typeof m1;
type TestM1 = Assert<
  IsExact<
    M1,
    {
      a: number;
      b: string;
      c: string | number;
      d?: number | undefined;
      e: string;
      f?: string | number | undefined;
      g: string;
      h?: string;
      i: number;
      j: number | undefined;
      k: undefined;
      l?: undefined;
      m: string;
      n: string | undefined;
      o?: string | undefined;
      p: 1;
      q: number;
      r: number;
      s: number;
    }
  >
>;

// m2-m3: mergeProps single property cases
// optional is kept optional
const m2 = mergeProps({ a: 1 } as { a?: number }, { a: 1 } as { a?: number });
type M2 = typeof m2;
type TestM2 = Assert<IsExact<M2, { a?: number }>>;

// undefined is ignored
const m3 = mergeProps({ a: 1 }, { a: undefined });
type M3 = typeof m3;
type TestM3 = Assert<IsExact<M3, { a: number }>>;

// m4: mergeProps works with generics (best effort)
type M4Type = {
  a: { aProp: string; test: string };
  b: { bProp: number; test: string };
};
function M4<T extends keyof M4Type = "a">(
  props: { prop: "a" | "b" } & { as: T } & Omit<M4Type[T], "any">
) {
  const defaultProperties = { prop: "a" };
  const test1 = mergeProps(defaultProperties, props);
  const prop1: "a" | "b" = test1.prop;
  const propstr1: string = test1.prop;
  const as1: T = test1.as;
  const str1: string = test1.test;
  test1.prop = "a";
  test1.as = "" as T;
  test1.test = "";

  const test2 = mergeProps(defaultProperties, props as { prop: "a" | "b" } & { as: T } & M4Type[T]);
  const prop2: "a" | "b" = test2.prop;
  const propstr2: string = test2.prop;
  const as2: T = test2.as;
  const str2: string = test2.test;
  test2.prop = "a";
  test2.as = "" as T;
  test2.test = "";

  const test3 = mergeProps(defaultProperties, ...[props]);
  // @ts-expect-error prop could be string if props is empty
  const prop3: "a" | "b" = test3.prop;
  const propstr3: string = test3.prop;
  const as3: T = test3.as!;
  const str3: string = test3.test!;
  test3.prop = "a";
  // @ts-expect-error it doesn't need to be assignable, regardless this shouldn't error
  test3.as = "" as T;
  // @ts-expect-error it doesn't need to be assignable, regardless this shouldn't error
  test3.test = "";

  const test4 = mergeProps(...[defaultProperties], props);
  const prop4: "a" | "b" = test4.prop;
  const propstr4: string = test4.prop;
  const as4: T = test4.as;
  const str4: string = test4.test;
  test4.prop = "a";
  test4.as = "" as T;
  test4.test = "";

  const test5 = mergeProps(defaultProperties, ...[props], props);
  const prop5: "a" | "b" = test5.prop;
  const propstr5: string = test5.prop;
  const as5: T = test5.as;
  const str5: string = test5.test;
  test5.prop = "a";
  // @ts-expect-error it doesn't need to be assignable, regardless this shouldn't error
  test5.as = "" as T;
  // @ts-expect-error it doesn't need to be assignable, regardless this shouldn't error
  test5.test = "";

  const test6 = mergeProps(props, props);
  const prop6: "a" | "b" = test6.prop;
  const propstr6: string = test6.prop;
  const as6: T = test6.as;
  const str6: string = test6.test;
  test6.prop = "a";
  test6.as = "" as T;
  test6.test = "";
}

{
  const a = { a: 1 };
  const b = { b: 2 };
  const c = { c: 3 };
  const bc = { b: 2, c: 3 };
  // m5-m7: mergeProps spreading arrays is valid
  const m5 = mergeProps(a, ...[b], c);
  type M5 = typeof m5;
  type TestM5 = Assert<IsExact<M5, { a: number; b?: number; c: number }>>;

  const m6 = mergeProps(...[b], c);
  type M6 = typeof m6;
  type TestM6 = Assert<IsExact<M6, { b?: number; c: number }>>;

  const m7 = mergeProps(a, ...[b]);
  type M7 = typeof m7;
  type TestM7 = Assert<IsExact<M7, { a: number; b?: number }>>;

  const m8 = mergeProps(...[b]);
  type M8 = typeof m8;
  type TestM8 = Assert<IsExact<M8, { b?: number }>>;

  const m9 = mergeProps(...[a], ...[b], ...[c]);
  type M9 = typeof m9;
  type TestM9 = Assert<IsExact<M9, { a?: number; b?: number; c?: number }>>;
}

// s1-s3: splitProps return type is correct regardless of usage
const s1 = splitProps({ a: 1, b: 2 }, ["a"]);
type S1 = typeof s1;
type TestS1 = Assert<IsExact<S1, [{ a: number }, { b: number }]>>;

const [, s2] = splitProps({ a: 1, b: 2 }, ["a"]);
type S2 = typeof s2;
type TestS2 = Assert<IsExact<S2, { b: number }>>;

const [s3] = splitProps({ a: 1, b: 2 }, ["a"]);
type S3 = typeof s3;
type TestS3 = Assert<IsExact<S3, { a: number }>>;
