---
"@solidjs/web": patch
---

The flash cookie key is now derived with PBKDF2 instead of a single SHA-256 hash.

- Guessing a weak `secret` from a captured cookie is now 100,000 times more expensive.
- Set `secret` to a high-entropy value of 32 bytes or more. The option docs show how to generate one.
- Flash cookies in flight when you deploy read as no flash, the same as a secret rotation.
