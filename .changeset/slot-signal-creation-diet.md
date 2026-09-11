---
"@solidjs/signals": patch
---

Store leaf nodes ride `slotSignal` — one pre-shaped literal with `_host`/`_key` backrefs replacing the per-node options object, equals closure, unobserved closure, and the NodeExtension that held it; the unobserved sweep dispatches CONFIG_SLOT_NODE nodes to one shared hook. getNode self-time −23% on dbmon warm mounts.
