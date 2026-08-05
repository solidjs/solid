---
"@solidjs/web": minor
---

New `asyncArg` helper on `@solidjs/web/frames` (both faces): the type-level statement of the DR-2 value-tier contract at the slot border. What you pass is what ships — the promise / async iterable itself rides the data channel — but the client's prop read settles, so `Slot<P>` deliberately types the fill's props as the settled values. `asyncArg<T>(value: PromiseLike<T> | AsyncIterable<T>): T` is the identity that lets a server component pass an async value through a slot typed with its settled shape without widening `Slot`'s parameter type (which would leak async unions into every client fill's contextual typing).
