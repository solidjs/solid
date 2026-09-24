---
"solid-js": patch
---

The `solid-js/refresh` HMR wrapper no longer appears in owner paths. Its memo is nameless, so a component reads as `<App> › <Router>` in performance-track labels, diagnostic findings and captures rather than `<App> › [solid-refresh]App › <Router>`; the proxy also carries the component's own name, so an unlabelled `createComponent` opens a `<App>` root rather than `<[solid-refresh]App>`.
