---
"solid-js": patch
---

A component created outside any owner (at module scope, in a timer or event handler, or after an `await`) now runs under its own root in the production build, as it already did in dev and observe. Before, the production `createComponent` called the component with no owner, so `useContext` threw `NoOwnerError` there even when the context had a default, while dev returned the default. Components created under an owner run as before, with no extra root.
