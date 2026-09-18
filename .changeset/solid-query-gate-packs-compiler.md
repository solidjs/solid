---
"test-integration": patch
---

The TanStack Solid Query release gate now compiles the adapter with this tree's compiler as well as running it on this tree's runtime (#3534). It packs `@solidjs/compiler` and `@solidjs/babel-plugin` beside the core tarballs, resolves the compiler's platform packages to the in-repo stubs (their pinned version reaches the registry only after the gate), hands the locally built binding to the loader through `SOLID_COMPILER_NATIVE`, and lifts the fixture's `@solidjs/vite-plugin` to the version the workspace itself is tested with. A release that changes the compiled-output contract (rc.9's `_$$<type>` delegated-event key) is no longer circular with its own gate; `SKIP_SOLID_QUERY_GATE` stays as a self-expiring emergency valve and is no longer set.

The gate also tracks the adapter where it is actually released from — `TanStack/query#solid-query-v6-pre`, the branch behind the `@tanstack/solid-query` `rc` dist-tag — instead of the fork branch frozen at the day TanStack/query#11326 merged, and judges the inner runner's exit by status _and_ signal: a runner aborted by V8's heap limit has no exit code, and the previous check read that as green.
