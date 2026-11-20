---
"@solidjs/signals": patch
---

Allow calling an action from a cleanup during teardown, as #4165 allowed writes. Removing a keyed row ran its cleanups inside the list's pass, so an action invoked from an `onCleanup` or an effect's returned cleanup threw `ACTION_CALLED_IN_OWNED_SCOPE` in development, while the same cleanup under a branch switching away ran. The dev-only action guard now stands down while cleanups run, like the owned-scope write guard. Production builds are unchanged.
