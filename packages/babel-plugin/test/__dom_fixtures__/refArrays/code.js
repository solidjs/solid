// Bare variables inside a ref array must be assigned at mount (#3285).
let elementRef;
const el1 = <div ref={[elementRef]} />;

// Multiple bare variables, each gets its own assignment callback.
let a, b;
const el2 = <div ref={[a, b]} />;

// Callback refs keep working and pass through untouched.
const el3 = <div ref={[node => calls.push(node)]} />;

// Member-expression targets are assignment callbacks too.
const holder = {};
const el4 = <div ref={[holder.el]} />;

// Nested arrays are recursed so runtime flattening reaches every callback.
let nested;
const el5 = <div ref={[[nested]]} />;

// Falsy/placeholder slots stay as-is (the runtime short-circuits them);
// globals like `undefined` are never treated as assignment targets.
const el6 = <div ref={[null, undefined, false]} />;

// A mutable binding that currently holds a function is *called*, not
// overwritten — same contract as the non-array lval ref branch.
let cb = () => {};
const el7 = <div ref={[cb]} />;
