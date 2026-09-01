---
"@solidjs/signals": patch
---

Relocate the #3164 held-truth ledger and transition-optimism probe from the scheduler into the optimistic module, and fold the reader-posture exemptions (latest() window, authoritative-read observer) into the `_heldTruthMasked` hook. No behavior change; core-floor and non-optimistic bundles shed the bytes.
