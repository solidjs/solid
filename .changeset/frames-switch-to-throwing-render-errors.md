---
"@solidjs/web": patch
---

Navigating a frame to an address whose server render throws now shows the error in the nearest `<Errored>` and drops `isPending`, instead of keeping the previous content up while pending forever: the server sends that response's `:error` and `:complete` as one batch, and the landing now rejects on it.
