---
"@solidjs/signals": patch
---

Fix `refresh()` of an optimistic value throwing `GlobalQueue._notifyAuthoritativeObservers is not a function` and halting the graph in apps that never call `until()` (#3303). The refresh waiter reads authoritatively — the override is not the answer it waits for — which marks the node as authoritatively observed; when the re-ask then landed equal to the override, the wakeup went through a late-bound hook only `until()` installed. `refresh()` now installs it too.
