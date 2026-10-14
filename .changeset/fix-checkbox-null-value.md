---
"@solidjs/web": patch
---

The client runtime restores the native submission value for checkbox and radio inputs by removing the `value` attribute when `value` or `defaultValue` is nullish. Checked inputs then submit `"on"`. Explicit empty values are preserved, and text inputs and textareas still clear to `""`.
