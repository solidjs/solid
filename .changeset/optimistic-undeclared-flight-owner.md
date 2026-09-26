---
"@solidjs/signals": patch
---

An action's transaction no longer parks forever on an optimistic store whose
source is refetching under another transaction. When the store derives
synchronously from an async source, its pending state is not a declared
flight, so every transaction holding overrides on the store parked on it.
The refetch's landing only re-enters transactions that registered it, so a
refetch caused outside the action (a router action calls `revalidate()` after
an `await`) left the action's held writes uncommitted: `For` index accessors
stayed stale (solidjs/solid-router#619) and an unchanged truth never lifted
the overlay (solidjs/solid-router#620). An undeclared flight is now owned by
the transaction stamped on the store's firewall, the same ownership rule
declared flights already follow.
