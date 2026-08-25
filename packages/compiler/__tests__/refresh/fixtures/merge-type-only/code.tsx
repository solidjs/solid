// Type-only declaration merging (interfaces, type aliases, ambient
// namespaces, overload signatures) is erased by the TS strip, so
// same-name components still wrap — only *value* merges suppress the
// function-to-const rewrite.
export interface A {
  x: number;
}
export function A() {
  return <>1</>;
}

type B = string;
function B() {
  return <>2</>;
}

declare namespace C {
  const c: number;
}
export function C(x: number): any;
export function C(x?: number) {
  return <>{x ?? 3}</>;
}

console.log(B);
