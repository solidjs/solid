// solid-refresh#76 / vite-plugin-solid#145: TypeScript declaration merging
// before the TS strip. esbuild rejects `const A`/`var A` next to
// `namespace A` ("The symbol A has already been declared"), so merged
// component declarations keep their original `function` form. The plain
// component `Other` still wraps.
export function A(props: { x?: number }) {
  return <>{props.x ?? A.defaultX}</>;
}
export namespace A {
  export const defaultX = 1;
}

export function Other() {
  return <A x={2} />;
}
