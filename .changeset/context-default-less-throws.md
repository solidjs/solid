---
"solid-js": patch
---

`createContext<T>()` (default-less form) is now typed `Context<T>` (was `Context<T | undefined>`). `useContext` returns `T` directly and the runtime continues to throw `ContextNotFoundError` when no Provider is mounted (this was already the runtime behavior — only the type signature was lying).

This eliminates the `useX`-with-throw wrapper hook idiom: `const useTodos = () => { const t = useContext(Ctx); if (!t) throw …; return t; }` becomes a plain `useContext(TodosContext)` call.

The default form `createContext<T>(defaultValue)` is unchanged: `useContext` falls back to `defaultValue` outside any Provider. Reserved for primitive fallbacks (theme, locale, frozen config); for any context carrying reactive state, prefer the default-less form.

**Breaking:** consumers that rely on `useContext(ctx)` returning `undefined` for a default-less context (and branch on that) will now see the throw at runtime and the type narrowing they were doing becomes a type error. Migration: pass an explicit default to `createContext`, or remove the now-redundant null check.
