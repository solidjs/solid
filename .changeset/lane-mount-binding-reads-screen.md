---
"@solidjs/signals": patch
---

An element an optimistic guess mounts now lands together with its bindings (#3835). A first pass created by a guess's lane reads as the lane's, not just routes as it: a binding the lane mounts reads a write the action still holds as the screen (its committed value) and re-derives when the action lands. Before, a binding inside a memo the lane created was born held while the memo's element showed, so `<div>Hello</div>` appeared without its `style` until the action finished; directly under the lane pass the binding showed the held value early instead.
