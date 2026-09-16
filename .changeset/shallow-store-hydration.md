---
"@solidjs/signals": patch
"solid-js": patch
---

Preserve shallow store leaf identity in computed drafts, loading snapshots, and SSR hydration. Wait for the server answer and hydration completion before hybrid store takeover, and suppress the first client yield only during the initial handoff.
