---
"@solidjs/signals": patch
---

Patch channel fold audit 6: deliveries consume delivery-node overrides so a settle-drain revert bump can never leak one onto a still-open lane (INV-6 at quiescence); the row matcher separates object-keyed and value-keyed key spaces so mixed primitive/object identities never collide (and the identity prefix scan is kind-aware); `undefined` rows and sparse holes match by sentinel so plain moves retain their rows.
