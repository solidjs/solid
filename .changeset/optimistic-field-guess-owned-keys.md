---
"@solidjs/signals": patch
---

An optimistic store setter composes each key from the guess a read of that key finds, so a guess on a field keeps an earlier guess on it when a guess on another field came between (#4988).
