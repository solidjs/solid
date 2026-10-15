---
"solid-js": patch
---

Hydration: a streamed `<Loading>` fragment that is the first to carry a `lazy()` module's assets now loads them before its resume claims the revealed content, instead of rendering nothing while they load and clearing the parent's revealed nodes (#4087).
