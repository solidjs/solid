---
"solid-js": patch
---

Remove the unsupported `createEffect(compute)` overload. Solid 2.0 requires a separate effect callback as its second argument: `createEffect(() => signal(), value => doWork(value))`.

TypeScript now rejects single-argument calls instead of accepting them through a deprecated `never` overload. The dedicated development-only `MISSING_EFFECT_FN` diagnostic has also been removed; JavaScript callers receive the same runtime failure in development and production.

If you want a derived value, use `createMemo`. If you want a one-shot side effect at construction time, just call the function directly.
