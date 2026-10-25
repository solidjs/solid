---
"@solidjs/signals": patch
---

`UNSTABLE_MEMO_OUTPUT` no longer reports the memo `merge()` creates for a function source, such as a compiled conditional component spread (`<Child {...(on() ? { tone } : {})} />`). No one can pass that memo `equals`, so the warning had no fix (#4256). In observe builds the memo is now named `merge`. Production output is unchanged.
