---
"@solidjs/web": patch
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
"@solidjs/signals": patch
"solid-js": patch
---

Dev builds now warn with `STRICT_READ_UNTRACKED` (#1742) when an element's event handler expression reads reactive state, e.g. `onClick={selected() ? a : b}` or a `props.onClick` the parent passed a reactive expression. A handler is bound once, where its element is created, so such a read is not meant to be reactive; the warning says to read the value inside the handler function instead. A pending async read there throws `PENDING_ASYNC_UNTRACKED_READ`, as in a component body. The read still tracks, so dev re-mounts on a change exactly as production does.

Production output is unchanged byte for byte. In dev DOM output both compilers wrap each handler expression that can read reactive state (anything but an identifier, an inline function or a literal), including the `[handler, data]` form's bound values on delegated events, in a new `strictHandler(() => expr)` helper from `@solidjs/web`. It reads `expr` through `strictReadTracked`, a dev-only strict-read window that keeps tracking (internal, from `@solidjs/signals` via `solid-js`). No production-compiled module imports either, so they tree-shake away.
