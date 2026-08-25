import { lazy } from "solid-js";
const A = lazy(function () {
  return import("./A");
}, void 0, "__SOLID_LAZY_MODULE__:./A");
const B = lazy(() => {
  return import("./B");
}, void 0, "__SOLID_LAZY_MODULE__:./B");
const C = lazy(() => {
  console.log("loading");
  return import("./C");
});
export { A, B, C };
