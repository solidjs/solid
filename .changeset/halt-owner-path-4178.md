---
"@solidjs/signals": patch
---

The dev `REACTIVITY_HALTED` message now says where the uncaught error escaped: it ends with the owner path of the computation that threw (`in <App> › <Composer> › effect`, plus the `at` source line when there is one), and the "Update ignored" notice a later write logs repeats it (#4178). The structured event carries the same `ownerPath`. A computed that throws into the effect reading it is named, not the effect. Behaviour is unchanged (the system still halts), and production bundles do not change.
