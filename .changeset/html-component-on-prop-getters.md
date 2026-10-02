---
"@solidjs/html": patch
---

Zero-argument functions passed to component props named `on`, `only`, `once`, etc. are now wrapped in getters like any other dynamic prop (#3728). The `on*` exemption on components now covers only `onXxx` handler names (an uppercase letter after `on`), so `<${Loading} on=${() => key()}>` re-keys the boundary when `key()` changes. Native elements are unchanged: every `on*` prop is still passed through as an event handler. A lowercase `onclick` passed to a component is now wrapped in a getter; name it `onClick` or give the handler a parameter.
