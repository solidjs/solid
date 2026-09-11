import h from "@solidjs/h";
export type { JSX } from "./jsx.d.ts";
import type { JSX } from "./jsx.d.ts";

function Fragment(props: { children: JSX.Element }) {
  return props.children;
}

// Explicit return annotation keeps tsc from inlining `import("../../types/hyperscript").HyperElement`
// in the emitted .d.ts; the public type is `JSX.Element`, not a relative path into the parent
// package's declaration folder.
function jsx(type: any, props: any): JSX.Element {
  return h(type, props) as unknown as JSX.Element;
}

// support React Transform in case someone really wants it for some reason
export { jsx, jsx as jsxs, jsx as jsxDEV, Fragment };
