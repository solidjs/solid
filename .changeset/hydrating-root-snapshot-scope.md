---
"solid-js": patch
"@solidjs/web": patch
---

A signal written from `onSettled` or `createEffect` during hydration no longer strands the DOM it reveals (#3504). Two halves: a root created while hydrating marks the hydration snapshot scope itself, so a write during the root pass is held until the pass completes and then replays — previously the scope was marked lazily by the first hydration-aware primitive, so a `<Show>` condition created before that sat outside it and the write cascaded mid-claim. And a streamed boundary's resume window now claims only the subtree under that boundary: a write from the resumed content that reaches a signal above it (a route's `onSettled` adding a toast to a provider) re-renders that already-hydrated region as a client render — fresh nodes, live inserts — instead of claiming against the server registry, missing with a "Hydration key miss" warning, and rendering detached.
