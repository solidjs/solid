---
"@solidjs/signals": patch
---

Index-mode `mapArray` (`<For keyed={false}>`) publishes the optimistic frame (optimistic-list-mutation-matrix finding F1).

A `mapArray` pass writes the list's per-slot signals — the row accessors of index mode, the index accessors of a keyed `<For>` with a two-argument mapper — with `setSignal`. Under an action's lane pass those writes were staged into the action's transaction instead of joining the lane's frame, so the row readers were served the committed value until the action landed: `<For keyed={false}>` showed the pre-action list for the whole action while the keyed modes showed the optimistic reorder, and a keyed row rendered its old index beside its new neighbours. The slot writes now go through the engine (`laneSlotWrite`): under a lane pass each is published as a derived override on the slot and the slot joins the lane (lanes stage, A17); a plain pass over a slot still carrying one lands through `landOnOverride` (A18: a differing landing supersedes, an equal one confirms and the revert promotes). Without the optimistic engine installed `mapArray` writes the slots plainly as before.
