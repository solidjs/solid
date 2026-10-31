---
"@solidjs/signals": patch
---

An error boundary that a held pass mounts over a source whose error is staged in that hold (D-41) no longer loops the flush for good (#4480). The seam's fold-back of a fallback staged into the hold its readers landed in (D-16, U-9) is a loading boundary's: it also cleared an error boundary's readers, so the output re-derived into the staged error every round and the effect owning the boundary re-ran on each new output. The error now waits with the hold and its fallback reveals with the frame (D-41, F-12). Seen with a derived optimistic store whose re-ask failed while a guess was pending, read by an effect through `createErrorBoundary`.
