---
"solid-js": minor
"@solidjs/web": patch
---

Require a declared commit #0 for `ssrSource: "client"` (#2981). The server cannot run a client source, so the author must say what the pre-compute window renders: `loadingValue` on signal-family sources (`createMemo`, function-form `createSignal`/`createOptimistic`; an explicit `loadingValue: undefined` is a valid declaration — put the undefined in the type and branch on it), `seedLoadingValue: true` on store-family sources (`createProjection`, derived `createStore`/`createOptimisticStore`; the seed is what the window shows). Effects are exempt — nothing renders from them.

Enforced at the type level (the bare `"client"` overloads are gone) and with a runtime error naming the fix — behind the dev flag on the client (zero production bytes; prod falls back to the previous gate behavior), always-on in the single-build server entry, where the implicit promotion would flush into markup. `Portal`'s internal client-sourced memos now declare `loadingValue: undefined` ("server renders nothing" is their honest commit #0).
