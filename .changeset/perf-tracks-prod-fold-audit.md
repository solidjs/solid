---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Fold the source-name plumbing out of the production artifacts: `createStore`'s declared name is recorded in an observe-only branch of the public entry (no extra parameter on the store constructor), the web `spread` labels ride a module-level `spreadName` that `effect` and `insert` read while the spread body runs (no options argument at the call sites), and the boundary node names gate the call or set `_name` after it. The minified prod bundles are structurally identical to `next` (identifier-normalised diff empty); the observe-tier caps are ratcheted for the performance-tracks records with an audit note.
