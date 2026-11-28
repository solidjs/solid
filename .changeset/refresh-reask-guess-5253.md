---
"@solidjs/signals": patch
---

After a `refresh()` of an optimistic store had landed, changing an input its fetch reads while an action's guess was out no longer showed the new input beside the guessed list. The change is now held with the action, as it already was without the earlier refresh (#5253).
