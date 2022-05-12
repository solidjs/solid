import { mergeProps } from "../src";

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

const m4 = mergeProps({ a: 1 }, 1, null, undefined, () => 1, "", 3, { a: 1 });
type M4 = typeof m4;
type TestM4 = Assert<IsExact<M4, { a: number }>>;

// @ts-expect-error mergeProps requires at least one param
mergeProps();
