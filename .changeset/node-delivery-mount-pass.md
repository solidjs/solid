---
"@solidjs/signals": patch
---

Node-delivery mount pass: per-channel delivery machinery (signal + effect) is now built lazily at the first consumer-visible emission instead of at registration, the effect is a detached single-source primitive (`deliveryEffect`, no root/owner allocation), and the machinery persists across consumer churn instead of disposing on last unbind (held write-time emissions survive unbound windows; re-binding rows reuse the node). dbmon mount returns to channel parity (6.4 ms) while keeping node delivery's tick win.
