---
"@solidjs/web": patch
---

The client runtime removes the `value` attribute when an input is a checkbox or radio and its `value` or `defaultValue` is nullish. Checked inputs then submit the native default `"on"`. Explicit empty values are preserved, and text inputs and textareas still clear to `""`.
