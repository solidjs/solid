---
"@solidjs/web": patch
---

Throw a clear configuration error for invalid `wrapInvocation` values (#3238). A value other than a function or `undefined` — `null`, `false`, an options bag in the wrong slot — used to fail in the quietest available direction: falsy values silently took per-invocation policy (auth, logging) off the call, truthy non-functions threw a bare "not a function" mid-dispatch. The hook is now validated at the point it is resolved for an invocation, on both roads (HTTP dispatch and direct SSR calls), with an error naming `wrapInvocation` and the received type; `undefined` stays the one spelling of absence.
