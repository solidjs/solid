---
"@solidjs/signals": patch
---

Gate the eager adoption parent-slot repair on patch consumers existing: ancestor committed raws are only handed to patch consumers, and in patch-less apps the ungated repair's privatization cascade re-cloned every freshly adopted interior backing per reconcile (an extra tree copy) while the identity swaps turned downstream equality gates into keyset/deep bump storms — an 11% CodSpeed regression on the listened-paths reconcile bench with zero channels registered. Patch-mode behavior is unchanged.
