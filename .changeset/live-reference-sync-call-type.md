---
"@solidjs/web": patch
---

Type the client `live()` reference truthfully: calling it returns the reconnecting iterable itself, synchronously — not a `Promise` of one. The declaration previously routed through `ServerFunction`, whose call signature promises `Promise<T>`; the mismatch was masked by the dangling declaration references this release also fixes. Isomorphic consumers are unaffected: they `await` the call, and awaiting the client's plain iterable is identity.
