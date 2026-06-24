---
"solid-js": patch
---

Fix rejected SSR `lazy()` so it reaches `<Errored>` instead of stack-overflowing or leaking an unhandled rejection (#2780). `lazy()` hand-rolls its own promise tracking and previously had no rejection handler, so a failed module load left `p.v` undefined forever (the render memo kept throwing `NotReadyError`, i.e. perpetual "loading") and the orphaned rejection escaped as a process-level `unhandledRejection`. The loader now captures the rejection on the lazy and surfaces it through the render memo, and `ctx.block` swallows its duplicate rejection branch — bringing `lazy()` to parity with async memos, whose rejections already propagate to error boundaries. Once the error reaches the boundary, the existing streamed-fragment hydration path renders the fallback as usual.
