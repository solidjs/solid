---
"@solidjs/signals": patch
---

Fix false `GRAPH_GROWTH` warnings caused by the initial route declaration, which runs before page content mounts. The detector now compares completed visits while still emitting the initial graph record.
