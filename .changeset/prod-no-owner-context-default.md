---
"@solidjs/signals": patch
---

In the production build, `getContext` (and so `useContext`) with no owner now reads as if under an empty root: it returns the context's default, and throws `ContextNotFoundError` when there is none. Before, it threw `NoOwnerError` even when the context had a default, so a component created outside any owner (JSX at module scope, in a timer or event handler, or after an `await`) crashed in production while dev and observe, whose `createComponent` runs each component in a root, returned the default. Dev still throws `NoOwnerError` for a bare read with no owner. Reads under an owner are unchanged.
