---
"@solidjs/signals": patch
---

A keyed `createProjection` whose function returned another store's proxy and then a plain array (for example a memo that returns `issues` or `issues.filter(…)`) keeps updating. Switching away from the proxy compared the new array against the proxy itself, which already showed the source store's new rows, so the projection's readers never heard the change and the frame stalled. The switch now tells every leaf and the container, and each node's own equality check decides whether its readers re-run (#4361).
