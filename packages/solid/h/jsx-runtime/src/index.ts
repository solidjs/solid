import h from "solid-js/h";
export type { JSX } from "./jsx";
import type { JSX } from "./jsx";

function Fragment(props: { children: JSX.Element }) {
  return props.children;
}

// support React Transform in case someone really wants it for some reason
export { h as jsx, h as jsxs, h as jsxDEV, Fragment };
