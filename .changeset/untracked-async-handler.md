---
"@solidjs/signals": patch
---

An interaction whose handler returns a promise stays open until it settles (`InteractionEvent.continuationMs`, `settledMs` covers the wait, 10s cap), and `UNTRACKED_ASYNC_HANDLER` names a handler that awaited past its frame with no write before the `await` and no `action()` — the dead click no hold could judge. `AttributionHooks.interactionEnd` receives the handler's return value.
