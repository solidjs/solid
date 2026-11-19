---
"@solidjs/signals": patch
---

A store setter that reads a key an open action holds, and writes from it, now joins that action's hold (#5046). Before, `setState(d => { d.copy = d.score })` during an action that set `score` showed the copied value at once, while `score` still showed its old value. A setter that does not read the held key still updates on its own.
