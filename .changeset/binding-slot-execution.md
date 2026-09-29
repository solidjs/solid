---
"@solidjs/web": patch
"@solidjs/signals": patch
"@solidjs/h": patch
---

Binding slots: the fill runs once per occurrence, untracked, under the occurrence's owner — as a component body and a template-slot fill do. State created in the fill lives as long as the occurrence; a top-level read is a one-time read (dev: `STRICT_READ_UNTRACKED`, naming the fill); getters are the reactive form. Handlers and refs are read once when an element binds and go through `assign`, so events delegate, tuples bind and interactions wrap as in client JSX. On the server an array at a handler position is a dev finding (reason `tuple`) instead of being flattened; only `ref` merges arrays. Template-slot fills are untracked on every render path and carry the same labelled warning.

Breaking: `AttributeSlot` is renamed `BindingSlot`, with no alias, and its return is constrained (`SlotOutput<J>` / `SlotError<M>`, both exported) so an array, DOM node, function, async value or `$`-prefixed key is a type error on both sides. The diagnostic code `ATTRIBUTE_SLOT_POSITION` is renamed `BINDING_SLOT_POSITION`. The fill-shape finding also names async values.
