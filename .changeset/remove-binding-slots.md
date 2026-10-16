---
"@solidjs/web": patch
"@solidjs/compiler": patch
"@solidjs/babel-plugin": patch
"@solidjs/signals": patch
"solid-js": patch
---

Server components: binding slots are removed. Client components in slots replace them: place a client component through a `Slot` (`<props.x />`) where the server's markup needs client behavior, or a form `action` for a mutation. Removed with them: the `BindingSlot`, `SlotOutput` and `SlotError` types, the lazy `@solidjs/web/frames/bind` entry and its `"bind"` tier, the `_s:*` position markers and the compiled `ssrClaim` hole, the effect of the `serverComponents` compiler option (`@solidjs/compiler` and `@solidjs/babel-plugin` still accept it, so existing build configs keep working, and ignore it), and the `BINDING_SLOT_POSITION` diagnostic code (`@solidjs/signals`' `DiagnosticCode`, `solid-js`'s `diagnostics.json`). Ordinary slots, their `slot:<id>` ranges and records, and `$key` are unchanged.
