---
"@solidjs/h": patch
---

Zero-argument camelCase handlers (`onXxx`) and `ref` passed to component props are no longer wrapped in getters, so `h(Button, { onClick: () => save() })` passes the handler through as a function, matching compiled JSX and `@solidjs/html`. Every other zero-argument function prop, including `on`, `only`, and a lowercase `onclick`, is still a getter.
