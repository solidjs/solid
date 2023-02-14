import h from "solid-js/h";
export type { JSX } from "./jsx";
import type { JSX } from "./jsx";

function Fragment(props: { children: JSX.Element }) {
  return props.children;
}

function jsx(type: any, props: any) {
  return h(type, props);
}

// support React Transform in case someone really wants it for some reason
export { jsx, jsx as jsxs, jsx as jsxDEV, Fragment };
