---
"@solidjs/signals": patch
---

Integrate the patch channel with #3123's landing-consumption semantics: an equal landing no longer flashes committed state through value patches (the raw payload fast path is gated off optimistic families — deliveries take the override-composing proxy read, classic-effect parity), and a contradicting landing now notifies authoritatively — one regular-timed value delivery coalesced with the adoption's emission, plus a row-ops resync at the landing so driven lists learn the baseline flipped. A CONTINUATION landing's reckoning (wipe + retained-edit replay) notifies as one: per-edit row-ops frames are suppressed during replay and the landing emission carries the re-derived composed view, so a driven list never sees the bare landed base or intermediate replay drafts that classic readers never render.
