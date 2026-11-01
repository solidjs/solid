---
"@solidjs/signals": patch
---

A verdict reader's one re-derive after a parked flush (D-2) runs in place: it compares against the staging it read, and when unchanged the readers that derived from that staging are adopted into the hold's verdict lane and revealed at its seam instead of re-running. A keyed `<Show>` over `latest()` now mounts its child once across the park (#4417); a frame derivation that read a held write re-derives as lane work (the lane sees the screen, D-37).
