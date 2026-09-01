---
"@solidjs/signals": patch
---

Group the write-side patch-channel fields (`wk`, `p`, `ro`, `sp`) into one lazily-allocated `pc` extension on store targets and delete the dead prototype binding registry (`b`). Array proxy targets carry their fields as named properties on a real array, and V8 normalizes arrays to dictionary properties as the named count grows — at 24 fields every trap read had become a hash lookup (~15% uibench, tree-heavy scenarios worst). The target is capped at 20 named fields with the shape rule documented; future patch-channel state goes inside `pc`.
