---
"@solidjs/signals": patch
---

Reader seat shadow (test-only): a new `core/seat.ts` computes the reader seat and slot table beside the existing deciders under `__TEST__`, with the `INV-seat` family recording disagreements for the differential. No change to any build output.
