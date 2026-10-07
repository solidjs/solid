---
"@solidjs/web": patch
---

frames: a reveal applies its range (frames-rulings 2.3, A3). A revealed segment's content is applied against the store as it is revealed — its fills mount and the segments whose placeholders it carries reveal inside it, in the same flush and before a reconstructed boundary commits the content — so the frame's flush no longer retries over its segments, and a segment nested in content a pending fill holds no longer waits for a chunk that never comes. The readiness/retry model's second ledger (`#revealed` / `#fallbackShown`) is gone: a reveal's applied state is the content record it applied, a fallback's the gate it materialized, by identity, in the one applied map; whether a segment is shown is the DOM's to say. `Frame.isRevealed(segment)` is removed.
