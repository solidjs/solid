---
"solid-js": major
---

Fix dual runtime package type resolution for CommonJS consumers.

Add CJS-specific declaration outputs for dual-runtime packages and stop exporting legacy `dist/*` entrypoints in favor of the supported public package surface.
