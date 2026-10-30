---
"@solidjs/signals": patch
---

A memo born into a hold that reads `latest()` in its pass (for example by calling a function a `Loading` fallback returned) no longer mounts that `Loading` again and again once the content lands. The memo's re-run is still the hold's own work, so it joins the hold whatever it asked before (D-25), and the boundary it mounts belongs to the hold and appears at its commit (D-13): the screen goes straight to the content.
