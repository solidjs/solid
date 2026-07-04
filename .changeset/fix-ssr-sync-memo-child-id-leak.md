---
"solid-js": patch
---

Fix hydration key drift when a compiler-emitted expression memo reads a pending async source during streamed SSR (#2801). The server's lean sync memo re-runs its compute on every pull after a `NotReadyError`, but did so without resetting the owner's child state — each failed pull leaked the child-id slots it consumed (e.g. the inner condition memo of `{data().value && <h4>...</h4>}`), so hydration keys produced by the eventual successful pull drifted ahead of the client's single successful compute and the affected nodes went unclaimed (duplicated in prod, "unclaimed server-rendered node" warning in dev). The sync memo now disposes children and resets `_childCount` before each re-pull, mirroring how the client resets an owner on recompute, so every pull emits the same ids.
