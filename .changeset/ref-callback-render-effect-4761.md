---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
"@solidjs/universal": patch
---

A ref callback (`ref={el => …}`) now runs the way a render effect's callback runs at creation (#4761). It is untracked and runs in the context of the pass that creates the element, so its reads see what that pass is building. Before, it ran with no owner, so its reads were outside reads that saw the screen before the pass committed. A non-keyed `<Show>`/`<Match>` branch that an optimistic write had hidden could not come back: its ref read the narrowed accessor, got the old falsy condition, and threw a stale read that halted the app.

A ref still owns nothing. In dev, creating a memo, effect or root inside it throws `PRIMITIVE_IN_EFFECT_CALLBACK`, and `onCleanup` inside it throws `CLEANUP_IN_FORBIDDEN_SCOPE`. Set those up in the factory that returns the ref, which runs in the component body. Writes, `refresh`, action calls and `onFlush` stay allowed in a ref, as in an effect callback.
