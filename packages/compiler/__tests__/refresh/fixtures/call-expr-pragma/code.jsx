import { createButton, createBox } from './factory';

// #3090 (native-first divergence from the frozen Babel reference): the
// per-binding `@refresh component` pragma asserts a call-shaped binding is a
// component when no in-module JSX usage can prove it (export-only shapes).

// Init position (the shape from the issue).
export const Badge = /* @refresh component */ createButton({ color: "red" });

// @refresh component
export const Box = createBox();

// No pragma, no in-module render: stays bare.
export const Plain = createBox();
