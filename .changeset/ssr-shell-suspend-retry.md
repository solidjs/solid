---
"solid-js": patch
"@solidjs/web": patch
---

Fix two SSR failures when the shell suspends above an `<Errored>` (a lazy memo throwing `NotReadyError`, the router's flash-decode shape). A `<Loading>` below the boundary whose content settled before the shell's suspension did lost its content: the fallback shipped and nothing swapped it, because the fragment inlined into a shell that did not yet hold its placeholder. And a hole that reached a suspension through a returned accessor (`{props.children}` resolving to an `<Errored>` whose subtree is pending — a `lazy()` route with no `<Loading>` between, for one) re-read its expression on every retry, re-creating every component above the boundary — state and pending sources included, so a component owning its pending source never converged. The retry now resumes the accessor that suspended.
