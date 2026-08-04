---
"@solidjs/web": minor
---

Server components Stage 2 (identity split): `dynamic` now consumes the transport's binding contract — a resolution branded `{ component, address }` whose component matches the mounted instance's keeps the instance and delivers the new address into a per-site live accessor ("same component, new props"), replacing the mount-stealing handoff protocol. The frames client mounts per-function components bound to per-call addresses (`followBinding` drives `frame.rebind`), document adoption binds the call's address from the hydration records, and the transport install drops the `documentComponent` seam — the document placeholder IS the per-function component. Argument changes at a live site, hover preloads, back-navigation re-materialization, and single-flight saves all flow through the one store-keyed-by-address model.
