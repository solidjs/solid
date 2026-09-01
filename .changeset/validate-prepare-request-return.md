---
"@solidjs/web": patch
---

`prepareRequest`'s return is validated instead of replacing the request init wholesale (#3174). A hook returning a fresh object — the natural way to write "add an auth header" — silently dropped the argument payload, the abort signal, and every protocol header, and the call still dispatched. A returned init that lost the transport headers (or is not an object) now fails the call at the call site naming the hook; deliberate body/signal replacement over a spread init remains in contract.
