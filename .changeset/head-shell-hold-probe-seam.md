---
"solid-js": patch
---

Root-level async head-tag props hold the SSR streaming shell instead of being warn-dropped (#2975 follow-up). `ssrHandleError` gains a side-effect-free probe mode (second argument) that the dom-expressions head registry uses to identify pending reads without routing real errors through the handler chain; the settled tag renders in the shell like any other root-level async content.
