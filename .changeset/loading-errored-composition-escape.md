---
"@solidjs/signals": patch
---

Fixed an error-routing escape in `Errored > Loading > Errored > content` composition: a sync error thrown by the content was routed past the inner `Errored` to the boundary above the `Loading` — both when the content threw during the same flush the boundaries mounted (e.g. navigating to a route that renders already-errored) and when it threw reactively after a healthy commit. The inner `Errored` consumed the ERROR dimension from the notification mask when it caught, but the `Loading` queue's notify-through remap keyed off the node's raw status flags and resurrected the already-caught error past its handler. The remap now only fires while the ERROR dimension is still live in the mask. Errors surfaced through DOM insertion effects were unaffected. Restores the beta.15 (and Solid 1.x) contract that `Loading > Errored > content` reliably catches at the inner boundary.
