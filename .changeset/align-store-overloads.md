---
"@solidjs/signals": patch
"solid-js": patch
---

Align store overloads across the signals, client, and server entry points. Plain stores share `StoreOptions`, projection forms share `ProjectionOptions`, plain optimistic stores expose their existing options argument, and derived optimistic stores are typed as refreshable.
