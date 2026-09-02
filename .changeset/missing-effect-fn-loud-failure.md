---
"solid-js": patch
---

`createEffect(compute)` (single-argument form) is now a hard error. Solid 2.0's `createEffect` requires a separate effect callback as its second argument: `createEffect(() => signal(), value => doWork(value))`.

Two layers now surface the misuse:

- **TypeScript** — calls without a separate effect callback are rejected.
- **Runtime (dev)** — calling without an effect function now throws synchronously with a clear message and emits a new `MISSING_EFFECT_FN` diagnostic (replaces the previous opaque `TypeError: Cannot read properties of undefined`).

If you want a derived value, use `createMemo`. If you want a one-shot side effect at construction time, just call the function directly.
