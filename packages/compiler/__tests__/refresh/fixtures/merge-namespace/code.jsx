// solid-refresh#76 / vite-plugin-solid#145: the post-tsc-strip shape of
// `function A() {}` merged with `namespace A { ... }` — the namespace
// lowers to an IIFE that reads and conditionally assigns the function
// binding, so rewriting the declaration into `const A = $$component(...)`
// would break the merge. `A` stays untouched; the plain component `B`
// still wraps.
function A() {
  return <>1</>;
}
(function (A) {
  A.a = 1;
})(A || (A = {}));

function B() {
  return <div>{A.a}</div>;
}

console.log(A, B);
