---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

An event handler built by a call (`onChange={makeHandler()}`) no longer subscribes the surrounding branch to the signals the call reads (#1742). The call is evaluated where the element is created, inside the branch's tracked compute, so writing a signal the factory read re-ran the branch and remounted the element and its siblings. The compilers now emit `untrack(() => makeHandler())`, and in dev a reactive read there reports STRICT_READ_UNTRACKED. Identifiers, inline functions and member expressions such as `props.onClick` compile as before, and the `[handler, data]` form on a non-delegated event already deferred its call into the listener.
