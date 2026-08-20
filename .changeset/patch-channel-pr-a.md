---
"@solidjs/signals": patch
---

Stage 2 (PR-A, in progress): the patch channel core. Per-record compiled
patch consumers (`unstable_registerPatch`) dispatched by store visibility
transitions through a per-flush apply queue draining at effect-phase timing
under registering owners. Emission at the adoption walk and setter-notify
sites (fold-commit and override-lifecycle sites follow with the gauntlet);
dispatch bubbling reaches ancestor patches for targeted nested writes via a
forced re-apply; owned prevs are snapshotted (single-home folds mutate in
place). Unpatched stores pay a null check; the module tree-shakes out of
non-store bundles (treeshake gates green). Measured: effect-phase timing
costs nothing over the prototype's walk-side dispatch — deep-with-patches
holds octane-class full ticks with correct semantics.
