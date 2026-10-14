---
"@solidjs/web": patch
---

Bind each server-component site to its own frame when the server minted the sites in a different order than the client mounts them (#4042). Document adoption took sites of one server function by ordinal (`id`, `id~2`, …), so a site behind async setup, rendered after its neighbours on the server but mounted first on the client, adopted a neighbour's element, and its first update landed in the wrong frame. A document frame for a call with arguments now carries the call's argument hash (`data-fa`), and a mount takes the unclaimed site showing its own arguments, falling back to the first unclaimed site when none does. Argless calls render byte-identical markup.
