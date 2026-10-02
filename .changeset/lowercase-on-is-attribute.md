---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
"@solidjs/web": patch
"@solidjs/html": patch
"@solidjs/h": patch
"@solidjs/signals": patch
---

**Breaking:** only `on` followed by an uppercase letter (`onClick`, `onPointerDown`) is an event handler. Lowercase `on*` names (`onclick`, `onmouseover`) are plain attributes everywhere:

- Both compilers compile `onclick={expr}` like any other attribute (`setAttribute`, reactive when `expr` is dynamic) instead of binding a delegated or native event, and SSR renders it as an escaped attribute instead of dropping it. A leftover 1.x `on:click={fn}` is likewise a plain namespaced attribute (it previously compiled to `addEventListener(":click", fn)`).
- `@solidjs/web` `spread`/`assign` set lowercase `on*` keys as attributes, the server spread walk renders them, and `useHead` applies lowercase `on*` attributes (camelCase handler names stay skipped). `ssrAttribute` escapes a function value instead of interpolating its source raw.
- `@solidjs/html` and `@solidjs/h` elements wrap a function passed to a lowercase `on*` in a getter like any other attribute; only `onXxx` and `ref` are exempt.
- `@solidjs/html` components follow `@solidjs/h`'s rule: every zero-argument function prop, `onXxx` handlers and `ref` included, is a getter, so a component handler must declare its event argument (`onClick=${e => …}`).
- New dev-only check `LOWERCASE_EVENT_ATTRIBUTE` (added to the `DiagnosticCode` union): warns once per attribute name when a function is set on a lowercase `on*` (or `on:`) attribute, naming the camelCase handler to use.
