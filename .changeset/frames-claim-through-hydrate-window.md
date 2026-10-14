---
"solid-js": patch
"@solidjs/web": patch
---

An adopted frame occurrence claims its server markup by re-entering hydration the way a streamed `<Loading>` resume does (frames-rulings 3.1 / 3.2, the savings plan's A2 — S-hold's window form).

- `solid-js`: `hydrateWindow(id, fn, scope?)` is factored out of a streamed boundary's resume and reached as `sharedConfig.hydrateWindow` (`@internal`): the keys under `id` gathered into the registry (the captured `scope` pair when another `hydrate()` root replaced the live one, #2917), hydrating on for the synchronous window, the current owner the claim owner (a render the window forces elsewhere is a client render, #3504), the owner the window's snapshot and live scope when none is open — so a write during a late claim is held and replays once the claim is over, and a late claim no longer re-marks the root's scope. `sharedConfig.claimRoots` (`@internal`) is typed: the claimant declares a range that may be detached around its window. `holdBoundary` stays the registration; the resume path is unchanged in behaviour.
- `@solidjs/web` (frames): `claimRender` is the window — one `createOwner({ id: prefix })` and the call — instead of a registry of its own gathered by walking the range, a hydrating flag flipped through `sharedConfig`'s setter (which reset hydration-done and re-ran its completion from outside the runtime), and a hand-over of keys from the root registry: `gatherClaims` and `hasPendingFragment` are deleted (the window gathers by the producer prefix and always engages). `adoptBoundary` captures the registry/gather pair it adopts under so a claim made long after — under the frame's hold, at a fragment's reveal — gathers against the root that holds the frame.
- `@solidjs/web`: `gatherHydratable`'s prefix-scoped gather selects its keys natively (`[_hk^="…"]`) instead of sweeping every `_hk` and filtering in JS — it now runs once per adopted occurrence, not only per late resume.
