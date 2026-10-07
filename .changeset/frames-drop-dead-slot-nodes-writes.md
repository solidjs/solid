---
"@solidjs/web": patch
---

frames: drop the three dead `#slotNodes` writes for data occurrences — the only reader (the zombie check) skips data occurrences, so the consumer-element arrays were built and never read
