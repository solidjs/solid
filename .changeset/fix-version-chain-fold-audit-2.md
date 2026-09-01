---
"@solidjs/signals": patch
---

Close the second fold-audit round on the structural version chain: consumers mounted inside a writing transition initialize their version baseline from the full emitted version (they read the speculative view — the old visible-version init replayed stashed ops over DOM already built from them), staged reveals ride exactly one channel (aligned windows are slot ticks, length changes are row ops — never both for one replacement), staged-reveal identity diffs key rows through the family map so re-seated raws on retained rows no longer rebuild stable proxies, held structural releases fast-forward the applied version (no redundant follow-up resync), and version arithmetic drops its signed-32 coercions (the 2^31 wrap eventually suppressed delivery permanently).
