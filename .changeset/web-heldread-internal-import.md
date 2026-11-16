---
"@solidjs/web": patch
"solid-js": patch
---

`@solidjs/web`'s published declarations no longer import `heldRead` from `solid-js`, which strips it from its own declarations. Any project with `skipLibCheck: false` got a type error from rc.22's `client.d.ts`. The seam now comes from `solid-js/internal`, which declares it. A new `skipLibCheck: false` type check over every `@solidjs/web` entry's published declarations catches a stripped import before release.
