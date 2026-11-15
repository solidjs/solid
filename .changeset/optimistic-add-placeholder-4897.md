---
"@solidjs/signals": patch
---

optimistic stores: when an add's answer lands while another action's reorder guess is out, the reorder's re-base drops the placeholder it carried from the add instead of showing it beside the new row; and a list reader of a key the reorder only borrowed from the add stays subscribed to the reorder, so its end reaches a `<For>` after the add is declined (#4897).
