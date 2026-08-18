---
"@solidjs/signals": minor
---

Store rewrite: projection infrastructure. Family wrapping (per-projection
child registries with firewall-carrying nodes), the storeSetterNext
primitive, write-override interop for post-await draft writes, the §6c
status gate (uninitialized async derives are unobservable through every
trap), replace-mode reconcile (projection roots merge entity changes in
place, displaced raws unregister), and a next-native createProjection
(bring-up: passes basics/selection; async and chained suites gate via the
next config while the default build keeps routing projections to legacy).
Also two correctness fixes benefiting all stores: the write-notification
diff no longer uses a lagging old-side (a recompute before the prior fold
commits could swallow changes), and node equality is logical-slot aware
(privatization/adoption raw-identity swaps no longer produce phantom
notifications).
