---
"@solidjs/web": patch
"@solidjs/h": patch
---

`data-*` attributes type-check in props objects (`ComponentProps<"div">`, `JSX.HTMLAttributes<T>`), not only in JSX: a template-literal index signature on `ElementAttributes` (#4082).
