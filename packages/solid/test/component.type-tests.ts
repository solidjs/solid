import { mergeProps, splitProps } from "../src";

type Assert<T extends true> = never;
type Not<T extends boolean> = [T] extends [true] ? false : true;
// from: https://github.com/Microsoft/TypeScript/issues/27024#issuecomment-421529650
type IsExact<T, U, I = never> = (<G>() => G extends T | I ? 1 : 2) extends <G>() => G extends U | I
  ? 1
  : 2
  ? true
  : false;
type IsRequired<T, K extends keyof T> = T extends { [_ in K]: unknown } ? true : false;
type ExactOptionalPropertyType<T, K extends keyof T> = T extends { [_ in K]?: infer I } ? I : never;
type IsOptionalProperty<T, K extends keyof T, P> = IsExact<
  ExactOptionalPropertyType<T, K>,
  P,
  [undefined] extends [0?] ? undefined : never
> extends true
  ? Not<IsRequired<T, K>>
  : false;
type IsRequiredProperty<T, K extends keyof T, P> = IsExact<T[K], P> extends true
  ? IsRequired<T, K>
  : false;

// normal merge cases
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
type TestM1 =
  | Assert<IsRequiredProperty<M1, "a", number>>
  | Assert<IsRequiredProperty<M1, "b", string>>
  | Assert<IsRequiredProperty<M1, "c", string | number>>
  | Assert<IsOptionalProperty<M1, "d", number>>
  | Assert<IsRequiredProperty<M1, "e", string>>
  | Assert<IsOptionalProperty<M1, "f", string | number>>
  | Assert<IsRequiredProperty<M1, "g", string>>
  | Assert<IsOptionalProperty<M1, "h", string>>
  | Assert<IsRequiredProperty<M1, "i", number>>
  | Assert<IsRequiredProperty<M1, "j", number | undefined>>
  | Assert<IsRequiredProperty<M1, "k", undefined>>
  | Assert<IsOptionalProperty<M1, "l", undefined>>
  | Assert<IsRequiredProperty<M1, "m", string>>
  | Assert<IsRequiredProperty<M1, "n", string | undefined>>
  | Assert<IsOptionalProperty<M1, "o", string | undefined>>
  | Assert<IsRequiredProperty<M1, "p", 1>>
  | Assert<IsRequiredProperty<M1, "q", number>>
  | Assert<IsRequiredProperty<M1, "r", number>>
  | Assert<IsRequiredProperty<M1, "s", number>>;

const m2 = mergeProps({ a: 1 } as { a?: number }, { a: 1 } as { a?: number });
type M2 = typeof m2;
type TestM2 = Assert<IsOptionalProperty<M2, "a", number>>;

const m3 = mergeProps({ a: 1 }, { a: undefined });
type M3 = typeof m3;
type TestM3 = Assert<IsRequiredProperty<M3, "a", number>>;

// @ts-expect-error mergeProps requires at least one param
mergeProps();

type M4Type = {
  a: { aProp: string; test: string };
  b: { bProp: number; test: string };
};

function M4<T extends keyof M4Type = "a">(
  props: { prop: "a" | "b" } & { as: T } & Omit<M4Type[T], "any">
) {
  const defaultProperties = { prop: "a" };
  const test1 = mergeProps(defaultProperties, props);

  // @ts-expect-error prop is type string
  const prop: "a" | "b" = test1.prop;
  test1.prop = "a";
  test1.as = "" as T;
  test1.test = "";
  const prop2: string = test1.prop;
  const as: T = test1.as;
  const test: string = test1.test;

  const test2 = mergeProps(
    defaultProperties,
    props as { prop: "a" | "b" } & { as: T } & M4Type[T]
  );
  // @ts-expect-error Type "''" is not assignable to type "'a' | 'b'"
  test2.prop = "";
  test2.as = "" as T;
  test2.test = "";
}

const s1 = splitProps({ a: 1, b: 2 }, ["a"]);
type S1 = typeof s1;
type TestS1 = Assert<IsExact<S1, [{ a: number }, { b: number }]>>;

const [, s2] = splitProps({ a: 1, b: 2 }, ["a"]);
type S2 = typeof s2;
type TestS2 = Assert<IsExact<S2, { b: number }>>;

const [s3] = splitProps({ a: 1, b: 2 }, ["a"]);
type S3 = typeof s3;
type TestS3 = Assert<IsExact<S3, { a: number }>>;
