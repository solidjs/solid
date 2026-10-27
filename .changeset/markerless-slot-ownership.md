---
"@solidjs/web": patch
---

A node that moves into a hole with no marker (a sole child, or the last child) no longer keeps the `$$SLOT` tag of the hole it came from. The markerless hole now retags it with its parent, so a later removal from that hole takes the node out of the DOM instead of skipping it as another slot's. Untagged nodes in markerless holes stay untagged, so lists like a `<For>` under `<tbody>` take the same path as before.
