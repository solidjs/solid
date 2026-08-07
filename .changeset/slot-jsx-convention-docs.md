---
"@solidjs/web": patch
---

The `asyncArg` docs model the correct authored form for slots with args: JSX (`<props.status …/>` — the compiler wraps each prop in a getter, deferring reads to the slot border), never a call, which evaluates its args eagerly in the component body — a top-level read, an error in most cases. Argless slots remain plain prop access.
