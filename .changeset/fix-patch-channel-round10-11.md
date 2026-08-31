---
"@solidjs/signals": patch
---

Round-10.11 audit fixes: demotion bubbles ancestors from inside demoteToEffects itself (a fold on a previously-demoted child with persistent delivery machinery hit an empty demote and froze ancestor patches — primitive-owned bubbling closes every such seam); envelope traversal uses a root-aligned deep index (linear, built once per interned manifest); coalesced ancestor bumps append every originating child to the pending stamp's causes; and structural row-ops/slot dispatches ride the same engine wide-write policy (consumer-list memo keys).
